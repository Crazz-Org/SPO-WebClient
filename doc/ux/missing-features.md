# Fonctionnalités supposées par l'ergonomie — état dans le WebClient, référence Voyager

Règle posée le 2026-08-23 : **toute fonctionnalité supposée par la refonte est vérifiée dans le
WebClient** ; si elle n'existe pas, on regarde si le client Voyager l'offrait (`../SPO-Original`,
cité `File.pas:Ligne`) — auquel cas elle est à implémenter et listée ici. Ce fichier est la liste
de travail du portage ; il complète [audit.md](audit.md) (défauts de l'existant) et
[brief.md](brief.md) (objectifs).

Légende : ✅ existe · 🟡 partiel · ❌ manquant · **V** = Voyager l'avait (référence citée) ·
**—** = Voyager ne l'avait pas non plus (proposition nouvelle, à décider).

---

## 1. Carte et navigation

| # | Fonction supposée | WebClient | Voyager | À implémenter |
|---|---|---|---|---|
| N1 | **Vue « Carte » de données** (bâtiments par classe, mes bâtiments, déficitaires en rouge, brouillard sur l'inexploré, rectangle de vue, clic = sauter, zoom propre) | 🟡 **Surface « Map » (Carte-1, PR #67)** — `components/map/MapSurface` dans la feuille (M, tuile Map, triangle mobile) : terrain (colormap partagée `ui/minimap-colormap.ts`), **tous les bâtiments chargés** (miens en or, déficitaires en rouge — bit `alert` du serveur —, autres atténués), rectangle de vue, clic = sauter, molette/boutons = zoom 1–8× autour du curseur, glisser = déplacer. Pas de couleur par classe ni de brouillard (l'inexploré n'est pas suivi côté client). Le losange ancré reste (menu Plus › Docked minimap) | **V** `Map.pas:3512-3626` (couleur par classe `GetBuildingColor`, `cLoosingColor` rouge, `fSeen` → brouillard), `IsometricMap.pas:438-451` (clic → `MoveTo`), `FiveIsometricMap.pas:12,44-62` (zoom 1–100 %) | Dessiner bâtiments / mes bâtiments / déficitaires / brouillard sur la minicarte ; zoom molette sur la minicarte ; feuille « Carte » desktop + mobile |
| N2 | **Retour / Suivant** (historique de positions) | ✅ **fait (Carte-1, PR #67)** — `store/map-store.ts` : 100 positions, seuil 8 tuiles, nourri par `useCameraHistory` (lecture caméra 1 s) et par chaque saut ; boutons Back / Next dans la surface Map | **V** `MapIsoView.pas:1009-1036` (100 entrées, seuil selon le zoom), boutons `btBack`/`btNext` | Pile de positions dans le renderer/store + 2 boutons dans la feuille Carte |
| N3 | **Aller à l'hôtel de ville le plus proche** | ✅ **fait sans RDO (Carte-1, PR #67)** — bouton « Nearest Town Hall » de la surface Map : villes de la page annuaire (déjà lue) triées par distance à la caméra | **V** `MapIsoView.pas:978-1007` (`GetNearestTownHall(x,y)` puis `MoveAndSelect`) | **Sans nouveau RDO** : la liste des villes (`search-menu-service.ts`, `TownInfo.x/y`) + tri par distance côté client. Le membre RDO d'origine reste à vérifier avec `delphi-archaeologist` si on veut la parité exacte |
| N4 | **Favoris de position** (ajouter / renommer / supprimer / aller) | 🟡 **Carte-2 (PR #68)** : section « Bookmarks » de la surface Map — ajouter la vue courante (Prompt du nom), aller, renommer, supprimer ; **stockage local** (`localStorage`, par monde et par joueur, 50 max, `store/map-store.ts`). L'arbre RDO des favoris reste lu en lecture seule (« My Facilities ») ; l'écriture côté serveur est **instruite** : quatre membres `RDOFavorites*` sur le ClientView (pas les cookies LINKS) — ticket **OB-33** sur [le kanban](https://github.com/orgs/Crazz-Org/projects/1) ([workflow](../kanban-workflow.md)), hors UI | **V** `MapIsoView.pas:683-716` (LINKS en cookies serveur), `:882-924` (ADD), `:1064-1076` (aller) | Ajout / suppression / renommage ; décider du stockage (RDO favoris — membre d'écriture à cataloguer via `delphi-archaeologist` — ou local) |
| N5 | **Aller à des coordonnées** (palette « x,y », coordonnées cliquables dans le chat) | 🟡 **Palette : fait (T7, PR #64)** — « x,y » / « x y » → `Go to (x, y)` via `onNavigateToBuilding` ; palette atteignable sur mobile (PR #70, pastille de recherche) ; **pas** encore de lien dans le chat | **V** URL `MoveTo`/`Select x,y` (`MapIsoHandler.pas:240-254`), liens dans le chat (`ChatHandler.pas:96`) | Palette : saisie `x,y` ; chat : linkification des coordonnées |
| N6 | **Déplacement** : glisser au clic gauche, bords d'écran, flèches | ✅ **fait (lot d, PR #78)** — glisser **gauche** = pan partout sauf les trois modes où le glisser dessine (route, zonage, démolition) ; le clic gauche agit **au relâchement**, seuil Manhattan 8 px = `cMinDrag`, aligné aussi sur le clic droit ; **flèches** = pan continu (demi-écran/s, diagonales, boucle rAF — pas la répétition OS), gardes champ actif / IME / rôles ARIA, actif aussi en placement. **Défilement au bord d'écran : écarté** — Voyager était plein écran (`VoyagerWindow.pas:684-771`) ; en navigateur fenêtré la souris **sort** de la fenêtre et nos bords portent le HUD | **V** clic au relâchement + cMinDrag=8 (`GameControl.pas:533-597`), bords (`VoyagerWindow.pas:684-771`) ; flèches **commentées** (`VoyagerWindow.pas:657-667`) → ajout assumé, pas une parité | — |
| N7 | **Rotation de la vue sur desktop** | ✅ **fait (lot d, PR #78)** — deux boutons RotateCcw/RotateCw dans le groupe carte du RightRail (« Rotate view (Q) » / « Rotate view (W) ») ; Q = anti-horaire, W = horaire dans `useKeyboardShortcuts` (E est pris par Empire — la paire Q/E du handoff était morte-née) ; la touche Q a **quitté le renderer** (un propriétaire par touche) ; mobile : « Rotate view » dans More › Map Controls, le geste deux doigts (accroche 90°, `touch-handler-2d.ts`) reste le chemin rapide ; `key-binding-registry.ts` **supprimé** — décision inverse du handoff §4.3 : `SHORTCUTS` est l'unique table, le rebind persistant était un besoin hypothétique et se reconstruira au-dessus de `SHORTCUTS` s'il devient réel | **V** 2 boutons rotate (`FiveControl.pas:665-693`) | — |
| N8 | **Zoom** | ✅ 4 niveaux, +/−, molette zoom-vers-curseur (`:5176-5204`), pinch | **V** 4 niveaux (`GameTypes.pas:24`), pas de molette | — |
| N9 | **« Voir sur la carte »** depuis l'inspecteur | ✅ **fait (T3)** — bouton « View on map » dans la barre de l'inspecteur ; avant : 🟡 recentrage implicite via `focusBuilding` ; **aucun bouton** explicite (`BuildingInspector.tsx:260-280` : Actualiser + Fermer) | **V** `MoveAndSelect` depuis les fiches (`ProdSheetForm.pas:761`) | Bouton dans le pied de la feuille |
| N10 | **Choisir sur la carte** depuis un dialogue (pick-on-map) | ✅ **fait (PR #80)** — bouton « Pick on map » au pied du picker fournisseur (toujours offert, pas seulement à vide) ; **un seul mode, deux origines** : le `connectMap` de l'inspecteur et le picker passent par le même `startConnectMode` ; le mode entre dans `use-mode-descriptor` (barre de mode desktop + `MobileModeBar` : « CONNECT · <sujet> · Click a building to connect », sortie **Cancel** / Échap) ; la **pile de surfaces se masque sans se détruire** pendant le mode (sur mobile la feuille couvrait la carte, et le mode était invisible — corrigé pour les deux origines) ; one-shot : succès, échec ou annulation → la pile revient telle quelle (le picker garde son contexte) ; le toast d'entrée est remplacé par la barre de mode | **V** `PICKONMAP` (`MapIsoHandler.pas:277-285`) | — |

## 2. Bâtiment et inspecteur

| # | Fonction supposée | WebClient | Voyager | À implémenter |
|---|---|---|---|---|
| B1 | Renommer | ✅ `BuildingInspector.tsx:328-332`, `set Name` catalogué | V | — |
| B2 | Bloc Inspect (« Storing », ventes, hints) poussé en continu | ✅ `map-parsers.ts:170,257-266`, push `RefreshObject` ~5 s, texte mis à jour à chaque push (`event-handler.ts:141`) ; **deux parseurs** (`RichDetails.tsx:124`, `QuickStats.tsx:123`) | V | Filtre + tri locaux sur le bloc ; fusionner les deux parseurs au portage |
| B3 | Onglets Approvisionnements / Produits : noms à l'ouverture de l'onglet, détail à l'ouverture de la ligne | ✅ déjà ainsi — 1 RDO (`GetInputNames`/`GetOutputNames`) à l'ouverture, puis `SetPath` + `GetPropertyList` + `GetSubObjectProps` ×connexions (max 20, 3 à la fois) à l'ouverture (`building-details-handler.ts:364,1264`) | V | **Ne rien ajouter** sur les lignes repliées ; filtre de noms local |
| B4 | Recherche fournisseur : Entrée lance, filtres conservés | ✅ **fait (T3)** — Entrée lance, filtres gardés en session, résultats dans l'ordre du serveur (coût livré ; tri qualité / distance au choix, #530), picker empilé sur le bâtiment ; avant : ❌ Entrée ne fait rien (`ConnectionPickerModal.tsx:124-131`), filtres réinitialisés à chaque ouverture (`:44-53`) | — | Entrée + mémoire des filtres (store) |
| B5 | Confirmation des actions destructives / coûteuses | ✅ **fait (socle-2 → PR #79)** — Dialog branché sur démolir, la dépense de construction (T1), la déconnexion fournisseur/client (T3), la pose de route (dépense : tuiles, coût, trésorerie après — T8 PR #66), la démolition de route (destructif, clic et zone — T8) et la **rétrogradation** (PR #79 : Dialog destructif dans `upgradeBuildingAction`, l'envoi ne part qu'à la confirmation — un niveau payé disparaît sans retour ; la même PR ressuscite le contrôle `UpgradeActions`, caché par erreur avec la valeur brute du même nom : les boutons Upgrade / Downgrade / Stop n'étaient rendus nulle part). ⚠ Reste à trancher : la **dépense d'amélioration** (START_UPGRADE) part toujours sans Dialog — la ligne « Upgrade Cost » est visible mais rien ne compare au cash ni ne confirme. ⚠ QA mobile (#79) : en feuille **demi-hauteur**, la couche résumé intercepte les pointeurs — les contrôles du panneau sont incliquables tant que la feuille n'est pas en plein écran (bug générique de la feuille, ticket séparé) ; les boutons du Dialog socle-2 font ~36 px de haut sur mobile (objectif 44) | — | Décider : Dialog de dépense sur START_UPGRADE (coût × niveaux, trésorerie après), comme la construction ; corriger l'interception de la feuille demi-hauteur et les 44 px du Dialog |
| B6 | SaveIndicator sur toute écriture | ✅ **fait (socle-2 + PR #73)** — échec lisible et annoncé partout ; `PropertyInputs`, `WorkforceTable`, `TaxesTab`, `MinistriesTab`, `JobsTab`, `TownsTab` (déjà), puis **curseurs fournisseurs** (Prix max, Qualité min, Prix produit), **connexions** (brancher / débrancher, un indicateur par porte, clé `<membre>:<fluide>` — `handlers/connection-pending-key.ts`) et **renommage** (`RENAME_PENDING_KEY`, l'échec porte la raison du serveur). L'état « en attente de relecture » est la phrase `confirmedMessage` des taxes, le seul membre que le serveur ne confirme pas (OB-29) | — | — |
| B7 | Diagnostic en tête (« Production arrêtée — il manque du coton ») | ✅ **fait (T2)** — `facility-diagnosis.ts` : les états « Stopped … » de la section 1 (`Kernel/Kernel.pas:5017-5024`) et les 25 phrases de hints (`Kernel/SimHints.pas:279-516`) → sévérité + phrase + action (ouvrir la section fournisseurs / services / personnel / recherche) ; inconnu = texte gardé, sévérité lue sur le préfixe ; bandeau dans l'inspecteur et l'aperçu ; avant : 🟡 `hintsText` brut | V (texte brut aussi) | — |
| B8 | Bouton « Trouver un fournisseur » depuis une porte vide | ✅ Hire → `ConnectionPickerModal` | V | — (le placer aussi dans le diagnostic) |

## 3. HUD et modes

| # | Fonction supposée | WebClient | Voyager | À implémenter |
|---|---|---|---|---|
| H1 | Indicateur de mode persistant (placement / route / zone) sur desktop **et mobile** | ✅ **fait (socle-4b ; mobile PR #72)** — barre de mode de la CommandBar ; sur mobile `MobileModeBar` remplace la rangée de tuiles pour route / zone (le placement garde `PlacementHUD`), les deux lisant `use-mode-descriptor.ts` ; avant : ❌ rien (`isPlacingBuilding` lu par `MobileShell` seulement) ; route/zone = bouton surligné | — | Barre de mode (planche HUD) |
| H2 | Confirmer / annuler la pose sur desktop | ✅ **fait (socle-4b + T1)** — barre de mode + Dialog de dépense au clic carte (opt-out de session) ; avant : ❌ clic gauche pose, clic droit annule, Échap — non affiché | — | Boutons dans la barre de mode ; le mobile a déjà `PlacementHUD` |
| H3 | **« Tourner » en placement** | ✅ **corrigé (lot d, PR #78)** — l'aria-label de `PlacementHUD` disait « Rotate building » alors que le bouton tourne la **carte** ; il dit désormais « Rotate view » ; **aucune orientation de bâtiment** n'existe | **V** idem : pas d'orientation de bâtiment | — |
| H4 | Coût vs trésorerie avant la pose, trésorerie après | ✅ **fait (socle-4b + T1)** — barre de mode, carte dépliée (« Cash after »), Placer désactivé si insuffisant ; avant : ❌ coût affiché (`BuildMenu.tsx:115`), jamais comparé au cash ; aucune désactivation | — | Comparaison locale (`tycoonStats.cash`) dans la barre de mode et le dialogue |
| H5 | Liste des raccourcis à jour | ✅ **fait (socle-4a)** — table unique `SHORTCUTS`, M = carte, L = courrier, P = gouvernement, W = tourner la vue, modificateurs laissés au navigateur ; avant : 🟡 `SettingsDialog.tsx:136-145` (B E M R ⌘K Esc D) ; Q, +/−, 1–5 absents ; collision M (mail vs minimap dans le registre mort) | — | Générer la liste depuis le registre ; réattribuer M = Carte, L = Courrier |
| H6 | Pastille d'état avec alertes cliquables (bâtiments en difficulté) | ✅ **fait (PR #80, zéro RDO)** — « My facilities » regroupe les favoris en trois sections honnêtes : **Losing money** (bit `alert` serveur d'un bâtiment chargé — le rouge minimap Voyager), **Status unknown** (zone jamais chargée : l'état n'est PAS connu, jamais supposé sain — « Not visited yet — tap to check. »), **Operating** ; tri alphabétique par section, clic = `onNavigateToBuilding`. Entrées : le tag **Debt** de la StatusPill devient un bouton (« View facilities losing money ») ; sur mobile la barre d'info affiche un tag Debt tapable dès `failureLevel ≥ 1` (1 interaction). Le compteur ne compte que les alertes confirmées | — | — |

## 4. Politique et points d'entrée

| # | Fonction supposée | WebClient | Voyager | À implémenter |
|---|---|---|---|---|
| P1 | Politique depuis le HUD / la feuille (desktop **et** mobile) | ✅ **fait (socle-3b/3c)** — surface Government + civique dans la feuille, tuile P ; avant : ❌ `rightPanel: 'politics'` déclaré (`ui-store.ts:12`) mais **rendu nulle part** : feuille vide sur mobile (`MobileShell.tsx:47-73`), panneau sans contenu sur desktop (`GameScreen.tsx:63-74`) ; la politique n'existe que dans la **modale civique** | V (fiches civiques) | Brancher le contenu civique dans la feuille universelle |
| P2 | Ouvrir l'hôtel de ville de **ma** ville / les taxes directement | ✅ **fait (socle-3b, T5 PR #65)** — Government › villes → hôtel de ville via `onNavigateToBuilding` ; bouton « Taxes » par ville → hôtel de ville ouvert sur Administration (taxes) ; avant : ❌ seul `onOpenCapitol` ; hôtel de ville = clic sur la carte ou Recherche › Villes (recentre sans ouvrir) | **V** GO TOWN HALL (`MapIsoView.pas:978`) | N3 + ouverture de l'inspecteur à l'arrivée |

## 5. Courrier, recherche, palette

| # | Fonction supposée | WebClient | Voyager | À implémenter |
|---|---|---|---|---|
| M1 | Répondre pré-remplit le destinataire | ✅ **fait (T6)** — formulaire piloté par le store ; avant : ❌ **bug** `MailPanel.tsx:70-72` | V | — |
| M2 | Suppression avec confirmation + refetch | ✅ **fait (T6)** — Dialog destructif, ligne retirée localement à la réponse (aucune requête en plus) ; avant : ❌ `client-bridge.ts:646-653` | — | — |
| M3 | Échec d'envoi visible, brouillon conservé | ✅ **fait (T6)** — brouillon gardé jusqu'à la réponse, Envoyer verrouillé pendant, toast d'échec ; avant : ❌ branche `success: false` vide | — | — |
| S1 | **Recherche de bâtiment par nom** | 🟡 **Recherche locale faite (T7, PR #64)** : la palette filtre « Mes bâtiments » (favoris, lus une fois à la première ouverture) et les villes (page annuaire déjà tenue par Recherche/Gouvernement) ; les commandes « Find Building / Find Player » qui ne menaient nulle part sont retirées (une entrée « Search the directory » reste). Pas de membre RDO pour une recherche générale | — (Voyager : pas de recherche générale ; `FindSuppliers`/`FindClients` filtrent par nom mais par fluide et autour d'un bâtiment) | Décider : recherche **locale** dans « Mes bâtiments » (favoris déjà lus) + villes + joueurs ; pas de nouveau RDO tant que non justifié |
| S2 | Palette sur mobile | ✅ **fait (socle-4c)** — entrée du menu mobile ; desktop : ligne recherche de la CommandBar ; avant : ❌ montée mais sans déclencheur tactile (`useKeyboardShortcuts.ts:25-29` seulement) | — | Champ de recherche de la barre de commande (planche HUD / Mobile) |

## 6. Empire

| # | Fonction supposée | WebClient | Voyager | À implémenter |
|---|---|---|---|---|
| E1 | Profil / auto-connexions sur mobile | ✅ **fait (socle-3b + 4c)** — surface dans la feuille mobile + entrée Profil du menu ; avant : ❌ tous les appelants de `toggleLeftPanel('empire')` sont cachés < 768 px ; `MobileMenu` ne l'ouvre pas ; `LeftPanel.module.css:93-97` a pourtant un style mobile | V | Tuile « Empire » de la barre de commande → feuille |
| E2 | Épingler la feuille (rester ouverte en cliquant d'autres bâtiments) | ✅ **fait (socle-3b)** — bouton Épingler, le bâtiment s'empile ; avant : 🟡 implicite : `noScrim` sur le panneau bâtiment seulement (`GameScreen.tsx:114`) ; pas de contrôle, pas pour mail/recherche | — | Bouton « Épingler » ; pas de scrim sur la feuille en général |

---

## 7. Ce qui est confirmé présent (pas de travail)

Zoom (N8), renommer (B1), bloc Inspect poussé en continu (B2), régime de lecture des onglets
(B3), « Trouver un fournisseur » depuis une porte (B8), `SaveIndicator` sur les taxes et
ministères, `requestPrompt` pour les nominations, favoris lus, `PlacementHUD` mobile, minicarte
plein écran mobile.

## 8. Ce que l'ergonomie retire de ses promesses

- **Rotation de bâtiment** : n'existe nulle part — les boutons disent « Tourner la vue ».
- **Catégories de produits** : n'existent nulle part (`Kernel/Kernel.pas:743-798`) — tri par nom seulement.
- **Données sur une ligne repliée** des onglets : jamais (budget RDO).

## 9. Audit de branchement des maquettes — chaque élément visuel → une fonction

Règle (2026-08-23) : **aucun élément visuel sans fonction**. Pour chaque contrôle des canevas
Système et Flux : la fonction du WebClient qui le porte ; sinon la référence Voyager et l'entrée
ci-dessus ; sinon le visuel a été **revu** (colonne « Décision »). « Client » = pur état d'interface,
aucune dépendance serveur.

### 9.1 Pastille d'état et barre de commande (planches HUD, Mobile, Flux)

| Élément | Branché sur | Décision |
|---|---|---|
| Monde, date, cash, revenu/h, sparkline, rang, nom, rôle, compagnie, 14/50 | `InfoWidget` : `tycoonStats`, `lastStatsUpdate` ✅ | — |
| Clic sur l'argent → Finances | `ProfilePanel` onglet `profitloss` ✅ | — |
| Clic sur le nom → Profil | `toggleLeftPanel('empire')` ✅ (desktop) ; mobile → E1 | — |
| « 2 alertes » (bâtiments en difficulté) | ❌ aucune source sans lectures par bâtiment ; Voyager ne l'avait que sur la minicarte (déficitaires en rouge, `Map.pas:3588`) | **Revu** : segment retiré ; remplacé par « Dette » affiché seulement si `failureLevel ≥ 1` (donnée reçue) ; la liste des déficitaires reste **N1** (minicarte) |
| Recherche / palette (Ctrl K) | `CommandPalette` ✅ ; bâtiments : recherche locale ✅ (T7) | **Revu** : placeholder « mes bâtiments » (recherche locale dans les favoris déjà lus), joueurs et villes (routes existantes) ; coordonnées → N5 |
| Tuile Construire (B) | `openModal('buildMenu')` ✅ | — |
| Tuile Carte (M) | minicarte ✅ ; contenu de la vue → N1–N4 | reprend la touche M (courrier passe à L) → H5 |
| Tuile Empire (E) | `toggleLeftPanel('empire')` ✅ ; mobile → E1 | — |
| Tuile Politique (P) | `onOpenCapitol` ✅ partiel ; hôtel de ville → P1, P2, N3 | — |
| Tuile Courrier (L) + badge | `toggleRightPanel('mail')` + `unreadCount` ✅ | — |
| « Plus » : Routes, Zones, Calques, Réglages, Changer de serveur | `onBuildRoad`/`onDemolishRoad`, `zonePicker` (charge publique), `overlays`, `settings`, `onSwitchServer` ✅ | **Revu** : « Journal » retiré (aucun journal d'événements n'existe ; pas dans Voyager non plus) |
| Barre de mode : nom, coût | `facility.cost` ✅ | — |
| Barre de mode : « après : trésorerie » | calcul local `cash − cost` ✅ (client) | H4 pour le blocage si insuffisant |
| Barre de mode : « Tourner la vue » (R) | `rotateCW` ✅ (tourne la **carte**) | **Revu** : libellé « la vue » ; aucune rotation de bâtiment (H3) |
| Barre de mode : Terminer (Échap) | `setupEscapeHandler` ✅ | H1 pour l'indicateur persistant |
| Barre de mode route : « 14 tuiles · $ 28 000 » | coût route inconnu côté client avant la réponse serveur (`road-handler.ts:206` = erreur de fonds seulement) | **Revu** : coût retiré, « 14 tuiles » seulement ; aperçu de coût = **H7** (à instruire : Voyager l'affichait-il ? `[UNKNOWN]`) |
| Zoom +/− | `onZoomIn/Out` ✅ | — |
| Pastille chat « Général · 14 » | `ChatStrip` (canal, en ligne) ✅ | — |

### 9.2 Feuille universelle (inspecteur)

| Élément | Branché sur | Décision |
|---|---|---|
| Jetons de pile (Usine textile › Approvisionnements › …) | client (store de pile à créer, pas de serveur) | E2 / pile de surfaces |
| Épingler | client | E2 (nouveau) |
| Fermer | ✅ | — |
| Identité : nom, compagnie, ville, niveau | `BuildingDetails` + bloc Inspect ✅ | — |
| Tag d'état (À l'arrêt / En production) + diagnostic | `hintsText` / `detailsText` ✅ brut | B7 (parseur de hints → sévérité + action) |
| « Trouver un fournisseur » (diagnostic et porte vide) | `onSearchConnections` → `ConnectionPickerModal` ✅ | — |
| « Choisir sur la carte » | `connectMap` ✅ + « Pick on map » du picker (N10, PR #80 — même mode) | — |
| Onglets de sections | `BuildingDetailsTab` (CLASSES.BIN) ✅ | libellés à mapper (audit §5) |
| Filtre des approvisionnements | client (noms déjà reçus) ✅ | — |
| Ligne repliée = nom ; ouverture charge valeurs / fournisseurs | `useGateConnections` ✅ (même régime) | — |
| Curseurs Prix max / Qualité min | écritures `MaxPrice` / `minK` ✅ | B6 (SaveIndicator) |
| Ligne fournisseur : nom, compagnie, prix, qualité, distance | `BuildingConnectionData` ✅ ; distance = calcul local `x,y` ✅ | — |
| Déconnecter (×) → confirmation | `onDisconnectConnection` ✅ ; confirmation → B5 | — |
| « Ajouter un fournisseur » | même picker ✅ | — |
| Pied : « Actualisé il y a » | `lastUpdate` ✅ | — |
| Pied : Renommer | ✅ B1 | — |
| Pied : Voir sur la carte | `centerOn` ✅ (implicite) | N9 (bouton) |

### 9.3 Construire (T1)

| Élément | Branché sur | Décision |
|---|---|---|
| Catégories (nom, compte) | `BuildingCategory.kindName` ✅ ; compte = longueur de la liste reçue | — |
| Filtre par nom | client ✅ | — |
| Cache de session du menu | client | **nouveau** (réduit les requêtes) |
| Liste : nom, coût, empreinte, zone | `BuildingInfo.name/cost/xsize/ysize/zoneRequirement` ✅ | — |
| Cadenas + raison | `available` + `category.tycoonLevel` ✅ | — |
| Détail : description | `BuildingInfo.description` ✅ | — |
| « 120 emplois », « Entrées : coton, chimie » | ❌ absents de `BuildingInfo` ; Voyager : `[UNKNOWN]` | **Revu** : retirés |
| « Placer sur la carte » | `onPlaceBuilding(facilityClass, visualClassId)` ✅ | — |
| Fantôme valide / invalide | `placementValid` ✅ | — |
| Calque Zones annoncé | `enableCityZonesForPlacement` ✅ | visuel = annonce |
| Dialogue de confirmation + « ne plus demander » | `requestConfirm` ✅ + préférence client | B5 |
| Toast « Construit — Voir » | `showNotification` ✅ + `focusBuilding` ✅ | — |
| Mode conservé après la pose | comportement actuel ✅ | H1 (le rendre visible) |
| Mobile : Poser / Annuler / Tourner la vue | `PlacementHUD` ✅ | — |

### 9.4 Raccorder un fournisseur (T3)

| Élément | Branché sur | Décision |
|---|---|---|
| Aperçu au clic : nom, propriétaire, état, revenu, métriques | `StatusOverlay` (bloc Inspect) ✅ | — |
| « Inspecter » / « Aller » | `openInspectorForFocused` / `centerOn` ✅ | — |
| Picker : champ + Entrée | champ ✅ ; Entrée ❌ → B4 | — |
| Jetons Ville, Max | filtres `town`, `maxResults` ✅ | — |
| Jetons de rôle | 5 rôles du bitmask : Producteur, Distributeur, Importateur, Acheteur, Exportateur ✅ | **Revu** : libellés corrigés (j'avais « Usines / Entrepôts / Fermes ») |
| Résultats : nom, compagnie, ville, prix, qualité | `ConnectionSearchResult` ✅ | — |
| Distance, tri par distance | calcul local depuis `x,y` ✅ | — |
| Sélection multiple + « Connecter » | `onConnectionConnect` (liste `{x,y}`) ✅ | — |
| Vide : « élargir les rôles » / « choisir sur la carte » | client / « Pick on map » ✅ (N10, PR #80 — offert en permanence, pas seulement à vide) | — |
| SaveIndicator « Connecté » | composant ✅ ; brancher sur la connexion → B6 | — |
| Diagnostic qui change après connexion | bloc Inspect poussé ✅ (le serveur décide) | — |

### 9.5 Vue Carte

| Élément | Branché sur | Décision |
|---|---|---|
| Minicarte terrain + rectangle de vue + clic = sauter | ✅ | — |
| Bâtiments / mes bâtiments / déficitaires / brouillard | ❌ → N1 (Voyager ✅) | gardé, listé |
| Retour / Suivant | ❌ → N2 (Voyager ✅) | gardé, listé |
| Hôtel de ville le plus proche | ❌ → N3 (Voyager ✅, faisable sans RDO) | gardé, listé |
| Favoris (liste) / ajouter / supprimer | lecture ✅ ; écriture ❌ → N4 (Voyager ✅) | gardé, listé |
| Calques | ✅ | — |

### 9.6 Nouvelles entrées issues de l'audit

| # | Fonction | WebClient | Voyager | À faire |
|---|---|---|---|---|
| H7 | Aperçu du coût d'une route avant le tracé | 🟡 **T8 (PR #66)** : barre de mode « $2,000,000 per tile », Dialog de dépense à la relâche (tuiles, coût, trésorerie après) ; l'infobulle canvas du renderer (tuiles + coût) existait déjà. Constante partagée `src/shared/road-cost.ts` = celle de la passerelle (`server/session/road-handler.ts`), longueur Manhattan (un escalier = une requête par tuile). | **V** coût calculé au survol et **envoyé** comme argument de `CreateCircuitSeg` (`Voyager/Components/MapIsoView/Map.pas:6961-6976`, `URLHandlers/MapIsoHandler.pas:1085-1104`), 2 M / tuile, 4 M sur l'eau, route existante gratuite (`Map.pas:55-59, 6615-6627`), vert/rouge selon la trésorerie (`Map.pas:4891-4905`) ; le serveur facture ce qu'il reçoit (`Kernel/World.pas:4252-4309`), aucun membre RDO de devis. **Écart résorbé (#99)** : la formule de Voyager est portée dans `src/shared/road-cost.ts` — chaque tuile du chemin en escalier, tuile de départ comprise, gratuite si elle porte déjà une route, 4 M sur l'eau sans béton, 2 M sinon ; le renderer atteste les faits par tuile (terrain, routes, béton) et la passerelle tarife à partir d'eux, puis répartit `cost div SegmentCount` sur les segments (`MapIsoHandler.pas:1100`). Reste non modélisé : `IsVoidSquare` (`Map.pas:2605`, aucune couche de parcelle réservée côté WebClient) et le quota `CanBuildRoad` après l'an 50 (`World.pas:4270-4272`, échelle `[UNKNOWN]`) | OB-34 |
| H8 | Cache de session du menu de construction | ✅ **fait (T1)** — catégories + liste par catégorie gardées pour la session | n/a | — |

---

*Sources : agent de vérification sur le code du WebClient (2026-08-23) ; archéologie Voyager
`Voyager.1/Components/MapIsoView/*`, `VoyagerWindow.pas`, `URLHandlers/MapIsoHandler.pas`,
`Kernel/Kernel.pas`, `StdBlocks/StdFluids.pas`, `Class Storage/NativeClassStorage.pas`.*
