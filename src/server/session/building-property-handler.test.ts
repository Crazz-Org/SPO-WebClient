/// <reference path="../__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `setBuildingProperty` — the full command matrix.
 *
 * This handler is the bottleneck of every building mutation the client can
 * trigger, and it carries the three tables that decide what goes on the wire:
 * `RDO_SET_PROPERTIES` (:136), `RDO_OBJECTID_COMMANDS` (:150) and
 * `SYNCHRONOUS_RDO_COMMANDS` (:170). A wrong entry there is not a cosmetic bug —
 * `"^"` on a Delphi `procedure` froze the shared server on 2026-08-15, and the
 * comment at :156-172 is the post-mortem of exactly that.
 *
 * So the matrix below drives the real function once per command in
 * `KNOWN_RDO_COMMANDS` and pins, in this order:
 *
 *   1. TARGET     — `ObjectId` for the ten gate commands, the INPUT GATE's own
 *                   id for the one member declared on a gate (`RDOSelSelected`,
 *                   Kernel/Kernel.pas:1623), `CurrBlock` otherwise. The fake
 *                   answers with three DIFFERENT ids (the warehouse case, plus
 *                   the gate), so a handler that always picked one fails here.
 *   2. SEPARATOR  — `"*"` everywhere, and which channel carries it: a QueryId
 *                   only exists on the `sendRdoRequest` path, never on the
 *                   fire-and-forget frames.
 *   3. VERB       — `set` for the published properties, `call` otherwise.
 *   4. ARGUMENTS  — order, arity, type prefix, `#-1`/`#0` booleans.
 *   5. ERROR PATH — refusals, empty read-backs, absent socket, timeouts.
 *
 * `building-mutations.test.ts` already covers the audit findings M-B…M-E and
 * stays as it is; this file completes the matrix around them rather than
 * repeating them.
 *
 * Delphi references are copied from the handler's own comments; the wire forms
 * are those of the live captures cited per entry.
 */

import { setBuildingProperty, KNOWN_RDO_COMMANDS } from './building-property-handler';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '../__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '../__tests__/session/fake-session-context';
import { RdoValue, RdoCommand } from '../../shared/rdo-types';
import { RdoVerb, RdoAction } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';

// ── Ids the fake server hands out ───────────────────────────────────────────

/**
 * `CurrBlock` and `ObjectId` are deliberately DIFFERENT and neither is a
 * coordinate, a session id (`FAKE_CONTEXT_IDS`) or a value any test passes in.
 * For most buildings the server returns the same id twice; for warehouses it
 * does not, and that is the case that tells the two tables apart. Shapes follow
 * the live captures.
 */
const CURR_BLOCK = '40133497';
const OBJECT_ID = '40133512';
/**
 * The INPUT GATE's own id — a third, distinct object. `RDOSelSelected` is
 * declared on `TPullInput` (Kernel/Kernel.pas:1623), and the id the reference
 * client binds it to is the one written on every cache object,
 * `Cache.WriteInteger(ppObjId, integer(Obj))` (Cache/CacheAgent.pas:89), read
 * off the GATE header (Voyager/SupplySheetForm.pas:1001).
 */
const GATE_OBJECT_ID = '40134021';

/** Cacher handles — the pool ids the handler must thread through unchanged. */
const TEMP_OBJECT_ID = 'cacher-obj-7';

/** What the read-back reports unless a test says otherwise. */
const READ_BACK = '42';
/** What the construction socket answers to `get RDOAcceptCloning`. */
const LIVE_CLONING = '-1';

/**
 * The gate every supply-chain row addresses, and the two cache paths the
 * building publishes for it.
 *
 * Shapes are the Delphi ones: an input gate's path carries the `%.8x` gate index
 * in front of the name (`Format('%.8x', [MetaInput.Index]) + '.' +
 * MetaInput.Name + '.five\'`, Kernel/KernelCache.pas:491), an output's carries
 * the bare name (:634). A second, non-matching gate sits alongside so a handler
 * that took the first path it found — rather than the one named by `fluidId` —
 * fails here.
 */
const GATE_FLUID = 'Plastics';
const OTHER_FLUID = 'Cotton';
const FACILITY_PATH = 'Worlds\\Helartia\\Towns\\Aldebaran.five\\Facilities\\706.436.five\\';
const INPUT_PATHS = [
  `${FACILITY_PATH}Inputs\\00000000.${OTHER_FLUID}.five\\`,
  `${FACILITY_PATH}Inputs\\00000001.${GATE_FLUID}.five\\`,
];
const OUTPUT_PATHS = [
  `${FACILITY_PATH}Outputs\\${OTHER_FLUID}.five\\`,
  `${FACILITY_PATH}Outputs\\${GATE_FLUID}.five\\`,
];

/** Server-side identifiers resolved from a row index (see §"dynamic ids"). */
const RESOLVED_TAX_ID = '110';
const RESOLVED_MINISTRY_ID = '77';

const X = 706;
const Y = 436;

// ── Harness ─────────────────────────────────────────────────────────────────

/**
 * A context whose construction socket exists and whose cacher answers the three
 * questions this handler asks: the target ids, the occasional index→id lookup,
 * and the read-back. Every answer is declared here, never defaulted by the
 * shared factory.
 */
function makeConstructionCtx(options: {
  currBlock?: string;
  objectId?: string | null;
  readBack?: string[];
  sockets?: string[];
  /** `null` reproduces a session where the InitClient push has not landed yet. */
  fTycoonProxyId?: number | null;
  /** Value the construction socket answers to `get RDOAcceptCloning`. */
  liveCloning?: string;
  /**
   * Gate paths the facility object publishes, per side. `[]` reproduces a
   * building with no gate of that kind at all.
   */
  inputPaths?: string[];
  outputPaths?: string[];
} = {}): FakeSessionCtx {
  const {
    currBlock = CURR_BLOCK,
    objectId = OBJECT_ID,
    readBack = [READ_BACK],
    sockets = ['construction'],
    fTycoonProxyId = FAKE_CONTEXT_IDS.tycoonProxyId,
    liveCloning = LIVE_CLONING,
    inputPaths = INPUT_PATHS,
    outputPaths = OUTPUT_PATHS,
  } = options;

  const fake = makeSessionCtx({ sockets, fTycoonProxyId });
  // AcceptCloning is confirmed by a live get, not by the cacher.
  fake.respond((packet) => (
    packet.member === 'RDOAcceptCloning' ? `RDOAcceptCloning="#${liveCloning}"` : ''
  ));
  fake.cacher.createObject.mockResolvedValue(TEMP_OBJECT_ID);
  fake.cacher.getPropertyList.mockImplementation(async (_id: string, props: string[]) => {
    if (props[0] === 'CurrBlock') {
      return objectId === null ? [currBlock] : [currBlock, objectId];
    }
    if (/^Tax\d+Id$/.test(props[0])) return [RESOLVED_TAX_ID];
    if (/^MinistryId\d+$/.test(props[0])) return [RESOLVED_MINISTRY_ID];
    // The gate listing `TBlock.StoreToCache` writes on the facility object —
    // `InputCount`/`InputPath{i}` (Kernel/Kernel.pas:5848,5853),
    // `OutputCount`/`OutputPath{i}` (:5865,:5869).
    if (props[0] === 'InputCount') return [String(inputPaths.length)];
    if (props[0] === 'OutputCount') return [String(outputPaths.length)];
    if (/^InputPath\d+$/.test(props[0])) return props.map((_, i) => inputPaths[i] ?? '');
    if (/^OutputPath\d+$/.test(props[0])) return props.map((_, i) => outputPaths[i] ?? '');
    // `ObjectId` alone is the GATE's own id, read after SetPath landed on it
    // (Cache/CacheAgent.pas:89) — not the facility pair above.
    if (props.length === 1 && props[0] === 'ObjectId') return [GATE_OBJECT_ID];
    return readBack;
  });
  return fake;
}

/**
 * Every fire-and-forget branch sleeps 200 ms before the read-back (:186, :190,
 * :225). Forty-two commands × 200 ms would blow through `testTimeout`, so time
 * is faked and advanced explicitly. `advanceTimersByTimeAsync` drains the
 * microtask queue as it goes, which is what lets the awaited cacher promises
 * resolve; `runAllTimers` would spin on the health-check intervals other modules
 * install.
 */
async function settle<T>(pending: Promise<T>, ms = 200): Promise<T> {
  await jest.advanceTimersByTimeAsync(ms);
  return pending;
}

/** The single frame the construction socket received, or a failure. */
function onlyFrame(fake: FakeSessionCtx): string {
  expect(fake.frames.construction).toHaveLength(1);
  return fake.frames.construction[0];
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════════════════
// The matrix — one row per member of KNOWN_RDO_COMMANDS
// ═══════════════════════════════════════════════════════════════════════════

interface MatrixEntry {
  /** The command name, exactly as `KNOWN_RDO_COMMANDS` spells it. */
  command: string;
  /** The `value` argument of `setBuildingProperty`. */
  value: string;
  /** `additionalParams`, i.e. what `buildRdoCommandArgs` (:285) requires. */
  params?: Record<string, string>;
  /** Expected arguments, in order — the contract of `buildRdoCommandArgs`. */
  args: RdoValue[];
  /**
   * Which id the frame must select. `gate` is the input gate's own ObjectId —
   * a third object, and the only legal target of a member declared on the gate.
   */
  target: 'currBlock' | 'objectId' | 'gate';
  /** `call` unless the member is a published property (`RDO_SET_PROPERTIES`). */
  verb: 'call' | 'set';
  /** `frame` = fire-and-forget, no QueryId. `request` = synchronous, QueryId. */
  channel: 'frame' | 'request';
  /**
   * Property `mapRdoCommandToPropertyName` asks for on the read-back, or `null`
   * when the command has no witness and the handler must skip verification
   * entirely rather than manufacture a verdict.
   */
  readBack: string | null;
  /**
   * What the witness holds once this row's write has landed — the value the
   * cache would answer, which is not always the one we sent (`AutoProd` is a
   * word, `srvPrices{i}` is halved and doubled back).
   *
   * Absent means the witness cannot answer the question at all: it is a count,
   * an aggregate, a derived figure, or it lives on a sub-object the
   * verification read never reaches. Those rows must report `confirmed:
   * undefined` however the cacher answers — OB-28, where "the property is
   * readable" was taken for "the write landed".
   */
  echo?: string;
  /**
   * The confirmation is a live `get` on CurrBlock, not a cacher read. Only
   * AcceptCloning: TBlock.StoreToCache (Kernel/Kernel.pas:5824-5905) never
   * writes it, so the cacher would answer '' and report every correct write as
   * unconfirmed.
   */
  liveReadBack?: true;
}

const MATRIX: readonly MatrixEntry[] = [
  // ── Published property: SET, not CALL ────────────────────────────────────
  // `property RDOAcceptCloning : boolean read fAcceptCloning write fAcceptCloning`
  // — Kernel/Kernel.pas:1347, verified. (The handler's own comment cites :1304,
  // which is the neighbouring private field; the claim holds, the line is stale.)
  {
    command: 'RDOAcceptCloning', value: '1',
    args: [RdoValue.int(-1)],
    target: 'currBlock', verb: 'set', channel: 'frame', readBack: 'AcceptCloning',
    liveReadBack: true,
  },

  // ── Booleans as WordBool: #-1 / #0, never #1 ─────────────────────────────
  {
    // `Cache.WriteString('AutoProd', 'YES'/'NO')` — MovieStudios.pas:770-772.
    // The wordbool we emit is never what comes back.
    command: 'RDOAutoProduce', value: '1',
    args: [RdoValue.int(-1)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'AutoProd',
    echo: 'YES',
  },
  {
    // `fSelected := value` (Kernel/Kernel.pas:7891) reaches the cache as a word
    // boolean — `Cache.WriteBoolean('Selected', fSelected)` (:7815) writes '1'
    // (Cache/CacheAgent.pas:150-152), never the `#-1` we emit. `fluidId` is not
    // a wire argument here (the member takes one WordBool); it names the input
    // gate — both the object the frame is ADDRESSED to and the one the witness
    // is read from. The member is declared on `TPullInput`
    // (Kernel/Kernel.pas:1623), not on TBlock, so neither block id would reach
    // it; Voyager binds the id it read off the gate header
    // (Voyager/SupplySheetForm.pas:1001 -> :1100 -> :697-699).
    command: 'RDOSelSelected', value: '1', params: { fluidId: GATE_FLUID },
    args: [RdoValue.int(-1)],
    target: 'gate', verb: 'call', channel: 'frame', readBack: 'Selected',
    echo: '1',
  },

  // ── Ministries (MinisteriesSheet.pas:251/271/293) ────────────────────────
  // `ministryId` (9) is the wire argument — the actual MinistryId a caller may
  // have resolved. `index` (3) is the row position, and it is what the witness
  // is keyed by (WorldPolitics.pas:1354/1357/1358): a fixture where the two
  // disagree is the only one that catches a regression back to `ministryId`.
  {
    command: 'RDOBanMinister', value: '0', params: { ministryId: '9', index: '3' },
    args: [RdoValue.int(9)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'Minister3',
  },
  {
    command: 'RDOSitMinister', value: '0', params: { ministryId: '9', ministerName: 'innos', index: '3' },
    args: [RdoValue.int(9), RdoValue.string('innos')],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'Minister3',
    // `Tycoon.AssumeRole(Min)` makes `Minister.MasterRole` the tycoon looked up
    // by name (WorldPolitics.pas:1719,1726) — the cache echoes that name.
    echo: 'innos',
  },
  {
    command: 'RDOSetMinistryBudget', value: '3000', params: { ministryId: '9', index: '3' },
    args: [RdoValue.int(9), RdoValue.string('3000')],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'MinisterBudget3',
    // `Min.YearBudget := StrToCurr(Budget)` (WorldPolitics.pas:1688,1692).
    echo: '3000',
  },

  // ── Mausoleum (MausoleumSheet.pas) ───────────────────────────────────────
  {
    command: 'RDOCacncelTransc', value: '0',
    args: [], // the Delphi typo is load-bearing: the member really is spelled that way
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'Transcended',
    // WriteBoolean writes '1'/'0' (Cache/CacheAgent.pas:150-152); the
    // cancellation clears the flag (TranscendBlock.pas:202).
    echo: '0',
  },
  {
    command: 'RDOSetWordsOfWisdom', value: 'Carpe diem',
    args: [RdoValue.string('Carpe diem')],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'WordsOfWisdom',
    echo: 'Carpe diem', // stored verbatim — TranscendBlock.pas:216 / cache :200
  },

  // ── Movie studio (FilmsSheet.pas:330/350, MovieStudios.pas) ──────────────
  {
    command: 'RDOCancelMovie', value: '0',
    args: [RdoValue.int(0)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'InProd',
  },
  {
    command: 'RDOReleaseMovie', value: '0',
    args: [RdoValue.int(0)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'InProd',
  },
  {
    command: 'RDOLaunchMovie', value: '0',
    params: { filmName: 'Le Grand Bleu', budget: '2500000', months: '6', autoRel: '1', autoProd: '1' },
    // autoInfo bitmask: flgAutoRelease=$01 | flgAutoProduce=$02 → 3
    args: [RdoValue.string('Le Grand Bleu'), RdoValue.double(2500000), RdoValue.int(6), RdoValue.int(3)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'InProd',
    // `Cache.WriteString('InProd', 'YES')` while a project exists —
    // MovieStudios.pas:763. Its siblings above END the project, so their
    // success is this property's absence: no echo, no verdict.
    echo: 'YES',
  },

  // ── Research — no read-back mapping, falls through to the default ────────
  {
    command: 'RDOCancelResearch', value: '0', params: { inventionId: 'Combustion' },
    args: [RdoValue.string('Combustion')],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'RDOCancelResearch',
  },
  {
    command: 'RDOQueueResearch', value: '0', params: { inventionId: 'Combustion', priority: '5' },
    args: [RdoValue.string('Combustion'), RdoValue.int(5)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'RDOQueueResearch',
  },

  // ── Supply chain — the ten ObjectId commands ─────────────────────────────
  // Both connect members are `procedure` (Kernel/Kernel.pas:1077-1078): the call
  // waits for the ack, but the separator stays "*". Conflating the two is what
  // put "^" here and froze the server.
  {
    command: 'RDOConnectInput', value: '0', params: { fluidId: 'Plastics', connectionList: '706,436,' },
    args: [RdoValue.string('Plastics'), RdoValue.string('706,436,')],
    target: 'objectId', verb: 'call', channel: 'request', readBack: 'cnxCount',
  },
  {
    command: 'RDOConnectOutput', value: '0', params: { fluidId: 'Plastics', connectionList: '706,436,' },
    args: [RdoValue.string('Plastics'), RdoValue.string('706,436,')],
    target: 'objectId', verb: 'call', channel: 'request', readBack: 'cnxCount',
  },
  {
    // Live capture: RDODisconnectInput "*" "%Plastics","%706,436," (handler :145)
    command: 'RDODisconnectInput', value: '0', params: { fluidId: 'Plastics', connectionList: '706,436,' },
    args: [RdoValue.string('Plastics'), RdoValue.string('706,436,')],
    target: 'objectId', verb: 'call', channel: 'frame', readBack: 'cnxCount',
  },
  {
    command: 'RDODisconnectOutput', value: '0', params: { fluidId: 'Plastics', connectionList: '706,436,' },
    args: [RdoValue.string('Plastics'), RdoValue.string('706,436,')],
    target: 'objectId', verb: 'call', channel: 'frame', readBack: 'cnxCount',
  },
  {
    // `Output.PricePerc := Price` (Kernel/Kernel.pas:4344) assigns fPricePerc
    // with no clamp (:7193-7198) and the gate cache echoes it —
    // `WriteInteger('PricePc', PricePerc)` (Kernel/KernelCache.pas:753).
    command: 'RDOSetOutputPrice', value: '220', params: { fluidId: 'Plastics' },
    args: [RdoValue.string('Plastics'), RdoValue.int(220)],
    target: 'objectId', verb: 'call', channel: 'frame', readBack: 'PricePc',
    echo: '220',
  },
  {
    // `Input.MaxPrice := MaxPrice` (Kernel/Kernel.pas:4402) writes fMaxPrice
    // directly (:1591); `TPullInput.StoreToCache` echoes it (:7813).
    command: 'RDOSetInputMaxPrice', value: '500', params: { fluidId: 'Plastics' },
    args: [RdoValue.string('Plastics'), RdoValue.int(500)],
    target: 'objectId', verb: 'call', channel: 'frame', readBack: 'MaxPrice',
    echo: '500',
  },
  {
    // `Input.MinK := MinK` (Kernel/Kernel.pas:4428), cached as `MinK` (:7814)
    // and read as `minK` — the cache lookup is a TStringList name.
    command: 'RDOSetInputMinK', value: '10', params: { fluidId: 'Plastics' },
    args: [RdoValue.string('Plastics'), RdoValue.int(10)],
    target: 'objectId', verb: 'call', channel: 'frame', readBack: 'minK',
    echo: '10',
  },
  {
    // `CacheExtraInfo('CnxInfo'+i, ...)` writes `'OverPrice'+Name`
    // (Kernel/KernelCache.pas:473-483, call at :580) — one key per connection,
    // never the bare `OverPriceCnxInfo`. No `echo`: it is written by
    // `TInputCacheAgent`, a per-input sub-object, while the verification read
    // binds by (x, y) and lands on the facility — it comes back empty either way.
    command: 'RDOSetInputOverPrice', value: '20', params: { fluidId: 'Plastics', index: '1' },
    args: [RdoValue.string('Plastics'), RdoValue.int(1), RdoValue.int(20)],
    target: 'objectId', verb: 'call', channel: 'frame', readBack: 'OverPriceCnxInfo1',
  },
  {
    // The first argument is the MODEL SERVER POINTER (fTycoonProxyId), never the
    // persistent tycoonId: the handler dereferences it — `TTycoon(pointer(...))`
    // (Kernel/Kernel.pas:4534) — and swallows the resulting AV (:4576-4578), so
    // the wrong id costs a silent no-op. Asserting the proxy id here is the
    // point of the row. `readBack: null` because no property witnesses the
    // outcome; see mapRdoCommandToPropertyName.
    command: 'RDOConnectToTycoon', value: '0', params: { kind: '2' },
    args: [
      RdoValue.int(FAKE_CONTEXT_IDS.tycoonProxyId),
      RdoValue.int(2),
      RdoValue.int(-1),
    ],
    target: 'objectId', verb: 'call', channel: 'frame', readBack: null,
  },
  {
    // No browser-supplied tycoonId override: the session is the only source.
    command: 'RDODisconnectFromTycoon', value: '0', params: { kind: '1' },
    args: [
      RdoValue.int(FAKE_CONTEXT_IDS.tycoonProxyId),
      RdoValue.int(1),
      RdoValue.int(-1),
    ],
    target: 'objectId', verb: 'call', channel: 'frame', readBack: null,
  },

  // ── Supply chain — CurrBlock side ────────────────────────────────────────
  {
    // `SetSortMode` masks the mode to one bit (Kernel/MediaGates.pas:374-382)
    // and the gate cache echoes that bit (:389).
    command: 'RDOSetInputSortMode', value: '1', params: { fluidId: 'Plastics' },
    args: [RdoValue.string('Plastics'), RdoValue.int(1)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'SortMode',
    echo: '1',
  },
  {
    command: 'RDOSetCompanyInputDemand', value: '75', params: { index: '1' },
    args: [RdoValue.int(1), RdoValue.int(75)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'cInputDem1',
  },
  {
    command: 'RDOSetInputFluidPerc', value: '80',
    args: [RdoValue.int(80)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'nfActualMaxFluidValue',
  },

  // ── Prices, trade, roles ─────────────────────────────────────────────────
  {
    command: 'RDOSetPrice', value: '220', params: { index: '2' },
    args: [RdoValue.int(2), RdoValue.int(220)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'srvPrices2',
    // Halved on the way in, doubled on the way out — ServiceBlock.pas:1585 /
    // :1731. An even price survives the round-trip exactly.
    echo: '220',
  },
  {
    command: 'RDOSetTradeLevel', value: '3',
    args: [RdoValue.int(3)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'TradeLevel',
    echo: '3', // Kernel/Kernel.pas:6408-6412 (assign) / :5894 (cache)
  },
  {
    // `fRole := TFacilityRole(aRole)` (StdBlocks/Warehouses.pas:527-532) is what
    // the cache echoes — `WriteInteger('TradeRole', integer(Role))`,
    // Kernel/Kernel.pas:5893. `Role` does not exist in `TBlock.StoreToCache`.
    command: 'RDOSetRole', value: '2',
    args: [RdoValue.int(2)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'TradeRole',
    echo: '2',
  },
  {
    // The write lands on the tycoon, not this cache — the cache line is
    // commented out (Banks.pas:173-180,193) — so there is no witness at all.
    command: 'RDOSetLoanPerc', value: '50',
    args: [RdoValue.int(50)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: null,
  },
  {
    command: 'RDOSelectWare', value: '1', params: { index: '2' },
    args: [RdoValue.int(2), RdoValue.int(1)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'GateMap',
  },

  // ── Workforce (TownHallJobsSheet.pas) ────────────────────────────────────
  {
    command: 'RDOSetSalaries', value: '500', params: { salary0: '500', salary1: '600', salary2: '700' },
    args: [RdoValue.int(500), RdoValue.int(600), RdoValue.int(700)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'Salaries0',
    // Assigned unscaled — WorkCenterBlock.pas:591-593 / cache :571. The witness
    // is the first of the triplet, so it echoes `salary0`, not `value`.
    echo: '500',
  },
  {
    command: 'RDOSetMinSalaryValue', value: '120', params: { levelIndex: '1' },
    args: [RdoValue.int(1), RdoValue.int(120)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'midMinSalary',
    echo: '120', // Kernel/Population.pas:1292-1305 (assign, clamped at 255) / :1219
  },

  // ── Town hall / capitol (TownTaxesSheet.pas, CapitolTownsSheet.pas) ──────
  {
    // taxId supplied by the caller short-circuits the index→id lookup (:99).
    command: 'RDOSetTaxValue', value: '12', params: { index: '1', taxId: RESOLVED_TAX_ID },
    args: [RdoValue.int(110), RdoValue.string('12')],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'Tax1Percent',
    // `StrToInt(value)/100` in, `round(100*Percent)` out — BasicTaxes.pas:249 /
    // :220. The percentage we send is the integer the cache holds.
    echo: '12',
  },
  {
    command: 'RDOSetTownTaxes', value: '15', params: { index: '2' },
    args: [RdoValue.int(2), RdoValue.int(15)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'TownTax2',
    echo: '15', // WorldPolitics.pas:1765 / cache :1380 — same /100, *100 pair
  },
  {
    command: 'RDOSitMayor', value: 'innos', params: { townName: 'Podan', index: '1' },
    args: [RdoValue.string('Podan'), RdoValue.string('innos')],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'HasMayor1',
  },

  // ── Votes (VotesSheet.pas) — accented names ride the latin1 path ─────────
  {
    command: 'RDOVote', value: 'Frédéric', params: { voterName: 'innos' },
    args: [RdoValue.string('innos'), RdoValue.string('Frédéric')],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'RulerVotes',
  },
  // No RDOVoteOf row: it is a `function` and this path emits `"*"`. See the
  // regression test in 'error paths'.

  // ── Repair (IndustryGeneralSheet.pas) — no read-back mapping ─────────────
  {
    command: 'RdoRepair', value: '0',
    args: [RdoValue.int(0)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'RdoRepair',
  },
  {
    command: 'RdoStopRepair', value: '0',
    args: [RdoValue.int(0)],
    target: 'currBlock', verb: 'call', channel: 'frame', readBack: 'RdoStopRepair',
  },
];

/** The frame the handler must have built for this row. */
const TARGET_IDS: Record<MatrixEntry['target'], string> = {
  currBlock: CURR_BLOCK,
  objectId: OBJECT_ID,
  gate: GATE_OBJECT_ID,
};

function expectedFrame(entry: MatrixEntry): string {
  const targetId = TARGET_IDS[entry.target];
  return entry.verb === 'set'
    ? RdoCommand.sel(targetId).set(entry.command).args(...entry.args).build()
    : RdoCommand.sel(targetId).call(entry.command).push().args(...entry.args).build();
}

describe('setBuildingProperty — command matrix', () => {
  it('covers every command the handler declares as known', () => {
    // The ratchet: a new entry in KNOWN_RDO_COMMANDS with no row here fails,
    // which is the only thing that keeps this matrix honest over time.
    expect(new Set(MATRIX.map(e => e.command))).toEqual(KNOWN_RDO_COMMANDS);
  });

  it.each(MATRIX)('$command — target, separator, verb and arguments', async (entry) => {
    // A row that can be confirmed is driven with the value a landed write would
    // leave behind; the others keep the neutral READ_BACK, which is exactly the
    // "readable but meaningless" answer OB-28 used to accept as a confirmation.
    const fake = makeConstructionCtx({ readBack: [entry.echo ?? READ_BACK] });

    const result = await settle(
      setBuildingProperty(fake.ctx, X, Y, entry.command, entry.value, entry.params),
    );

    if (entry.channel === 'request') {
      // Synchronous path: the QueryId is added by sendRdoRequest itself
      // (spo_session.ts:2409-2429), so reaching `sent` IS carrying a QueryId.
      // What the handler must get right is the separator it asks for.
      expect(fake.sent).toEqual([{
        socketName: 'construction',
        packet: {
          verb: RdoVerb.SEL,
          targetId: TARGET_IDS[entry.target],
          action: RdoAction.CALL,
          member: entry.command,
          separator: '"*"',
          args: entry.args.map(a => a.format()),
        },
        timeoutMs: undefined,
        category: TimeoutCategory.SLOW,
      }]);
      expect(fake.frames.construction).toEqual([]);
    } else {
      // Fire-and-forget: one frame, no QueryId, nothing on the request channel.
      const frame = onlyFrame(fake);
      expect(frame).toEqual(expectedFrame(entry));
      expect(frame).toMatchRdoFormat();
      expect(frame).not.toMatch(/^C \d+ sel /); // a rid here would be the crash form
      // The write itself never uses the request channel; a live read-back does.
      expect(fake.sent.map(r => r.packet.action)).toEqual(
        entry.liveReadBack ? [RdoAction.GET] : [],
      );
    }

    // Read-back: the property name is the observable side of
    // mapRdoCommandToPropertyName.
    const listCalls = fake.cacher.getPropertyList.mock.calls;
    if (entry.liveReadBack) {
      // No verify object at all — the value comes off the construction socket.
      expect(listCalls[listCalls.length - 1][1]).toEqual(['CurrBlock', 'ObjectId']);
      expect(fake.sent[0].packet.targetId).toBe(CURR_BLOCK);
      expect(fake.sent[0].packet.member).toBe(entry.command);
      expect(fake.sent[0].category).toBe(TimeoutCategory.NORMAL);
      expect(result.success).toBe(true);
      expect(result.newValue).toBe(LIVE_CLONING);
      expect(result.confirmed).toBe(true);
    } else if (entry.readBack === null) {
      // No witness: the handler must not open a verify object at all, and must
      // report `confirmed: undefined` — "nothing contradicts the write" — rather
      // than the `true` a meaningless read-back used to manufacture.
      expect(listCalls[listCalls.length - 1][1]).toEqual(['CurrBlock', 'ObjectId']);
      expect(result.success).toBe(true);
      expect(result.newValue).toBe('');
      expect(result.confirmed).toBeUndefined();
    } else {
      expect(listCalls[listCalls.length - 1][1]).toEqual([entry.readBack]);
      expect(result.success).toBe(true);
      // `newValue` is what the server holds, whether or not it settles anything.
      expect(result.newValue).toBe(entry.echo ?? READ_BACK);
      // OB-28: only a witness that echoes the write earns `true`. Every other
      // row read a perfectly valid value and used to call it a confirmation.
      expect(result.confirmed).toBe(entry.echo === undefined ? undefined : true);
    }

    // Every cacher object opened is closed, including the verify one.
    expect(fake.cacher.closeObject).toHaveBeenCalledTimes(fake.cacher.createObject.mock.calls.length);
  });

  it.each(MATRIX.filter(e => e.channel === 'frame'))(
    '$command — never uses the variant separator on the fire-and-forget channel',
    async (entry) => {
      // The one rule that froze the shared server. Asserted separately from the
      // frame equality above so the failure message says what it is.
      const fake = makeConstructionCtx();

      await settle(setBuildingProperty(fake.ctx, X, Y, entry.command, entry.value, entry.params));

      expect(onlyFrame(fake)).not.toContain('"^"');
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Target selection — the warehouse case
// ═══════════════════════════════════════════════════════════════════════════

describe('target selection', () => {
  const OBJECT_ID_COMMANDS = MATRIX.filter(e => e.target === 'objectId').map(e => e.command);
  const CURR_BLOCK_COMMANDS = MATRIX.filter(e => e.target === 'currBlock').map(e => e.command);
  const GATE_COMMANDS = MATRIX.filter(e => e.target === 'gate').map(e => e.command);

  it('asks the cacher for both ids at the requested coordinates', async () => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOAutoProduce', '1'));

    expect(fake.cacher.setObject).toHaveBeenCalledWith(TEMP_OBJECT_ID, X, Y);
    expect(fake.cacher.getPropertyList).toHaveBeenCalledWith(TEMP_OBJECT_ID, ['CurrBlock', 'ObjectId']);
  });

  it('binds the gate commands to ObjectId and the rest to CurrBlock', () => {
    // Guards the table itself (:150-154) against silent edits: ten members, no
    // more, no fewer.
    expect(OBJECT_ID_COMMANDS.sort()).toEqual([
      'RDOConnectInput', 'RDOConnectOutput', 'RDOConnectToTycoon',
      'RDODisconnectFromTycoon', 'RDODisconnectInput', 'RDODisconnectOutput',
      'RDOSetInputMaxPrice', 'RDOSetInputMinK', 'RDOSetInputOverPrice', 'RDOSetOutputPrice',
    ]);
    // And exactly one member is bound to neither: it is declared on the gate.
    expect(GATE_COMMANDS).toEqual(['RDOSelSelected']);
    expect(CURR_BLOCK_COMMANDS).toHaveLength(MATRIX.length - 11);
  });

  it('binds both synchronous commands to ObjectId — the CurrBlock arm of :193 is dead', () => {
    // SYNCHRONOUS_RDO_COMMANDS (:170) is a subset of RDO_OBJECTID_COMMANDS
    // (:150), so the `: currBlock` alternative on the synchronous path can never
    // be taken. Stated as an assertion rather than a comment: if a third
    // synchronous command is added on the CurrBlock side, this row is where the
    // dead arm comes back to life and the matrix must gain a case for it.
    const synchronous = MATRIX.filter(e => e.channel === 'request');
    expect(synchronous.map(e => e.command).sort()).toEqual(['RDOConnectInput', 'RDOConnectOutput']);
    expect(synchronous.every(e => e.target === 'objectId')).toBe(true);
  });

  it('falls back to CurrBlock when the building publishes no ObjectId', async () => {
    // Most buildings answer with one id; the fallback at :86 is what makes the
    // gate commands work on them too.
    const fake = makeConstructionCtx({ objectId: null });

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetOutputPrice', '220', { fluidId: 'Plastics' }));

    expect(onlyFrame(fake)).toEqual(
      RdoCommand.sel(CURR_BLOCK).call('RDOSetOutputPrice').push()
        .args(RdoValue.string('Plastics'), RdoValue.int(220)).build(),
    );
  });

  it('emits nothing when CurrBlock comes back empty', async () => {
    // Negative case. It also covers for a gap upstream: `parseIdOfResponse`
    // returns the string `objid=` for `objid=""` (rdo-helpers.ts:247-255) and
    // `RdoCommand.sel()` accepts it (non-empty, not '0'), so an empty id CAN
    // reach a frame builder. Here it cannot: the handler refuses first.
    const fake = makeConstructionCtx({ currBlock: '' });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOAutoProduce', '1'));

    expect(fake.frames.construction).toEqual([]);
    expect(fake.sent).toEqual([]);
    expect(result).toEqual({ success: false, newValue: '' });
    expect(fake.log.error).toHaveBeenCalledWith(expect.stringContaining('No CurrBlock found'));
  });

  it('closes the cacher object even when the lookup fails', async () => {
    const fake = makeConstructionCtx({ currBlock: '' });

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOAutoProduce', '1'));

    expect(fake.cacher.closeObject).toHaveBeenCalledWith(TEMP_OBJECT_ID);
  });

  it('threads the cacher handle it was given, not one of its own', async () => {
    const fake = makeConstructionCtx();
    fake.cacher.createObject
      .mockResolvedValueOnce('cacher-obj-first')
      .mockResolvedValueOnce('cacher-obj-second');

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOAutoProduce', '1'));

    expect(fake.cacher.setObject).toHaveBeenNthCalledWith(1, 'cacher-obj-first', X, Y);
    expect(fake.cacher.closeObject).toHaveBeenNthCalledWith(1, 'cacher-obj-first');
    expect(fake.cacher.setObject).toHaveBeenNthCalledWith(2, 'cacher-obj-second', X, Y);
    expect(fake.cacher.closeObject).toHaveBeenNthCalledWith(2, 'cacher-obj-second');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Dynamic ids — a row index is not a server id
// ═══════════════════════════════════════════════════════════════════════════

describe('index → server id resolution', () => {
  it('sends the TaxId the server returned, not the row index', async () => {
    // Voyager: TownTaxesSheet.pas — TaxId comes from Tax[idx].Id. Row 1 of the
    // grid is tax 110; sending 1 would tax the wrong bracket.
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetTaxValue', '12', { index: '1' }));

    expect(fake.cacher.getPropertyList).toHaveBeenCalledWith(TEMP_OBJECT_ID, ['Tax1Id']);
    expect(onlyFrame(fake)).toEqual(
      RdoCommand.sel(CURR_BLOCK).call('RDOSetTaxValue').push()
        .args(RdoValue.int(110), RdoValue.string('12')).build(),
    );
  });

  it('keeps the row index when the server has no TaxId for that row', async () => {
    const fake = makeConstructionCtx();
    fake.cacher.getPropertyList.mockImplementation(async (_id: string, props: string[]) => {
      if (props[0] === 'CurrBlock') return [CURR_BLOCK, OBJECT_ID];
      if (props[0] === 'Tax1Id') return [''];
      return [READ_BACK];
    });

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetTaxValue', '12', { index: '1' }));

    expect(onlyFrame(fake)).toEqual(
      RdoCommand.sel(CURR_BLOCK).call('RDOSetTaxValue').push()
        .args(RdoValue.int(1), RdoValue.string('12')).build(),
    );
  });

  it('sends the MinistryId the server returned, not the row index', async () => {
    // Voyager: MinisteriesSheet.pas — MinistryId comes from MinistryId[idx].
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetMinistryBudget', '3000', { index: '2' }));

    expect(fake.cacher.getPropertyList).toHaveBeenCalledWith(TEMP_OBJECT_ID, ['MinistryId2']);
    expect(onlyFrame(fake)).toEqual(
      RdoCommand.sel(CURR_BLOCK).call('RDOSetMinistryBudget').push()
        .args(RdoValue.int(77), RdoValue.string('3000')).build(),
    );
    // …but the read-back stays keyed by the row: the cache writes
    // `MinisterBudget{i}` by position (WorldPolitics.pas:1358), not by the
    // resolved MinistryId — `MinisterBudget77` does not exist.
    const listCalls = fake.cacher.getPropertyList.mock.calls;
    expect(listCalls[listCalls.length - 1][1]).toEqual(['MinisterBudget2']);
  });

  it('keeps the row index when the server has no MinistryId for that row', async () => {
    const fake = makeConstructionCtx();
    fake.cacher.getPropertyList.mockImplementation(async (_id: string, props: string[]) => {
      if (props[0] === 'CurrBlock') return [CURR_BLOCK, OBJECT_ID];
      if (props[0] === 'MinistryId2') return [''];
      return [READ_BACK];
    });

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetMinistryBudget', '3000', { index: '2' }));

    expect(onlyFrame(fake)).toEqual(
      RdoCommand.sel(CURR_BLOCK).call('RDOSetMinistryBudget').push()
        .args(RdoValue.int(0), RdoValue.string('3000')).build(),
    );
  });

  it('does not look a TaxId up when the caller already supplied one', async () => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetTaxValue', '12', { index: '1', taxId: '120' }));

    expect(fake.cacher.getPropertyList).not.toHaveBeenCalledWith(TEMP_OBJECT_ID, ['Tax1Id']);
    expect(onlyFrame(fake)).toContain(RdoValue.int(120).format());
  });

  it('does not look a MinistryId up when the caller already supplied one', async () => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetMinistryBudget', '3000', { index: '2', ministryId: '9' }));

    expect(fake.cacher.getPropertyList).not.toHaveBeenCalledWith(TEMP_OBJECT_ID, ['MinistryId2']);
    expect(onlyFrame(fake)).toContain(RdoValue.int(9).format());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Argument defaults and boolean encoding
// ═══════════════════════════════════════════════════════════════════════════

describe('argument construction', () => {
  it('defaults the price index to 0 when the client omits it', async () => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetPrice', '220'));

    expect(onlyFrame(fake)).toEqual(
      RdoCommand.sel(CURR_BLOCK).call('RDOSetPrice').push()
        .args(RdoValue.int(0), RdoValue.int(220)).build(),
    );
  });

  it.each([
    ['RDOSetCompanyInputDemand', 'cInputDem0'],
    ['RDOSetTownTaxes', 'TownTax0'],
    ['RDOSelectWare', 'GateMap'],
  ])('%s falls back to index 0 for its read-back property', async (command, property) => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, command, '5'));

    const listCalls = fake.cacher.getPropertyList.mock.calls;
    expect(listCalls[listCalls.length - 1][1]).toEqual([property]);
  });

  // The write sets THIS facility's own floor, so the confirmation must read
  // that back — not `ActualMinSalary`, which is the blended max(town, world)
  // the town enforces (Kernel/Kernel.pas:9342-9345). Reading the blend reported
  // every correct write as unconfirmed whenever the world floor was higher.
  it.each([
    ['0', 'hiMinSalary'],
    ['1', 'midMinSalary'],
    ['2', 'loMinSalary'],
  ])('reads back the level-%s salary as %s', async (levelIndex, property) => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetMinSalaryValue', '120', { levelIndex }));

    const listCalls = fake.cacher.getPropertyList.mock.calls;
    expect(listCalls[listCalls.length - 1][1]).toEqual([property]);
  });

  it('defaults the salary level to hi when the client omits it', async () => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetMinSalaryValue', '120'));

    expect(onlyFrame(fake)).toEqual(
      RdoCommand.sel(CURR_BLOCK).call('RDOSetMinSalaryValue').push()
        .args(RdoValue.int(0), RdoValue.int(120)).build(),
    );
  });

  it.each([
    ['1', -1],
    ['-1', -1],
    ['42', -1],
    ['0', 0],
  ])('encodes the boolean %s as the WordBool #%i', async (value, expected) => {
    // #-1 / #0, byte for byte like the legacy client — never #1.
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOAutoProduce', value));

    expect(onlyFrame(fake)).toEqual(
      RdoCommand.sel(CURR_BLOCK).call('RDOAutoProduce').push().args(RdoValue.int(expected)).build(),
    );
  });

  it.each(['RDOConnectToTycoon', 'RDODisconnectFromTycoon'] as const)(
    '%s sends the tycoon PROXY id, never the persistent tycoon id',
    async (command) => {
      // The regression this guards is a silent one. `TFacility.RDOConnectToTycoon`
      // does `Tycoon := TTycoon(pointer(TycoonId))` (Kernel/Kernel.pas:4534) and
      // wraps the whole body in `try..except` (:4576-4578): handed the persistent
      // id, the server raises, swallows it, and answers nothing. The button looks
      // dead and no log on our side says why — so the only place this can be
      // caught is here.
      const fake = makeConstructionCtx();

      await settle(setBuildingProperty(fake.ctx, X, Y, command, '0', { kind: '2' }));

      const frame = onlyFrame(fake);
      expect(frame).toContain(RdoValue.int(FAKE_CONTEXT_IDS.tycoonProxyId).format());
      expect(frame).not.toContain(RdoValue.int(parseInt(FAKE_CONTEXT_IDS.tycoonId, 10)).format());
    },
  );

  it('refuses to send a tycoon connect before InitClient supplied the proxy id', async () => {
    // Guessing is not an option: there is no id to fall back on that the server
    // would accept, and sending the wrong one is indistinguishable from success.
    const fake = makeConstructionCtx({ fTycoonProxyId: null });

    const result = await settle(
      setBuildingProperty(fake.ctx, X, Y, 'RDOConnectToTycoon', '0', { kind: '2' }),
    );

    expect(result.success).toBe(false);
    expect(fake.frames.construction).toEqual([]);
  });

  it('composes the movie bitmask from the two auto flags', async () => {
    // MovieStudios.pas — flgAutoRelease=$01 (bit0), flgAutoProduce=$02 (bit1).
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOLaunchMovie', '0', {
      filmName: 'Le Grand Bleu', budget: '2500000', months: '6', autoProd: '1',
    }));

    expect(onlyFrame(fake)).toEqual(
      RdoCommand.sel(CURR_BLOCK).call('RDOLaunchMovie').push().args(
        RdoValue.string('Le Grand Bleu'), RdoValue.double(2500000), RdoValue.int(6), RdoValue.int(2),
      ).build(),
    );
  });

  it('gives a launched movie the documented defaults when the client sends only a name', async () => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOLaunchMovie', '0', {}));

    expect(onlyFrame(fake)).toEqual(
      RdoCommand.sel(CURR_BLOCK).call('RDOLaunchMovie').push().args(
        RdoValue.string(''), RdoValue.double(1000000), RdoValue.int(12), RdoValue.int(0),
      ).build(),
    );
  });

  it('queues research at priority 10 by default', async () => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOQueueResearch', '0'));

    expect(onlyFrame(fake)).toEqual(
      RdoCommand.sel(CURR_BLOCK).call('RDOQueueResearch').push()
        .args(RdoValue.string(''), RdoValue.int(10)).build(),
    );
  });

  it('writes accented text as single latin1 bytes on the wire', async () => {
    // The frame is captured off the socket as a Buffer and decoded latin1, the
    // same codec writeRdoFrame writes with (rdo-helpers.ts:80).
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetWordsOfWisdom', 'Où va la cité ?'));

    const frame = onlyFrame(fake);
    expect(frame).toContain(RdoValue.string('Où va la cité ?').format());
    expect(Buffer.byteLength(frame, 'latin1')).toBe(frame.length);
  });

  it.each([
    ['RDOSetInputMaxPrice', {}],
    ['RDOSetInputMinK', {}],
    ['RDOSetOutputPrice', {}],
    ['RDOSetInputSortMode', {}],
    ['RDOConnectInput', { fluidId: 'Plastics' }],
    ['RDOConnectOutput', { fluidId: 'Plastics' }],
    ['RDODisconnectInput', { connectionList: '706,436,' }],
    ['RDODisconnectOutput', { connectionList: '706,436,' }],
    ['RDOSetInputOverPrice', { fluidId: 'Plastics' }],
    ['RDOConnectToTycoon', {}],
    ['RDODisconnectFromTycoon', {}],
  ])('%s emits nothing when a required parameter is missing', async (command, params) => {
    const fake = makeConstructionCtx();

    const result = await settle(
      setBuildingProperty(fake.ctx, X, Y, command, '1', params as Record<string, string>),
    );

    expect(fake.frames.construction).toEqual([]);
    expect(fake.sent).toEqual([]);
    expect(result).toEqual({ success: false, newValue: '' });
  });

  it('accepts fluidId under its metaFluid alias on the input commands', async () => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetInputMaxPrice', '500', { metaFluid: 'Plastics' }));

    expect(onlyFrame(fake)).toEqual(
      RdoCommand.sel(OBJECT_ID).call('RDOSetInputMaxPrice').push()
        .args(RdoValue.string('Plastics'), RdoValue.int(500)).build(),
    );
  });

  it('accepts an overprice index of 0 — the guard tests presence, not truthiness', async () => {
    // The guard is `index === undefined` (:424), not `!index`, so the first row
    // of the connection grid is a legitimate target and must reach the wire.
    // Written down because the neighbouring guards in the same switch DO test
    // truthiness, and the difference is invisible until index 0 is used.
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetInputOverPrice', '20', {
      fluidId: 'Plastics', index: '0',
    }));

    expect(onlyFrame(fake)).toEqual(
      RdoCommand.sel(OBJECT_ID).call('RDOSetInputOverPrice').push()
        .args(RdoValue.string('Plastics'), RdoValue.int(0), RdoValue.int(20)).build(),
    );
  });

  it('names the salaries it is missing rather than defaulting them', async () => {
    // M-C, from the other end: `building-mutations.test.ts` establishes that a
    // partial triplet sends nothing. What matters operationally is that the log
    // says WHICH ones were absent — the client sends the triplet from a form,
    // and a single missing field is otherwise invisible.
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetSalaries', '500', { salary1: '600' }));

    expect(fake.log.error).toHaveBeenCalledWith(
      expect.stringContaining('missing: salary0, salary2'),
    );
  });

  it.each([
    // RDOSelSelected is addressed to the gate, so it needs the fluid that names
    // one; without it the handler refuses instead of emitting.
    { command: 'RDOSelSelected', value: '0', params: { fluidId: GATE_FLUID } },
    { command: 'RDOAcceptCloning', value: '0', params: undefined },
  ])('$command encodes false as #0', async ({ command, value, params }) => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, command, value, params));

    expect(onlyFrame(fake)).toContain(RdoValue.int(0).format());
    expect(onlyFrame(fake)).not.toContain(RdoValue.int(-1).format());
  });

  /**
   * Identifiers the handler defaults to 0 or '' instead of refusing.
   *
   * Unlike `RDOSetSalaries`, which refuses an incomplete triplet, these commands
   * fill the gap silently — a `RDOBanMinister` with no ministryId bans ministry
   * 0. The arity is at least preserved (the server never sees a short argument
   * list), which is what these rows pin.
   */
  it.each([
    {
      command: 'RDOBanMinister', value: '0', params: {},
      args: [RdoValue.int(0)], readBack: 'Minister0',
    },
    {
      command: 'RDOSitMinister', value: '0', params: {},
      args: [RdoValue.int(0), RdoValue.string('')], readBack: 'Minister0',
    },
    {
      command: 'RDOCancelResearch', value: '0', params: {},
      args: [RdoValue.string('')], readBack: 'RDOCancelResearch',
    },
    {
      command: 'RDOVote', value: 'innos', params: {},
      args: [RdoValue.string(''), RdoValue.string('innos')], readBack: 'RulerVotes',
    },
    {
      command: 'RDOSitMayor', value: 'innos', params: {},
      args: [RdoValue.string(''), RdoValue.string('innos')], readBack: 'HasMayor0',
    },
    {
      command: 'RDOSetTaxValue', value: '12', params: {},
      args: [RdoValue.int(0), RdoValue.string('12')], readBack: 'Tax0Percent',
    },
  ])('$command keeps its arity when the identifier is omitted', async (row) => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, row.command, row.value, row.params));

    expect(onlyFrame(fake)).toEqual(
      RdoCommand.sel(CURR_BLOCK).call(row.command).push().args(...row.args).build(),
    );
    const listCalls = fake.cacher.getPropertyList.mock.calls;
    expect(listCalls[listCalls.length - 1][1]).toEqual([row.readBack]);
  });

  it('emits nothing when a numeric value is not a number', async () => {
    // RdoValue.int(NaN) raises (rdo-types.ts:164-172) rather than putting "#NaN"
    // on the wire, where Delphi's VarCast would raise instead.
    const fake = makeConstructionCtx();

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetTradeLevel', 'high'));

    expect(fake.frames.construction).toEqual([]);
    expect(result.success).toBe(false);
    expect(fake.log.error).toHaveBeenCalledWith(expect.stringContaining('finite number'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The direct property path — `set <Prop>=<value>` on CurrBlock
// ═══════════════════════════════════════════════════════════════════════════

describe('direct property set', () => {
  it('writes an integer property with the SET verb on CurrBlock', async () => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'property', '75', { propertyName: 'Interest' }));

    const frame = onlyFrame(fake);
    expect(frame).toEqual(RdoCommand.sel(CURR_BLOCK).set('Interest').args(RdoValue.int(75)).build());
    expect(frame).toMatchRdoSetFormat('Interest');
  });

  it('writes Name as a widestring — the only WIDESTRING_PROPERTIES entry (:637)', async () => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'property', 'Café de la Gare', { propertyName: 'Name' }));

    expect(onlyFrame(fake)).toEqual(
      RdoCommand.sel(CURR_BLOCK).set('Name').args(RdoValue.string('Café de la Gare')).build(),
    );
  });

  it('reads the property back under its own name', async () => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'property', '75', { propertyName: 'Interest' }));

    const listCalls = fake.cacher.getPropertyList.mock.calls;
    expect(listCalls[listCalls.length - 1][1]).toEqual(['Interest']);
  });

  it('never targets ObjectId, even for a warehouse', async () => {
    // Was `AcceptCloning`, a name this path cannot receive: template-groups.ts:540
    // maps it to `command: 'RDOAcceptCloning'`, not to `'property'`. Now that the
    // settable set is closed, the test has to use a name the UI actually produces.
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'property', '1', { propertyName: 'Interest' }));

    expect(onlyFrame(fake)).toContain(`sel ${CURR_BLOCK} `);
  });

  it('refuses "property" with no property name rather than sending the word itself', async () => {
    const fake = makeConstructionCtx();

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'property', '1'));

    expect(fake.frames.construction).toEqual([]);
    expect(result).toEqual({ success: false, newValue: '' });
    expect(fake.log.error).toHaveBeenCalledWith(expect.stringContaining('not in KNOWN_RDO_COMMANDS'));
  });

  it('emits nothing when a non-widestring property gets a non-numeric value', async () => {
    const fake = makeConstructionCtx();

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'property', 'loud', { propertyName: 'Volume' }));

    expect(fake.frames.construction).toEqual([]);
    expect(result.success).toBe(false);
  });

  it('rejects a property name that is not a Delphi identifier', async () => {
    // P-H3: `ReadIdent` stops at the first invalid character and hands the rest
    // back to the sub-command loop, so `Foo" call Evil "*" "` would execute
    // `Evil`.
    //
    // Since lot C the catalogue rejects it first — an injection payload is not a
    // catalogued member — so the message names RDO_MEMBERS rather than the
    // identifier grammar. The grammar check still runs, inside `rdoSet`; it is
    // simply no longer the first line. What matters is unchanged and asserted
    // below: nothing reaches the wire.
    const fake = makeConstructionCtx();

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'property', '1', {
      propertyName: 'Interest" call RDOSitMayor "*" "%Podan',
    }));

    expect(fake.frames.construction).toEqual([]);
    expect(result).toEqual({ success: false, newValue: '' });
    expect(fake.log.error).toHaveBeenCalledWith(expect.stringContaining('not in RDO_MEMBERS'));
  });

  // BUG connu (A-2).
  // `template-groups.ts:314` maps the TV advertising slider to the cache key
  // `Comercials` (one m), the spelling the legacy client used for its CACHE
  // entry. The PUBLISHED property is `Commercials` (StdBlocks/Broadcast.pas:53),
  // and Voyager writes it correctly (TVGeneralSheet.pas:322). We took the typo
  // to the write side too, so the RTTI lookup fails server-side and the setting
  // never lands. `it.failing` = this is what SHOULD happen and does not.
  it('writes the published Commercials, whatever name the table carries', async () => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'property', '50', { propertyName: 'Commercials' }));

    expect(onlyFrame(fake)).toEqual(
      RdoCommand.sel(CURR_BLOCK).set('Commercials').args(RdoValue.int(50)).build(),
    );
  });

  // The table-side half of this fix — that `Comercials` resolves to a write on
  // `Commercials` — is asserted in
  // client/components/building/__tests__/resolve-rdo-command.test.ts.
});

// ═══════════════════════════════════════════════════════════════════════════
// Read-back and the honesty of the return value
// ═══════════════════════════════════════════════════════════════════════════

describe('read-back', () => {
  it('warns when the command has no read-back mapping at all', async () => {
    // Four known commands have no `case` in mapRdoCommandToPropertyName —
    // the default (:799) queries the command NAME, which no building publishes.
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RdoRepair', '0'));

    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown command "RdoRepair"'),
    );
  });

  it('reports the value the server holds', async () => {
    const fake = makeConstructionCtx({ readBack: ['218'] });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetPrice', '220', { index: '0' }));

    // This row used to assert `confirmed: true`: the price we sent was 220, the
    // server held 218, and the verdict came from the value being READABLE. That
    // is OB-28. `newValue` still reports what the server holds — the honest
    // half of the old behaviour, kept.
    expect(result).toEqual({ success: true, newValue: '218', confirmed: undefined });
    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('"srvPrices0" holds 218, the write sent 220'),
    );
  });

  it('accepts either even neighbour for an odd price, and nothing else', async () => {
    // `min(high(Price), round(value/2))` on the way in, `2*Price` on the way out
    // (ServiceBlock.pas:1585 / :1731): an odd price cannot come back unchanged,
    // and which neighbour it lands on depends on Delphi's .5 tie-break.
    for (const held of ['220', '222']) {
      const fake = makeConstructionCtx({ readBack: [held] });
      const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetPrice', '221', { index: '0' }));
      expect(result.confirmed).toBe(true);
    }

    const off = makeConstructionCtx({ readBack: ['224'] });
    const result = await settle(setBuildingProperty(off.ctx, X, Y, 'RDOSetPrice', '221', { index: '0' }));
    expect(result.confirmed).toBeUndefined();
  });

  it('gives no verdict when the witness cannot answer the question', async () => {
    // `cnxCount` is a connection COUNT on the gate cache object
    // (Kernel/KernelCache.pas:459-471), not a copy of what we sent — it reads
    // the same whether the disconnect connected nothing or everything.
    const fake = makeConstructionCtx({ readBack: ['3'] });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDODisconnectInput', '0', {
      fluidId: 'Plastics', connectionList: '706,436,',
    }));

    expect(result).toEqual({ success: true, newValue: '3', confirmed: undefined });
    expect(fake.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('reads the same whether or not the write landed'),
    );
  });

  // KNOWN BUG — building-property-handler.ts:259. M-E is fixed (an empty
  // read-back no longer echoes the requested value), but `success` is still
  // hard-coded `true` on this path: a mutation the server discarded returns
  // `{ success: true, confirmed: undefined }`. Clients that only look at
  // `success` — which is most of them, `confirmed` being optional — still see
  // a win.
  it('still reports success when nothing could be confirmed (known defect)', async () => {
    const fake = makeConstructionCtx({ readBack: [] });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetPrice', '220', { index: '0' }));

    // Was `false`, i.e. "the server refused" — which the client paints red and
    // reverts. An absent cache property says nothing of the kind (OB-28).
    expect(result.confirmed).toBeUndefined();
    expect(result.newValue).toBe('');
    expect(result.success).toBe(true); // ← the defect, pinned
    expect(fake.log.warn).toHaveBeenCalledWith(expect.stringContaining('could not be confirmed'));
  });

  it('treats an empty string read-back as unconfirmed too', async () => {
    const fake = makeConstructionCtx({ readBack: [''] });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetPrice', '220', { index: '0' }));

    expect(result.confirmed).toBeUndefined();
    expect(result.newValue).toBe('');
  });

  it('logs the confirmed value when the server agrees', async () => {
    const fake = makeConstructionCtx({ readBack: ['220'] });

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetPrice', '220', { index: '0' }));

    expect(fake.log.debug).toHaveBeenCalledWith(expect.stringContaining('confirmed at 220'));
  });

  it('reports failure when the read-back itself throws, after the command was sent', async () => {
    // The frame is already on the wire at this point: the mutation may well have
    // been applied. `success: false` is the honest answer here — we cannot say.
    const fake = makeConstructionCtx();
    fake.cacher.getPropertyList.mockImplementation(async (_id: string, props: string[]) => {
      if (props[0] === 'CurrBlock') return [CURR_BLOCK, OBJECT_ID];
      throw new Error('cacher connection lost');
    });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOAutoProduce', '1'));

    expect(fake.frames.construction).toHaveLength(1);
    expect(result).toEqual({ success: false, newValue: '' });
    expect(fake.cacher.closeObject).toHaveBeenCalledTimes(2);
  });

  // ── AcceptCloning: confirmed live, never from the cache ──────────────────
  //
  // TBlock.StoreToCache (Kernel/Kernel.pas:5824-5905) does not emit
  // `AcceptCloning`, and the cacher answers '' for a name it does not hold
  // (spo_session.ts:1416-1417). Reading the witness there returned `confirmed:
  // false` for every write that had in fact landed.

  it('confirms AcceptCloning with a live get on CurrBlock, not with the cacher', async () => {
    const fake = makeConstructionCtx({ liveCloning: '-1', readBack: [''] });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOAcceptCloning', '1'));

    // The write went out as a frame; the confirmation as a request.
    expect(fake.frames.construction).toHaveLength(1);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].packet.action).toBe(RdoAction.GET);
    expect(fake.sent[0].packet.member).toBe('RDOAcceptCloning');
    expect(fake.sent[0].packet.targetId).toBe(CURR_BLOCK);
    // No verify object was opened — only the id lookup.
    expect(fake.cacher.createObject).toHaveBeenCalledTimes(1);
    const asked = fake.cacher.getPropertyList.mock.calls.flatMap(([, names]) => names);
    expect(asked).not.toContain('AcceptCloning');
    expect(result).toEqual({ success: true, newValue: '-1', confirmed: true });
    expect(fake.log.debug).toHaveBeenCalledWith(expect.stringContaining('confirmed at -1'));
  });

  it('confirms a cleared flag as "0" rather than treating it as no answer', async () => {
    const fake = makeConstructionCtx({ liveCloning: '0' });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOAcceptCloning', '0'));

    expect(result).toEqual({ success: true, newValue: '0', confirmed: true });
  });

  it('reports AcceptCloning refused when the live get disagrees with the write', async () => {
    // The only place `false` is defensible: the get reads the very field the set
    // assigns, with no object cache in between, so a flag that still says 0
    // after we sent -1 is a write that did not land — not a cache lagging
    // behind (OB-29). Everywhere else that same reading means "no verdict".
    const fake = makeConstructionCtx({ liveCloning: '0' });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOAcceptCloning', '1'));

    expect(result).toEqual({ success: true, newValue: '0', confirmed: false });
    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('holds 0, the write sent -1'),
    );
  });

  it('reports AcceptCloning unconfirmed when the live get answers nothing', async () => {
    const fake = makeConstructionCtx();
    fake.respond(() => '');

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOAcceptCloning', '1'));

    expect(result).toEqual({ success: true, newValue: '', confirmed: false });
    expect(fake.log.warn).toHaveBeenCalledWith(expect.stringContaining('could not be confirmed'));
  });

  it('reports failure when the live get throws, after the frame was sent', async () => {
    const fake = makeConstructionCtx();
    fake.respond(() => new Error('Request timeout: RDOAcceptCloning'));

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOAcceptCloning', '1'));

    expect(fake.frames.construction).toHaveLength(1);
    expect(result).toEqual({ success: false, newValue: '' });
    expect(fake.cacher.closeObject).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Read-back on the gate object
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Nine supply-chain commands write a GATE, and their witness is written there
 * too: `cnxCount` by `TGateCacheAgent.UpdateCache`
 * (Kernel/KernelCache.pas:459-471), `MaxPrice`/`MinK`/`Selected` by
 * `TPullInput.StoreToCache` (Kernel/Kernel.pas:7813-7815), `SortMode` by
 * `TMediaInput.StoreToCache` (Kernel/MediaGates.pas:389), `PricePc` by
 * `TOutputCacheAgent.UpdateCache` (Kernel/KernelCache.pas:753).
 *
 * The confirmation used to read them off the (x, y)-bound FACILITY object, where
 * none of them exists — the cacher answers an unknown name with an empty string,
 * so every one of those nine commands reported `confirmed: undefined` whatever
 * the server had done. What follows pins the walk to the gate: which path is
 * chosen, that `SetPath` is what lands on it, and that an unreachable gate is
 * still "no verdict" rather than a failure.
 */
describe('read-back on the gate object', () => {
  /** The property names asked of the cacher, in call order. */
  function queries(fake: FakeSessionCtx): string[][] {
    return fake.cacher.getPropertyList.mock.calls.map(c => c[1]);
  }

  it('walks to the input gate named by fluidId, and reads the witness there', async () => {
    const fake = makeConstructionCtx({ readBack: ['420'] });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetInputMaxPrice', '420', {
      fluidId: GATE_FLUID,
    }));

    // The listing comes off the facility object the handler is already standing
    // on — `InputCount` then one `InputPath{i}` per gate.
    expect(queries(fake)).toEqual([
      ['CurrBlock', 'ObjectId'],
      ['InputCount'],
      ['InputPath0', 'InputPath1'],
      ['MaxPrice'],
    ]);
    // The SECOND path is the one named `Plastics`; a handler that took the first
    // would land on Cotton's gate.
    expect(fake.cacher.setPath).toHaveBeenCalledTimes(1);
    expect(fake.cacher.setPath).toHaveBeenCalledWith(TEMP_OBJECT_ID, INPUT_PATHS[1]);
    // And the witness is NOT read through a second coordinate bind: the only
    // setObject calls are the ones that resolved the ids and opened the verify
    // object.
    expect(fake.cacher.setObject.mock.calls.every(c => c[1] === X && c[2] === Y)).toBe(true);
    expect(result).toEqual({ success: true, newValue: '420', confirmed: true });
  });

  it('walks to the output gate for an output command', async () => {
    const fake = makeConstructionCtx({ readBack: ['220'] });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetOutputPrice', '220', {
      fluidId: GATE_FLUID,
    }));

    expect(queries(fake)).toEqual([
      ['CurrBlock', 'ObjectId'],
      ['OutputCount'],
      ['OutputPath0', 'OutputPath1'],
      ['PricePc'],
    ]);
    expect(fake.cacher.setPath).toHaveBeenCalledWith(TEMP_OBJECT_ID, OUTPUT_PATHS[1]);
    expect(result.confirmed).toBe(true);
  });

  it('accepts the metaFluid alias when naming the gate', async () => {
    const fake = makeConstructionCtx({ readBack: ['12'] });

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetInputMinK', '12', {
      metaFluid: GATE_FLUID,
    }));

    expect(fake.cacher.setPath).toHaveBeenCalledWith(TEMP_OBJECT_ID, INPUT_PATHS[1]);
  });

  it('refuses RDOSelSelected outright when the command carried no fluid id', async () => {
    // The fluid does not only name the witness here — it names the OBJECT the
    // frame is addressed to. With no gate resolved there is no legal target, so
    // nothing goes on the wire at all: the alternative is a frame aimed at the
    // block, which does not publish the member.
    const fake = makeConstructionCtx({ readBack: ['1'] });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSelSelected', '1'));

    expect(fake.frames.construction).toEqual([]);
    expect(fake.cacher.setPath).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, newValue: '' });
    expect(fake.log.error).toHaveBeenCalledWith(
      expect.stringContaining('RDOSelSelected cannot be addressed'),
    );
  });

  it('refuses RDOSelSelected when no gate carries that fluid', async () => {
    const fake = makeConstructionCtx({ readBack: ['1'] });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSelSelected', '1', {
      fluidId: 'Nope',
    }));

    expect(fake.frames.construction).toEqual([]);
    expect(result).toEqual({ success: false, newValue: '' });
    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('no Input gate named "Nope"'),
    );
    expect(fake.log.error).toHaveBeenCalledWith(
      expect.stringContaining('RDOSelSelected cannot be addressed'),
    );
  });

  it('warns and gives no verdict when no gate carries that fluid', async () => {
    // A fluid the block does not gate is also a fluid the WRITE did not reach:
    // the handler resolves it with `InputsByName[FluidId]`
    // (Kernel/Kernel.pas:4398 -> :5321), the same name the path embeds.
    const fake = makeConstructionCtx({ readBack: ['500'] });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetInputMaxPrice', '500', {
      fluidId: 'Uranium',
    }));

    expect(fake.cacher.setPath).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, newValue: '', confirmed: undefined });
    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('no Input gate named "Uranium"'),
    );
  });

  it('gives no verdict when the building publishes no gate of that side', async () => {
    const fake = makeConstructionCtx({ inputPaths: [], readBack: ['500'] });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetInputMaxPrice', '500', {
      fluidId: GATE_FLUID,
    }));

    expect(queries(fake)).toEqual([['CurrBlock', 'ObjectId'], ['InputCount']]);
    expect(result.newValue).toBe('');
    expect(result.confirmed).toBeUndefined();
    expect(fake.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('publishes no Input gates'),
    );
  });

  it('gives no verdict when the gate count is not a number', async () => {
    const fake = makeConstructionCtx();
    fake.cacher.getPropertyList.mockImplementation(async (_id: string, props: string[]) => {
      if (props[0] === 'CurrBlock') return [CURR_BLOCK, OBJECT_ID];
      if (props[0] === 'InputCount') return [''];
      return [READ_BACK];
    });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetInputMinK', '10', {
      fluidId: GATE_FLUID,
    }));

    expect(fake.cacher.setPath).not.toHaveBeenCalled();
    expect(result.confirmed).toBeUndefined();
  });

  it('ignores a gate path that is not shaped like one', async () => {
    // An input path without the `%.8x` prefix, and one that is not a `.five`
    // folder at all: neither names a gate, so neither can be matched.
    const fake = makeConstructionCtx({
      inputPaths: [`${FACILITY_PATH}Inputs\\${GATE_FLUID}.five\\`, `${FACILITY_PATH}Inputs\\${GATE_FLUID}\\`],
      readBack: ['500'],
    });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetInputMaxPrice', '500', {
      fluidId: GATE_FLUID,
    }));

    expect(fake.cacher.setPath).not.toHaveBeenCalled();
    expect(result.confirmed).toBeUndefined();
  });

  it('still refuses a verdict on cnxCount, now that it is readable', async () => {
    // Reaching the right object does not make a COUNT an echo: `cnxCount`
    // (Kernel/KernelCache.pas:467) reads the same whether the disconnect
    // dropped one supplier or none. The walk gives an honest `newValue`; the
    // verdict stays `undefined`.
    const fake = makeConstructionCtx({ readBack: ['3'] });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDODisconnectOutput', '0', {
      fluidId: GATE_FLUID, connectionList: '706,436,',
    }));

    expect(fake.cacher.setPath).toHaveBeenCalledWith(TEMP_OBJECT_ID, OUTPUT_PATHS[1]);
    expect(result).toEqual({ success: true, newValue: '3', confirmed: undefined });
  });

  it('closes the verify object after walking to a gate', async () => {
    const fake = makeConstructionCtx({ readBack: ['500'] });

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetInputMaxPrice', '500', {
      fluidId: GATE_FLUID,
    }));

    expect(fake.cacher.closeObject).toHaveBeenCalledTimes(fake.cacher.createObject.mock.calls.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Witness echoes — the five gate writes that can be settled
// ═══════════════════════════════════════════════════════════════════════════

describe('gate witness echoes', () => {
  it.each([
    // command, sent value, what a landed write leaves in the cache
    ['RDOSetInputMaxPrice', 'MaxPrice', '500', '500'],
    ['RDOSetInputMinK', 'minK', '0', '0'],
    ['RDOSetOutputPrice', 'PricePc', '75', '75'],
    // `mode := mode and $01` (Kernel/MediaGates.pas:376): 2 is stored as 0.
    ['RDOSetInputSortMode', 'SortMode', '2', '0'],
    ['RDOSetInputSortMode', 'SortMode', '1', '1'],
    // `Cache.WriteBoolean` writes '1'/'0' (Cache/CacheAgent.pas:150-152), never
    // the `#-1` the wordbool argument carries.
    ['RDOSelSelected', 'Selected', '1', '1'],
    ['RDOSelSelected', 'Selected', '0', '0'],
  ])('%s confirms when %s holds %s as %s', async (command, _witness, sent, held) => {
    const fake = makeConstructionCtx({ readBack: [held] });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, command, sent, {
      fluidId: GATE_FLUID,
    }));

    expect(result).toEqual({ success: true, newValue: held, confirmed: true });
  });

  it.each([
    // A word field truncates an out-of-range write (fMaxPrice is a `word`,
    // Kernel/Kernel.pas:1585); the mismatch is reported as NO verdict, never as
    // a failure — the cache also lags a write by 30-90 s (OB-29).
    ['RDOSetInputMaxPrice', '70000', '4464'],
    ['RDOSetOutputPrice', '220', '100'],
    ['RDOSelSelected', '1', '0'],
  ])('%s gives no verdict when the gate holds something else', async (command, sent, held) => {
    const fake = makeConstructionCtx({ readBack: [held] });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, command, sent, {
      fluidId: GATE_FLUID,
    }));

    expect(result.newValue).toBe(held);
    expect(result.confirmed).toBeUndefined();
  });

  it('gives no verdict on a sort mode that is not a number', async () => {
    // The mask needs an integer; `NaN & 1` is 0, which would confirm "sort by
    // cost" for a value the server never parsed.
    const fake = makeConstructionCtx({ readBack: ['0'] });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetInputSortMode', 'quality', {
      fluidId: GATE_FLUID,
    }));

    expect(result.confirmed).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Error paths
// ═══════════════════════════════════════════════════════════════════════════

describe('error paths', () => {
  it('refuses a command that is not in KNOWN_RDO_COMMANDS', async () => {
    const fake = makeConstructionCtx();

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetGravity', '9'));

    expect(fake.frames.construction).toEqual([]);
    expect(result).toEqual({ success: false, newValue: '' });
    expect(fake.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Unknown building property command "RDOSetGravity"'),
    );
  });

  it('never puts RDOVoteOf on this path — it is a function, and this path emits "*"', async () => {
    // `function RDOVoteOf(tycoonName: widestring): OleVariant`
    // (Kernel/TownPolitics.pas:47, impl :418; same on TPresidentialHall,
    // Kernel/WorldPolitics.pas:268). Every command reaching this handler is
    // emitted with `"*"`, which on a function passes no result pointer while
    // the callee writes one anyway through the register its ABI reserves.
    //
    // It used to be in KNOWN_RDO_COMMANDS with a `case` in buildRdoCommandArgs,
    // reachable from the browser through VOTES_GROUP.rdoCommands. The only
    // legitimate emission is the `"^"` read in building-details-handler.ts:938.
    const fake = makeConstructionCtx();

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOVoteOf', 'Frédéric'));

    expect(fake.frames.construction).toEqual([]);
    expect(result.success).toBe(false);
  });

  it('builds arguments before it checks the command is known', async () => {
    // Ordering finding: buildRdoCommandArgs runs at :132, the KNOWN check at
    // :214. An unknown command therefore reaches the argument builder first and
    // exits through its `default:` branch — with a non-numeric value it fails
    // with the ARGUMENT error, not the "unknown command" one. Nothing reaches
    // the wire either way, so this is an error-message wart, not a hole.
    const fake = makeConstructionCtx();

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOSetGravity', 'strong'));

    expect(result).toEqual({ success: false, newValue: '' });
    expect(fake.log.error).toHaveBeenCalledWith(expect.stringContaining('finite number'));
    expect(fake.log.error).not.toHaveBeenCalledWith(expect.stringContaining('KNOWN_RDO_COMMANDS'));
  });

  it('refuses to send when the construction socket is gone', async () => {
    const fake = makeConstructionCtx({ sockets: [] });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOAutoProduce', '1'));

    expect(result).toEqual({ success: false, newValue: '' });
    expect(fake.log.error).toHaveBeenCalledWith(expect.stringContaining('Construction socket unavailable'));
  });

  it('refuses the SET path too when the socket is gone', async () => {
    const fake = makeConstructionCtx({ sockets: [] });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOAcceptCloning', '1'));

    expect(result).toEqual({ success: false, newValue: '' });
  });

  it('refuses the direct property path too when the socket is gone', async () => {
    const fake = makeConstructionCtx({ sockets: [] });

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'property', '75', { propertyName: 'Interest' }));

    expect(result).toEqual({ success: false, newValue: '' });
  });

  it('refuses everything when the construction service never initialised', async () => {
    const fake = makeSessionCtx({ sockets: ['construction'], worldId: null });
    fake.cacher.createObject.mockResolvedValue(TEMP_OBJECT_ID);
    fake.cacher.getPropertyList.mockResolvedValue([CURR_BLOCK, OBJECT_ID]);

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOAutoProduce', '1'));

    expect(fake.ctx.connectConstructionService).toHaveBeenCalled();
    expect(fake.frames.construction).toEqual([]);
    expect(result).toEqual({ success: false, newValue: '' });
    expect(fake.log.error).toHaveBeenCalledWith(expect.stringContaining('worldId is null'));
  });

  it('propagates a connect failure as a refusal, not as a throw', async () => {
    const fake = makeConstructionCtx();
    (fake.ctx.connectMapService as jest.Mock).mockRejectedValue(new Error('map service down'));

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOAutoProduce', '1'));

    expect(result).toEqual({ success: false, newValue: '' });
    expect(fake.cacher.createObject).not.toHaveBeenCalled();
  });

  it('reports failure when the synchronous connect times out', async () => {
    // Production rejects with Error('Request timeout: <member>') — spo_session.ts:2403.
    const fake = makeConstructionCtx();
    fake.respond(() => new Error('Request timeout: RDOConnectInput'));

    const result = await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOConnectInput', '0', {
      fluidId: 'Plastics', connectionList: '706,436,',
    }));

    expect(result).toEqual({ success: false, newValue: '' });
    expect(fake.log.error).toHaveBeenCalledWith(expect.stringContaining('Request timeout: RDOConnectInput'));
    // The read-back never runs: only the target lookup opened an object.
    expect(fake.cacher.createObject).toHaveBeenCalledTimes(1);
    expect(fake.cacher.closeObject).toHaveBeenCalledTimes(1);
  });

  it('logs the frame it sent, so a refused mutation is traceable', async () => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOAutoProduce', '1'));

    expect(fake.log.debug).toHaveBeenCalledWith(expect.stringContaining('Setting RDOAutoProduce=1 at (706, 436)'));
    expect(fake.log.debug).toHaveBeenCalledWith(expect.stringContaining(`Sent: ${onlyFrame(fake)}`));
  });

  it('logs the two ids it resolved', async () => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOAutoProduce', '1'));

    expect(fake.log.debug).toHaveBeenCalledWith(
      expect.stringContaining(`Found CurrBlock: ${CURR_BLOCK}, ObjectId: ${OBJECT_ID}`),
    );
  });

  it('logs the synchronous completion separately from the frame path', async () => {
    const fake = makeConstructionCtx();

    await settle(setBuildingProperty(fake.ctx, X, Y, 'RDOConnectOutput', '0', {
      fluidId: 'Plastics', connectionList: '706,436,',
    }));

    expect(fake.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('Synchronous RDOConnectOutput completed'),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Construction socket serialisation
// ═══════════════════════════════════════════════════════════════════════════

describe('construction lock', () => {
  it('runs two concurrent mutations one after the other, in order', async () => {
    // The lock is a module-level WeakMap keyed on the context
    // (construction-lock.ts:14), so the context must be new for each test.
    // Mirrors TObjectInspectorContainer.GetMSProxy's Lock/Unlock
    // (ObjectInspectorHandleViewer.pas:599).
    const fake = makeConstructionCtx();

    const first = setBuildingProperty(fake.ctx, 10, 20, 'RDOAutoProduce', '1');
    // A second block-bound mutation: this test is about the lock, not about
    // gate resolution, so it stays clear of the one gate-addressed member.
    const second = setBuildingProperty(fake.ctx, 30, 40, 'RDOSetTradeLevel', '3');
    await jest.advanceTimersByTimeAsync(400);
    await Promise.all([first, second]);

    expect(fake.frames.construction).toEqual([
      RdoCommand.sel(CURR_BLOCK).call('RDOAutoProduce').push().args(RdoValue.int(-1)).build(),
      RdoCommand.sel(CURR_BLOCK).call('RDOSetTradeLevel').push().args(RdoValue.int(3)).build(),
    ]);

    // The discriminating part: the second mutation's lookup happens AFTER the
    // first one's read-back, not interleaved with it.
    expect(fake.cacher.setObject.mock.calls.map(c => [c[1], c[2]])).toEqual([
      [10, 20], [10, 20], [30, 40], [30, 40],
    ]);
  });

  it('lets the queue drain after a failure', async () => {
    // serialiseConstruction chains with `prev.then(fn, fn)`: a rejected
    // predecessor must not wedge the socket for the rest of the session.
    const fake = makeConstructionCtx();

    const failing = setBuildingProperty(fake.ctx, 10, 20, 'RDOSetGravity', '9');
    const following = setBuildingProperty(fake.ctx, 30, 40, 'RDOAutoProduce', '1');
    await jest.advanceTimersByTimeAsync(400);
    const [failed, ok] = await Promise.all([failing, following]);

    expect(failed.success).toBe(false);
    expect(ok.success).toBe(true);
    expect(fake.frames.construction).toEqual([
      RdoCommand.sel(CURR_BLOCK).call('RDOAutoProduce').push().args(RdoValue.int(-1)).build(),
    ]);
  });
});
