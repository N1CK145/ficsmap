# Belt and rail route planner (3D) - design spike

Date: 2026-11-28. Status: design only, nothing built. agenttodo: ficsmap #134 and its subtasks.

## Goal

A player picks a start and a destination on the map (a miner and a factory, two train stations) and gets a route for a
conveyor belt or a railway: its length, its height profile, where it needs lifts, supports or bridges, where it hits
terrain, and the way through caves and under rock arches where that is shorter. The route is a guide to build in the
game, not a blueprint the game can load.

Out of scope: pipes and hypertubes (later, same machinery), vehicles on roads (the vehicle calculator covers them with the
straight line), anything written into a save.

## What ficsmap already has

| Data | Where | Use for routing |
| --- | --- | --- |
| Height grid, highest solid surface (`top.f32`) and the landscape alone (`landscape.f32`), 2 m cells, whole map (3750 x 3750) | extractor `--heightmap-out`; served as `height/` tiles (top only, 500 m tiles, int16 in `step` cm) | 2.5D terrain: ground height and slope along a route |
| Cave volumes, sampled cave floors, outlines and entrances | `caves.json`, `scripts/cave-geometry.ts`, `caves.geojson` | where caves are, their floors (per 1 m cell, every surface a vertical ray passes: `sampleColumns`), entrances as portals |
| Cave geometry, full (389 MB) and simplified (`cave-models/`, 31 MB) | extractor `--cave-geometry-out`; dataset part `cave-models` | 3D view of a route through a cave; collision checks inside cave boxes |
| Factory snapshot of the shown save: building footprints, belt/pipe/rail splines as 3D polylines, stations | `src/shared/factory/*`, per world | existing factory as obstacles; existing stations as start/destination |
| Belt speeds (`mSpeed`), mesh lengths (belt 2 m, rail 12 m, lift 2 m) | game Docs (`CommunityResources/Docs`) | throughput per tier; nothing about placement limits |
| Straight route A-B with heights | `src/shared/vehicleRoute.ts`, the vehicle calculator's pick mode | the starting point of the planner's UI; the calculator wants a real rail length later |
| 3D viewer (three.js, lazy chunk) | `src/web/features/caves/CaveViewer3d.tsx` | base for a 3D view of a route |

Missing: the **placement limits** of belts, lifts and rails (longest spline segment, steepest slope, tightest bend, highest
lift, rail turn radius and grade, clearance). They are not in the Docs; they sit in the hologram classes
(`FGConveyorBeltHologram`, `FGConveyorLiftHologram`, `FGRailroadTrackHologram` and their blueprints). Values quoted in the
community (belt segment 56 m, lift 48 m, rail segment 100 m) are **unverified** and must come from the game files and a
check in the game before the planner relies on them.

## The hard part: terrain is not a height field

A height field holds one height per cell. Arches (rock bridges over open ground) and caves (floors under rock and under the
landscape) need several. Options:

1. **2.5D on `top.f32` only.** Routes run over the highest surface. Easy and already served, but an arch becomes a wall
   (the route climbs over it) and a cave does not exist. Good enough for most routes in the open.
2. **Layered columns.** Per 2 m cell a short list of free-air intervals `[floor, ceiling]` (most cells: one, open sky;
   under an arch: two; in a cave: two or more). This is what `sampleColumns` in `scripts/cave-geometry.ts` already
   computes inside cave boxes (every surface a vertical ray passes, facing up or down). For the whole map it has to come
   from the extractor pass that writes `top.f32` (it already rasterizes every mesh), as tiles like `height/`. Estimate:
   about 14 million cells, most with one interval; with a 1-interval fast path (just `top`, which exists) only cells with
   two or more intervals need extra data - a few percent of the map, likely a few MB gzip. Must be measured.
3. **Voxels.** 2 m voxels over the map and 700 m of height: far too large, even sparse.
4. **Ray casts against meshes in the browser.** Needs the world geometry in the browser; the simplified caves alone are
   31 MB, the whole map would be several times that. Only viable for a small region view.

**Recommendation: 2, introduced in steps.** Start with 1 (open terrain), add the cave columns that the dataset build
already samples (caves), then the world-wide multi-interval cells from the extractor (arches). Each step is useful alone.

## Routing model

The planner works on a 2D grid of 2 m cells with a height per state, in a Web Worker (like `save.worker.ts`), on the
height tiles and layer tiles along a corridor around the straight line A-B (fetched on demand, as the coordinate readout
does).

**Belts.** In the game a belt is a chain of spline segments between poles, wall or ceiling mounts, foundations or lifts;
it may hang in the air at any height the supports reach. For planning, a belt route is a polyline of segments, each at
most the longest segment, no steeper than the slope limit, and turns no tighter than the bend limit; vertical steps become
lifts (at most the lift height). Two ways in:

- *Check a route the player draws* (waypoints on the map, heights from the terrain plus a chosen clearance): split into
  legal segments, insert lifts, flag terrain hits, give totals (length, segments, supports, lifts, build cost per tier).
  Cheap and always useful; the first thing to build.
- *Auto-route*: A* over (cell, layer, height band) with costs for length, climbing, supports (height above ground) and
  terrain clearance; then the same splitting as above. Heuristic: 3D straight-line distance.

**Rails.** Much stiffer: a minimum turn radius, a maximum grade, no vertical steps. Route search is a hybrid A* with
states (x, y, heading in 16-32 steps, height) and motion primitives (straight pieces and arcs at or above the minimum
radius, grade steps within the limit), as in car path planning. Terrain hits become bridges (pillars) or tunnels; whether
the game lets rails clip through rock is unverified, so hits are costs and warnings, not forbidden. The result's length is
the real rail length, which the vehicle calculator can take instead of the straight line.

**Caves and arches.** With layered columns a route may use any free interval with enough clearance (belt height or train
profile, from the game files). Cave entrances from `caves.geojson` are portals for the heuristic, so the search finds a way
in. A route that enters a cave shows it on the map (dashed, "underground") and in the height profile.

**The existing factory** (optional, per world): building footprints and splines of the shown snapshot as obstacles with a
clearance, so a route does not run through a factory. Snapshots are per world and already loaded in the browser for the
factory map.

## UI

- A map mode like the vehicle calculator's pick mode: start and destination (on the map, on a building of the factory map,
  or on a train station), then waypoints to drag. Belt or rail, tier, clearance.
- The route on the map as a line coloured by problem (too steep, too long, terrain hit, underground), with markers for
  lifts and supports.
- Below the map (on phones a sheet): the height profile (terrain top, landscape, cave floors, the route), the totals and
  the list of problems.
- "Show in 3D": a region view built on the cave viewer: terrain from the height tiles as a mesh, the cave models in
  range, the route as a tube.
- "Use in vehicle calculator" for a rail route (real length).

## Feasibility

Feasible in steps; the first steps need no new game data beyond the placement limits.

Risks:

1. **Placement limits** must be read from hologram classes (extractor patch) and checked in the game; without them the
   planner guesses. First subtask.
2. **Layered columns for the whole map**: extraction memory (the cave geometry pass needed 10 GB) and data size are
   unknown until measured; the planner works without them (2.5D plus caves).
3. **The game's spline rules** (how belts and rails actually bend, snapping to foundations) are richer than a polyline;
   the planner gives a guide, not a buildable blueprint. Say so in the UI.
4. **Not in the data**: foliage and trees (left out of every geometry export), creature nests, water depth. Routes may hit
   trees; a note in the UI.
5. **Phones**: the worker search must stay bounded (corridor size, node limit); the 3D region view needs a triangle budget
   like the cave models.

## Decomposition

Sub-tasks of #134 in agenttodo, each at most 4 hours, roughly in this order:

1. Read belt, lift and rail placement limits from the game files (extractor patch) into the dataset, checked in the game.
2. Height profile along a polyline (pure, on height tiles: top, landscape, cave floors).
3. Planner map mode: pick start, destination and waypoints, draw the line and the profile.
4. Belt route check: split a drawn route into legal segments and lifts, problems, totals and cost.
5. Belt auto-route (2.5D, A* in a worker).
6. Rail route check: curves, grades, length; hand the length to the vehicle calculator.
7. Rail auto-route (hybrid A* with arc primitives in a worker).
8. Layered columns, part 1: cave columns as a dataset part (format, tiles, loader).
9. Layered columns, part 2: world-wide multi-interval cells from the extractor (arches), with size and memory measured.
10. Routing through caves and under arches on the layered columns, with entrances as portals.
11. The shown snapshot's factory as obstacles.
12. 3D region view of a route (terrain mesh, cave models in range, route tube).
