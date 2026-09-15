import type { WebSocket } from 'ws';
import { handleProfileCurriculumAction, handleProfileUploadPicture, handleTutorialState, handleTutorialAction } from './profile-handlers';
import type { WsHandlerContext } from './types';
import {
  WsMessageType,
  type WsMessage,
  type WsRespProfileCurriculumAction,
  type WsRespProfileUploadPicture,
  type WsRespTutorialState,
  type WsRespTutorialAction,
  type CompanyInfo,
} from '../../shared/types';

function makeCtx(session: Record<string, unknown>) {
  const sent: WsMessage[] = [];
  const ws = {
    send: jest.fn((payload: string) => sent.push(JSON.parse(payload) as WsMessage)),
  } as unknown as WebSocket;

  const ctx = { ws, session } as unknown as WsHandlerContext;
  return { ctx, sent };
}

const HOME_COMPANY: CompanyInfo = { id: '55', name: 'SPO_test3 - Green', ownerRole: 'SPO_test3' };

describe('handleProfileCurriculumAction', () => {
  it('abandonRole routes to session.abandonRole and copies switchedTo', async () => {
    const abandonRole = jest.fn().mockResolvedValue({ success: true, outcome: 'switched', company: HOME_COMPANY });
    const { ctx, sent } = makeCtx({ abandonRole });
    await handleProfileCurriculumAction(ctx, { type: WsMessageType.REQ_PROFILE_CURRICULUM_ACTION, wsRequestId: 'r1', action: 'abandonRole' } as WsMessage);

    expect(abandonRole).toHaveBeenCalledWith();
    const resp = sent[0] as WsRespProfileCurriculumAction;
    expect(resp.success).toBe(true);
    expect(resp.switchedTo).toEqual(HOME_COMPANY);
    expect(resp.returnToCompanyStage).toBeUndefined();
  });

  it('abandonRole with no personal company copies returnToCompanyStage', async () => {
    const abandonRole = jest.fn().mockResolvedValue({ success: true, outcome: 'no-company' });
    const { ctx, sent } = makeCtx({ abandonRole });
    await handleProfileCurriculumAction(ctx, { type: WsMessageType.REQ_PROFILE_CURRICULUM_ACTION, wsRequestId: 'r2', action: 'abandonRole' } as WsMessage);

    const resp = sent[0] as WsRespProfileCurriculumAction;
    expect(resp.returnToCompanyStage).toBe(true);
    expect(resp.switchedTo).toBeUndefined();
  });

  it('abandonRole unchanged carries neither field', async () => {
    const abandonRole = jest.fn().mockResolvedValue({ success: true, outcome: 'unchanged', message: 'abandonRole completed successfully' });
    const { ctx, sent } = makeCtx({ abandonRole });
    await handleProfileCurriculumAction(ctx, { type: WsMessageType.REQ_PROFILE_CURRICULUM_ACTION, wsRequestId: 'r3', action: 'abandonRole' } as WsMessage);

    const resp = sent[0] as WsRespProfileCurriculumAction;
    expect(resp.switchedTo).toBeUndefined();
    expect(resp.returnToCompanyStage).toBeUndefined();
  });

  it('any other action still routes to executeCurriculumAction with (action, value) and carries neither field', async () => {
    const executeCurriculumAction = jest.fn().mockResolvedValue({ success: true, message: 'resetAccount completed successfully' });
    const abandonRole = jest.fn();
    const { ctx, sent } = makeCtx({ executeCurriculumAction, abandonRole });
    await handleProfileCurriculumAction(ctx, {
      type: WsMessageType.REQ_PROFILE_CURRICULUM_ACTION,
      wsRequestId: 'r4',
      action: 'resetAccount',
      value: true,
    } as WsMessage);

    expect(executeCurriculumAction).toHaveBeenCalledWith('resetAccount', true);
    expect(abandonRole).not.toHaveBeenCalled();
    const resp = sent[0] as WsRespProfileCurriculumAction;
    expect(resp.success).toBe(true);
    expect(resp.switchedTo).toBeUndefined();
    expect(resp.returnToCompanyStage).toBeUndefined();
  });
});

describe('handleProfileUploadPicture', () => {
  it('carries a success result through with the echoed wsRequestId', async () => {
    const uploadTycoonPicture = jest.fn().mockResolvedValue({ success: true });
    const { ctx, sent } = makeCtx({ uploadTycoonPicture });
    await handleProfileUploadPicture(ctx, {
      type: WsMessageType.REQ_PROFILE_UPLOAD_PICTURE,
      wsRequestId: 'r5',
      pictureBase64: 'abc',
    } as WsMessage);

    expect(uploadTycoonPicture).toHaveBeenCalledWith('abc');
    const resp = sent[0] as WsRespProfileUploadPicture;
    expect(resp.wsRequestId).toBe('r5');
    expect(resp.success).toBe(true);
    expect(resp.reason).toBeUndefined();
    expect(resp.message).toBeUndefined();
  });

  it('carries a failure result through unchanged', async () => {
    const uploadTycoonPicture = jest.fn().mockResolvedValue({
      success: false,
      reason: 'WRONG_DIMENSIONS',
      message: 'Picture must be 150x200; this one is 160x200.',
    });
    const { ctx, sent } = makeCtx({ uploadTycoonPicture });
    await handleProfileUploadPicture(ctx, {
      type: WsMessageType.REQ_PROFILE_UPLOAD_PICTURE,
      wsRequestId: 'r6',
      pictureBase64: 'def',
    } as WsMessage);

    const resp = sent[0] as WsRespProfileUploadPicture;
    expect(resp.success).toBe(false);
    expect(resp.reason).toBe('WRONG_DIMENSIONS');
    expect(resp.message).toBe('Picture must be 150x200; this one is 160x200.');
  });

  it('defaults pictureBase64 to an empty string when absent', async () => {
    const uploadTycoonPicture = jest.fn().mockResolvedValue({ success: false, reason: 'NOT_A_JPEG', message: 'x' });
    const { ctx } = makeCtx({ uploadTycoonPicture });
    await handleProfileUploadPicture(ctx, {
      type: WsMessageType.REQ_PROFILE_UPLOAD_PICTURE,
      wsRequestId: 'r7',
    } as WsMessage);

    expect(uploadTycoonPicture).toHaveBeenCalledWith('');
  });
});

describe('the tutorial handlers', () => {
  it('handleTutorialState answers the session state verbatim, null included', async () => {
    for (const state of [{ taskObjId: '130600501', kindId: 'Welcome' }, null]) {
      const getTutorialState = jest.fn().mockResolvedValue(state);
      const { ctx, sent } = makeCtx({ getTutorialState });
      await handleTutorialState(ctx, { type: WsMessageType.REQ_TUTORIAL_STATE, wsRequestId: 't1' } as WsMessage);

      const resp = sent[0] as WsRespTutorialState;
      expect(resp.type).toBe(WsMessageType.RESP_TUTORIAL_STATE);
      expect(resp.wsRequestId).toBe('t1');
      expect(resp.state).toEqual(state);
    }
  });

  it('handleTutorialAction forwards the action and carries the re-read state back', async () => {
    const runTutorialAction = jest.fn().mockResolvedValue({
      success: true, message: '', state: { taskObjId: '130600501', kindId: 'Welcome', stage: 1 },
    });
    const { ctx, sent } = makeCtx({ runTutorialAction });
    await handleTutorialAction(ctx, {
      type: WsMessageType.REQ_TUTORIAL_ACTION, wsRequestId: 't2', action: 'next',
    } as WsMessage);

    expect(runTutorialAction).toHaveBeenCalledWith('next');
    const resp = sent[0] as WsRespTutorialAction;
    expect(resp.success).toBe(true);
    expect(resp.state).toMatchObject({ stage: 1 });
  });

  it('a refusal travels in the typed response, message and null state included', async () => {
    const runTutorialAction = jest.fn().mockResolvedValue({
      success: false, message: 'No active assignment', state: null,
    });
    const { ctx, sent } = makeCtx({ runTutorialAction });
    await handleTutorialAction(ctx, {
      type: WsMessageType.REQ_TUTORIAL_ACTION, wsRequestId: 't3', action: 'complete',
    } as WsMessage);

    const resp = sent[0] as WsRespTutorialAction;
    expect(resp.success).toBe(false);
    expect(resp.message).toBe('No active assignment');
    expect(resp.state).toBeNull();
  });
});
