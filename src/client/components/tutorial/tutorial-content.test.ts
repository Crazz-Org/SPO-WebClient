import { TUTORIAL_CONTENT, tutorialContentFor } from './tutorial-content';

interface ServerKind {
  kindId: string;
  source: string;
  covered: boolean;
}

/**
 * Every KindId the server can push as TutorialId (MetaTask.KindId, Tasks/Tasks.pas:527),
 * read from SPO-Original (read-only).
 */
const SERVER_KIND_IDS: readonly ServerKind[] = [
  // Explicit `KindId :=` assignments
  { kindId: 'Welcome', source: 'Tasks/Tutorial.pas:256', covered: true },
  { kindId: 'WhoYouAre', source: 'Tasks/Tutorial.pas:272', covered: true },
  { kindId: 'YourProfile', source: 'Tasks/Tutorial.pas:288', covered: true },
  { kindId: 'TheSpider', source: 'Tasks/Tutorial.pas:304', covered: true },
  { kindId: 'Farewell', source: 'Tasks/Tutorial.pas:329', covered: true },
  { kindId: 'MainHq', source: 'Tasks/CommonTasks.pas:77', covered: true },
  { kindId: 'BuildFacility', source: 'Tasks/CommonTasks.pas:108', covered: true },
  { kindId: 'BuyAds', source: 'Tasks/CommonTasks.pas:342', covered: true },
  { kindId: 'CloneAds', source: 'Tasks/CommonTasks.pas:357', covered: true },
  { kindId: 'GrowMoney', source: 'Tasks/CommonTasks.pas:385', covered: true },
  { kindId: 'Research', source: 'Tasks/CommonTasks.pas:401', covered: true },
  { kindId: 'SellToAll', source: 'Tasks/CommonTasks.pas:542', covered: true },
  { kindId: 'OfferProducts', source: 'Tasks/CommonTasks.pas:558', covered: true },
  { kindId: 'HireSuppliers', source: 'Tasks/CommonTasks.pas:574', covered: true },
  { kindId: 'AskLoan', source: 'Tasks/CommonTasks.pas:589', covered: true },
  // Deliberately absent: no NewTycoon/Tasks/UpgradeFac ASP page exists, and the Pascal
  // comment reads "Change later when the page is done.." — nothing to transcribe.
  { kindId: 'UpgradeFac', source: 'Tasks/CommonTasks.pas:604', covered: false },
  { kindId: 'ManuallyConnect', source: 'Tasks/CommonTasks.pas:619', covered: true },
  // Default-Id kinds: the 6-arg TMetaTask.Create sets fKindId := fId (Tasks/Tasks.pas:284)
  { kindId: 'Tutorial', source: 'Tasks/Tasks.pas:284 + Tasks/Tutorial.pas:9', covered: true },
  // Container/grouping tasks with no ASP page folder — deliberately absent
  { kindId: 'SelectProduct', source: 'Tasks/Tasks.pas:284 + Tasks/CommonTasks.pas:12', covered: false },
  { kindId: 'AnyProduct', source: 'Tasks/Tasks.pas:284 + Tasks/CommonTasks.pas:13', covered: false },
  { kindId: 'PGITutorial', source: 'Tasks/Tasks.pas:284 + Tasks/PGITutorial.pas:9', covered: false },
  { kindId: 'DissTutorial', source: 'Tasks/Tasks.pas:284 + Tasks/DissidentTutorial.pas:9', covered: false },
  { kindId: 'MoabTutorial', source: 'Tasks/Tasks.pas:284 + Tasks/MoabTutorial.pas:9', covered: false },
  { kindId: 'MarikoTutorial', source: 'Tasks/Tasks.pas:284 + Tasks/MarikoTutorial.pas:9', covered: false },
];

/**
 * Client-only pages. `Roads` has no server task literal (Kernel/BasicAccounts.pas:90 is an
 * account name, not a task); it is reached only via the ASP redirect in
 * NewTycoon/Tasks/BuildFacility/1/default.asp:3-4 -> ../../Roads/0/default.asp.
 */
const CLIENT_ONLY_KIND_IDS: readonly string[] = ['Roads'];

const covered = SERVER_KIND_IDS.filter((k) => k.covered);
const absent = SERVER_KIND_IDS.filter((k) => !k.covered);

describe('tutorial content vs server KindIds', () => {
  it.each(covered.map((k) => [k.kindId, k.source]))('covers %s (%s) at stage 0', (kindId) => {
    expect(tutorialContentFor(kindId, 0)).not.toBeNull();
  });

  it.each(absent.map((k) => [k.kindId, k.source]))('%s (%s) is deliberately absent', (kindId) => {
    expect(tutorialContentFor(kindId, 0)).toBeNull();
  });

  it('lists UpgradeFac explicitly as deliberately absent', () => {
    expect(SERVER_KIND_IDS.find((k) => k.kindId === 'UpgradeFac')?.covered).toBe(false);
  });

  it('resolves MainHq to the main-HQ page', () => {
    expect(tutorialContentFor('MainHq', 0)?.heading).toBe(
      'Tutorial Assignment: Build the Company Headquarters',
    );
  });

  it('lookup is exact and case-sensitive', () => {
    expect(tutorialContentFor('MainHQ', 0)).toBeNull();
  });

  it('Roads is a client-only page', () => {
    expect(tutorialContentFor('Roads', 0)).not.toBeNull();
  });

  it('every content key is a covered server kind or client-only', () => {
    const allowed = new Set([...covered.map((k) => k.kindId), ...CLIENT_ONLY_KIND_IDS]);
    for (const key of Object.keys(TUTORIAL_CONTENT)) {
      expect(allowed.has(key) ? key : `unknown:${key}`).toBe(key);
    }
  });
});
