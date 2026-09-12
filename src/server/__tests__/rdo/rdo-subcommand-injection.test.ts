/**
 * End-to-end wire-byte tests for P-M2 — sub-command injection through raw
 * arguments. (Lot L2.)
 *
 * P-C1 (lot L1) closed the *frame* injection: a code point above 0xFF whose low
 * byte was `"` or `;`. P-M2 is a different, pure-ASCII hole at the same
 * chokepoint and survives that fix: `RdoProtocol.formatTypedToken` used to
 * return an argument verbatim as soon as it *started* with one of the seven RDO
 * type prefixes, without doubling the `"` inside it. The payload therefore did
 * not need to forge a frame terminator — it only had to close its own literal
 * and open a second sub-command of the SAME `sel`, which the Delphi
 * `ExecQuery` loop executes (`RDOQueryServer.pas:133-160`).
 *
 * The oracle here is consequently NOT "how many frames" (the L1 oracle) but
 * "how many top-level sub-commands", counted outside quoted literals exactly
 * like Delphi's `KeyWordPos` (`RDOUtils.pas:109-121`).
 *
 * Every suite drives a real production entry point through the real
 * serialisation chain — handler → `RdoValue.format()` → `RdoProtocol.format()`
 * → `writeRdoFrame()` — and inspects the bytes handed to `socket.write()`.
 * Nothing is hand-built except the explicit pre-fix regression oracle at the
 * bottom, whose job is to prove the payloads have teeth.
 */

import type { Socket } from 'net';
import type { RdoPacket, WorldInfo } from '../../../shared/types';
import { RDO_CONSTANTS, RdoAction } from '../../../shared/types';
import { RdoParser, RdoValue, RDO_TYPE_PREFIXES } from '../../../shared/rdo-types';
import { RdoFramer, RdoProtocol } from '../../rdo';
import { writeRdoFrame } from '../../rdo-helpers';
import { StarpeaceSession } from '../../spo_session';
import type { SessionContext } from '../../session/session-context';
import { joinChatChannel, getChatChannelInfo } from '../../session/chat-handler';
import { queryTycoonPoliticalRole } from '../../session/building-management-handler';

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

const SUB_COMMAND_KEYWORDS: ReadonlySet<string> = new Set(['sel', 'idof', 'call', 'get', 'set']);

/**
 * Top-level RDO keywords of a frame — those lying OUTSIDE any quoted literal.
 *
 * A plain toggle on `"` is faithful to the Delphi scanner: an escaped quote is
 * the adjacent pair `""` (`RDOStrEncode`, `RDOUtils.pas:246-254`), so the two
 * toggles cancel with no character in between and no spurious token can appear.
 */
function topLevelKeywords(frame: string): string[] {
  const words: string[] = [];
  let inQuotes = false;
  let current = '';
  const flush = (): void => {
    if (current.length > 0) words.push(current);
    current = '';
  };
  for (const ch of frame) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      flush();
    } else if (inQuotes) {
      continue;
    } else if (ch === ' ' || ch === ',' || ch === ';' || ch === '=') {
      flush();
    } else {
      current += ch;
    }
  }
  flush();
  return words.filter((w) => SUB_COMMAND_KEYWORDS.has(w));
}

/** Assert one frame carries exactly one object selection and one sub-command. */
function expectSingleSubCommand(frame: string): void {
  const keywords = topLevelKeywords(frame);
  const selectors = keywords.filter((k) => k === 'sel' || k === 'idof');
  const actions = keywords.filter((k) => k === 'call' || k === 'get' || k === 'set');
  expect(selectors).toHaveLength(1);
  expect(actions.length).toBeLessThanOrEqual(1);
}

/** Assert an entire recorded wire is free of injected frames and sub-commands. */
function expectNoInjection(writes: Buffer[]): string[] {
  const frames = new RdoFramer().ingest(Buffer.concat(writes));
  for (const frame of frames) {
    expectSingleSubCommand(frame);
    // Every literal on the wire must be balanced: an odd number of quotes means
    // the frame cannot be re-parsed the way we assembled it.
    expect((frame.match(/"/g) ?? []).length % 2).toBe(0);
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Harness — real session, recording socket, production send path
// ---------------------------------------------------------------------------

/**
 * Canned replies keyed by member name, chosen so the production handlers keep
 * walking their happy path instead of bailing out before the interesting frame.
 */
function cannedPayload(packet: RdoPacket): string {
  if (packet.verb === 'idof') return 'objid="39751288"';
  switch (packet.member) {
    case 'RDOOpenSession': return 'RDOOpenSession="#142217260"';
    case 'SetPath': return 'res="#-1"';
    case 'CreateObject': return 'res="%4242"';
    case 'GetPropertyList': return 'res="%-1\t\t\t0\t0\t"';
    case 'RDOQueryKey': return 'res="%Count=0"';
    case 'RDOSearchKey': return 'res="%"';
    default: return 'res="#0"';
  }
}

interface Harness {
  session: StarpeaceSession;
  writes: Buffer[];
}

/** Drop the QueryId so expectations do not depend on how many frames preceded. */
function withoutRid(frame: string): string {
  return frame.replace(/^C \d+ /, 'C ');
}

function createHarness(): Harness {
  const writes: Buffer[] = [];
  const socket = {
    write(chunk: Buffer | string): boolean {
      writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'latin1'));
      return true;
    },
    end(): void { /* no-op */ },
    destroyed: false,
  } as unknown as Socket;

  const session = new StarpeaceSession();

  jest.spyOn(session, 'createSocket').mockResolvedValue(socket);
  jest.spyOn(session, 'getSocket').mockReturnValue(socket);
  jest.spyOn(session, 'deleteSocket').mockImplementation(() => undefined);
  jest.spyOn(session, 'connectMapService').mockResolvedValue(undefined);
  jest.spyOn(session, 'cacherCloseObject').mockImplementation(() => undefined);

  // Reproduces the real send path verbatim (spo_session.ts:2209-2222): a QueryId
  // is allocated, then the packet the handler built is serialised by the
  // production formatter and written by the production writer.
  let nextRid = 1;
  jest.spyOn(session, 'sendRdoRequest').mockImplementation(
    async (_socketName: string, packetData: Partial<RdoPacket>): Promise<RdoPacket> => {
      const rid = nextRid++;
      const packet = { ...packetData, rid } as RdoPacket;
      const raw = RdoProtocol.format(packet);
      writeRdoFrame(socket, raw + RDO_CONSTANTS.PACKET_DELIMITER, true);
      return { raw, type: 'RESPONSE', rid, payload: cannedPayload(packet) };
    }
  );

  return { session, writes };
}

/**
 * The canonical P-M2 payload. Raw, it used to leave `formatTypedToken` as
 *   "%evil" call Evil "*" ""
 * i.e. the argument literal closed after `evil`, then `call Evil "*" ""` became
 * a second sub-command of the enclosing `sel`.
 */
const SUBCOMMAND_PAYLOAD = '%evil" call Evil "*" "';

/** Variant that starts with `$` (StringId) — the annexe's own example. */
const STRINGID_PAYLOAD = '$a"; C sel 1 call Evil "*" "';

// ---------------------------------------------------------------------------

describe('P-M2 — sub-command injection through a chat channel name', () => {
  afterEach(() => jest.restoreAllMocks());

  it('emits one sel with one call for a benign channel name', async () => {
    const h = createHarness();
    h.session.setWorldContextId('8161308');

    await joinChatChannel(h.session as unknown as SessionContext, 'Lobby');

    const frames = expectNoInjection(h.writes);
    expect(frames).toHaveLength(1);
    expect(withoutRid(frames[0])).toBe('C sel 8161308 call JoinChannel "^" "%Lobby","%"');
  });

  it('does not open a second sub-command for a hostile channel name', async () => {
    const h = createHarness();
    h.session.setWorldContextId('8161308');

    await joinChatChannel(h.session as unknown as SessionContext, SUBCOMMAND_PAYLOAD);

    const frames = expectNoInjection(h.writes);
    expect(frames).toHaveLength(1);
    // `call Evil` survives as inert text INSIDE the literal — the correct
    // outcome. What must not happen is it becoming a sub-command.
    expect(withoutRid(frames[0])).toBe(
      'C sel 8161308 call JoinChannel "^" "%%evil"" call Evil ""*"" ""","%"'
    );
    expect(RdoProtocol.parse(frames[0]).member).toBe('JoinChannel');
  });

  it('does not open a second sub-command for the `$` variant', async () => {
    const h = createHarness();
    h.session.setWorldContextId('8161308');

    await getChatChannelInfo(h.session as unknown as SessionContext, STRINGID_PAYLOAD);

    const frames = expectNoInjection(h.writes);
    expect(frames).toHaveLength(1);
    expect(RdoProtocol.parse(frames[0]).member).toBe('GetChannelInfo');
  });

  it('keeps the channel name typed as OLEString, never re-typed by its first byte', async () => {
    const h = createHarness();
    h.session.setWorldContextId('8161308');

    // A channel literally named "#42" is a string, not the integer 42.
    await joinChatChannel(h.session as unknown as SessionContext, '#42');

    const frames = expectNoInjection(h.writes);
    expect(withoutRid(frames[0])).toBe('C sel 8161308 call JoinChannel "^" "%#42","%"');
  });
});

describe('P-M2 — sub-command injection through the username / password', () => {
  afterEach(() => jest.restoreAllMocks());

  it('emits only single-sub-command frames for benign credentials', async () => {
    const h = createHarness();
    await h.session.checkAuth('SPO_test3', 'test3');

    const frames = expectNoInjection(h.writes);
    const logon = frames.find((f) => RdoProtocol.parse(f).member === 'RDOLogonUser');
    expect(withoutRid(logon!)).toBe('C sel 142217260 call RDOLogonUser "^" "%SPO_test3","%test3"');
  });

  it('does not open a second sub-command for a hostile pre-auth username', async () => {
    const h = createHarness();
    // Reachable with NO credentials and NO session: this is the first user text
    // the gateway ever puts on the directory socket (login-handler.ts:198-206).
    await h.session.checkAuth(SUBCOMMAND_PAYLOAD, 'test3');

    const frames = expectNoInjection(h.writes);
    const map = frames.find((f) => RdoProtocol.parse(f).member === 'RDOMapSegaUser');
    expect(withoutRid(map!)).toBe(
      'C sel 142217260 call RDOMapSegaUser "^" "%%evil"" call Evil ""*"" """'
    );
  });

  it('does not open a second sub-command for a hostile password', async () => {
    const h = createHarness();
    await h.session.checkAuth('SPO_test3', STRINGID_PAYLOAD);

    expectNoInjection(h.writes);
    const wire = Buffer.concat(h.writes).toString('latin1');
    // The `;` in the payload stays inside the literal — the framer must still
    // see exactly the frames we sent, not one more.
    expect(wire).toContain('"%$a""; C sel 1 call Evil ""*"" """');
  });
});

describe('P-M2 — sub-command injection through zonePath (world list)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does not open a second sub-command for a hostile zonePath', async () => {
    const h = createHarness();
    // zonePath is relayed straight from REQ_WORLD_LIST.
    await h.session.connectDirectory('SPO_test3', 'test3', `Root/Areas/${SUBCOMMAND_PAYLOAD}/Worlds`);

    const frames = expectNoInjection(h.writes);
    const query = frames.find((f) => RdoProtocol.parse(f).member === 'RDOQueryKey');
    expect(query).toBeDefined();
    expect(withoutRid(query!).startsWith(
      'C sel 142217260 call RDOQueryKey "^" "%Root/Areas/%evil"" call Evil ""*"" ""/Worlds"'
    )).toBe(true);
    expect(topLevelKeywords(query!)).toEqual(['sel', 'call']);
  });

  it('keeps a benign zonePath byte-identical', async () => {
    const h = createHarness();
    await h.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/America/Worlds');

    const frames = expectNoInjection(h.writes);
    const query = frames.find((f) => RdoProtocol.parse(f).member === 'RDOQueryKey')!;
    expect(query).toContain('call RDOQueryKey "^" "%Root/Areas/America/Worlds","%General/Population');
    expect(topLevelKeywords(query)).toEqual(['sel', 'call']);
  });
});

describe('P-M2 — sub-command injection through a tycoon name (object cache path)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does not open a second sub-command for a hostile tycoon name', async () => {
    const h = createHarness();
    h.session.setCacherId('40133496');
    h.session.setCurrentWorldInfo({ name: 'planitia' } as WorldInfo);

    // building-management-handler.ts:45 interpolates the name into
    // `Tycoons\<name>.five\` and hands it to SetPath.
    await queryTycoonPoliticalRole(h.session as unknown as SessionContext, SUBCOMMAND_PAYLOAD);

    const frames = expectNoInjection(h.writes);
    const setPath = frames.find((f) => RdoProtocol.parse(f).member === 'SetPath');
    expect(setPath).toBeDefined();
    expect(topLevelKeywords(setPath!)).toEqual(['sel', 'call']);
    expect(setPath).toContain('"%Tycoons\\%evil"" call Evil ""*"" "".five\\"');
  });

  it('keeps a benign tycoon name byte-identical', async () => {
    const h = createHarness();
    h.session.setCacherId('40133496');
    h.session.setCurrentWorldInfo({ name: 'planitia' } as WorldInfo);

    await queryTycoonPoliticalRole(h.session as unknown as SessionContext, 'SPO_test3');

    const frames = expectNoInjection(h.writes);
    const setPath = frames.find((f) => RdoProtocol.parse(f).member === 'SetPath')!;
    expect(withoutRid(setPath)).toBe('C sel 4242 call SetPath "^" "%Tycoons\\SPO_test3.five\\"');
  });
});

// ---------------------------------------------------------------------------
// Regression oracle — the payloads must have had teeth before the fix
// ---------------------------------------------------------------------------

describe('P-M2 — pre-fix behaviour (regression oracle)', () => {
  /** `formatTypedToken` exactly as it stood before lot L2 (rdo.ts:398-427). */
  function legacyFormatTypedToken(val: string, autoTypeNumeric = true): string {
    if (val.startsWith('"') && val.endsWith('"')) {
      const extracted = RdoParser.extract(val);
      if (extracted.prefix) return val;
    }
    let cleaned = val;
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
      cleaned = cleaned.substring(1, cleaned.length - 1);
    }
    if (RDO_TYPE_PREFIXES.includes(cleaned.charAt(0))) {
      return `"${cleaned}"`;
    }
    if (autoTypeNumeric && /^-?\d+$/.test(cleaned)) {
      return RdoValue.int(parseInt(cleaned, 10)).format();
    }
    return RdoValue.string(cleaned).format();
  }

  it('the old prefix branch produced a genuine second sub-command', () => {
    const legacyFrame =
      `C 7 sel 42 call JoinChannel "^" ${legacyFormatTypedToken(SUBCOMMAND_PAYLOAD, false)},"%";`;

    // One frame — the injection is INSIDE it, which is exactly why the L1
    // frame-count oracle could not see this bug.
    const frames = new RdoFramer().ingest(Buffer.from(legacyFrame, 'latin1'));
    expect(frames).toHaveLength(1);
    expect(topLevelKeywords(frames[0])).toEqual(['sel', 'call', 'call']);
    expect(frames[0]).toBe('C 7 sel 42 call JoinChannel "^" "%evil" call Evil "*" "","%"');
  });

  it('the old prefix branch also produced a second FRAME for the `$` payload', () => {
    const legacyFrame =
      `C 7 sel 42 call GetChannelInfo "^" ${legacyFormatTypedToken(STRINGID_PAYLOAD, false)};`;

    const frames = new RdoFramer().ingest(Buffer.from(legacyFrame, 'latin1'));
    expect(frames).toHaveLength(2);
    expect(frames[1]).toBe('C sel 1 call Evil "*" ""');
  });

  it('the old first branch was equally unescaped for an already-quoted payload', () => {
    // `"%evil" call Evil "*" "` starts AND ends with a quote, so RdoParser.extract
    // saw a `%` prefix and the token was returned verbatim — a second, distinct
    // hole in the same function that the annexe did not record.
    const already = `"${SUBCOMMAND_PAYLOAD}"`;
    expect(legacyFormatTypedToken(already, false)).toBe(already);
    expect(topLevelKeywords(`C sel 42 call X "^" ${already};`)).toEqual(['sel', 'call', 'call']);

    // Post-fix: same input, one sub-command.
    const fixed = RdoProtocol.format({
      raw: '', type: 'PUSH', verb: 'sel', targetId: '42',
      action: RdoAction.CALL, member: 'X', separator: '"^"', args: [already],
    } as RdoPacket);
    expect(topLevelKeywords(fixed)).toEqual(['sel', 'call']);
  });
});
