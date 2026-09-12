# Handoff 02 — T3 Inspecter un bâtiment et raccorder un fournisseur

Canevas : https://claude.ai/code/artifact/845491f3-837c-466d-a813-d262863c1b31 (planches T3-1 → T3-5,
T3-Mobile ; sources `doc/ux/design/flows/gen.py`). Dépend du socle ([00-socle.md](00-socle.md)).
Code actuel : `building/StatusOverlay.tsx`, `building/BuildingInspector.tsx` + `InspectorHeader`,
`InspectorMenu`, `SuppliesGroup.tsx`, `useGateConnections.ts`, `modals/ConnectionPickerModal.tsx`,
`handlers/building-focus-handler.ts`, `building-action-handler.ts`, gateway
`server/session/building-details-handler.ts` (`getBuildingTabData :364`, `fetchGateDetails :1264`),
`politics-handler.ts:1128-1145` (`FindSuppliers`).

## Objectif mesurable

Du clic sur la carte au fournisseur connecté : **clic bâtiment → Inspecter → Trouver un
fournisseur → cocher → Connecter = 5 interactions** dans une seule feuille empilée (contre
8–10 sur 3 surfaces). **Budget RDO inchangé** : mêmes lectures, aux mêmes moments.

## Données et appels (inchangés — c'est la contrainte)

| Étape | Appel | Quand |
|---|---|---|
| Aperçu | bloc Inspect poussé (`SwitchFocusEx` puis `RefreshObject` ~5 s → `EVENT_BUILDING_REFRESH`) | au clic ; **aucune** lecture en plus |
| Feuille `building` | `REQ_BUILDING_DETAILS` (en-tête + groupe générique) | à l'ouverture (comme aujourd'hui) |
| Onglet Approvisionnements | `REQ_BUILDING_TAB_DATA` → 1 RDO `GetInputNames` (+ `GateMap`) → **noms seulement** | à l'ouverture de l'onglet |
| Ligne ouverte | `onRequestGateConnections` → `SetPath` + `GetPropertyList` + `GetSubObjectProps` × connexions (≤ 20, 3 à la fois) | **à l'ouverture de la ligne** ; résultat gardé tant que la feuille vit ; « réessayer » = replier/rouvrir **ou** bouton Réessayer dans l'`ErrorState` |
| Curseurs | écritures `MaxPrice` / `minK` | au relâchement, debounce 300 ms conservé |
| Recherche | `onSearchConnections(fluidId, filtres, rôles)` → `FindSuppliers` | **à Entrée / bouton**, jamais à la frappe |
| Connecter | `onConnectionConnect([{x,y}])` | clic « Connecter » |
| Déconnecter | `onDisconnectConnection(…, x, y)` | **après** `Dialog kind=destructive` |
| Distance | calcul local `√((x−bx)²+(y−by)²)` | sur les résultats reçus |

Ligne repliée = **nom seul**. Toute information de plus est une requête par ligne : interdit.

## Surfaces

### T3-1 — aperçu (`StatusOverlay` refondu)
Carte 320 px `--glass-bg`, ancrée au bâtiment (suivi rAF existant) : nom 14/600 + compagnie ·
niveau 11 `--text-muted` ; `Chip status` (À l'arrêt / Sous-approvisionné / En production — dérivé
du parseur de hints B7, repli « — ») ; bandeau diagnostic (icône + texte de `hintsText`, parsé si
connu, brut sinon) ; 3 métriques du bloc (`RichDetails` : revenu, personnel, efficacité selon la
catégorie) ; boutons « Inspecter » (primary 32) et « Aller » (secondary 32, `centerOn`).
Second clic sur le bâtiment = Inspecter (inchangé). Masqué en mode placement.

### T3-2 — feuille `building`
- Jetons : « {nom} » › « Approvisionnements » (section active).
- En-tête : `h2` nom, sous-titre compagnie · ville · niveau, `Chip status` ; bandeau diagnostic
  (`--error-bg` si arrêt, `--warning-bg` si reprise, `--success-bg` si ok) avec **l'action du
  diagnostic** (« Trouver un fournisseur » → ouvre la ligne de l'entrée manquante **et** empile la
  recherche) ; `Tabs underline` des sections (`BuildingDetailsTab` → libellés mappés, audit §5).
- Corps : `Field` filtre « Filtrer n approvisionnements… » (local sur les noms), lignes 40 px
  `1fr 32px` nom 13 + chevron, `aria-expanded`. Ligne ouverte (`--bg-tertiary`) : « Dernière
  valeur · Coût · Fournisseurs n » 12, `Slider` Prix max + `Slider` Qualité min (+ `SaveIndicator`),
  table fournisseurs (nom + compagnie · distance, prix, qualité, `IconButton x` « Déconnecter … »),
  ou `EmptyState` « Aucun fournisseur connecté » + « Trouver un fournisseur » (primary 32) +
  « Choisir sur la carte » (secondary 32 → `connectMap`, N10), puis « Ajouter un fournisseur ».
- Pied : « Actualisé il y a 14 s » (`lastUpdate`) · Renommer · **Voir sur la carte** (`centerOn`).
- Civique : **même** contenu, onglets civiques ; plus de modale.

### T3-3 — contenu `supplierSearch` (empilé)
- Jetons : « {nom} » › « … » › « Trouver un fournisseur » (le milieu replié).
- Titre : « Trouver un fournisseur de {fluide} » + « pour {bâtiment} · {ville} ».
- Filtres (collants) : `Field` « Compagnie, bâtiment… » avec `Entrée` ; jetons **conservés dans
  un store** (`supplier-search-store`) : Ville (toutes / liste des villes), Max 20, rôles
  **Producteurs · Distributeurs · Importateurs · Acheteurs · Exportateurs** (bitmask 1/2/16/4/8).
- Résultats : en-tête 28 px caps (Fournisseur · Prix / t · Qualité · Dist.), `label` 44 px
  min avec case à cocher 18 px, nom 12/500 + « compagnie · ville » 11, prix mono, qualité
  colorée (≥ 80 % vert, sinon ambre), distance ; tri par distance (local), « n résultats · tri :
  distance ». Multi-sélection.
- Pied : « n sélectionné(s) · noms » + « Connecter » (désactivé si 0).
- États : **en cours** (squelettes + `role="status"` « Recherche des fournisseurs de {fluide}… »,
  le reste de la feuille reste utilisable) ; **vide** (icône, « Aucun fournisseur de {fluide}
  trouvé », « Élargissez les rôles (acheteurs, exportateurs) ou choisissez sur la carte », boutons
  Tous les rôles / Choisir sur la carte) ; **erreur** (`ErrorState` + Réessayer).
- Résultats arrivant après fermeture : **ignorés** (comme aujourd'hui) mais un `requestId` évite
  qu'une réponse tardive remplisse une autre recherche.

### T3-4 — connecté
`pop()` vers `building`, ligne du fluide ouverte ; `SaveIndicator confirmed` « Connecté · {nom}
· la livraison commence demain » ; `Toast ok` « Connecté — {fournisseur} fournit {bâtiment}. » ;
la table montre la nouvelle ligne (relecture de la porte = **la même** requête que l'ouverture,
déclenchée une fois) ; le diagnostic change **quand le bloc Inspect le dira** (aucune lecture
forcée). Échec : `SaveIndicator failed` + `Toast err` + Réessayer.

### T3-5 — déconnecter
`IconButton x` → `Dialog kind=destructive` « Déconnecter {fournisseur} ? — L'usine n'aura plus
de {fluide}. Vous pourrez reconnecter ce fournisseur plus tard. », focus sur Annuler ; puis
`onDisconnectConnection`, `SaveIndicator`, toast. Touche Suppr sur une ligne = même dialogue.

### Mobile
Feuille à `half` : en-tête identique, bouton diagnostic 44 px, lignes 48 px ; recherche
fournisseur = feuille à `full` (700 px) : champ 44 px, jetons 36 px défilables, lignes 56 px
(case 22 px, nom + compagnie · distance, prix / qualité à droite), pied « Connecter » 44 px.

## Accessibilité
- Lignes de fourniture : `role="button" aria-expanded`, ↑/↓ entre lignes, Entrée ouvre/ferme,
  Suppr → dialogue. Ouverture annoncée « Coton — chargement des fournisseurs » puis « n
  fournisseurs ».
- Résultats : `label` englobant la case ; Espace coche ; « n sélectionnés » en `role="status"`.
- Curseurs : `aria-valuetext` « 120 pour cent ».

## Ferme dans missing-features
B4 (Entrée + filtres conservés), B5 (déconnexion), B6 (connexions, curseurs), B7 (parseur de
hints), N9 (Voir sur la carte), N10 (Choisir sur la carte depuis la recherche), P1 partiel
(contenu civique dans la feuille), E2 (épingler).

## Hors périmètre
Catégories de produits (n'existent pas), données sur les lignes repliées (budget RDO),
recherche générale de bâtiment (S1).
