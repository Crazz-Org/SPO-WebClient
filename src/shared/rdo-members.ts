/**
 * src/shared/rdo-members.ts
 *
 * RDO member catalogue — ONE entry per member this client actually emits.
 *
 * ## What an entry records
 *
 * Each entry records the form the client emits today: its `kind`, from which
 * the frame emitter derives the separator, and its `arity`:
 *
 *   - `function`   -> `call <name> "^" <args>`  (the frame asks for a result)
 *   - `procedure`  -> `call <name> "*" <args>`  (the frame asks for none)
 *   - `accessor`   -> `get <name>` / `set <name>=<value>`  (no separator)
 *
 * That form is frozen by the separator lock of #912:
 * `src/shared/rdo-separator-lock.test.ts` keeps its own literal table, apart
 * from `RDO_MEMBERS`, so changing a `kind` or an `arity` here turns that test
 * red. A change to an emitted form is a deliberate edit of both, never a side
 * effect.
 *
 * A CALL that omits `separator` still puts `"^"` on the wire: every request
 * routed through `sendRdoRequest` is allocated a QueryId, and the formatter
 * (`RdoProtocol.format`, src/server/rdo.ts) falls back to `METHOD_SEPARATOR`
 * whenever `rid !== undefined`. Those members are catalogued as `function`
 * because that is what the wire carries.
 *
 * ## Where an entry has been checked, it cites its source
 *
 * Where the declaring unit (SPO-Original `Kernel/`, `DServer/`, `StdBlocks/`,
 * `Interface Server/`, `Tasks/`, …) or a reference-client emission (a Voyager
 * `.pas`, an SPO-ASP `.asp`) has been read, the entry's trailing comment cites
 * it as `File.pas:Line`. The three POLITICS mutations are an example:
 *
 *   RDOSetRatingFrom  Kernel/TownPolitics.pas:40   procedure, 3 args
 *   RDOSetPublicity   Kernel/TownPolitics.pas:41   procedure, 2 args
 *   RDOSetProjectData Kernel/TownPolitics.pas:45   procedure, 3 args
 *
 * All three are declared identically on `TPresidentialHall`
 * (Kernel/WorldPolitics.pas:256,257,260), so one entry serves the Town Hall and
 * the Capitol. All three are `procedure` — they must be emitted with `"*"` and
 * no QueryId, which is what `.toFrame()` on a catalogued procedure produces.
 *
 * An entry with no such citation has not been checked against a declaration
 * yet: its form is simply what the client emits today, and the lock records
 * its source as `[UNKNOWN]`. In-repo pointers in the comments name the
 * emitting function (`spo_session.ts (loadMapArea)`), never a line number.
 *
 * ## A divergence is explained, never silently "fixed"
 *
 * Where the declaration and the emitted form disagree, the entry's comment says
 * so and explains it under CLAUDE.md § RDO rule 2 — a form the reference client
 * demonstrably emitted wins over what the declaration suggests — or rule 1 (the
 * verb follows the reference client). See `RDOOpenSession` (rule 1: a 0-arg
 * function read with `get`) and `RDOClose` / `RDONextStep` / `RDOPrevStep` (the
 * declared arity preferred over the ASP's, with the reason given).
 *
 * ## The `set` accessors of the building inspector — why the set is closed
 *
 * One emission site names its member at runtime rather than in code:
 * `building-property-handler.ts` (`setBuildingPropertyImpl`) emits
 * `set <name>` where `<name>` arrives from the browser in
 * `additionalParams.propertyName`. That looks open. It is not, and the reason
 * matters for anyone tempted to widen the catalogue's API to accommodate it.
 *
 * The name has exactly one producer, `resolveRdoCommand`
 * (`client/components/building/property-utils.ts`), which only ever returns
 * `command: 'property'` for a key that a `rdoCommands` table declares as such.
 * Those tables exist in exactly one file, `shared/building-details/
 * template-groups.ts`, and they are written by hand — 17 entries, 8 distinct
 * names: `Name`, `Stopped`, `Rent`, `Maintenance`, `Interest`, `Term`,
 * `HoursOnAir` and `Commercials`.
 *
 * **CLASSES.BIN does not widen it.** `registerInspectorTabs`
 * (`shared/building-details/property-templates.ts`) reads the legacy
 * CLASSES.BIN registration to decide *which* `PropertyGroup`s a given building
 * class displays, mapping handler names through `HANDLER_TO_GROUP` and copying
 * the groups verbatim. It selects among static groups; it never synthesises a
 * group and never injects a key into `rdoCommands`. So the building class
 * changes which of the 8 names are reachable, never what the 8 are.
 *
 * The set is therefore closed at authoring time, and `rdoSet` can keep a
 * `RdoMemberName` parameter. The runtime check at the emission site is what
 * turns a table edit that forgets this file into an error instead of a frame
 * the server silently discards — see `Commercials` below.
 */

/** How a member is emitted on the wire — the form, not its provenance (see the header). */
export type RdoMemberSpec =
  /** Emitted as `call <name> "^" <args>`. */
  | { readonly kind: 'function'; readonly arity: number }
  /** Emitted as `call <name> "*" <args>`. */
  | { readonly kind: 'procedure'; readonly arity: number }
  /** Emitted as `get <name>` and/or `set <name>=<value>`. */
  | { readonly kind: 'accessor'; readonly access: readonly ('get' | 'set')[] };

export const RDO_MEMBERS = {
  AccountStatus:             { kind: 'function',  arity: 2 },                // src/server/session/login-handler.ts (loginWorld)
  AddHeaders:                { kind: 'procedure', arity: 1 },                // src/server/session/mail-handler.ts (composeMail, saveDraft)
  AddLine:                   { kind: 'procedure', arity: 1 },                // src/server/session/mail-handler.ts (composeMail, saveDraft)
  AllObjectStatusText:       { kind: 'function',  arity: 2 },                // Interface Server/InterfaceServer.pas:148; src/server/session/research-status-handler.ts
  BreakCircuitAt:            { kind: 'function',  arity: 4 },                // src/server/session/road-handler.ts (demolishRoad)
  // Read-only here: the bank budget slider writes through RDOSetLoanPerc
  // (StdBlocks/Banks.pas:47), never `set BudgetPerc`. Voyager reads it live off
  // the block (Voyager/BankGeneralSheet.pas:266).
  BudgetPerc:                { kind: 'accessor',  access: ['get'] },         // StdBlocks/Banks.pas:39; src/server/session/building-details-handler.ts (enrichBankTab)
  CanJoinWorldEx:            { kind: 'function',  arity: 1 },                // Interface Server/InterfaceServer.pas:441; src/server/session/login-handler.ts (checkWorldAdmission)
  Chase:                     { kind: 'function',  arity: 1 },                // Interface Server/InterfaceServer.pas:189; src/server/session/chat-handler.ts (chaseUser)
  CheckNewMail:              { kind: 'function',  arity: 2 },                // src/server/session/mail-handler.ts (getMailUnreadCount)
  ClientAware:               { kind: 'procedure', arity: 0 },                // src/server/session/login-handler.ts (selectCompany)
  ClientNotAware:            { kind: 'procedure', arity: 0 },                // src/server/spo_session.ts (endSession)
  CloneFacility:             { kind: 'procedure', arity: 5 },                // src/server/spo_session.ts (cloneFacility)
  CloseMessage:              { kind: 'procedure', arity: 1 },                // src/server/session/mail-handler.ts (composeMail, saveDraft, readMailMessage)
  CloseObject:               { kind: 'procedure', arity: 1 },                // src/server/spo_session.ts (cacherCloseObject)
  // Two m. The inspector stores this value under the cache key `Comercials`
  // (one m, TVGeneralSheet.pas:15), but both the live read and the write use the
  // published name — `cmm := MSProxy.Commercials` (TVGeneralSheet.pas:274) and
  // `Proxy.Commercials := …` (:322).
  Commercials:               { kind: 'accessor',  access: ['get', 'set'] },  // StdBlocks/Broadcast.pas:53; building-details-handler.ts (enrichTvTab), building-property-handler.ts (setBuildingPropertyImpl)
  // Write-only here: the Get New Assignment button sets it to true, which is what
  // releases the finished task (`Tasks/Tasks.pas:156`, written at `ModifyTask.asp:32-33`).
  // The panel learns the task is done from the cached `TutorialTaskDone`, never by reading
  // this back, so `get` has no call site and is deliberately absent.
  Completed:                 { kind: 'accessor',  access: ['set'] },         // Tasks/Tasks.pas:156; src/server/session/tutorial-handler.ts (runTutorialAction)
  ConnectFacilities:         { kind: 'function',  arity: 2 },                // src/server/spo_session.ts (connectFacilitiesByCoords)
  ContextStatusText:         { kind: 'function',  arity: 2 },                // Interface Server/InterfaceServer.pas:149; src/server/session/context-status-handler.ts
  CreateChannel:             { kind: 'function',  arity: 5 },                // Interface Server/InterfaceServer.pas:186; src/server/session/chat-handler.ts (createChatChannel)
  CreateCircuitSeg:          { kind: 'function',  arity: 7 },                // src/server/session/road-handler.ts (buildRoad)
  CreateObject:              { kind: 'function',  arity: 1 },                // src/server/spo_session.ts (cacherCreateObject)
  DAAddr:                    { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts (fetchWorldProperties)
  DALockPort:                { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts (fetchWorldProperties)
  DefineZone:                { kind: 'function',  arity: 6 },                // Interface Server/InterfaceServer.pas:161; Voyager/URLHandlers/ServerCnxHandler.pas:2231; src/server/session/zone-surface-handler.ts (defineZone)
  DeleteMessage:             { kind: 'procedure', arity: 4 },                // src/server/session/mail-handler.ts (deleteMailMessage)
  EnableEvents:              { kind: 'accessor',  access: ['set'] },         // src/server/session/login-handler.ts (selectCompany)
  FindClients:               { kind: 'function',  arity: 9 },                // src/server/session/politics-handler.ts (searchConnections)
  FindSuppliers:             { kind: 'function',  arity: 9 },                // src/server/session/politics-handler.ts (searchConnections)
  GetAttachment:             { kind: 'function',  arity: 1 },                // src/server/session/mail-handler.ts (readMailMessage)
  GetAttachmentCount:        { kind: 'function',  arity: 1 },                // src/server/session/mail-handler.ts (readMailMessage)
  GetChannelInfo:            { kind: 'function',  arity: 1 },                // src/server/session/chat-handler.ts (getChatChannelInfo)
  GetChannelList:            { kind: 'function',  arity: 1 },                // src/server/session/chat-handler.ts (getChatChannelList)
  GetCompanyCluster:         { kind: 'function',  arity: 1 },                // Interface Server/InterfaceServer.pas:171; src/server/session/login-handler.ts (readCompanyList)
  GetCompanyCount:           { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts (loginWorld)
  GetCompanyFacilityCount:   { kind: 'function',  arity: 1 },                // Interface Server/InterfaceServer.pas:173; src/server/session/login-handler.ts (readCompanyList)
  GetCompanyId:              { kind: 'function',  arity: 1 },                // Interface Server/InterfaceServer.pas:172; src/server/session/login-handler.ts (readCompanyList)
  GetCompanyName:            { kind: 'function',  arity: 1 },                // Interface Server/InterfaceServer.pas:170; src/server/session/login-handler.ts (readCompanyList)
  GetCompanyOwnerRole:       { kind: 'function',  arity: 1 },                // Interface Server/InterfaceServer.pas:169; src/server/session/login-handler.ts (readCompanyList)
  GetHeaders:                { kind: 'function',  arity: 1 },                // src/server/session/mail-handler.ts (readMailMessage)
  GetInputNames:             { kind: 'function',  arity: 2 },                // src/server/session/building-details-handler.ts (getGatePaths)
  GetLines:                  { kind: 'function',  arity: 1 },                // src/server/session/mail-handler.ts (readMailMessage)
  GetOutputNames:            { kind: 'function',  arity: 2 },                // src/server/session/building-details-handler.ts (getGatePaths)
  GetPropertyList:           { kind: 'function',  arity: 1 },                // src/server/spo_session.ts (cacherGetPropertyList)
  GetSubObjectProps:         { kind: 'function',  arity: 2 },                // src/server/session/building-details-handler.ts (fetchSubObjectProperties)
  GetSurface:                { kind: 'function',  arity: 5 },                // src/server/session/zone-surface-handler.ts (getSurfaceData)
  GetTycoonCookie:           { kind: 'function',  arity: 2 },                // src/server/session/login-handler.ts (selectCompany)
  GetUserList:               { kind: 'function',  arity: 0 },                // src/server/session/chat-handler.ts (getChatUserList)
  HoursOnAir:                { kind: 'accessor',  access: ['get', 'set'] },  // StdBlocks/Broadcast.pas:51; building-details-handler.ts (enrichTvTab), building-property-handler.ts (setBuildingPropertyImpl)
  Interest:                  { kind: 'accessor',  access: ['get', 'set'] },  // StdBlocks/Banks.pas:40; building-details-handler.ts (enrichBankTab), building-property-handler.ts (setBuildingPropertyImpl)
  JoinChannel:               { kind: 'function',  arity: 2 },                // src/server/session/chat-handler.ts (joinChatChannel)
  KeepAlive:                 { kind: 'procedure', arity: 0 },                // src/server/spo_session.ts (startCacherKeepAlive)
  Logoff:                    { kind: 'accessor',  access: ['get'] },         // src/server/spo_session.ts (endSession)
  Logon:                     { kind: 'function',  arity: 2 },                // src/server/session/login-handler.ts (loginWorld, fullWorldRelogin)
  LogServerOn:               { kind: 'function',  arity: 1 },                // src/server/spo_session.ts (connectMailService)
  MailAccount:               { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts (loginWorld)
  MailAddr:                  { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts (fetchWorldProperties)
  MailPort:                  { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts (fetchWorldProperties)
  Maintenance:               { kind: 'accessor',  access: ['set'] },         // building-property-handler.ts (setBuildingPropertyImpl) <- template-groups.ts (RES_GENERAL_GROUP)
  MsgCompositionChanged:     { kind: 'procedure', arity: 1 },                // src/server/session/chat-handler.ts (pushCompositionState)
  Name:                      { kind: 'accessor',  access: ['set'] },         // src/server/session/building-management-handler.ts (renameFacilityImpl)
  NewCompany:                { kind: 'function',  arity: 2 },                // src/server/session/login-handler.ts (createCompany)
  NewFacility:               { kind: 'function',  arity: 4 },                // src/server/session/building-templates-handler.ts (placeBuilding, placeCapitol)
  NewMail:                   { kind: 'function',  arity: 3 },                // src/server/session/mail-handler.ts (composeMail, saveDraft)
  ObjectAt:                  { kind: 'function',  arity: 2 },                // src/server/spo_session.ts (objectAt)
  ObjectsInArea:             { kind: 'function',  arity: 4 },                // src/server/spo_session.ts (loadMapArea)
  OpenMessage:               { kind: 'function',  arity: 4 },                // src/server/session/mail-handler.ts (readMailMessage)
  PickEvent:                 { kind: 'function',  arity: 1 },                // src/server/session/login-handler.ts (selectCompany), src/server/session/world-events-handler.ts (pickWorldEvent)
  Post:                      { kind: 'function',  arity: 2 },                // src/server/session/mail-handler.ts (composeMail)
  RDOAcceptCloning:          { kind: 'accessor',  access: ['get', 'set'] },  // src/server/session/building-management-handler.ts (manageConstructionImpl)
  // StdBlocks/Banks.pas:46 — the arity-2 form declared on TBankBlock, the one the
  // bank sheet emits (Voyager/BankGeneralSheet.pas:439). TTycoon publishes an
  // unrelated 1-argument RDOAskLoan (Kernel/Kernel.pas:2522) reached only over ASP
  // (profile-finance-handler.ts); the catalogue is name-keyed and holds the block
  // form alone, so routing the tycoon form through rdoCall throws on arity.
  RDOAskLoan:                { kind: 'function',  arity: 2 },                // StdBlocks/Banks.pas:46; src/server/session/building-details-handler.ts (requestBankLoan)
  RDOAutoProduce:            { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOBanMinister:            { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOCacncelTransc:          { kind: 'procedure', arity: 0 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOCancelMovie:            { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOCancelResearch:         { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOCanJoinNewWorld:        { kind: 'function',  arity: 1 },                // DServer/DirectoryServer.pas:116; src/server/session/login-handler.ts (checkWorldLimit)
  // The three tutorial navigation members are declared together on `TInformativeTask`,
  // each a published `procedure` taking one `useless : integer` it never reads. We emit
  // the declared arity rather than the zero-argument form the ASP's COM proxy happened to
  // send (`ModifyTask.asp:27-31`): the dispatcher marshals whatever arrived into EDX and
  // the body ignores it (`Rdo/Server/RDOObjectServer.pas:214-221`, `:266-277`), so the
  // declared form is both safe and a direct match to the citation.
  RDOClose:                  { kind: 'procedure', arity: 1 },                // Tasks/InformativeTask.pas:15; src/server/session/tutorial-handler.ts (runTutorialAction)
  RDOCnntId:                 { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts (loginWorld, fullWorldRelogin)
  RDOConnectInput:           { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOConnectOutput:          { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOConnectToTycoon:        { kind: 'procedure', arity: 3 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDODelFacility:            { kind: 'function',  arity: 2 },                // src/server/session/building-management-handler.ts (deleteFacilityImpl)
  RDODisconnectFromTycoon:   { kind: 'procedure', arity: 3 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDODisconnectInput:        { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDODisconnectOutput:       { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDODowngrade:              { kind: 'procedure', arity: 0 },                // src/server/session/building-management-handler.ts (manageConstructionImpl)
  RDOEndSession:             { kind: 'procedure', arity: 0 },                // DServer/DirectoryServer.pas:31; src/server/session/login-handler.ts (performDirectoryAuth, performDirectoryQuery, searchPeople)
  RDOEstimateLoan:           { kind: 'function',  arity: 1 },                // StdBlocks/Banks.pas:45; src/server/session/building-details-handler.ts (enrichBankTab)
  RDOFavoritesDelItem:       { kind: 'function',  arity: 1 },                // src/server/session/favorites-handler.ts
  RDOFavoritesGetSubItems:   { kind: 'function',  arity: 1 },                // src/server/session/favorites-handler.ts (fetchSubItems)
  RDOFavoritesMoveItem:      { kind: 'function',  arity: 2 },                // Interface Server/InterfaceServer.pas:202; src/server/session/favorites-handler.ts
  RDOFavoritesNewItem:       { kind: 'function',  arity: 4 },                // src/server/session/favorites-handler.ts
  RDOFavoritesRenameItem:    { kind: 'function',  arity: 2 },                // src/server/session/favorites-handler.ts
  RDOGetDemand:              { kind: 'function',  arity: 1 },                // StdBlocks/ServiceBlock.pas:309; src/server/session/building-details-handler.ts (getBuildingServiceFigures)
  RDOGetInvDescEx:           { kind: 'function',  arity: 2 },                // src/server/session/research-handler.ts (getResearchDetails)
  RDOGetInvPropsByLang:      { kind: 'function',  arity: 2 },                // src/server/session/research-handler.ts (getResearchDetails)
  RDOGetSupply:              { kind: 'function',  arity: 1 },                // StdBlocks/ServiceBlock.pas:310; src/server/session/building-details-handler.ts (getBuildingServiceFigures)
  RDOGetWorkers:             { kind: 'function',  arity: 1 },                // Kernel/WorkCenterBlock.pas:139; src/server/session/building-details-handler.ts (readWorkerCounts)
  RDOLaunchMovie:            { kind: 'procedure', arity: 4 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOLogonClient:            { kind: 'procedure', arity: 2 },                // Kernel/World.pas:412; src/server/spo_session.ts (connectConstructionService)
  RDOLogonUser:              { kind: 'function',  arity: 2 },                // DServer/DirectoryServer.pas:92; src/server/session/login-handler.ts (performDirectoryAuth)
  RDOMapSegaUser:            { kind: 'function',  arity: 1 },                // src/server/session/login-handler.ts (performDirectoryAuth)
  RDONextStep:               { kind: 'procedure', arity: 1 },                // Tasks/InformativeTask.pas:16; src/server/session/tutorial-handler.ts (runTutorialAction)
  // DServer/DirectoryServer.pas:143 — a 0-arg published FUNCTION, kept as accessor `get`
  // under rule 1: the verb follows the reference client, which emits `get RDOOpenSession`,
  // served by the Delphi get→CallMethod fallthrough (RDOObjectServer.pas:112-116).
  RDOOpenSession:            { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts (performDirectoryAuth, performDirectoryQuery, searchPeople)
  RDOPrevStep:               { kind: 'procedure', arity: 1 },                // Tasks/InformativeTask.pas:17; src/server/session/tutorial-handler.ts (runTutorialAction)
  RDOQueryKey:               { kind: 'function',  arity: 2 },                // src/server/session/login-handler.ts (performDirectoryQuery)
  RDOQueueResearch:          { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOReleaseMovie:           { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RdoRepair:                 { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSearchKey:              { kind: 'function',  arity: 2 },                // DServer/DirectoryServer.pas:84; src/server/session/login-handler.ts (searchPeople)
  RDOSelectWare:             { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSelSelected:            { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSetCompanyInputDemand:  { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSetCurrentKey:          { kind: 'function',  arity: 1 },                // DServer/DirectoryServer.pas:36; src/server/session/login-handler.ts (searchPeople)
  RDOSetInputFluidPerc:      { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSetInputMaxPrice:       { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSetInputMinK:           { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSetInputOverPrice:      { kind: 'procedure', arity: 3 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSetInputSortMode:       { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSetLoanPerc:            { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSetMinistryBudget:      { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSetMinSalaryValue:      { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSetOutputPrice:         { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSetPrice:               { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSetProjectData:         { kind: 'procedure', arity: 3 },                // Kernel/TownPolitics.pas:45, Kernel/WorldPolitics.pas:260
  RDOSetPublicity:           { kind: 'procedure', arity: 2 },                // Kernel/TownPolitics.pas:41, Kernel/WorldPolitics.pas:257
  RDOSetRatingFrom:          { kind: 'procedure', arity: 3 },                // Kernel/TownPolitics.pas:40, Kernel/WorldPolitics.pas:256
  RDOSetRole:                { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSetSalaries:            { kind: 'procedure', arity: 3 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSetTaxValue:            { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSetTownTaxes:           { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSetTradeLevel:          { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSetWordsOfWisdom:       { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSitMayor:               { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOSitMinister:            { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOStartUpgrades:          { kind: 'procedure', arity: 1 },                // src/server/session/building-management-handler.ts (manageConstructionImpl)
  RdoStopRepair:             { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOStopUpgrade:            { kind: 'procedure', arity: 0 },                // src/server/session/building-management-handler.ts (manageConstructionImpl)
  RDOVote:                   { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts (setBuildingPropertyImpl)
  RDOVoteOf:                 { kind: 'function',  arity: 1 },                // src/server/session/building-details-handler.ts (enrichVotesTab)
  RegisterEventsById:        { kind: 'function',  arity: 1 },                // src/server/session/login-handler.ts (loginWorld, fullWorldRelogin)
  Rent:                      { kind: 'accessor',  access: ['set'] },         // building-property-handler.ts (setBuildingPropertyImpl) <- template-groups.ts (RES_GENERAL_GROUP)
  Save:                      { kind: 'function',  arity: 2 },                // src/server/session/mail-handler.ts (saveDraft)
  SayThis:                   { kind: 'procedure', arity: 2 },                // src/server/session/chat-handler.ts (sendChatMessage)
  SegmentsInArea:            { kind: 'function',  arity: 5 },                // src/server/spo_session.ts (loadMapArea)
  ServerBusy:                { kind: 'accessor',  access: ['get'] },         // src/server/spo_session.ts (startServerBusyPolling)
  SetLanguage:               { kind: 'procedure', arity: 1 },                // src/server/session/login-handler.ts (loginWorld, fullWorldRelogin)
  SetObject:                 { kind: 'function',  arity: 2 },                // src/server/spo_session.ts (cacherSetObject), src/server/session/politics-handler.ts (setObjectLoaded)
  SetPath:                   { kind: 'function',  arity: 1 },                // src/server/session/building-details-handler.ts (fetchGateDetails), src/server/spo_session.ts (cacherSetPath)
  SetTycoonCookie:           { kind: 'procedure', arity: 3 },                // src/server/spo_session.ts (savePlayerPosition)
  SetViewedArea:             { kind: 'procedure', arity: 4 },                // src/server/spo_session.ts (setViewedArea)
  StopChase:                 { kind: 'function',  arity: 0 },                // Interface Server/InterfaceServer.pas:190; src/server/session/chat-handler.ts (stopChase)
  Stopped:                   { kind: 'accessor',  access: ['set'] },         // building-property-handler.ts (setBuildingPropertyImpl) <- template-groups.ts (every *_GENERAL_GROUP)
  SwitchFocusEx:             { kind: 'function',  arity: 3 },                // src/server/spo_session.ts (doFocusBuilding)
  Term:                      { kind: 'accessor',  access: ['get', 'set'] },  // StdBlocks/Banks.pas:41; building-details-handler.ts (enrichBankTab), building-property-handler.ts (setBuildingPropertyImpl)
  TycoonId:                  { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts (loginWorld, fullWorldRelogin)
  UnfocusObject:             { kind: 'procedure', arity: 1 },                // src/server/spo_session.ts (unfocusBuilding)
  WipeCircuit:               { kind: 'function',  arity: 6 },                // src/server/session/road-handler.ts (wipeCircuit)
  WorldName:                 { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts (fetchWorldProperties)
  WorldSeason:               { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts (fetchWorldProperties)
  WorldURL:                  { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts (fetchWorldProperties)
  WorldXSize:                { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts (fetchWorldProperties)
  WorldYSize:                { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts (fetchWorldProperties)
} as const satisfies Record<string, RdoMemberSpec>;

/** Every member name the catalogue knows. */
export type RdoMemberName = keyof typeof RDO_MEMBERS;

/** True when `name` has a catalogued emission form. */
export function isCataloguedRdoMember(name: string): name is RdoMemberName {
  return Object.prototype.hasOwnProperty.call(RDO_MEMBERS, name);
}
