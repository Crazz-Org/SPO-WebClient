# Refonte de l'ergonomie — cadrage pour Claude Design

Ce document définit **ce qu'il faut réunir, dans quel ordre, et avec quels skills** pour
produire la nouvelle interface du WebClient avec Claude Design (skill `/design`), puis la
porter dans le code sans casser ce que le projet protège (RDO, tests, couverture).

Il ne contient pas encore de maquette : c'est le plan de la refonte, pas la refonte.

---

## 1. Ce que Claude Design est — et n'est pas — dans ce projet

`/design` produit un **canevas multi-artboards** publié comme Artifact : chaque écran est un
fichier `.dc.html` (HTML + styles inline + un peu de logique), posé sur un canevas pan/zoom,
éditable à la souris (sélection, panneau de propriétés, texte inline) puis sauvegardé pour tout
le monde. Export PNG/PDF.

Trois propriétés qui dictent la méthode :

| Propriété | Conséquence pour nous |
|---|---|
| **Il part du code existant par défaut** (« step 0 » : tokens, composants, écrans les plus proches, valeurs exactes) | La qualité du résultat dépend de la qualité du *dossier d'entrée* qu'on lui fournit — c'est l'objet de ce plan |
| **Il ne choisit pas l'esthétique à notre place** : sans direction, il propose 2–4 directions low-fi et attend un choix | Il faut une étape « direction » explicite *avant* les maquettes hi-fi |
| **Ce n'est pas du code de prod** : `.dc.html` ≠ composants React/CSS Modules | Une phase de portage séparée, avec ses propres règles (tests, couverture, « pas de bouton mort ») |

Limites à connaître : pas de tokens de design-system liés côté éditeur, pas de co-édition
temps réel, polices Google uniquement, images < 70 Ko, pas d'emoji comme icônes (SVG inline).

---

## 2. L'état de départ (ce que Claude Design va lire)

**Le système actuel existe déjà et est cohérent** — la refonte est une refonte d'ergonomie,
pas une re-création d'identité visuelle. À fournir tel quel, Claude Design s'y alignera :

| Entrée | Où | Rôle pour Claude Design |
|---|---|---|
| Tokens | `src/client/styles/design-tokens.css` (palette « Corporate Empire » : fonds neutres sombres, vert `--primary`, or `--accent-gold`, échelle de texte 11→30 px, espacements 4→48 px, rayons, ombres, z-index, durées, **dimensions de layout HUD** : topbar 36 px, rail 48 px, panneau 560/360 px, minimap 200 px, bottomnav 56 px) | Valeurs exactes à reprendre — c'est la première chose que le skill cherche |
| Typo / reset / animations | `src/client/styles/typography.css`, `reset.css`, `animations.css` | Rythme vertical, transitions |
| Bibliothèque de composants | `src/client/components/common/` — Badge, ConfirmDialog, DataTable, GlassCard, IconButton, MiniBar, ProgressBar, PromptDialog, Skeleton, SliderInput, Sparkline, StatCard, TabBar, Toast, TrendIndicator | Anatomie et états à reproduire « au pixel » dans les artboards |
| Icônes | `lucide-react` (+ `components/icons/` RoadIcons, ZoneIcon) | Même jeu, même épaisseur de trait, en SVG inline dans les maquettes |
| Layouts | `src/client/layouts/GameScreen.tsx` (HUD « map-first » : InfoWidget, LeftRail, RightRail, ChatStrip, LeftPanel/RightPanel coulissants, modales, CommandPalette), `LoginScreen.tsx` | Le squelette à faire évoluer |
| Mobile | `src/client/components/mobile/` — MobileShell, BottomNav, BottomSheet (snap points, `useSheetGesture`), MobileInfoBar, PlacementHUD, ChatBanner ; breakpoints 768 / 1024 (`hooks/useResponsive.ts`) | Les trois tiers à couvrir : mobile / tablette / desktop |
| État d'interface | `src/client/store/ui-store.ts` — `RightPanelType` (building, mail, politics, search), `LeftPanelType` (empire, facilities, overlays), 11 `ModalType`, 5 `MobileTab` | **L'inventaire des surfaces** : ce sont les écrans à maquetter |
| Raccourcis | `hooks/useKeyboardShortcuts.ts` (B, E, M, R, D, Esc, Cmd+K) | Contraintes d'interaction à conserver ou redéfinir |

### Inventaire des écrans à couvrir (dérivé de `ui-store.ts` et `components/`)

1. **Connexion** — AuthStage → WorldStage → ZoneStage → CompanyStage, AuthErrorModal, ServerStartupScreen, MapLoadingScreen
2. **HUD de jeu** — InfoWidget, LeftRail, RightRail, ChatStrip, VersionBadge, OverlayMenu
3. **Panneaux droits** — BuildingInspector (header, menu, QuickStats, RichDetails, Research, Revenue, Workforce, Supplies, Products, Inputs), Mail, Search (+ TycoonProfileView), Transport, Politics (Overview, Population, Elections, Administration, Taxes, Jobs, Ministries, Residentials, Services, Towns, Votes, Campaign, RatingsRail, RulerCard)
4. **Panneaux gauches** — EmpireOverview, ProfilePanel, FacilityList, FinancialSummary, Map Overlays
5. **Modales** — BuildMenu, ZoneTypePicker, BuildingInspectorModal, SupplierSearchModal, CompanyCreationModal, ConnectionPickerModal, SettingsDialog, NewspaperModal, ChangelogModal, ServerSwitchOverlay, ConfirmDialog / PromptDialog (et leur empilement `modalBeneath`)
6. **Commande** — CommandPalette (Cmd+K)
7. **Mobile** — MobileShell, BottomNav (map, chat, build, favorites, more), BottomSheet, MobileBuildContent, MobileMenu, PlacementHUD, MinimapToggleButton

La refonte peut en regrouper, en fusionner ou en supprimer : l'inventaire sert à ne rien
oublier, pas à figer le découpage.

---

## 3. Ce qui manque aujourd'hui et qu'il faut produire AVANT de dessiner

Claude Design reproduit fidèlement ce qu'il lit ; il ne sait pas ce qui *gêne* les joueurs.
Ces cinq éléments sont l'entrée « métier » de la refonte — sans eux on obtient une jolie copie
de l'existant.

### 3.1 Le brief d'ergonomie (un fichier, `doc/ux/brief.md`)

- **Qui joue** : profils (nouveau joueur venu du client Delphi Voyager ; joueur mobile ; maire /
  ministre qui gouverne) et ce qu'ils font le plus souvent.
- **Les 8–12 tâches clés**, chacune avec le chemin actuel (nombre de clics / écrans) et le
  point de friction observé — ex. construire un bâtiment et le raccorder à ses fournisseurs ;
  régler les taxes d'une ville ; lire et répondre à un mail ; retrouver un bâtiment ;
  comprendre pourquoi une usine ne produit pas.
- **Ce qui ne bouge pas** : le canvas isométrique plein écran, la Command Palette, les
  raccourcis clavier (ou lesquels changent et pourquoi).
- **Les objectifs mesurables** : ex. « toute action courante à ≤ 2 interactions du HUD »,
  « aucun texte < 12 px », « cibles tactiles ≥ 44 px », « WCAG 2.1 AA ».
- **Desktop / tablette / mobile** : lesquels sont prioritaires, lequel sert de référence.

Skills : `design:user-research` (guide d'entretien et grille d'observation si on interroge
des joueurs), `design:research-synthesis` ou `product-management:synthesize-research` (pour
transformer retours Discord / mails / tickets en thèmes et priorités),
`product-management:write-spec` (pour formaliser le brief).

### 3.2 L'audit de l'existant (un fichier, `doc/ux/audit.md`)

Une passe critique sur l'interface actuelle, écran par écran, avec captures :

- `design:design-critique` — hiérarchie, cohérence, lisibilité, densité, états vides / erreur.
- `design:accessibility-review` et `web-accessibility` — contraste, focus, navigation clavier,
  ARIA, tailles de cible (mobile surtout).
- `design:design-system` — incohérences de nommage et valeurs codées en dur hors tokens
  (audit des `.module.css`), composants dupliqués.
- `mobile-ux-optimizer` — MobileShell / BottomNav / BottomSheet : viewport, safe area, gestes.

⚠ Règle du dépôt : **les captures d'écran se lisent dans un sous-agent**, jamais dans le
contexte principal. L'audit visuel se délègue (Playwright MCP + agent `general-purpose`),
le résultat revient en texte.

### 3.3 La direction visuelle (décision, pas document)

Même si la palette reste, la refonte doit trancher : densité (plus compacte / plus aérée),
place des panneaux (coulissants vs ancrés vs onglets), rôle de l'or, dark only ou thème clair
aussi. C'est exactement ce que Claude Design propose en **2–4 artboards low-fi** ; on choisit
une direction, on la nomme (« Option B » reste « Option B » jusqu'au bout) et on ne revient
pas dessus.

### 3.4 Les flux à maquetter (liste ordonnée, tirée du brief)

Un flux = une suite d'artboards (3–6 écrans) pour une tâche clé. Les flux se maquettent
**par ordre de priorité du brief**, un canevas par flux (ou par page du canevas), pas tout
d'un coup — le canevas republie le document entier à chaque sauvegarde et plafonne à 16 Mio.

### 3.5 Les données réelles pour les maquettes

Le skill refuse le *filler* : il faut des valeurs crédibles (noms de bâtiments, montants,
villes d'Helartia, listes de fournisseurs). Source : le mock server (`src/mock-server/`,
lecture seule) — pas de lorem ipsum, pas de chiffres inventés.

---

## 4. Le déroulé, phase par phase

| # | Phase | Livrable | Skills | Agents |
|---|---|---|---|---|
| 0 | **Cadrage** — brief + audit (§3.1, §3.2) | `doc/ux/brief.md`, `doc/ux/audit.md` | `design:user-research`, `design:research-synthesis`, `design:design-critique`, `design:accessibility-review`, `web-accessibility`, `design:design-system`, `mobile-ux-optimizer` | `general-purpose` pour les captures Playwright ; `Explore` pour l'inventaire des `.module.css` hors tokens |
| 1 | **Direction** — 2–4 artboards low-fi sur le HUD de jeu (l'écran qui porte tout) | Canevas « Direction » ; décision notée dans le brief | `design` | — |
| 2 | **Système** — feuille de composants refondue (une page « Composants » du canevas : boutons, champs, onglets, cartes, tableaux, toasts, feuille mobile), avec états hover / focus / disabled / vide / erreur | Canevas « Système » ; mise à jour de `design-tokens.css` si des tokens naissent | `design`, `design:design-system`, `dataviz` (Sparkline, RevenueGraph, StatCard) | — |
| 3 | **Flux** — un canevas par flux prioritaire, desktop + mobile côte à côte | Canevas par flux ; `design:ux-copy` pour les libellés, messages d'erreur, états vides | `design`, `design:ux-copy`, `design:design-critique` (revue à chaque flux) | — |
| 4 | **Handoff** — spec développeur par flux : tokens, composants, props, états, breakpoints, animations, cas limites | `doc/ux/handoff/<flux>.md` | `design:design-handoff` | — |
| 5 | **Portage** — implémentation React / CSS Modules, flux par flux, chaque flux = une PR | Code + tests | `react-best-practices`, `css-modules-vite`, `typescript`, `zustand-store-ts`, `mobile-ux-optimizer`, `web-accessibility`, `spo-testing`, `web-performance` (le HUD recouvre un canvas qui doit tenir son budget de frame — `web-games` si on touche le renderer) | `performance-analyzer` si le HUD alourdit la frame |
| 6 | **Vérification** — revue de code, a11y, E2E | PR gatée | `engineering:code-review` / `reviewing-code`, `design:accessibility-review`, `gate`, `e2e-test` (L3 smoke, pixels) | `security-reviewer` si un flux touche login / session |
| 7 | **Documentation** | `doc/ux/` tenu à jour, `src/client/CLAUDE.md` ajusté | `docs-codebase`, `claude-md-improver` | — |

Les phases 3 → 6 tournent **en boucle par flux** : on ne porte pas le second flux avant que
le premier soit fusionné. Cela garde chaque PR lisible et la couverture ≥ 93 % atteignable.

---

## 4bis. État au 2026-08-23

Phases 0 → 4 faites ([brief](ux/brief.md), [audit](ux/audit.md), canevas Direction / Système /
Flux, [handoff](ux/handoff/)). Phase 5 : socle-1 → 4 et flux T1, T3, T6, T2, T7, T5, T8, Carte-1/2, feuille flottante, barre mobile fusionnés (PR #55–#70 — tous les lots du plan), canevas alignés (#71), puis les travaux hors plan : barre de mode mobile (#72), SaveIndicator généralisé (#73), déplacement + rotation N6/N7 (#78 — pan au glisser gauche, flèches clavier, boutons de rotation, registre de touches supprimé), rétrogradation confirmée B5 (#79), bâtiments en difficulté H6 + pick-on-map N10 (#80), tickets RDO OB-33/OB-34 instruits (N4 serveur, H7 exact) et audit de clôture passé (brief §6bis) — le backlog hors plan est soldé, puis la tablette a rejoint le modèle mobile (lot g, #82 — décision du porteur) ; reste N5 chat ; suivi dans le brief §6bis ;
suivi des fonctions dans [missing-features.md](ux/missing-features.md) ; les canevas portent une
note « état d'implémentation » tenue à jour à chaque PR.

## 5. Les règles du dépôt que la refonte ne peut pas ignorer

- **Aucun bouton mort** — un élément d'interface n'est porté que si son action est câblée.
  Une maquette peut montrer un contrôle futur, mais il est marqué « hors lot » dans le handoff.
- **Le RDO n'est pas concerné** — la refonte ne touche ni `src/shared/rdo-*`, ni
  `src/server/`. Si un flux révèle qu'il manque une donnée serveur, c'est un ticket séparé,
  instruit avec `delphi-archaeologist`, pas un détour dans la PR d'UI.
- **Couverture ≥ 93 % sur les lignes nouvelles / modifiées** ; les composants ont leurs tests
  `.test.tsx` dans le même dossier (`spo-testing`).
- **CSS Modules, pas de CSS-in-JS ; tokens, pas de valeurs en dur** — si une maquette introduit
  une valeur qui n'existe pas, elle entre d'abord dans `design-tokens.css`.
- **Pas de nouvelle dépendance sans demande** — la refonte se fait avec React, lucide-react,
  Zustand et CSS Modules. Une lib de composants ou d'animation se discute avant.
- **Captures d'écran → sous-agent.**
- **Gate avant push**, `npm run finish` à la fin de chaque PR fusionnée.

---

## 6. Ce qu'il faut décider avant de lancer la phase 0

Trois questions changent la forme du travail — à trancher avec le porteur du projet :

1. **Maquettes statiques ou prototype cliquable ?** Claude Design fait les deux ; le prototype
   coûte plus cher par écran mais montre les transitions (panneaux, feuille mobile).
2. **Périmètre du premier lot** : HUD + inspecteur de bâtiment + construction (le cœur de jeu),
   ou connexion + onboarding (la première impression) ?
3. **Thème clair** : oui, non, ou plus tard ? (Touche les tokens et double les états à
   maquetter.)

---

## 7. Skills — récapitulatif

**Installés et utilisés** : `design` (Claude Design, le pivot), `design:design-critique`,
`design:accessibility-review`, `design:design-system`, `design:design-handoff`,
`design:ux-copy`, `design:user-research`, `design:research-synthesis`,
`product-management:write-spec`, `dataviz`, `web-accessibility`, `mobile-ux-optimizer`,
`react-best-practices`, `css-modules-vite`, `typescript`, `zustand-store-ts`, `spo-testing`,
`web-performance`, `web-games`, `reviewing-code` / `engineering:code-review`, `gate`,
`e2e-test`, `docs-codebase`, `claude-md-improver`.

**Recommandés si le besoin apparaît** : `anthropic-skills:theme-factory` (seulement si la
direction retenue sort de la palette actuelle — sinon inutile), `artifact-design` (pour
publier l'audit et le brief en pages lisibles et partageables).

**Non installé, à envisager** : un connecteur Figma n'est pas nécessaire — Claude Design est
l'outil de maquette ici ; un connecteur n'apporterait quelque chose que si une partie du
travail doit être partagée avec un designer externe sur Figma.
