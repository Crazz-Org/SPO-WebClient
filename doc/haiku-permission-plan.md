# Plan — réduire les demandes de permission des drivers Haiku

> **⚠ Sujet retiré — document d'archive.** Le pilote décrit ici (le driver LLM
> `/next-task` et sa couche de gardes) n'existe plus : la commande a été supprimée et le
> pilotage du kanban appartient désormais à l'orchestrateur du dépôt voisin
> [SPO-Pipeline](https://github.com/Crazz-Org/SPO-Pipeline). Les mentions de `next-task`,
> de « driver » et des hooks ci-dessous sont **historiques** — elles décrivent l'état observé
> à la date du document, jamais le fonctionnement actuel. Conservé sans réécriture : le
> réécrire falsifierait les traces de session qu'il enregistre.

> **Note du 2026-08-29.** Ce document analyse la couche de hooks du pilote, **antérieure à
> #425** : les gardes qu'il décrit ont été retirés à l'étape 4 de la strangler-migration, et
> seuls `main-commit-guard.sh`, `pre-push-gate.sh` et `bench-port-guard.sh` subsistent dans
> `.claude/hooks/`. Conservé tel quel comme trace d'analyse.

> **Statut au 2026-08-27.** Plan produit avant la revue `card-reviewer`, conservé tel quel
> comme trace du raisonnement. **L'étape 7 (`legacy-search-guard.sh`) n'est pas à construire
> sous cette forme** : elle doublonne la carte **#324**, déposée le même jour depuis la même
> analyse et déjà en cours, avec une prescription contraire (elle rend les formes shell
> corrigées au lieu de les refuser). L'argument pour le refus dur, et un défaut de règle de
> correspondance à éviter, sont commentés sur #324 — la décision appartient à son propriétaire.
> Les items 9 et 10 de l'étape « Carte 3 » qui documentaient ce hook tombent avec lui.
>
> Ce qui a effectivement été déposé : **#337** (étapes 1–2), **#338** (étapes 3–6),
> **#339** (étape 11 et la ligne § Commands de l'étape 9). Cartes autoportantes : elles ne
> renvoient pas à ce document.

Produit par le sous-agent `Plan` (Fable 5) le 2026-08-27, à partir de
[haiku-permission-analysis.md](haiku-permission-analysis.md). **À exécuter tel quel.**
Vérité terrain lue sur `main@3773cbd6`.

> Note de mesure : `scripts/coverage-changed.js` n'applique le seuil ≥ 93 % qu'aux sources
> `src/**/*.ts(x)` non-test modifiées. Rien dans ce plan n'entre dans cet ensemble (hooks
> `.sh`/`.js`, script `.sh`, tests `.test.ts`) — le ratchet est satisfait à vide. La
> convention qui lie ici est l'autre : tout hook/script embarque un test Jest dans
> `src/__tests__/` qui pilote le programme en sous-processus (`worktree-scope-guard.test.ts`,
> `driver-scope-guard.test.ts` sont les modèles).

## 1 · Modèle causal

Quatre causes racines produisent les 36 interruptions non voulues ; deux blocages voulus
comptent pour les 9 autres (driver-scope 5, automode 4 — les deux restent).

- **RC1 — la copie lisible et la copie écrivable sont deux arbres différents** (→ S1, 13).
  CLAUDE.md, les skills et le harnais présentent les fichiers de gouvernance sous
  `/home/crazz/SPO-WebClient/…` ; la copie écrivable est sous `.claude/worktrees/<session>/…`.
  L'agent écrit là où il a lu. Le garde a raison de bloquer ; rien ne lui rend le chemin
  écrivable, donc le même appel est rejoué (`settings.json` ×3, `CLAUDE.md` ×4).
- **RC2 — un besoin permanent et légitime n'a aucune forme allowlistée** (→ S2, 10 ; alimente
  S4). « Code de sortie + tail court » n'a pas de forme sanctionnée en un appel : la forme que
  `verdict-pipe-guard` recommande lui-même (`cmd > log 2>&1; echo "EXIT=$?"; tail -40 log`)
  contient `tail`, délibérément hors allowlist — donc **même la forme corrigée demande une
  permission**. L'agent réinvente un pipe à chaque fois.
- **RC3 — un refus qui ne finit pas par une commande corrigée exécutable est rejoué à
  l'identique** (transversal). Mesuré : `verdict-pipe-guard` et `poll-loop-guard` rendent la
  forme → zéro réessai identique sur 10+4 déclenchements ; le classifieur et
  `worktree-scope-guard` ne la rendent pas → 11 réessais identiques.
- **RC4 — le chemin de recherche sûr existe mais rien n'y oriente, tandis que le chemin shell
  demande une permission *et* ment silencieusement** (→ S5).

**Le changement unique qui en tue le plus :** l'étape 1 (`npm run verdict`) supprime RC2
entièrement — 10 interruptions cessent d'exister parce que le pipe n'est jamais composé. Les
étapes 3–4 suivent de près, jusqu'à 13.

---

## 2 · Étapes ordonnées

**Trois cartes**, en ordre de dépendance (Carte 2 `blocked by` Carte 1 ; Carte 3 `blocked by`
Carte 2). Areas : Carte 1 = `ci`, Carte 2 = `bench`, Carte 3 = `docs`. Chaîne normale
branche → PR → gate. Les changements ne prennent effet que dans les worktrees créées après le
merge — une session lit les hooks de sa propre copie de `.claude/`.

### Carte 1 — `npm run verdict` : la forme sanctionnée « code de sortie + tail court » (area `ci`)

#### Étape 1 — créer `scripts/run-verdict.sh` et l'alias

Nouveau fichier `scripts/run-verdict.sh` (bash, `set -uo pipefail`). Interface :

```
npm run verdict -- <alias> [--tail=N]
```

- `<alias>` doit être exactement l'un de : `test`, `test:changed`, `test:coverage`,
  `test:smoke`, `typecheck`, `lint`, `build`, `coverage:changed`, `gate:precheck`,
  `gate:local`. Toute autre valeur (y compris un argument positionnel en trop) → usage sur
  stderr, `exit 64`. `gate` et `test:live` sont **exclus délibérément** : ce sont des jobs de
  banc dont la forme sanctionnée est la commande nue mise en fond (CLAUDE.md § Commands).
- `--tail=N`, défaut 40, entier 1–500.
- Log :
  `LOG="${SPO_BENCH_DIR:-$HOME/.spo-bench}/logs/verdict-<alias avec ':' → '-'>-$(date +%Y%m%d-%H%M%S)-$$.log"`
  (`mkdir -p` du répertoire). **Hors de la worktree**, pour que l'arbre reste propre pour le gate.
- Exécution : `npm run --silent "$alias" > "$LOG" 2>&1; code=$?` — une redirection, jamais un
  pipe, donc le code de sortie est le verdict.
- Puis imprimer : `tail -n "$N" "$LOG"`, puis `LOG=$LOG`, puis `EXIT=$code`, puis `exit $code`.

**Contrat de code de sortie :** le code du script EST celui de la commande interne, toujours ;
`64` uniquement pour une erreur d'usage, avant toute exécution.

`package.json` : ajouter `"verdict": "bash scripts/run-verdict.sh"` dans `scripts`. Il est
alors couvert par l'entrée `Bash(npm run *)` existante — **aucune nouvelle entrée de
permission nulle part dans ce plan.**

#### Étape 2 — `src/__tests__/run-verdict.test.ts`

Suivre le patron sous-processus de `worktree-scope-guard.test.ts`. Placer un faux exécutable
`npm` (3 lignes de bash honorant `FAKE_NPM_EXIT` et imprimant des marqueurs sur stdout et
stderr) dans un répertoire temporaire préfixé à `PATH` ; `SPO_BENCH_DIR` sur un temporaire. Cas :

1. code 0 propagé ; 2. code 1 propagé (statut du sous-processus = 1) ; 3. le fichier de log
existe sous `<tmp>/logs/` et contient le marqueur stdout **et** le marqueur stderr ; 4. stdout
se termine par les lignes `LOG=` et `EXIT=1` et contient la fin du log ; 5. alias inconnu →
code 64 et le faux `npm` n'a jamais été invoqué (vérifié via un fichier témoin) ; 6.
`--tail=2` imprime exactement les 2 dernières lignes du log avant la ligne `LOG=`.

Lancer `node scripts/check-command-aliases.js` en local pour confirmer que la cohérence des
alias reste verte.

### Carte 2 — tout refus survivant finit par une commande corrigée exécutable ; la recherche de corpus reçoit une forme dure et correcte (area `bench`, bloquée par la Carte 1)

#### Étape 3 — S1 : `worktree-scope-guard` rend le chemin écrivable

**Décision (question 2) : le comportement bloquant du garde ne change pas, aucune entrée
`allow` n'est ajoutée, et aucune redirection silencieuse n'est construite.** La redirection
silencieuse est rejetée pour trois raisons : (a) le `old_string` de l'Edit bloqué a été lu
dans l'*autre* copie, qui peut légitimement différer de celle de la worktree (une worktree
branchée avant un correctif sur `main` — terrain explicitement non tranché), donc une écriture
redirigée peut appliquer un diff périmé sans que personne ne le voie ; (b) une redirection
corrige un appel mais pas la croyance du modèle — son prochain chemin absolu (un `git add`,
une invocation `node`) vise encore le mauvais arbre, et `main-commit-guard` devient le symptôme
suivant ; (c) une écriture qui atterrit ailleurs que là où le transcript dit détruit
l'auditabilité. Le correctif est le message de refus (cette étape) plus la suppression de la
cause amont (étape 4).

`.claude/hooks/worktree-scope-guard.js` — `classify()` rend aujourd'hui une raison en prose.
La faire calculer aussi le chemin corrigé : `rel = path.relative(FAMILY, abs)` ; si `rel` se
découpe en `['.claude','worktrees',<nom>, ...reste]` alors `repoRel = reste.join(path.sep)`
sinon `repoRel = rel` ; `corrected = path.join(TOP, repoRel)`. La ligne de sortie d'un blocage
devient `<texte de raison existant>\t<corrected>` (la ligne `ALLOW` est inchangée, et le texte
de raison contient toujours le chemin relatif, donc les deux assertions existantes
`not.toBe('ALLOW')` / `toContain('leaked.txt')` continuent de passer).

`.claude/hooks/worktree-scope-guard.sh` — découper le verdict sur la première tabulation
(`reason="${verdict%%$'\t'*}"; corrected="${verdict#*$'\t'}"` ; sans tabulation,
`corrected=""`). Conserver les paragraphes d'explication existants ; remplacer le paragraphe
de clôture (« Re-target the same file… ») par, quand `corrected` est non vide :

```
The writable copy of that file in THIS worktree is:

  ${corrected}

Retry the SAME change against that exact path. If the Edit's old_string no longer
matches there, Read that path first — what you read before came from the other tree.
If a sub-agent payload named the blocked path, the corrected path above is what the
payload should have carried (next-task.md § Handoff discipline: absolute, worktree-rooted).
```

**Tests** — étendre `src/__tests__/worktree-scope-guard.test.ts` : (a) verdict de blocage sur
`<family>/CLAUDE.md` porte une tabulation et le chemin corrigé `<top>/CLAUDE.md` ; (b) blocage
sur `<family>/.claude/worktrees/other-session/foo.ts` corrige en `<top>/foo.ts` (le préfixe
worktree est retiré) ; (c) la stderr du wrapper `.sh` (fixture `git worktree add` réelle, comme
les tests de wrapper existants) contient le chemin absolu corrigé.

#### Étape 4 — S1 amont : la bannière worktree dans `context-router.sh`

`.claude/hooks/context-router.sh` — après la ligne `[ -z "$PROMPT" ] && exit 0` et avant le
premier `case`, ajouter (appels git en lecture seule, discipline « toujours exit 0 » préservée) :

```bash
top="$(git rev-parse --show-toplevel 2>/dev/null)"
common="$(git rev-parse --git-common-dir 2>/dev/null)"
if [ -n "$top" ] && [ -n "$common" ]; then
  topr="$(readlink -f "$top" 2>/dev/null)"
  family="$(dirname "$(readlink -f "$common" 2>/dev/null)")"
  if [ -n "$topr" ] && [ -n "$family" ] && [ "$topr" != "$family" ]; then
    add "WORKTREE — this session's writable tree is ${topr}. CLAUDE.md, .claude/* and skills you read under ${family}/ are ANOTHER COPY of the repo: every Edit/Write goes to ${topr}/<same relative path>, and a write to the ${family} copy is refused by a hook."
  fi
fi
```

Attaque la cause côté driver (le driver compose les payloads des sous-agents, et next-task.md
§ Handoff discipline exige déjà des chemins absolus enracinés dans la worktree). Les
sous-agents ne voient jamais la sortie UserPromptSubmit — c'est pourquoi le refus à chemin
corrigé de l'étape 3 reste le filet pour eux. Coût : une ligne d'environ 50 tokens par prompt,
uniquement dans une worktree.

**Test** — nouveau `src/__tests__/context-router.test.ts` : construire une fixture repo réel +
`git worktree add` (reprendre le patron `makeRoots`-avec-git-réel des tests de wrapper), lancer
`bash .claude/hooks/context-router.sh` avec `cwd` = la worktree et stdin `{"prompt":"hello"}`,
`SPO_SESSION_DIR` sur un temporaire ; vérifier que stdout contient `WORKTREE —` et les deux
chemins. Relancer avec `cwd` = le checkout principal ; vérifier l'absence de ligne `WORKTREE`.
Prompt vide → stdout vide.

#### Étape 5 — S2 : `verdict-pipe-guard` nomme la forme allowlistée en premier

`.claude/hooks/verdict-pipe-guard.sh` :

1. Dans la liste `VERDICT` (lignes actuellement en :87–89 du programme node embarqué), ajouter
   `verdict` à l'alternance `npm run` :
   `/^npm\s+run\s+(?:coverage|deps:gate|verdict)\b/` — un pipe sur `npm run verdict` détruit
   son code de sortie de la même façon.
2. Dans le programme node, dériver un alias depuis la tête du coupable : `npm test*` → `test` ;
   `npm run <X>` → `<X>` si `<X>` est dans la liste blanche de l'étape 1 ; `jest`/`npx jest` →
   `test` ; `tsc`/`npx tsc` → `typecheck` ; `eslint`/`npx eslint` → `lint` ; sinon aucun.
   Émettre `pipe\t<coupable>\t<alias-ou-vide>`.
3. Dans le `case` shell, quand un alias est revenu, le bloc de forme suggérée devient :

```
Run it through the allowlisted wrapper instead — one call, real exit code, short tail:

  npm run verdict -- <alias> [--tail=40]

(full log lands under ~/.spo-bench/logs/, EXIT=<code> is the last line, and the
command's exit code is preserved.)
```

suivi du paragraphe alternatif `set -o pipefail` existant, inchangé. Quand aucun alias ne
correspond (p. ex. `npm run gate | head`), le message manuel actuel reste tel quel.

**Test** — nouveau `src/__tests__/verdict-pipe-guard.test.ts` pilotant le `.sh` avec des
payloads JSON via `execFileSync('bash', [WRAPPER], {input, env})`, vérifiant statut et stderr :
`npm test | tail -20` → code 2, stderr contient `npm run verdict -- test` ;
`npm run coverage:changed | grep -E 'fail'` → code 2, contient
`npm run verdict -- coverage:changed` ; `npm run verdict -- test | head` → code 2 (nouvelle
entrée VERDICT) ; `npm run gate | head` → code 2, **sans** suggestion `npm run verdict --` ;
`set -o pipefail; npm test 2>&1 | tail -40` → code 0 ; un heredoc citant `npm test | tail` →
code 0.

#### Étape 6 — S4 : `poll-loop-guard` apprend le nouvel alias et substitue les identifiants concrets

`.claude/hooks/poll-loop-guard.sh` :

1. Ajouter `verdict` aux deux alternances de commandes-verdict (regex `backgrounded` et
   `compound`) : `(?:gate|test|test:live|typecheck|lint|build|verdict)`.
2. Substitution concrète (RC3 appliquée) : dans le programme node, quand le verdict est
   `bench`, extraire le premier jeton `job-[0-9a-f]{6,}` du texte ; quand c'est `pr`, extraire
   le numéro via `/\bgh\s+pr\s+\w+\s+(\d+)/` ou `/pulls\/(\d+)/`. Émettre
   `bench\t<id-ou-vide>` / `pr\t<n-ou-vide>` ; le `case` shell imprime
   `npm run bench:wait -- job-abc123` / `npm run pr:wait -- 276` quand un identifiant a été
   trouvé, le placeholder `<job-id>` / `<pr-number>` actuel sinon. **Aucun changement de ce qui
   est bloqué ou autorisé.**

**Test** — nouveau `src/__tests__/poll-loop-guard.test.ts`, même forme sous-processus : les
trois commandes historiquement observées dans l'en-tête du hook (code 2, et pour la première
stderr contenant l'identifiant `job-` concret ; pour les boucles PR, stderr contenant
`pr:wait -- 276`) ; `npm run verdict -- test &` → code 2 (`amp`) ;
`{command: "npm run verdict -- test; echo done", run_in_background: true}` → code 2
(`compound`) ; le même composé en avant-plan → code 0 ;
`npm run gate > log 2>&1` avec `run_in_background: true` → code 0.

#### Étape 7 — S5 : `legacy-search-guard.sh` — le seul nouveau blocage dur, et son câblage

**Décision (question 4) : oui, la recherche shell des corpus légataires est bloquée d'emblée.**
C'est le seul endroit où un refus dur d'une demande légitime est le bon arbitrage, pour une
raison qu'aucun autre garde n'a : ici **la commande approuvée est le résultat dangereux**. Une
demande de permission interrompt la session et, si l'humain la laisse passer, rend une sortie
vide en code 0 ou une liste de 2 fichiers sur 15 sur terrain d'archéologie RDO — un faux « pas
de déclaration serveur » qui coule vers un `kind`/`arity` faux dans `src/shared/rdo-members.ts`,
que CLAUDE.md documente comme gel / écriture mémoire arbitraire / crash, rattrapé par aucun
test. La forme sûre (outils `Grep`/`Glob`, `path: ~/SPO-Original`) est déjà allowlistée et sans
demande, gère les fichiers ISO-8859, et ne découpe jamais `Interface Server/` ni ne s'étouffe
sur `Pastel's mp3/`. Convertir la demande en refus instantané avec forme corrigée supprime
l'interruption (aucune attente humaine) **et** ferme le risque de faux négatif silencieux.

Nouveau fichier `.claude/hooks/legacy-search-guard.sh` — PreToolUse(Bash), même squelette que
`verdict-pipe-guard.sh` (`node -e` en ligne, retrait des heredocs copié du même squelette, pas
de stamp de heartbeat — `bench-port-guard` estampille déjà chaque appel Bash). Logique, sur le
texte de commande une fois les heredocs retirés :

- **Test corpus :** le texte correspond à `/SPO-Original|SPO-ASP/i` (attrape `~`, l'absolu,
  `/mnt/c/...` et — délibérément — la forme relative cassée `../SPO-Original`, quoi qu'elle
  résolve).
- **Test verbe de recherche :** toute instruction (découpée sur `\n ; && || | ` `` ` `` `$(` `(`
  comme le fait `verdict-pipe-guard`) dont la tête, après retrait des affectations
  d'environnement, est `grep`, `egrep`, `fgrep`, `rg`, `ugrep`, `ag` ou `find` ; **ou** le texte
  contient `\bxargs\b`.
- Bloquer (code 2) **si et seulement si** les deux tiennent. `git grep …` ne correspond jamais
  (la tête est `git` ; il est d'ailleurs sûr : pas de xargs, pas de découpage, un texte
  ISO-8859 sans NUL se cherche très bien). `ls`, `cat`, `file`, `wc` sur un fichier du corpus ne
  correspondent jamais — la lecture d'un fichier *nommé* échoue bruyamment, seule la
  *recherche* échoue silencieusement.
- Extraire la première chaîne entre guillemets simples ou doubles suivant le verbe de
  recherche, comme motif probable, pour substitution dans le message.

Message de refus (finit par la forme corrigée exécutable, motif extrait substitué,
placeholder `<pattern>` sinon) :

```
BLOCKED: shell search inside SPO-Original / SPO-ASP silently lies here.

Three measured failure modes, all reproduced on this machine:
 - from a session worktree, `..` resolves to .claude/worktrees/ — the path does not
   exist, `2>/dev/null` eats the error and `| head` turns exit 2 into exit 0:
   empty output indistinguishable from "the symbol does not exist";
 - `xargs grep` word-splits paths ("Interface Server/") and dies on the apostrophe in
   "Pastel's mp3/" — measured: 2 files reported instead of 15, the missing one being
   the authoritative server declaration;
 - in this shell `grep` is a bash function (Claude Code's bundled ugrep); xargs does
   not inherit it, so `xargs grep` runs a DIFFERENT grep than `grep` typed directly.

A false negative here feeds a wrong kind/arity into rdo-members.ts — freeze /
arbitrary memory write / crash, caught by no test (CLAUDE.md § RDO).

Use the allowlisted native tools instead — no prompt, correct encoding, spaces safe:

  Grep tool:  pattern: "<extracted pattern>"   path: "/home/crazz/SPO-Original"   glob: "*.pas"
  Glob tool:  pattern: "**/*.pas"              path: "/home/crazz/SPO-Original"

(delphi-archaeologist skill; cite File.pas:Line.)
```

Câblage : dans `.claude/settings.json`, insérer un bloc de hook
`bash .claude/hooks/legacy-search-guard.sh`, timeout 10, dans la liste PreToolUse `Bash`, après
`item-list-guard` et avant `poll-loop-guard`. **Aucun autre changement de settings ; les 74
entrées `allow` et les 17 `deny` ne sont pas touchées.**

**Test** — nouveau `src/__tests__/legacy-search-guard.test.ts`, forme sous-processus. Cas
bloqués (code 2) : les deux commandes mesurées, verbatim (stderr contient `GetChannelInfo` et
`Grep tool`) ; `rg GetChannelInfo ../SPO-Original` ;
`find /home/crazz/SPO-ASP -name '*.asp' | xargs grep -l canModify`. Cas autorisés (code 0) :
`grep -rn foo src/` (pas de corpus) ; `git grep -n GetChannelInfo -- '*.pas'` ;
`ls ~/SPO-Original/Rdo/Server/` ; `cat "$HOME/SPO-Original/Rdo/Server/RDOObjectServer.pas"` ;
un `grep … SPO-Original` cité dans un heredoc (une doc n'est pas une exécution) ; un payload
d'outil Edit (le garde ne lit que les payloads Bash).

#### Étape 8 — S3 et S6 : aucun changement de code, dit explicitement

`driver-scope-guard` n'est pas touché — ses 5 blocages sont le blocage voulu et précieux, son
message distingue déjà les remèdes création/édition et donne des commandes concrètes, et il n'a
produit aucun réessai identique. Le terrain du classifieur automode (4 blocages sur
`.claude/agents/change-validator.md`) est côté harnais, illisible depuis le dépôt, et n'est pas
contourné : aucun hook, aucune entrée deny, aucun contournement. **Ne rien faire** sur les deux.

### Carte 3 — orienter les agents avant qu'ils n'agissent (area `docs`, bloquée par la Carte 2)

#### Étape 9 — `CLAUDE.md`

- § Commands : ajouter une ligne —
  `npm run verdict -- <alias> [--tail=N]  # lance test/typecheck/lint/… avec le log complet dans ~/.spo-bench/logs/, imprime le tail + EXIT=<code>, préserve le code de sortie — la façon sanctionnée de garder court le transcript d'un verdict`.
- § Automation (tableau) : ajouter la ligne `legacy-search-guard.sh` (`PreToolUse (Bash)` —
  « Bloque grep/find/xargs shell contre SPO-Original / SPO-ASP (faux négatifs silencieux sur
  l'archéologie RDO) ; nomme la forme outil Grep/Glob »).
- § Legacy Delphi source : après l'avertissement ISO-8859, une phrase — chercher dans le corpus
  **uniquement** avec les outils Grep/Glob (`path: ~/SPO-Original`) ; la recherche shell y est
  refusée par un hook, pas seulement soumise à permission.

#### Étape 10 — `.claude/skills/delphi-archaeologist/SKILL.md`

- Workflow Explore, étape 3 (« Surface scan ») : réécrire pour nommer l'appel d'outil exact —
  outil Grep avec `pattern`, `path: /home/crazz/SPO-Original/<sous-répertoire>`,
  `glob: "*.pas"` — jamais `grep`/`find`/`xargs` shell.
- Safety Rules : ajouter une puce avec les trois modes d'échec en une ligne chacun (`..` en
  worktree, découpage/apostrophe de xargs, grep-est-une-fonction) et le fait que le hook refuse
  les formes shell.

#### Étape 11 — `.claude/commands/next-task.md`

Dans le bloc d'introduction « Run the scripted steps verbatim », ajouter une phrase après le
paragraphe pipe/allowlist : quand la sortie d'une commande-verdict serait longue,
l'abréviation sanctionnée est `npm run verdict -- <alias>` — allowlistée, code de sortie
préservé ; jamais un pipe, jamais un `tail` nu.

La Carte 3 n'a pas de code : ses tests sont les suites de cohérence existantes — lancer
`npm test` et `node scripts/check-command-aliases.js`.

---

## 3 · Les six schémas — table de disposition

| Schéma | Disposition | Raison |
|---|---|---|
| S1 écriture dans le mauvais arbre (13) | **Reste bloqué ; cause supprimée en amont + refus redessiné** (étapes 3–4) | Écrire dans le checkout principal n'est jamais sûr (autres sessions, `main` sorti, contournement de la chaîne de branche) — mais l'intention est correcte, donc le refus rend désormais le chemin écrivable exact, et la bannière empêche le mauvais chemin d'être formé. Silent-allow et redirection silencieuse rejetés (risque de diff périmé, le modèle n'apprend jamais, la piste d'audit ment). |
| S2 pipe sur un verdict (10) | **Supprimé par redesign** (étapes 1, 5) | Besoin permanent et légitime ; `npm run verdict` est la forme allowlistée en un appel, donc le pipe n'est jamais composé. Le garde reste pour le résiduel et nomme maintenant l'alias. |
| S3 petite correction par le driver (5) | **Conservé, intact** | Exactement le blocage « un driver fait ce qu'un driver ne doit pas » que le mainteneur veut garder. Aucun réessai identique observé ; le message porte déjà les deux remèdes. |
| S4 ne pas bloquer sur une commande longue (4) | **Reste bloqué ; motif partiellement supprimé** (étapes 1, 6) | Les blocages protègent le verdict lui-même. Les messages finissaient déjà par des formes exécutables (zéro réessai) ; ils substituent désormais l'identifiant de job / le numéro de PR concrets, et `npm run verdict` supprime le motif du composé en avant-plan. |
| S5 recherche shell du corpus (3 + risque silencieux) | **Converti de demande en blocage dur avec la forme correcte** (étapes 7, 9, 10) | Le seul cas où une commande approuvée est pire qu'une commande refusée : faux négatifs silencieux sur la surface la plus chère, rattrapés par aucun test. La forme sûre est allowlistée et nommée, motif extrait substitué. |
| S6 édition de l'instruction qui gouverne (4) | **Conservé, intact** | Blocage critique légitime ; le classifieur est côté harnais et n'est ni contourné ni combattu. |

**Réponse à la question 1, en une ligne :** aucune interruption n'est supprimée par une
nouvelle entrée `allow` — **zéro changement d'allowlist**. Les candidats (`tail`, `head`,
`cat`, `grep`, `find`, `xargs`) sont exclus délibérément par CLAUDE.md § Environment, et les
légaliser légaliserait exactement les formes malformées que S2/S5 mesurent comme dangereuses.
Chaque suppression est une cause retirée en amont (étapes 1, 4, 9–11) ou un refus qui enseigne
la forme correcte en un tour (étapes 3, 5, 6, 7).

**Question 6 — rien n'est affaibli :** `driver-scope-guard`, le terrain du classifieur,
`pre-push-gate`, `bench-port-guard`, `item-list-guard`, `main-commit-guard`, les 17 entrées
`deny` et les règles de fichiers RDO gelés ne sont touchés par aucune étape. Le seul changement
de `settings.json` **ajoute** un garde. `verdict-pipe-guard` et `poll-loop-guard` finissent le
plan en bloquant strictement **plus** qu'avant (l'alias `verdict` rejoint leurs listes).

**Question 7 — `journal-writes` reste en observation seule.** Un hook PostToolUse ne peut pas
empêcher ; les fichiers qu'il surveille sont tous rejugés au merge (`check-pr-rules.js` + le
check CI requis + le statut `bench/gate`) ; il n'y a pas de destinataire vivant pour une alerte
(le mainteneur lit les PR et le board, pas un canal) ; et une alerte-sur-écriture se
déclencherait sur toute carte hooks légitime — y compris les trois cartes de ce plan. Ne rien
faire.

---

## 4 · Ce que le plan ne corrige délibérément pas

- **Les 4 blocages du classifieur automode et leurs réessais.** Côté harnais, illisibles,
  explicitement hors périmètre. Les réessais sont RC3, mais le message n'est pas le nôtre.
- **Les 3 refus humains et les 4 autres/en attente.** Pas rattachables avec certitude à une
  cause côté dépôt ; certains recoupent S5 et sont couverts incidemment, aucun n'est revendiqué.
- **L'avalement en sous-shell d'avant-plan** (`(a; b) > log; echo "EXIT=$?"` sort en 0 sur
  `(false; true)`), noté à la frontière de `poll-loop-guard.sh:104`. Le garder ajouterait un
  blocage pour poursuivre un symptôme ; le correctif de cause est déjà livré —
  `npm run verdict -- typecheck` lance l'alias dont la chaîne `&&` interne propage le premier
  échec.
- **Le repli quand l'outil `Grep` est différé** (la session où `ToolSearch select:Grep` n'a rien
  trouvé). Laissé non tranché par les preuves, et `next-task.md` prescrit déjà la reprise
  (charger le schéma → sous-agent → s'arrêter ; jamais le shell). Le garde de l'étape 7 impose
  désormais la moitié « jamais le shell » pour les corpus.
- **Les worktrees préexistantes.** Elles lisent leurs propres copies des hooks et des settings ;
  rien ne peut les rétrofitter, et le plan ne le prétend pas.
- **L'alerte `journal-writes`** — voir ci-dessus.

---

## 5 · Suppression estimée, sur les 43 du jour

| Étape | Schéma | Supprimées | Base |
|---|---|---|---|
| 1–2 `npm run verdict` + message 5 | S2 (10) | **9–10** | Le pipe n'est jamais composé une fois la forme en un appel disponible ; le résiduel se corrige en un tour via le nouveau message. |
| 3 refus à chemin corrigé | S1 (13) | **~7** (tous les réessais identiques) | Mesuré : les gardes qui rendent la forme n'ont aucun réessai identique ; 13 blocages = ~6 intentions distinctes + 7 rejeux. |
| 4 bannière worktree | reste de S1 | **~4–6 des ~6 premières occurrences** | Formation du chemin empêchée côté driver ; les fuites côté sous-agent restent possibles mais se résolvent en un tour via l'étape 3. |
| 6 substitution poll-loop + alias verdict | S4 (4) | **2–3** | Motif du composé en avant-plan et de la chaîne en fond supprimé ; le cas `&` sur gate reste une correction en un tour. |
| 7 legacy-search-guard + docs 9–10 | S5 (3) | **3 comme interruptions humaines** | Demande → refus guidé instantané (aucune attente humaine) → outil natif ; plus la fermeture du risque de faux négatif non testable. |
| — (conservés par choix) | S3 (5) + S6 (4) | **0** | Les blocages voulus. |
| — (non revendiqués) | humain 3 / autre 4 | **0–2** | Recoupement partiel avec S5 seulement. |

**Net : environ 25–29 des 43 cessent d'exister ; du reste, ~9 sont les blocages voulus et les
autres se résolvent en un seul tour corrigé au lieu d'une boucle de réessais.**

---

## Fichiers critiques pour l'implémentation

- `.claude/hooks/worktree-scope-guard.sh` et `.claude/hooks/worktree-scope-guard.js`
- `.claude/hooks/verdict-pipe-guard.sh`
- `.claude/hooks/poll-loop-guard.sh`
- `.claude/hooks/context-router.sh`
- `scripts/run-verdict.sh` (nouveau) et `package.json`
- `.claude/hooks/legacy-search-guard.sh` (nouveau) et `.claude/settings.json` (câblage)
