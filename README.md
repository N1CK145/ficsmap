# ficsmap

A shared, live collectibles checklist for Satisfactory: import your save, tick off slugs, sloops, spheres and drop pods with friends, and plan routes.

> ficsmap is an unofficial fan project. It is not affiliated with or endorsed by Coffee Stain Studios.

ficsmap is a self-hosted web app. You run your own instance. The author runs an invite-only instance for friends; there is no public demo.

## Screenshots

**The map.** Every Power Slug, Somersloop, Mercer Sphere and drop pod with the game's icons; collected ones are dimmed. A selected drop pod shows what it takes to open (here 90 MW of power, marked by the bolt on its icon), the items lying around its crash site, the threats and notes.

![ficsmap map view: game icons for all collectibles, a selected drop pod with its power requirement, crash-site items, threats and notes](docs/screenshots/map.webp)

**The route planner.** A route through the open collectibles of an area: numbered stops on the map and in the list, distances, progress, and everything the route's drop pods need to be opened, summed up.

![ficsmap route planner: a 21-stop route through the Rocky Desert with numbered stops, distances and the items and power its drop pods need](docs/screenshots/route-planner.webp)

<sub>Screenshots from a demo world. Map and icons © Coffee Stain Studios.</sub>

## Features

- **Interactive map** with the game's own icons for Blue, Yellow and Purple Power Slugs, Somersloops, Mercer Spheres and drop pods (hard drives).
- **Discord login.** No passwords to manage.
- **Worlds.** Track a world alone or share it with co-op friends. Invite links work once and are valid for 7 days. The owner can revoke all open links.
- **Live sync.** When a member ticks something off, everyone else sees it at once (Server-Sent Events).
- **Save import.** Read a save file to mark everything you have already collected. The save is parsed in your browser.
- **Conflict review.** If the save says an item is still in the world but it is ticked off in ficsmap, it is flagged. Resolve conflicts one by one or in bulk, with undo.
- **Quick Check.** Tick off markers with a single click while you play.
- **Filters and progress.** Show, dim or hide collected items per type. Limit the view to one biome and see progress per biome. The biomes are the game's own map areas.
- **Height layer.** A switchable colour scale of the terrain height over the map.
- **Item panel.** Drop-pod requirements (item or power) and crash-site information: items lying around, threats and notes.
- **Caves.** A switchable layer with the floor plans of the caves and their entrances, sampled from the game's 3D geometry, and a note in the item panel when an item lies in a cave (with the distance to the nearest entrance).
- **Coordinates and height.** Hovering the map shows the position under the mouse in metres, with the height of the highest surface there, read from the game's terrain and rock geometry.
- **Route planner.** Up to 30 stops, optimise the order, jump to the next stop, and see a combined list of what the route's drop pods need.
- **List view** as an alternative to the map.
- **Mobile layout** with a bottom sheet.
- **English and German** user interface, picked from the browser language.

## How it works and privacy

- You sign in with Discord. ficsmap reads your Discord ID, name and avatar. The Discord access token is used once and never stored.
- Accounts are invite-only. A new account is created only for a Discord ID listed in `OWNER_DISCORD_IDS` or for someone who opens a valid invite link.
- **Your save file never leaves your browser.** It is parsed locally in a Web Worker. Only the list of collected item names (for example `BP_Crystal_mk29`) is sent to the server, together with the file name and the session name, save time and game build from the save header.
- Ticks, routes and members are stored in a SQLite database on the server you run.

## Self-hosting

You need Docker with Compose, a domain with TLS behind a reverse proxy, a Discord application, and a map dataset (see [Dataset](#dataset)).

### Docker Compose

Images are published to `ghcr.io/n1ck145/ficsmap` with the tags `<version>` (for example `0.1.0`), `<major>.<minor>` (for example `0.1`) and `latest`. The images contain no game data.

Create a directory with this `docker-compose.yml`:

```yaml
services:
  ficsmap:
    image: ghcr.io/n1ck145/ficsmap:${FICSMAP_VERSION:-latest}
    env_file: .env
    volumes:
      - ./state:/data
      - ./dataset:/app/data:ro
    ports:
      - "${FICSMAP_PORT:-3000}:3000"
    restart: unless-stopped
```

The directory then looks like this:

```
ficsmap/
  docker-compose.yml
  .env
  state/            app.db, backups/, ficsmap-version.json (written by the app)
  dataset/
    1.2.4.1/        collectibles.min.json, map.json, biomes.geojson, crash-sites.json, tiles/, icons/
```

`state/` must be writable by the container user (uid 1000):

```sh
mkdir -p state dataset
sudo chown 1000:1000 state
docker compose up -d
```

Include `state/` in your host backup.

### Configuration (.env)

Copy [`.env.example`](.env.example) to `.env`, fill it in and run `chmod 600 .env`. Never commit it.

| Variable | Meaning |
|---|---|
| `PUBLIC_URL` | The URL users open, for example `https://ficsmap.example.com`. Used for the Discord redirect, invite links and the origin check. |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | From your Discord application. |
| `OWNER_DISCORD_IDS` | Comma-separated Discord user IDs that may sign in without an invite. Owners can also confirm a rollback in the browser. |
| `SESSION_SECRET`, `INVITE_JWT_SECRET` | Two different random secrets, at least 32 characters each. Generate with `openssl rand -base64 48`. |
| `TRUST_PROXY` | IP address of your reverse proxy, whose `X-Forwarded-*` headers are trusted. Empty without a proxy. |
| `COOKIE_SECURE` | `true` for HTTPS. Set to `false` only for plain-HTTP testing. |
| `LOG_LEVEL` | `fatal`, `error`, `warn`, `info`, `debug` or `trace`. |
| `FICSMAP_PORT` | Host port for Compose (default `3000`). Not read by the app. |
| `FICSMAP_VERSION` | Optional. Image tag to run (default `latest`). Pin it to control upgrades and to roll back. |

To find your Discord user ID: Discord settings, Advanced, turn on Developer Mode, then right-click your name and choose Copy User ID.

### Discord application

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Under OAuth2, add the redirect URI `<PUBLIC_URL>/auth/discord/callback`, for example `https://ficsmap.example.com/auth/discord/callback`.
3. Copy the client ID and client secret into `.env`.

ficsmap requests the `identify` scope. No bot is needed.

### Reverse proxy

Put ficsmap behind a reverse proxy that terminates TLS. Live sync uses Server-Sent Events, which are long-lived responses. The proxy must not buffer them and must allow long reads.

nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

Caddy:

```
ficsmap.example.com {
    reverse_proxy 127.0.0.1:3000 {
        flush_interval -1
    }
}
```

Set `TRUST_PROXY` to the IP address the proxy connects from.

### Dataset

The map dataset is **not** part of this repository or the Docker image, because it consists of Coffee Stain Studios' game assets. You build it yourself from your own game installation and mount it into the container (`./dataset:/app/data:ro`). The app uses the one version directory it finds there; if there is more than one, set `DATASET_VERSION` in `.env`.

A dataset directory `<game-version>/` contains `collectibles.min.json`, `map.json`, `biomes.geojson`, `crash-sites.json`, `tiles/` and `icons/`, optionally `caves.geojson` (cave outlines and entrances; a dataset built without caves offers no cave layer) and `height/` (height map tiles; without it the coordinates show no height).

To build one:

1. Extract the game data with [SatisfactoryTools/AssetsExtractor](https://github.com/SatisfactoryTools/AssetsExtractor) `world-extractor-net`, with the patch `data-src/extractor/world-extractor-extras.patch` applied, against your own Satisfactory install. The exact steps are in [`data-src/extractor/README.md`](data-src/extractor/README.md).
2. In a checkout of this repository, run:

   ```sh
   npm ci
   npm run dataset -- --extractor <extractor-output-dir> --data-src <dir> --out data/1.2.4.1
   ```

   `--data-src` points to a folder with `biomes/biomes.editor.geojson`, `biomes/calibration.json` and `crash-sites/crash-sites.json`. If the extractor output contains `caves.json` and `cave-geometry/` (or you pass `--caves <file> --cave-geometry <dir>`), the build samples the caves, writes `caves.geojson` and marks items that lie in a cave. If it contains `heightmap/` (or you pass `--heightmap <dir>`), the build writes the height map tiles to `height/`. If it contains `map-areas/` (or you pass `--map-areas <dir>`), the biomes come from the game's map areas and the editor polygons in `--data-src` are not used.
3. Copy `data/1.2.4.1/` into the `dataset/` directory next to your `docker-compose.yml`.

**Current limitation:** the crash-site data are maintainer data and are not published. With the extractor output (including `map-areas/`) you get the tiles, icons, collectible positions and biomes, but the crash-site layer needs a source of your own in the format above. `--data-src` still has to provide the biome editor files, even though they are unused when `map-areas/` exists.

### Updates

Pin `FICSMAP_VERSION` in `.env` and change it to upgrade:

```sh
docker compose pull
docker compose up -d
```

Automatic updates are optional. For example, [Watchtower](https://containrrr.dev/watchtower/) can watch the container and pull new images. If you run Watchtower with `--label-enable`, add this label to the service:

```yaml
    labels:
      - com.centurylinklabs.watchtower.enable=true
```

### Upgrades and rollbacks

ficsmap stores the version of its last start in `state/ficsmap-version.json`.

**Upgrade.** When a newer version starts, it first backs up the database to `state/backups/pre-v<new>-from-v<old>-<timestamp>.db`, then migrates the database and starts.

**Rollback.** Set `FICSMAP_VERSION=<older version>` in `.env` and run `docker compose up -d`. The older version sees that the stored version is newer. It does not touch the database and starts in maintenance mode: every page shows a maintenance notice. The notice explains that a rollback restores the backup taken before upgrading past this version, and that all changes since then are lost.

Confirm the rollback in one of two ways:

- **Browser:** an owner (a Discord ID in `OWNER_DISCORD_IDS`) signs in on the maintenance page and clicks "Roll back".
- **Terminal:** run `docker compose run --rm ficsmap rollback`. It asks for confirmation (y/N); `--yes` skips the prompt.

Before the restore, the current database is saved as `state/backups/pre-rollback-v<from>-to-v<to>-<timestamp>.db`. After the restore, the container restarts by itself into the old version.

If no matching backup exists, the rollback is refused when the database schema is newer than the old version supports. If the schema is still compatible, confirming continues without a restore.

**Daily backups.** The app also writes one backup per day to `state/backups/` (`VACUUM INTO`, the newest 14 are kept).

## Development

Requirements: Node 24 (see `.nvmrc`), a Discord application for login, and a dataset in `data/<game-version>/` (git-ignored, see [Dataset](#dataset)).

```sh
npm ci
cp .env.development.example .env.local   # localhost values
npm run dev                              # Vite on :5173, API on :3000
```

`npm run dev` loads `.env` and then `.env.local`; values in `.env.local` win. Add the redirect URI `http://localhost:5173/auth/discord/callback` to your Discord application. The Vite dev server is also reachable from your LAN; Discord login from another device only works if `PUBLIC_URL` and the redirect URI use that address.

Other commands:

```sh
npm run typecheck
npm test
npm run build
```

Some tests need the real dataset or a save file and are skipped without them. Point `FICSMAP_SAVE_FIXTURE` at a save to run the save tests.

Never commit save files (`*.sav`) or `.env` files. Both are git-ignored.

For an overview of the code, see [docs/architecture.md](docs/architecture.md).

## Development workflow

ficsmap uses [Semantic Versioning](https://semver.org/). Versions are bumped by hand.

```
feature/<name> ──PR──► version/X.Y.Z ──PR──► master ──► release vX.Y.Z
```

- `master` is the released state and the default branch.
- Each version has its own branch `version/X.Y.Z`, branched from `master`. Its first commit bumps `version` in `package.json` and adds a section `## [X.Y.Z] - YYYY-MM-DD` to [CHANGELOG.md](CHANGELOG.md) ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format).
- Features are built on `feature/<name>`, branched from the current version branch, and merged into it by pull request.
- When the version is done, a pull request merges `version/X.Y.Z` into `master`.
- Hotfix: a new patch version branch `version/X.Y.(Z+1)` from `master`, then the same path.

**CI** (`.github/workflows/ci.yml`, GitHub-hosted) runs typecheck, tests, build and a Docker build on every pull request and on pushes to `version/**` and `feature/**`. A pull request into `master` fails if the version is not higher than the latest release or the CHANGELOG section is missing.

**Releases.** Every merge into `master` that carries a new version creates the release automatically: the tag `vX.Y.Z`, a GitHub Release with the CHANGELOG section as notes, and the Docker images (`X.Y.Z`, `X.Y`, `latest`).

The app shows "ficsmap vX.Y.Z" with a link to the GitHub release. `GET /api/version` returns `{"version":"X.Y.Z"}`.

## Limitations

- Accounts are invite-only. There is no open sign-up.
- Self-hosting needs your own Discord application.
- The map dataset is not included and has to be built from your own game install. Crash-site data are not published yet.
- The data is from game version 1.2.4.1.
- Route distances are straight lines; terrain is not taken into account.
- Berries, nuts and mushrooms are not tracked.
- One instance per database: live sync and rate limits are held in memory, and SQLite has a single writer. ficsmap does not scale out to several containers.

## Legal

The source code is licensed under the [MIT License](LICENSE). The licence covers the source code only.

ficsmap is an unofficial fan project and is not affiliated with or endorsed by Coffee Stain Studios. Satisfactory, its map, icons and all game assets are © Coffee Stain Studios. This repository and the Docker images contain no game assets (apart from the screenshots in `docs/screenshots/`, which show parts of the game map and icons); the map dataset is generated locally from your own game installation.

Third-party code is used under its own licence, among others SatisfactoryTools/AssetsExtractor (MIT), @etothepii/satisfactory-file-parser (MIT) and Leaflet (BSD-2-Clause). See [NOTICE](NOTICE) for details.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Report security problems privately as described in [SECURITY.md](SECURITY.md).
