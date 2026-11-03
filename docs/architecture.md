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
scripts/        build-dataset.ts (dataset build), inspect-save.ts (dump a save for checks)
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
- `biomes.ts`: loads biome polygons and assigns items to biomes.
- `api.ts`, `sse.ts`: DTOs and the SSE event union, shared by server and client.
- `i18n.ts`: locale detection, used by the SPA and the server-rendered invite page.

### src/server

```
main.ts         start-up: config, database, dataset, app, housekeeping
app.ts          Fastify instance, global hooks (CSRF, headers, rate limit, errors), route registration
config.ts       environment parsing (zod)
db/             db.ts (open, WAL, foreign keys), migrations.ts
auth/           discord.ts (OAuth client), session.ts, guards.ts (requireMember, requireOwner)
domain/         business rules without HTTP: users, worlds, marks, importSave, invites, routes
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
- `headerItems`, `settingsSections`
- `sseHandlers`: reactions to server events

All features are listed once in `src/web/features/index.ts`. `collect()` flattens one extension point over all features and sorts by `order`. The current features are `worlds`, `marks`, `live`, `map`, `progress`, `biomes`, `itemPanel`, `quickCheck`, `routes`, `import`, `conflicts`, `sharing` and `listView`. `features/mobile` is not a feature module; it holds the bottom sheet the world layout uses on small screens. A new feature should add a module here rather than edit core screens.

## Backend

**Stack.** Fastify 5, better-sqlite3, zod, jose, @fastify/cookie, @fastify/static, @fastify/rate-limit.

**Database.** One SQLite file (`DB_PATH`, `/data/app.db` in the container), WAL mode, foreign keys on. Tables: `users`, `identities`, `sessions`, `worlds`, `world_members`, `invite_uses`, `marks`, `routes`. Migrations are an append-only list in `src/server/db/migrations.ts`; entry *i* sets `PRAGMA user_version` to *i*+1. Never edit a released migration; append a new one.

**Marks.** A row in `marks` means "collected" for one actor in one world, with `mismatch` (conflict flag), `updated_by` and `updated_at`. Each world has a `rev` counter that is bumped on every change and sent with SSE events.

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
5. The client sends `POST /api/worlds/:id/import` with the file name, session name, save time, build and the list of names. The save itself never leaves the browser.
6. In one transaction the server flags every existing mark as a possible conflict, then inserts the missing marks from the save and clears the flag on marks the save confirms. Marks the save does not confirm stay checked but flagged. It bumps `rev` and broadcasts `import`.
7. Members resolve conflicts per item or in bulk ("Trust current data" / "Trust the save"). Bulk actions only touch rows that are still flagged, so a teammate's manual change in the meantime is not overwritten. Undo restores the previous rows.

## Dataset

The dataset is static and versioned by game version: `<DATASET_DIR>/<game-version>/` with `collectibles.min.json`, `map.json`, `biomes.geojson`, `crash-sites.json`, `tiles/{z}/{x}/{y}.webp` and `icons/`. It is not in the repository and not in the Docker image; it is mounted at run time. The server loads `collectibles.min.json` at start and serves the directory under `/data/`.

`npm run dataset` (`scripts/build-dataset.ts`) builds it from:

- the output of SatisfactoryTools/AssetsExtractor `world-extractor-net` with the patch in `data-src/extractor/` (collectibles, drop-pod requirements, Mercer shrines, tiles, icons; see `data-src/extractor/README.md`),
- a `--data-src` folder with biome polygons, their calibration and crash-site data.

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
