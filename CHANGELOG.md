# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-11-03

### Added

- A footer with the version (links to its release page) and a link to the GitHub repository, always visible on every page, including the map view; on mobile the sheets sit on top of it.
- A language switch (EN | DE) in the header next to the account menu; the choice is remembered on the device and wins over the browser language.
- Routes: the drop pods' needs became a "Bring with you" list, like the game's to-do list. Items lying at the crash sites on the way (a pod's own site included, in route order) are counted in: each row shows only what is left to bring and where the rest lies, and fully covered items move to "Found on the way". Items can be ticked off; the ticks are remembered per route on the device. On desktop the list floats over the bottom right of the map, under the item panel, and collapses to its header when there is no room (or by hand); on mobile it stays in the route editor.
- Caves: a map layer (button "Caves" under the zoom buttons) with the floor plans of the caves and their entrances, and a "Cave" section in the item panel for items inside a cave, with the distance to the nearest entrance. The caves are sampled from the game's 3D geometry (rock meshes, cave tunnel splines and landscape), located by the game's cave sound and fog volumes; entrances are where cave floor meets walkable open ground. Needs a dataset built with the extractor's `caves.json` and cave geometry (patch flags `--caves-out`, `--cave-geometry-out`); older datasets work as before without the layer.
- Height layer: a switch "Heights" under the zoom buttons colours the map by the height of the highest surface (one blue scale, light = low, dark = high, fixed from -170 m to 470 m), with a legend. Zoomed out it is drawn from an 8 m overview, zoomed in from the 2 m tiles.
- Extractor patch: `--map-areas-out` writes the game's map area raster (which named region every spot of the map belongs to, with the names in English and German).
- Coordinates under the mouse: bottom left on the map, X and Y in metres and Z, the height of the highest surface there (terrain, rocks, structures; no foliage). Z needs a dataset built with the extractor's height grid (patch flag `--heightmap-out`); it is loaded in 500 m tiles while you hover.
- Extractor patch: `--heightmap-out` writes height grids of the whole map (highest surface at 2 m, the landscape alone, foliage, and the game's own `HeightData_Test` texture).
- Extractor patch: `--cave-geometry-out` writes the 3D geometry around every cave as glTF binary files (one per cave), usable for 3D previews.
- Production planner (button "Planner" in the header): enter one or more items and how many per minute you need; the chain is resolved down to the extractors (miners, water and oil extractors, resource well extractors). Each step shows the building, the recipe and how many buildings (rounded up, with the exact number), what goes in and what comes out; the recipe can be switched per item, including alternates, by-product recipes and "supplied from outside". By-products count against what other steps need (Heavy Oil Residue from Plastic feeds Residual Fuel), so those steps make only the rest; what is left over is listed as surplus. Picking an unpacking recipe (Unpackage Fuel) supplies the packaged item from outside automatically instead of looping. Totals list raw resources with their extractors, items supplied from outside, surplus, buildings and power (a range for the Particle Accelerator, Converter and Quantum Encoder). Settings: miner level (Mk.1/2/3), extractor clock speed and node purity (impure ×0.5, normal ×1, pure ×2, factors from the Satisfactory wiki); every step can have its own clock speed (1 % to 250 %, with the Power Shards it needs) and node purity, production buildings included; power follows the game's power exponent. The minimum clock speed and the +50 % per Power Shard come from the game data, the 3 shard slots from the wiki. A resource well runs at the clock speed of its pressurizer, which applies to all its extractors: the Power Shards go into the pressurizer, and its power (150 MW at 100 %, scaled with the clock speed) is noted per well, apart from the total. Values are for the default game mode (game mode settings such as recipe costs are not taken into account). Loops in the recipe chain (e.g. Recycled Rubber and Recycled Plastic) are solved and marked; loops that use up as much as they make are reported. Names in English and German; the plan is remembered on the device. Needs `recipes.json` in the dataset, built from the game's `CommunityResources/Docs` (`npm run dataset -- ... --docs <dir>` or `npm run recipes`); older datasets work as before, the planner then says the data is missing.

### Changed

- Biomes now come from the game's own map areas (when the extractor output has `map-areas/`) instead of hand-drawn outlines: exact borders at about 1.8 m and the game's 18 named regions. Names are the game's own display names, in English and German (e.g. Felswüste, Dschungeltürme). Western Beaches, Snaketree Forest, Eastern Dune Forest and Paradise Island are gone (no area on the game's map has them); about 40 % of the items changed biome, so the numbers within biomes changed too. Land the game marks as no man's land (about 1 km² of coastal strips and islands) joins the nearest biome. Every larger part of a biome now carries its name on the map, not only the largest. A remembered biome scope that the dataset no longer has is dropped; one that now points to a different biome has to be chosen again.

## [0.1.1] - 2026-11-03

### Added

- Screenshots of the map and the route planner in the README.

### Changed

- Test runner vitest 3.2 → 5.1 (security update of a development dependency; replaces Dependabot PRs #1–#3).
- CodeQL code scanning (security and quality queries) on pull requests, pushes and weekly; Dependabot version updates for npm, GitHub Actions and the Docker base image, grouped.

### Security

- The save-parsing web worker only loads the app's own dataset file (`/data/<version>/collectibles.min.json` on the same origin) and ignores messages from other origins.
- Fixed in development dependencies only (not in the app or the image): tinypool prototype pollution, vitest path traversal and mock-registration code injection.

## [0.1.0] - 2026-11-03

First public release.

### Added

- Interactive map of Satisfactory (game version 1.2.4.1 data) with the game's icons for Blue, Yellow and Purple Power Slugs, Somersloops, Mercer Spheres and drop pods (hard drives).
- Discord login. Accounts are invite-only; owners are set with `OWNER_DISCORD_IDS`.
- Worlds shared with friends through invite links (one use each, valid for 7 days, revocable).
- Live sync between all members of a world over Server-Sent Events.
- Save-file import. The save is parsed in the browser; only the names of the collected items are sent to the server.
- Conflict review after an import, per item or in bulk, with undo.
- Quick Check mode to tick off markers with one click.
- Filters per type, biome scope and progress per biome.
- Item panel with drop-pod requirements and crash-site information (items lying around, threats, notes).
- Route planner with up to 30 stops, order optimisation, "next stop" and a combined list of what the route's drop pods need.
- List view of all collectibles.
- Mobile layout with a bottom sheet.
- English and German user interface.
- Docker image `ghcr.io/n1ck145/ficsmap` without game data.
- Version guard: automatic database backup before an upgrade, maintenance mode and guided rollback after a downgrade.
- Daily database backups (14 kept).
