# Handoff — flux légers T6, T2, T7, T5, T8 (tels que portés)

Ces cinq flux n'ont pas eu de planche dédiée : leur friction tenait à un écran existant, pas
à une transition de surfaces. Ils ont été spécifiés depuis le [brief](../brief.md) §3 et
[missing-features](../missing-features.md), et portés en une PR chacun. Cette fiche fixe ce
qui a été livré, pour que le code et les canevas restent lisibles côte à côte.

| Flux | PR | Ferme |
|---|---|---|
| T6 Courrier | #62 | M1, M2, M3 |
| T2 Diagnostic | #63 | B7 |
| T7 Recherche | #64 | S1 (local), N5 (palette) |
| T5 Taxes | #65 | P2 (complément), audit §3 lignes cliquables |
| T8 Modes carte | #66 | B5 (routes), H7, audit « Overlays » |

## T6 — lire et répondre à un mail (`MailPanel`, `mail-store`)

- **Répondre** pré-remplit destinataire et sujet (`Re:`) — c'était un bug, pas une option.
- Le brouillon vit dans le store (`setComposeField`) et **reste** tant que le serveur n'a pas
  confirmé l'envoi (`RESP_MAIL_SENT` en échec → brouillon conservé, toast d'erreur persistant).
- **Supprimer** passe par le Dialog destructif du socle-2 (`requestConfirm`), puis le message
  est retiré localement à `RESP_MAIL_DELETED` (`pendingDeleteId`).
- Chargement d'un message : squelette (`isMessageLoading`) ; `Reply` / `Delete` portent un
  `aria-label` avec le sujet.

## T2 — comprendre pourquoi un bâtiment ne produit pas

- Aucune lecture en plus : le texte d'état **déjà poussé** (section 1 de l'aperçu + les
  hints) est lu par `src/shared/building-details/facility-diagnosis.ts`.
- Sévérité (`stop` › `warning` › `hint` › `ok` › `none`) : les têtes `Stopped…`
  (`Kernel/Kernel.pas:5017-5024`) gagnent toujours ; puis les 25 phrases de
  `Kernel/SimHints.pas:279-516` ; phrase inconnue → sévérité de son préfixe, texte gardé.
- `DiagnosisBanner` : mot + phrase + **une** action (trouver un fournisseur du fluide nommé,
  ouvrir services / main-d'œuvre / recherche, connecter) ; `stop` = `role=alert`. Dans
  l'inspecteur l'action ouvre la section correspondante parmi celles que le serveur a
  déclarées (`tabForAction`) ;
  seule l'action de liaison fait exception : elle lance la sélection sur la carte comme le bouton Connect de l'onglet Général (`connectMap`) ; l'aperçu carte l'affiche en lecture seule (`compact`).

## T7 — trouver un bâtiment / une ville / un point

- La palette (Ctrl/⌘ K) filtre, en plus des commandes : **mes bâtiments** (favoris, lus une
  fois à la première ouverture si vides), **les villes** (page annuaire déjà tenue par
  Recherche / Government), et `x,y` ou `x y` → `Go to (x, y)`. Tout est local : aucune
  requête par frappe. Chaque entrée passe par `onNavigateToBuilding`, le chemin d'un clic carte.
- Les commandes « Find Building / Find Player » qui ne menaient nulle part sont retirées.
- Hors lot : coordonnées cliquables dans le chat (N5). La palette est atteignable sur mobile
  depuis la pastille de recherche de la barre de commande (PR #70).

## T5 — régler les taxes d'une ville

- Government › chaque ville porte un bouton **Taxes** (`aria-label "Taxes of <ville>"`) : il
  choisit la section `administration` (là où vit `townTaxes`, `CivicTabConfig.ts`) **avant**
  le focus, pour que la lecture paresseuse de la section parte dès l'arrivée des détails.
- Tableau des taxes : pour un maire, le nom de chaque ligne est un `<button aria-pressed>`
  (clavier) ; un visiteur lit du texte. L'éditeur reste sous le tableau, la ligne en main
  seulement, et le `SaveIndicator` garde sa phrase « prend effet… » (pas de tick — voir
  l'en-tête de `TaxesTab.tsx`).

## T8 — changer d'overlay, peindre une zone, tracer une route

- **Overlay** : `handlers/overlay-mode.ts` — `enterZonesOverlayForMode` / `leaveZonesOverlayAfterMode`
  servent le placement **et** le zonage ; ce qui était affiché avant (rien, Zones, ou un autre
  overlay) est mémorisé (`game-store.overlayBeforeMode`) et revient à la sortie. La barre de
  mode le dit (« Zones overlay shown — Crime comes back when done »).
- **Route** : la barre de mode affiche le tarif (`$2,000,000 per tile, $4,000,000 over water;
  existing road is free`, constantes partagées `src/shared/road-cost.ts`) ; à la relâche,
  Dialog de dépense (Tiles / Bridge tiles / Already paved / Cost / Cash after,
  `dontAskAgainKey: 'road'`) **puis** la requête ; l'infobulle canvas du renderer
  (tuiles + coût) reste. Le coût suit **la formule de Voyager** (#99) : chaque tuile du
  chemin en escalier, tuile de départ comprise, gratuite si elle porte déjà une route,
  4 M sur l'eau sans béton, 2 M sinon (`Map.pas:6607-6632`).
- **Démolition de route** : Dialog destructif, clic ou zone, `dontAskAgainKey: 'roadDemolish'`.
