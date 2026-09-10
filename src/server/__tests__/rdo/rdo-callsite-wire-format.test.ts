/**
 * Lot L2 — wire bytes of the call sites converted from raw arguments to
 * explicit `RdoValue` (P-M2 remediation, option (b)).
 *
 * Each of these sites used to hand `RdoProtocol.formatTypedToken` a raw string
 * and rely on its heuristics. The conversion must be **byte-identical** for
 * legitimate input; that is what this suite pins, by driving the production
 * handler and asserting the exact frame.
 *
 * `set EnableEvents="#-1"` is the load-bearing one: it used to depend on the
 * implicit numeric auto-typing of SET arguments (O-L7). Had the conversion
 * emitted `"%-1"` instead, every server push would have stopped arriving with
 * no error anywhere in the system.
 */

import type { Socket } from 'net';
import type { CompanyInfo, RdoPacket, WorldInfo } from '../../../shared/types';
import { RDO_CONSTANTS, RdoAction, RdoVerb } from '../../../shared/types';
import { RdoFramer, RdoProtocol } from '../../rdo';
import { writeRdoFrame } from '../../rdo-helpers';
import { StarpeaceSession } from '../../spo_session';
import type { SessionContext } from '../../session/session-context';
import { selectCompany } from '../../session/login-handler';
import type { LoginContext } from '../../session/login-handler';
import { searchConnections } from '../../session/politics-handler';
import { manageConstruction } from '../../session/building-management-handler';

interface Harness {
  session: StarpeaceSession;
  frames(): string[];
}

function cannedPayload(packet: RdoPacket): string {
  if (packet.verb === RdoVerb.IDOF) return 'objid="39751288"';
  // A GET answer echoes the member name, not `res=`.
  if (packet.action === RdoAction.GET) return `${packet.member}="#1"`;
  switch (packet.member) {
    case 'CreateObject': return 'res="%4242"';
    case 'GetPropertyList': return 'res="%40133496\t40133496\t1\t"';
    case 'GetTycoonCookie': return 'res="%0"';
    case 'FindSuppliers':
    case 'FindClients': return 'res="%"';
    default: return 'res="#0"';
  }
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
  jest.spyOn(session, 'connectMapService').mockResolvedValue(undefined);
  jest.spyOn(session, 'connectConstructionService').mockResolvedValue(undefined);
  jest.spyOn(session, 'cacherCloseObject').mockImplementation(() => undefined);
  jest.spyOn(session, 'startServerBusyPolling').mockImplementation(() => undefined);
  jest.spyOn(session, 'startGcSweep').mockImplementation(() => undefined);

  let nextRid = 1;
  jest.spyOn(session, 'sendRdoRequest').mockImplementation(
    async (_socketName: string, packetData: Partial<RdoPacket>): Promise<RdoPacket> => {
      const packet = { ...packetData, rid: nextRid++ } as RdoPacket;
      writeRdoFrame(socket, RdoProtocol.format(packet) + RDO_CONSTANTS.PACKET_DELIMITER, true);
      return { raw: '', type: 'RESPONSE', rid: packet.rid, payload: cannedPayload(packet) };
    }
  );

  return { session, frames: () => new RdoFramer().ingest(Buffer.concat(writes)) };
}

const withoutRid = (frame: string): string => frame.replace(/^C \d+ /, 'C ');

describe('selectCompany — EnableEvents / PickEvent / GetTycoonCookie bytes', () => {
  afterEach(() => jest.restoreAllMocks());

  it('emits the captured byte sequence', async () => {
    const h = createHarness();
    h.session.setWorldContextId('8161308');
    h.session.setTycoonId('4666201923');
    h.session.setAvailableCompanies([{ id: '55', name: 'SPO_test3 - Green' } as CompanyInfo]);

    await selectCompany(h.session as unknown as LoginContext, '55');

    const frames = h.frames().map(withoutRid);

    // Live capture — `set EnableEvents="#-1"`. Delphi wordbool TRUE is -1;
    // "%-1" would silently disable every push (O-L7).
    expect(frames).toContain('C sel 8161308 set EnableEvents="#-1"');

    // PickEvent(TycoonId: integer) — must stay "#", never "%".
    expect(frames).toContain('C sel 8161308 call PickEvent "^" "#4666201923"');

    // GetTycoonCookie(TycoonId: integer; CookieId: widestring)
    expect(frames).toContain('C sel 8161308 call GetTycoonCookie "^" "#4666201923","%LastY.0"');
    expect(frames).toContain('C sel 8161308 call GetTycoonCookie "^" "#4666201923","%LastX.0"');
    expect(frames).toContain('C sel 8161308 call GetTycoonCookie "^" "#4666201923","%"');

    // ClientAware is fire-and-forget: "*" and no QueryId (live capture).
    expect(frames).toContain('C sel 8161308 call ClientAware "*"');
  });
});

describe('searchConnections — FindSuppliers / FindClients argument bytes', () => {
  afterEach(() => jest.restoreAllMocks());

  function prime(h: Harness): void {
    h.session.setCacherId('40133496');
    h.session.setCurrentWorldInfo({ name: 'planitia' } as WorldInfo);
  }

  it('keeps benign filters byte-identical', async () => {
    const h = createHarness();
    prime(h);

    await searchConnections(h.session as unknown as SessionContext, 706, 436, 'Plastics', 'input', {
      town: 'Kalisz', company: 'SPO_test3 - Green', maxResults: 20, roles: 31,
    });

    const find = h.frames().map(withoutRid).find((f) => f.includes('FindSuppliers'));
    // Delphi: FindSuppliers(Output, World, Town, Name: widestring;
    //         Count, X, Y, SortMode, Role: integer) — CacheServerReportForm.pas:108
    expect(find).toBe(
      'C sel 40133496 call FindSuppliers "^" ' +
      '"%Plastics","%planitia","%Kalisz","%SPO_test3 - Green","#20","#706","#436","#1","#31"'
    );
  });

  it('defaults the empty filters to "%", and the role set to the all-checked 78', async () => {
    const h = createHarness();
    prime(h);

    await searchConnections(h.session as unknown as SessionContext, 1, 2, 'Food', 'output');

    const find = h.frames().map(withoutRid).find((f) => f.includes('FindClients'));
    // 78 = rolCompInport 64 | rolBuyer 8 | rolDistributer 4 | rolProducer 2 — every box of
    // Voyager's customer form (InputSearchHandlerViewer.pas:313-327).
    expect(find).toBe(
      'C sel 40133496 call FindClients "^" "%Food","%planitia","%","%","#20","#1","#2","#1","#78"'
    );
  });

  it('neutralises a hostile town filter instead of opening a sub-command', async () => {
    const h = createHarness();
    prime(h);

    await searchConnections(h.session as unknown as SessionContext, 1, 2, 'Food', 'output', {
      town: '%x" call Evil "*" "',
    });

    const find = h.frames().find((f) => f.includes('FindClients'))!;
    expect(find).toContain('"%%x"" call Evil ""*"" """');
    expect(new RdoFramer().ingest(Buffer.from(find + ';', 'latin1'))).toHaveLength(1);
  });
});

describe('manageConstruction — RDOAcceptCloning lock bytes', () => {
  afterEach(() => jest.restoreAllMocks());

  it('locks the block with set RDOAcceptCloning="#-1"', async () => {
    const h = createHarness();
    h.session.setCacherId('40133496');
    h.session.setCurrentWorldInfo({ name: 'planitia' } as WorldInfo);
    h.session.setWorldId('30430748');

    await manageConstruction(h.session as unknown as SessionContext, 706, 436, 'START', 1);

    const frames = h.frames().map(withoutRid);
    // Same O-L7 dependency as EnableEvents: wordbool TRUE must stay "#-1".
    expect(frames).toContain('C sel 40133496 set RDOAcceptCloning="#-1"');
  });
});
