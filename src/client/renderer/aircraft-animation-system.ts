/**
 * Aircraft Animation System
 *
 * Flies procedural aircraft silhouettes across the map — a zeppelin, an ad
 * helicopter, two balloons and a rare flying saucer, matching the legacy
 * Voyager client (Aircraft.pas). No sprite assets exist for these classes
 * (see plan-594's asset survey), so each kind is drawn with Canvas 2D
 * primitives instead of a texture.
 *
 * Performance guarantees, mirroring vehicle-animation-system.ts:
 * - Active only at Z2/Z3 (zero cost at Z0/Z1, enforced by the caller)
 * - Max MAX_VIEW_PLANES aircraft rendered per frame
 * - Viewport culling: only visible aircraft are drawn
 * - deltaTime-based animation (frame-rate independent)
 * - update()/render() return immediately when disabled — no allocation, no loop
 */

import { TileBounds, ZoomConfig } from '../../shared/map-config';

// =============================================================================
// TYPES
// =============================================================================

export type AircraftKind = 'airship' | 'helicopter' | 'balloon' | 'saucer';

export interface AircraftClass {
  id: number;
  name: string;
  prob: number;
  speed: number; // tiles per second
  kind: AircraftKind;
}

export interface AnimatedAircraft {
  id: number;
  classId: number;
  col: number; // fractional tile coordinate (j)
  row: number; // fractional tile coordinate (i)
  dCol: number; // heading component, -1/0/1
  dRow: number; // heading component, -1/0/1
  progress: number; // tiles travelled since the last block was counted
  blocksRemaining: number;
  alive: boolean;
  isVisible: boolean;
}

// =============================================================================
// CONSTANTS (matching Delphi Aircraft.pas)
// =============================================================================

/** Max aircraft in viewport (Delphi: cMaxPlanes = 5, Aircraft.pas:1044) — the frame-budget cap. */
export const MAX_VIEW_PLANES = 5;

/** Initial blocks an aircraft can travel (Delphi: cBlocksToMove = 32, Aircraft.pas:1045) */
export const BLOCKS_TO_MOVE_INITIAL = 32;

/** Blocks added when lifetime is extended (Delphi: cBlocksInc = 32, ReprogramPlane, Aircraft.pas:182) */
export const BLOCKS_TO_MOVE_INCREMENT = 32;

/**
 * Seconds between spawn attempts (Delphi: cAirTrafficRegInterval = 20000 div
 * cPlanesTimerInterval, i.e. one air-traffic regulation pass every 20s, Aircraft.pas:130)
 */
export const SPAWN_INTERVAL_S = 20;

/** Spawn margin in tiles outside the viewport (Delphi: imin-8/imax+8/jmin-8/jmax+8, Aircraft.pas:1052-1062) */
export const SPAWN_MARGIN_TILES = 8;

/**
 * Altitude, in zoom units (`zoomConfig.u`), the silhouette is drawn above its
 * ground point — a WebClient choice, not a legacy value: the shadow is drawn
 * at the ground point itself.
 */
export const ALTITUDE_U = 4;

/** Cap deltaTime to prevent huge jumps after a tab switch (same guard as the vehicle system). */
export const MAX_DELTA_TIME = 0.1;

/**
 * Class table (probability, speed, kind) — a constant since no sprite pack
 * exists to load from an INI at runtime. Each entry cites the surviving
 * cache/PlaneClasses/*.ini it comes from. `speed` derives from the legacy
 * `fFramesPerBlock = round(cPlaneFramesPerSec / PlaneClass.Speed)` at 16fps,
 * i.e. `Speed` blocks (tiles) per second.
 */
export const AIRCRAFT_CLASSES: ReadonlyArray<AircraftClass> = [
  { id: 0, name: 'Zeppelin', prob: 1, speed: 1, kind: 'airship' },      // cache/PlaneClasses/Zeppelin.ini
  { id: 1, name: 'Adchopper', prob: 0.5, speed: 0.5, kind: 'helicopter' }, // cache/PlaneClasses/Adchopper.ini
  { id: 2, name: 'Balloon1', prob: 0.3, speed: 0.5, kind: 'balloon' },  // cache/PlaneClasses/Balloon1.ini
  { id: 3, name: 'Balloon2', prob: 0.3, speed: 0.5, kind: 'balloon' },  // cache/PlaneClasses/Balloon2.ini
  { id: 5, name: 'Saucer', prob: 0.05, speed: 7, kind: 'saucer' },      // cache/PlaneClasses/saucer.ini
];

const TOTAL_PROB_WEIGHT = AIRCRAFT_CLASSES.reduce((sum, c) => sum + c.prob, 0);

/** Headings offered per spawn side (legacy GetNorthAngle -> agNW/agN/agNE and their mirrors). */
const SIDE_HEADINGS: Record<number, ReadonlyArray<{ dRow: number; dCol: number }>> = {
  0: [{ dRow: 1, dCol: 0 }, { dRow: 1, dCol: 1 }, { dRow: 1, dCol: -1 }],   // north edge -> heading south into view
  1: [{ dRow: -1, dCol: 0 }, { dRow: -1, dCol: 1 }, { dRow: -1, dCol: -1 }], // south edge -> heading north
  2: [{ dRow: 0, dCol: 1 }, { dRow: 1, dCol: 1 }, { dRow: -1, dCol: 1 }],    // west edge -> heading east
  3: [{ dRow: 0, dCol: -1 }, { dRow: 1, dCol: -1 }, { dRow: -1, dCol: -1 }], // east edge -> heading west
};

function pickWeightedClass(random: () => number): AircraftClass {
  let roll = random() * TOTAL_PROB_WEIGHT;
  for (const cls of AIRCRAFT_CLASSES) {
    roll -= cls.prob;
    if (roll <= 0) return cls;
  }
  return AIRCRAFT_CLASSES[AIRCRAFT_CLASSES.length - 1];
}

// =============================================================================
// AIRCRAFT ANIMATION SYSTEM
// =============================================================================

export class AircraftAnimationSystem {
  private aircraft: AnimatedAircraft[] = [];
  private nextAircraftId: number = 0;
  private enabled: boolean = true;
  private spawnCooldownRemaining: number = 0;
  private lastBoundsKey: string = '';

  private getNow: () => number = () => performance.now();
  private random: () => number = () => Math.random();

  // ==========================================================================
  // CONFIGURATION
  // ==========================================================================

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.aircraft = [];
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isActive(): boolean {
    return this.enabled && this.aircraft.length > 0;
  }

  getAircraftCount(): number {
    return this.aircraft.length;
  }

  /** Snapshot of aircraft (for testing). */
  getAircraft(): ReadonlyArray<Readonly<AnimatedAircraft>> {
    return this.aircraft;
  }

  clear(): void {
    this.aircraft = [];
    this.spawnCooldownRemaining = 0;
    this.lastBoundsKey = '';
  }

  /** Override the time source (for deterministic tests). */
  setTimeSource(getNow: () => number): void {
    this.getNow = getNow;
  }

  /** Override the random source (for deterministic tests). */
  setRandomSource(random: () => number): void {
    this.random = random;
  }

  // ==========================================================================
  // UPDATE (called every frame)
  // ==========================================================================

  update(deltaTime: number, bounds: TileBounds): void {
    if (!this.enabled) return;

    const dt = Math.min(deltaTime, MAX_DELTA_TIME);

    for (const plane of this.aircraft) {
      this.updateAircraft(plane, dt, bounds);
    }

    this.aircraft = this.aircraft.filter((p) => p.alive);

    const boundsKey = `${bounds.minI},${bounds.maxI},${bounds.minJ},${bounds.maxJ}`;
    const boundsChanged = this.lastBoundsKey !== boundsKey;
    if (boundsChanged) {
      this.lastBoundsKey = boundsKey;
    }

    this.spawnCooldownRemaining -= dt;
    if (boundsChanged || this.spawnCooldownRemaining <= 0) {
      this.spawnCooldownRemaining = SPAWN_INTERVAL_S;
      this.trySpawn(bounds);
    }
  }

  private updateAircraft(plane: AnimatedAircraft, dt: number, bounds: TileBounds): void {
    const cls = AIRCRAFT_CLASSES.find((c) => c.id === plane.classId);
    const speed = cls?.speed ?? 1;

    plane.col += plane.dCol * speed * dt;
    plane.row += plane.dRow * speed * dt;

    const distance = speed * dt;
    plane.progress += distance;
    while (plane.progress >= 1) {
      plane.progress -= 1;
      plane.blocksRemaining -= 1;
    }

    plane.isVisible =
      plane.col >= bounds.minJ && plane.col <= bounds.maxJ &&
      plane.row >= bounds.minI && plane.row <= bounds.maxI;

    if (plane.blocksRemaining <= 0) {
      if (plane.isVisible) {
        plane.blocksRemaining += BLOCKS_TO_MOVE_INCREMENT;
      } else {
        plane.alive = false;
      }
    }
  }

  // ==========================================================================
  // SPAWNING
  // ==========================================================================

  private trySpawn(bounds: TileBounds): void {
    if (this.aircraft.length >= MAX_VIEW_PLANES) return;

    const side = Math.floor(this.random() * 4);
    const headings = SIDE_HEADINGS[side];
    const heading = headings[Math.floor(this.random() * headings.length)];

    let col: number;
    let row: number;
    switch (side) {
      case 0: // north edge, heading south
        col = bounds.minJ + this.random() * (bounds.maxJ - bounds.minJ);
        row = bounds.minI - SPAWN_MARGIN_TILES;
        break;
      case 1: // south edge, heading north
        col = bounds.minJ + this.random() * (bounds.maxJ - bounds.minJ);
        row = bounds.maxI + SPAWN_MARGIN_TILES;
        break;
      case 2: // west edge, heading east
        col = bounds.minJ - SPAWN_MARGIN_TILES;
        row = bounds.minI + this.random() * (bounds.maxI - bounds.minI);
        break;
      default: // east edge, heading west
        col = bounds.maxJ + SPAWN_MARGIN_TILES;
        row = bounds.minI + this.random() * (bounds.maxI - bounds.minI);
        break;
    }

    const cls = pickWeightedClass(this.random);

    const plane: AnimatedAircraft = {
      id: this.nextAircraftId++,
      classId: cls.id,
      col,
      row,
      dCol: heading.dCol,
      dRow: heading.dRow,
      progress: 0,
      blocksRemaining: BLOCKS_TO_MOVE_INITIAL,
      alive: true,
      isVisible: false,
    };
    this.aircraft.push(plane);
  }

  // ==========================================================================
  // RENDER (called every frame after update)
  // ==========================================================================

  render(
    ctx: CanvasRenderingContext2D,
    mapToScreen: (i: number, j: number) => { x: number; y: number },
    zoomConfig: ZoomConfig,
    canvasWidth: number,
    canvasHeight: number
  ): void {
    if (!this.enabled || this.aircraft.length === 0) return;

    const scale = zoomConfig.u / 16;
    const u = zoomConfig.u;

    for (const plane of this.aircraft) {
      const ground = mapToScreen(plane.row, plane.col);

      const halfWidth = 20 * scale;
      const top = ground.y - ALTITUDE_U * u - 16 * scale;
      const bottom = ground.y;
      if (
        ground.x + halfWidth < 0 || ground.x - halfWidth > canvasWidth ||
        bottom < 0 || top > canvasHeight
      ) {
        continue;
      }

      const cls = AIRCRAFT_CLASSES.find((c) => c.id === plane.classId);
      const kind = cls?.kind ?? 'airship';
      const heading = Math.atan2(
        mapToScreen(plane.row + plane.dRow, plane.col + plane.dCol).y - ground.y,
        mapToScreen(plane.row + plane.dRow, plane.col + plane.dCol).x - ground.x
      );

      this.drawShadow(ctx, ground.x, ground.y, scale);
      this.drawBody(ctx, kind, ground.x, ground.y - ALTITUDE_U * u, scale, heading);
    }
  }

  private drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y, 12 * scale, 4 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawBody(
    ctx: CanvasRenderingContext2D,
    kind: AircraftKind,
    x: number,
    y: number,
    scale: number,
    heading: number
  ): void {
    ctx.save();
    ctx.translate(x, y);

    switch (kind) {
      case 'airship':
        ctx.rotate(heading);
        ctx.fillStyle = '#c0c0c8';
        ctx.strokeStyle = '#404048';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, 16 * scale, 5 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#303038';
        ctx.beginPath();
        ctx.rect(-6 * scale, 4 * scale, 12 * scale, 4 * scale);
        ctx.fill();
        break;
      case 'helicopter': {
        ctx.rotate(heading);
        ctx.fillStyle = '#886644';
        ctx.beginPath();
        ctx.ellipse(0, 0, 8 * scale, 4 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#443322';
        ctx.beginPath();
        ctx.moveTo(-8 * scale, 0);
        ctx.lineTo(-16 * scale, 0);
        ctx.stroke();
        const rotorAngle = this.getNow() / 100;
        ctx.beginPath();
        ctx.moveTo(-10 * scale * Math.cos(rotorAngle), -10 * scale * Math.sin(rotorAngle));
        ctx.lineTo(10 * scale * Math.cos(rotorAngle), 10 * scale * Math.sin(rotorAngle));
        ctx.stroke();
        break;
      }
      case 'balloon':
        ctx.fillStyle = '#cc4444';
        ctx.strokeStyle = '#662222';
        ctx.beginPath();
        ctx.arc(0, 0, 9 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#553311';
        ctx.beginPath();
        ctx.rect(-3 * scale, 9 * scale, 6 * scale, 4 * scale);
        ctx.fill();
        break;
      case 'saucer':
        ctx.fillStyle = '#88cc88';
        ctx.strokeStyle = '#335533';
        ctx.beginPath();
        ctx.ellipse(0, 0, 12 * scale, 4 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, -3 * scale, 4 * scale, 0, Math.PI * 2);
        ctx.fill();
        break;
    }

    ctx.restore();
  }
}
