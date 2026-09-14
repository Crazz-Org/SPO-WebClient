/**
 * Push dispatcher — one describe per handled member, plus the degraded shapes.
 *
 * This is the entry point of EVERY server-initiated push: it is pure parsing of
 * an incoming frame, so what a test establishes is which setter received which
 * parsed value and which typed WebSocket event left the gateway. Nothing is
 * emitted on the wire here, which is why the packets below are written by hand —
 * the "never build an RDO string yourself" rule of the mission (§6) is about
 * EXPECTED values on the way OUT.
 *
 * Every packet shape is taken from a live capture where one exists, and each
 * `describe` cites the Delphi declaration it mirrors — `TISEvents`,
 * `Voyager/URLHandlers/ServerCnxHandler.pas:469-505`.
 *
 * The pattern worth knowing before reading: a member whose guard carries an
 * arity test (`&& packet.args.length >= N`) does NOT return when the guard
 * fails — control falls through to the generic fallback at the end and the raw
 * frame is forwarded as `EVENT_RDO_PUSH`. That degradation is asserted member by
 * member, because it is the difference between "the client sees nothing" and
 * "the client sees something it can log".
 */

import * as fs from 'fs';
import * as path from 'path';
import { dispatchPush } from './push-dispatcher';
import { makePushCtx } from '../__tests__/session/fake-session-context';
import { WsMessageType, RdoVerb, RdoAction } from '../../shared/types';
import type { RdoPacket } from '../../shared/types';

// ── Incoming frames ─────────────────────────────────────────────────────────

/**
 * The InterfaceServer events proxy id the server pushes to. Value taken from a
 * live capture so the frames below read exactly like the ones the live server
 * sent.
 */
const PUSH_TARGET = '41003058';

/** The socket a push arrives on — the dispatcher must ignore it (see §transverse). */
const WORLD_SOCKET = 'world';

/**
 * Build an incoming PUSH packet the way `RdoProtocol.parse()` hands it over:
 * quotes stripped, type prefix KEPT (`stripTypedToken`, `rdo.ts:529-537`).
 */
function incoming(member: string | undefined, args?: string[]): RdoPacket {
  const argList = (args ?? []).map(a => `"${a}"`).join(',');
  const call = member ? `call ${member} "*"${argList ? ` ${argList}` : ''}` : 'call';
  return {
    raw: `C sel ${PUSH_TARGET} ${call};`,
    type: 'PUSH',
    verb: RdoVerb.SEL,
    targetId: PUSH_TARGET,
    action: RdoAction.CALL,
    member,
    separator: '"*"',
    ...(args ? { args } : {}),
  };
}

/**
 * A push context whose virtual date behaves like the session field it stands in
 * for: `setVirtualDate` writes it, `getVirtualDate` reads it back. The InitClient
 * path writes then re-reads (`push-dispatcher.ts:101-110`), so a fake that always
 * answers `null` would silently skip the `EVENT_REFRESH_DATE` it must emit.
 */
function makeInitClientCtx(resolver: (() => void) | null = jest.fn()) {
  let virtualDate: number | null = null;
  const fake = makePushCtx({
    getWaitingForInitClient: jest.fn(() => true),
    setVirtualDate: jest.fn((value: number | null) => { virtualDate = value; }),
    getVirtualDate: jest.fn(() => virtualDate),
    getInitClientResolver: jest.fn(() => resolver),
  });
  return fake;
}

// ═══════════════════════════════════════════════════════════════════════════
// InitClient — push-dispatcher.ts:91 · ServerCnxHandler.pas:476
// ═══════════════════════════════════════════════════════════════════════════

describe('InitClient', () => {
  // Live capture:
  //   C sel 39827727 call InitClient "*" "@167177","%100000000","#0","#272762984"
  const CAPTURED_ARGS = ['@167177', '%100000000', '#0', '#272762984'];

  it('parses the four login fields and keeps money as the string the server sent', () => {
    const resolver = jest.fn();
    const fake = makeInitClientCtx(resolver);

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('InitClient', CAPTURED_ARGS));

    expect(fake.ctx.setVirtualDate).toHaveBeenCalledWith(167177);
    // `%100000000` is an OLEString on the wire and stays a string here: the
    // account balance overflows a double once the tycoon is rich.
    expect(fake.ctx.setAccountMoney).toHaveBeenCalledWith('100000000');
    expect(fake.ctx.setFailureLevel).toHaveBeenCalledWith(0);
    expect(fake.ctx.setFTycoonProxyId).toHaveBeenCalledWith(272762984);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(fake.ctx.setWaitingForInitClient).toHaveBeenCalledWith(false);
    expect(fake.ctx.setInitClientResolver).toHaveBeenCalledWith(null);
  });

  it('forwards the initial game date it just parsed, not a constant', () => {
    const fake = makeInitClientCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('InitClient', CAPTURED_ARGS));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_REFRESH_DATE,
      dateDouble: 167177,
    });
  });

  it('emits no date when the parsed date is not a number the session could store', () => {
    // `@` with an empty body: parseFloat('') is NaN, which the session stores as
    // null — the guard at :110 is what keeps a NaN date off the WebSocket.
    let virtualDate: number | null = null;
    const fake = makePushCtx({
      getWaitingForInitClient: jest.fn(() => true),
      setVirtualDate: jest.fn((value: number | null) => {
        virtualDate = Number.isNaN(value) ? null : value;
      }),
      getVirtualDate: jest.fn(() => virtualDate),
    });

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('InitClient', ['@', '%0', '#0', '#1']));

    expect(fake.emit).not.toHaveBeenCalled();
    expect(fake.ctx.setWaitingForInitClient).toHaveBeenCalledWith(false);
  });

  it('detects InitClient in the raw frame when the parser produced no member', () => {
    const fake = makeInitClientCtx();
    const packet: RdoPacket = {
      ...incoming(undefined, CAPTURED_ARGS),
      raw: `C sel ${PUSH_TARGET} call InitClient "*" "@167177","%100000000","#0","#272762984";`,
    };

    dispatchPush(fake.ctx, WORLD_SOCKET, packet);

    expect(fake.ctx.setFTycoonProxyId).toHaveBeenCalledWith(272762984);
    expect(fake.log.debug).toHaveBeenCalledWith(expect.stringContaining('detected in raw'));
  });

  it('says which side detected it, so a parser regression is visible in the log', () => {
    const fake = makeInitClientCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('InitClient', CAPTURED_ARGS));

    expect(fake.log.debug).toHaveBeenCalledWith(expect.stringContaining('detected in member'));
  });

  it('releases the login wait even when the payload is too short to parse', () => {
    const resolver = jest.fn();
    const fake = makeInitClientCtx(resolver);

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('InitClient', ['@167177', '%100000000', '#0']));

    expect(fake.log.warn).toHaveBeenCalledWith(expect.stringContaining('expected 4, got 3'));
    expect(fake.ctx.setVirtualDate).not.toHaveBeenCalled();
    // The point of the test: a malformed InitClient must not hang login.
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(fake.ctx.setWaitingForInitClient).toHaveBeenCalledWith(false);
  });

  it('reports zero args when the frame carried none at all', () => {
    const fake = makeInitClientCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('InitClient'));

    expect(fake.log.warn).toHaveBeenCalledWith(expect.stringContaining('expected 4, got 0'));
  });

  it('completes the handshake even if a ws_event listener throws', () => {
    // `emit` is inside the try (:111) and Node's EventEmitter re-throws whatever
    // a listener throws, synchronously. Without the catch, one bad listener would
    // leave `waitingForInitClient` true and login would time out at 15 s.
    const resolver = jest.fn();
    let virtualDate: number | null = null;
    const fake = makePushCtx({
      getWaitingForInitClient: jest.fn(() => true),
      setVirtualDate: jest.fn((value: number | null) => { virtualDate = value; }),
      getVirtualDate: jest.fn(() => virtualDate),
      getInitClientResolver: jest.fn(() => resolver),
      emit: jest.fn(() => { throw new Error('listener exploded'); }),
    });

    expect(() => dispatchPush(fake.ctx, WORLD_SOCKET, incoming('InitClient', CAPTURED_ARGS))).not.toThrow();

    expect(fake.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse InitClient data'),
      expect.any(Error),
    );
    expect(fake.log.debug).toHaveBeenCalledWith(expect.stringContaining('Raw args'), CAPTURED_ARGS);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('leaves the resolver alone when login is not waiting on one', () => {
    const fake = makeInitClientCtx(null);

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('InitClient', CAPTURED_ARGS));

    expect(fake.ctx.setWaitingForInitClient).toHaveBeenCalledWith(false);
    expect(fake.ctx.setInitClientResolver).not.toHaveBeenCalled();
  });

  it('does not swallow other pushes that arrive inside the login window', () => {
    // Chat traffic starts before InitClient does — a live capture shows a
    // ChatMsg in that window.
    const fake = makePushCtx({ getWaitingForInitClient: jest.fn(() => true) });

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('ChatMsg', ['%SYSTEM', '%innos has entered Planitia']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_CHAT_MSG,
      channel: 'Lobby',
      from: 'SYSTEM',
      message: 'innos has entered Planitia',
    });
    expect(fake.ctx.setWaitingForInitClient).not.toHaveBeenCalled();
  });

  it('ignores an empty raw frame while waiting, instead of matching on it', () => {
    const fake = makePushCtx({ getWaitingForInitClient: jest.fn(() => true) });
    const packet: RdoPacket = { ...incoming(undefined), raw: '' };

    dispatchPush(fake.ctx, WORLD_SOCKET, packet);

    expect(fake.ctx.setWaitingForInitClient).not.toHaveBeenCalled();
    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_RDO_PUSH,
      rawPacket: '',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SetLanguage — push-dispatcher.ts:135
// ═══════════════════════════════════════════════════════════════════════════

describe('SetLanguage', () => {
  // Not a TISEvents member: this is the server echoing back the push the client
  // itself sent during login (`login-handler.ts:465-474`). Nothing to do with it.
  it('is acknowledged in the log and produces no event', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('SetLanguage', ['%ENG']));

    expect(fake.emit).not.toHaveBeenCalled();
    expect(fake.log.debug).toHaveBeenCalledWith(expect.stringContaining('SetLanguage push (ignored)'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NewMail — push-dispatcher.ts:141 · ServerCnxHandler.pas:488
// ═══════════════════════════════════════════════════════════════════════════

describe('NewMail', () => {
  it('forwards the unread count from the ordinal argument', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('NewMail', ['#3']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_NEW_MAIL,
      unreadCount: 3,
    });
  });

  it('reports zero unread when the count argument is missing', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('NewMail'));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_NEW_MAIL,
      unreadCount: 0,
    });
  });

  it('reports zero unread on an empty argument rather than NaN', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('NewMail', ['']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_NEW_MAIL,
      unreadCount: 0,
    });
  });

  it('yields NaN when the count is not a number — the client sees it, the gateway does not guess', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('NewMail', ['#abc']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_NEW_MAIL,
      unreadCount: NaN,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ChatMsg — push-dispatcher.ts:153 · ServerCnxHandler.pas:485
// ═══════════════════════════════════════════════════════════════════════════

describe('ChatMsg', () => {
  it('emits sender and text, defaulting the channel to Lobby', () => {
    // Packet shape taken from a live capture.
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('ChatMsg', ['%SYSTEM', '%innos has entered Planitia']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_CHAT_MSG,
      channel: 'Lobby',
      from: 'SYSTEM',
      message: 'innos has entered Planitia',
    });
  });

  it('tags the message with the channel the session is currently on', () => {
    const fake = makePushCtx({ getCurrentChannel: jest.fn(() => 'Trade') });

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('ChatMsg', ['%innos', '%anyone selling plastics?']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', expect.objectContaining({ channel: 'Trade' }));
  });

  it('keeps only the name when the server appends the account id', () => {
    // Delphi sends `Name`, `Name/AccDesc` or `Name/AccDesc/State`
    // (NotifyUserListChange's format, reused for the sender field).
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('ChatMsg', ['%innos/8388608', '%hello']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', expect.objectContaining({ from: 'innos' }));
  });

  it('carries accented text through unchanged — latin1 is the wire codec', () => {
    // The read path decodes the frame from latin1 (`RdoFramer.ingest`), so what
    // reaches the dispatcher is already a JS string. Round-tripping the bytes
    // here states the invariant the way the socket sees it: every one of these
    // characters is a single byte on the wire.
    const wireBytes = Buffer.from('Salut à tous, ça coûte 5€ ?', 'latin1');
    const decoded = wireBytes.toString('latin1');
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('ChatMsg', ['%Frédéric', `%${decoded}`]));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', expect.objectContaining({
      from: 'Frédéric',
      message: decoded,
    }));
  });

  it('strips exactly one type prefix, so a message starting with # survives', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('ChatMsg', ['%innos', '%#1 seller in Planitia']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', expect.objectContaining({
      message: '#1 seller in Planitia',
    }));
  });

  it('warns and degrades to the raw push when the text argument is missing', () => {
    // No `return` on this branch (:179) — control reaches the generic fallback.
    const fake = makePushCtx();
    const packet = incoming('ChatMsg', ['%SYSTEM']);

    dispatchPush(fake.ctx, WORLD_SOCKET, packet);

    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('insufficient args'),
      packet,
    );
    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_RDO_PUSH,
      rawPacket: packet.raw,
    });
  });

  it('degrades to the raw push when the frame carried no arguments at all', () => {
    const fake = makePushCtx();
    const packet = incoming('ChatMsg');

    dispatchPush(fake.ctx, WORLD_SOCKET, packet);

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_RDO_PUSH,
      rawPacket: packet.raw,
    });
  });

  it('decodes the AccDesc carried after the sender name into tier and modifiers', () => {
    // 1056576 = (0x0010 << 16) | 8000 -> Duke + GameMaster.
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('ChatMsg', ['%Zorg/1056576/0', '%hi']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_CHAT_MSG,
      channel: 'Lobby',
      from: 'Zorg',
      message: 'hi',
      nobilityTier: 'Duke',
      modifiers: 16,
    });
  });

  it('emits neither key for a bare name — every SYSTEM line', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('ChatMsg', ['%SYSTEM', '%innos has entered Planitia']));

    const [, event] = (fake.emit as jest.Mock).mock.calls[0];
    expect(event).not.toHaveProperty('nobilityTier');
    expect(event).not.toHaveProperty('modifiers');
  });

  it('degrades a non-numeric AccDesc to Commoner/0 rather than NaN', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('ChatMsg', ['%innos/notanumber', '%hi']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', expect.objectContaining({
      nobilityTier: 'Commoner',
      modifiers: 0,
    }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NotifyMsgCompositionState — push-dispatcher.ts:184 · ServerCnxHandler.pas:494
// ═══════════════════════════════════════════════════════════════════════════

describe('NotifyMsgCompositionState', () => {
  it('reports a user who started typing', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('NotifyMsgCompositionState', ['%innos', '#1']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_CHAT_USER_TYPING,
      username: 'innos',
      isTyping: true,
    });
  });

  it('reports a user who stopped typing', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('NotifyMsgCompositionState', ['%innos', '#0']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', expect.objectContaining({ isTyping: false }));
  });

  it('treats any state other than 1 as idle — the boolean is exact, not truthy', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('NotifyMsgCompositionState', ['%innos', '#-1']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', expect.objectContaining({ isTyping: false }));
  });

  it('degrades to the raw push when the state argument is missing', () => {
    const fake = makePushCtx();
    const packet = incoming('NotifyMsgCompositionState', ['%innos']);

    dispatchPush(fake.ctx, WORLD_SOCKET, packet);

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_RDO_PUSH,
      rawPacket: packet.raw,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NotifyChannelChange — push-dispatcher.ts:202 · ServerCnxHandler.pas:493
// ═══════════════════════════════════════════════════════════════════════════

describe('NotifyChannelChange', () => {
  it('records the new channel on the session and tells the client', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('NotifyChannelChange', ['%Trade']));

    expect(fake.ctx.setCurrentChannel).toHaveBeenCalledWith('Trade');
    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_CHAT_CHANNEL_CHANGE,
      channelName: 'Trade',
    });
  });

  it('stores the empty name verbatim but shows Lobby to the client', () => {
    // The asymmetry is deliberate in the handler: session state keeps what the
    // server said, the UI gets the label it can display.
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('NotifyChannelChange', ['%']));

    expect(fake.ctx.setCurrentChannel).toHaveBeenCalledWith('');
    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_CHAT_CHANNEL_CHANGE,
      channelName: 'Lobby',
    });
  });

  it('degrades to the raw push when no channel name is given', () => {
    const fake = makePushCtx();
    const packet = incoming('NotifyChannelChange');

    dispatchPush(fake.ctx, WORLD_SOCKET, packet);

    expect(fake.ctx.setCurrentChannel).not.toHaveBeenCalled();
    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_RDO_PUSH,
      rawPacket: packet.raw,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NotifyUserListChange — push-dispatcher.ts:219 · ServerCnxHandler.pas:491
// ═══════════════════════════════════════════════════════════════════════════

describe('NotifyUserListChange', () => {
  it('parses the three-field form a join sends', () => {
    // Live capture:
    //   NotifyUserListChange "*" "%innos/8388608/0","#0"
    // AccDesc 8388608 = 0x00800000 → 0 nobility points, modifier bit 0x80 (VETERAN).
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('NotifyUserListChange', ['%innos/8388608/0', '#0']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_CHAT_USER_LIST_CHANGE,
      action: 'JOIN',
      user: {
        name: 'innos',
        id: '8388608',
        status: 0,
        nobilityPoints: 0,
        modifiers: 128,
        nobilityTier: 'Commoner',
      },
    });
  });

  it('parses the bare-name form a leave sends', () => {
    // Live capture:
    //   NotifyUserListChange "*" "%Mayor of Podan","#1"
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('NotifyUserListChange', ['%Mayor of Podan', '#1']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_CHAT_USER_LIST_CHANGE,
      action: 'LEAVE',
      user: {
        name: 'Mayor of Podan',
        id: '0',
        status: 0,
        nobilityPoints: 0,
        modifiers: 0,
        nobilityTier: 'Commoner',
      },
    });
  });

  it('derives the nobility tier from the points half of AccDesc', () => {
    // 0x00012710 → modifiers 1 (SUPPORT), nobility points 10000 → Duke (>= 8000).
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('NotifyUserListChange', ['%innos/75536/1', '#0']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', expect.objectContaining({
      user: expect.objectContaining({ nobilityPoints: 10000, modifiers: 1, nobilityTier: 'Duke', status: 1 }),
    }));
  });

  it('emits nothing for a nameless entry, and does not fall through to the raw push', () => {
    // `return` sits outside the `if` (:244): a blank name is dropped, not
    // forwarded. Asserting both halves is the point.
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('NotifyUserListChange', ['%   /8388608/0', '#0']));

    expect(fake.emit).not.toHaveBeenCalled();
  });

  it('degrades to the raw push when the change code is missing', () => {
    const fake = makePushCtx();
    const packet = incoming('NotifyUserListChange', ['%innos/8388608/0']);

    dispatchPush(fake.ctx, WORLD_SOCKET, packet);

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_RDO_PUSH,
      rawPacket: packet.raw,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RefreshTycoon — push-dispatcher.ts:248 · ServerCnxHandler.pas:480
// ═══════════════════════════════════════════════════════════════════════════

describe('RefreshTycoon', () => {
  // Live capture:
  //   RefreshTycoon "*" "%100000000","%0","#18","#0","#70"
  const CAPTURED_ARGS = ['%100000000', '%0', '#18', '#0', '#70'];

  it('emits the five fields and caches them for later profile queries', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('RefreshTycoon', CAPTURED_ARGS));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_TYCOON_UPDATE,
      cash: '100000000',
      incomePerHour: '0',
      ranking: 18,
      buildingCount: 0,
      maxBuildings: 70,
      failureLevel: undefined,
    });
    expect(fake.ctx.setAccountMoney).toHaveBeenCalledWith('100000000');
    expect(fake.ctx.setLastRanking).toHaveBeenCalledWith(18);
    expect(fake.ctx.setLastBuildingCount).toHaveBeenCalledWith(0);
    expect(fake.ctx.setLastMaxBuildings).toHaveBeenCalledWith(70);
  });

  it('carries the failure level the session already knows', () => {
    // The server does not repeat it in RefreshTycoon — it comes from InitClient
    // or EndOfPeriod, and the push carries it forward so the client can colour
    // the balance without a second round trip.
    const fake = makePushCtx({ getFailureLevel: jest.fn(() => 2) });

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('RefreshTycoon', CAPTURED_ARGS));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', expect.objectContaining({ failureLevel: 2 }));
  });

  it('falls back to zero on non-numeric counters rather than emitting NaN', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('RefreshTycoon', ['%1', '%2', '%x', '%y', '%z']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', expect.objectContaining({
      ranking: 0,
      buildingCount: 0,
      maxBuildings: 0,
    }));
  });

  it('degrades to the raw push when a field is missing', () => {
    const fake = makePushCtx();
    const packet = incoming('RefreshTycoon', ['%100000000', '%0', '#18', '#0']);

    dispatchPush(fake.ctx, WORLD_SOCKET, packet);

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_RDO_PUSH,
      rawPacket: packet.raw,
    });
  });

  it('falls back to the raw push when emission itself fails', () => {
    // The catch at :271 exists so a throwing listener degrades the frame instead
    // of losing it. First emit throws, the fallback at :407 still delivers.
    const fake = makePushCtx({
      emit: jest.fn()
        .mockImplementationOnce(() => { throw new Error('listener exploded'); })
        .mockReturnValue(true),
    });
    const packet = incoming('RefreshTycoon', CAPTURED_ARGS);

    dispatchPush(fake.ctx, WORLD_SOCKET, packet);

    expect(fake.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Error parsing RefreshTycoon'),
      expect.any(Error),
    );
    expect(fake.emit).toHaveBeenLastCalledWith('ws_event', {
      type: WsMessageType.EVENT_RDO_PUSH,
      rawPacket: packet.raw,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EndOfPeriod — push-dispatcher.ts:278 · ServerCnxHandler.pas:483
// ═══════════════════════════════════════════════════════════════════════════

describe('EndOfPeriod', () => {
  it('stores the failure level on the session and forwards it', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('EndOfPeriod', ['#2']));

    expect(fake.ctx.setFailureLevel).toHaveBeenCalledWith(2);
    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_END_OF_PERIOD,
      failureLevel: 2,
    });
  });

  it('treats a missing failure level as nominal', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('EndOfPeriod'));

    expect(fake.ctx.setFailureLevel).toHaveBeenCalledWith(0);
    expect(fake.emit).toHaveBeenCalledWith('ws_event', expect.objectContaining({ failureLevel: 0 }));
  });

  it('treats "#0" as nominal too — the guard is on presence, and "#0" is a value', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('EndOfPeriod', ['#0']));

    expect(fake.ctx.setFailureLevel).toHaveBeenCalledWith(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RefreshDate — push-dispatcher.ts:291 · ServerCnxHandler.pas:481
// ═══════════════════════════════════════════════════════════════════════════

describe('RefreshDate', () => {
  it('stores and forwards the TDateTime double', () => {
    // Live capture: RefreshDate "*" "@167150"
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('RefreshDate', ['@167150']));

    expect(fake.ctx.setVirtualDate).toHaveBeenCalledWith(167150);
    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_REFRESH_DATE,
      dateDouble: 167150,
    });
  });

  it('keeps the fractional part — TDateTime carries the time of day in it', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('RefreshDate', ['@167150.75']));

    expect(fake.ctx.setVirtualDate).toHaveBeenCalledWith(167150.75);
  });

  it('degrades to the raw push when the date is missing', () => {
    const fake = makePushCtx();
    const packet = incoming('RefreshDate');

    dispatchPush(fake.ctx, WORLD_SOCKET, packet);

    expect(fake.ctx.setVirtualDate).not.toHaveBeenCalled();
    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_RDO_PUSH,
      rawPacket: packet.raw,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ShowNotification — push-dispatcher.ts:304 · ServerCnxHandler.pas:498
// ═══════════════════════════════════════════════════════════════════════════

describe('ShowNotification', () => {
  it('forwards kind, title, body and options', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('ShowNotification', [
      '#1', '%Research complete', '%Combustion Engine is available', '#4',
    ]));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_SHOW_NOTIFICATION,
      kind: 1,
      title: 'Research complete',
      body: 'Combustion Engine is available',
      options: 4,
    });
  });

  it('fills every absent field with its neutral value', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('ShowNotification'));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_SHOW_NOTIFICATION,
      kind: 0,
      title: '',
      body: '',
      options: 0,
    });
  });

  it('keeps an accented body intact', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('ShowNotification', [
      '#0', '%Élection', '%Le maire a été élu', '#0',
    ]));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', expect.objectContaining({
      title: 'Élection',
      body: 'Le maire a été élu',
    }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Refresh — push-dispatcher.ts:322
// ═══════════════════════════════════════════════════════════════════════════

describe('Refresh', () => {
  // Not a TISEvents member: this is the cache proxy's own invalidation signal
  // (`Cache/CachedObjectWrap.pas:34 procedure Refresh`).
  it('invalidates the client cache when the frame carries no argument', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('Refresh'));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', { type: WsMessageType.EVENT_CACHE_REFRESH });
  });

  it('invalidates on an empty argument list too', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('Refresh', []));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', { type: WsMessageType.EVENT_CACHE_REFRESH });
  });

  it('degrades to the raw push when the server attaches arguments we do not know', () => {
    const fake = makePushCtx();
    const packet = incoming('Refresh', ['#1']);

    dispatchPush(fake.ctx, WORLD_SOCKET, packet);

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_RDO_PUSH,
      rawPacket: packet.raw,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TycoonRetired — push-dispatcher.ts:332 · ServerCnxHandler.pas:484
// ═══════════════════════════════════════════════════════════════════════════

describe('TycoonRetired', () => {
  it('warns and forwards the failure level — this one ends the game', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('TycoonRetired', ['#2']));

    expect(fake.log.warn).toHaveBeenCalledWith(expect.stringContaining('TycoonRetired'));
    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_TYCOON_RETIRED,
      failureLevel: 2,
    });
  });

  it('still fires when the level is missing — the event matters more than the number', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('TycoonRetired'));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_TYCOON_RETIRED,
      failureLevel: 0,
    });
  });

  it('does not write the failure level back to the session', () => {
    // Unlike EndOfPeriod: the session field stays as it was.
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('TycoonRetired', ['#2']));

    expect(fake.ctx.setFailureLevel).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ModelStatusChanged — push-dispatcher.ts:345 · ServerCnxHandler.pas:499
// ═══════════════════════════════════════════════════════════════════════════

describe('ModelStatusChanged', () => {
  it('flags the server busy on mstBusy (0)', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('ModelStatusChanged', ['#0']));

    expect(fake.ctx.setServerBusyFromPush).toHaveBeenCalledWith(true);
    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_MODEL_STATUS_CHANGED,
      status: 0,
    });
  });

  it('clears the busy flag on mstNotBusy (1)', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('ModelStatusChanged', ['#1']));

    expect(fake.ctx.setServerBusyFromPush).toHaveBeenCalledWith(false);
  });

  it('does not treat mstError (2) as busy', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('ModelStatusChanged', ['#2']));

    expect(fake.ctx.setServerBusyFromPush).toHaveBeenCalledWith(false);
    expect(fake.emit).toHaveBeenCalledWith('ws_event', expect.objectContaining({ status: 2 }));
  });

  it('assumes available when the status is missing, rather than freezing the client', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('ModelStatusChanged'));

    expect(fake.ctx.setServerBusyFromPush).toHaveBeenCalledWith(false);
    expect(fake.emit).toHaveBeenCalledWith('ws_event', expect.objectContaining({ status: 1 }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RefreshSeason — push-dispatcher.ts:359 · ServerCnxHandler.pas:482
// ═══════════════════════════════════════════════════════════════════════════

describe('RefreshSeason', () => {
  it('stores the season on the session and forwards it — terrain textures depend on it', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('RefreshSeason', ['#3']));

    expect(fake.ctx.setWorldSeason).toHaveBeenCalledWith(3);
    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_REFRESH_SEASON,
      season: 3,
    });
  });

  it('passes season 0 through — it is winter, not an absent value', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('RefreshSeason', ['#0']));

    expect(fake.ctx.setWorldSeason).toHaveBeenCalledWith(0);
  });

  it('degrades to the raw push when the season is missing', () => {
    const fake = makePushCtx();
    const packet = incoming('RefreshSeason');

    dispatchPush(fake.ctx, WORLD_SOCKET, packet);

    expect(fake.ctx.setWorldSeason).not.toHaveBeenCalled();
    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_RDO_PUSH,
      rawPacket: packet.raw,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MoveTo — push-dispatcher.ts:372 · ServerCnxHandler.pas:489
// ═══════════════════════════════════════════════════════════════════════════

describe('MoveTo', () => {
  it('forwards the camera target, x then y', () => {
    // Argument order is the failure mode this test exists for: the i/j swap.
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('MoveTo', ['#706', '#436']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_MOVE_TO,
      x: 706,
      y: 436,
    });
  });

  it('degrades to the raw push when only one coordinate arrives', () => {
    const fake = makePushCtx();
    const packet = incoming('MoveTo', ['#706']);

    dispatchPush(fake.ctx, WORLD_SOCKET, packet);

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_RDO_PUSH,
      rawPacket: packet.raw,
    });
  });

  it('emits NaN coordinates rather than guessing when they are not numbers', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('MoveTo', ['%east', '%north']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_MOVE_TO,
      x: NaN,
      y: NaN,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NotifyChannelListChange — push-dispatcher.ts:386 · ServerCnxHandler.pas:492
// ═══════════════════════════════════════════════════════════════════════════

describe('NotifyChannelListChange', () => {
  it('forwards name, password and the inclusion code', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('NotifyChannelListChange', ['%Trade', '%', '#0']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_CHANNEL_LIST_CHANGE,
      name: 'Trade',
      password: '',
      change: 0,
    });
  });

  it('carries the password of a protected channel verbatim', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('NotifyChannelListChange', ['%Guild', '%s3cret', '#1']));

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_CHANNEL_LIST_CHANGE,
      name: 'Guild',
      password: 's3cret',
      change: 1,
    });
  });

  it('degrades to the raw push when the change code is missing', () => {
    const fake = makePushCtx();
    const packet = incoming('NotifyChannelListChange', ['%Trade', '%']);

    dispatchPush(fake.ctx, WORLD_SOCKET, packet);

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_RDO_PUSH,
      rawPacket: packet.raw,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cross-cutting behaviour
// ═══════════════════════════════════════════════════════════════════════════

describe('any push', () => {
  it('forwards an unknown member as a raw push instead of throwing', () => {
    const fake = makePushCtx();
    const packet = incoming('ActorPoolModified', ['#42', '%train data']);

    expect(() => dispatchPush(fake.ctx, WORLD_SOCKET, packet)).not.toThrow();

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_RDO_PUSH,
      rawPacket: packet.raw,
    });
  });

  // Documented gap, not a defect being graved in: unknown members ought to be
  // JOURNALISED. They are not — they are forwarded raw and nothing is written
  // to the server log, so a member the server starts sending goes unnoticed on
  // our side. Nothing is dropped, which is why this is a gap and not a bug.
  it('logs nothing for an unknown member — the gap §3 of the analysis flags', () => {
    const fake = makePushCtx();

    dispatchPush(fake.ctx, WORLD_SOCKET, incoming('GameMasterMsg', ['%hello', '#0']));

    expect(fake.log.warn).not.toHaveBeenCalled();
    expect(fake.log.error).not.toHaveBeenCalled();
    expect(fake.log.debug).not.toHaveBeenCalled();
  });

  it('forwards a packet with no member at all', () => {
    const fake = makePushCtx();
    const packet = incoming(undefined);

    expect(() => dispatchPush(fake.ctx, WORLD_SOCKET, packet)).not.toThrow();

    expect(fake.emit).toHaveBeenCalledWith('ws_event', {
      type: WsMessageType.EVENT_RDO_PUSH,
      rawPacket: packet.raw,
    });
  });

  it('ignores which socket the frame arrived on', () => {
    // World-pool connections mean the same push can land on any of several
    // sockets; the dispatch must not depend on that (`_socketName`).
    const onWorld = makePushCtx();
    const onPool = makePushCtx();
    const packet = incoming('RefreshSeason', ['#2']);

    dispatchPush(onWorld.ctx, WORLD_SOCKET, packet);
    dispatchPush(onPool.ctx, 'world-pool-3', packet);

    expect(onPool.emit.mock.calls).toEqual(onWorld.emit.mock.calls);
    expect(onPool.ctx.setWorldSeason).toHaveBeenCalledWith(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Inventory — every published TISEvents method is handled or exempt
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `TISEvents` is the RDO object the reference client publishes and the server
 * calls back. Its 24 published methods are the exhaustive list of what can
 * arrive as a push, frozen here with the line of each declaration:
 * `../SPO-Original/Voyager/URLHandlers/ServerCnxHandler.pas:469-505`.
 */
const TIS_EVENTS: ReadonlyArray<{ member: string; line: number }> = [
  { member: 'InitClient', line: 476 },
  { member: 'RefreshArea', line: 478 },
  { member: 'RefreshObject', line: 479 },
  { member: 'RefreshTycoon', line: 480 },
  { member: 'RefreshDate', line: 481 },
  { member: 'RefreshSeason', line: 482 },
  { member: 'EndOfPeriod', line: 483 },
  { member: 'TycoonRetired', line: 484 },
  { member: 'ChatMsg', line: 485 },
  { member: 'VoiceMsg', line: 486 },
  { member: 'VoiceRequestGranted', line: 487 },
  { member: 'NewMail', line: 488 },
  { member: 'MoveTo', line: 489 },
  { member: 'NotifyCompanionship', line: 490 },
  { member: 'NotifyUserListChange', line: 491 },
  { member: 'NotifyChannelListChange', line: 492 },
  { member: 'NotifyChannelChange', line: 493 },
  { member: 'NotifyMsgCompositionState', line: 494 },
  { member: 'ActorPoolModified', line: 496 },
  { member: 'ShowNotification', line: 498 },
  { member: 'ModelStatusChanged', line: 499 },
  { member: 'AnswerStatus', line: 500 },
  { member: 'GameMasterMsg', line: 503 },
  { member: 'GMNotify', line: 504 },
];

/**
 * Published methods this dispatcher does NOT handle, with the reason for each.
 *
 * The list is the documentation and the test is the ratchet: it fails when a NEW
 * member goes unhandled, and it fails again when an exempt member becomes
 * handled without being taken off the list. It does not demand that the existing
 * gaps be closed — they are recorded below as family B.
 */
const PUSH_EXEMPTIONS: ReadonlyArray<{ member: string; reason: string }> = [
  {
    member: 'RefreshArea',
    reason: 'Handled upstream: spo_session.processSingleCommand tests isRefreshAreaPush ' +
      '(spo_session.ts:824) and returns before dispatchPush is ever called.',
  },
  {
    member: 'RefreshObject',
    reason: 'Handled upstream: spo_session.processSingleCommand tests isRefreshObjectPush ' +
      '(spo_session.ts:814) and returns before dispatchPush is ever called.',
  },
  {
    member: 'AnswerStatus',
    reason: 'The only FUNCTION of the interface (ServerCnxHandler.pas:500) — it arrives as a ' +
      'server REQUEST carrying a QueryId, and spo_session answers it on the originating ' +
      'connection. It is not a push and never reaches this dispatcher.',
  },
  {
    member: 'ActorPoolModified',
    reason: 'Not implemented (family B). Server-driven vehicles are never received; the ' +
      'renderer synthesises its own. Root cause of the dead Transport panel.',
  },
  {
    member: 'GameMasterMsg',
    reason: 'Not implemented (family B). GM broadcasts from the server never reach the client.',
  },
  {
    member: 'GMNotify',
    reason: 'Not implemented (family B). GM notifications are ignored.',
  },
  {
    member: 'NotifyCompanionship',
    reason: 'Not implemented (family B). The companions list is never received.',
  },
  {
    member: 'VoiceMsg',
    reason: 'Not implemented (family B). Voice chat is out of scope for the WebClient.',
  },
  {
    member: 'VoiceRequestGranted',
    reason: 'Not implemented (family B). Voice chat is out of scope for the WebClient.',
  },
];

/**
 * Members the dispatcher handles that are NOT part of TISEvents, with their
 * origin. Keeping them named is what lets the inventory below be an equality
 * rather than a one-way inclusion.
 */
const NON_TIS_MEMBERS: ReadonlyArray<{ member: string; reason: string }> = [
  {
    member: 'SetLanguage',
    reason: 'The server echoes back the push the client sent during login ' +
      '(login-handler.ts:465-474); declared on the InterfaceServer, not on TISEvents ' +
      '(Interface Server/InterfaceServer.pas:198).',
  },
  {
    member: 'Refresh',
    reason: 'Cache proxy invalidation (Cache/CachedObjectWrap.pas:34), not a TISEvents member.',
  },
];

/** The members `dispatchPush` actually branches on, read out of the source. */
function handledMembers(): Set<string> {
  const source = fs.readFileSync(path.join(__dirname, 'push-dispatcher.ts'), 'utf8');
  const members = new Set<string>();
  for (const match of source.matchAll(/packet\.member === '([A-Za-z_][A-Za-z0-9_]*)'/g)) {
    members.add(match[1]);
  }
  return members;
}

describe('push inventory (TISEvents, ServerCnxHandler.pas:469-505)', () => {
  it('handles every published method that is not explicitly exempt', () => {
    const handled = handledMembers();
    const exempt = new Set(PUSH_EXEMPTIONS.map(e => e.member));

    const unhandled = TIS_EVENTS
      .filter(({ member }) => !handled.has(member) && !exempt.has(member))
      .map(({ member, line }) => `${member} (ServerCnxHandler.pas:${line})`);

    expect(unhandled).toEqual([]);
  });

  it('has no stale exemption — an exempt member that got handled must leave the list', () => {
    const handled = handledMembers();

    const stale = PUSH_EXEMPTIONS.filter(e => handled.has(e.member)).map(e => e.member);

    expect(stale).toEqual([]);
  });

  it('exempts only methods that are actually published', () => {
    const published = new Set(TIS_EVENTS.map(e => e.member));

    const unknown = PUSH_EXEMPTIONS.filter(e => !published.has(e.member)).map(e => e.member);

    expect(unknown).toEqual([]);
  });

  it('gives every exemption a reason', () => {
    for (const { member, reason } of PUSH_EXEMPTIONS) {
      expect(reason.length).toBeGreaterThan(30);
      expect(member).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    }
  });

  it('accounts for every member it dispatches on, TISEvents or not', () => {
    const published = new Set(TIS_EVENTS.map(e => e.member));
    const documented = new Set(NON_TIS_MEMBERS.map(e => e.member));

    const unaccounted = [...handledMembers()].filter(m => !published.has(m) && !documented.has(m));

    expect(unaccounted).toEqual([]);
  });

  it('reads a non-empty member list out of the dispatcher — the ratchet must have teeth', () => {
    // Guards the regex itself: a refactor to a switch or a table would silently
    // empty `handledMembers()` and make every assertion above vacuous.
    expect(handledMembers().size).toBeGreaterThanOrEqual(15);
  });
});
