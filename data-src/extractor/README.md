# Extractor output (data-src/extractor)

Raw game data for ficsmap, read from the game client's paks. Nothing here is hand-edited.

**Not in the repository:** the extractor output (`<game-version>/`) is game data and git-ignored. Generate it from your own install with the steps below, keep it in this folder or anywhere else, and point `npm run dataset -- --extractor <dir>` at it. This folder only ships this README, the extractor patch and `item-names.json`.

## Provenance

- Tool: [SatisfactoryTools/AssetsExtractor](https://github.com/SatisfactoryTools/AssetsExtractor) `world-extractor-net`, branch `master`, upstream commit `19e3010c781d4250242d4cc68b6c5c8c340fdea0`.
- Local patch: `world-extractor-extras.patch` (git diff against that commit). Adds an optional `--extras-out <file>` flag and exports the item icons of the five pickup types (`Desc_Crystal_C`, `Desc_Crystal_mk2_C`, `Desc_Crystal_mk3_C`, `Desc_WAT1_C`, `Desc_WAT2_C`, from each descriptor's `mPersistentBigIcon`) into `map/icons/`; the map markers use them. Apply with `git apply` in the AssetsExtractor checkout.
- Game: Steam install, GameVersion `1.2.4.1` (CL 513885, UE 5.6), engine detected as `GAME_UE5_6`. Output folder: `1.2.4.1/`.
- Build and run (.NET 10 SDK needed):

```
cd AssetsExtractor && git checkout 19e3010c781d4250242d4cc68b6c5c8c340fdea0 && git apply <repo>/data-src/extractor/world-extractor-extras.patch
cd world-extractor-net && dotnet build -c Release
dotnet run -c Release --no-build -- --install-dir <game install> --out /tmp/default-world.json \
  --collectibles-out <repo>/data-src/extractor/1.2.4.1/collectibles.json \
  --map-out <repo>/data-src/extractor/1.2.4.1/map \
  --extras-out <repo>/data-src/extractor/1.2.4.1/extras.json
```

- Printed: `Collectibles: 7653 pickups (699 with a known item), 118 drop pods, 2277 creature spawners`, `Map: 968e47122e1f868c (8192px, zoom 0-5, 30 icons)`, `Extras: 118 drop pods, 298 mercer shrines`. Runs in about 25 s. The `usmap` warning is harmless.

## Files in `1.2.4.1/`

- `collectibles.json`: `{gameVersion, pickups, dropPods, creatureSpawners}`, entries `{name, class, location:[x,y,z], item?, amount?}`. `name` is the actor name saves use.
- `map/`: `map.json` (world rectangle x -324698.16..425301.84, y -375000..375000; 8192 px, tile 256, zoom 0-5, webp), `tiles/{z}/{x}/{y}.webp`, `icons/`. About 9.9 MB.
- `extras.json`: from the patch. `{dropPods: {[actorName]: {costType, item, amount, power}}, shrines: [{name, attachedTo, location}]}`.

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

## Rebuild after a game patch

Re-run the commands above against the new install, use the printed gameVersion as the folder name, and diff the class counts against this table. If the patch no longer applies, re-create it: add the `--extras-out` flag, and for every `BP_DropPod_C` / `BP_MercerShrine_C` export in the persistent level and the `_Generated_` cells write the data described above.
