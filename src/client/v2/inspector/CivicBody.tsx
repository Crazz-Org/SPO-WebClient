/**
 * CivicBody — the open civic tab of a Capitol or Town Hall.
 *
 * The same routing as v1's `CivicTabContent` (local to BuildingInspector, hence repeated
 * here rather than imported): each consolidated civic tab hands its server groups to the
 * politics section component that already draws them. The section components are reused
 * as they are.
 */

import type { BuildingDetailsResponse, TownHallDemographics } from '@/shared/types';
import {
  OverviewSection as CivicOverviewSection,
  AdministrationSection,
  DemographicsSection,
  ElectionsSection,
  PoliticsSection,
  getGeneralGroupId,
} from '../../components/politics';

interface CivicBodyProps {
  activeTab: string;
  details: BuildingDetailsResponse;
  /** Does this player govern THIS facility? Result of `grantAccess`, shipped with the details. */
  canGovern: boolean;
  demographics: TownHallDemographics | null;
}

export function CivicBody({ activeTab, details, canGovern, demographics }: CivicBodyProps) {
  const groups = details.groups ?? {};
  const generalGroupId = getGeneralGroupId(details.tabs);
  const generalProps = generalGroupId ? (groups[generalGroupId] ?? []) : [];
  const votesProps = groups['votes'] ?? [];
  const x = details.x;
  const y = details.y;

  switch (activeTab) {
    case 'overview':
      return (
        <CivicOverviewSection
          generalProperties={generalProps}
          votesProperties={votesProps}
          buildingX={x}
          buildingY={y}
          serverTabs={details.tabs}
        />
      );
    case 'administration':
      return (
        <AdministrationSection
          townsProperties={groups['capitolTowns'] ?? []}
          ministriesProperties={groups['ministeries'] ?? []}
          taxesProperties={groups['townTaxes'] ?? []}
          buildingX={x}
          buildingY={y}
          canGovern={canGovern}
        />
      );
    case 'demographics':
      return (
        <DemographicsSection
          jobsProperties={groups['townJobs'] ?? []}
          residentialsProperties={groups['townRes'] ?? []}
          servicesProperties={groups['townServices'] ?? []}
          buildingX={x}
          buildingY={y}
          serverTabs={details.tabs}
          demographics={demographics}
          canGovern={canGovern}
        />
      );
    case 'elections':
      return <ElectionsSection votesProperties={votesProps} buildingX={x} buildingY={y} />;
    case 'politics':
      return <PoliticsSection buildingX={x} buildingY={y} />;
    default:
      return null;
  }
}
