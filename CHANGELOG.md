# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-11-03

### Added

- A footer with the version (links to its release page) and a link to the GitHub repository, always visible on every page, including the map view; on mobile the sheets sit on top of it.
- A language switch (EN | DE) in the header next to the account menu; the choice is remembered on the device and wins over the browser language.
- Routes: the drop pods' needs became a "Bring with you" list, like the game's to-do list. Items lying at the crash sites on the way (a pod's own site included, in route order) are counted in: each row shows only what is left to bring and where the rest lies, and fully covered items move to "Found on the way". Items can be ticked off; the ticks are remembered per route on the device. On desktop the list floats over the bottom right of the map, under the item panel, and collapses to its header when there is no room (or by hand); on mobile it stays in the route editor.

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
