/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

/**
 * The civic write path, checked against the two authorities it answers to:
 * the RDO catalogue (kind and arity) and the property templates (which members
 * a civic tab can actually ask for).
 *
 * What these tests are for: before this scenario existed, nothing in the L1
 * substrate ever saw a civic mutation. A wrong separator on one of these eleven
 * members freezes the model server; a wrong argument count writes through a
 * register nobody set. Both are catalogue questions, and both are now asked
 * here rather than on the wire.
 */

import fetch from 'node-fetch';
import type { Response } from 'node-fetch';
import { RdoProtocol } from '@/server/rdo';
import { RDO_MEMBERS } from '@/shared/rdo-members';
import { rdoCall } from '@/shared/rdo-frame';
import { RdoValue } from '@/shared/rdo-types';
import {
  VOTES_GROUP,
  CAPITOL_TOWNS_GROUP,
  MINISTERIES_GROUP,
  TOWN_JOBS_GROUP,
  TOWN_TAXES_GROUP,
} from '@/shared/building-details/template-groups';
import {
  parsePoliticsRatings,
  parsePublicityRows,
  parsePublicityAds,
  parseCampaignProjects,
  parseCampaignPromise,
  parseCampaignState,
  getPoliticsData,
  politicsSetRating,
  politicsSetPublicity,
  politicsSetProjectData,
} from '@/server/session/politics-handler';
import { setBuildingProperty } from '@/server/session/building-property-handler';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { RdoMock } from '../rdo-mock';
import { HttpMock } from '../http-mock';
import type { RdoExchange } from '../types/rdo-exchange-types';
import {
  createCivicMutationsScenario,
  CIVIC_MUTATIONS,
  CIVIC_MUTATION_MEMBERS,
  CIVIC_TARGETS,
  POLITICS_PATH,
} from './civic-mutations-scenario';

const mockFetch = fetch as unknown as jest.MockedFunction<
  (url: string, init?: unknown) => Promise<Response>
>;

const { rdo, http } = createCivicMutationsScenario();

/**
 * The exchanges that are reads, not mutations. `SetPath` is a `function`, so it
 * carries `"^"` and a non-empty response — the loops below are about
 * *mutations*, which is exactly what this filter expresses.
 */
const isRead = (ex: RdoExchange): boolean =>
  ex.matchKeys?.member === 'GetPropertyList' || ex.matchKeys?.member === 'SetPath';

/** Every `rdoCommands` entry the civic template groups declare. */
const TEMPLATE_CIVIC_COMMANDS = Array.from(new Set(
  [VOTES_GROUP, CAPITOL_TOWNS_GROUP, MINISTERIES_GROUP, TOWN_JOBS_GROUP, TOWN_TAXES_GROUP]
    .flatMap(g => Object.values(g.rdoCommands ?? {}).map(c => c.command)),
));

describe('civic-mutations scenario — the catalogue', () => {
  it('every civic mutation is a procedure, so every frame carries "*"', () => {
    for (const m of CIVIC_MUTATIONS) {
      expect(RDO_MEMBERS[m.member].kind).toBe('procedure');
    }
    for (const ex of rdo.exchanges) {
      if (isRead(ex)) continue;
      // `"^"` on a procedure leaves a result pointer nobody pops — the freeze.
      expect(ex.request).toContain('"*"');
      expect(ex.request).not.toContain('"^"');
    }
  });

  it('every civic mutation carries the argument count the catalogue declares', () => {
    for (const m of CIVIC_MUTATIONS) {
      expect(RDO_MEMBERS[m.member]).toHaveProperty('arity', m.args.length);
    }
  });

  it('a procedure answers nothing, so no mutation exchange carries a response', () => {
    // Not an omission: this is OB-28 stated as a fixture. "Confirmed" can never
    // come from the reply of a member that has none.
    const mutations = rdo.exchanges.filter(ex => !isRead(ex));
    expect(mutations).not.toHaveLength(0);
    for (const ex of mutations) {
      expect(ex.response).toBe('');
    }
  });

  it('covers every mutation the civic templates can ask for', () => {
    // The divergence this guards: a template offering a control whose command
    // the substrate has never seen emitted.
    for (const command of TEMPLATE_CIVIC_COMMANDS) {
      expect(CIVIC_MUTATION_MEMBERS).toContain(command);
    }
  });

  it('covers the three politics procedures the templates do not name', () => {
    // These reach the wire from politics-handler, not from the property path,
    // so no `rdoCommands` entry mentions them.
    for (const member of ['RDOSetRatingFrom', 'RDOSetPublicity', 'RDOSetProjectData']) {
      expect(CIVIC_MUTATION_MEMBERS).toContain(member);
    }
  });
});

describe('civic-mutations scenario — matching', () => {
  it('matches each mutation frame back to its own exchange', () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const ex of rdo.exchanges) {
      const result = mock.match(ex.request);
      expect(result).not.toBeNull();
      expect(result!.exchange.id).toBe(ex.id);
    }
  });

  it('tells the two RDOSetTaxValue writes apart by their arguments', () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);
    const subsidy = rdo.exchanges.find(e => e.id === 'civic-rdo-set-tax-value-subsidy')!;
    expect(mock.match(subsidy.request)!.exchange.id).toBe(subsidy.id);
  });

  it('serves the id lookup a tax write depends on', () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);
    const lookup = rdo.exchanges.find(e => e.id === 'civic-rdo-lookup-tax-id')!;
    expect(mock.match(lookup.request)!.response).toBe('A0 res="%100"');
  });

  it('stores each request as the emitter wrote it, terminator included', () => {
    // The frame on the wire ends in `;`. An exchange used to have to strip it
    // by hand (`frameOf`) because parse() folded it into the last argument, so
    // the exchange could not match itself. It now stores the frame verbatim.
    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const ex of rdo.exchanges) {
      expect(ex.request.endsWith(';')).toBe(true);
      expect(mock.match(ex.request)!.exchange.id).toBe(ex.id);
    }
  });

  it('every request parses as a well-formed sel/call frame', () => {
    for (const ex of rdo.exchanges) {
      const parsed = RdoProtocol.parse(ex.request);
      expect(parsed.verb).toBe('sel');
      expect(parsed.action).toBe('call');
      expect(parsed.member).toBe(ex.matchKeys!.member);
    }
  });
});

describe('civic-mutations scenario — the Politics ASP pages', () => {
  const mock = new HttpMock();
  mock.addScenario(http);

  const fetchPage = (name: string): string => {
    const result = mock.match('GET', `${POLITICS_PATH}/${name}?WorldName=Shamba&TownName=Shamba`);
    expect(result).not.toBeNull();
    return result!.body;
  };

  it('serves the five pages getPoliticsData fetches', () => {
    for (const name of [
      'popularratings.asp', 'ifelratings.asp', 'tycoonratings.asp',
      'mayorpub.asp', 'tycooncampaign.asp',
    ]) {
      expect(mock.match('GET', `${POLITICS_PATH}/${name}?WorldName=Shamba`)).not.toBeNull();
    }
  });

  it('popularratings.asp parses to its rows, separators dropped', () => {
    expect(parsePoliticsRatings(fetchPage('popularratings.asp'))).toEqual([
      { name: 'Unemployment', value: 85 },
      { name: 'Public Services', value: 62 },
      { name: 'Housing', value: 47 },
    ]);
  });

  it('ifelratings.asp parses through the same reader', () => {
    expect(parsePoliticsRatings(fetchPage('ifelratings.asp'))).toEqual([
      { name: 'IFEL Rating', value: 40 },
      { name: 'Commerce', value: 58 },
    ]);
  });

  it('tycoonratings.asp yields the cache id every rating write needs', () => {
    // The id is the `RatingId` argument of RDOSetRatingFrom; a row without one
    // cannot be rated at all.
    expect(parsePoliticsRatings(fetchPage('tycoonratings.asp'))).toEqual([
      { name: 'Taxation', value: 75, id: '41123456' },
      { name: 'Public Works', value: 30, id: '41123457' },
    ]);
  });

  it('the rating value comes from the span, not from the opinion dropdown', () => {
    // Every option in that select is a percentage too; reading the cell text
    // whole reported 100 for every row.
    const rows = parsePoliticsRatings(fetchPage('tycoonratings.asp'));
    expect(rows.map(r => r.value)).toEqual([75, 30]);
  });

  it('mayorpub.asp yields the level off the selected option, not the label', () => {
    expect(parsePublicityRows(fetchPage('mayorpub.asp'))).toEqual([
      { id: '41123456', name: 'Taxation', level: 75 },
      { id: '41123457', name: 'Public Works', level: 0 },
    ]);
  });

  it('mayorpub.asp publishes its hits-per-hour sentence', () => {
    expect(parsePublicityAds(fetchPage('mayorpub.asp')))
      .toBe('Your publicity reaches 12500 hits per hour.');
  });

  it('tycooncampaign.asp parses both project row shapes, in page order', () => {
    expect(parseCampaignProjects(fetchPage('tycooncampaign.asp'))).toEqual([
      { id: '42007700', name: 'Minister of Health', kind: 'minister', ministerName: 'SPO_test3', proposalState: 3 },
      { id: '42007701', name: 'Minister of Education', kind: 'minister', ministerName: 'None', proposalState: 1 },
      { id: '42007702', name: 'Unemployment', kind: 'goal', comparator: 'less than', value: 12 },
    ]);
  });

  it('tycooncampaign.asp yields the promise', () => {
    expect(parseCampaignPromise(fetchPage('tycooncampaign.asp')))
      .toBe('Lower the taxes, raise the schools.');
  });

  it('the Withdraw button is what says the campaign is running', () => {
    expect(parseCampaignState(fetchPage('tycooncampaign.asp'), false))
      .toEqual({ state: 'running', message: '' });
  });
});

/**
 * A session whose cacher reads are answered by `rdoMock` through the scenario's
 * exchanges. The cacher emits no frame of its own, so its reads are rebuilt here
 * and matched; the frames under test are the ones production writes itself.
 */
function makeCivicCtx(rdoMock: RdoMock): FakeSessionCtx {
  const fake = makeSessionCtx({
    sockets: ['construction'],
    currentWorldInfo: { name: 'Shamba', url: 'http://158.69.153.134', ip: '158.69.153.134', port: 7000 },
    activeUsername: 'SPO_test3', cachedPassword: 'test3',
    daAddr: '158.69.153.134', daPort: 7001,
  });
  fake.cacher.createObject.mockResolvedValue(CIVIC_TARGETS.tempObject); // substrate-exception: the fake's cacher emits no frame, so no RdoMock scenario can answer it
  fake.cacher.setPath.mockImplementation(async (id, path) => { // substrate-exception: the fake's cacher emits no frame, so no RdoMock scenario can answer it
    const frame = rdoCall('SetPath', id, RdoValue.string(path)).toFrame();
    const result = rdoMock.match(frame);
    if (!result) throw new Error(`L1: no exchange for SetPath ${path}`);
  });
  fake.cacher.getPropertyList.mockImplementation(async (id, props) => { // substrate-exception: the fake's cacher emits no frame, so no RdoMock scenario can answer it
    // The bind ids of a Town Hall: its CurrBlock serves as its ObjectId too.
    if (props[0] === 'CurrBlock') return [CIVIC_TARGETS.townHallBlock, CIVIC_TARGETS.townHallBlock];
    // The tax read-back witness: its value is not what these tests judge.
    if (props.length === 1 && /^Tax\d+Percent$/.test(props[0])) return [''];
    const frame = rdoCall(
      'GetPropertyList', id, RdoValue.string(props.join('\t') + '\t'),
    ).toFrame();
    const result = rdoMock.match(frame);
    if (!result) throw new Error(`L1: no exchange for GetPropertyList ${props.join(',')}`);
    const match = /res="%([^"]*)"/.exec(result.response);
    return match ? match[1].split('\t') : [];
  });
  (fake.ctx.getCacherPropertyListAt as jest.Mock).mockResolvedValue([CIVIC_TARGETS.townHallId, CIVIC_TARGETS.townHallBlock]); // substrate-exception: reads the cacher, which the fake stubs and which emits no frame, so no scenario can answer it
  return fake;
}

describe('civic-mutations scenario — the frames production emits', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function driver() {
    const rdoMock = new RdoMock();
    rdoMock.addScenario(rdo);
    return { fake: makeCivicCtx(rdoMock), rdoMock };
  }

  it.each([
    {
      member: 'RDOSetRatingFrom',
      slug: 'set-rating-from',
      emit: (ctx: FakeSessionCtx['ctx']) => politicsSetRating(ctx, 118, 226, '41123456', 75),
      literal: 'C sel 130500777 call RDOSetRatingFrom "*" "%41123456","%SPO_test3","#75";',
    },
    {
      member: 'RDOSetPublicity',
      slug: 'set-publicity',
      emit: (ctx: FakeSessionCtx['ctx']) => politicsSetPublicity(ctx, 118, 226, '41123456', 75),
      literal: 'C sel 130500777 call RDOSetPublicity "*" "%41123456","#75";',
    },
    {
      member: 'RDOSetProjectData',
      slug: 'set-project-data',
      emit: (ctx: FakeSessionCtx['ctx']) => politicsSetProjectData(ctx, 118, 226, '42007700', 'SPO_test3'),
      literal: 'C sel 130500777 call RDOSetProjectData "*" "%SPO_test3","%42007700","%SPO_test3";',
    },
  ])('binds $member to the political entity (TownHallId), not the block', async ({ slug, emit, literal }) => {
    // `TownHallId` and `CurrBlock` differ on a Capitol; binding a rating to the
    // facility would address an object that has no such member.
    const { fake, rdoMock } = driver();

    await expect(emit(fake.ctx)).resolves.toEqual({ success: true, message: '' });

    expect(fake.frames.construction).toEqual([literal]);
    expect(fake.frames.construction[0]).not.toContain(CIVIC_TARGETS.townHallBlock);
    expect(rdoMock.match(fake.frames.construction[0])!.exchange.id).toBe(`civic-rdo-${slug}`);
    expect(fake.frames.construction).toPassStrictRdoValidation(rdo);
  });

  it('the tax write takes the account id, never the row index', async () => {
    // Row 0 is account 100: the gateway resolves `Tax0Id` before it writes.
    const { fake, rdoMock } = driver();

    const pending = setBuildingProperty(fake.ctx, 118, 226, 'RDOSetTaxValue', '15', { index: '0' });
    await jest.advanceTimersByTimeAsync(200);
    await pending;

    expect(rdoMock.getConsumedIds().has('civic-rdo-lookup-tax-id')).toBe(true);
    expect(fake.frames.construction).toEqual(['C sel 130500401 call RDOSetTaxValue "*" "#100","%15";']);
    expect(rdoMock.match(fake.frames.construction[0])!.exchange.id).toBe('civic-rdo-set-tax-value');
    expect(fake.frames.construction).toPassStrictRdoValidation(rdo);
  });

  it('a subsidy travels as the literal -10, sign included', async () => {
    const { fake, rdoMock } = driver();

    const pending = setBuildingProperty(fake.ctx, 118, 226, 'RDOSetTaxValue', '-10', { taxId: '110' });
    await jest.advanceTimersByTimeAsync(200);
    await pending;

    expect(fake.frames.construction).toEqual(['C sel 130500401 call RDOSetTaxValue "*" "#110","%-10";']);
    expect(rdoMock.match(fake.frames.construction[0])!.exchange.id).toBe('civic-rdo-set-tax-value-subsidy');
    expect(fake.frames.construction).toPassStrictRdoValidation(rdo);
  });
});

describe('civic-mutations scenario — the world.five flag drives getPoliticsData', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  function drive(electionsOn: boolean) {
    const { rdo, http } = createCivicMutationsScenario(undefined, { electionsOn });
    const rdoMock = new RdoMock();
    rdoMock.addScenario(rdo);
    const httpMock = new HttpMock();
    httpMock.addScenario(http);

    mockFetch.mockImplementation(async (url: string) => {
      const result = httpMock.match('GET', url);
      if (!result) {
        return { ok: false, status: 404, text: async () => '' } as unknown as Response;
      }
      return { ok: true, status: 200, text: async () => result.body } as unknown as Response;
    });

    return { fake: makeCivicCtx(rdoMock), rdoMock };
  }

  it('ElectionsOn = 0: the state is noElections and the campaign page is never fetched', async () => {
    const { fake, rdoMock } = drive(false);

    const data = await getPoliticsData(fake.ctx, 'Shamba', 118, 226);

    expect(data.campaignState).toBe('noElections');
    expect(data.canLaunchCampaign).toBe(false);
    const urls = mockFetch.mock.calls.map(c => c[0] as string);
    expect(urls.some(u => u.includes('tycooncampaign.asp'))).toBe(false);
    expect(rdoMock.getConsumedIds().has('civic-rdo-world-set-path')).toBe(true);
    expect(rdoMock.getConsumedIds().has('civic-rdo-world-elections-on')).toBe(true);
    expect(data.mayorName).toBe('Rio');
    expect(data.townHallId).toBe(130500777);
  });

  it('ElectionsOn = 1: the campaign page decides, as today', async () => {
    const { fake } = drive(true);

    const data = await getPoliticsData(fake.ctx, 'Shamba', 118, 226);

    expect(data.campaignState).toBe('running');
    const urls = mockFetch.mock.calls.map(c => c[0] as string);
    expect(urls).toHaveLength(5);
    expect(urls[4]).toContain('tycooncampaign.asp');
  });

  it('each path read matches back to its own exchange', () => {
    const { rdo } = createCivicMutationsScenario(undefined, { electionsOn: false });
    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const id of [
      'civic-rdo-town-set-path', 'civic-rdo-town-ruler-block',
      'civic-rdo-world-set-path', 'civic-rdo-world-elections-on',
    ]) {
      const ex = rdo.exchanges.find(e => e.id === id)!;
      expect(mock.match(ex.request)!.exchange.id).toBe(ex.id);
    }
  });
});
