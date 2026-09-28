/**
 * Every control the tutorial names is one the player can find.
 *
 * The tutorial text (`tutorial-content.ts`) marks a client-owned control label
 * as `[[Label]]`. A label is client-owned when its string lives in `src/client`
 * or in `src/shared/building-details/template-groups.ts` — this test can prove
 * it. Names the server supplies (directory tiles, build categories, facility
 * names, research categories and inventions, `CloneMenu0` options) stay plain
 * words with no marker, because no client render can prove them.
 *
 * `REGISTRY` below is the table of proof: one entry per marked label, with the
 * layout it lives on (`desktop`, `mobile` or `both`) and the proof — a render
 * of the owning component that finds the label on screen, or, for inspector
 * section names and template buttons, a check against the `HANDLER_TO_GROUP`
 * data the inspector renders from. When one label names two controls, the
 * proof covers both.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { TUTORIAL_CONTENT } from './tutorial-content';
import { useUiStore } from '../../store/ui-store';
import { useGameStore, type TycoonStats } from '../../store/game-store';
import { useMailStore } from '../../store/mail-store';
import { useChatStore } from '../../store/chat-store';
import { useBuildingStore } from '../../store/building-store';
import { useProfileStore } from '../../store/profile-store';
import { useTutorialStore } from '../../store/tutorial-store';
import { useSearchStore } from '../../store/search-store';
import { useEmpireStore } from '../../store/empire-store';
import { CommandBar } from '../hud/CommandBar';
import { StatusPill } from '../hud/StatusPill';
import { useModeDescriptor } from '../hud/use-mode-descriptor';
import { BottomNav } from '../mobile/BottomNav';
import { BottomSheet } from '../mobile/BottomSheet';
import { MobileMenu } from '../mobile/MobileMenu';
import { MobileInfoBar } from '../mobile/MobileInfoBar';
import { MobileModeBar } from '../mobile/MobileModeBar';
import { CommandPalette } from '../command-palette/CommandPalette';
import { Sheet } from '../sheet/Sheet';
import { SearchPanel } from '../search/SearchPanel';
import { ProfilePanel } from '../empire/ProfilePanel';
import { StatusOverlay } from '../building/StatusOverlay';
import { QuickStats } from '../building/QuickStats';
import { ResearchPanel } from '../building/ResearchPanel';
import { CompInputsPanel } from '../building/InputsGroup';
import { SuppliesPanel } from '../building/SuppliesGroup';
import { ProductsPanel } from '../building/ProductsGroup';
import { CloneSettings, TradeConnectButtons } from '../building/PropertyActions';
import { ConnectionPickerContent } from '../modals/ConnectionPickerModal';
import { HANDLER_TO_GROUP } from '@/shared/building-details/template-groups';
import { WsMessageType } from '@/shared/types';
import type {
  BankAccountData, BuildingConnectionData, BuildingFocusInfo, CurriculumData,
  ResearchCategoryData, TutorialState, TycoonProfileFull,
} from '@/shared/types';

jest.mock('../../bridge/client-bridge', () => ({
  ...jest.requireActual<object>('../../bridge/client-bridge'),
  worldToScreenCentered: () => ({ x: 400, y: 300, textureHeight: 64 }),
}));

// ---------------------------------------------------------------------------
// Fixtures — the minimum store state each owning component needs to render.
// ---------------------------------------------------------------------------

const STATS: TycoonStats = {
  username: 'SPO_test3', ranking: 12, cash: '12480300', incomePerHour: '184200',
  buildingCount: 14, maxBuildings: 50, failureLevel: 0,
};

const CURRICULUM: CurriculumData = {
  tycoonName: 'SPO_test3', currentLevel: 1, currentLevelName: 'Apprentice',
  currentLevelDescription: 'You are an apprentice.', currentLevelBadgeUrl: '',
  currentLevelCondition: '', levelReqStatus: '', nextLevelName: 'Entrepreneur',
  nextLevelDescription: 'Entrepreneurs run businesses.', nextLevelRequirements: 'Prestige 100',
  canUpgrade: false, isUpgradeRequested: false, fortune: '$100,000,000', averageProfit: '$0/h',
  prestige: 10, facPrestige: 0, researchPrestige: 0, budget: '100000000', ranking: 12,
  facCount: 1, facMax: 50, area: 0, nobPoints: 0, tournamentOn: false, abilityTotal: 0,
  abilityRankingPoints: 0, abilityLevelPoints: 0, abilityLoanPoints: 0, rankings: [],
  curriculumItems: [{ item: 'Joined the world', prestige: 10 }],
} as CurriculumData;

const BANK: BankAccountData = {
  balance: '100000000', maxLoan: '50000000', totalLoans: '0', totalNextPayment: '0',
  loans: [], defaultInterest: 3, defaultTerm: 5,
};

const PROFILE: TycoonProfileFull = {
  name: 'SPO_test3', realName: 'SPO_test3', ranking: 12, budget: '0', prestige: 0,
  facPrestige: 0, researchPrestige: 0, facCount: 0, facMax: 0, area: 0, nobPoints: 0,
  licenceLevel: 0, failureLevel: 0, levelName: 'Apprentice', levelTier: 0,
};

const ASSIGNMENT: TutorialState = {
  taskObjId: '130600501', kindId: 'Welcome', name: 'Tutorial Welcome', stage: 0,
  progress: 0, goal: '', done: false, company: 'Yellow Inc.', town: 'Shamba',
};

const FOCUS: BuildingFocusInfo = {
  buildingId: '12345', buildingName: 'Drug Store', ownerName: 'SPO_test3 - Green',
  salesInfo: 'Pharmaceutics sales at 80%', revenue: '$1,200/h',
  detailsText: 'Drug Store.  Upgrade Level: 1  Items Sold: 1/h  Efficiency: 87%  Desirability: 46',
  hintsText: 'Consider raising prices', x: 100, y: 200, xsize: 2, ysize: 2, visualClass: '300',
};

const CONNECTION: BuildingConnectionData = {
  facilityName: 'Steel Mill', companyName: 'AcmeCorp', createdBy: 'Owner', price: '120',
  overprice: '10', lastValue: '5000', cost: '600', quality: '85', connected: true, x: 100, y: 200,
};

function openPicker(): void {
  useBuildingStore.getState().setConnectionPicker({ fluidName: 'Cotton', fluidId: 'Cotton', direction: 'input', buildingX: 100, buildingY: 100 });
}

function seedResearch(data: Partial<ResearchCategoryData>): void {
  const inventory = new Map<number, ResearchCategoryData>([[0, { categoryIndex: 0, available: [], developing: [], completed: [], ...data }]]);
  useBuildingStore.setState({
    research: {
      inventoryByCategory: inventory, activeCategoryIndex: 0, categoryTabs: [],
      loadedCategories: new Set(inventory.keys()), selectedInventionId: null, selectedDetails: null,
      isLoadingInventory: false, isLoadingDetails: false, pendingOps: new Map(),
    },
    isOwner: true,
  });
}

function openProfileSection(label: string): void {
  renderWithProviders(<ProfilePanel />);
  fireEvent.click(within(screen.getByLabelText('Profile sections')).getByText(label));
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------

/** Renders whatever mode is active, exactly as MobileShell does. */
function ModeHarness() {
  const mode = useModeDescriptor();
  return mode ? <MobileModeBar mode={mode} /> : null;
}

/** A tile of the desktop command bar and a tab of the phone's bottom nav. */
function commandBarAndBottomNav(label: string): void {
  renderWithProviders(<CommandBar />);
  expect(screen.getByRole('button', { name: label })).toBeTruthy();
  cleanup();
  renderWithProviders(<BottomNav />);
  expect(screen.getByRole('tab', { name: label })).toBeTruthy();
}

function commandBarOnly(label: string): void {
  renderWithProviders(<CommandBar />);
  expect(screen.getByRole('button', { name: label })).toBeTruthy();
}

function curriculumLabel(label: string): void {
  openProfileSection('Curriculum');
  act(() => { useProfileStore.getState().setCurriculum(CURRICULUM); });
  expect(screen.getAllByText(label).length).toBeGreaterThan(0);
}

function profileSectionName(label: string): void {
  renderWithProviders(<ProfilePanel />);
  expect(within(screen.getByLabelText('Profile sections')).getByText(label)).toBeTruthy();
}

function inspectorGroupName(label: string): void {
  expect(Object.values(HANDLER_TO_GROUP).some((g) => g.name === label)).toBe(true);
}

function inspectorButtonLabel(label: string): void {
  expect(Object.values(HANDLER_TO_GROUP).some((g) => g.properties.some((p) => p.buttonLabel === label))).toBe(true);
}

function inspectorDisplayName(label: string): void {
  expect(Object.values(HANDLER_TO_GROUP).some((g) => g.properties.some((p) => p.displayName === label))).toBe(true);
}

function compInputLabel(label: string): void {
  renderWithProviders(
    <CompInputsPanel
      compInputs={[{ name: 'Advertisement', supplied: 50, demanded: 100, ratio: 50, maxDemand: 200, editable: true, units: 'hits' }]}
      canEdit
      buildingX={100}
      buildingY={200}
    />,
  );
  expect(screen.getByText(label)).toBeTruthy();
}

function cloneLabel(label: string): void {
  useBuildingStore.setState({ isOwner: true });
  renderWithProviders(<CloneSettings cloneMenuValue="" buildingX={100} buildingY={200} />);
  expect(screen.getByText(label)).toBeTruthy();
}

function pickerLabel(find: () => HTMLElement): () => void {
  return () => {
    openPicker();
    renderWithProviders(<ConnectionPickerContent onClose={() => {}} />);
    expect(find()).toBeTruthy();
  };
}

type Layout = 'desktop' | 'mobile' | 'both';
interface Ref { layout: Layout; proof: (label: string) => void | Promise<void> }

const REGISTRY: Record<string, Ref> = {
  // Desktop CommandBar tiles and the phone's BottomNav tabs
  Build: { layout: 'both', proof: commandBarAndBottomNav },
  Map: { layout: 'both', proof: commandBarAndBottomNav },
  Mail: { layout: 'both', proof: commandBarAndBottomNav },
  Chat: { layout: 'both', proof: commandBarAndBottomNav },
  More: { layout: 'both', proof: commandBarAndBottomNav },
  Government: { layout: 'both', proof: commandBarAndBottomNav },
  Empire: { layout: 'desktop', proof: commandBarOnly },

  // The phone's More menu
  Profile: {
    layout: 'mobile',
    proof: () => {
      renderWithProviders(<MobileMenu />);
      expect(screen.getByRole('button', { name: /^Profile$/ })).toBeTruthy();
    },
  },
  Search: {
    layout: 'both',
    proof: () => {
      // More → Search on a phone …
      renderWithProviders(<MobileMenu />);
      expect(screen.getByRole('button', { name: /^Search$/ })).toBeTruthy();
      cleanup();
      // … and the Search button of the supplier / client picker.
      openPicker();
      renderWithProviders(<ConnectionPickerContent onClose={() => {}} />);
      expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
    },
  },

  // The sheet's close button, desktop and phone
  Close: {
    layout: 'both',
    proof: () => {
      act(() => useUiStore.getState().setRootSurface({ kind: 'mail' }));
      renderWithProviders(<Sheet />);
      expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
      cleanup();
      renderWithProviders(<BottomSheet open onClose={() => {}} title="Mail"><p>content</p></BottomSheet>);
      expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    },
  },

  // The status bar
  Debt: {
    layout: 'both',
    proof: () => {
      useGameStore.setState({ tycoonStats: { ...STATS, failureLevel: 1 } });
      renderWithProviders(<StatusPill />);
      expect(screen.getByText('Debt')).toBeTruthy();
      cleanup();
      renderWithProviders(<MobileInfoBar />);
      expect(screen.getByText('Debt')).toBeTruthy();
    },
  },
  Backup: {
    layout: 'desktop',
    proof: () => {
      useGameStore.setState({ tycoonStats: STATS, serverBusy: true });
      renderWithProviders(<StatusPill />);
      expect(screen.getByText('Backup')).toBeTruthy();
    },
  },

  // The card over a selected building
  INSPECT: {
    layout: 'both',
    proof: async () => {
      useBuildingStore.setState({ focusedBuilding: FOCUS, isOverlayMode: true });
      renderWithProviders(<StatusOverlay />);
      expect((await screen.findByTestId('inspect-button')).textContent).toBe('INSPECT');
    },
  },

  // The command palette (desktop search box)
  'Open Search': {
    layout: 'desktop',
    proof: () => {
      jest.useFakeTimers();
      useUiStore.setState({ commandPaletteOpen: true });
      renderWithProviders(<CommandPalette />);
      act(() => { jest.advanceTimersByTime(60); });
      expect(screen.getByText('Open Search')).toBeTruthy();
    },
  },

  // The Search panel's towns page
  'Show on map': {
    layout: 'both',
    proof: () => {
      useSearchStore.setState({
        currentPage: 'towns',
        isLoading: false,
        townsData: {
          type: WsMessageType.RESP_SEARCH_MENU_TOWNS,
          towns: [{ name: 'Helartia', iconUrl: '', mayor: null, population: 100, unemploymentPercent: 0, qualityOfLife: 0, x: 10, y: 20, path: '', classId: '' }],
        },
      });
      renderWithProviders(<SearchPanel />);
      expect(screen.getByRole('button', { name: 'Show on map' })).toBeTruthy();
    },
  },

  // The profile panel
  Curriculum: { layout: 'both', proof: profileSectionName },
  'Bank Account': { layout: 'both', proof: profileSectionName },
  Fortune: { layout: 'both', proof: curriculumLabel },
  'Avg. Profit': { layout: 'both', proof: curriculumLabel },
  Prestige: { layout: 'both', proof: curriculumLabel },
  Nobility: { layout: 'both', proof: curriculumLabel },
  'Current Level': { layout: 'both', proof: curriculumLabel },
  'Next Level': { layout: 'both', proof: curriculumLabel },
  'Curriculum Items': { layout: 'both', proof: curriculumLabel },
  'Request Loan': {
    layout: 'both',
    proof: () => {
      openProfileSection('Bank Account');
      act(() => { useProfileStore.getState().setBankAccount(BANK); });
      expect(screen.getByRole('button', { name: 'Request Loan' })).toBeTruthy();
    },
  },
  Borrow: {
    layout: 'both',
    proof: () => {
      openProfileSection('Bank Account');
      act(() => { useProfileStore.getState().setBankAccount(BANK); });
      fireEvent.click(screen.getByRole('button', { name: 'Request Loan' }));
      expect(screen.getByRole('button', { name: 'Borrow' })).toBeTruthy();
    },
  },
  Tutorial: {
    layout: 'both',
    proof: () => {
      act(() => {
        useProfileStore.getState().setProfile(PROFILE);
        useTutorialStore.getState().setAssignment(ASSIGNMENT);
      });
      renderWithProviders(<ProfilePanel />);
      expect(screen.getByRole('button', { name: /Tutorial/ })).toBeTruthy();
    },
  },

  // Inspector sections and template buttons — the data the inspector renders from
  General: { layout: 'both', proof: inspectorGroupName },
  Services: { layout: 'both', proof: inspectorGroupName },
  Supplies: { layout: 'both', proof: inspectorGroupName },
  Products: { layout: 'both', proof: inspectorGroupName },
  Upgrade: { layout: 'both', proof: inspectorGroupName },
  Connect: { layout: 'both', proof: inspectorButtonLabel },
  Demolish: { layout: 'both', proof: inspectorButtonLabel },
  'Quick Trade': { layout: 'both', proof: inspectorDisplayName },

  // The Research section
  Research: {
    layout: 'both',
    proof: (label) => {
      inspectorGroupName(label);
      seedResearch({ available: [{ inventionId: 'AdvTech', name: 'Advanced Technologies', enabled: true }] });
      const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);
      // Rows sit in a collapsed accordion group: open it, as the player does.
      fireEvent.click(container.querySelector('[aria-expanded="false"]') as HTMLButtonElement);
      expect(screen.getByRole('button', { name: 'Research' })).toBeTruthy();
    },
  },
  'In research queue': {
    layout: 'both',
    proof: () => {
      seedResearch({ developing: [{ inventionId: 'AdvTech', name: 'Advanced Technologies' }] });
      renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);
      expect(screen.getByText('In research queue')).toBeTruthy();
    },
  },

  // Connect mode's way out, on the desktop mode bar and the phone's
  Cancel: {
    layout: 'both',
    proof: () => {
      act(() => useUiStore.getState().setConnectMode(true, 'Drug Store'));
      renderWithProviders(<CommandBar />);
      expect(screen.getByRole('button', { name: /^Cancel/ })).toBeTruthy();
      cleanup();
      renderWithProviders(<ModeHarness />);
      expect(screen.getByRole('button', { name: 'Cancel — leave Connect mode' })).toBeTruthy();
    },
  },

  // The Services section (company inputs)
  Demand: { layout: 'both', proof: compInputLabel },
  Supply: { layout: 'both', proof: compInputLabel },

  // The inspector's quick stats
  Desirability: {
    layout: 'both',
    proof: () => {
      renderWithProviders(<QuickStats focus={FOCUS} />);
      expect(screen.getByText('Desirability')).toBeTruthy();
    },
  },

  // The Upgrade section's clone settings
  'Clone Settings': { layout: 'both', proof: cloneLabel },
  'Same Town': { layout: 'both', proof: cloneLabel },
  'Apply Clone': {
    layout: 'both',
    proof: () => {
      useBuildingStore.setState({ isOwner: true });
      renderWithProviders(<CloneSettings cloneMenuValue="" buildingX={100} buildingY={200} />);
      expect(screen.getByRole('button', { name: 'Apply Clone' })).toBeTruthy();
    },
  },

  // The General section's Quick Trade row
  Stores: {
    layout: 'both',
    proof: () => {
      renderWithProviders(<TradeConnectButtons properties={[{ name: 'Role', value: 'Warehouse' }]} onAction={() => {}} />);
      expect(screen.getAllByRole('button', { name: 'Stores' }).length).toBeGreaterThan(0);
    },
  },

  // Hire, in the Supplies and the Products sections
  Hire: {
    layout: 'both',
    proof: () => {
      const { container } = renderWithProviders(
        <SuppliesPanel
          supplies={[{ path: '/input/steel', name: 'Steel', metaFluid: 'fluid_steel', fluidValue: '800', lastCostPerc: '95', maxPrice: '200', minK: '50', connectionCount: 1, connections: [CONNECTION] }]}
          canEdit
          buildingX={100}
          buildingY={200}
        />,
      );
      fireEvent.click(container.querySelector('button') as HTMLButtonElement);
      expect(screen.getByRole('button', { name: 'Hire' })).toBeTruthy();
      cleanup();
      const products = renderWithProviders(
        <ProductsPanel
          onPropertyChange={() => {}}
          products={[{ path: '/output/chemicals', name: 'Chemicals', metaFluid: 'fluid_chemicals', lastFluid: '1200', quality: '90', pricePc: '110', avgPrice: '105', marketPrice: '5000', connectionCount: 1, connections: [CONNECTION] }]}
          canEdit
          buildingX={100}
          buildingY={200}
        />,
      );
      fireEvent.click(products.container.querySelector('button') as HTMLButtonElement);
      expect(screen.getByRole('button', { name: 'Hire' })).toBeTruthy();
    },
  },

  // The supplier / client picker
  Cost: { layout: 'both', proof: pickerLabel(() => screen.getByRole('option', { name: 'Cost' })) },
  Company: { layout: 'both', proof: pickerLabel(() => screen.getByLabelText('Company')) },
  Town: { layout: 'both', proof: pickerLabel(() => screen.getByLabelText('Town')) },
  'Select All': { layout: 'both', proof: pickerLabel(() => screen.getByRole('button', { name: 'Select All' })) },
  'Connect Selected': { layout: 'both', proof: pickerLabel(() => screen.getByRole('button', { name: /^Connect Selected \(\d+\)$/ })) },
};

// ---------------------------------------------------------------------------
// Walking the text
// ---------------------------------------------------------------------------

const MARKER = /\[\[(.+?)\]\]/g;

interface StageText { where: string; strings: string[] }

function stages(): StageText[] {
  const out: StageText[] = [];
  for (const [kindId, list] of Object.entries(TUTORIAL_CONTENT)) {
    list.forEach((stage, i) => {
      out.push({ where: `${kindId}/${i}`, strings: [stage.heading, ...stage.paragraphs] });
    });
  }
  return out;
}

function markersIn(text: string): string[] {
  return Array.from(text.matchAll(MARKER), (m) => m[1]);
}

beforeEach(() => {
  resetStores();
  useUiStore.getState().clearSurfaces();
  useUiStore.setState({
    commandPaletteOpen: false, isPlacingBuilding: false, placementValid: false, placingFacility: null,
    connectMode: { active: false, subject: '' }, mobileTab: 'map',
  });
  useGameStore.setState({
    isVisitor: false, isRoadBuildingMode: false, isRoadDemolishMode: false, isZonePaintingMode: false,
    username: 'SPO_test3', worldName: 'planitia', tycoonStats: null, serverBusy: false, watchers: [],
    overlayBeforeMode: null,
  });
  useMailStore.setState({ unreadCount: 0 });
  useChatStore.setState({ chatVisible: true, unreadChatCount: 0 });
  useBuildingStore.setState({ research: null, isOwner: false, focusedBuilding: null, isOverlayMode: false });
  useBuildingStore.getState().clearConnectionPicker();
  useProfileStore.getState().reset();
  useTutorialStore.getState().reset();
  useSearchStore.getState().reset();
  useEmpireStore.getState().reset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('tutorial control names — every marker resolves', () => {
  it('every [[…]] in the text has a registry entry', () => {
    const missing: string[] = [];
    for (const { where, strings } of stages()) {
      for (const text of strings) {
        for (const label of markersIn(text)) {
          if (!(label in REGISTRY)) missing.push(`${where}: [[${label}]]`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it.each(Object.keys(REGISTRY))('%s resolves on screen or in the inspector data', async (label) => {
    await REGISTRY[label].proof(label);
  });

  it('no registry entry goes unused', () => {
    const used = new Set(stages().flatMap(({ strings }) => strings.flatMap(markersIn)));
    const unused = Object.keys(REGISTRY).filter((label) => !used.has(label));
    expect(unused).toEqual([]);
  });

  it('a stage that names a desktop-only control names the phone path too, and the reverse', () => {
    const violations: string[] = [];
    for (const { where, strings } of stages()) {
      const layouts = new Set(strings.flatMap(markersIn).map((label) => REGISTRY[label]?.layout));
      const hasDesktop = layouts.has('desktop');
      const hasMobile = layouts.has('mobile');
      const hasBoth = layouts.has('both');
      if (hasDesktop && !hasMobile && !hasBoth) violations.push(`${where}: desktop only`);
      if (hasMobile && !hasDesktop && !hasBoth) violations.push(`${where}: mobile only`);
    }
    expect(violations).toEqual([]);
  });
});

describe('tutorial text — retired UI cannot come back', () => {
  it('no heading or paragraph names UI the client no longer has', () => {
    const RETIRED_WORDS = /\b(tickers?|toolbar|spider|envelope|pipe|bullseye|lamps?)\b/i;
    const RETIRED_PHRASES = [
      'forbidden sign', 'management tab', 'clients tab', 'clients page',
      'bottom of your screen', 'already filled in', 'until you press escape',
    ];
    const offending: string[] = [];
    for (const { where, strings } of stages()) {
      for (const text of strings) {
        const lower = text.toLowerCase();
        if (RETIRED_WORDS.test(text) || RETIRED_PHRASES.some((p) => lower.includes(p))) {
          offending.push(`${where}: ${text}`);
        }
      }
    }
    expect(offending).toEqual([]);
  });
});
