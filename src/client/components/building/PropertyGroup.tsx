/**
 * PropertyGroup — Renders building property values for the active tab.
 *
 * Uses property definitions from shared/building-details to determine
 * rendering: text, currency, percentage, slider (editable), boolean, etc.
 * Editable properties dispatch changes via the client callbacks.
 */

import { useCallback, memo, type JSX } from 'react';
import type { BuildingPropertyValue } from '@/shared/types';
import {
  PropertyType,
  type PropertyDefinition,
  type RdoCommandMapping,
  formatCurrency,
  formatPercentage,
  formatNumber,
  getTemplateForVisualClass,
  isHiddenProperty,
  PRODUCTS_GROUP,
} from '@/shared/building-details';
import { isCivicBuilding } from '@/shared/building-details/civic-buildings';
import { useBuildingStore } from '../../store/building-store';
import { useGameStore } from '../../store/game-store';
import { useClient } from '../../context';
import { ResearchPanel } from './ResearchPanel';
import { RevenueGraph } from './RevenueGraph';
import { SuppliesPanel } from './SuppliesGroup';
import { ProductsPanel } from './ProductsGroup';
import { CompInputsPanel } from './InputsGroup';
import { resolveRdoCommand, computePendingKey, getColorClass, buildSalaryParams } from './property-utils';
import { SliderInput, TextInput } from './PropertyInputs';
import { RatioValue, BooleanValue, StopToggle } from './PropertyDisplays';
import { DataTable, ServiceCardList, ProductSummaryCards } from './PropertyTables';
import { WorkforceTable } from './WorkforceTable';
import { UpgradeActions, RepairControl, TradeConnectButtons, ActionButton, CloneSettings, WarehouseWares } from './PropertyActions';
import { TradeModeControl, TradeLevelControl } from './TradeControls';
import styles from './PropertyGroup.module.css';

// Re-export utility functions for backward compatibility (tests import from here)
export { resolveRdoCommand, computePendingKey, parseCloneMenu, getColorClass } from './property-utils';

/** The five values the upgrade group carries alongside its control. */
const UPGRADE_VALUE_NAMES = ['UpgradeLevel', 'MaxUpgrade', 'NextUpgCost', 'Upgrading', 'Pending'];
/** The subset the UPGRADE_ACTIONS control prints inside itself — a row would
 *  repeat these. NextUpgCost is NOT among them: the control never shows the
 *  cost, so its row stays. */
const UPGRADE_WIDGET_OWNED_NAMES = ['UpgradeLevel', 'MaxUpgrade', 'Upgrading', 'Pending'];

interface PropertyGroupProps {
  properties: BuildingPropertyValue[];
  buildingX: number;
  buildingY: number;
}

export function PropertyGroup({ properties, buildingX, buildingY }: PropertyGroupProps) {
  const details = useBuildingStore((s) => s.details);
  const isOwner = useBuildingStore((s) => s.isOwner);
  const currentTab = useBuildingStore((s) => s.currentTab);
  const client = useClient();

  // Get property definitions from template system.
  // Template cache is populated by the store's setDetails action (via registerInspectorTabs)
  // using the handlerName fields the server sends with each tab.
  const visualClass = details?.visualClass ?? '0';
  const template = getTemplateForVisualClass(visualClass);
  const activeGroup = template.groups.find((g) => g.id === currentTab) ?? template.groups[0];
  const definitions = activeGroup?.properties ?? [];

  const isTownTab = activeGroup?.special === 'town';
  const isCivic = isCivicBuilding(visualClass);

  /**
   * Governance is per-facility, and both previous tests got that wrong.
   *
   * `checkIsMayor(properties)` returned true whenever the town had *any* mayor —
   * it never compared the ruler to the player, so every visitor was granted the
   * town tab. And `isPublicOfficeRole` is a session-wide label: it handed a
   * minister, who has no RDO power at all, the editable properties of every
   * civic building in the world.
   *
   * `grantAccess` asks the only question that matters — is this player's tycoon
   * id in this facility's own id list (`Protocol/Protocol.pas:428-431`).
   */
  const canGovern = details?.canGovern ?? false;
  const canEdit = isOwner || ((isTownTab || isCivic) && canGovern);

  // Product price change handler — resolves PricePc → RDOSetOutputPrice via PRODUCTS_GROUP.rdoCommands.
  // Accepts extra params (fluidId) to identify the specific output gate.
  const handleProductPropertyChange = useCallback(
    (propertyName: string, value: number, params?: Record<string, string>) => {
      const resolved = resolveRdoCommand(propertyName, PRODUCTS_GROUP.rdoCommands);
      client.onSetBuildingProperty(
        buildingX, buildingY,
        resolved.command, String(value),
        { ...resolved.params, ...params },
      );
    },
    [buildingX, buildingY, client],
  );

  // Special: supplies tab — render structured supply UI from details.supplies
  // GateMap filtering is done server-side — a gate the building class disables is never listed.
  if (activeGroup?.special === 'supplies') {
    const supplies = details?.supplies ?? [];
    return (
      <div className={styles.group}>
        <SuppliesPanel
          supplies={supplies}
          canEdit={canEdit}
          buildingX={buildingX}
          buildingY={buildingY}
        />
      </div>
    );
  }

  // Special: products tab — render structured product UI from details.products
  // GateMap filtering is done server-side — a gate the building class disables is never listed.
  if (activeGroup?.special === 'products') {
    const products = details?.products ?? [];
    return (
      <div className={styles.group}>
        <ProductsPanel
          products={products}
          canEdit={canEdit}
          buildingX={buildingX}
          buildingY={buildingY}
          onPropertyChange={handleProductPropertyChange}
        />
      </div>
    );
  }

  // Special: compInputs tab — eager render of company inputs (cInputCount/cInput{i}.* protocol)
  if (activeGroup?.special === 'compInputs') {
    return (
      <div className={styles.group}>
        <CompInputsPanel
          compInputs={details?.compInputs ?? []}
          canEdit={canEdit}
          buildingX={buildingX}
          buildingY={buildingY}
        />
      </div>
    );
  }

  if (properties.length === 0) {
    return <div className={styles.empty}>No data available for this tab</div>;
  }

  // Build value map for lookups
  const valueMap = new Map<string, string>();
  for (const prop of properties) {
    valueMap.set(prop.name, prop.value);
  }

  return (
    <div className={styles.group}>
      {definitions.length > 0 ? (
        <DefinedProperties
          definitions={definitions}
          rdoCommands={activeGroup?.rdoCommands}
          valueMap={valueMap}
          properties={properties}
          canEdit={canEdit}
          buildingX={buildingX}
          buildingY={buildingY}
        />
      ) : (
        // Fallback: render raw name/value pairs
        properties.map((prop, i) => (
          <RawPropertyRow key={`${prop.name}-${i}`} prop={prop} />
        ))
      )}
    </div>
  );
}

// =============================================================================
// DEFINED PROPERTIES (template-driven rendering)
// =============================================================================

interface DefinedPropertiesProps {
  definitions: PropertyDefinition[];
  rdoCommands?: Record<string, RdoCommandMapping>;
  valueMap: Map<string, string>;
  properties: BuildingPropertyValue[];
  canEdit: boolean;
  buildingX: number;
  buildingY: number;
}

function DefinedProperties({
  definitions,
  rdoCommands,
  valueMap,
  properties,
  canEdit,
  buildingX,
  buildingY,
}: DefinedPropertiesProps) {
  const client = useClient();
  const details = useBuildingStore((s) => s.details);
  const currentTab = useBuildingStore((s) => s.currentTab);
  const gameDate = useGameStore((s) => s.gameDate);
  const rendered = new Set<string>();
  const elements: JSX.Element[] = [];

  const handlePropertyChange = useCallback(
    (propertyName: string, value: number) => {
      // Resolve raw property name to RDO command via rdoCommands mapping.
      // e.g., 'srvPrices0' → RDOSetPrice with index=0
      const resolved = resolveRdoCommand(propertyName, rdoCommands);

      // RDOSetSalaries writes the whole triplet at once, so the two untouched
      // salaries travel with the edited one. The gateway refuses a partial
      // triplet rather than defaulting the missing values, which is what used
      // to overwrite them silently (M-C).
      const params = resolved.command === 'RDOSetSalaries'
        ? buildSalaryParams(properties, resolved.params, value)
        : resolved.params;

      client.onSetBuildingProperty(
        buildingX, buildingY,
        resolved.command, String(value),
        params,
      );
    },
    [buildingX, buildingY, client, rdoCommands, properties],
  );

  const handleStringPropertyChange = useCallback(
    (propertyName: string, value: string) => {
      // String variant for widestring properties like Name.
      const resolved = resolveRdoCommand(propertyName, rdoCommands);
      client.onSetBuildingProperty(
        buildingX, buildingY,
        resolved.command, value,
        resolved.params,
      );
    },
    [buildingX, buildingY, client, rdoCommands],
  );

  const handleActionButton = useCallback(
    (actionId: string) => {
      client.onBuildingAction(actionId);
    },
    [client],
  );

  const handleRowAction = useCallback(
    (actionId: string, rowIndex: number) => {
      const rowData: Record<string, string> = {};
      const tableDef = definitions.find((d) => d.type === PropertyType.TABLE);
      if (tableDef?.columns) {
        const propSuffix = tableDef.indexSuffix || '';
        for (const col of tableDef.columns) {
          const colSuffix = col.columnSuffix || '';
          const idxSuffix = col.indexSuffix !== undefined ? col.indexSuffix : propSuffix;
          const key = `${col.rdoSuffix}${rowIndex}${colSuffix}${idxSuffix}`;
          rowData[col.rdoSuffix] = valueMap.get(key) ?? '';
        }
      }
      rowData['_index'] = String(rowIndex);
      client.onBuildingAction(actionId, rowData);
    },
    [definitions, valueMap, client],
  );

  // The UPGRADE_ACTIONS control shares its rdoName ('UpgradeActions') with the
  // raw server property on the hide list. Hiding the raw VALUE must not hide
  // the CONTROL: its Upgrade / Downgrade / Stop buttons have no other home
  // (Voyager's Management sheet carries them, ManagementSheet.pas), and hiding
  // it made the whole upgrade path unreachable from the UI.
  const upgradeControlShown = definitions.some((d) => d.type === PropertyType.UPGRADE_ACTIONS);

  for (const def of definitions) {
    // Hidden by design — see HIDDEN_PROPERTY_NAMES. Marked as rendered so the
    // unmatched-property fallback below does not print the raw row instead.
    if (isHiddenProperty(def.rdoName) && def.type !== PropertyType.UPGRADE_ACTIONS) {
      rendered.add(def.rdoName);
      continue;
    }

    // Workforce table
    if (def.type === PropertyType.WORKFORCE_TABLE) {
      elements.push(
        <WorkforceTable
          key="workforce"
          properties={properties}
          canEdit={canEdit}
          rdoCommands={rdoCommands}
          buildingX={buildingX}
          buildingY={buildingY}
          onPropertyChange={handlePropertyChange}
        />,
      );
      for (let i = 0; i < 3; i++) {
        rendered.add(`Workers${i}`);
        rendered.add(`WorkersMax${i}`);
        rendered.add(`WorkersK${i}`);
        rendered.add(`Salaries${i}`);
        rendered.add(`WorkForcePrice${i}`);
        rendered.add(`WorkersCap${i}`);
        rendered.add(`MinSalaries${i}`);
      }
      continue;
    }

    // Upgrade actions
    if (def.type === PropertyType.UPGRADE_ACTIONS) {
      elements.push(
        <UpgradeActions
          key="upgrade"
          properties={properties}
          canEdit={canEdit}
          buildingX={buildingX}
          buildingY={buildingY}
        />,
      );
      for (const name of UPGRADE_VALUE_NAMES) {
        rendered.add(name);
      }
      continue;
    }

    // Repair control (progress bar + conditional start/stop)
    if (def.type === PropertyType.REPAIR_CONTROL) {
      const repairValue = valueMap.get('Repair') ?? '';
      const repairPrice = valueMap.get('RepairPrice') ?? '0';
      elements.push(
        <RepairControl
          key="repair"
          repairValue={repairValue}
          repairPrice={repairPrice}
          canEdit={canEdit}
          onAction={handleActionButton}
        />,
      );
      rendered.add('Repair');
      rendered.add('RepairPrice');
      continue;
    }

    // Research panel (custom HQ inventions UI)
    if (def.type === PropertyType.RESEARCH_PANEL) {
      elements.push(
        <ResearchPanel key="research" buildingX={buildingX} buildingY={buildingY} />,
      );
      rendered.add(def.rdoName);
      continue;
    }

    // Stop toggle button (Close/Open building) — owner only
    if (def.type === PropertyType.STOP_TOGGLE) {
      const stoppedValue = valueMap.get(def.rdoName) ?? '0';
      if (canEdit) {
        elements.push(
          <StopToggle
            key="stop-toggle"
            stoppedValue={stoppedValue}
            onPropertyChange={handlePropertyChange}
          />,
        );
      }
      rendered.add(def.rdoName);
      continue;
    }

    // Trade connect/disconnect buttons (visible to all players)
    if (def.type === PropertyType.TRADE_CONNECT_BUTTONS) {
      elements.push(
        <TradeConnectButtons
          key="trade-connect"
          onAction={handleActionButton}
        />,
      );
      rendered.add(def.rdoName);
      continue;
    }

    // Action button
    if (def.type === PropertyType.ACTION_BUTTON) {
      // Owner-only actions (connectMap, demolish) hidden from non-owners
      const ownerOnlyActions = new Set(['connectMap', 'demolish']);
      if (ownerOnlyActions.has(def.actionId ?? '') && !canEdit) {
        rendered.add(def.rdoName);
        continue;
      }
      elements.push(
        <ActionButton
          key={`action-${def.actionId ?? def.rdoName}`}
          def={def}
          onAction={handleActionButton}
        />,
      );
      rendered.add(def.rdoName);
      continue;
    }

    // Warehouse wares checklist (checkbox list of gate names from GetInputNames)
    if (def.type === PropertyType.WARE_CHECKLIST) {
      const wares = details?.warehouseWares ?? [];
      elements.push(
        <WarehouseWares
          key="warehouse-wares"
          wares={wares}
          buildingX={buildingX}
          buildingY={buildingY}
          onPropertyChange={(rdoName, value, params) => {
            client.onSetBuildingProperty(buildingX, buildingY, rdoName, value, params);
          }}
        />,
      );
      rendered.add(def.rdoName);
      continue;
    }

    // Clone settings (checklist of clone options + Apply button)
    if (def.type === PropertyType.CLONE_SETTINGS) {
      const cloneMenuValue = valueMap.get('CloneMenu0') ?? '';
      elements.push(
        <CloneSettings
          key="clone-settings"
          cloneMenuValue={cloneMenuValue}
          buildingX={buildingX}
          buildingY={buildingY}
        />,
      );
      rendered.add(def.rdoName);
      continue;
    }

    // Revenue graph (MoneyGraphInfo)
    if (def.type === PropertyType.GRAPH) {
      const hasGraph = valueMap.get('MoneyGraph') ?? '0';
      if (details?.moneyGraph?.length && hasGraph !== '0') {
        elements.push(
          <RevenueGraph
            key="revenue-graph"
            data={details.moneyGraph}
            endYear={gameDate ? gameDate.getUTCFullYear() - 1 : undefined}
          />,
        );
      }
      rendered.add(def.rdoName);
      continue;
    }

    // SERVICE_CARDS — card-per-service layout with price slider + avg marker
    if (def.type === PropertyType.SERVICE_CARDS && def.columns && def.columns.length > 0) {
      const propSuffix = def.indexSuffix || '';

      let rowCount = 0;
      if (def.countProperty) {
        rowCount = parseInt(valueMap.get(def.countProperty) ?? '0', 10) || 0;
        rendered.add(def.countProperty);
      }

      // Mark all column keys as rendered
      for (let i = 0; i < rowCount; i++) {
        for (const col of def.columns) {
          const colSuffix = col.columnSuffix || '';
          const idxSuffix = col.indexSuffix !== undefined ? col.indexSuffix : propSuffix;
          rendered.add(`${col.rdoSuffix}${i}${colSuffix}${idxSuffix}`);
        }
      }

      if (rowCount > 0) {
        elements.push(
          <ServiceCardList
            key={`svc-cards-${def.rdoName}`}
            def={def}
            rowCount={rowCount}
            valueMap={valueMap}
            canEdit={canEdit}
            onPropertyChange={handlePropertyChange}
          />,
        );
      }
      continue;
    }

    // TABLE property — multi-column indexed data
    if (def.type === PropertyType.TABLE && def.columns && def.columns.length > 0) {
      const propSuffix = def.indexSuffix || '';

      // Determine row count
      let rowCount = 0;
      if (def.countProperty) {
        rowCount = parseInt(valueMap.get(def.countProperty) ?? '0', 10) || 0;
        rendered.add(def.countProperty);
      } else if (def.indexMax !== undefined) {
        rowCount = def.indexMax + 1;
      } else {
        // Scan for first column keys to detect row count
        const firstCol = def.columns[0];
        const colSuffix = firstCol.columnSuffix || '';
        const idxSuffix = firstCol.indexSuffix !== undefined ? firstCol.indexSuffix : propSuffix;
        for (let i = 0; i < 50; i++) {
          if (valueMap.has(`${firstCol.rdoSuffix}${i}${colSuffix}${idxSuffix}`)) rowCount = i + 1;
          else break;
        }
      }

      // Mark all column keys as rendered
      for (let i = 0; i < rowCount; i++) {
        for (const col of def.columns) {
          const colSuffix = col.columnSuffix || '';
          const idxSuffix = col.indexSuffix !== undefined ? col.indexSuffix : propSuffix;
          rendered.add(`${col.rdoSuffix}${i}${colSuffix}${idxSuffix}`);
        }
      }

      if (rowCount > 0) {
        elements.push(
          <DataTable
            key={`table-${def.rdoName}`}
            def={def}
            rowCount={rowCount}
            valueMap={valueMap}
            canEdit={canEdit}
            rdoCommands={rdoCommands}
            onPropertyChange={handlePropertyChange}
            onRowAction={handleRowAction}
          />,
        );
      }
      continue;
    }

    // Trade mode — Voyager's cbMode (IndustryGeneralSheet.pas:189-235). Declared
    // as `TradeRole` in most templates and `Role` on the warehouse sheet; both
    // are the same cache value (Kernel/Kernel.pas:5893) and both write through
    // RDOSetRole. The member is named here rather than resolved through
    // `rdoCommands` because WH_GENERAL_GROUP maps no `Role` and TRADE_GROUP maps
    // nothing at all — resolution would emit `call Role`, which the server does
    // not publish. WarehouseWares (:412) takes the same direct route.
    if (def.rdoName === 'TradeRole' || def.rdoName === 'Role') {
      rendered.add(def.rdoName);
      const role = valueMap.get(def.rdoName);
      if (role !== undefined) {
        elements.push(
          <TradeModeControl
            key="trade-mode"
            value={role}
            canEdit={canEdit}
            onSend={(v) => client.onSetBuildingProperty(buildingX, buildingY, 'RDOSetRole', String(v))}
          />,
        );
      }
      continue;
    }

    // Trade level — Voyager's cbTrade; item 0 carries the Creator's name (:223).
    if (def.rdoName === 'TradeLevel') {
      rendered.add(def.rdoName);
      const level = valueMap.get(def.rdoName);
      if (level !== undefined) {
        const ownerName = valueMap.get('Creator') || details?.ownerName || 'the owner';
        elements.push(
          <TradeLevelControl
            key="trade-level"
            value={level}
            ownerName={ownerName}
            canEdit={canEdit}
            onSend={(v) => client.onSetBuildingProperty(buildingX, buildingY, 'RDOSetTradeLevel', String(v))}
          />,
        );
      }
      continue;
    }

    // Regular property
    const value = valueMap.get(def.rdoName);
    if (value === undefined) continue;

    // Skip hidden empties
    if (def.hideEmpty && (!value || value.trim() === '' || value === '0')) continue;
    // The UPGRADE_ACTIONS control prints level / max / pending inside itself —
    // a row here would repeat them. When the group has no control (or it were
    // hidden again) they fall through to ordinary rows instead, so no value is
    // ever silently lost. NextUpgCost always renders as a row: the control
    // never shows the cost of the spend it triggers.
    if (upgradeControlShown && UPGRADE_WIDGET_OWNED_NAMES.includes(def.rdoName)) {
      rendered.add(def.rdoName);
      continue;
    }

    rendered.add(def.rdoName);
    elements.push(
      <DefinedPropertyRow
        key={def.rdoName}
        def={def}
        value={value}
        maxValue={def.maxProperty ? valueMap.get(def.maxProperty) : undefined}
        canEdit={canEdit}
        onPropertyChange={handlePropertyChange}
        onStringPropertyChange={handleStringPropertyChange}
        rdoCommands={rdoCommands}
      />,
    );
  }

  // Product summary on General tab for industrial buildings (not warehouses — they have a dedicated Products tab)
  // Only show if we're on a General tab and products data exists
  const isGeneralTab = currentTab?.endsWith('General') || currentTab === 'generic';
  const isWarehouse = details?.tabs?.some(tab => tab.id === 'whGeneral') ?? false;
  const products = details?.products ?? [];
  if (isGeneralTab && products.length > 0 && !isWarehouse) {
    elements.push(
      <ProductSummaryCards
        key="product-summary"
        products={products}
        canEdit={canEdit}
        onPropertyChange={handlePropertyChange}
      />,
    );
  }

  // Fallback: unmatched properties
  for (const prop of properties) {
    if (!rendered.has(prop.name) && !prop.name.startsWith('_') && prop.name !== 'ObjectId' && !isHiddenProperty(prop.name)) {
      elements.push(<RawPropertyRow key={`raw-${prop.name}`} prop={prop} />);
    }
  }

  return <>{elements}</>;
}

// =============================================================================
// PROPERTY ROW COMPONENTS
// =============================================================================

interface DefinedPropertyRowProps {
  def: PropertyDefinition;
  value: string;
  maxValue?: string;
  canEdit: boolean;
  onPropertyChange: (name: string, value: number) => void;
  onStringPropertyChange?: (name: string, value: string) => void;
  rdoCommands?: Record<string, RdoCommandMapping>;
}

function DefinedPropertyRow({ def, value, maxValue, canEdit, onPropertyChange, onStringPropertyChange, rdoCommands }: DefinedPropertyRowProps) {
  return (
    <div className={styles.row}>
      <span className={styles.name} title={def.tooltip}>{def.displayName}</span>
      <PropertyValue
        def={def}
        value={value}
        maxValue={maxValue}
        canEdit={canEdit}
        onPropertyChange={onPropertyChange}
        onStringPropertyChange={onStringPropertyChange}
        rdoCommands={rdoCommands}
      />
    </div>
  );
}

const RawPropertyRow = memo(function RawPropertyRow({ prop }: { prop: BuildingPropertyValue }) {
  return (
    <div className={styles.row}>
      <span className={styles.name}>{prop.name}</span>
      <span className={styles.value}>{prop.value}</span>
    </div>
  );
});

// =============================================================================
// VALUE RENDERERS
// =============================================================================

interface PropertyValueProps {
  def: PropertyDefinition;
  value: string;
  maxValue?: string;
  canEdit: boolean;
  onPropertyChange: (name: string, value: number) => void;
  onStringPropertyChange?: (name: string, value: string) => void;
  rdoCommands?: Record<string, RdoCommandMapping>;
}

function PropertyValue({ def, value, maxValue, canEdit, onPropertyChange, onStringPropertyChange, rdoCommands }: PropertyValueProps) {
  const num = parseFloat(value);
  const colorKey = getColorClass(num, def.colorCode);
  const colorClass = colorKey ? (styles[colorKey] ?? '') : '';

  switch (def.type) {
    case PropertyType.CURRENCY:
      return <span className={`${styles.value} ${colorClass}`}>{formatCurrency(num)}</span>;

    case PropertyType.PERCENTAGE:
      return <span className={`${styles.value} ${colorClass}`}>{formatPercentage(num)}</span>;

    case PropertyType.NUMBER:
      return (
        <span className={`${styles.value} ${colorClass}`}>
          {isNaN(num) ? value : formatNumber(num, def.unit)}
        </span>
      );

    case PropertyType.RATIO:
      return <RatioValue current={num} max={maxValue ? parseFloat(maxValue) : 0} />;

    case PropertyType.ENUM: {
      const label = def.enumLabels?.[value] ?? def.enumLabels?.[String(parseInt(value, 10))] ?? value;
      return <span className={styles.value}>{label}</span>;
    }

    case PropertyType.BOOLEAN:
      return <BooleanValue value={value} canEdit={canEdit && !!def.editable} rdoName={def.rdoName} onPropertyChange={onPropertyChange} />;

    case PropertyType.SLIDER:
      if (canEdit && def.editable) {
        return (
          <SliderInput
            value={num}
            min={def.min ?? 0}
            max={def.max ?? 300}
            step={def.step ?? 5}
            unit={def.unit}
            rdoName={def.rdoName}
            pendingKey={computePendingKey(def.rdoName, rdoCommands)}
            onPropertyChange={onPropertyChange}
          />
        );
      }
      return <span className={styles.value}>{isNaN(num) ? value : `${num}${def.unit ?? ''}`}</span>;

    case PropertyType.TEXT:
      if (canEdit && def.editable && onStringPropertyChange) {
        return (
          <TextInput
            value={value}
            rdoName={def.rdoName}
            pendingKey={computePendingKey(def.rdoName, rdoCommands)}
            onStringPropertyChange={onStringPropertyChange}
          />
        );
      }
      return <span className={styles.value}>{value || '-'}</span>;

    default:
      return <span className={styles.value}>{value || '-'}</span>;
  }
}
