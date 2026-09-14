import { pickWorldEvent } from './world-events-handler';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '../__tests__/session/fake-session-context';
import { RdoValue } from '../../shared/rdo-types';
import { RdoVerb, RdoAction } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';

describe('pickWorldEvent', () => {
  it('parses a rendered event block, choosing Text<languageId> over Text0', async () => {
    const fake = makeSessionCtx({ languageId: '2' });
    fake.respond(() => 'res="%Date=18/02/2026\r\nKind=1\r\nURL=/x.asp?x=706&y=436\r\nText0=Default\r\nText2=Farm built in Helartia\r\n"');

    await expect(pickWorldEvent(fake.ctx)).resolves.toEqual({
      date: '18/02/2026',
      kind: 1,
      text: 'Farm built in Helartia',
      x: 706,
      y: 436,
    });
  });

  it('falls back to Text0 when Text<languageId> is absent', async () => {
    const fake = makeSessionCtx({ languageId: '3' });
    fake.respond(() => 'res="%Date=18/02/2026\r\nKind=1\r\nText0=Fallback text\r\n"');

    await expect(pickWorldEvent(fake.ctx)).resolves.toMatchObject({ text: 'Fallback text' });
  });

  it('carries x/y when the URL has coordinates', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%Date=18/02/2026\r\nKind=1\r\nURL=/x.asp?x=10&y=20\r\nText0=Event\r\n"');

    await expect(pickWorldEvent(fake.ctx)).resolves.toMatchObject({ x: 10, y: 20 });
  });

  it('carries neither x nor y when the URL has no coordinates', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%Date=18/02/2026\r\nKind=1\r\nURL=/x.asp\r\nText0=Event\r\n"');

    const result = await pickWorldEvent(fake.ctx);
    expect(result).not.toHaveProperty('x');
    expect(result).not.toHaveProperty('y');
  });

  it('defaults kind to 0 when absent', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%Date=18/02/2026\r\nText0=Event\r\n"');

    await expect(pickWorldEvent(fake.ctx)).resolves.toMatchObject({ kind: 0 });
  });

  it('an empty answer is null, and never logs a warning or error', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%"');

    await expect(pickWorldEvent(fake.ctx)).resolves.toBeNull();
    expect(fake.log.warn).not.toHaveBeenCalled();
    expect(fake.log.error).not.toHaveBeenCalled();
  });

  it('an error-code answer ("#...") is null, not a code rendered as text', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#1"');

    await expect(pickWorldEvent(fake.ctx)).resolves.toBeNull();
  });

  it('returns null when worldContextId is missing', async () => {
    const fake = makeSessionCtx({ worldContextId: null });

    await expect(pickWorldEvent(fake.ctx)).resolves.toBeNull();
    expect(fake.sent).toHaveLength(0);
  });

  it('returns null when tycoonId is missing', async () => {
    const fake = makeSessionCtx({ tycoonId: null });

    await expect(pickWorldEvent(fake.ctx)).resolves.toBeNull();
    expect(fake.sent).toHaveLength(0);
  });

  it('a rejecting sendRdoRequest resolves null and logs only at debug', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => new Error('socket closed'));

    await expect(pickWorldEvent(fake.ctx)).resolves.toBeNull();
    expect(fake.log.debug).toHaveBeenCalled();
    expect(fake.log.warn).not.toHaveBeenCalled();
    expect(fake.log.error).not.toHaveBeenCalled();
  });

  it('a URL value containing "=" is not truncated at the first equals sign', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%Date=18/02/2026\r\nURL=/x.asp?x=706&y=436&extra=1\r\nText0=Event\r\n"');

    await expect(pickWorldEvent(fake.ctx)).resolves.toMatchObject({ x: 706, y: 436 });
  });

  it('sends PickEvent(TycoonId) against the world context id, as a FAST-category call', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%"');

    await pickWorldEvent(fake.ctx);

    expect(fake.sent).toHaveLength(1);
    const [req] = fake.sent;
    expect(req.socketName).toBe('world');
    expect(req.category).toBe(TimeoutCategory.FAST);
    expect(req.packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: FAKE_CONTEXT_IDS.worldContextId,
      action: RdoAction.CALL,
      member: 'PickEvent',
      separator: '"^"',
      args: [RdoValue.int(Number(FAKE_CONTEXT_IDS.tycoonId)).format()],
    });
  });
});
