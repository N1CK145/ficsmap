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
- Vehicle calculator ("Vehicles" in the Tools menu of the top bar): from the route length, the vehicle (Tractor, Truck, Explorer, Fluid Truck, Drone, Freight Car), the average speed and the stop time it computes how many vehicles a target throughput needs (rounded up, with the utilisation), or the throughput of a given number of vehicles, and an estimate of the fuel they burn per minute and per round trip. Self-driving wheeled vehicles burn fuel per distance driven (5 MJ per metre; any solid fuel, Packaged Fuel by default; the extra use of the Tractor and Explorer on climbs is not included); the drone burns a fixed amount per round trip plus some per metre flown (in MJ as players measured it) and takes its own seven fuels, Packaged Fuel by default. Without an item the result is in stacks per minute, with an item in items and stacks per minute, with a fluid in m³ per minute. Inventory slots, fluid capacities, stack sizes, fuel use and energy values and the stop times of Truck Station, Fluid Truck Station, Freight Platform and Drone Port come from the game's Docs files and paks. The speed defaults to the game's limit: the autopilot's straight-path limit, or the lower speed at which the engine's tractive effort ends (Tractor 70.6 km/h, Explorer 100.4 km/h), and for the drone the travel speed of its fuel; for the train you enter it. Needs a dataset built with `transport.json` (Docs folder plus the extractor's new `--transport-out`); older datasets show a notice instead.
- Extractor patch: `--transport-out` writes the vehicle values that are only in the paks (fluid stack multipliers, the drone's docking and take-off durations and its fuels with their travel speeds, the autopilot's straight-path speed limit and the speed where the tractive effort ends).
- Extractor patch: `--map-areas-out` writes the game's own map area raster with the area names in English and German (it turned out not to match the known biomes and is kept for reference).
- Coordinates under the mouse: bottom left on the map, X and Y in metres and Z, the height of the highest surface there (terrain, rocks, structures; no foliage). Z needs a dataset built with the extractor's height grid (patch flag `--heightmap-out`); it is loaded in 500 m tiles while you hover.
- Extractor patch: `--heightmap-out` writes height grids of the whole map (highest surface at 2 m, the landscape alone, foliage, and the game's own `HeightData_Test` texture).
- Extractor patch: `--cave-geometry-out` writes the 3D geometry around every cave as glTF binary files (one per cave), usable for 3D previews.
- Search in the middle of the top bar (`/` or Ctrl+K): collectibles by type name in English and German ("Somersloop", "blau"), by their label ("Dune Desert 3") or actor ID (`BP_WAT139`, also partial), biomes and caves by name (in both languages), and crash sites by what lies there, its threats or what the pod needs ("Modular Frame"). Case and accents do not matter; exact IDs come first, then prefixes, then other matches. While typing, the matches are highlighted on the map (a halo, drawn on top even if a filter hides them) and everything else fades. Choosing an item selects it and zooms to it, a biome scopes the map to it, a cave switches the cave layer on and fits the map to it, a crash site selects its pod. Arrow keys, Enter and Esc work as in any combobox; on mobile the search opens over the top bar from a button. Other features can add their own results (e.g. recipes later) through the new `searchProviders` extension point.
- Tool navigation in the top bar, next to the search: the map's switches (Quick Check, Caves, Heights, Resources) as buttons on wide screens and a "Tools" menu for the tools that open a window of their own (Planner, Vehicles, Machines); below 1280 px and on phones everything is in the "Tools" menu. Features add tools through the new `tools` extension point; a layer switch moves there with one line (`toggleTool()`), a tool with `action: true` goes into the menu.
- Resource nodes: a map layer (switch "Resources" in the top bar's tools) with all 459 resource nodes, 31 geysers and the 17 resource wells with their 118 extraction points. Each node shows its resource (colour and, zoomed in, a short label such as Fe or Cu) and its purity as 1, 2 or 3 pips (impure, normal, pure); hovering or clicking a node shows resource, purity and position. A "Resource nodes" panel in the sidebar filters by resource (Alt-click: only this one) and purity, with counts; the layer and its filters are remembered on the device. A save import also reads the save's resource and purity per node where the save sets one and the world shows those instead of the default map; nodes changed that way get an orange dot. A save without randomisation stores no purity at all, and the world keeps the default map. A world started with randomised nodes whose save holds only the settings and seed keeps the default map too; the panel and the import dialog then say so and name the settings as the game does (e.g. "Resource Node Randomization: Basic Resource Rich", in German "Zufällige Rohstoffvorkommen: „Reich: Grundressourcen“"). Resource names follow the game's own display names (German e.g. Caterium-Erz, Rohstoffvorkommen). Needs a dataset built with the extractor's `default-world.json` (`resource-nodes.json`); older datasets work as before without the layer.
- Resource nodes: after a save import the map shows which extractor stands on which node. Occupied nodes get a small tag with the building (Mk.1, Mk.2, Mk.3, Oil, Well, Pres for the resource well pressurizer, Geo, Port for portable miners) and one diamond per Power Shard; the node's info box lists building, clock speed and Power Shards as the save has them (portable miners, geothermal generators and resource well extractors cannot be overclocked and show neither; a well's clock speed and Power Shards are on its pressurizer). The "Resource nodes" panel gains an "All / Occupied / Free" filter with counts and a summary of the extractors per building and the Power Shards in them. The import sends these placements (node, building, clock speed, Power Shards) to the server, where they are stored per world and shown to every member; without an import nothing changes.
- Production planner ("Planner" in the Tools menu of the top bar): enter one or more items and how many per minute you need; the chain is resolved down to the extractors (miners, water and oil extractors, resource well extractors). Each step shows the building, the recipe and how many buildings (rounded up, with the exact number), what goes in and what comes out; the recipe can be switched per item, including alternates, by-product recipes and "supplied from outside". By-products count against what other steps need (Heavy Oil Residue from Plastic feeds Residual Fuel), so those steps make only the rest; what is left over is listed as surplus. Picking an unpacking recipe (Unpackage Fuel) supplies the packaged item from outside automatically instead of looping. Totals list raw resources with their extractors, items supplied from outside, surplus, buildings and power (a range for the Particle Accelerator, Converter and Quantum Encoder). Settings: miner level (Mk.1/2/3), extractor clock speed and node purity (impure ×0.5, normal ×1, pure ×2, factors from the Satisfactory wiki); every step can have its own clock speed (1 % to 250 %, with the Power Shards it needs) and node purity, production buildings included; power follows the game's power exponent. The minimum clock speed and the +50 % per Power Shard come from the game data, the 3 shard slots from the wiki. A resource well runs at the clock speed of its pressurizer, which applies to all its extractors: the Power Shards go into the pressurizer, and its power (150 MW at 100 %, scaled with the clock speed) is noted per well, apart from the total. Values are for the default game mode (game mode settings such as recipe costs are not taken into account). Loops in the recipe chain (e.g. Recycled Rubber and Recycled Plastic) are solved and marked; loops that use up as much as they make are reported. Names in English and German; the plan is remembered on the device. Needs `recipes.json` in the dataset, built from the game's `CommunityResources/Docs` (`npm run dataset -- ... --docs <dir>` or `npm run recipes`); older datasets work as before, the planner then says the data is missing.
- Machine and vehicle wiki ("Machines" in the Tools menu of the top bar): one entry per production building, extractor, generator, other powered machine and vehicle, grouped by category and searchable by English or German name. Each entry shows its stats (power use or production, clock speed range where the game lets you change it, Somersloop slots, extraction rate on a normal node, fuels per minute with water and waste, the Alien Power Matrix per minute with its boost, the geothermal average on a normal geyser, inventory or storage size, fuel burn, ...), the game's own description, the build cost, what unlocks it, the recipes that run in it and a link to the page on the Satisfactory wiki. All values come from the game's `CommunityResources/Docs` files; what they do not contain is left out. Needs a dataset built with `--docs` (`machines.json`, also `npm run machines`); without it the wiki says so.

### Changed

- Dataset build (`npm run dataset`): builds every part by default and stops with a list of the missing inputs instead of silently leaving parts out; `--only <parts>` builds just the named parts (e.g. `--only recipes,machines`).
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
