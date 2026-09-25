---
name: web-games
description: "TRIGGER: When working on the game loop, the Canvas 2D isometric renderer (src/client/renderer/), or the frame budget. Covers draw-call batching, chunk caching, tab throttling, and SPO-specific renderer traps."
user-invokable: false
disable-model-invocation: false
---

# Isometric Renderer & Frame Budget

The engine is a **hand-written Canvas 2D isometric renderer**. There is no Phaser, PixiJS,
Three.js, Babylon or WebGPU in this project, and no plan to add one — proposals to adopt a
framework are out of scope. `package.json` is the authority.

Renderer modules (`src/client/renderer/`):
`isometric-map-renderer.ts`, `isometric-terrain-renderer.ts`, `concrete-texture-system.ts`,
`road-texture-system.ts`, `car-class-system.ts`, `vehicle-animation-system.ts`.

Full pipeline: [doc/texture-rendering-architecture.md](../../../doc/texture-rendering-architecture.md).

## SPO renderer traps

These are real bugs that have shipped. Check each before touching coordinate code.

| Trap | Detail |
|------|--------|
| **TerrainLoader i/j swap** | `getTextureId(j, i)` — the provider uses `(i, j)` but the loader expects `(x, y)`. Swapping them renders the wrong tiles, with no error. |
| **Concrete tile coordinates** | Stored as `` `${x},${y}` `` (col,row), **not** `` `${i},${j}` `` (row,col). Wrong order silently misplaces concrete. See [doc/concrete_rendering.md](../../../doc/concrete_rendering.md). |
| **ROAD_TYPE `as const`** | The constants are `as const`; annotate local vars as `number` explicitly or type narrowing bites. See [doc/road_rendering_reference.md](../../../doc/road_rendering_reference.md). |
| **Painter's order** | Back-to-front by `i + j`. Any change to iteration order must preserve this or sprites overlap wrongly. |
| **Derived texture caches** | A derived texture is cached per source texture. Every cache field names in its comment the events that clear it, and is cleared wherever its inputs are. |
| **Per-frame / per-tick logs** | A warning in a per-frame or per-tick path fires once, not every frame. |

## Frame budget

16.7 ms at 60 fps. The renderer shares the main thread with React and the WebSocket bridge,
so the realistic draw budget is **under 10 ms**.

Priority order when the budget is blown — measure before assuming:

1. **Chunk cache hit rate** — re-rasterising a static terrain chunk every frame is the
   usual culprit. Cache to an offscreen canvas, invalidate on tile change only.
2. **Draw call count** — batch by texture atlas. Every `drawImage` with a different source
   forces a state change.
3. **Per-frame allocation** — object pooling for vehicles and sprites. GC pauses read as
   stutter, not as slow frames.
4. **Overdraw** — cull to the viewport before sorting, not after.
5. **Offload** — heavy non-draw computation to a Web Worker.

Do not optimise on intuition: profile with the Performance panel and quote real numbers
in the commit message.

## Browser constraints that actually apply here

| Constraint | Handling |
|------------|----------|
| Tab throttling | Pause the loop on `visibilitychange`; do not let RDO keep-alive drift. |
| Audio autoplay policy | AudioContext must be created on a user gesture, then resumed if suspended. |
| Mobile data | Assets ship via the CAB cache pipeline — see [doc/CAB-EXTRACTION.md](../../../doc/CAB-EXTRACTION.md). |
| No local file access | Assets served by the gateway; nothing reads the disk from the client. |

## Anti-patterns

| Do NOT | Instead |
|--------|---------|
| Propose Phaser/PixiJS/Three.js | The engine is bespoke Canvas 2D; work within it |
| Rasterise static chunks every frame | Offscreen canvas + invalidate on change |
| Allocate vectors/objects inside the draw loop | Pool and reuse |
| Run the loop while the tab is hidden | Pause on `visibilitychange` |
| Assume 16.7 ms is yours alone | React and the bridge share the thread |
