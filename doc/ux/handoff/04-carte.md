# Handoff — la surface « Map » (Carte-1 PR #67, Carte-2 PR #68)

Le brief demandait un bouton **Carte** : une vue lisible du monde pour se déplacer sur une
grande surface, ce que le losange ancré (terrain seul, 3 tailles) ne permettait pas. La
recherche sur Voyager (`Map.pas:3512-3626`, `MapIsoView.pas:978-1036`) a fixé la cible :
bâtiments colorés, déficitaires en rouge, clic = sauter, Retour / Suivant, hôtel de ville le
plus proche, favoris de position.

## Ce qui est porté (Carte-1)

| Élément | Implémentation | Source de données |
|---|---|---|
| Surface `map` de la feuille | `components/map/MapSurface.tsx` ; `M`, tuile **Map** de la CommandBar, triangle mobile (`MinimapToggleButton`) → `toggleMapSurface` | — |
| Terrain | colormap partagée `ui/minimap-colormap.ts` (extraite de `MinimapUI`, qui l'utilise aussi) | `getTerrainPixelData` / atlas du renderer |
| Bâtiments, routes, béton, sélection | chaîne de priorité portée de `TWorldMap.GetColor` (`Map.pas:3855-3918`, issue #601) : tuile sélectionnée en blanc, bâtiment **mien** déficitaire en rouge (`MapBuilding.alert`), sinon couleur de **classe/zone** (`ZONE_TYPES`) — atténuée pour une autre compagnie —, puis routes, puis béton, sinon le terrain seul | `renderer.getAllBuildings()` / `getRoadTileCoords()` / `getConcreteTileCoords()` / `getSelectedBuilding()`, zone via `facility-dimensions-cache` — rien n'est demandé |
| Rectangle de vue | ce que la vue iso montre | `getVisibleTileBounds` |
| Clic = sauter | `source.centerOn(x, y)` + entrée d'historique | — |
| Zoom | molette (autour du curseur) et boutons, 1–8 × ; glisser = déplacer quand zoomé ; Reset | local |
| Back / Next | `store/map-store.ts` : 100 positions (Voyager), seuil 8 tuiles, nourri par `hooks/useCameraHistory` (1 s) et par chaque saut | caméra |
| Nearest Town Hall | utilisable avant même le chargement de l'annuaire (le clic demande la liste s'il le faut) ; distance de Manhattan à la caméra sur les villes de l'annuaire, approximation locale de `TWorld.NearestTown` (`Kernel/World.pas:5905-5933`) ; arrivée via `onNavigateToBuilding` (le `MoveAndSelect` du client — centre et sélectionne) | `@/shared/nearest-town`, `search-store.townsData` |
| Légende + coordonnées | « Selected / Losing money / Roads / Concrete » ; tuile survolée ou centre de la vue | — |

Le losange ancré reste disponible (menu **Plus › Docked minimap**). `MinimapRendererAPI` est le
contrat commun (déplacé dans `minimap-colormap.ts`, ré-exporté par `minimap-ui.ts`).

## Écarts voulus / hors lot

- Pas de **brouillard** : le client ne suit pas « ce qui a été vu » ; la carte montre le terrain
  entier et les bâtiments déjà chargés (l'inexploré est donc vide, pas gris).
- **Couleur par classe/zone : portée (issue #601)**, `Map.pas:3855-3918` (`GetBuildingColor`
  `:7564-7584`, `DimColor` `:3818-3828`) — la table `ZONE_TYPES` du client fournit les huit
  couleurs de zone ; deux départs assumés : `HideColor` n'est pas lu (CLASSES.BIN n'en porte
  aucune entrée), et les zones 8/9 (Civics/Offices), hors du tableau Delphi à huit entrées,
  prennent leur propre couleur `ZONE_TYPES` plutôt que de planter.
- **Favoris de position** (N4, Carte-2) : section « Bookmarks » sous la carte — « Bookmark this
  place » ouvre le PromptDialog (nom, défaut = coordonnées de la vue), chaque ligne = aller
  (bouton nommé `Go to <nom> (x, y)`), renommer (Prompt), supprimer. Stockage **serveur**
  (OB-33) : c'est l'arbre Favorites du joueur — la liste même que montre le panneau Empire —
  écrite par `RDOFavoritesNewItem` / `DelItem` / `RenameItem`
  (`Interface Server/InterfaceServer.pas:200-203`). Un favori posé ici se retrouve donc sur
  n'importe quel navigateur. L'ancienne liste locale (`localStorage`, clé
  `spo.bookmarks.<monde>.<joueur>`) est fusionnée dans l'arbre une seule fois, à la première
  lecture des favoris, et n'écrase jamais ce que le serveur tient déjà.
