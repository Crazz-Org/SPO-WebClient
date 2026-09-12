# Handoff 00 — Le socle (tokens, feuille universelle, Dialog, Toast, SaveIndicator, HUD)

Tout flux de la refonte repose sur ce socle : il se porte **en premier, en une PR**, sans
changer de comportement métier (aucun appel RDO nouveau, aucune route gateway nouvelle).
Sources visuelles : canevas *Système* (https://claude.ai/code/artifact/41b437c4-2db5-4ccf-b4f7-0512d23e10db),
fichiers `doc/ux/design/system/*.dc.html`. Décisions : [brief.md](../brief.md) ; défauts
réparés : [audit.md](../audit.md) §2–3 ; fonctions : [missing-features.md](../missing-features.md).

Pile : React 18, Zustand (`subscribeWithSelector`), CSS Modules, `lucide-react`, tokens dans
`src/client/styles/design-tokens.css`. Pas de nouvelle dépendance.

---

## 1. Tokens — `src/client/styles/design-tokens.css`

### 1.1 À créer

| Token | Valeur | Usage |
|---|---|---|
| `--scrim` | `rgba(0, 0, 0, 0.5)` | le seul fond de dialogue ; remplace 6 alphas (0.25→0.75) |
| `--z-backdrop` | `499` | scrim sous `--z-modal` ; remplace `calc(var(--z-modal) - 1)` ×9 |
| `--z-hud` | `350` | pastille, barre de commande, zoom, feuille mobile repliée |
| `--z-bottomnav` | `350` | mobile (référencé par `PlacementHUD.module.css:9` sans exister) |
| `--z-ticker` | `340` | `ChatBanner.module.css:9` (idem) |
| `--sai-bottom` | `env(safe-area-inset-bottom, 0px)` | `PlacementHUD.module.css:14` |
| `--content-top` | `calc(var(--space-3) + 40px + var(--space-2))` | sous la pastille (mobile) |
| `--radius-md` | existe déjà (6 px) | contrôle segmenté, zoom |
| `--surface-border-strong` | `rgba(255, 255, 255, 0.12)` | = `--surface-border-active`, alias lisible |

### 1.2 À corriger

- `--text-xs` et `--text-2xs` **ne descendent plus sous 12 / 11 px sur mobile** : supprimer les
  redéfinitions `design-tokens.css:167-169`.
- `--duration-panel: 300ms` devient la durée de toute surface qui glisse (feuille, dialogue) ;
  les `250ms` bruts (`LeftPanel:14`, `RightPanel:29`, `LeftRail:12`, `RightRail:12`,
  `BottomSheet:23`) sont remplacés.
- `reset.css:14` `html { font-size: 16px }` → `100%`.
- `reset.css:77` focus global : `outline: 2px solid var(--accent-gold); outline-offset: 2px` (or,
  plus vert). Supprimer les 6 `outline: none` sans remplacement (`PropertyGroup.module.css:99,349`,
  `CommandPalette.module.css:27`, `EmpireOverview.module.css:45`, `SettingsDialog.module.css:145`,
  `PoliticsPanel.module.css:295`).
- Les 25 `var(--inexistant)` (audit §2.1) : remplacés par le bon token ou supprimés. Liste
  exacte dans l'audit ; règle : `--accent-*` → `--accent-gold*` / `--error` / `--success` ;
  `--status-*` → `--error` / `--success` ; `--text-xxs` → `--text-2xs` ; `--surface-elevated` →
  `--bg-elevated` ; `--border-default` → `--surface-border` ; `--surface-hover` → `--bg-hover`.
- Palette héritée supprimée : `#4a7a6a`, `rgba(52,89,80)`, `rgba(40,75,66)`, `#3b82f6`,
  `#60a5fa`, `#2563eb`, `#94A3B8`, `rgba(212,168,67,…)` (second or), les 6 rouges ad hoc.
- Garde-fou : ajouter `stylelint` ? **Non** (dépendance) — un test Jest `design-tokens.test.ts`
  qui lit tous les `.module.css`, extrait `var(--x)` et échoue si `--x` n'est pas défini dans
  `styles/*.css`. Même test pour `outline: none` sans `:focus-visible` voisin.

### 1.3 Typographie

`styles/typography.css` devient la seule source des styles de texte : les composants
`composes:` ses classes (`.text-section-label` 11 px caps 0.08em, `.text-financial-value` mono
700 or, `.text-data-value` tabulaire). Les 29 recettes « label majuscule » retapées disparaissent
avec les composants qu'elles habillent, au fil des flux — pas de sweep en une fois.

---

## 2. Composants partagés — `src/client/components/common/`

Tous : `.module.css` + `.test.tsx` à côté, barrel `index.ts`, ≥ 93 % sur les lignes nouvelles.

### 2.1 `Button`

| Prop | Type | Défaut |
|---|---|---|
| `variant` | `'primary' \| 'secondary' \| 'ghost' \| 'outline' \| 'danger'` | `'secondary'` |
| `size` | `'sm' (32) \| 'md' (36) \| 'lg' (44)` | `'md'` |
| `loading` | `boolean` | `false` — spinner 14 px + `aria-busy`, désactivé |
| `iconLeft` / `iconRight` | `ReactNode` | — |
| `kbd` | `string` | raccourci affiché en `<kbd>` 11 px mono |
| …`ButtonHTMLAttributes` | | |

États (planche Contrôles) : repos / survol (`--bg-elevated`, primaire → `--accent-gold-light`) /
focus (`:focus-visible` or 2 px offset 2 px) / désactivé (`opacity .4`, `cursor: not-allowed`) /
en cours. **Une seule action `primary` par surface.** `danger` n'agit qu'après un `Dialog`.

### 2.2 `IconButton` (existant, à compléter)

`label` reste obligatoire → `aria-label` + `title` ; le SVG enfant reçoit `aria-hidden`. Tailles
`sm` 32 · `md` 40 · `lg` 44 (tactile). `badge?: number` → pastille rouge 18 px, texte
`aria-label="${label}, ${badge} non lus"`.

### 2.3 `Field`

`<Field label help? error? required?>{input}</Field>` : génère `id`, lie `htmlFor`,
`aria-describedby` (aide + erreur), `aria-invalid`, `aria-required`. Erreur = icône + texte
`--error`, jamais la couleur seule. Remplace les 8 `.input` locaux au fil des flux.

### 2.4 `Chip`

`variant: 'stack' | 'filter' | 'status'` ; `active`, `count?`, `onClick?`. 32 px desktop, 44 px
tactile (`size`). `status` : pastille 6 px + mot (À l'arrêt / Sous-approvisionné / En production).

### 2.5 `Tabs` (remplace `TabBar` et les tablists locaux)

APG complet : `role=tablist/tab/tabpanel`, `aria-selected`, `aria-controls`, roving `tabIndex`,
←/→/Home/End. Variantes `underline` (sections) et `segmented` (≤ 3 choix, 32 px, `--radius-md`).

### 2.6 `Switch`, `Checkbox`, `Radio`

`<input>` natif stylé (`appearance: none`), `role="switch"` + `aria-checked` pour Switch.
Remplacent les `div onClick` de `SettingsDialog.tsx:184` et `ProfilePanel.tsx:700,709`.

### 2.7 `Slider`

`<input type="range">` + valeur lisible à droite (mono 12 px), bornes sous la piste, écrit **au
relâchement** (pointerup / keyup / blur) — jamais pendant le glissement ; un `SaveIndicator`
obligatoire sous tout curseur qui écrit (prop `status`).

### 2.8 `Dialog`

```ts
interface DialogProps {
  title: string; description?: ReactNode;
  kind: 'spend' | 'destructive' | 'info';
  rows?: Array<{ label: string; value: string; tone?: 'gold' | 'positive' | 'negative' }>;
  primary: { label: string; onClick(): void | Promise<void> };
  secondary?: { label: string };   // défaut « Annuler »
  dontAskAgainKey?: string;         // case « ne plus demander … cette session » → sessionStorage
  onClose(): void;
}
```
`role="dialog" aria-modal="true" aria-labelledby`, **focus piégé** (sentinelles) et **restitué**
à la fermeture, Échap = secondaire, scrim `--scrim` à `--z-backdrop`, boîte `--z-modal`, 420 px,
centrée sur la **zone libre** (hors feuille). Focus initial : `primary` pour `spend`, `secondary`
pour `destructive`. Remplace `ConfirmDialog` / `PromptDialog` (le prompt = `Dialog` + `Field`).
`ui-store.requestConfirm/requestPrompt` restent l'API ; ils reçoivent `kind` et `rows`.

### 2.9 `Toast` (existant, à corriger)

Conteneur **monté en permanence** (`role="status" aria-live="polite"` + un second
`role="alert"` pour les échecs). Chaque toast : icône + **mot** (Construit / Attention / Échec)
+ message + action optionnelle (« Voir », « Réessayer »). L'échec ne s'efface pas seul. Largeur
360, bord gauche 3 px de la couleur sémantique, `--shadow-lg`, position : sous la pastille,
centré sur la zone libre.

### 2.10 `SaveIndicator` (existant, à étendre)

Quatre états **tous en texte et annoncés** : `pending` (« Enregistrement… »), `confirmed`
(« Enregistré · note »), `failed` (« Échec — … » + Réessayer, `role="alert"`), `stale`
(« En attente de relecture · la valeur affichée peut être ancienne » — OB-29). Prop
`note?: string` (ex. `TAX_EFFECTIVE_NOTICE`).

**Porté (PR #73)** — l'indicateur couvre maintenant **toute** écriture de bâtiment : les six
composants du plan (`PropertyInputs`, `WorkforceTable`, `TaxesTab`, `MinistriesTab`, `JobsTab`,
`TownsTab`) l'avaient déjà ; s'y ajoutent les **curseurs fournisseurs** (Prix max, Qualité min,
Prix produit), les **connexions** (brancher et débrancher, un indicateur par porte) et le
**renommage**. L'état « en attente de relecture » reste la phrase `confirmedMessage`
(`TAX_EFFECTIVE_NOTICE`), le seul cas où le serveur ne confirme pas (OB-29).
La clé d'une connexion est `<membre>:<fluide>` (`handlers/connection-pending-key.ts`) et non la
clé par défaut : `connectionList` porte les coordonnées, donc la clé par défaut changeait à
chaque clic et aucun contrôle ne pouvait la suivre.

### 2.11 `EmptyState` / `ErrorState` / `Skeleton`

Toujours **dans la zone concernée**, jamais toute la feuille. `ErrorState` porte un
« Réessayer » qui rejoue la lecture de la zone. Squelettes de la forme finale, annoncés
(« Chargement des approvisionnements »).

---

## 3. La feuille universelle — `src/client/components/sheet/`

### 3.1 Modèle

Une **pile** de surfaces dans `ui-store` remplace `rightPanel` / `leftPanel` / `modal` :

```ts
type SurfaceKind = 'build' | 'building' | 'supplierSearch' | 'mail' | 'search' | 'empire' |
                   'politics' | 'map' | 'overlays' | 'settings' | 'newspaper' |
                   'changelog' | 'companyCreation' | 'zonePicker';
interface Surface { kind: SurfaceKind; params?: Record<string, unknown>; title: string }
interface UiState {
  stack: Surface[];            // [0] = racine, dernier = visible
  pinned: boolean;             // la feuille reste ouverte quand on clique un autre bâtiment
  push(s: Surface): void; pop(): void; popTo(i: number): void; replaceTop(s: Surface): void;
  clear(): void;
}
```
Règles : `push` **n'écrase jamais** (fin des `modalBeneath` à une case) ; Échap = `pop()` ;
clic sur un jeton = `popTo(i)` ; le `Dialog` n'est **pas** dans la pile (il passe au-dessus).
`dismissTopmost()` reste : minicarte plein écran → palette → dialogue → `pop()` → modes.
`requestConfirm/Prompt` gardent leur API.

### 3.2 Anatomie (planche Surfaces)

| Zone | Spécification |
|---|---|
| Conteneur | desktop : `position: absolute; top: 64px; right: 16px; bottom: 16px; width: 472px`, `--bg-secondary`, bordure `--surface-border`, `--radius-xl`, `--shadow-xl`, `--z-panel` ; tablette (768–1199) : `left: 16px; right: 16px` ; mobile : `BottomSheet` existant (snap peek/half/full) avec le **même** contenu. **Porté (PR #69)** : desktop ≥ 1024 tel quel (`--sheet-top`, `--sheet-inset`, `--panel-width-desktop: 472px`, 420 en 1024–1399) ; **revu au lot g (#82, décision du porteur)** : la tablette 768–1023 rejoint le **modèle mobile** — `MobileShell` monte sous 1024 (feuille basse + barre d'onglets), le panneau ancré 360 px et les décalages HUD `--panel-width-tablet` sont supprimés ; plafonds tablette : tuiles ≤ 120 px réparties bord à bord, colonne de contenu de la feuille ≤ 640 px centrée (`--sheet-content-max`), pastille ≤ 480 px (`--search-pill-max`), clusters PlacementHUD / barre de mode ≤ 600 px (`--mobile-hud-max`) |
| Pile (haut) | jetons `Chip variant=stack`, séparés d'un chevron 12 px `--text-disabled` ; si > 3 jetons, le milieu se replie en « … » (`title` = libellé complet) ; à droite : `IconButton pin` (desktop) et `IconButton x` ; **exception (#452)** : à une seule surface, le fil de jetons ne s'affiche pas — un jeton unique n'est pas cliquable et double le titre déjà porté par l'en-tête ou le `h2` en dessous |
| En-tête | propre au contenu (voir chaque handoff) ; `h2` 18/600, sous-titre 12 `--text-muted` |
| Sections | `Tabs variant=underline`, `overflow-x: auto` |
| Corps | **la seule zone qui défile** (`overflow-y: auto`), fondu 40 px en bas, `scrollbar-width: thin` + `::-webkit-scrollbar` 6 px |
| Pied | collant, `--surface-border` au-dessus, fraîcheur à gauche (`lastUpdate`), actions à droite, **une** `primary` |
| Scrim | **aucun** — la carte reste cliquable ; un clic sur un autre bâtiment remplace la racine `building` (ou l'empile si `pinned`) |
| Mouvement | entrée `translateX(100%)→0` en `--duration-panel` `--ease-out` ; `prefers-reduced-motion` → pas de transition |

Accessibilité : `<aside role="region" aria-label="{title}">` ; la feuille **ne piège pas** le
focus (pas modale) ; à l'ouverture le focus va sur le `h2` (`tabIndex=-1`) ; à la fermeture il
revient à l'élément déclencheur.

### 3.3 Migration

| Aujourd'hui | Devient |
|---|---|
| `RightPanel` + `LeftPanel` + `modals/*` | `Sheet` + `stack` |
| `BuildingInspector` (panneau) et `BuildingInspectorModal` (civique) | **un seul** contenu `building` ; le civique n'est plus une modale |
| `ConnectionPickerModal` | contenu `supplierSearch` **empilé** |
| `BuildMenu` | contenu `build` (catégories → liste), cache de session |
| `SettingsDialog`, `Changelog`, `Newspaper`, `CompanyCreation`, `ZoneTypePicker` | contenus de feuille |
| `ConfirmDialog` / `PromptDialog` | `Dialog` |

---

## 4. Le HUD — `src/client/components/hud/`

### 4.1 `StatusPill` (remplace `InfoWidget` + `MobileInfoBar`)

Desktop : `top: 12px`, centrée sur la zone libre (`left: 0; right: 504px; margin: auto`), 40 px,
`--glass-bg` + `backdrop-filter`, `--radius-full`, `--z-hud`. Segments : monde 11 caps or ·
date 12 mono tabulaire · `$ cash` mono 16/700 or (**`$` avant, espace fine insécable**) ·
revenu/h 12 `--money-positive/negative` · sparkline 64×18 · **Dette** (tag rouge, seulement si
`failureLevel ≥ 1`, `title` = niveau) · `#rang` · nom · rôle · compagnie · `n / max`.
Clics : argent → `push({kind:'empire', params:{tab:'profitloss'}})` ; nom → `empire` ; Dette →
`empire` onglet finances. Mobile : cash, revenu, `#rang` seulement ; `left/right: 12px`.
Teinte dette : fond `--error-bg`, bordure `--error` (reprend `debtTint`), pulsation `alertPulse`
coupée par `prefers-reduced-motion`.

### 4.2 `CommandBar` (remplace `LeftRail`, `RightRail`, `BottomNav`, `MobileMenu`)

Desktop : `bottom: 16px; left: 16px; width: 904px` (zone libre − marges), deux lignes :
**recherche** (44 px, `--glass-bg`, placeholder « Rechercher mes bâtiments, un joueur, une ville
— ou une commande… », `Ctrl K`) qui ouvre la `CommandPalette` ; **6 tuiles** 56 px dans une
grille 6 colonnes (Construire B · Carte M · Empire E · Politique P · Courrier L + badge · Plus).
Tuile active : fond `--accent-gold-subtle`, bordure `--accent-gold-dark`, texte or.
« Plus » : menu (Routes, Zones — charge publique, Calques, Réglages, Changer de serveur).
Mobile : `left/right: 8px; bottom: 8px`, recherche 44 px + 5 tuiles (sans Plus → dans Carte /
Empire ; Zones et Routes sous Construire comme aujourd'hui).
**Porté (PR #70)** : `BottomNav` = les **six** tuiles du desktop (Build · Map · Chat · Government · Mail ·
More) — Chat reste une tuile (social mobile) et More garde ce que la spec n'avait pas placé (Search,
Transport, Profile, My facilities, calques, zoom, réglages, serveur) ; la rangée de recherche est
une pastille 44 px au-dessus des tuiles sur l'onglet carte (`MobileSearchPill` → palette). Écart voulu.

**Barre de mode** : pendant placement / route / zone, la ligne recherche devient la barre de
mode (48 px, bordure `--accent-gold-dark`, `--shadow-gold-glow`) : icône recherche 32 px ·
point or · KIND 12 caps · nom 14/500 · coût mono 12/700 or · « après : $ » 12 (`cash − cost`,
`--money-positive`, ou `--money-negative` + blocage si < 0) · indication 12 `--text-tertiary`
(`flex: 1; min-width: 0; ellipsis`) · actions (`flex-shrink: 0`) : « Tourner la vue `R` »
(`rotateCW`), « Terminer `Échap` ». Pose invalide : indication en `--error` + raison. Route :
« n tuiles » (pas de coût — H7). Après pose : « Posée · encore une ? », le mode reste actif.
**Portée sur mobile (PR #72)** : `MobileModeBar` prend la place de la rangée de tuiles tant qu'un mode
route / zone tourne (nature en petites capitales or, nom, indication sur une seconde ligne, note de
calque ; un bouton « Done » de 44 px sort du mode) et la pastille de recherche est masquée. Les deux
barres lisent la même description (`components/hud/use-mode-descriptor.ts`) : mêmes mots, même sortie.
**Écart voulu** : le **placement** garde `PlacementHUD` (Cancel / Rotate / Confirm), dont les trois
cibles pleine largeur valent mieux au pouce qu'une ligne de texte.
**Mode Connect (N10, PR #80)** : quatrième mode du descripteur — « CONNECT · <sujet> ·
Click a building to connect », sortie **Cancel** (pas Done : rien à valider) / Échap ; pendant
ce mode la **pile de surfaces se masque sans se détruire** (la feuille couvrait la carte sur
mobile) et revient telle quelle à la sortie ; deux origines (connectMap de l'inspecteur,
« Pick on map » du picker), un seul mode.

Zoom : `right: 504px; bottom: 150px` (desktop), `right: 12px; bottom: 150px` (mobile), 40 / 44
px. Pastille chat : `left: 16px; bottom: 150px`, ouvre `ChatStrip` étendu.

### 4.3 Raccourcis — `hooks/useKeyboardShortcuts.ts`

**Décision inverse actée (lot d, PR #78)** : `input/key-binding-registry.ts` (rebind
persistant, Q/E) est **supprimé**, pas branché — le rebind était un besoin hypothétique ;
s'il devient réel un jour, il se reconstruira au-dessus de `SHORTCUTS`. La table unique
est `SHORTCUTS` dans `useKeyboardShortcuts.ts`, la liste des Réglages en est générée.
**Modificateurs testés** (Ctrl/Cmd/Alt → laisser passer) ; Échap **après** le garde
« champ actif » et `isComposing` ; `M` = Carte, `L` = Courrier, `Q`/`W` rotation (E est
pris par Empire — la paire Q/E est morte-née), flèches = pan (renderer), `+`/`−` zoom
(renderer), `P` Politique.

---

## 5. Ordre de portage et critères de sortie

1. **PR socle-1 — tokens** : §1 entier + test Jest des tokens. Aucun changement visuel voulu
   hors focus/12 px. *Sortie* : 0 `var()` inconnu, 0 `outline:none` orphelin, tests verts.
2. **PR socle-2 — composants** : §2 (Button, Field, Chip, Tabs, Switch/Checkbox/Radio, Slider,
   Dialog, Toast, SaveIndicator, Empty/Error/Skeleton) **sans encore les utiliser** hors
   `Dialog` (branché sur `requestConfirm/Prompt`) et `Toast`. *Sortie* : composants + tests
   ≥ 93 %, `ConfirmDialog`/`PromptDialog` remplacés, Settings utilisable au clavier.
3. **PR socle-3 — feuille + pile** : §3 avec le contenu `building` (inspecteur standard +
   civique fusionnés), `mail`, `search`, `empire`, `politics` (desktop **et**
   mobile → ferme P1, E1). *Sortie* : `modalBeneath` supprimé, aucun `openModal` destructif,
   L2 `test:live` vert sur inspecteur / taxes.
4. **PR socle-4 — HUD** : §4 (StatusPill, CommandBar, barre de mode, raccourcis). *Sortie* :
   H1, H2, H5, S2 fermés ; `key-binding-registry` vivant.
5. Puis les flux : [01-t1-construire.md](01-t1-construire.md), [02-t3-fournisseur.md](02-t3-fournisseur.md).

Chaque PR : `npm run gate`, couverture ≥ 93 % sur les lignes modifiées, E2E routé, `npm run finish`.
