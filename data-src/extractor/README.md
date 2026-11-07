# Extractor output (data-src/extractor)

Raw game data for ficsmap, read from the game client's paks. Nothing here is hand-edited.

**Not in the repository:** the extractor output (`<game-version>/`) is game data and git-ignored. Generate it from your own install with the steps below, keep it in this folder or anywhere else, and point `npm run dataset -- --extractor <dir>` at it. This folder only ships this README, the extractor patch and `item-names.json`.

## Provenance

- Tool: [SatisfactoryTools/AssetsExtractor](https://github.com/SatisfactoryTools/AssetsExtractor) `world-extractor-net`, branch `master`, upstream commit `19e3010c781d4250242d4cc68b6c5c8c340fdea0`.
- Local patch: `world-extractor-extras.patch` (git diff against that commit). Adds the optional flags `--extras-out <file>`, `--caves-out <file>`, `--cave-geometry-out <dir>` (see "Caves" below), `--heightmap-out <dir>` (see "Height map" below), `--map-areas-out <dir>` (see "Map areas" below) and `--transport-out <file>` (see "Transport" below), and exports the item icons of the five pickup types (`Desc_Crystal_C`, `Desc_Crystal_mk2_C`, `Desc_Crystal_mk3_C`, `Desc_WAT1_C`, `Desc_WAT2_C`, from each descriptor's `mPersistentBigIcon`) into `map/icons/`; the map markers use them. It also reads the item of each loose item pickup (`collectibles.json` `item`) from the pickup itself: `mPickupItems.Item` is an `FInventoryItem` that the game serializes natively and CUE4Parse skips, so the patch finds that property tag in the export's raw bytes and resolves its first field, the item class (a package index). Upstream guessed the item from the pickup's mesh, the item's conveyor mesh; that was wrong for 43 of the 703 pickups (level pickups often keep another item's mesh; packaged and liquid fuels share one) and failed for 4 (Supercomputer, Rifle Ammo, 2 Medicinal Inhalers). The Steam crash-site guide (maintainer data) agrees: of the 41 crash-site items where it named another item than the old classes, 38 now match (2026-11-07). Apply with `git apply` in the AssetsExtractor checkout.
- Game: Steam install, GameVersion `1.2.5.0` (CL 517554, UE 5.6.1), engine detected as `GAME_UE5_6`. Output folder: `1.2.5.0/` (extracted 2026-11-06). The previous output was from 1.2.4.1 (CL 513885).
- Build and run (.NET 10 SDK needed):

```
cd AssetsExtractor && git checkout 19e3010c781d4250242d4cc68b6c5c8c340fdea0 && git apply <repo>/data-src/extractor/world-extractor-extras.patch
cd world-extractor-net && dotnet build -c Release
O=<repo>/data-src/extractor/1.2.5.0
export DOTNET_GCHeapHardLimit=0x280000000
dotnet run -c Release --no-build -- --install-dir <game install> --out $O/default-world.json \
  --collectibles-out $O/collectibles.json --extras-out $O/extras.json --caves-out $O/caves.json
dotnet run -c Release --no-build -- --install-dir <game install> --out /tmp/default-world.json \
  --cave-geometry-out $O/cave-geometry
dotnet run -c Release --no-build -- --install-dir <game install> --out /tmp/default-world.json \
  --map-out $O/map --heightmap-out $O/heightmap --map-areas-out $O/map-areas --transport-out $O/transport.json
```

Three runs, because everything in one process does not fit in 10 GiB (it ran out of memory in the cave geometry, 2026-11-06). Times on 1.2.5.0: about 3.5 min, 2.5 min (10 GB peak) and 1.5 min (5 GB peak).

Then build the dataset with the game's build number (`Changelist` in `<game install>/Engine/Binaries/Win64/FactoryGameSteam-Win64-Shipping.version`); the import compares it with a save's build:

```
npm run dataset -- --extractor data-src/extractor/1.2.5.0 --data-src <maintainer data-src> --build 517554 --out data/1.2.5.0
```

The cave geometry export needs about 10 GB of memory; cap the .NET heap so a run cannot take the machine down: `DOTNET_GCHeapHardLimit=0x280000000` (10 GiB). An uncapped run reached 24 GB once and was killed. A full run takes about 3 minutes.

- Printed: `Collectibles: 7653 pickups (703 with a known item), 118 drop pods, 2277 creature spawners`, `Map: 968e47122e1f868c (8192px, zoom 0-5, 30 icons)`, `Extras: 118 drop pods, 298 mercer shrines`. Runs in about 25 s. The `usmap` warning is harmless.

## Files in `1.2.4.1/`

- `default-world.json`: the extractor's own `--out` file (upstream, not from the patch). `{gameVersion, resourceNodes, geysers, frackingCores}`, see "Resource nodes".
- `collectibles.json`: `{gameVersion, pickups, dropPods, creatureSpawners}`, entries `{name, class, location:[x,y,z], item?, amount?}`. `name` is the actor name saves use.
- `map/`: `map.json` (world rectangle x -324698.16..425301.84, y -375000..375000; 8192 px, tile 256, zoom 0-5, webp), `tiles/{z}/{x}/{y}.webp`, `icons/`. About 9.9 MB.
- `extras.json`: from the patch. `{dropPods: {[actorName]: {costType, item, amount, power}}, shrines: [{name, attachedTo, location}]}`.
- `caves.json`, `cave-geometry/`: from the patch (`--caves-out`, `--cave-geometry-out`), see "Caves".
- `heightmap/`: from the patch (`--heightmap-out`), see "Height map".
- `map-areas/`: from the patch (`--map-areas-out`), see "Map areas".
- `transport.json`: from the patch (`--transport-out`), see "Transport".

## Class names (pickups and dropPods in `collectibles.json`)

| Collectible | class | count |
|---|---|---|
| Blue Power Slug | `BP_Crystal_C` | 596 |
| Yellow Power Slug | `BP_Crystal_mk2_C` | 389 |
| Purple Power Slug | `BP_Crystal_mk3_C` | 257 |
| Somersloop | `BP_WAT1_C` | 106 |
| Mercer Sphere | `BP_WAT2_C` | 298 |
| Drop pod (hard drive) | `BP_DropPod_C` | 118 |
| Berry bush / nut bush / shroom (not tracked) | `BP_BerryBush_C` 2164, `BP_NutBush_C` 1525, `BP_Shroom_01_C` 1615 | |
| Loose item pickup (not tracked) | `FGItemPickup_Spawnable` | 703 |

- Slug, Somersloop and Mercer Sphere counts equal the wiki counts (checked 2026-11-03 against satisfactory.wiki.gg pages Power_Slug, Somersloop, Mercer_Sphere).
- `BP_MercerShrine_C` does **not** appear in `pickups`. Shrines come only from `extras.json`.
- Pickup actor names: slugs and spheres have names like `BP_Crystal_mk29`, `BP_WAT139` (and, for some, `BP_WAT2_C_UAID_...`), pods `BP_DropPod24_1`.

## Cross-check with a real save

Parsed with `@etothepii/satisfactory-file-parser` 4.1.2 (a co-op host save, GameVersion 1.2.4.1). Aggregates only:

- 100 distinct `BP_Crystal*`, `BP_WAT*`, `BP_DropPod*`, `BP_MercerShrine*` names in `collectables` + `destroyedActorsMap`: 36 blue, 12 yellow, 2 purple, 7 Somersloop, 19 Mercer Sphere, 6 pods, 18 shrines. **All 100 exist** in `collectibles.json` (shrines in `extras.json`). None unmatched.
- All 40 `BP_DropPod_C` objects in the save exist in `collectibles.json`.

## Drop-pod requirements (`extras.json`)

- Source: actor property `mUnlockCost` (struct): `CostType` (enum `EFGDropPodUnlockCostType`: `Item` / `Power` / `None`), `ItemCost {ItemClass, Amount}`, `PowerConsumption`. Item class is the descriptor class name, e.g. `Desc_Rotor_C`.
- **Fixed in the game data, not random per world.** The values are stored per pod actor in the level and the same for every world.
- 29 pods sit in the persistent level, 89 in the world-partition streaming cells (`Persistent_Level/_Generated_/*.umap`). The patch reads both.
- The struct is saved as a delta, so absent fields mean "default". Distribution over 118 pods: `Item` 67, `Power` 23, `CostType` absent (`"None"` in the file) 10, `mUnlockCost` absent entirely 18 (`costType` null, `item null, amount 0, power 0`).
- `CostType` decides which field counts: `Item` needs `amount` of `item`, `Power` needs `power` MW (a leftover item there is ignored), and `None` as well as a missing `mUnlockCost` (the class default) need nothing. The 10 `None` pods still carry leftover values in the fields the game ignores (an item in 6, only power in 4); they need nothing: the wiki's Crash_Site page, satisfactory-calculator and the Steam guide all say "None", and the wiki's table of total pod costs only adds up with this rule. So every pod's requirement comes from the game files; the dataset's `podRequirementsKnown` is true only when every pod has one.
- `location` is not written for pods: for cell actors the root component's RelativeLocation is not the world position. Use the `collectibles.json` location.

## Mercer shrines (`extras.json`)

- 298 `BP_MercerShrine_C` actors, all in the streaming cells (none in the persistent level), exactly one per Mercer Sphere.
- Each shrine's RootComponent is attached to the sphere's mesh: `attachedTo` is the sphere actor name (`BP_WAT2_C_UAID_...`, 298 distinct, all of them found in `collectibles.json` as `BP_WAT2_C`). That is a direct, exact pairing, so no distance matching is needed.
- `location` = parent RelativeLocation + own RelativeLocation, ignoring parent rotation and scale: it is only approximate (can be off by up to about 1000 units). Use the sphere location instead. The offset in the save (112-116 units, about 1.1 m) is consistent with a 100 units = 1 m scale (UE default, centimetres).
- Shrine actor names in the save (`BP_MercerShrine_C_UAID_...`) equal `name` in `extras.json`.

## Power Slug yields

Source: https://satisfactory.wiki.gg/wiki/Power_Slug, accessed 2026-11-03: blue = 1 Power Shard, yellow = 2, purple = 5. Slug counts on that page: 596 blue, 389 yellow, 257 purple (equal to the extracted counts).

## Units

World units are UE centimetres, 100 units = 1 m (UE convention; consistent with the shrine offset above). The map covers 750000 x 750000 units = 7.5 x 7.5 km, confirmed by satisfactory-calculator.com's map bounds (X -324698.83..425301.83, Y -375000..375000, within a centimetre of `map.json`) and the wiki's World page.

## Caves (`caves.json`, `cave-geometry/`)

The game has no "cave" object with an outline or entrances. The cave layer is derived from what it has, in two steps.

**1. Cave volumes (`caves.json`).** `FGAmbientVolume` actors whose `mAmbientSettings` class name contains `Cave` but not `CaveWind` (`AS_CaveLarge_C`, `AS_CaveSmall_C`, `AS_CaveDynamic_C`, `AmbientSettings_Caves_*_C`, `AmbientSettings_Cave_Drips_*_C`, `CaveWaterfall_Rework_Thin_C`), and `FGAtmosphereVolume` actors with `cave` in the actor name (`Atmosphere_SwampCave`, ...). These are the zones in which the game switches to cave sound and fog: rough hand-placed boxes (94 of 188 are a single box) that say where caves are and at what height, but not their shape. Written per convex collision element (`BrushBodySetup.AggGeom.ConvexElems`, transformed with the brush component's location, rotation and scale) as 2D hull in world X/Y plus Z range. Two volumes contain one broken element each (one reaches about 300 m out to sea, one about 396 km up); elements more than 5x their volume's median element on any axis and over 300 m are ignored (`cleanElements`; the extractor groups and boxes the volumes with the same rule). Smaller outliers are real: a hall drawn as one big box next to a few small ones (cave-059's main element is about 190 x 200 m, cave-057 has one of 120 x 180 m).

**2. Cave geometry (`cave-geometry/`).** Overlapping volumes (within 10 m) are grouped into caves (73). A group can hold several separate caves (cave-030 spans three caves of the satisfactory-calculator.com map, cave-027 three separate clusters of volumes); the sampling handles each cluster of volumes on its own where it matters (entrances, fallbacks). For each cave, everything solid in its box (volumes' bounds grown by 30 m sideways, 30 m down, 60 m up) is written as one glTF 2.0 binary, `<id>.glb`, plus `index.json` (id, file, box in UE cm, volume names, instance and triangle counts):

- every `StaticMeshComponent` (first LOD of the render mesh; the mesh from the component's template if the instance has none) with its world transform resolved up the `AttachParent` chain; one glTF mesh per static mesh, one node per instance, node `extras` with actor and mesh path;
- every `SplineMeshComponent`, deformed like `USplineMeshComponent` (cubic Hermite between `SplineParams` start/end, roll and scale interpolated, forward axis X) and written in world coordinates. These are the tunnel floors of the 61 `BP_CaveFloor_C` actors: the first segment uses `CaveEntrance_01` (54), the last often `CaveExit_01` (40), the rest `CaveTunnel_01` (79). Those meshes sit at every spline end, also inside caves, so they are not entrances by themselves;
- the landscape inside the box as a 1 m grid (heightmap decoded: `((R << 8 | G) - 32768) / 128 * scale.Z + location.Z`), without the quads the visibility layer marks as holes.

Left out: HLOD proxies (`WPHLOD*`), water, river, fog and cave-fog planes, the sky sphere (12 288 km) and planets, flying creatures, pickups and plants, and anything larger than 5 km. Foliage instances (small rocks, plants) are not included either.

glTF axes: metres, Y up, `(x, y, z) = (UE X, UE Z, UE Y) / 100`; front faces counter-clockwise (UE's own winding stays correct under the axis swap; checked: landscape normals all up, rock normals mostly outwards). The files open in any glTF viewer (three.js, Blender) for 3D previews of a cave. 1.2.5.0: 73 caves, 11 900 mesh instances, 58.0 million triangles, 389 MB.

**Sampling (dataset build, `scripts/cave-geometry.ts`).** A vertical ray per 1 m cell collects every non-wall surface (facing from the triangle normal). Walkable floors are upward surfaces with at least 2 m of air above; floors under an upward surface are buried (earth under the landscape over a buried rock) and ignored. A floor is *cave* if the surface ending its air faces down (a rock ceiling seen from inside) and it lies in the volumes' height band (grown 30 m sideways, 3 m down, so that mouths just outside a volume are found); connected cave floor under 200 m² is dropped (overhangs, gaps between rocks). *Outside* is open floor (sky above) at the edge of the box or outside the volumes (where the game plays no cave sound; this also finds mouths into basins and gullies whose floor does not reach the box edge), and open floor connected to it, steps up to 1.5 m. A *mouth* is cave floor next to outside floor, or within 15 m of it over covered non-cave floor (a mouth under an overhang). One *entrance* per opening: mouth pieces joined by cave floor outside the volumes (the floor under the overhang in front of a cave) and at most 50 m apart, or within 20 m and 3 m height, are one; openings under 3 cells are dropped. Outlines: the cave floor cells with gaps under 6 m closed (dilate and erode with a 3 m disc) and holes up to 1000 m² filled (rocks lying in the cave, pillars; a rock has its own floor on top, too small to count as cave), traced along cell edges, simplified (Douglas-Peucker, 1 m), corners cut once (Chaikin), rings under 20 m² dropped; larger holes are kept (even-odd fill). Zones of that area (8-connected, parts less than 8 m apart joined: a rock lying across a tunnel cuts its floor apart) are kept per cluster of volumes: in a cluster with an entrance, zones without one are dropped (gaps under rocks beside the cave, parts reached only through openings too small to count); a cluster without any found entrance (e.g. reached through a shaft or water) is kept whole; zones that do not reach into any volume are dropped with their entrances (overhangs next to the cave; before 2026-11-07 such an overhang counted as the entrance of cave-008 and cave-070 and their real halls were dropped). Finally the area is clipped to the volumes' 2D hulls: only where the game itself plays cave sound and fog counts as cave, so an entrance may lie a few metres outside the drawn area. Entrances use the unfilled cave floor. An item is *in a cave* if, in its cell or a neighbour inside the final area, a cave floor lies at most 3 m below it with its ceiling at most 1 m below it, or if it is *underground* (more than 5 m under the landscape, `heightmap/landscape.f32`, in its 2 m cell and the eight around it, none of them a hole) and within the volumes' height band. Underground items lie on rocks and ledges in the cave (too small to count as cave floor) or in hollows the sampling does not see as floor; the landscape test keeps out items on the ground below a cave that sits in a rock above them (a rule on the area alone flagged those). Where an underground item lies in a cluster of volumes but outside the cave area, that cluster is sampled again with the landscape at least 10 m above a floor as its ceiling: halls dug out under the landscape whose own ceiling the geometry lacks (cave-059: a hall about 90 m under the landscape, only pillars and ledges in the geometry, confirmed by the game's height texture). A cluster with an underground item but still no cave floor would be drawn as its volume outline (no such case in 1.2.5.0).

Result for 1.2.5.0 (cave sampling about 75 s): 73 caves, 142 entrances, 148 tracked collectibles in caves (63 blue, 17 yellow, 22 purple slugs, 18 Somersloops, 28 Mercer Spheres, no drop pods); all 115 tracked collectibles that lie more than 5 m under the landscape inside a cave volume are among them. `caves.geojson` about 285 KB (77 KB gzip).

Cross-check (2026-11-07) against the hand-drawn cave layer of satisfactory-calculator.com (validation only, none of its data is used): of its 104 caves, 88 lie in the game's cave volumes, all 88 overlap ours, and ours cover 97.5 % of their area inside the volumes (55 % of our area lies inside its caves: our caves fill more of the volumes, e.g. cave-050 and cave-030). Of its 122 entrances of caves in the volumes, 71 have one of ours within 30 m; 72 of our 142 lie within 30 m of one of its entrances. Before the fixes of that day: 71 caves, 174 entrances (66 and 82 within 30 m), 122 items in caves, 23 of the 115 underground items not flagged.

Known limitations:
- Only what lies in the game's cave volumes counts. 16 caves of satisfactory-calculator.com lie outside every volume (e.g. the "Tunnel" in the Rocky Desert, one in the Titan Forest), and 16 tracked collectibles lie more than 5 m under the landscape outside every volume; neither is a cave here.
- Entrances: 15 groups have no entrance although satisfactory-calculator.com shows one (cave-005, 008, 009, 011, 017, 022, 028, 031, 040, 041, 047, 065, 069, 071, 073). Causes seen: the opening lies outside the sampled box (a tunnel running on more than 30 m beyond the volume, a shaft from far above it), low lips (under 2 m of headroom in one cell) or steps over 1.5 m right at the mouth, and mouths above the top of the volume. Large caves still get more entrances than the other maps show (cave-002: 18, cave-007: 14 against 5 and 7 there); many are side openings under the cliffs along a hall, unchecked in game.
- cave-072 (Dune Desert, about 2 500 m², no entrance found, not on satisfactory-calculator.com) is real: a chamber under the landscape with a purple slug 17 m underground. Checked by eye against the map and the in-game knowledge of the maintainer on the north-west Rocky Desert cave system (cave-002: winding tunnels under the landscape and a hall about 100 m high, confirmed by a vertical section of the geometry); other caves are unchecked.

Rejected first approach (for the record): cave = the volume hulls, entrance = holes in the landscape near a volume. The hulls are boxes, and the landscape holes are mostly cut under rock meshes, not openings (37 of 147 such "entrances" lay deep inside a cave).

Since 2026-11-06 all of the extractor output, and the dataset `data/1.2.5.0`, is from GameVersion **1.2.5.0**. Against the 1.2.4.1 output it has the same map id (`968e47122e1f868c`), identical drop pods, extras and tracked collectibles (only 4 loose item pickups and 1 creature spawner differ), so saves and marks from 1.2.4.1 worlds still match.

## Height map (`heightmap/`)

For the height under the mouse (the map's coordinate readout), `--heightmap-out` writes height grids of the whole map: the minimap capture's square (X -324698..425302, Y -375000..375000), 3750 x 3750 cells of 2 m, float32 little-endian, row-major from the min corner (row = world Y), NaN where nothing is.

- `top.f32`: the **highest solid surface** per cell. Every triangle of every `StaticMeshComponent`, `SplineMeshComponent` (deformed as for the caves) and non-foliage instanced mesh, sampled at the cell centres, plus every vertex in the cell (so small and steep triangles count), and the landscape vertices (without holes). Same exclusions as the cave geometry (water, fog, sky, planets, HLOD proxies, pickups, plants, anything over 5 km); hidden components (`bVisible` false, `bHiddenInGame`) are skipped.
- `landscape.f32`: the UE landscape alone. `foliage.f32`: the highest foliage instance (trees, bushes, small rocks), for comparison only.
- `height-data.f32`: the game's own top-down height texture `/Game/FactoryGame/Interface/UI/Assets/MapTest/HeightData_Test` (next to the map slices; PF_R16F, normalised 0..1, no Z scale, cooked 2048 x 2048, about 3.7 m per pixel; row 0 = min Y), as floats.
- `heightmap.json`: grid (cell, minX, minY, width, height), component counts, texture format.

1.2.5.0: 30 404 static meshes, 173 spline meshes, 240 200 foliage instances (only in `foliage.f32`), 36.9 million landscape vertices; about 30 % of the square (outside the landscape, mostly sea) has no surface. Runs in about 1.5 minutes, 5.7 GB peak. The dataset build turns `top.f32` into tiles (`scripts/heightmap.ts`, about 6 MB).

**Choice of source (2026-11-06).** Three ways to get heights were compared against 3636 reference points: pickups (slugs, Somersloops, Mercer Spheres, berry/nut bushes, shrooms, loose items) and drop pods outside the cave volumes, half of the 7273 such points held out (the other half used for fitting where a method needs it):

| Source | median error | within 2 m | surface > 3 m below the object |
|---|---|---|---|
| 1. Online: [satisfactory-lens](https://github.com/parmati94/satisfactory-lens) `heightmap.bin` (HeightData_Test averaged to 1024², calibrated; no licence stated) | 2.6 m | 36 % | 21 % |
| 2. Image + known points: `HeightData_Test` (2048²), linear fit Z = 99 603·v − 52 255 cm on the points (Mercer Spheres alone: 99 337·v − 52 029, nearly the same) | 1.1 m | 66 % | 7 % |
| 3. Game files: `top.f32` (this section) | **1.0 m** | **72 %** | **2.5 %** |

Landscape alone: 54 % within 2 m and 43 % below objects (cliffs and plateaus are rock meshes). With foliage: 50 % within 2 m. About 20 % of the points have a surface more than 10 m above them under every source (overhangs, arches, big trees), which is right for "highest point". The game files win and are used; `height-data.f32` stays in the output for cross-checks. Other online finds were older copies of the same texture (moritz-h/satisfactory-3d-map, 8-bit, Update 6) or 3D-print meshes without a scale; satisfactory-calculator.com has no height layer.

## Map areas (`map-areas/`)

**Not the biomes any more** (2026-11-06): the game's map areas do not match the biomes players know (its "Rocky Desert" is five separate pieces across the map, Snaketree Forest and Western Beaches do not exist, borders differ widely), so the biomes come from the wiki's biome map (see "Biomes" below). The map areas are still extracted; the dataset build uses them for the biomes only when there is no biome raster.

The game's own named regions, from the `FGMapAreaTexture` asset `/Game/FactoryGame/Interface/UI/Minimap/MapAreaPersistenLevel/MapareatexturePersistentLevel`: `mAreaData`, a 4096 x 4096 byte raster (`mDataWidth` 4096, row-major) of palette indices, and per index `mColorPalette` (a colour) and `mColorToArea` (`MapArea` class, e.g. `Area_RedBambooFields_2_C`, and the area's pixel bounds). `--map-areas-out` writes the raster as is (`areas.u8`) and `areas.json` (width, height, per index colour, class and bounds).

- **Use:** the level's minimap capture actor (`BP_MinimapCaptureActor_C`) references the asset as `mMapAreaTexture`, so it is the live data, not a leftover. **Extent:** not in the asset. It is the minimap capture's square (the same as `map/map.json`), about 1.83 m per pixel, row 0 = min Y. Checked by drawing the area borders over the map image at full resolution: they follow cliff edges, rivers and island coasts with no visible offset (2026-11-06).
- **Names:** the game's display name of each area class: its class default's `mDisplayName` is a string table entry (table `World_Data`, keys `Locations/<Name>`), resolved by the extractor from `FactoryGame/Content/Localization/AllStringTables/{en-US,de}/AllStringTables.locres` into `name` and `nameDe` in `areas.json`. The class names are misleading and must not be used: `Area_Savanna_1/2_C` are shown as Rocky Desert, `Area_RedJungle_2_C` as Jungle Spires, `Area_crater_1_C` as Blue Crater, `Area_crater_2_C` as Crater Lakes, `Area_DesertCanyons_*` as Desert Canyon, `Area_MazeCanyons_*` as Maze Canyon. Areas with the same name are one biome. `Locations/NoMansLand` (sea, the map's edge) and the unused entry `None` are no biome. `Area_EasternDuneForest_1` has a name (Eastern Dune Forest) but no palette entry, so no area on the map. German names come from the same table (Felswüste, Dschungeltürme, ...). `scripts/map-areas.ts` falls back to the class name only for extractor output without names.
- **Order:** the palette order, which runs roughly north to south.
- **Rocky Desert** is the largest biome: besides the west it covers the far north (above Spire Coast), the western and eastern islands (palette index 4) and, through the two `Area_Savanna_*` classes, an area west of Northern Forest and one south of Titan Forest. Kept as the game has it.
- **Land without an area:** the game marks some land as no man's land too (coastal strips in the east, north and west, the strip east of Swamp at the south-east edge, a small island in the far south-east; 1.04 km² in 1.2.5.0). With the height grid (`heightmap/`) present, every such pixel whose highest surface is above -15 m (the sea surface is at about -17 to -18 m; the wiki gives -18 m) joins the biome of the nearest biome pixel (breadth-first over the raster), so no land on the map is without a name. Without the height grid it stays without a biome.
- **Items on no man's land** (15 in 1.2.5.0: underwater pickups, coastal rocks, all within 300 m of land) get the nearest biome within 500 m (`AREA_SNAP`).
- **Outlines** (`biomes.geojson`): each biome's pixels traced along pixel edges (`scripts/trace.ts`), Douglas-Peucker 1.5 m, rings under 200 m² dropped (stray pixels; the items there still get their biome from the raster). 1.2.5.0: 18 biomes, about 33 000 points. The map names every part of a biome of at least 0.13 km² (`labelPoints` in `src/web/features/biomes/useBiomes.ts`), so a biome in several pieces (Rocky Desert: west, far north, eastern islands) is named on each.

**Against the hand-drawn biomes** (the previous source, `data-src/biomes/biomes.editor.geojson`): 62 % of the 1764 items had the biome the game gives them (66 % counting Desert Canyons/Maze Canyons as the game's Desert Canyon/Maze Canyon). The largest moves: Spire Coast to Rocky Desert (140, the far north), to Desert Canyon (46) and to Dune Desert (42, the east coast, which the game's map gives to Dune Desert down to Swamp). Biomes the game does not have on its map: Western Beaches, Snaketree Forest, Eastern Dune Forest (its area is mostly the game's Rocky Desert via `Area_Savanna_2`, Titan Forest and Abyss Cliffs), Paradise Island.

1.2.5.0 items per biome: Dune Desert 177, Rocky Desert 312, Spire Coast 238, Desert Canyon 87, Northern Forest 61, Swamp 89, Lake Forest 44, Crater Lakes 69, Maze Canyon 30, Red Bamboo Fields 49, Titan Forest 175, Red Jungle 63, Jungle Spires 66, Western Dune Forest 45, Abyss Cliffs 72, Grass Fields 86, Blue Crater 66, Southern Forest 35.

## Biomes (wiki biome map)

The biomes are the 21 of the Satisfactory wiki's biome map, [File:Biome_Map.jpg](https://satisfactory.wiki.gg/wiki/File:Biome_Map.jpg) (5000 x 5000, "Re-creation of the biome map that appeared in the dev highlight", labelled "Biome Map (Version 1.0)" on the wiki's World page; current version uploaded 2024-10-16, Paradise Island counted as Grass Fields, the two islands east of Swamp without a biome). It is not in the repository; the maintainer data keeps it in `data-src/biomes/wiki-map/` with the sample points (`biomes.json`), and the result in `data-src/biomes/wiki-raster/`.

- **Placement:** the image covers exactly the map square (checked 2026-11-06: matching the image's edges against the in-game map at 512 and 1024 px over scales 0.96-1.04 and shifts of ±12 px gave identity as the best fit). So pixel (x, y) of the 5000-px image is world (minX + (x + 0.5) * 150 cm, minY + (y + 0.5) * 150 cm). The old hand-drawn polygons used a 1000-px copy and unverified bounds.
- **Classification** (`scripts/wiki-biomes.ts`): each biome is a translucent tint over the in-game map, `wiki = A * map + B`. With the untinted map known (the dataset's tiles at zoom 5, resized to 5000 px), the tint of each biome is fitted by least squares on its sample points (radius 25 px, four rounds dropping the worst fifth: labels, rivers, grid lines). Each land pixel gets the biome whose tint explains it best, or none if the plain map does. Then a 5 x 5 majority filter twice, pieces under 3000 px (0.7 ha) dropped, and pieces farther than 300 px (450 m) from the biome's largest piece or a piece holding one of its samples dropped (tints that look alike far apart: Western Beaches vs. Dune Desert, the grey islands east of Swamp vs. Abyss Cliffs). At the end every land pixel without a biome (labels, grid lines, lakes, rivers) gets the nearest biome over land, except on the game's no man's land (see "Game masks").
- **Game masks** (`--map-areas`, `--heightmap`, sampled at each pixel's centre; both cover the same map square): pixels the game's map areas mark as no man's land (`Area_NoMansLand_1_C`, `Locations/NoMansLand`) are not filled, so what the tints leave without a biome there stays so: the islands east of Swamp (0.32 km², removed from the wiki map on 2024-10-16), untinted coastal strips, channels between islands and a few lakes the game counts as no man's land. Cells whose highest surface (`heightmap/top.f32`) is below -200 m (`VOID_BELOW`; the seabed reaches about -170 m) are the void outside the world and get no biome at all: 10.4 ha that the tints or the fill had given a biome, along the north edge (Spire Coast) and the south-west coast (Grass Fields). Cells without any surface (NaN) are not treated as void.
- **Land** (`landMask`): from the in-game map image, not from heights (much of the south lies lower than the seabed off the coasts). Water is blue to teal (`b > r + 15 && g > r + 10`); the open sea is the water connected to the image's edge, flooded from a 12-px band along it (the image has a dark frame), after shrinking the water by 6 px so rivers do not carry the sea inland, then grown back within the water. Outside the map is dark neutral grey (the void and its glow). Lakes and rivers inland are land.
- **Names:** the wiki's names; German names from the game's string table `World_Data` (`Locations/<Name>`, see "Map areas") where the game has the name, English otherwise (Western Beaches, Snaketree Forest).
- **Output:** `areas.u8` + `areas.json` in the map-areas format; the dataset build reads it with `--biome-raster` (default `<data-src>/biomes/wiki-raster`) before the game's map areas and the editor polygons. Items on sea or on land left without a biome get the nearest biome within 500 m.

1.2.5.0 items per biome: Rocky Desert 124, Spire Coast 475, Dune Desert 136, Northern Forest 69, Desert Canyons 45, Crater Lakes 41, Maze Canyons 24, Lake Forest 37, Titan Forest 146, Swamp 84, Red Bamboo Fields 87, Red Jungle 85, Western Beaches 27, Jungle Spires 42, Western Dune Forest 29, Eastern Dune Forest 97, Snaketree Forest 15, Grass Fields 77, Southern Forest 26, Blue Crater 57, Abyss Cliffs 41. The outlines have about 19 400 points. The game masks (2026-11-07) took 0.92 km² out of the biomes (Swamp 0.33, Grass Fields 0.24, Spire Coast 0.08, Western Beaches 0.07, Rocky Desert 0.07, Dune Desert 0.06 km², the rest below 0.03 km² each), moved 1.3 ha between neighbouring biomes (the fill reaches some lake shores from another side) and changed no item's biome.

Regenerate (after a new wiki map or a changed in-game map):

```
python3 -c "from PIL import Image; open('wiki.rgb', 'wb').write(Image.open('Biome_Map.jpg').convert('RGB').tobytes())"
python3 -c "
from PIL import Image
m = Image.new('RGB', (8192, 8192))
for x in range(32):
    for y in range(32):
        m.paste(Image.open(f'data/1.2.5.0/tiles/5/{x}/{y}.webp').convert('RGB'), (x * 256, y * 256))
open('map.rgb', 'wb').write(m.resize((5000, 5000), Image.LANCZOS).tobytes())
"
npx tsx scripts/wiki-biomes.ts --wiki-rgb wiki.rgb --map-rgb map.rgb --biomes <data-src>/biomes/wiki-map/biomes.json \
  --map-areas data-src/extractor/1.2.5.0/map-areas --heightmap data-src/extractor/1.2.5.0/heightmap --out <data-src>/biomes/wiki-raster
```

## Resource nodes (`default-world.json`)

Written by upstream `world-extractor-net` (`--out`). 1.2.5.0: 459 `resourceNodes` `{name, location, resource, purity}`, 31 `geysers` `{name, location, purity}` (no resource), 17 `frackingCores` `{name, location, resource, satellites: [{name, location, purity}]}` with 118 satellites. `resource` is the descriptor class (`Desc_OreIron_C`); `purity` is `RP_Inpure`, `RP_Normal` or `RP_Pure` (the game's own spelling of impure). The dataset build turns it into `resource-nodes.json` (satellites take their core's resource, geysers get the pseudo resource `Geyser`); the 13 resource descriptors have English names in `item-names.json`. Every entry of `item-names.json` equals `mDisplayName` in the game's `CommunityResources/Docs/en-US.json` (build 517554), so `_unverified` is empty.

**Names in saves.** Checked with the saves of one world (builds 493833 and 495413, 20 saves; all started without node randomisation): the save has one object per node in `Persistent_Level`, `BP_ResourceNode_C` (459), `BP_ResourceNodeGeyser_C` (31), `BP_FrackingCore_C` (17) and `BP_FrackingSatellite_C` (118), and their instance names equal `name` here (all 625 match 1:1). Their only saved properties are `mResourcesLeft` (IntProperty) and `mDoSpawnParticle` (BoolProperty); nothing about resource or purity, and the game state (`BP_GameState_C`) has no node settings.

**Randomised nodes (game 1.1+).** The game's reflection data (`FactoryGameSteam-FactoryGame-Win64-Shipping.dll`, 1.2.5.0, install of 2026-11-04) show node randomisation: enum `ENodeRandomizationMode` (`NRM_None`, `NRM_Strict`, `NRM_BasicReach`, `NRM_AdvancedRich`, `NRM_FossilFuelRich`), enum `ENodePuritySettings` (`NPS_NoChange`, `NPS_AllPure`, `NPS_AllNormal`, `NPS_AllImpure`, `NPS_AllRandom`, `NPS_Increase`, `NPS_Decrease`), game-mode options `FG.GameMode.NodeRandomization`, `...NodePuritySettings`, `...NodeRandomizationSeed`, and an `AFGResourceNodeManager` on the world settings. The property flags in the same data say what a save can hold (all of these are `SaveGame`):

| Object in the save | Property | Type in the save | Default (not written) |
| --- | --- | --- | --- |
| node, geyser, satellite (`AFGResourceNode`) | `mPurityOverride` | ByteProperty, enum `EResourcePurity`, bare member name `RP_Inpure`/`RP_Normal`/`RP_Pure` (plain C++ enum) | `RP_MAX` (set in the constructor) |
| every node incl. cores (`AFGResourceNodeBase`) | `mResourceClassOverride` | class reference (ObjectProperty), `pathName` `/Game/.../Desc_Coal.Desc_Coal_C` | none |
| `BP_GameState_C` (`AFGGameState`) | `mNodeRandomization`, `mNodePuritySettings` | EnumProperty, `ENodeRandomizationMode::NRM_*`, `ENodePuritySettings::NPS_*` | `NRM_None`, `NPS_NoChange` (SML `FGGameState.h`, CL517554) |
| `BP_GameState_C` | `mNodeRandomizationSeed` | IntProperty | 0 (same header) |

The node's own `mPurity` and `mResourceClass` are not `SaveGame`, so a save never states a node's purity unless it overrides it. Since a save only writes properties that differ from the default, an overridden node carries `mPurityOverride` (and/or `mResourceClassOverride`) and every other node carries neither. The import reads exactly these (`src/shared/resourceNodes.ts`); without them the world keeps the dataset's values. **Not verified:** no save of a randomised world was available, so the override and settings properties have not been seen in a real save; the value forms above come from the reflection data and from writing and re-reading such properties with the parser.

**Seed only.** A randomised save may hold the settings and the seed but no per-node overrides: `AFGResourceNodeManager` (SML `Resources/FGResourceNodeManager.h`, CL517554) can rebuild the layout from the seed when the world loads ("This Stream or just a seed is the only thing that needs to be saved for the Random Nodes Game Mode to work"; its `mSeedStream` is not a `UPROPERTY`). For such a save the import stores the settings, the map keeps the default nodes, and the panel and the import dialog say that the world is randomised but its layout cannot be read. The same holds for anything else the manager decides from the seed: if randomisation leaves nodes without a resource or inactive, nothing in the save says which, so the map cannot show it. Its per-mode `mNodeCountMultiplier` is a class default (`EditDefaultsOnly`, not `SaveGame`); `BP_ResourceNodeManager` sets `NRM_BasicReach` 1.1, `NRM_AdvancedRich` 3.0 and `NRM_FossilFuelRich` 2.0 (build 517554).

**Display names.** The UI names the settings as the game's own settings menu does, not by enum member. The settings assets `US_GM_ResourceRandomization` (`FG.GameMode.NodeRandomization`) and `US_GM_NodePurity` (`FG.GameMode.NodePuritySettings`) under `/Game/FactoryGame/Settings/GameModes/` map each enum value to a string-table key (`Menus_UI`, `AllStringTables.locres`, build 517554):

| Value | Enum member | String-table key | English | German |
| --- | --- | --- | --- | --- |
| 0 | `NRM_None` | `Games/GameModes/ResourceRandomization/Default` | Default | Standard |
| 1 | `NRM_Strict` | `Games/GameModes/ResourceNodePurity/Random` | Random | Zufällig |
| 2 | `NRM_BasicReach` | `Games/GameModes/ResourceRandomization/BasicRich` | Basic Resource Rich | Reich: Grundressourcen |
| 3 | `NRM_AdvancedRich` | `Games/GameModes/ResourceRandomization/AdvancedRch` | Advanced Resource Rich | Reich: Fortgeschrittene Ressourcen |
| 4 | `NRM_FossilFuelRich` | `Games/GameModes/ResourceRandomization/FossilRich` | Fossil Fuel Rich | Reich: Fossile Brennstoffe |
| 0 | `NPS_NoChange` | `Games/GameModes/ResourceNodePurity/Default` | Default | Standard |
| 1 | `NPS_AllPure` | `Games/GameModes/ResourceNodePurity/AllPure` | All Pure | Alle rein |
| 2 | `NPS_AllNormal` | `Games/GameModes/ResourceNodePurity/Average` | Average | Durchschnittlich |
| 3 | `NPS_AllImpure` | `Games/GameModes/ResourceNodePurity/AllImpure` | All Impure | Alle unrein |
| 4 | `NPS_AllRandom` | `Games/GameModes/ResourceNodePurity/Random` | Random | Zufällig |
| 5 | `NPS_Increase` | `Games/GameModes/ResourceNodePurity/MostlyPure` | Mostly Pure | Hauptsächlich rein |
| 6 | `NPS_Decrease` | `Games/GameModes/ResourceNodePurity/MostlyImpure` | Mostly Impure | Hauptsächlich unrein |

The option names are `Games/GameModes/ResourceRandomName` (Resource Node Randomization / Zufällige Rohstoffvorkommen) and `Games/GameModes/ResourceNodePurityName` (Resource Node Purity / Reinheit von Rohstoffvorkommen). The game's string `Average` carries a trailing space in both languages; the UI drops it. The `UMETA` display names in the SML header (`Strict Randomization`, `No Change`, `Increase`, ...) differ; the settings menu shows the strings above. The enum values come from SML `FGGameState.h` (CL517554); the save may hold a member name or a value, the import accepts both.


**Extractors on nodes (saves).** Checked with the same 20 saves of one world (builds 493833 and 495413, save version 60; parser 4.1.2): every extractor is one object in `Persistent_Level` that names its node by an object reference whose `pathName` is the node's instance name (`Persistent_Level:PersistentLevel.BP_ResourceNode586`). In the newest save (autosave of build 495413): 8 `Build_MinerMk1_C`, 17 `Build_MinerMk2_C`, 14 `BP_PortableMiner_C` on 27 nodes (portable miners share nodes: up to 6 on one, and 2 nodes have a portable miner next to a building), 26 Power Shards in miners; every linked node exists in `default-world.json`. 12 `Build_WaterPump_C` link to `FGWaterVolume*` actors, not to nodes, and are not extractors on nodes. Property names and the SaveGame flag were checked in the game's reflection data (`FactoryGameSteam-FactoryGame-Win64-Shipping.dll`, 1.2.5.0); the asset names of the other buildings come from the pak index (`FactoryGame-Windows.utoc`).

| Building (class) | Kind | Seen in a save | Link to the node | Clock and Power Shards |
| --- | --- | --- | --- | --- |
| `Build_MinerMk1_C`, `Build_MinerMk2_C`, `Build_MinerMk3_C` | `miner1`-`miner3` | Mk.1, Mk.2 | `mExtractableResource` → `BP_ResourceNode*` | yes |
| `Build_OilPump_C` | `oil` | no | `mExtractableResource` (`AFGBuildableResourceExtractorBase`) → `BP_ResourceNode*` (oil node) | yes (Docs `mCanChangePotential` True) |
| `Build_FrackingSmasher_C` (resource well pressurizer) | `pressurizer` | no | `mExtractableResource` → `BP_FrackingCore*` | yes (Docs `mCanChangePotential` True) |
| `Build_FrackingExtractor_C` (resource well extractor) | `well` | no | `mExtractableResource` → `BP_FrackingSatellite*` | none: Docs say `mCanChangePotential` True, but the game sets the clock at the pressurizer for the whole well (wiki Resource_Well_Pressurizer); clock and shards are always null, the pressurizer row has them |
| `Build_GeneratorGeoThermal_C` | `geothermal` | no | `mExtractableResource` (its own SaveGame property on `AFGBuildableGeneratorGeoThermal`) → `BP_ResourceNodeGeyser*` | none (Docs `mCanChangePotential` False): clock and shards are always null |
| `BP_PortableMiner_C` | `portable` | yes | `mExtractResourceNode` | none |

- **Clock speed:** `mPendingPotential` and `mCurrentPotential` (FloatProperty on `AFGBuildableFactory`, 1 = 100 %), absent at the default 1. Pending is what the player set; current can lag behind (one save had a miner with `mPendingPotential` 1.125 and no `mCurrentPotential`), so the import takes pending, then current, then 1. Seen: 1, 1.125, 1.5, 2, 2.25.
- **Power Shards:** `mInventoryPotential` is a reference to the building's own `FGInventoryComponent` object (`<building instance>.InventoryPotential`, a separate object in the level). With shards it has `mInventoryStacks` (ArrayProperty of `InventoryStack` structs: `Item.value.itemReference.pathName` = `/Game/FactoryGame/Resource/Environment/Crystal/Desc_CrystalShard.Desc_CrystalShard_C`, `NumItems` 1, empty slots with an empty `pathName` and 0); without shards only `mArbitrarySlotSizes` `[1, 1, 1]`. The import counts the shards there. In all 20 saves the count equals the minimum the pending clock needs (one shard per started 50 % above 100 %; against `mCurrentPotential` it did not match in 6 saves, see above). The import still counts them instead of deriving them from the clock, because the game lets a building hold more shards than its clock uses.
- **Target nodes:** the node classes of the buildings not yet seen in a save are confirmed by the SML headers (CL517554: `FGBuildableFrackingActivator.h` "must be placed on an AFGResourceNodeFrackingCore node", `FGBuildableFrackingExtractor.h` "can only extract resources from an AFGResourceNodeFrackingSatellite node", `FGBuildableGeneratorGeoThermal.h` `mExtractableResource`, the geyser it is placed on) and by satisfactory-calculator's save code.
- **Limits:** clock speed 1-250 % and three Power Shards (satisfactory.wiki.gg "Clock speed": each shard raises the maximum by 50 % up to three times; Docs `Desc_CrystalShard_C` `mExtraPotential` 0.5). The buildings' `mMaxPotential` (1.0) and `mPotentialShardSlots` (0) in the Docs are the base values before shards, not these limits.
- **Not verified:** oil extractors, resource well pressurizers and extractors, Mk.3 miners and geothermal generators have not been seen in a real save (none in the available saves); their link property comes from the reflection data and their target node classes from SML and satisfactory-calculator.
## Transport (`transport.json`, vehicle calculator)

The vehicle calculator needs capacities, stack sizes, stop times, speeds and fuel use. They come from two sources, combined by the dataset build (`scripts/transport.ts`, Docs parsing in `scripts/game-docs.ts`) into the dataset's `transport.json`:

**1. The game's Docs files** `<install>/CommunityResources/Docs/en-US.json` and `de.json` (shipped with every install; UTF-16 LE with BOM). Pass the folder with `--docs` or copy it to `<extractor output>/docs/`. Used fields:

| Value | Class | Field | 1.2.5.0 |
|---|---|---|---|
| Item stack size | every class with `mForm` `RF_SOLID`, `RF_LIQUID` or `RF_GAS` (195) | `mCachedStackSize` (the number the game resolved from the `mStackSize` enum: SS_ONE 1, SS_SMALL 50, SS_MEDIUM 100, SS_BIG 200, SS_HUGE 500, SS_FLUID 50000) | |
| Item names | same | `mDisplayName` in `en-US.json` and `de.json`, on one line: a hyphen with a line break before a lowercase letter is removed (German "Plutonium- \r\nbrennstab" becomes "Plutoniumbrennstab"), after another hyphen only the break goes, any other break becomes a space; a hyphen followed by a plain space stays ("Luft- und Raumfahrttechnik") | |
| Fuels | every solid item with `mEnergyValue` > 0 (Leaves to Plutonium Fuel Rod) | `mEnergyValue` (MJ per item) | 19 items; Packaged Fuel 750 MJ (the default), Coal 300 MJ, Battery 6000 MJ |
| Inventory slots | `Desc_Tractor_C`, `Desc_Truck_C`, `Desc_Explorer_C`, `Desc_FluidTruck_C`, `Desc_DroneTransport_C`, `Desc_FreightWagon_C` | `mInventorySize`, `mIsFluidStorageInventory` | 25, 48, 12, 1 (fluid), 9, 32 |
| Fuel use of wheeled vehicles on autopilot | `Desc_Tractor_C`, `Desc_Truck_C`, `Desc_Explorer_C`, `Desc_FluidTruck_C` | `mAutopilotFuelConsumption` (energy per cm travelled, read as MJ) | 0.05 for all four = 5 MJ per metre |
| Drone trip cost | `Build_DroneStation_C` | `mTripPowerCost`, `mTripPowerPerMeterCost` (MJ) | 24 000 per round trip, 6 per metre flown |
| Truck Station load/unload cycle | `Build_TruckStation_C` | `mLoadUnloadCycleLength` (s) | 8 s |
| Fluid Truck Station load/unload cycle | `Build_FluidTruckStation_C` | `mLoadUnloadCycleLength` (s) | 9 s |
| Freight Platform times | `Build_TrainDockingStation_C`, `Build_TrainDockingStationLiquid_C` | `mTimeToCompleteLoad`, `mTimeToCompleteUnload` | 27 s, 27 s |

Not used: `mManualFuelConsumption` (MW while a player drives: Tractor 55, Truck and Fluid Truck 75, Explorer 90).

Fluid amounts are litres in the game data: SS_FLUID = 50 000 = 50 m³ per fluid slot.

**2. The paks** via the patch flag `--transport-out` (class default objects of the vehicle blueprints; a value a blueprint does not set is taken from its parent blueprint, e.g. `BP_FluidTruck` from `BP_Truck`; `null` = no blueprint sets it, i.e. a C++ default that is not in the paks):

| Value | Blueprint field | 1.2.5.0 |
|---|---|---|
| `fluidStackSizeMultiplier` | `mFluidStackSizeMultiplier` | Fluid Truck 64, Freight Car 48 (Truck 32, unused: the Truck carries no fluids) |
| `dockingSequenceDuration`, `takeoffSequenceDuration` | `BP_DroneTransport` `mDockingSequenceDuration`, `mTakeoffSequenceDuration` | 28 s, 23 s |
| `straightPathSpeedLimit` | the autopilot component's `mCurvatureSpeedLimitCurve` (`PathCurvatureSpeedLimitCurve_Truck` for Tractor, Truck and Fluid Truck, `..._Explorer` for the Explorer), first key at curvature 0 | 25 (Tractor, Truck, Fluid Truck), 28 (Explorer); none for drone and train |
| `tractionSpeedLimit` | the autopilot component's `mTractiveEffortCurve` (m/s to kN; `AccelerationCurve_Tractor`, `_Truck`, `_Explorer`): the speed of the first key at or below 0 after a positive one, linear between the two keys when that key is below 0 (the cubic segment before it stays positive in 1.2.5.0) | 19.6 (Tractor), 26.2 (Truck, Fluid Truck; last key -3.5e-7), 27.9 (Explorer); none for drone and train |
| `droneFuelTypes` | `BP_DroneTransport` `mFuelTypes[]`: `Item` and `TravelSpeed` (cm/s) | Battery 7500, Packaged Fuel 5000, Packaged Turbofuel 6000, Packaged Rocket Fuel 7500, Packaged Ionized Fuel 10000, Uranium Fuel Rod 9000, Plutonium Fuel Rod 10000 |
| `inventorySize`, `isFluidStorage` | `mInventorySize`, `mIsFluidStorageInventory` | only for the cross-check with the Docs |

**Derived values** (`scripts/transport.ts`):

- Fluid capacity = fluid slots × 50 000 L × `mFluidStackSizeMultiplier` / 1000: Fluid Truck 1 × 50 × 64 = 3200 m³, Freight Car one fluid slot × 50 × 48 = 2400 m³. The build checks both against the "<n> m³" in the vehicle's English description (Fluid Truck "3200 m³", Freight Car "2400 m³ or 32-slot capacity") and fails on a difference.
- Stop time per round trip (load at one end, unload at the other): Truck Station vehicles 2 × the 8 s cycle = 16 s, whatever they carry (since 1.2.0.0 a Truck Station loads or unloads a docked vehicle in one fixed cycle; the "120 stacks per minute" still in its description is left over from the old system and not used); Fluid Truck 2 × the Fluid Truck Station's 9 s cycle = 18 s (that one cycle moves the whole load is assumed by analogy with the Truck Station, not tested); Freight Car 27 s + 27 s = 54 s; Drone 2 × (28 s + 23 s) = 102 s (docking and take-off at both ports). Docking manoeuvres of wheeled vehicles and trains (braking, approaching the station) are not in the game data and not included.
- Fuel per round trip, in items = (fixed MJ per round trip + MJ per metre × 2 × route) / energy per item; per minute it is spread over the round trip and multiplied by the vehicles. Shown as an estimate.
  - Wheeled vehicles on autopilot burn fuel per distance: `mAutopilotFuelConsumption` is, per the modding headers (SatisfactoryModLoader `FGWheeledVehicle.h`, CL 517554), the fuel "per centimeter of distance travelled with autopilot enabled"; the header says MW, read here as MJ: 0.05 MJ/cm = 5 MJ per metre, 10 000 MJ per round trip on a 1 km route (13.3 Packaged Fuel). Speed and standing time do not change it. Not modelled: 1.2 has a fuel distance scale per climb angle, one curve per vehicle (`FuelClimbAngleDistanceScaleCurve_Tractor` ×1.4 at 35°, `_Explorer` ×1.4 at 90°, `_Truck` flat), so the Tractor and Explorer burn more uphill.
  - Drone: per `FGBuildableDroneStation.h`, `mTripPowerCost` is the base cost of launching a drone on a trip and `mTripPowerPerMeterCost` what every metre of travel between two stations costs (no unit given). In MJ this matches a player test on the wiki (satisfactory.wiki.gg, Talk:Drone, 2026-04): 24 000 MJ per round trip (two take-offs and landings) plus 12 MJ per metre between the ports (6 MJ there and 6 MJ back), measured on the horizontal distance. 1 km apart: 36 000 MJ = 48 Packaged Fuel or 6 Batteries per round trip. The drone takes only the seven fuels of its `mFuelTypes`; Packaged Fuel is the default.
  - The freight car (pulled by an electric locomotive) gets no fuel figure.
- Speed (the default of the speed input, shown as km/h): wheeled vehicles the lower of the straight-path limit and the speed where the tractive effort ends. The straight-path limit is the autopilot's upper limit in m/s (the curve's x axis is the path curvature; 25 m/s = 90 km/h); the Tractor never reaches its 25 m/s because its tractive effort is 0 from 19.6 m/s (70.6 km/h). Defaults: Tractor 19.6 m/s, Truck and Fluid Truck 25 m/s (traction ends at 26.2), Explorer 27.9 m/s (limit 28). The drone flies at the `TravelSpeed` of its current fuel (50 m/s with Packaged Fuel, 75 with Batteries; `FGDroneVehicle.h`: "traveling speed of the drone while using this fuel"); take-off and landing are in its stop time. All of them are upper limits, not averages: curves, slopes and acceleration make the real average lower, so the calculator labels them as defaults.

**Not in the game data** (user input in the calculator, no default): the average speed of the train (C++ default of the locomotive, not overridden in any blueprint). Not offered: Cyber Wagon (1 slot; it has no vehicle path preset, so it does not drive automatically) and Factory Cart (`BP_Golfcart` `mInventorySize` 1 like the Cyber Wagon, `mNeedsFuelToDrive` False, so it needs no fuel). Indirect evidence only: that the Explorer docks at Truck Stations (it can drive vehicle paths: `Build_VehiclePath_Universal_C` `mAllowedVehicleTypes` lists Tractor, Truck and Explorer); the calculator offers it with the Truck Station stop time.

The dataset build writes `transport.json` only when both sources are there; otherwise the calculator shows that the dataset has no vehicle data. Checked for 1.2.5.0 (2026-11-07): 6 vehicles, 195 items, 19 fuels, about 26 KB.
## Recipes and buildings (`recipes.json`, not from the extractor)

The production planner's data come from the game's own class dump that ships with the install, not from the paks: `<install>/CommunityResources/Docs/en-US.json` (names, numbers) and `de.json` (German names). Built by `scripts/recipes.ts`, written as `recipes.json` into the dataset:

```
npm run recipes -- --docs <install>/CommunityResources/Docs --out data/<game-version>
# or as part of the dataset build:
npm run dataset -- --extractor ... --out data/<game-version> --docs <install>/CommunityResources/Docs
```

- **Files:** UTF-16 LE with byte order mark and CRLF (one of the 56 language files, `io.json`, is plain UTF-8; the script reads both). Structure `[{NativeClass, Classes: [{ClassName, ...}]}]`; every value is a string in UE text syntax. The files carry no game version. Read from the Steam install with GameVersion 1.2.5.0 (CL 517554, `Engine/Binaries/Win64/*.version`) on 2026-11-06: 114 native classes, 2868 classes in each file. `en-US.json` and `de.json` have the same classes and the same numbers; only display texts differ.
- **Recipes** (`FGRecipe`): kept when `mProducedIn` names exactly one production building (native class `FGBuildableManufacturer` or `FGBuildableManufacturerVariablePower`); build gun, Craft Bench and Equipment Workshop recipes are left out. Fields: `mDisplayName` (EN, DE), `mIngredients` and `mProduct` (`ItemClass`, `Amount`; the first product is the main product), `mManufactoringDuration` (seconds, sic), and for variable-power buildings `mVariablePowerConsumptionConstant` and `mVariablePowerConsumptionFactor` (power over a cycle from constant to constant + factor; e.g. Plutonium Pellet 250-750 MW). *Alternate* = English display name starts with `Alternate:` (110 of 291). Names are put on one line: a few German names carry a line break for the in-game UI (`Plutonium- \r\nbrennstab`, item and recipe Plutonium Fuel Rod); a hyphen followed by a line break and a lower-case letter is joined (`Plutoniumbrennstab`), other line breaks become a space (a hyphen before a plain space stays, `Luft- und Raumfahrttechnik`). The alternate schematics (`EST_Alternate`) are not used for this: they also unlock plain recipes (Packaged Turbofuel) and miss MAM alternates (Alternate: Compacted Coal, Polyester Fabric).
- **Fluids:** amounts of items with `mForm` `RF_LIQUID` or `RF_GAS` are litres in the data and divided by 1000 (m³). Checked against the extractor descriptions: the Water Extractor's 2000 per 1-second cycle is described as "Default Extraction Rate: 120 m³ of water per minute".
- **Buildings:** `mDisplayName`, `mPowerConsumption` (MW at 100 %), `mPowerConsumptionExponent`. The build fails if `mManufacturingSpeed` is not 1 (it is 1 for all eleven).
- **Clock speed** (`clock` in `recipes.json`): `min` = `mMinPotential` (0.01, i.e. 1 %, for every production building, extractor and the pressurizer), `perShard` = `mExtraPotential` of the overclocking Power Shard (`Desc_CrystalShard_C`, native class `FGPowerShardDescriptor`, `mPowerShardType` `PST_Overclock`: 0.5, i.e. +50 %; the other shard type, `PST_ProductionBoost`, is the Somersloop). The build fails if a used building has no `mMinPotential`, if they differ, if one has an `mMaxPotential` other than 1 (100 % without shards), or if there is not exactly one overclocking shard with an `mExtraPotential` above 0.
- **Extractors** (`FGBuildableResourceExtractor`, `FGBuildableWaterPump`, `FGBuildableFrackingExtractor`): rate per minute = `mItemsPerCycle` / `mExtractCycleTime` x 60 (fluids / 1000), power `mPowerConsumption`, `mPowerConsumptionExponent`. Resources: `mAllowedResources` when `mOnlyAllowCertainResources` is True, else every `FGResourceDescriptor` whose `mForm` is in `mAllowedResourceForms` (the miners: the 10 solid resources incl. SAM). The rate is checked against the number in the English `mDescription` ("Default extraction rate is 60 resources per minute"); the build fails on a mismatch. 1.2.5.0: Miner Mk.1 60/min 5 MW, Mk.2 120/min 15 MW, Mk.3 240/min 45 MW, Oil Extractor 120 m³/min 40 MW, Water Extractor 120 m³/min 20 MW, Resource Well Extractor 60 m³/min 0 MW; Resource Well Pressurizer (`FGBuildableFrackingActivator`) 150 MW, `mPowerConsumptionExponent` 1.321929 (the build fails if there is a resource well extractor but no pressurizer, or the pressurizer has no exponent). A resource well's clock speed is set at its pressurizer and applies to all its extractors, which cannot be overclocked themselves (Satisfactory wiki, "Resource Well Pressurizer", checked 2026-11-07: "Overclocking the Pressurizer increases the output rate of all the surrounding Resource Well Extractors at once", extractor "Overclockable: No"; the Docs have `mCanChangePotential` True for both, so this is not in the data). The planner therefore gives a well step the pressurizer's clock speed: it scales the extractors' rate, the Power Shards go into the pressurizer, and the pressurizer's power is 150 × c^1.321929 (the wiki's table: 375 MW at 200 %, 503.66 MW at 250 %).
- **Not in the data** (so user input in the planner, never filled in): the purity factors of resource nodes (the descriptions only say "Extraction rate varies based on resource node purity"; only the geothermal generator's description gives per-purity numbers, for geysers), the number of Power Shard slots (`mMaxPotential` is 1.0 and `mPotentialShardSlots` 0 for every building; the slots come with research), how many satellites a resource well has. The planner takes the first two from the Satisfactory wiki instead (checked 2026-11-06): purity factors impure ×0.5, normal ×1.0, pure ×2.0 ("Resource node", section "Purity"; its per-node rates for oil, 150/300/600 per minute, and resource wells, 75/150/300, are the same factors at 250 %), up to 3 Power Shards per building ("Clock speed"; `MAX_SHARDS` in `src/shared/planner.ts`). With the Docs' 1 % minimum and +50 % per shard that gives 1 % to 250 %. Power at clock speed c is `power × c^mPowerConsumptionExponent` (1.321929 for production buildings, extractors and the pressurizer, from the Docs; the wiki gives the same exponent).
- **Game modes:** the values are those of the default game mode. The game mode settings of 1.2 (recipe cost multiplier, power consumption multiplier, randomised node purity) are not modelled; the planner says so in its notes.
- 1.2.5.0: 291 recipes (110 alternates), 168 items, 11 production buildings, 6 extractors, about 116 KB.
- Items without any recipe or extractor in the data (Leaves, Wood, Mycelia, creature remains, Power Slugs, Uranium Waste and Plutonium Waste from power plants, FICSMAS Gift) are "supplied from outside" in the planner.

## Machine and vehicle wiki (`machines.json`, not from the extractor)

The in-app wiki of machines and vehicles is built from the game's own class dump that ships with the install, not from the paks: `<install>/CommunityResources/Docs/en-US.json` (names, descriptions, numbers) and `de.json` (German names and descriptions). Built by `scripts/machines.ts` (Docs parsing in `scripts/game-docs.ts`), written as `machines.json` into the dataset:

```
npm run machines -- --docs <install>/CommunityResources/Docs --out data/<game-version>
# or as part of the dataset build (default --docs: <extractor output>/docs):
npm run dataset -- --extractor ... --out data/<game-version> --docs <install>/CommunityResources/Docs
```

- **Files:** UTF-16 LE with byte order mark, `[{NativeClass, Classes: [{ClassName, ...}]}]`. Values are strings in UE text syntax, except a few lists of objects (`mFuel`, `mUnlocks`). `de.json` has the same classes and numbers; a class missing there fails the build.
- **Entries** (49 in 1.2.5.0) by native class: production `FGBuildableManufacturer`, `FGBuildableManufacturerVariablePower` (11); extraction `FGBuildableResourceExtractor`, `FGBuildableWaterPump`, `FGBuildableFrackingExtractor`, `FGBuildableFrackingActivator` (7); power `FGBuildableGeneratorFuel`, `FGBuildableGeneratorNuclear`, `FGBuildableGeneratorGeoThermal`, `FGBuildablePowerStorage`, `FGBuildablePowerBooster` (7); logistics `FGBuildableDockingStation`, `FGBuildableDroneStation`, `FGBuildableRailroadStation`, `FGBuildableTrainPlatformCargo`, `FGBuildablePipelinePump`, `FGPipeHyperStart` (9); other machines `FGBuildableResourceSink`, `FGBuildableRadarTower`, `FGBuildableElevator`, `FGBuildablePortal`, `FGBuildablePortalSatellite` (5). Logistics and other machines only with `mPowerConsumption` > 0 (this drops the Valve, which shares the pump's class). Vehicles: every `FGVehicleDescriptor` plus the Factory Carts `Desc_GolfCart_C`, `Desc_GolfCartGold_C` (equipment descriptors) (10). Lights, jump pads and other powered decorations are not included.
- **Text:** `mDisplayName`, `mDescription` (EN and DE, line ends normalised). The descriptions are shown as the game's text, never parsed into stats. Names are put on one line: `de.json` breaks one name with a hyphen and a line break (`Plutonium- \r\nbrennstab`, item and recipe), which is joined to `Plutoniumbrennstab` (hyphen and break removed before a lower-case letter; other breaks become a space; `Luft- und Raumfahrttechnik` has no break and stays).
- **Stats** (only what the class has; MW, s, per minute at 100 % clock speed):

| Stat | Field |
|---|---|
| Power use | `mPowerConsumption`; variable-power buildings `mEstimatedMininumPowerConsumption` to `mEstimatedMaximumPowerConsumption`; Electric Locomotive `mPowerConsumption` `(Min=25,Max=110)` |
| Power generated | `mPowerProduction`; Alien Power Augmenter `mBasePowerProduction` (500 MW) and `mBaseBoostPercentage` (10 % of the grid); Geothermal Generator: production 0, shown as the average on a normal geyser `mVariablePowerProductionFactor` (200 MW, the same as "Normal Geyser: ... 200 MW average" in its description) that fluctuates in a cycle of `mVariablePowerProductionCycleLength` (60 s); the per-purity ranges are only in its description |
| Clock speed | `mMinPotential` to `mMaxPotential` when `mCanChangePotential` is True (1-100 %; the Power Shard limit is not in the Docs). Not for the Alien Power Augmenter (`FGBuildablePowerBooster`), Drone Port (`FGBuildableDroneStation`) and Resource Well Extractor (`FGBuildableFrackingExtractor`): their Docs say True, but the game does not let you change their clock speed (wiki pages Alien_Power_Augmenter, Drone_Port; the well's clock speed is set at the Resource_Well_Pressurizer) |
| Power exponent | `mPowerConsumptionExponent`, for power consumers with a clock speed (so not the Drone Port's 1.6) |
| Somersloop slots | round(1 / `mProductionShardBoostMultiplier`) when `mCanChangeProductionBoost` is True (1.0 -> 1, 0.5 -> 2, 0.25 -> 4; matches the wiki for all 10 buildings). `mProductionShardSlotSize` is only right where `mOverrideProductionShardSlotSize` is True: the Smelter has 0 there but 1 slot |
| Extraction rate | `mItemsPerCycle` / `mExtractCycleTime` x 60 (fluids / 1000), marked "(normal node)" for every extractor but the Water Extractor (`FGBuildableWaterPump`, no nodes); resources `mAllowedResources` when `mOnlyAllowCertainResources`, else `mAllowedResourceForms` |
| Fuels | `mFuel` (`mFuelClass`, `mSupplementalResourceClass`, `mByproduct`, `mByproductAmount`); fuel per minute = power x 60 / the fuel's `mEnergyValue` (MJ per item, per litre for fluids); supplement (water) per minute = power x `mSupplementalToPowerRatio` x 60 / 1000 m³ when `mRequiresSupplementalResource`; by-product = fuel per minute x `mByproductAmount`. Checked: Coal 15/min with 45 m³ water at 75 MW, Uranium Fuel Rod 0.2/min with 240 m³ water and 10 waste at 2500 MW. The Alien Power Augmenter has no `mFuel` list: its fuel is `mDefaultFuelClasses` (Alien Power Matrix, `FGItemDescriptorPowerBoosterFuel`), per minute = 60 / the fuel's `mBoostDuration` (12 s -> 5/min), shown with the fuel's `mBoostPercentage` (0.2 = +20 % grid boost) |
| Inventory | vehicles `mInventorySize`; Truck Station `mStorageInventorySize`; `mIsFluidStorageInventory` True or `mFreightCargoType` `FCT_Liquid`: a fluid tank whose capacity is **not in the Docs** (only in the description text) |
| Storage size | Drone Port and Freight Platform `mStorageSizeX` x `mStorageSizeY` (18, 48). The Drone Port has two inventories of 18 slots (outgoing and incoming); the Docs give only the one size, so the in-app wiki shows "Storage size: 18 slots" and nothing about the second inventory |
| Fuel inventory | `mFuelInventorySize`; Drone Port `mFuelStorageSizeX` x `mFuelStorageSizeY` |
| Vehicle fuel burn | `mManualFuelConsumption` (MW) |
| Power Storage | `mPowerStoreCapacity` (MWh), `mPowerInputCapacity` (MW) |
| Freight Platform | `mTimeToCompleteLoad`, `mTimeToCompleteUnload` (s) |

- **Build cost:** the `FGRecipe` whose single `mProduct` is the entry's descriptor (`Build_X_C` -> `Desc_X_C`; vehicles: the descriptor itself) and whose `mProducedIn` is the Build Gun (`BP_BuildGun_C`) or the Equipment Workshop (`BP_WorkshopComponent_C`, the Factory Carts); `mIngredients`. An entry without one fails the build.
- **Unlocked by:** every `FGSchematic` whose `mUnlocks` (`BP_UnlockRecipe_C`, `mRecipes`) lists the build recipe: `mDisplayName` (EN, DE), `mType` (`EST_Milestone`, `EST_Tutorial`, `EST_MAM`, `EST_ResourceSink` = AWESOME Shop, ...), `mTechTier`.
- **Recipes in a machine:** as for the production planner: `FGRecipe` whose `mProducedIn` names exactly one production building, in the planner's `GameRecipe` shape.
- **Order:** within a category by the tier of the first unlock (shop and unknown last), then the descriptor's `mMenuPriority`.
- **Wiki link:** `https://satisfactory.wiki.gg/wiki/<English display name without ™, spaces as _>`. All 49 titles resolve on the wiki (checked with the wiki's API on 2026-11-06; twelve are redirects to a section, e.g. Fluid Truck -> Truck, Miner Mk.2 -> Miner). No wiki text is copied (the wiki is CC BY-NC-SA).
- **Not in the Docs** (left out): dimensions (the clearance boxes in `mClearanceData` do not match the building sizes), conveyor and pipe ports, the maximum clock speed with Power Shards, vehicle speeds, the fuels vehicles accept, fluid capacities (Fluid Truck 3200 m³, Freight Car 2400 m³, stations; only in the descriptions), the Drone's fuel use (the Drone Port's `mTripPowerCost` and `mTripPowerPerMeterCost` have no documented unit), the pipeline pumps' head lift (only in the descriptions).
- **In the Docs but left out** (meaning or unit not clear from the data): the Radar Tower's `mRevealRadius`, the pipeline pumps' `mDesignPressure`/`mMaxPressure`/`mDefaultFlowLimit`, the Truck Station's `mLoadUnloadCycleLength`, the vehicles' `mAutopilotFuelConsumption`, extractor start-up times (`mExtractStartupTime`, negative for some).
- 1.2.5.0: 49 entries, 291 recipes, 169 items, about 165 KB.

## Rebuild after a game patch

Re-run the commands above against the new install, use the printed gameVersion as the folder name, and diff the class counts against this table. If the patch no longer applies, re-create it: add the `--extras-out` flag, and for every `BP_DropPod_C` / `BP_MercerShrine_C` export in the persistent level and the `_Generated_` cells write the data described above; then `--caves-out` and `--cave-geometry-out` as described in "Caves", `--heightmap-out` as in "Height map", `--map-areas-out` as in "Map areas" and `--transport-out` as in "Transport". After a patch also compare the Transport tables above with the new values (the build fails if Docs and blueprints disagree on inventory sizes or fluid capacities, and on a `transport.json` from a patch without `tractionSpeedLimit` and `droneFuelTypes`).
