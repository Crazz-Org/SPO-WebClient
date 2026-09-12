/**
 * The directory tree's request side — which `.asp` a ref resolves to, and what
 * `getDirectoryPage` does with the page that comes back.
 *
 * `fetchPage` is the only thing stubbed: everything above it (path building, parser
 * dispatch, icon proxying) is the code under test.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { SearchMenuService, directoryPagePath } from '../search-menu-service';
import type { DirectoryRef } from '../../shared/types';

const WORLD = 'planitia';
const DA = '158.69.153.134';
const DIR = '/five/0/visual/voyager/new%20directory';

function service(): SearchMenuService {
  return new SearchMenuService('127.0.0.1', 1000, WORLD, 'SPO_test3', 'Crazz Ltd.', DA, 7001);
}

/** Replace the HTTP round-trip with a canned page, and record the path that was asked for. */
function stubFetch(svc: SearchMenuService, html: string): jest.Mock<(path: string) => Promise<string>> {
  const fetch = jest.fn(async (_path: string) => html);
  jest
    .spyOn(svc as unknown as { fetchPage(path: string): Promise<string> }, 'fetchPage')
    .mockImplementation(fetch);
  return fetch as unknown as jest.Mock<(path: string) => Promise<string>>;
}

afterEach(() => jest.restoreAllMocks());

describe('directoryPagePath', () => {
  it('builds the town page with the cache path and the visual class (RenderTownIn.asp:7-9)', () => {
    expect(directoryPagePath({ kind: 'town', path: 'Towns\\Helartia.five', classId: '1234' }, WORLD))
      .toBe(`${DIR}/RenderTownIn.asp?WorldName=planitia&Path=Towns\\Helartia.five&ClassId=1234&RIWS=`);
  });

  it('keeps the backslashes of a cache path raw, as the ranking path already proves live', () => {
    const path = directoryPagePath({ kind: 'facility', path: 'Towns\\Helartia.five\\Facilities\\Residentials', name: 'House' }, WORLD);

    expect(path).toContain('Path=Towns\\Helartia.five\\Facilities\\Residentials');
    expect(path).not.toContain('%5C');
  });

  it('names the two town folder pages (InTownFacilities.asp:8-9, InTownCompanies.asp:8-9)', () => {
    expect(directoryPagePath({ kind: 'town-facilities', town: 'Helartia' }, WORLD))
      .toBe(`${DIR}/InTownFacilities.asp?WorldName=planitia&Town=Helartia&RIWS=`);
    expect(directoryPagePath({ kind: 'town-companies', town: 'Helartia' }, WORLD))
      .toBe(`${DIR}/InTownCompanies.asp?WorldName=planitia&Town=Helartia&RIWS=`);
  });

  it('names a town company and its facility kinds', () => {
    expect(directoryPagePath({ kind: 'town-company', town: 'Helartia', company: 'Crazz Ltd' }, WORLD))
      .toBe(`${DIR}/InTownCompany.asp?WorldName=planitia&Town=Helartia&Company=Crazz%20Ltd&RIWS=`);
    expect(directoryPagePath({ kind: 'town-facility-kind', town: 'Helartia', facKind: 'Residentials' }, WORLD))
      .toBe(`${DIR}/BrowseTownFacFolder.asp?WorldName=planitia&Town=Helartia&FacKind=Residentials&RIWS=`);
    expect(directoryPagePath(
      { kind: 'town-company-facility-kind', town: 'Helartia', company: 'Crazz Ltd', facKind: 'Residentials' },
      WORLD,
    )).toBe(`${DIR}/BrowseTownCompFacFolder.asp?WorldName=planitia&Town=Helartia&Company=Crazz%20Ltd&FacKind=Residentials&RIWS=`);
  });

  it('names the three tycoon pages', () => {
    expect(directoryPagePath({ kind: 'tycoon-companies', tycoon: 'Crazz' }, WORLD))
      .toBe(`${DIR}/TycoonCompanies.asp?WorldName=planitia&Tycoon=Crazz&RIWS=`);
    expect(directoryPagePath({ kind: 'tycoon-company', tycoon: 'Crazz', company: 'Crazz Ltd' }, WORLD))
      .toBe(`${DIR}/TycoonCompany.asp?WorldName=planitia&Tycoon=Crazz&Company=Crazz%20Ltd&RIWS=`);
    expect(directoryPagePath(
      { kind: 'tycoon-facility-kind', tycoon: 'Crazz', company: 'Crazz Ltd', facKind: 'Farms' },
      WORLD,
    )).toBe(`${DIR}/TycoonFacilities.asp?WorldName=planitia&Tycoon=Crazz&Company=Crazz%20Ltd&FacKind=Farms&RIWS=`);
  });

  it('names the facility card with both halves of the cache path (OpenFacility.asp:26)', () => {
    expect(directoryPagePath({ kind: 'facility', path: 'Towns\\H.five', name: 'Cheap House 1' }, WORLD))
      .toBe(`${DIR}/OpenFacility.asp?WorldName=planitia&Path=Towns\\H.five&Name=Cheap%20House%201&RIWS=`);
  });

  it('encodes an & in a name rather than letting it split the query', () => {
    const path = directoryPagePath({ kind: 'facility', path: 'P', name: 'Bed & Breakfast' }, WORLD);

    expect(path).toContain('Name=Bed%20%26%20Breakfast');
  });

  it('refuses a kind it does not know — the only .asp names it can reach are its own ten', () => {
    expect(() => directoryPagePath({ kind: 'wat' } as unknown as DirectoryRef, WORLD))
      .toThrow(/Unknown directory page kind: wat/);
  });
});

describe('getDirectoryPage', () => {
  it('fetches the town page and proxies its icon', async () => {
    const svc = service();
    const fetch = stubFetch(svc, `<html><body>
      <div><img src="/five/icons/TownHall64.gif" width=120></div>
      <div class=header2>Helartia</div>
      <span class=value>12400</span><span class=value>71%</span><span class=value>4:</span>
      <a href="http://local.asp?frame_Id=MapIsoView&frame_Action=SELECT&x=120&y=340">Show in map</a>
    </body></html>`);

    const page = await svc.getDirectoryPage({ kind: 'town', path: 'Towns\\Helartia.five', classId: '1234' });

    expect(fetch).toHaveBeenCalledWith(`${DIR}/RenderTownIn.asp?WorldName=planitia&Path=Towns\\Helartia.five&ClassId=1234&RIWS=`);
    expect(page).toEqual({
      kind: 'town',
      town: {
        name: 'Helartia',
        iconUrl: `/proxy-image?url=${encodeURIComponent(`http://${DA}/five/icons/TownHall64.gif`)}`,
        inhabitants: 12400,
        qualityOfLife: 71,
        unemploymentPercent: 4,
        x: 120,
        y: 340,
      },
    });
  });

  it('returns a folder listing untouched — it carries no image', async () => {
    const svc = service();
    stubFetch(svc, `<html><body><table>
      <tr dirHref="BrowseTownFacFolder.asp?FacKind=Residentials"><td><div class=listItem>Residentials</div></td></tr>
    </table></body></html>`);

    await expect(svc.getDirectoryPage({ kind: 'town-facilities', town: 'Helartia' }))
      .resolves.toEqual({ kind: 'folder', items: ['Residentials'], ownedBy: null });
  });

  it('proxies the icon of every facility row', async () => {
    const svc = service();
    stubFetch(svc, `<html><body><table>
      <tr dirHref="OpenFacility.asp?Path=P&WorldName=planitia&Name=House&RIWS=">
        <td><img width="30" src="/five/icons/House64.gif"></td>
        <td><div class=listItem>House</div><div class=itemInfo>Crazz Ltd.</div></td>
      </tr>
    </table></body></html>`);

    const page = await svc.getDirectoryPage({ kind: 'town-facility-kind', town: 'Helartia', facKind: 'Residentials' });

    expect(page.kind).toBe('facility-list');
    expect(page).toMatchObject({
      facilities: [expect.objectContaining({
        iconUrl: `/proxy-image?url=${encodeURIComponent(`http://${DA}/five/icons/House64.gif`)}`,
      })],
    });
  });

  it('proxies the icon of a facility card', async () => {
    const svc = service();
    stubFetch(svc, `<html><body>
      <div><img src="/five/icons/House64.gif"></div>
      <div class=header2>Cheap House 1</div>
      <div class=itemHeader>Crazz Ltd.</div>
      <table><tr><td class=label>ROI:</td><td class=value>Already.</td></tr></table>
    </body></html>`);

    const page = await svc.getDirectoryPage({ kind: 'facility', path: 'P', name: 'Cheap House 1' });

    expect(page).toEqual({
      kind: 'facility',
      facility: expect.objectContaining({
        name: 'Cheap House 1',
        roiText: 'Already.',
        iconUrl: `/proxy-image?url=${encodeURIComponent(`http://${DA}/five/icons/House64.gif`)}`,
      }),
    });
  });

  it('passes a card the server could not resolve through as null, not as a throw', async () => {
    const svc = service();
    stubFetch(svc, '<html><body></body></html>');

    await expect(svc.getDirectoryPage({ kind: 'facility', path: 'Gone', name: 'Gone' }))
      .resolves.toEqual({ kind: 'facility', facility: null });
  });

  it('rejects a ref whose kind has no page, without reaching the network', async () => {
    const svc = service();
    const fetch = stubFetch(svc, '');

    await expect(svc.getDirectoryPage({ kind: 'wat' } as unknown as DirectoryRef))
      .rejects.toThrow(/Unknown directory page kind/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
