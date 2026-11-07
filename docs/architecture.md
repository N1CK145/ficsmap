# Architecture

A short overview for contributors. It describes how ficsmap is put together and where things live. For setup and the branch workflow, see the [README](../README.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

## Overview

```
Browser (React SPA + Leaflet)            Server (Node 24, Fastify)            Storage
 ├─ features (map, panel, routes, ...) ─HTTP─► http ─► domain (rules) ──► SQLite (app.db)
 ├─ save.worker (save parser)                  auth (Discord OAuth2) ◄──► discord.com
 └─ SSE client ◄───────────SSE──────────────── sse hub (per world)
                                               static: SPA, dataset, tiles
```

One npm package, one process, one container. The server serves the API, the built SPA and the dataset files.

## Repository layout

```
src/shared/     types and pure logic used by server and web
src/server/     Fastify server
src/web/        React SPA (Vite root)
scripts/        build-dataset.ts (dataset build, including resource-nodes.json), cave-geometry.ts (cave sampling for it), heightmap.ts (height map tiles for it), map-areas.ts (biomes from the game's map areas), game-docs.ts, transport.ts, recipes.ts and machines.ts (vehicle, item, recipe and machine data from the game's Docs files), icons.ts (the dataset part `icons`: pictures of items, machines and vehicles from the extractor's `--icons-out`), trace.ts (outline tracing), inspect-save.ts (dump a save for checks)
data-src/       extraction tooling and notes (extractor/README.md, the AssetsExtractor patch, item names)
test/           unit/, api/, web/, fixtures/
data/           local datasets, data/<game-version>/ (git-ignored)
```

### src/shared

- `collectibleTypes.ts`: the type registry (blue/yellow/purple slug, Somersloop, Mercer Sphere, hard drive). Each entry has its id, label key, marker style and the class matcher used by the dataset build. Sidebar, filters, markers, list view, counts and routes all iterate over it.
- `dataset.ts`: the dataset format and `indexDataset()` (lookup by actor name, aliases).
- `extract.ts`: turns a parsed save into the list of collected actor names.
- `route.ts`: route length and the optimiser (nearest neighbour, then 2-opt and Or-opt). `MAX_ROUTE_STOPS = 30`.
- `geo.ts`: world to map coordinates (100 world units = 1 m), point-in-polygon.
- `biomes.ts`: loads the hand-drawn biome polygons (last fallback) and assigns items to them. The primary source is the biome raster classified from the wiki's biome map (`scripts/wiki-biomes.ts`, read by the build with `--biome-raster`), then the game's map areas (`scripts/map-areas.ts`); both give biomes, outlines (traced with `scripts/trace.ts`) and item assignment from the raster.
- `caves.ts`: the extractor's cave volumes and the `caves.geojson` format (the sampling itself is in `scripts/cave-geometry.ts`).
- `resourceNodes.ts`: the `resource-nodes.json` format, the purity mapping (the game spells `RP_Inpure`), the layer's filter (resource, purity, occupied/free) and counts, reading node overrides, randomisation settings and the extractors on nodes (building, clock speed, Power Shards) from a parsed save, applying a world's overrides to the default nodes, and the extractor summary.
- `heightmap.ts`: the height map tile format (`height/meta.json`, delta-coded int16 tiles in gzip) and the cell lookup.
- `transport.ts`: the vehicle calculator: the `transport.json` format and the pure maths (round trip, vehicles for a target rate, rate for a number of vehicles, fuel per minute).
- `recipes.ts`: the `recipes.json` format (items, production recipes with alternates, production buildings, extractors, the resource well pressurizer, clock speed values) and `indexRecipes()` (producers per item with the default first, consumers, extractors per resource, `recipeTerms()` for a search). Reusable beyond the planner.
- `machines.ts`: the `machines.json` format of the machine and vehicle wiki, its stats rows, search, the entry's descriptor class (its picture), and the tier filter (`tierOptions`, `matchesTiers`, `toggleTier`, `upToTier`: groups `T0`…`T9` from the entry's unlocks, the HUB upgrades counting as tier 0, plus MAM, AWESOME Shop and other).
- `icons.ts`: the picture index of a dataset (`icons/items/index.json`: sizes and descriptor classes), file paths and the size to load for a display size.
- `planner.ts`: the production planner's core, pure: targets and choices in, steps (building, recipe, counts, rates, power) and totals out. One balance per item, solved as a linear system, so loops in the recipe graph need no recursion; loops that cannot work are reported. By-products enter the balance of their item; a step they oversupply gets no buildings and its balance becomes "at least the demand" (repeated until none is left; two steps running the same recipe are not coupled). Clock speed per step (`clockLimits`: minimum and +50 % per Power Shard from the data, up to 3 shards, so 1 %–250 %) and node purity per step; a resource well step runs at its pressurizer's clock speed (the shards and the pressurizer's power, per well, are reported apart from the totals' power); a picked recipe whose ingredient's default recipe would need the picked item back makes that ingredient "supplied from outside" (`auto: 'loop'`). Default per item: extract a resource (solids with the miner setting), else the first of `rankProducers` (main product before by-product, standard before alternate, unpacking last), else "supplied from outside".
- `api.ts`, `sse.ts`: DTOs and the SSE event union, shared by server and client.
- `i18n.ts`: locale detection, used by the SPA and the server-rendered invite page.

### src/server

```
main.ts         start-up: config, database, dataset, app, housekeeping
app.ts          Fastify instance, global hooks (CSRF, headers, rate limit, errors), route registration
config.ts       environment parsing (zod)
db/             db.ts (open, WAL, foreign keys), migrations.ts
auth/           discord.ts (OAuth client), session.ts, guards.ts (requireMember, requireOwner)
domain/         business rules without HTTP: users, worlds, marks, importSave, invites, routes, resourceNodes
http/           thin route handlers, one file per area
sse/hub.ts      in-memory fan-out of world events
version/        app version, version guard, maintenance-mode app, rollback command
housekeeping.ts hourly purge of sessions and used invites, daily backup
```

Rules live in `domain/`. Handlers in `http/` parse the request with zod, call the domain and broadcast SSE events. A feature with its own data adds a migration, a domain file and an http file.

### src/web

```
main.tsx, App.tsx, router.tsx
app/            api client, query keys, zustand store, i18n (en.json, de.json), theme.css, feature.ts
components/     shared primitives: Button, IconButton, Dialog, ConfirmDialog, Toast, Panel, ...
features/       one folder per feature
save.worker.ts  save parsing in a Web Worker
```

Features are modules that plug into extension points. `src/web/app/feature.ts` defines `FeatureModule`:

- `routes`: extra pages
- `sidebarPanels`: panels in the sidebar (and the mobile bottom sheet)
- `mapLayers`, `mapControls`: components inside the Leaflet map
- `mapOverlays`: free-standing boxes over the map that position themselves (e.g. the route's "Bring with you" list)
- `mapModes`: exclusive click modes (inspect, Quick Check, route editing)
- `itemDetailSections`, `itemActions`: content and buttons in the item panel
- `headerItems`: things in the top bar; `slot: 'center'` puts one in the middle (the search), the default `start` after the world name
- `tools`: switches and actions in the top bar's tool navigation (see below)
- `searchProviders`: sources of results for the header search (see below)
- `settingsSections`
- `sseHandlers`: reactions to server events

All features are listed once in `src/web/features/index.ts`. `collect()` flattens one extension point over all features and sorts by `order`. The current features are `worlds`, `marks`, `live`, `map`, `progress`, `biomes`, `caves`, `coords`, `resourceNodes`, `itemPanel`, `quickCheck`, `routes`, `import`, `conflicts`, `sharing`, `listView`, `search`, `vehicleCalc`, `machineWiki` and `planner` (production planner: an action tool and a wide dialog; its open state is a `{ visible, toggle }` store). The vehicle calculator (`vehicleCalc`) keeps its own open state and form in `useVehicleCalc`; anything else can open it with `useVehicleCalc.getState().show(routeMeters?)`. The machine wiki (`machineWiki`) likewise keeps its open state, selection, search and tier filter (remembered per device) in `useMachineWiki`; its pictures come through `IconsContext` and `GameIcon` (`features/machineWiki/icons.tsx`, exported for other features), which renders nothing, or an empty box of the same size, when the dataset has no picture or the file fails to load.

**Top bar.** `components/Header.tsx` has three parts: the app name, the world name and the `start` header items on the left; the `center` items (the search) in the middle; the tool navigation, the language switch and the account menu on the right. Both sides share the free width equally, so the search stays centred as long as the right side fits into its half. On mobile (below 900 px) the search is a button next to the Tools menu and opens over the bar. The settings page shows neither search nor tools.

**Tools** (`Tool` in `app/feature.ts`). A tool describes itself (`id`, `order`, `labelKey`, optional `hintKey`, `icon`, `shortcut`) and has a hook `useTool(ctx)` that returns `{ available, pressed?, run }`: `available: false` hides it (e.g. no caves in the dataset), `pressed` makes it a switch (aria-pressed, a filled button), without it the tool is a plain action. `features/worlds/ToolsNav.tsx` shows them as buttons from 1280 px width and as a "Tools" menu below that and on phones (a WAI-ARIA menu button with `menuitemcheckbox` entries for switches), so a tool never renders itself. A tool with `action: true` opens something of its own (a dialog); on wide screens those go into a "Tools" menu next to the switches' buttons, so the bar stays short. Today: Quick Check (order 10), Caves (20), Heights (25), Resources (30); actions Planner (40), Vehicles (50), Machines (60), whose dialogs are header items that render only the dialog. On mobile Quick Check keeps its round button over the map as well (a `mapControls` entry that renders only there).

A map switch kept in a `{ visible, toggle }` zustand store moves from `mapControls` into the tool navigation by replacing its control entry with one line, using `toggleTool()` from `app/tools.ts`:

```ts
// before: mapControls: [{ id: 'resource-nodes', order: 22, Component: ResourceNodeControl }],
tools: [toggleTool({ id: 'resource-nodes', order: 30, labelKey: 'resourceNodes.control', hintKey: 'resourceNodes.hint', useToggle: useNodeLayer, useAvailable: ctx => Boolean(useResourceNodeFile(ctx.me.datasetVersion)) })],
```

The control component can then be deleted. `useAvailable` is a hook too (it may load something, like the heights' `meta.json`); leave it out when the switch always applies.

**Search** (`features/search`). The search box knows nothing about what it finds. Every feature can add a `SearchProvider` whose hook `useEntries(ctx, active)` returns `SearchEntry` objects, or undefined while its data loads. `active` turns true once the user opens the search, so providers with large files (caves) load them only then. An entry has an `id`, a `label` (current language), an optional `detail` line and `icon`, a `kindKey` ("Biome", "Cave", ...), `terms` (IDs, the name in the other language, synonyms), the `actors` it stands for and an `onSelect(ctx)`. Providers today: collectibles (types and single items, in `search`), biomes, caves and crash sites (in their own features). Recipes can be added later as one more provider in a recipes feature; entries without `actors` simply leave the map as it is.

Matching and ranking (`features/search/match.ts`) are pure functions: text is normalised (case, accents, ß), and an entry matches when a term contains the whole query or when every word of the query starts a word in some term. Exact term before prefix before word start before inside a word, a match ending at a word end before one that does not ("Dune Desert 3" before "... 30"); ties go by the entry's `weight` (default: the provider's `order`; types 0, biomes 10, caves 20, items 30, crash sites 40), then by label in natural order. Queries under two characters match nothing.

While a query is typed, the union of the matches' `actors` goes into the store's `searchHighlight`; after a choice, the chosen entry's `actors`. The map's marker canvas reads it like the other filters: matches get a halo in the accent colour and are drawn on top, even where a filter would hide them; everything else fades to 20 %. Choosing an item calls `focusItem` (select and zoom, like "Show on map"), a biome sets the biome scope, a cave switches the cave layer on and asks `useMapFit` (a map layer of the search feature) to fit the view to it. `features/mobile` is not a feature module; it holds the bottom sheet the world layout uses on small screens. A new feature should add a module here rather than edit core screens.

## Backend

**Stack.** Fastify 5, better-sqlite3, zod, jose, @fastify/cookie, @fastify/static, @fastify/rate-limit.

**Database.** One SQLite file (`DB_PATH`, `/data/app.db` in the container), WAL mode, foreign keys on. Tables: `users`, `identities`, `sessions`, `worlds`, `world_members`, `invite_uses`, `marks`, `routes`, `resource_node_overrides`, `resource_node_extractors`. Migrations are an append-only list in `src/server/db/migrations.ts`; entry *i* sets `PRAGMA user_version` to *i*+1. Never edit a released migration; append a new one.

**Marks.** A row in `marks` means "collected" for one actor in one world, with `mismatch` (conflict flag), `updated_by` and `updated_at`. Each world has a `rev` counter that is bumped on every change and sent with SSE events.

**Resource nodes.** The default nodes are static dataset data (`resource-nodes.json`). A world's own resource and purity per node, as its last save import reports them, are world data on the server: rows in `resource_node_overrides` (node, resource, purity) and the save's node randomisation settings in `worlds.node_settings` (JSON). The extractors standing on nodes in that save are rows in `resource_node_extractors` (node, `seq` per node, kind `miner1`/`miner2`/`miner3`/`oil`/`pressurizer`/`well`/`geothermal`/`portable`, clock speed with 1 = 100 %, Power Shards; clock and shards null for extractors that cannot be overclocked, the portable miner and the geothermal generator). They live on the server, not in the importing browser, because only the owner imports while every member should see the world as it is; they are replaced by every import that sends node data (older clients send none and leave them alone; extractors likewise only when the request has `extractors`). Members read them with `GET /api/worlds/:id/resource-nodes` (`{overrides, settings, extractors}`, `src/shared/api.ts`); the client merges them over the default nodes and refetches on the `import` event.

**Authentication.** Discord OAuth2 authorization code flow with PKCE (S256) and a `state` check. The transaction (state, verifier, return path, optional invite token) is kept in a signed, HttpOnly cookie for ten minutes. After the callback the Discord token is used to read the profile and then discarded. A new account is only created for an ID in `OWNER_DISCORD_IDS` or together with accepting a valid invite, in one transaction.

**Sessions.** A random 32-byte token in the HttpOnly cookie `sid` (SameSite=Lax, 30 days). Only its SHA-256 hash is stored.

**Invites.** HS256 JWTs signed with `INVITE_JWT_SECRET` (issuer `PUBLIC_URL`, audience `ficsmap:invite`, subject = world id, random `jti`, 7-day expiry, `ep` = the world's invite epoch). The compact JWT is Base64url-encoded once more for the link `/invite/<token>`; only the canonical encoding is accepted. Opening a link never consumes it. The token is consumed in the transaction that adds the member, by inserting its `jti` into `invite_uses`, so it works once. Revoking bumps the world's epoch, which invalidates all open links.

**CSRF.** Every POST, PUT, PATCH and DELETE must carry an `Origin` equal to the origin of `PUBLIC_URL` and a JSON content type (an empty DELETE is allowed). This runs in an `onRequest` hook before routing, so it also covers unknown paths. Together with SameSite=Lax cookies this blocks cross-site writes.

**Security headers.** `X-Content-Type-Options`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY` and `frame-ancestors 'none'` on every response unless a route sets its own.

**Rate limits** (per IP unless noted):

- 300/min globally for `/api`, `/auth` and `/invite`; static GETs (tiles, assets, dataset, SPA shell) are exempt
- 10/min for `/auth/*` and `/invite/:token`
- 6/h per world and user for save imports
- 120/min for mark writes, 30/min for route writes

**Permissions.** `requireMember` and `requireOwner` run as preHandlers on every world route, the event stream included. Non-members get 404. Only the owner imports saves, renames or deletes a world and manages invites. Routes can be changed by their creator or the owner.

**SSE.** `GET /api/worlds/:id/events` keeps a `text/event-stream` open with a heartbeat. The hub keeps a `Map<worldId, Set<client>>` in memory and broadcasts events (`mark`, `marks-bulk`, `import`, `world`, `members`, `removed`, `deleted`, `routes`). There is no replay: on (re)connect the client refetches and ignores events whose `rev` is not newer than what it loaded.

**Housekeeping.** Hourly purge of expired sessions and old `invite_uses`. One `VACUUM INTO` backup per UTC day to `backups/app-YYYYMMDD.db` next to the database; 14 are kept.

## Frontend

**Stack.** React 19, TypeScript, Vite, Tailwind CSS v4, react-router, TanStack Query, zustand, Leaflet with react-leaflet, i18next with ICU messages.

- **Server state** goes through TanStack Query. SSE handlers update or invalidate the query cache.
- **UI state** (selection, filters, interaction mode, sidebar) lives in one zustand store (`src/web/app/store.ts`). Parts of the view are persisted locally (`persist.ts`).
- **Map.** Leaflet with `CRS.Simple`; world coordinates map linearly to the tile image. All collectible markers are drawn on one canvas layer (`features/map/MarkerLayer.ts`) instead of one DOM element per marker. Below a zoom threshold markers are dots; above it they use the game icons.
- **Map modes.** The store holds the active interaction mode. The map sends marker clicks to the active mode's handler; turning one mode on turns the others off.
- **i18n.** All strings are in `src/web/app/i18n/en.json` and `de.json`, in ICU syntax (plurals, numbers). The language comes from `navigator.languages`: German if the first matching entry starts with `de`, otherwise English. Missing German keys fall back to English.
- **Design tokens.** Colours, spacing and fonts are defined once in `src/web/app/theme.css` (`@theme`). Components use token utilities, not raw colours.
- **Mobile.** Below 900 px the sidebar becomes a bottom sheet (`features/mobile`).

## Save import

1. The user picks a save. In Chromium browsers the save folder can be chosen once (File System Access API) and is remembered; other browsers use a normal file input.
2. The file goes to `src/web/save.worker.ts` as a transferable `ArrayBuffer`. The worker parses it with `@etothepii/satisfactory-file-parser` and reports progress.
3. `src/shared/extract.ts` collects the names of collected or destroyed actors and looted drop pods, maps aliases (Mercer Shrine to Mercer Sphere) and keeps only names that exist in the dataset.
4. The UI shows a preview: how many items will be checked and how many conflicts arise.
5. The client sends `POST /api/worlds/:id/import` with the file name, session name, save time, build, the list of names and the save's resource node data (`resourceNodes`: per node the resource class and purity the save sets, the randomisation settings, and `extractors`: per extractor on a node the node name, building kind, clock speed and Power Shards; `src/shared/resourceNodes.ts`). The save itself never leaves the browser.
6. In one transaction the server replaces the world's resource node overrides and extractors (when sent), flags every existing mark as a possible conflict, then inserts the missing marks from the save and clears the flag on marks the save confirms. Marks the save does not confirm stay checked but flagged. It bumps `rev` and broadcasts `import`.
7. Members resolve conflicts per item or in bulk ("Trust current data" / "Trust the save"). Bulk actions only touch rows that are still flagged, so a teammate's manual change in the meantime is not overwritten. Undo restores the previous rows.

## Dataset

The dataset is static and versioned by game version: `<DATASET_DIR>/<game-version>/` with `collectibles.min.json`, `map.json`, `biomes.geojson`, `crash-sites.json`, `tiles/{z}/{x}/{y}.webp`, `icons/` and optionally `caves.geojson`, `machines.json` (the machine and vehicle wiki, from the game's `CommunityResources/Docs` files via `--docs`), `icons/items/` (the game's pictures of items, machines and vehicles for the wiki: `index.json` with the sizes and classes, `<size>/<descriptor class>.webp` at 64 and 256 px; the browser loads the index when the wiki opens and requests only listed pictures, in the size that fits the screen via `srcset`; without it the wiki shows no pictures), `recipes.json` (production planner, fetched when the planner opens), `transport.json` (vehicle calculator) and `height/` (`meta.json` plus 500 m tiles `<ti>_<tj>.bin.gz`, fetched by the browser on hover and unpacked with `DecompressionStream`; tile URLs carry the content hash from `meta.json` because non-JSON files are served as immutable) and `resource-nodes.json` (`{version, resources: [{id, name}], nodes: [name, kind, resource, purity, x, y, z, core?]}`; kind `node`, `geyser`, `core` or `satellite`, purity `impure`/`normal`/`pure`, null for cores; geysers have the pseudo resource `Geyser`; loaded only by the browser). It is not in the repository and not in the Docker image; it is mounted at run time. The server loads `collectibles.min.json` at start and serves the directory under `/data/`.

`npm run dataset` (`scripts/build-dataset.ts`) builds it from:

- the output of SatisfactoryTools/AssetsExtractor `world-extractor-net` with the patch in `data-src/extractor/` (resource nodes from its `--out` file `default-world.json`, collectibles, drop-pod requirements, Mercer shrines, cave volumes and the 3D geometry around each cave, the height grid, the map area raster, tiles, icons; see `data-src/extractor/README.md`),
- a `--data-src` folder with crash-site data and the hand-drawn biome polygons with their calibration (used only when the extractor output has no `map-areas/`),
- optionally `--docs`, the game's `CommunityResources/Docs` folder (default `<extractor>/docs`), for `recipes.json` (`scripts/recipes.ts`; see `data-src/extractor/README.md`, "Recipes and buildings") and, with the extractor's `transport.json`, `transport.json` (`scripts/transport.ts`),
- the extractor's descriptor pictures (`--icons-out`, default `<extractor>/icons`) for `icons/items/` (`scripts/icons.ts`): every item, resource, equipment and vehicle picture and those of the buildings that are wiki entries (the Docs say which), not the other ~500 building descriptors (walls, foundations).

The build filters to the registry types, assigns each item a biome and a number within it, adds drop-pod requirements and shrine aliases, and fails on missing types, duplicate names or items without a biome. Each world records the dataset version it was created with.

## Versioning and version guard

The version in `package.json` is the app version (SemVer, bumped by hand). `GET /api/version` returns it, and the UI shows it with a link to the GitHub release.

On start (`src/server/main.ts`, logic in `src/server/version/guard.ts`) the app compares its version with the one stored in `ficsmap-version.json` next to the database:

- **Same version:** start normally.
- **Newer version:** back up the database to `backups/pre-v<new>-from-v<old>-<timestamp>.db`, run migrations, start, store the new version.
- **Older version (rollback):** do not touch the database. Start a separate maintenance app (`version/maintenance.ts`), where every page shows a notice. An owner confirms in the browser, or an operator runs the `rollback` command in the container (`version/cli.ts`, `docker compose run --rm ficsmap rollback [--yes]`). The current database is saved as `backups/pre-rollback-v<from>-to-v<to>-<timestamp>.db`, the pre-upgrade backup is restored, and the process exits so the container restarts into the old version. Without a matching backup the rollback is refused if the schema (`user_version`) is newer than the old version supports; otherwise it continues without a restore.

## Scaling limits

ficsmap is built for one instance per database:

- The SSE hub is in memory. Events are only delivered to clients connected to the same process.
- Rate limits are in memory and per process.
- SQLite has a single writer.

Running several containers against the same database is not supported. For the intended use (groups of friends, a few dozen users) one instance is plenty.

## Tests

Vitest with three groups: `test/unit` (pure logic and domain), `test/api` (the Fastify app with an in-memory database and a fake Discord client) and `test/web` (React components with Testing Library and jsdom). Tests that need the real dataset or a save file (`FICSMAP_SAVE_FIXTURE`) are skipped when it is missing.
