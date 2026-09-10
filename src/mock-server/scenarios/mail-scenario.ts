/**
 * Scenario 14: Mail System
 * RDO: idof MailServer, NewMail, AddLine, Save, CloseMessage
 * HTTP: MailFolder.asp (inbox frameset), MailFolderTop.asp (tabs + action buttons),
 *       MessageList.asp (folder listing), MessageBody.asp (Inbox read-touch that
 *       sets the mail server's Read header flag — see mail-handler.ts's file header)
 * WS: REQ_MAIL_COMPOSE -> RESP_MAIL_SENT, REQ_MAIL_GET_FOLDER -> RESP_MAIL_FOLDER,
 *     the reply form of REQ_MAIL_COMPOSE (mail-ws-003) — same request carrying
 *     a `headers` block, which the gateway turns into AddHeaders before AddLine —
 *     and the send-from-Drafts form (mail-ws-004), carrying `existingDraftId`, which
 *     makes the gateway emit DeleteMessage on the Draft folder once Post succeeds
 *
 * NOTE on Save vs Post (from MailServer.pas):
 *   - Save(WorldName, MessageId) → saves to DRAFT folder only
 *   - Post(WorldName, MessageId) → delivers to recipients' Inbox + copies to Sent
 *   The captured RDO below uses Save, which saves to Draft (not send).
 *   To test actual mail delivery, use Post instead of Save.
 *
 * Captured RDO (saving mail to draft):
 *   C 2172 idof "MailServer"; A2172 objid="30437308";
 *   C 2173 sel 30437308 call NewMail "^" "%Mayor of Olympus@Shamba.net","%Mayor of olympus","%test subjct";
 *   A2173 res="#30430748";
 *   C 2174 sel 30430748 call AddLine "*" "%test message"; A2174 ;
 *   C 2175 idof "MailServer"; A2175 objid="30437308";
 *   C 2176 sel 30437308 call Save "^" "%Shamba","#30430748"; A2176 res="#-1";
 *   C 2177 sel 30437308 call CloseMessage "*" "#30430748"; A2177 ;
 */

import { WsMessageType } from '@/shared/types/message-types';
import type { WsMessage } from '@/shared/types/message-types';
import type { WsCaptureScenario } from '../types/mock-types';
import type { RdoScenario } from '../types/rdo-exchange-types';
import type { HttpScenario } from '../types/http-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

/** Captured data for a mail send operation */
export interface CapturedMailSendData {
  to: string;
  toName: string;
  subject: string;
  body: string;
  messageId: string;
}

export const CAPTURED_MAIL_SEND: CapturedMailSendData = {
  to: 'Mayor of Olympus@Shamba.net',
  toName: 'Mayor of olympus',
  subject: 'test subjct',
  body: 'test message',
  messageId: '30430748',
};

/** What a reply to {@link CAPTURED_MAIL_SEND} carries — the shape `startReply` builds. */
export interface CapturedMailReplyData {
  headers: string;
  subject: string;
  body: string;
}

export const CAPTURED_MAIL_REPLY: CapturedMailReplyData = {
  headers: [
    `In-Reply-To=${CAPTURED_MAIL_SEND.messageId}`,
    `In-Reply-To-From=${CAPTURED_MAIL_SEND.to}`,
    `In-Reply-To-Subject=${CAPTURED_MAIL_SEND.subject}`,
    'In-Reply-To-Date=3/9/2244',
  ].join('\n'),
  subject: `Re: ${CAPTURED_MAIL_SEND.subject}`,
  body: `> ${CAPTURED_MAIL_SEND.body}`,
};

/** The draft id a send-from-Drafts (mail-ws-004) carries — distinct from every other id here. */
export const CAPTURED_DRAFT_ID = '30430751';

function buildMailFolderHtml(vars: ScenarioVariables): string {
  return `<html>
<head><title>Mail - Inbox</title></head>
<frameset rows="70,*" framespacing=0>
  <frame name="Top" src="MailFolderTop.asp?Folder=Inbox&WorldName=${vars.worldName}&Account=${vars.mailAccount}&Password=${vars.password}&TycoonName=${vars.username}" scrolling="no">
  <frame name="Main" src="MessageList.asp?Folder=Inbox&WorldName=${vars.worldName}&Account=${vars.mailAccount}&MsgId=&Action=" noresize>
</frameset>
</html>`;
}

function buildMailFolderTopHtml(vars: ScenarioVariables): string {
  const baseParams = `WorldName=${vars.worldName}&Account=${vars.mailAccount}&Password=${vars.password}&TycoonName=${vars.username}`;

  return `<html>
<head><title>Mail Folder Top</title>
<link rel="STYLESHEET" href="../voyager.css" type="text/css">
</head>
<body style="margin: 0; padding: 0">
<table cellspacing="0" cellpadding="0" width="100%">
<tr>
  <td class="header2" style="padding-left: 10px; color: #FF9900">Mail</td>
</tr>
<tr>
  <td>
    <table cellspacing="0" cellpadding="2">
    <tr>
      <td class="tabSelected" style="padding: 2px 8px">
        <a href="MailFolder.asp?Folder=Inbox&${baseParams}" target="_parent">Inbox</a>
      </td>
      <td class="tab" style="padding: 2px 8px">
        <a href="MailFolder.asp?Folder=SENT&${baseParams}" target="_parent">Sent</a>
      </td>
      <td class="tab" style="padding: 2px 8px">
        <a href="MailFolder.asp?Folder=DRAFT&${baseParams}" target="_parent">Draft</a>
      </td>
    </tr>
    </table>
  </td>
</tr>
<tr>
  <td>
    <table cellspacing="0" cellpadding="2">
    <tr>
      <td class="link" style="padding: 2px 6px"
        info="http://local.asp?frame_Id=MailView&frame_Action=NewMail">New</td>
      <td class="link" style="padding: 2px 6px"
        info="http://local.asp?frame_Id=MailView&frame_Action=DeleteMail">Delete</td>
      <td class="link" style="padding: 2px 6px"
        info="http://local.asp?frame_Id=MailView&frame_Action=ReplyMail">Reply</td>
      <td class="link" style="padding: 2px 6px"
        info="http://local.asp?frame_Id=MailView&frame_Action=ForwardMail">Forward</td>
    </tr>
    </table>
  </td>
</tr>
</table>
</body>
</html>`;
}

function buildMessageListHtml(vars: ScenarioVariables, folder: string): string {
  // Matches the live capture of MessageList.asp from the World Web Server.
  // Sent folder has one message matching CAPTURED_MAIL_SEND.
  const isSent = folder.toUpperCase() === 'SENT';
  const personLabel = isSent ? 'To' : 'From';
  const personName = isSent ? CAPTURED_MAIL_SEND.toName : 'System';

  // One sample message for Sent folder, empty for others
  const msgRows = isSent ? `
	<tr id="row_0" onClick="onRowClick()" onDblClick="onRowDblClick()" msgId=${CAPTURED_MAIL_SEND.messageId}>
		<td align="right" valign="top" style="padding-left: 40px; padding-right: 20px">
			<input id="msgReply0" name="msgReply0" type=hidden value="">
		</td>
		<td valign="top">
			<span class=mailFolderItem>
			${personName}
			</span>
		</td>
		<td valign="top" nowrap=true>
			<span class=mailFolderItem>
			${CAPTURED_MAIL_SEND.subject}
			</span>
		</td>
		<td valign="top">
			<span class=mailFolderItem id="dateRow0" name="dateRow0">
				<input id="msgDate0" name="msgDate0" type=hidden value="3/9/2244">
			</span>
		</td>
	</tr>` : '';

  const msgCount = isSent ? 1 : 0;

  return `<html>
<head>
	<title>FIVE Logon</title>
	<link rel="STYLESHEET" href="mail.css" type="text/css">
	<link rel="STYLESHEET" href="../voyager.css" type="text/css">
</head>
<script language="JScript">
	var selectedRow = null;
	function selectRow(row) {
		if (selectedRow != null) selectedRow.style.backgroundColor = "";
		if (row != selectedRow) { selectedRow = row; if (selectedRow != null) { selectedRow.style.backgroundColor = 0x193930; window.parent.frames.item("top").document.all.toolbar.currMsgId = row.msgId; } }
		else { selectedRow = null; window.parent.frames.item("top").document.all.toolbar.currMsgId = ""; }
	}
	function getRow(element) { if (element.parentElement == null || element.parentElement.tagName == "TR") return (element.parentElement); else return (getRow(element.parentElement)); }
	function onRowClick() { row = getRow(event.srcElement); if (row != null) { selectRow(row); window.parent.navigate("MailMessage.asp?WorldName=${vars.worldName}&Account=${vars.mailAccount}&Folder=${folder}&MsgId=" + row.msgId + "&frame_Id=MsgView&frame_Class=HTMLView&frame_Align=client&frame_Height=40%&frame_NoBorder=True&frame_NoScrollBars=False"); } event.cancelBubble = true; }
	function onRowDblClick() { var row = getRow(event.srcElement); if (row != null) window.parent.navigate("MailMessage.asp?WorldName=${vars.worldName}&Account=${vars.mailAccount}&Folder=${folder}&MsgId=" + row.msgId + "&frame_Id=MsgView&frame_Class=HTMLView&frame_Align=client&frame_Height=40%&frame_NoBorder=True&frame_NoScrollBars=False"); }
	function onPageClick() { selectRow(null); }
	function onLoad() { document.all.everything.style.display = "inline"; }
</script>
<body style="background-color: #395950; margin: 0px; padding: 0px" onClick="onPageClick()" onLoad="onLoad()">
<div id=everything style="display: none"></div>
<table id="MsgTable" width="100%" style="margin: 0px; padding: -10px" cellpadding="0" cellspacing="0">
	<tr style="background-image: url(images/listtopback.gif)">
		<td width=10% height=20></td>
		<td class=mailFolderHeader width="20%">${personLabel}</td>
		<td class=mailFolderHeader qwidth="50%">Subject</td>
		<td class=mailFolderHeader qwidth="20%">Date</td>
	</tr>
${msgRows}
</table>
<input id="MsgCount" name="MsgCount" type=hidden value="${msgCount}">
</body>
</html>`;
}

export function createMailScenario(
  overrides?: Partial<ScenarioVariables>
): { ws: WsCaptureScenario; rdo: RdoScenario; http: HttpScenario } {
  const vars = mergeVariables(overrides);

  const rdo: RdoScenario = {
    name: 'mail',
    description: 'Mail system: send mail via idof/NewMail/AddLine/Save/CloseMessage',
    exchanges: [
      {
        id: 'mail-rdo-001',
        request: `C 2172 idof "MailServer"`,
        response: `A2172 objid="${vars.mailServerId}"`,
        matchKeys: { verb: 'idof', targetId: 'MailServer' },
      },
      {
        id: 'mail-rdo-002',
        request: `C 2173 sel ${vars.mailServerId} call NewMail "^" "%${CAPTURED_MAIL_SEND.to}","%${CAPTURED_MAIL_SEND.toName}","%${CAPTURED_MAIL_SEND.subject}"`,
        response: `A2173 res="#${CAPTURED_MAIL_SEND.messageId}"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'NewMail' },
      },
      {
        id: 'mail-rdo-003',
        request: `C 2174 sel ${CAPTURED_MAIL_SEND.messageId} call AddLine "*" "%${CAPTURED_MAIL_SEND.body}"`,
        response: `A2174`,
        matchKeys: { verb: 'sel', action: 'call', member: 'AddLine' },
      },
      {
        id: 'mail-rdo-004',
        request: `C 2175 idof "MailServer"`,
        response: `A2175 objid="${vars.mailServerId}"`,
        matchKeys: { verb: 'idof', targetId: 'MailServer' },
      },
      {
        id: 'mail-rdo-005',
        request: `C 2176 sel ${vars.mailServerId} call Save "^" "%${vars.worldName}","#${CAPTURED_MAIL_SEND.messageId}"`,
        response: `A2176 res="#-1"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'Save' },
      },
      {
        id: 'mail-rdo-006',
        request: `C 2177 sel ${vars.mailServerId} call CloseMessage "*" "#${CAPTURED_MAIL_SEND.messageId}"`,
        response: `A2177`,
        matchKeys: { verb: 'sel', action: 'call', member: 'CloseMessage' },
      },
      // --- Additional exchanges for expanded test coverage ---
      {
        id: 'mail-rdo-007',
        request: `C 2180 sel ${vars.mailServerId} call Post "^" "%${vars.worldName}","#${CAPTURED_MAIL_SEND.messageId}"`,
        response: `A2180 res="#-1"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'Post' },
      },
      {
        id: 'mail-rdo-008',
        request: `C 2181 sel ${vars.mailServerId} call DeleteMessage "*" "%${vars.worldName}","%${vars.mailAccount}","%Inbox","#${CAPTURED_MAIL_SEND.messageId}"`,
        response: `A2181`,
        matchKeys: { verb: 'sel', action: 'call', member: 'DeleteMessage' },
      },
      {
        id: 'mail-rdo-009',
        request: `C 2182 sel ${vars.mailServerId} call OpenMessage "^" "%${vars.worldName}","%${vars.mailAccount}","%Inbox","%${CAPTURED_MAIL_SEND.messageId}"`,
        response: `A2182 res="#30430750"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'OpenMessage' },
      },
      {
        id: 'mail-rdo-010',
        request: `C 2183 sel 30430750 call GetHeaders "^" "#0"`,
        response: `A2183 res="%MessageId=${CAPTURED_MAIL_SEND.messageId}\nFromAddr=${CAPTURED_MAIL_SEND.to}\nFrom=${CAPTURED_MAIL_SEND.toName}\nSubject=${CAPTURED_MAIL_SEND.subject}"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'GetHeaders' },
      },
      {
        id: 'mail-rdo-011',
        request: `C 2184 sel 30430750 call GetLines "^" "#0"`,
        response: `A2184 res="%${CAPTURED_MAIL_SEND.body}"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'GetLines' },
      },
      {
        id: 'mail-rdo-012',
        request: `C 2185 sel 30430750 call GetAttachmentCount "^" "#0"`,
        response: `A2185 res="#0"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'GetAttachmentCount' },
      },
      {
        // LogServerOn registers the client with the mail server and returns the
        // session ServerId (integer(TInterfaceServerData)) that CheckNewMail
        // dereferences (MailServer.pas:100,543). Mirrors the IS handshake —
        // sending "#0" made the live server AV and always answer -1.
        id: 'mail-rdo-015',
        request: `C 2188 sel ${vars.mailServerId} call LogServerOn "^" "%${vars.worldName}"`,
        response: `A2188 res="#41230990"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'LogServerOn' },
      },
      {
        id: 'mail-rdo-013',
        request: `C 2186 sel ${vars.mailServerId} call CheckNewMail "^" "#41230990","%${vars.mailAccount}"`,
        response: `A2186 res="#3"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'CheckNewMail' },
      },
      {
        id: 'mail-rdo-014',
        request: `C 2187 sel ${CAPTURED_MAIL_SEND.messageId} call AddHeaders "*" "%X-Thread-Id: 12345"`,
        response: `A2187`,
        matchKeys: { verb: 'sel', action: 'call', member: 'AddHeaders' },
      },
    ],
    variables: vars as unknown as Record<string, string>,
  };

  const http: HttpScenario = {
    name: 'mail',
    exchanges: [
      {
        id: 'mail-http-001',
        method: 'GET',
        urlPattern: '/five/0/visual/voyager/mail/MailFolder.asp',
        queryPatterns: {
          Folder: 'Inbox',
        },
        status: 200,
        contentType: 'text/html',
        body: buildMailFolderHtml(vars),
      },
      {
        id: 'mail-http-002',
        method: 'GET',
        urlPattern: '/five/0/visual/voyager/mail/MailFolderTop.asp',
        queryPatterns: {
          Folder: 'Inbox',
        },
        status: 200,
        contentType: 'text/html',
        body: buildMailFolderTopHtml(vars),
      },
      {
        id: 'mail-http-003',
        method: 'GET',
        urlPattern: '/five/0/visual/voyager/mail/MessageList.asp',
        queryPatterns: {
          Folder: 'Inbox',
        },
        status: 200,
        contentType: 'text/html',
        body: buildMessageListHtml(vars, 'Inbox'),
      },
      {
        id: 'mail-http-004',
        method: 'GET',
        urlPattern: '/five/0/visual/voyager/mail/MessageList.asp',
        queryPatterns: {
          Folder: 'SENT',
        },
        status: 200,
        contentType: 'text/html',
        body: buildMessageListHtml(vars, 'SENT'),
      },
      {
        id: 'mail-http-005',
        method: 'GET',
        urlPattern: '/five/0/visual/voyager/mail/MessageBody.asp',
        queryPatterns: {
          Folder: 'Inbox',
        },
        status: 200,
        contentType: 'text/html',
        body: '<html><body>test message</body></html>',
      },
    ],
    variables: {},
  };

  const ws: WsCaptureScenario = {
    name: 'mail',
    description: 'Mail system: compose/send mail and view inbox',
    capturedAt: '2026-02-18',
    serverInfo: { world: vars.worldName, zone: 'BETA', date: '2026-02-18' },
    exchanges: [
      {
        id: 'mail-ws-001',
        timestamp: '2026-02-18T21:35:00.000Z',
        request: {
          type: WsMessageType.REQ_MAIL_COMPOSE,
          wsRequestId: 'mail-001',
          to: CAPTURED_MAIL_SEND.to,
          subject: CAPTURED_MAIL_SEND.subject,
          body: [CAPTURED_MAIL_SEND.body],
        } as WsMessage,
        responses: [
          {
            type: WsMessageType.RESP_MAIL_SENT,
            wsRequestId: 'mail-001',
            success: true,
          } as WsMessage,
        ],
        tags: ['mail'],
      },
      {
        id: 'mail-ws-002',
        timestamp: '2026-02-18T21:35:05.000Z',
        request: {
          type: WsMessageType.REQ_MAIL_GET_FOLDER,
          wsRequestId: 'mail-002',
          folder: 'Inbox',
        } as WsMessage,
        responses: [
          {
            type: WsMessageType.RESP_MAIL_FOLDER,
            wsRequestId: 'mail-002',
            folder: 'Inbox',
            messages: [],
          } as WsMessage,
        ],
        tags: ['mail'],
      },
      {
        // The reply form: same request type, plus the header block. It is what
        // makes the gateway emit AddHeaders (mail-rdo-014) before the first
        // AddLine (mail-rdo-003) — proven in mail-reply-scenario.test.ts.
        id: 'mail-ws-003',
        timestamp: '2026-02-18T21:36:00.000Z',
        request: {
          type: WsMessageType.REQ_MAIL_COMPOSE,
          wsRequestId: 'mail-003',
          to: CAPTURED_MAIL_SEND.to,
          subject: CAPTURED_MAIL_REPLY.subject,
          body: [CAPTURED_MAIL_REPLY.body],
          headers: CAPTURED_MAIL_REPLY.headers,
        } as WsMessage,
        responses: [
          {
            type: WsMessageType.RESP_MAIL_SENT,
            wsRequestId: 'mail-003',
            success: true,
          } as WsMessage,
        ],
        tags: ['mail'],
      },
      {
        // Sending a letter opened from Drafts: same request, plus the draft's id. It is
        // what makes the gateway emit DeleteMessage on the Draft folder after a
        // successful Post (mail-rdo-008 by member) — proven in mail-draft-send-scenario.test.ts.
        id: 'mail-ws-004',
        timestamp: '2026-02-18T21:37:00.000Z',
        request: {
          type: WsMessageType.REQ_MAIL_COMPOSE,
          wsRequestId: 'mail-004',
          to: CAPTURED_MAIL_SEND.to,
          subject: CAPTURED_MAIL_SEND.subject,
          body: [CAPTURED_MAIL_SEND.body],
          existingDraftId: CAPTURED_DRAFT_ID,
        } as WsMessage,
        responses: [
          {
            type: WsMessageType.RESP_MAIL_SENT,
            wsRequestId: 'mail-004',
            success: true,
          } as WsMessage,
        ],
        tags: ['mail'],
      },
    ],
  };

  return { ws, rdo, http };
}
