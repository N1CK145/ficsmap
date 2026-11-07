# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-11-03

### Added

- A footer with the version (links to its release page) and a link to the GitHub repository, always visible on every page, including the map view; on mobile the sheets sit on top of it.
- A language switch (EN | DE) in the header next to the account menu; the choice is remembered on the device and wins over the browser language.
- Routes: the drop pods' needs became a "Bring with you" list, like the game's to-do list. Items lying at the crash sites on the way (a pod's own site included, in route order) are counted in: each row shows only what is left to bring and where the rest lies, and fully covered items move to "Found on the way". Items can be ticked off; the ticks are remembered per route on the device. On desktop the list floats over the bottom right of the map, under the item panel, and collapses to its header when there is no room (or by hand); on mobile it stays in the route editor.
- Caves: a map layer (switch "Caves" in the top bar's tools) with the floor plans of the caves and their entrances, and a "Cave" section in the item panel for items inside a cave, with the distance to the nearest entrance. The caves are sampled from the game's 3D geometry (rock meshes, cave tunnel splines and landscape), located by the game's cave sound and fog volumes; entrances are where cave floor meets walkable open ground, one per opening. An item counts as in a cave if it lies on cave floor or deep under the landscape inside a cave volume (148 in 1.2.5.0, among them every collectible more than 5 m underground in a cave volume); caves whose hall lies under the landscape without a ceiling of its own in the geometry are found too. Needs a dataset built with the extractor's `caves.json` and cave geometry (patch flags `--caves-out`, `--cave-geometry-out`); older datasets work as before without the layer.
- Height layer: a switch "Heights" in the top bar's tools colours the map by the height of the highest surface (one blue scale, light = low, dark = high, fixed from -170 m to 470 m), with a legend. Zoomed out it is drawn from an 8 m overview, zoomed in from the 2 m tiles.
- Extractor patch: `--map-areas-out` writes the game's own map area raster with the area names in English and German (it turned out not to match the known biomes and is kept for reference).
- Coordinates under the mouse: bottom left on the map, X and Y in metres and Z, the height of the highest surface there (terrain, rocks, structures; no foliage). Z needs a dataset built with the extractor's height grid (patch flag `--heightmap-out`); it is loaded in 500 m tiles while you hover.
- Extractor patch: `--heightmap-out` writes height grids of the whole map (highest surface at 2 m, the landscape alone, foliage, and the game's own `HeightData_Test` texture).
- Extractor patch: `--cave-geometry-out` writes the 3D geometry around every cave as glTF binary files (one per cave), usable for 3D previews.
- Search in the middle of the top bar (`/` or Ctrl+K): collectibles by type name in English and German ("Somersloop", "blau"), by their label ("Dune Desert 3") or actor ID (`BP_WAT139`, also partial), biomes and caves by name (in both languages), and crash sites by what lies there, its threats or what the pod needs ("Modular Frame"). Case and accents do not matter; exact IDs come first, then prefixes, then other matches. While typing, the matches are highlighted on the map (a halo, drawn on top even if a filter hides them) and everything else fades. Choosing an item selects it and zooms to it, a biome scopes the map to it, a cave switches the cave layer on and fits the map to it, a crash site selects its pod. Arrow keys, Enter and Esc work as in any combobox; on mobile the search opens over the top bar from a button. Other features can add their own results (e.g. recipes later) through the new `searchProviders` extension point.
- Tool navigation in the top bar, next to the search: the map's switches (Quick Check, Caves, Heights) as buttons on wide screens, in a "Tools" menu below 1280 px and on phones. Features add tools through the new `tools` extension point; a layer switch moves there with one line (`toggleTool()`).

### Changed

- Quick Check moved from under the zoom buttons into the top bar's tool navigation. On mobile it keeps its round button over the map and is in the Tools menu too.
- Biomes: recalibrated from the Satisfactory wiki's biome map at full resolution (5000 px, about 1.5 m per pixel, placed exactly on the map) instead of the old hand-drawn outlines from a 1000-px copy with unverified bounds. Each pixel is matched to its biome's colour tint with the in-game map underneath taken out, so terrain shading does not matter. 21 biomes (Paradise Island belongs to Grass Fields as on the wiki); about 40 % of the items changed biome, so the numbers within biomes changed too. German biome names come from the game's own texts where the game has the name. Every larger part of a biome carries its name on the map, not only the largest. A remembered biome scope that the dataset no longer has is dropped; one that now points to a different biome has to be chosen again.
- Biomes: land the game itself counts as no man's land is no longer filled with the nearest biome, so the islands east of Swamp (left out of the wiki map since 2024-10-16) and untinted coastal strips, channels and lakes stay without a biome; the void along the map's edge (highest surface below -200 m) has none either. Items there keep the nearest biome; no item changed its biome.
- German UI: the game's own German terms: Elektroschnecke (was Power-Schnecke), Energiefragment (was Power-Splitter), Landekapsel (was Kapsel/Pod) and Absturzstelle (was Absturzort).
- Drop-pod requirements and the items at crash sites carry the game's German item names (from the game's Docs), so the German UI shows "Schrauben" instead of "Screws". Crash-site items need a dataset built with this version; older datasets show the English name.
- Extractor patch: the item of a loose item pickup is read from the pickup itself (`mPickupItems.Item`) instead of being guessed from its mesh.

### Fixed

- 10 drop pods showed a cost (power or items) although they need nothing: the game ignores the leftover values in a pod whose cost type is None. Every pod's requirement now comes from the game files.
- Crash sites: 43 items lying around showed the wrong item (for example Packaged Liquid Biofuel shown as Nuke Nobelisk or Turbo Motor, Wire as Quickwire), and 4 were missing (a Supercomputer, Rifle Ammo and two Medicinal Inhalers).

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
