# CLASSES.BIN test fixture

`BuildingClasses/CLASSES.BIN` is a **frozen copy** of the real building-class archive, committed
so that the three suites that read it run in CI instead of skipping:

- `src/server/classes-bin-parser.test.ts` (reads the file by path)
- `src/server/building-data-service.test.ts` and `src/server/facility-dimensions-cache.test.ts`
  (point `SPO_CACHE_DIR` at this directory for the duration of the suite)

## Provenance

| | |
|---|---|
| Origin | update server `BuildingClasses/classes.cab` — `UPDATE_SERVER.CACHE_URL` in `src/shared/constants.ts` → `http://update.starpeaceonline.com/five/client/cache/BuildingClasses/classes.cab` |
| Extracted by | `src/server/update-service.ts` (CAB extraction), into `cache/BuildingClasses/CLASSES.BIN` |
| Copied from | `/home/crazz/SPO-WebClient/cache/BuildingClasses/CLASSES.BIN` (mtime 2026-07-20 13:32:02 UTC) |
| Size | 158,344 bytes |
| sha256 | `a685b7afa9eee576ea6c51e399b0d123f1fed5c5a01ccb9524455b68efbfcb57` |
| Date copied | 2026-09-26 |

The lowercase `cache/BuildingClasses/classes.bin` extracted from the same CAB was byte-identical
(same sha256); only the uppercase name is kept.

## Frozen, not synced

When the live file on the update server changes, this fixture does **not** follow it. The tests
assert exact counts and entries of this copy (for example 863 classes). Refreshing it is a
deliberate change: replace the file, update the size, hash and date above, and re-check the
assertions.

`.gitattributes` marks `*.BIN` as binary, so git never normalises its line endings. Do not move
it under a directory named `cache/`: the `cache/` rule in `.gitignore` matches at any depth.
