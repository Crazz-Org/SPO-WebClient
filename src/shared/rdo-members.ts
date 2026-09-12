/**
 * src/shared/rdo-members.ts
 *
 * RDO member catalogue — ONE entry per member this client actually emits.
 *
 * ## Where this comes from
 *
 * Extracted mechanically from the emitting call sites of the running client,
 * which is the only source of truth this file recognises. `kind` is read off
 * the separator the code writes today:
 *
 *   - `"^"` at the call site   -> `function`   (the frame asks for a result)
 *   - `"*"` at the call site   -> `procedure`  (the frame asks for none)
 *   - emitted via `get` / `set` -> `accessor`  (the grammar has no separator here)
 *
 * A CALL site that omits `separator` still puts `"^"` on the wire: every request
 * routed through `sendRdoRequest` is allocated a QueryId, and `RdoProtocol.format`
 * falls back to `METHOD_SEPARATOR` whenever `rid !== undefined`
 * (src/server/rdo.ts:425). Those sites are catalogued as `function` because that
 * is what the wire carries — not because any declaration was consulted.
 *
 * `arity` is likewise the number of arguments the call site emits.
 *
 * ## What this file is NOT
 *
 * It is not a conformity oracle and it encodes no Pascal declaration. It is a
 * census of current behaviour, so the frame emitter can derive the separator
 * from the member instead of having it retyped at every call site.
 *
 * ## The exception: members added BEFORE their first call site
 *
 * A member the client has never emitted has no separator to read off. For those
 * — and only those — `kind` and `arity` come from the server-side Pascal
 * declaration, which the comment cites as `File.pas:Line` instead of a call
 * site. The three POLITICS mutations added for the Politics feature are the
 * current members in that case:
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
 * ## The `set` accessors of the building inspector — why the set is closed
 *
 * One emission site names its member at runtime rather than in code:
 * `building-property-handler.ts:188` emits `set <name>` where `<name>` arrives
 * from the browser in `additionalParams.propertyName`. That looks open. It is
 * not, and the reason matters for anyone tempted to widen the catalogue's API
 * to accommodate it.
 *
 * The name has exactly one producer, `resolveRdoCommand`
 * (`client/components/building/property-utils.ts:32`), which only ever returns
 * `command: 'property'` for a key that a `rdoCommands` table declares as such.
 * Those tables exist in exactly one file, `shared/building-details/
 * template-groups.ts`, and they are written by hand — 17 entries, 8 distinct
 * names: the seven marked `<- template-groups.ts:N` below, plus `Name`.
 *
 * **CLASSES.BIN does not widen it.** `registerInspectorTabs`
 * (`shared/building-details/property-templates.ts:55-121`) reads the legacy
 * CLASSES.BIN registration to decide *which* `PropertyGroup`s a given building
 * class displays, mapping handler names through `HANDLER_TO_GROUP` (`:66`) and
 * copying the groups verbatim (`:77-84`). It selects among static groups; it
 * never synthesises a group and never injects a key into `rdoCommands`. So the
 * building class changes which of the 8 names are reachable, never what the 8
 * are.
 *
 * The set is therefore closed at authoring time, and `rdoSet` can keep a
 * `RdoMemberName` parameter. The runtime check at the emission site is what
 * turns a table edit that forgets this file into an error instead of a frame
 * the server silently discards — see `Commercials` below.
 *
 * Lot A of the RDO control rework. Members whose call sites disagree are
 * deliberately ABSENT — see report/divergences-rdo.md.
 */

/** How a member is emitted on the wire. Nothing here is derived from Delphi. */
export type RdoMemberSpec =
  /** Emitted as `call <name> "^" <args>`. */
  | { readonly kind: 'function'; readonly arity: number }
  /** Emitted as `call <name> "*" <args>`. */
  | { readonly kind: 'procedure'; readonly arity: number }
  /** Emitted as `get <name>` and/or `set <name>=<value>`. */
  | { readonly kind: 'accessor'; readonly access: readonly ('get' | 'set')[] };

export const RDO_MEMBERS = {
  AccountStatus:             { kind: 'function',  arity: 2 },                // src/server/session/login-handler.ts:369
  AddHeaders:                { kind: 'procedure', arity: 1 },                // src/server/session/mail-handler.ts:131,224
  AddLine:                   { kind: 'procedure', arity: 1 },                // src/server/session/mail-handler.ts:137
  BreakCircuitAt:            { kind: 'function',  arity: 4 },                // src/server/session/road-handler.ts:333
  CanJoinWorldEx:            { kind: 'function',  arity: 1 },                // Interface Server/InterfaceServer.pas:441; src/server/session/login-handler.ts (checkWorldAdmission)
  CheckNewMail:              { kind: 'function',  arity: 2 },                // src/server/session/mail-handler.ts:416
  ClientAware:               { kind: 'procedure', arity: 0 },                // src/server/session/login-handler.ts:587
  ClientNotAware:            { kind: 'procedure', arity: 0 },                // src/server/spo_session.ts:2890
  CloneFacility:             { kind: 'procedure', arity: 5 },                // src/server/spo_session.ts:1361
  CloseMessage:              { kind: 'procedure', arity: 1 },                // src/server/session/mail-handler.ts:163
  CloseObject:               { kind: 'procedure', arity: 1 },                // src/server/spo_session.ts:1504
  // Two m. The inspector reads this value under the cache key `Comercials`
  // (one m, TVGeneralSheet.pas:15); only the write uses the published name.
  Commercials:               { kind: 'accessor',  access: ['set'] },         // building-property-handler.ts:188 <- template-groups.ts:321
  ConnectFacilities:         { kind: 'function',  arity: 2 },                // src/server/spo_session.ts:795
  CreateCircuitSeg:          { kind: 'function',  arity: 7 },                // src/server/session/road-handler.ts:192
  CreateObject:              { kind: 'function',  arity: 1 },                // src/server/spo_session.ts:1414
  DAAddr:                    { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts:789
  DALockPort:                { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts:789
  DefineZone:                { kind: 'function',  arity: 6 },                // src/server/session/zone-surface-handler.ts:41
  DeleteMessage:             { kind: 'procedure', arity: 4 },                // src/server/session/mail-handler.ts:391
  EnableEvents:              { kind: 'accessor',  access: ['set'] },         // src/server/session/login-handler.ts:525
  FindClients:               { kind: 'function',  arity: 9 },                // src/server/session/politics-handler.ts:592
  FindSuppliers:             { kind: 'function',  arity: 9 },                // src/server/session/politics-handler.ts:592
  GetAttachment:             { kind: 'function',  arity: 1 },                // src/server/session/mail-handler.ts:338
  GetAttachmentCount:        { kind: 'function',  arity: 1 },                // src/server/session/mail-handler.ts:326
  GetChannelInfo:            { kind: 'function',  arity: 1 },                // src/server/session/chat-handler.ts:112
  GetChannelList:            { kind: 'function',  arity: 1 },                // src/server/session/chat-handler.ts:94
  GetCompanyCount:           { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts:478
  GetHeaders:                { kind: 'function',  arity: 1 },                // src/server/session/mail-handler.ts:306
  GetInputNames:             { kind: 'function',  arity: 2 },                // src/server/session/building-details-handler.ts:983
  GetLines:                  { kind: 'function',  arity: 1 },                // src/server/session/mail-handler.ts:316
  GetOutputNames:            { kind: 'function',  arity: 2 },                // src/server/session/building-details-handler.ts:1375
  GetPropertyList:           { kind: 'function',  arity: 1 },                // src/server/spo_session.ts:1455
  GetSubObjectProps:         { kind: 'function',  arity: 2 },                // src/server/session/building-details-handler.ts:1540
  GetSurface:                { kind: 'function',  arity: 5 },                // src/server/session/zone-surface-handler.ts:85
  GetTycoonCookie:           { kind: 'function',  arity: 2 },                // src/server/session/login-handler.ts:558
  GetUserList:               { kind: 'function',  arity: 0 },                // src/server/session/chat-handler.ts:77
  HoursOnAir:                { kind: 'accessor',  access: ['set'] },         // building-property-handler.ts:188 <- template-groups.ts:313
  Interest:                  { kind: 'accessor',  access: ['set'] },         // building-property-handler.ts:188 <- template-groups.ts:253
  JoinChannel:               { kind: 'function',  arity: 2 },                // src/server/session/chat-handler.ts:137
  KeepAlive:                 { kind: 'procedure', arity: 0 },                // src/server/spo_session.ts:2026
  Logoff:                    { kind: 'accessor',  access: ['get'] },         // src/server/spo_session.ts:2895
  Logon:                     { kind: 'function',  arity: 2 },                // src/server/session/login-handler.ts:381
  LogServerOn:               { kind: 'function',  arity: 1 },                // src/server/spo_session.ts:1068
  MailAccount:               { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts:407
  MailAddr:                  { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts:789
  MailPort:                  { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts:789
  Maintenance:               { kind: 'accessor',  access: ['set'] },         // building-property-handler.ts:188 <- template-groups.ts:175
  MsgCompositionChanged:     { kind: 'procedure', arity: 1 },                // src/server/session/chat-handler.ts:195
  Name:                      { kind: 'accessor',  access: ['set'] },         // src/server/session/building-management-handler.ts:294
  NewCompany:                { kind: 'function',  arity: 2 },                // src/server/session/login-handler.ts:641
  NewFacility:               { kind: 'function',  arity: 4 },                // src/server/session/building-templates-handler.ts:632
  NewMail:                   { kind: 'function',  arity: 3 },                // src/server/session/mail-handler.ts:110
  ObjectAt:                  { kind: 'function',  arity: 2 },                // src/server/spo_session.ts:761
  ObjectsInArea:             { kind: 'function',  arity: 4 },                // src/server/spo_session.ts:1228
  OpenMessage:               { kind: 'function',  arity: 4 },                // src/server/session/mail-handler.ts:289
  PickEvent:                 { kind: 'function',  arity: 1 },                // src/server/session/login-handler.ts:547
  Post:                      { kind: 'function',  arity: 2 },                // src/server/session/mail-handler.ts:148
  RDOAcceptCloning:          { kind: 'accessor',  access: ['get', 'set'] },  // src/server/session/building-management-handler.ts:114
  RDOAutoProduce:            { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts:194,223
  RDOBanMinister:            { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts:194,223
  RDOCacncelTransc:          { kind: 'procedure', arity: 0 },                // src/server/session/building-property-handler.ts:194,223
  RDOCancelMovie:            { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts:194,223
  RDOCancelResearch:         { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts:194,223
  RDOCanJoinNewWorld:        { kind: 'function',  arity: 1 },                // DServer/DirectoryServer.pas:116; src/server/session/login-handler.ts (checkWorldLimit)
  RDOCnntId:                 { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts:421
  RDOConnectInput:           { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDOConnectOutput:          { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDOConnectToTycoon:        { kind: 'procedure', arity: 3 },                // src/server/session/building-property-handler.ts:194,223
  RDODelFacility:            { kind: 'function',  arity: 2 },                // src/server/session/building-management-handler.ts:345
  RDODisconnectFromTycoon:   { kind: 'procedure', arity: 3 },                // src/server/session/building-property-handler.ts:194,223
  RDODisconnectInput:        { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDODisconnectOutput:       { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDODowngrade:              { kind: 'procedure', arity: 0 },                // src/server/session/building-management-handler.ts:169
  RDOEndSession:             { kind: 'procedure', arity: 0 },                // DServer/DirectoryServer.pas:31; src/server/session/login-handler.ts:215
  RDOFavoritesDelItem:       { kind: 'function',  arity: 1 },                // src/server/session/favorites-handler.ts
  RDOFavoritesGetSubItems:   { kind: 'function',  arity: 1 },                // src/server/session/politics-handler.ts:369
  RDOFavoritesMoveItem:      { kind: 'function',  arity: 2 },                // Interface Server/InterfaceServer.pas:202; src/server/session/favorites-handler.ts
  RDOFavoritesNewItem:       { kind: 'function',  arity: 4 },                // src/server/session/favorites-handler.ts
  RDOFavoritesRenameItem:    { kind: 'function',  arity: 2 },                // src/server/session/favorites-handler.ts
  RDOGetInvDescEx:           { kind: 'function',  arity: 2 },                // src/server/session/research-handler.ts:131
  RDOGetInvPropsByLang:      { kind: 'function',  arity: 2 },                // src/server/session/research-handler.ts:120
  RDOGetWorkers:             { kind: 'function',  arity: 1 },                // Kernel/WorkCenterBlock.pas:139; src/server/session/building-details-handler.ts (readWorkerCounts)
  RDOLaunchMovie:            { kind: 'procedure', arity: 4 },                // src/server/session/building-property-handler.ts:194,223
  RDOLogonClient:            { kind: 'procedure', arity: 2 },                // Kernel/World.pas:412; src/server/spo_session.ts:997
  RDOLogonUser:              { kind: 'function',  arity: 2 },                // DServer/DirectoryServer.pas:92; src/server/session/login-handler.ts:203
  RDOMapSegaUser:            { kind: 'function',  arity: 1 },                // src/server/session/login-handler.ts:199
  // DServer/DirectoryServer.pas:143 — a 0-arg published FUNCTION, kept as accessor `get`
  // under rule 1: the verb follows the reference client, which emits `get RDOOpenSession`,
  // served by the Delphi get→CallMethod fallthrough (RDOObjectServer.pas:112-116).
  RDOOpenSession:            { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts:194
  RDOQueryKey:               { kind: 'function',  arity: 2 },                // src/server/session/login-handler.ts:243
  RDOQueueResearch:          { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDOReleaseMovie:           { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts:194,223
  RdoRepair:                 { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts:194,223
  RDOSearchKey:              { kind: 'function',  arity: 2 },                // DServer/DirectoryServer.pas:84; src/server/session/login-handler.ts:324
  RDOSelectWare:             { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDOSelSelected:            { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts:194,223
  RDOSetCompanyInputDemand:  { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDOSetCurrentKey:          { kind: 'function',  arity: 1 },                // DServer/DirectoryServer.pas:36; src/server/session/login-handler.ts:309
  RDOSetInputFluidPerc:      { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts:194,223
  RDOSetInputMaxPrice:       { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDOSetInputMinK:           { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDOSetInputOverPrice:      { kind: 'procedure', arity: 3 },                // src/server/session/building-property-handler.ts:194,223
  RDOSetInputSortMode:       { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDOSetLoanPerc:            { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts:194,223
  RDOSetMinistryBudget:      { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDOSetMinSalaryValue:      { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDOSetOutputPrice:         { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDOSetPrice:               { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDOSetProjectData:         { kind: 'procedure', arity: 3 },                // Kernel/TownPolitics.pas:45, Kernel/WorldPolitics.pas:260
  RDOSetPublicity:           { kind: 'procedure', arity: 2 },                // Kernel/TownPolitics.pas:41, Kernel/WorldPolitics.pas:257
  RDOSetRatingFrom:          { kind: 'procedure', arity: 3 },                // Kernel/TownPolitics.pas:40, Kernel/WorldPolitics.pas:256
  RDOSetRole:                { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts:194,223
  RDOSetSalaries:            { kind: 'procedure', arity: 3 },                // src/server/session/building-property-handler.ts:194,223
  RDOSetTaxValue:            { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDOSetTownTaxes:           { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDOSetTradeLevel:          { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts:194,223
  RDOSetWordsOfWisdom:       { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts:194,223
  RDOSitMayor:               { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDOSitMinister:            { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDOStartUpgrades:          { kind: 'procedure', arity: 1 },                // src/server/session/building-management-handler.ts:154
  RdoStopRepair:             { kind: 'procedure', arity: 1 },                // src/server/session/building-property-handler.ts:194,223
  RDOStopUpgrade:            { kind: 'procedure', arity: 0 },                // src/server/session/building-management-handler.ts:162
  RDOVote:                   { kind: 'procedure', arity: 2 },                // src/server/session/building-property-handler.ts:194,223
  RDOVoteOf:                 { kind: 'function',  arity: 1 },                // src/server/session/building-details-handler.ts:938
  RegisterEventsById:        { kind: 'function',  arity: 1 },                // src/server/session/login-handler.ts:437
  Rent:                      { kind: 'accessor',  access: ['set'] },         // building-property-handler.ts:188 <- template-groups.ts:174
  Save:                      { kind: 'function',  arity: 2 },                // src/server/session/mail-handler.ts:241
  SayThis:                   { kind: 'procedure', arity: 2 },                // src/server/session/chat-handler.ts:177
  SegmentsInArea:            { kind: 'function',  arity: 5 },                // src/server/spo_session.ts:1249
  ServerBusy:                { kind: 'accessor',  access: ['get'] },         // src/server/spo_session.ts:1931
  SetLanguage:               { kind: 'procedure', arity: 1 },                // src/server/session/login-handler.ts:468
  SetObject:                 { kind: 'function',  arity: 2 },                // src/server/spo_session.ts:1429
  SetPath:                   { kind: 'function',  arity: 1 },                // src/server/session/building-details-handler.ts:1234
  SetTycoonCookie:           { kind: 'procedure', arity: 3 },                // src/server/spo_session.ts:2719
  SetViewedArea:             { kind: 'procedure', arity: 4 },                // src/server/spo_session.ts:1336
  Stopped:                   { kind: 'accessor',  access: ['set'] },         // building-property-handler.ts:188 <- template-groups.ts:55
  SwitchFocusEx:             { kind: 'function',  arity: 3 },                // src/server/spo_session.ts:691
  Term:                      { kind: 'accessor',  access: ['set'] },         // building-property-handler.ts:188 <- template-groups.ts:254
  TycoonId:                  { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts:414
  UnfocusObject:             { kind: 'procedure', arity: 1 },                // src/server/spo_session.ts:734
  WipeCircuit:               { kind: 'function',  arity: 6 },                // src/server/session/road-handler.ts:405
  WorldName:                 { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts:789
  WorldSeason:               { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts:789
  WorldURL:                  { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts:789
  WorldXSize:                { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts:789
  WorldYSize:                { kind: 'accessor',  access: ['get'] },         // src/server/session/login-handler.ts:789
} as const satisfies Record<string, RdoMemberSpec>;

/** Every member name the catalogue knows. */
export type RdoMemberName = keyof typeof RDO_MEMBERS;

/** True when `name` has a catalogued emission form. */
export function isCataloguedRdoMember(name: string): name is RdoMemberName {
  return Object.prototype.hasOwnProperty.call(RDO_MEMBERS, name);
}
