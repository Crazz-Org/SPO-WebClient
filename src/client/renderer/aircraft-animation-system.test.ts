import { describe, it, expect, jest } from '@jest/globals';
import {
  AircraftAnimationSystem,
  AIRCRAFT_CLASSES,
  MAX_VIEW_PLANES,
  BLOCKS_TO_MOVE_INCREMENT,
  SPAWN_INTERVAL_S,
  SPAWN_MARGIN_TILES,
} from './aircraft-animation-system';
import type { TileBounds } from '../../shared/map-config';

const BOUNDS: TileBounds = { minI: 100, maxI: 120, minJ: 200, maxJ: 220 };

function makeCtx(): CanvasRenderingContext2D {
  return {
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    rotate: jest.fn(),
    beginPath: jest.fn(),
    ellipse: jest.fn(),
    arc: jest.fn(),
    rect: jest.fn(),
    fillRect: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

/** mapToScreen that always places tiles inside an 800x600 canvas. */
function centeredMapToScreen(i: number, j: number): { x: number; y: number } {
  return { x: 400 + (j - 210) * 10, y: 300 + (i - 110) * 10 };
}

/** mapToScreen that places every tile far off-canvas. */
function offscreenMapToScreen(): { x: number; y: number } {
  return { x: -5000, y: -5000 };
}

function cycleRandom(values: number[]): () => number {
  let idx = 0;
  return () => {
    const v = values[idx % values.length];
    idx++;
    return v;
  };
}

describe('AircraftAnimationSystem — disabled', () => {
  it('spawns nothing and draws nothing when off', () => {
    const system = new AircraftAnimationSystem();
    system.setEnabled(false);

    for (let i = 0; i < 50; i++) {
      system.update(0.1, BOUNDS);
    }
    expect(system.getAircraftCount()).toBe(0);

    const ctx = makeCtx();
    system.render(ctx, centeredMapToScreen, { level: 2, u: 16, tileWidth: 32, tileHeight: 16 }, 800, 600);
    expect(ctx.beginPath).not.toHaveBeenCalled();
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('setEnabled(false) empties an existing population', () => {
    const system = new AircraftAnimationSystem();
    system.setRandomSource(() => 0.01);
    system.update(1, BOUNDS);
    expect(system.getAircraftCount()).toBeGreaterThan(0);

    system.setEnabled(false);
    expect(system.getAircraftCount()).toBe(0);
    expect(system.isActive()).toBe(false);
  });
});

describe('AircraftAnimationSystem — enabled spawning', () => {
  it('spawns on the first update (bounds change triggers an attempt)', () => {
    const system = new AircraftAnimationSystem();
    system.setRandomSource(() => 0.01);
    system.update(0.016, BOUNDS);
    expect(system.getAircraftCount()).toBe(1);
  });

  it('spawns more over successive bounds changes, never exceeding MAX_VIEW_PLANES', () => {
    const system = new AircraftAnimationSystem();
    system.setRandomSource(() => 0.01);

    // A changed bounds key forces an immediate spawn attempt regardless of
    // cooldown — use a fresh bounds each call so the cap, not the cooldown
    // timer, is what this test exercises.
    for (let i = 0; i < MAX_VIEW_PLANES + 3; i++) {
      const bounds: TileBounds = { ...BOUNDS, minJ: BOUNDS.minJ + i };
      system.update(0.001, bounds);
      expect(system.getAircraftCount()).toBeLessThanOrEqual(MAX_VIEW_PLANES);
    }
    expect(system.getAircraftCount()).toBe(MAX_VIEW_PLANES);
  });

  it('does not attempt a spawn again before the cooldown elapses on unchanged bounds', () => {
    const system = new AircraftAnimationSystem();
    system.setRandomSource(() => 0.01);
    system.update(0.016, BOUNDS); // spawns 1 (bounds change)
    system.update(0.016, BOUNDS); // same bounds, cooldown not elapsed
    expect(system.getAircraftCount()).toBe(1);
  });

  it('attempts a new spawn once SPAWN_INTERVAL_S elapses on unchanged bounds', () => {
    const system = new AircraftAnimationSystem();
    system.setRandomSource(() => 0.01);
    system.update(0.016, BOUNDS); // spawns 1 (bounds change)
    expect(system.getAircraftCount()).toBe(1);

    // deltaTime is clamped to MAX_DELTA_TIME (0.1s) internally, so simulating
    // SPAWN_INTERVAL_S of cooldown takes SPAWN_INTERVAL_S / 0.1 update calls.
    const steps = Math.ceil(SPAWN_INTERVAL_S / 0.1) + 1;
    for (let i = 0; i < steps; i++) {
      system.update(1, BOUNDS);
    }
    expect(system.getAircraftCount()).toBe(2);
  });
});

describe('AircraftAnimationSystem — spawn geometry', () => {
  it('spawns SPAWN_MARGIN_TILES outside the bounds and heads into the viewport, for all four sides', () => {
    for (let side = 0; side < 4; side++) {
      const system = new AircraftAnimationSystem();
      // side selector first, then heading pick, then side-specific position roll, then class pick
      system.setRandomSource(cycleRandom([side / 4 + 0.01, 0, 0.5, 0]));
      system.update(0.016, BOUNDS);
      expect(system.getAircraftCount()).toBe(1);

      const plane = system.getAircraft()[0];
      let outside = false;
      if (side === 0) outside = plane.row <= BOUNDS.minI - SPAWN_MARGIN_TILES + 0.001;
      if (side === 1) outside = plane.row >= BOUNDS.maxI + SPAWN_MARGIN_TILES - 0.001;
      if (side === 2) outside = plane.col <= BOUNDS.minJ - SPAWN_MARGIN_TILES + 0.001;
      if (side === 3) outside = plane.col >= BOUNDS.maxJ + SPAWN_MARGIN_TILES - 0.001;
      expect(outside).toBe(true);
      expect(plane.isVisible).toBe(false);

      // Advance it by hand until it crosses into the viewport.
      for (let step = 0; step < 2000 && !plane.isVisible; step++) {
        system.update(1, BOUNDS);
      }
      expect(system.getAircraft()[0]?.isVisible ?? true).toBe(true);
    }
  });
});

describe('AircraftAnimationSystem — culling', () => {
  it('culls aircraft whose screen position lies outside the viewport', () => {
    const system = new AircraftAnimationSystem();
    system.setRandomSource(() => 0.01);
    system.update(0.016, BOUNDS);

    const ctx = makeCtx();
    system.render(ctx, offscreenMapToScreen, { level: 2, u: 16, tileWidth: 32, tileHeight: 16 }, 800, 600);
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('draws aircraft whose screen position lies inside the viewport', () => {
    const system = new AircraftAnimationSystem();
    system.setRandomSource(() => 0.01);
    system.update(0.016, BOUNDS);

    const ctx = makeCtx();
    system.render(ctx, centeredMapToScreen, { level: 2, u: 16, tileWidth: 32, tileHeight: 16 }, 800, 600);
    expect(ctx.fill).toHaveBeenCalled();
  });
});

describe('AircraftAnimationSystem — every kind draws', () => {
  it('draws each class kind, rotating airship/helicopter but not balloon/saucer', () => {
    for (const cls of AIRCRAFT_CLASSES) {
      const system = new AircraftAnimationSystem();
      // Force this exact class: roll enough to land past every prior class's weight.
      const totalBefore = AIRCRAFT_CLASSES.slice(0, AIRCRAFT_CLASSES.indexOf(cls)).reduce((s, c) => s + c.prob, 0);
      const totalWeight = AIRCRAFT_CLASSES.reduce((s, c) => s + c.prob, 0);
      const roll = Math.min(0.999, (totalBefore + cls.prob * 0.5) / totalWeight);
      system.setRandomSource(cycleRandom([0.01, 0, 0, roll]));
      system.update(0.016, BOUNDS);
      expect(system.getAircraft()[0]?.classId).toBe(cls.id);

      const ctx = makeCtx();
      system.render(ctx, centeredMapToScreen, { level: 2, u: 16, tileWidth: 32, tileHeight: 16 }, 800, 600);
      expect(ctx.fill).toHaveBeenCalled();

      if (cls.kind === 'airship' || cls.kind === 'helicopter') {
        expect(ctx.rotate).toHaveBeenCalled();
      } else {
        expect(ctx.rotate).not.toHaveBeenCalled();
      }
    }
  });
});

describe('AircraftAnimationSystem — lifetime', () => {
  it('removes an aircraft whose lifetime expires off-screen', () => {
    const system = new AircraftAnimationSystem();
    // classRoll = 0 always selects id 0 (Zeppelin, speed 1).
    system.setRandomSource(cycleRandom([0.01, 0, 0.5, 0]));
    system.update(0.016, BOUNDS);
    expect(system.getAircraftCount()).toBe(1);

    const plane = system.getAircraft()[0];
    // Force it far outside the viewport, one tile of progress from expiring.
    (plane as { row: number }).row = BOUNDS.minI - 500;
    (plane as { blocksRemaining: number }).blocksRemaining = 1;
    (plane as { progress: number }).progress = 0.99;

    system.update(1, BOUNDS); // deltaTime is clamped to MAX_DELTA_TIME internally
    expect(system.getAircraftCount()).toBe(0);
  });

  it('extends lifetime by BLOCKS_TO_MOVE_INCREMENT while visible', () => {
    const system = new AircraftAnimationSystem();
    system.setRandomSource(cycleRandom([0.01, 0, 0.5, 0]));
    system.update(0.016, BOUNDS);
    const plane = system.getAircraft()[0];
    // Force it into the viewport, one tile of progress from expiring.
    (plane as { col: number }).col = (BOUNDS.minJ + BOUNDS.maxJ) / 2;
    (plane as { row: number }).row = (BOUNDS.minI + BOUNDS.maxI) / 2;
    (plane as { blocksRemaining: number }).blocksRemaining = 1;
    (plane as { progress: number }).progress = 0.99;

    system.update(1, BOUNDS);
    expect(system.getAircraftCount()).toBe(1);
    const after = system.getAircraft()[0];
    expect(after.isVisible).toBe(true);
    expect(after.blocksRemaining).toBe(BLOCKS_TO_MOVE_INCREMENT);
  });
});

describe('AircraftAnimationSystem — misc', () => {
  it('clear() empties the population and resets cooldown/bounds key', () => {
    const system = new AircraftAnimationSystem();
    system.setRandomSource(() => 0.01);
    system.update(0.016, BOUNDS);
    expect(system.getAircraftCount()).toBe(1);

    system.clear();
    expect(system.getAircraftCount()).toBe(0);

    // Next update on the same bounds should attempt a spawn again (bounds key was reset).
    system.update(0.016, BOUNDS);
    expect(system.getAircraftCount()).toBe(1);
  });

  it('clamps deltaTime so a 5s step moves at most MAX_DELTA_TIME worth', () => {
    const system = new AircraftAnimationSystem();
    system.setRandomSource(() => 0.01);
    system.update(0.001, BOUNDS);
    const before = { ...system.getAircraft()[0] };

    system.update(5, BOUNDS);
    const after = system.getAircraft()[0];

    const cls = AIRCRAFT_CLASSES.find((c) => c.id === before.classId)!;
    const maxDelta = cls.speed * 0.1 + 1e-9;
    expect(Math.abs(after.col - before.col)).toBeLessThanOrEqual(maxDelta);
    expect(Math.abs(after.row - before.row)).toBeLessThanOrEqual(maxDelta);
  });

  it('isActive() truth table', () => {
    const system = new AircraftAnimationSystem();
    expect(system.isActive()).toBe(false); // no aircraft yet

    system.setRandomSource(() => 0.01);
    system.update(0.016, BOUNDS);
    expect(system.isActive()).toBe(true); // enabled + has aircraft

    system.setEnabled(false);
    expect(system.isActive()).toBe(false); // disabled

    system.setEnabled(true);
    expect(system.isActive()).toBe(false); // enabled but empty again
  });

  it('setTimeSource overrides the clock used for the helicopter rotor animation', () => {
    const system = new AircraftAnimationSystem();
    let now = 0;
    system.setTimeSource(() => now);
    // Force the helicopter class (id 1).
    system.setRandomSource(cycleRandom([0.01, 0, 0, 0.5]));
    system.update(0.016, BOUNDS);
    expect(system.getAircraft()[0].classId).toBe(1);

    now = 12345;
    const ctx = makeCtx();
    system.render(ctx, centeredMapToScreen, { level: 2, u: 16, tileWidth: 32, tileHeight: 16 }, 800, 600);
    expect(ctx.rotate).toHaveBeenCalled();
  });
});
