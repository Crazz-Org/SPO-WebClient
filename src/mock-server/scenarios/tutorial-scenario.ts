/**
 * Scenario 37: the onboarding curriculum — the push, the read, and the four
 * actions.
 *
 * The engine lives entirely on the model server. It announces itself with ONE
 * push, `ShowNotification(ntkURLFrame, MetaTask.NotTitle, <URL>,
 * MetaTask.NotOptions)` (`Tasks/Tasks.pas:470`), and everything a panel could
 * draw sits on the tycoon's own cache object under the `Tutorial` prefix
 * (`TTask.StoreToCache`, `Tasks/Tasks.pas:521-550`). So the push says
 * *something changed*, and the cache says *what*.
 *
 * Three things this fixture pins that nothing else could:
 *
 *  - **`Options` is the routing, not the body.** `NotOptions` defaults to
 *    `nopTutorial_SHOW` = 4 (`Tasks/Tasks.pas:285`, constants `:29-32`) and the
 *    reference client tested `Options and (4 or 2) <> 0` to decide the frame was
 *    a tutorial one (`Voyager/URLNotification.pas:77`). `HideTaskButton` sends
 *    the same push with an EMPTY title and `Options = 0` to take the affordance
 *    away (`Tasks/Tasks.pas:636-644`). Two pushes that differ only in that field
 *    mean opposite things, which is why both are here.
 *  - **The body is a URL and must never be rendered.** It is built by
 *    `TTask.GetBaseURL` (`Tasks/Tasks.pas:620-634`) and points at an IIS page
 *    written for Internet Explorer 5. A toast of it is the bug this scenario
 *    exists to fail on.
 *  - **The four actions bind `TutorialObjId`, not the tycoon.**
 *    `ModifyTask.asp:13` reads that id off the cache and `:23-34` binds it
 *    before dispatching. Three of them are `procedure`s on `TInformativeTask`
 *    (`Tasks/InformativeTask.pas:15-17`), so their frames carry `"*"` and their
 *    responses are **empty** — a procedure answers nothing, so the frame is the
 *    only evidence there is. The fourth is a `set` on the published `Completed`
 *    property (`Tasks/Tasks.pas:156`), which is what `ModifyTask.asp:32-33`
 *    emits and what unblocks a finished task.
 *
 * Every request is written out as the literal frame production emits (QueryId
 * stripped) — never rebuilt with the emitter, so a wrong catalogue entry cannot
 * produce a matching wrong fixture.
 */

import type { TutorialState } from '@/shared/types';
import { TUTORIAL_PROPS } from '@/server/session/tutorial-handler';
import type { RdoScenario, RdoExchange } from '../types/rdo-exchange-types';
import type { ScenarioVariables } from './scenario-variables';
import { mergeVariables } from './scenario-variables';

// =============================================================================
// BIND TARGETS
// =============================================================================

export const TUTORIAL_TARGETS = {
  /** The cacher temp object the tycoon folder is read through. */
  tempObject: '7742',
  /** `TutorialObjId` — the raw `integer(self)` of the live task (Tasks.pas:526). */
  taskObjId: '130600501',
} as const;

// =============================================================================
// THE ASSIGNMENTS THIS SCENARIO CAN SERVE
// =============================================================================

/** Which assignment the cache read answers with. */
export type TutorialAssignmentVariant = 'welcome' | 'goal' | 'done' | 'none';

/**
 * The four cache shapes, each the decoded `TutorialState` the gateway must
 * produce from it — or `null` for the tycoon who has no assignment.
 *
 * `welcome` is the first push a new tycoon gets: the `Welcome` kind, stage 0,
 * declared with `StageCount := 2` (`Tasks/Tutorial.pas:256-257`). `goal` is the
 * money-goal task, the only kind that writes `TutorialGoal`
 * (`Tasks/MakeProfitTask.pas:81`, a `FormatMoney` string). `done` is the same
 * task with `TutorialTaskDone` set, which is what reveals Get New Assignment
 * (`Five/0/Visual/Voyager/NewTycoon/Tasks/taskDone.inc:7-8`).
 */
const ASSIGNMENTS: Record<TutorialAssignmentVariant, { values: string[]; state: TutorialState | null }> = {
  welcome: {
    //           Active ObjId  Id  Name  Stage Progress Goal Done Company Town
    values: ['1', TUTORIAL_TARGETS.taskObjId, 'Welcome', 'Tutorial Welcome', '0', '0', '', '0', 'Yellow Inc.', 'Shamba'],
    state: {
      taskObjId: TUTORIAL_TARGETS.taskObjId,
      kindId: 'Welcome',
      name: 'Tutorial Welcome',
      stage: 0,
      progress: 0,
      goal: '',
      done: false,
      company: 'Yellow Inc.',
      town: 'Shamba',
    },
  },
  goal: {
    values: ['1', TUTORIAL_TARGETS.taskObjId, 'GrowMoney', 'Make Profit', '0', '50', '$5,000,000', '0', 'Yellow Inc.', 'Shamba'],
    state: {
      taskObjId: TUTORIAL_TARGETS.taskObjId,
      kindId: 'GrowMoney',
      name: 'Make Profit',
      stage: 0,
      progress: 50,
      goal: '$5,000,000',
      done: false,
      company: 'Yellow Inc.',
      town: 'Shamba',
    },
  },
  done: {
    // `-1` is what `TObjectCache.WriteBoolean` renders a Delphi TRUE as.
    values: ['1', TUTORIAL_TARGETS.taskObjId, 'GrowMoney', 'Make Profit', '0', '100', '$5,000,000', '-1', 'Yellow Inc.', 'Shamba'],
    state: {
      taskObjId: TUTORIAL_TARGETS.taskObjId,
      kindId: 'GrowMoney',
      name: 'Make Profit',
      stage: 0,
      progress: 100,
      goal: '$5,000,000',
      done: true,
      company: 'Yellow Inc.',
      town: 'Shamba',
    },
  },
  none: {
    // The tycoon with no assignment: the cache server answers one empty value
    // per requested name, which is also what an unresolved path produces.
    values: ['', '', '', '', '', '', '', '', '', ''],
    state: null,
  },
};

/** The decoded state each variant must produce — the test's oracle. */
export function tutorialStateFor(variant: TutorialAssignmentVariant): TutorialState | null {
  return ASSIGNMENTS[variant].state;
}

// =============================================================================
// THE TWO PUSHES
// =============================================================================

/**
 * The URL `TTask.GetBaseURL` builds: world URL, language, the fixed
 * `Visual/Voyager/NewTycoon/Tasks/` prefix (`Tasks/Tasks.pas:12`), then
 * `<KindId>/<Stage>/default.asp` and the two query parameters
 * (`Tasks/Tasks.pas:620-634`).
 */
export function tutorialUrlFor(vars: ScenarioVariables, kindId: string, stage: number): string {
  return (
    `http://${vars.worldIp}/Five/0/Visual/Voyager/NewTycoon/Tasks/` +
    `${kindId}/${stage}/default.asp?Tycoon=${vars.username}&WorldName=${vars.worldName}`
  );
}

/**
 * `MetaTask.NotTitle` of the Welcome task, verbatim
 * (`Tasks/Tutorial.pas:251-254`). It names the door the panel must keep open —
 * the TUTORIAL button on the PROFILE page — which is exactly the re-open
 * affordance the criterion asks for.
 */
export const WELCOME_NOT_TITLE =
  'Welcome to LEGACY Online Tutorial. In case you close this window ' +
  'you can access this tutorial page from the TUTORIAL button ' +
  'located in the PROFILE page.';

/** `MetaTask.NotTitle` of the money-goal task (`Tasks/CommonTasks.pas:386`). */
export const GOAL_NOT_TITLE = 'Make Money with Your Stores';

function showNotificationPush(
  vars: ScenarioVariables, title: string, body: string, options: number,
): string {
  return (
    `C sel ${vars.tycoonProxyId} call ShowNotification "*" ` +
    `"#1","%${title}","%${body}","#${options}";`
  );
}

// =============================================================================
// SCENARIO FACTORY
// =============================================================================

/**
 * The four actions, in the order `ModifyTask.asp:26-33` lists them, each with
 * the member and verb its catalogue entry implies, and the literal frame it emits.
 */
const ACTIONS = [
  {
    slug: 'next', member: 'RDONextStep', action: 'call',
    request: `C sel ${TUTORIAL_TARGETS.taskObjId} call RDONextStep "*" "#0";`,
  },
  {
    slug: 'prev', member: 'RDOPrevStep', action: 'call',
    request: `C sel ${TUTORIAL_TARGETS.taskObjId} call RDOPrevStep "*" "#0";`,
  },
  {
    slug: 'close', member: 'RDOClose', action: 'call',
    request: `C sel ${TUTORIAL_TARGETS.taskObjId} call RDOClose "*" "#0";`,
  },
  {
    slug: 'complete', member: 'Completed', action: 'set',
    request: `C sel ${TUTORIAL_TARGETS.taskObjId} set Completed="#-1";`,
  },
] as const;

function buildRdoExchanges(vars: ScenarioVariables, variant: TutorialAssignmentVariant): RdoExchange[] {
  const assignment = ASSIGNMENTS[variant];
  const path = `Tycoons\\${vars.username}.five\\`;
  const query = `${TUTORIAL_PROPS.join('\t')}\t`;

  const reads: RdoExchange[] = [
    {
      id: 'tutorial-rdo-set-path',
      request: `C sel ${TUTORIAL_TARGETS.tempObject} call SetPath "^" "%${path}";`,
      // Delphi WordBool TRUE.
      response: 'A0 res="#-1"',
      matchKeys: {
        verb: 'sel', action: 'call', member: 'SetPath',
        argsPattern: [`"%${path}"`],
      },
    },
    {
      // `argsPattern` keeps this from falling through `RdoMock`'s member-only
      // match onto another scenario's `GetPropertyList`.
      id: 'tutorial-rdo-state-read',
      request: `C sel ${TUTORIAL_TARGETS.tempObject} call GetPropertyList "^" "%${query}";`,
      response: `A0 res="%${assignment.values.join('\t')}"`,
      matchKeys: {
        verb: 'sel', action: 'call', member: 'GetPropertyList',
        argsPattern: [`"%${query}"`],
      },
    },
  ];

  const actions: RdoExchange[] = ACTIONS.map(a => ({
    id: `tutorial-rdo-${a.slug}`,
    request: a.request,
    // The three procedures answer nothing. `Completed` is a `set`, whose only
    // answer is the bare acknowledgement.
    response: a.action === 'set' ? 'A0 res="#0"' : '',
    matchKeys: {
      verb: 'sel',
      targetId: TUTORIAL_TARGETS.taskObjId,
      action: a.action,
      member: a.member,
    },
  }));

  const kindId = assignment.state?.kindId ?? 'Welcome';
  const stage = assignment.state?.stage ?? 0;
  const title = kindId === 'GrowMoney' ? GOAL_NOT_TITLE : WELCOME_NOT_TITLE;

  const pushes: RdoExchange[] = [
    {
      // nopTutorial_SHOW — the default MetaTask.NotOptions (Tasks.pas:285).
      id: 'tutorial-push-show',
      request: '',
      response: showNotificationPush(vars, title, tutorialUrlFor(vars, kindId, stage), 4),
      pushOnly: true,
    },
    {
      // nopTutorial_OFF with an empty title — HideTaskButton (Tasks.pas:636-644).
      id: 'tutorial-push-hide',
      request: '',
      response: showNotificationPush(vars, '', tutorialUrlFor(vars, kindId, stage), 0),
      pushOnly: true,
    },
  ];

  return [...reads, ...actions, ...pushes];
}

export function createTutorialScenario(
  overrides?: Partial<ScenarioVariables>,
  opts: { assignment?: TutorialAssignmentVariant } = {},
): { rdo: RdoScenario } {
  const vars = mergeVariables(overrides);
  const variant = opts.assignment ?? 'welcome';

  const rdo: RdoScenario = {
    name: 'tutorial',
    description:
      'The onboarding curriculum: the kind-1 push, the tycoon-folder state read, and the four actions bound to TutorialObjId',
    exchanges: buildRdoExchanges(vars, variant),
    variables: vars as unknown as Record<string, string>,
  };

  return { rdo };
}
