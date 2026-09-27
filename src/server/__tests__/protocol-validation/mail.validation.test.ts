/**
 * Protocol Validation: Mail
 *
 * Drives the production mail handlers (mail-handler.ts, through the
 * StarpeaceSession facade) against the mail scenario, strict validation on.
 * The mail socket is the one `connectMailService` opens (socket 0); every
 * frame it carries is pinned as a literal, in order.
 *
 * What the literals show about separators:
 * - `AddLine` and `CloseMessage` are procedures sent synchronously: `"*"` WITH
 *   a QueryId (the reference client sets WaitForAnswer before the AddLine loop).
 * - `AddHeaders` and `DeleteMessage` are void pushes: `"*"`, no QueryId.
 * - `GetHeaders`, `GetLines`, `GetAttachmentCount`, `OpenMessage`, `NewMail`,
 *   `Post`, `Save`, `LogServerOn`, `CheckNewMail` are functions: `"^"`.
 *
 * `DeleteMessage`'s fourth argument travels as a `%` string: the declaration
 * is `MessageId : widestring` (Mail Server/MailServer.pas:109). The fixture's
 * captured request (mail-rdo-008) writes it `#`; that exchange declares no
 * argsPattern, so the validator does not compare argument prefixes for it.
 */

jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createProtocolTestHarness, ProtocolTestHarness } from './protocol-test-harness';
import { createMailScenario } from '../../../mock-server/scenarios/mail-scenario';
import { DEFAULT_VARIABLES } from '../../../mock-server/scenarios/scenario-variables';

describe('Protocol Validation: mail handlers', () => {
  let harness: ProtocolTestHarness;

  beforeEach(() => {
    const scenario = createMailScenario();
    harness = createProtocolTestHarness({
      socketConfigs: [{ rdoScenarios: [scenario.rdo] }],
      httpScenarios: [scenario.http],
    });
    harness.session.setMailAddr('127.0.0.1');
    harness.session.setMailPort(3000);
    harness.session.setMailAccount(DEFAULT_VARIABLES.mailAccount);
    harness.session.setCurrentWorldInfo({
      name: DEFAULT_VARIABLES.worldName,
      url: 'http://158.69.153.134/Five/',
      ip: '158.69.153.134',
      port: 8000,
    });
  });

  afterEach(() => {
    harness.session.destroy();
    harness.cleanup();
  });

  it('composeMail: connects, creates, adds the line, posts and closes', async () => {
    const sent = await harness.session.composeMail('Mayor of Olympus@Shamba.net', 'test subjct', ['test message']);

    expect(sent).toBe(true);
    expect(harness.getCapturedCommands(0)).toEqual([
      'C 1000 idof "MailServer"',
      'C 1001 sel 30437308 call LogServerOn "^" "%Shamba"',
      'C 1002 sel 30437308 call NewMail "^" "%SPO_test3@Shamba.net","%Mayor of Olympus@Shamba.net","%test subjct"',
      'C 1003 sel 30430748 call AddLine "*" "%test message"',
      'C 1004 sel 30437308 call Post "^" "%Shamba","#30430748"',
      'C 1005 sel 30437308 call CloseMessage "*" "#30430748"',
    ]);
    harness.assertNoViolations();
  });

  it('composeMail with headers: adds the void AddHeaders frame before the body', async () => {
    const sent = await harness.session.composeMail(
      'Mayor of Olympus@Shamba.net', 'test subjct', ['test message'], 'X-Thread-Id: 12345',
    );

    expect(sent).toBe(true);
    expect(harness.getCapturedCommands(0)).toEqual([
      'C 1000 idof "MailServer"',
      'C 1001 sel 30437308 call LogServerOn "^" "%Shamba"',
      'C 1002 sel 30437308 call NewMail "^" "%SPO_test3@Shamba.net","%Mayor of Olympus@Shamba.net","%test subjct"',
      'C sel 30430748 call AddHeaders "*" "%X-Thread-Id: 12345"',
      'C 1003 sel 30430748 call AddLine "*" "%test message"',
      'C 1004 sel 30437308 call Post "^" "%Shamba","#30430748"',
      'C 1005 sel 30437308 call CloseMessage "*" "#30430748"',
    ]);
    harness.assertNoViolations();
  });

  it('saveDraft: saves instead of posting', async () => {
    const saved = await harness.session.saveDraft('Mayor of Olympus@Shamba.net', 'test subjct', ['test message']);

    expect(saved).toBe(true);
    expect(harness.getCapturedCommands(0)).toEqual([
      'C 1000 idof "MailServer"',
      'C 1001 sel 30437308 call LogServerOn "^" "%Shamba"',
      'C 1002 sel 30437308 call NewMail "^" "%SPO_test3@Shamba.net","%Mayor of Olympus@Shamba.net","%test subjct"',
      'C 1003 sel 30430748 call AddLine "*" "%test message"',
      'C 1004 sel 30437308 call Save "^" "%Shamba","#30430748"',
      'C 1005 sel 30437308 call CloseMessage "*" "#30430748"',
    ]);
    harness.assertNoViolations();
  });

  it('readMailMessage: opens, reads headers, lines and attachments, then closes', async () => {
    const message = await harness.session.readMailMessage('Inbox', '30430748');

    expect(harness.getCapturedCommands(0)).toEqual([
      'C 1000 idof "MailServer"',
      'C 1001 sel 30437308 call LogServerOn "^" "%Shamba"',
      'C 1002 sel 30437308 call OpenMessage "^" "%Shamba","%SPO_test3@Shamba.net","%Inbox","%30430748"',
      'C 1003 sel 30430750 call GetHeaders "^" "#0"',
      'C 1004 sel 30430750 call GetLines "^" "#0"',
      'C 1005 sel 30430750 call GetAttachmentCount "^" "#0"',
      'C 1006 sel 30437308 call CloseMessage "*" "#30430750"',
    ]);
    expect(message).toEqual({
      messageId: '30430748',
      fromAddr: 'Mayor of Olympus@Shamba.net',
      toAddr: '',
      from: 'Mayor of olympus',
      to: '',
      subject: 'test subjct',
      date: '',
      dateFmt: '',
      read: false,
      stamp: 0,
      noReply: false,
      body: ['test message'],
      attachments: [],
    });
    harness.assertNoViolations();
  });

  it('deleteMailMessage: sends the void DeleteMessage frame', async () => {
    await harness.session.deleteMailMessage('Inbox', '30430748');

    expect(harness.getCapturedCommands(0)).toEqual([
      'C 1000 idof "MailServer"',
      'C 1001 sel 30437308 call LogServerOn "^" "%Shamba"',
      'C sel 30437308 call DeleteMessage "*" "%Shamba","%SPO_test3@Shamba.net","%Inbox","%30430748"',
    ]);
    harness.assertNoViolations();
  });

  it('getMailUnreadCount: asks CheckNewMail with the LogServerOn session id', async () => {
    const count = await harness.session.getMailUnreadCount();

    expect(count).toBe(3);
    expect(harness.getCapturedCommands(0)).toEqual([
      'C 1000 idof "MailServer"',
      'C 1001 sel 30437308 call LogServerOn "^" "%Shamba"',
      'C 1002 sel 30437308 call CheckNewMail "^" "#41230990","%SPO_test3@Shamba.net"',
    ]);
    harness.assertNoViolations();
  });
});
