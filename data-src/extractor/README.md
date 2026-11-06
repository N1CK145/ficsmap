# Extractor output (data-src/extractor)

Raw game data for ficsmap, read from the game client's paks. Nothing here is hand-edited.

**Not in the repository:** the extractor output (`<game-version>/`) is game data and git-ignored. Generate it from your own install with the steps below, keep it in this folder or anywhere else, and point `npm run dataset -- --extractor <dir>` at it. This folder only ships this README, the extractor patch and `item-names.json`.

## Provenance

- Tool: [SatisfactoryTools/AssetsExtractor](https://github.com/SatisfactoryTools/AssetsExtractor) `world-extractor-net`, branch `master`, upstream commit `19e3010c781d4250242d4cc68b6c5c8c340fdea0`.
- Local patch: `world-extractor-extras.patch` (git diff against that commit). Adds the optional flags `--extras-out <file>`, `--caves-out <file>`, `--cave-geometry-out <dir>` (see "Caves" below), `--heightmap-out <dir>` (see "Height map" below) and `--map-areas-out <dir>` (see "Map areas" below), and exports the item icons of the five pickup types (`Desc_Crystal_C`, `Desc_Crystal_mk2_C`, `Desc_Crystal_mk3_C`, `Desc_WAT1_C`, `Desc_WAT2_C`, from each descriptor's `mPersistentBigIcon`) into `map/icons/`; the map markers use them. Apply with `git apply` in the AssetsExtractor checkout.
- Game: Steam install, GameVersion `1.2.4.1` (CL 513885, UE 5.6), engine detected as `GAME_UE5_6`. Output folder: `1.2.4.1/`.
- Build and run (.NET 10 SDK needed):

```
cd AssetsExtractor && git checkout 19e3010c781d4250242d4cc68b6c5c8c340fdea0 && git apply <repo>/data-src/extractor/world-extractor-extras.patch
cd world-extractor-net && dotnet build -c Release
dotnet run -c Release --no-build -- --install-dir <game install> --out /tmp/default-world.json \
  --collectibles-out <repo>/data-src/extractor/1.2.4.1/collectibles.json \
  --map-out <repo>/data-src/extractor/1.2.4.1/map \
  --extras-out <repo>/data-src/extractor/1.2.4.1/extras.json \
  --caves-out <repo>/data-src/extractor/1.2.4.1/caves.json \
  --cave-geometry-out <repo>/data-src/extractor/1.2.4.1/cave-geometry \
  --heightmap-out <repo>/data-src/extractor/1.2.4.1/heightmap \
  --map-areas-out <repo>/data-src/extractor/1.2.4.1/map-areas
```

The cave geometry export needs about 10 GB of memory; cap the .NET heap so a run cannot take the machine down: `DOTNET_GCHeapHardLimit=0x280000000` (10 GiB). An uncapped run reached 24 GB once and was killed. A full run takes about 3 minutes.

- Printed: `Collectibles: 7653 pickups (699 with a known item), 118 drop pods, 2277 creature spawners`, `Map: 968e47122e1f868c (8192px, zoom 0-5, 30 icons)`, `Extras: 118 drop pods, 298 mercer shrines`. Runs in about 25 s. The `usmap` warning is harmless.

## Files in `1.2.4.1/`

- `collectibles.json`: `{gameVersion, pickups, dropPods, creatureSpawners}`, entries `{name, class, location:[x,y,z], item?, amount?}`. `name` is the actor name saves use.
- `map/`: `map.json` (world rectangle x -324698.16..425301.84, y -375000..375000; 8192 px, tile 256, zoom 0-5, webp), `tiles/{z}/{x}/{y}.webp`, `icons/`. About 9.9 MB.
- `extras.json`: from the patch. `{dropPods: {[actorName]: {costType, item, amount, power}}, shrines: [{name, attachedTo, location}]}`.
- `caves.json`, `cave-geometry/`: from the patch (`--caves-out`, `--cave-geometry-out`), see "Caves".
- `heightmap/`: from the patch (`--heightmap-out`), see "Height map".
- `map-areas/`: from the patch (`--map-areas-out`), see "Map areas".

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
- The struct is saved as a delta, so absent fields mean "default". Distribution over 118 pods: `Item` 67, `Power` 23, `CostType` absent (`"None"` in the file) 10, `mUnlockCost` absent entirely 18. A pod with an explicit `costType` is `Item` (amount of `item`) or `Power` (`power`, can also carry a leftover item). With `"None"` the pod has either an item (6) or only power (4); take whichever is set. The 18 pods without any `mUnlockCost` have `item null, amount 0, power 0`; meaning of that (no cost or a runtime default) is **unverified**.
- `location` is not written for pods: for cell actors the root component's RelativeLocation is not the world position. Use the `collectibles.json` location.

## Mercer shrines (`extras.json`)

- 298 `BP_MercerShrine_C` actors, all in the streaming cells (none in the persistent level), exactly one per Mercer Sphere.
- Each shrine's RootComponent is attached to the sphere's mesh: `attachedTo` is the sphere actor name (`BP_WAT2_C_UAID_...`, 298 distinct, all of them found in `collectibles.json` as `BP_WAT2_C`). That is a direct, exact pairing, so no distance matching is needed.
- `location` = parent RelativeLocation + own RelativeLocation, ignoring parent rotation and scale: it is only approximate (can be off by up to about 1000 units). Use the sphere location instead. The offset in the save (112-116 units, about 1.1 m) is consistent with a 100 units = 1 m scale (UE default, centimetres).
- Shrine actor names in the save (`BP_MercerShrine_C_UAID_...`) equal `name` in `extras.json`.

## Power Slug yields

Source: https://satisfactory.wiki.gg/wiki/Power_Slug, accessed 2026-11-03: blue = 1 Power Shard, yellow = 2, purple = 5. Slug counts on that page: 596 blue, 389 yellow, 257 purple (equal to the extracted counts).

## Units

World units are UE centimetres, 100 units = 1 m (UE convention; consistent with the shrine offset above; the map covers 750000 x 750000 units = 7.5 km, which was not checked against an external source).

## Caves (`caves.json`, `cave-geometry/`)

The game has no "cave" object with an outline or entrances. The cave layer is derived from what it has, in two steps.

**1. Cave volumes (`caves.json`).** `FGAmbientVolume` actors whose `mAmbientSettings` class name contains `Cave` but not `CaveWind` (`AS_CaveLarge_C`, `AS_CaveSmall_C`, `AS_CaveDynamic_C`, `AmbientSettings_Caves_*_C`, `AmbientSettings_Cave_Drips_*_C`, `CaveWaterfall_Rework_Thin_C`), and `FGAtmosphereVolume` actors with `cave` in the actor name (`Atmosphere_SwampCave`, ...). These are the zones in which the game switches to cave sound and fog: rough hand-placed boxes (94 of 188 are a single box) that say where caves are and at what height, but not their shape. Written per convex collision element (`BrushBodySetup.AggGeom.ConvexElems`, transformed with the brush component's location, rotation and scale) as 2D hull in world X/Y plus Z range. Two volumes contain one broken element each (one reaches about 300 m out to sea, one about 396 km up); elements more than 5x their volume's median element on any axis are ignored (`cleanElements`).

**2. Cave geometry (`cave-geometry/`).** Overlapping volumes (within 10 m) are grouped into caves (73). For each cave, everything solid in its box (volumes' bounds grown by 30 m sideways, 30 m down, 60 m up) is written as one glTF 2.0 binary, `<id>.glb`, plus `index.json` (id, file, box in UE cm, volume names, instance and triangle counts):

- every `StaticMeshComponent` (first LOD of the render mesh; the mesh from the component's template if the instance has none) with its world transform resolved up the `AttachParent` chain; one glTF mesh per static mesh, one node per instance, node `extras` with actor and mesh path;
- every `SplineMeshComponent`, deformed like `USplineMeshComponent` (cubic Hermite between `SplineParams` start/end, roll and scale interpolated, forward axis X) and written in world coordinates. These are the tunnel floors of the 61 `BP_CaveFloor_C` actors: the first segment uses `CaveEntrance_01` (54), the last often `CaveExit_01` (40), the rest `CaveTunnel_01` (79). Those meshes sit at every spline end, also inside caves, so they are not entrances by themselves;
- the landscape inside the box as a 1 m grid (heightmap decoded: `((R << 8 | G) - 32768) / 128 * scale.Z + location.Z`), without the quads the visibility layer marks as holes.

Left out: HLOD proxies (`WPHLOD*`), water, river, fog and cave-fog planes, the sky sphere (12 288 km) and planets, flying creatures, pickups and plants, and anything larger than 5 km. Foliage instances (small rocks, plants) are not included either.

glTF axes: metres, Y up, `(x, y, z) = (UE X, UE Z, UE Y) / 100`; front faces counter-clockwise (UE's own winding stays correct under the axis swap; checked: landscape normals all up, rock normals mostly outwards). The files open in any glTF viewer (three.js, Blender) for 3D previews of a cave. 1.2.5.0: 73 caves, 11 757 mesh instances, 57.2 million triangles, 384 MB.

**Sampling (dataset build, `scripts/cave-geometry.ts`).** A vertical ray per 1 m cell collects every non-wall surface (facing from the triangle normal). Walkable floors are upward surfaces with at least 2 m of air above; floors under an upward surface are buried (earth under the landscape over a buried rock) and ignored. A floor is *cave* if the surface ending its air faces down (a rock ceiling seen from inside) and it lies in the volumes' height band (grown 30 m sideways, 3 m down, so that mouths just outside a volume are found); connected cave floor under 200 m² is dropped (overhangs, gaps between rocks). *Outside* is open floor (sky above) connected over open floor to the edge of the box, steps up to 1.5 m. An *entrance* is cave floor next to outside floor, or within 15 m of it over covered non-cave floor (a mouth under an overhang); mouth cells within 20 m and 3 m height are one entrance, mouths under 3 cells are dropped. Outlines: the cave floor cells with gaps under 6 m closed (dilate and erode with a 3 m disc) and holes up to 1000 m² filled (rocks lying in the cave, pillars; a rock has its own floor on top, too small to count as cave), traced along cell edges, simplified (Douglas-Peucker, 1 m), corners cut once (Chaikin), rings under 20 m² dropped; larger holes are kept (even-odd fill). In a cave with an entrance, zones of that area (8-connected) without one are dropped (gaps under rocks beside the cave, parts reached only through openings too small to count); a cave without any found entrance (e.g. reached through a shaft or water) is kept whole. Finally the area is clipped to the volumes' 2D hulls: only where the game itself plays cave sound and fog counts as cave, so an entrance may lie a few metres outside the drawn area. Entrances use the unfilled cave floor. An item is *in a cave* if a cave floor in its cell or a neighbour, inside the final area, lies at most 3 m below it with its ceiling at most 1 m below it.

Result for 1.2.5.0 (build about 45 s): 71 caves (of 73 groups; two have no cave floor inside their volumes), 174 entrances, 122 tracked collectibles in caves (56 blue, 15 yellow, 18 purple slugs, 14 Somersloops, 19 Mercer Spheres, no drop pods), `caves.geojson` about 275 KB (75 KB gzip). Checked by eye against the map and the in-game knowledge of the maintainer on the north-west Rocky Desert cave system (cave-002: winding tunnels under the landscape and a hall about 100 m high, confirmed by a vertical section of the geometry); other caves are unchecked.

Rejected first approach (for the record): cave = the volume hulls, entrance = holes in the landscape near a volume. The hulls are boxes, and the landscape holes are mostly cut under rock meshes, not openings (37 of 147 such "entrances" lay deep inside a cave).

`caves.json` and `cave-geometry/` were extracted from GameVersion **1.2.5.0** (Steam install, 2026-11-05). Against the 1.2.4.1 output it has the same map id (`968e47122e1f868c`), identical drop pods, extras and tracked collectibles (only 4 loose item pickups and 1 creature spawner differ), so they are used with the 1.2.4.1 dataset: `npm run dataset -- ... --caves <caves.json> --cave-geometry <dir>` (default: both inside `--extractor`).

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

The biomes. The game decides which region name the HUD shows from the `FGMapAreaTexture` asset `/Game/FactoryGame/Interface/UI/Minimap/MapAreaPersistenLevel/MapareatexturePersistentLevel`: `mAreaData`, a 4096 x 4096 byte raster (`mDataWidth` 4096, row-major) of palette indices, and per index `mColorPalette` (a colour) and `mColorToArea` (`MapArea` class, e.g. `Area_RedBambooFields_2_C`, and the area's pixel bounds). `--map-areas-out` writes the raster as is (`areas.u8`) and `areas.json` (width, height, per index colour, class and bounds).

- **Use:** the level's minimap capture actor (`BP_MinimapCaptureActor_C`) references the asset as `mMapAreaTexture`, so it is the live data, not a leftover. **Extent:** not in the asset. It is the minimap capture's square (the same as `map/map.json`), about 1.83 m per pixel, row 0 = min Y. Checked by drawing the area borders over the map image at full resolution: they follow cliff edges, rivers and island coasts with no visible offset (2026-11-06).
- **Names:** the game's display name of each area class: its class default's `mDisplayName` is a string table entry (table `World_Data`, keys `Locations/<Name>`), resolved by the extractor from `FactoryGame/Content/Localization/AllStringTables/{en-US,de}/AllStringTables.locres` into `name` and `nameDe` in `areas.json`. The class names are misleading and must not be used: `Area_Savanna_1/2_C` are shown as Rocky Desert, `Area_RedJungle_2_C` as Jungle Spires, `Area_crater_1_C` as Blue Crater, `Area_crater_2_C` as Crater Lakes, `Area_DesertCanyons_*` as Desert Canyon, `Area_MazeCanyons_*` as Maze Canyon. Areas with the same name are one biome. `Locations/NoMansLand` (sea, the map's edge) and the unused entry `None` are no biome. `Area_EasternDuneForest_1` has a name (Eastern Dune Forest) but no palette entry, so no area on the map. German names come from the same table (Felswüste, Dschungeltürme, ...). `scripts/map-areas.ts` falls back to the class name only for extractor output without names.
- **Order:** the palette order, which runs roughly north to south.
- **Rocky Desert** is the largest biome: besides the west it covers the far north (above Spire Coast), the western and eastern islands (palette index 4) and, through the two `Area_Savanna_*` classes, an area west of Northern Forest and one south of Titan Forest. Kept as the game has it.
- **Land without an area:** the game marks some land as no man's land too (coastal strips in the east, north and west, the strip east of Swamp at the south-east edge, a small island in the far south-east; 1.04 km² in 1.2.5.0). With the height grid (`heightmap/`) present, every such pixel whose highest surface is above -15 m (the sea surface is at about -17 m) joins the biome of the nearest biome pixel (breadth-first over the raster), so no land on the map is without a name. Without the height grid it stays without a biome.
- **Items on no man's land** (15 in 1.2.5.0: underwater pickups, coastal rocks, all within 300 m of land) get the nearest biome within 500 m (`AREA_SNAP`).
- **Outlines** (`biomes.geojson`): each biome's pixels traced along pixel edges (`scripts/trace.ts`), Douglas-Peucker 1.5 m, rings under 200 m² dropped (stray pixels; the items there still get their biome from the raster). 1.2.5.0: 18 biomes, about 33 000 points. The map names every part of a biome of at least 0.13 km² (`labelPoints` in `src/web/features/biomes/useBiomes.ts`), so a biome in several pieces (Rocky Desert: west, far north, eastern islands) is named on each.

**Against the hand-drawn biomes** (the previous source, `data-src/biomes/biomes.editor.geojson`): 62 % of the 1764 items had the biome the game gives them (66 % counting Desert Canyons/Maze Canyons as the game's Desert Canyon/Maze Canyon). The largest moves: Spire Coast to Rocky Desert (140, the far north), to Desert Canyon (46) and to Dune Desert (42, the east coast, which the game's map gives to Dune Desert down to Swamp). Biomes the game does not have on its map: Western Beaches, Snaketree Forest, Eastern Dune Forest (its area is mostly the game's Rocky Desert via `Area_Savanna_2`, Titan Forest and Abyss Cliffs), Paradise Island.

1.2.5.0 items per biome: Dune Desert 177, Rocky Desert 312, Spire Coast 238, Desert Canyon 87, Northern Forest 61, Swamp 89, Lake Forest 44, Crater Lakes 69, Maze Canyon 30, Red Bamboo Fields 49, Titan Forest 175, Red Jungle 63, Jungle Spires 66, Western Dune Forest 45, Abyss Cliffs 72, Grass Fields 86, Blue Crater 66, Southern Forest 35.

## Rebuild after a game patch

Re-run the commands above against the new install, use the printed gameVersion as the folder name, and diff the class counts against this table. If the patch no longer applies, re-create it: add the `--extras-out` flag, and for every `BP_DropPod_C` / `BP_MercerShrine_C` export in the persistent level and the `_Generated_` cells write the data described above; then `--caves-out` and `--cave-geometry-out` as described in "Caves", `--heightmap-out` as in "Height map" and `--map-areas-out` as in "Map areas".
