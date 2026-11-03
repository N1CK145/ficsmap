# Contributing to ficsmap

Thanks for your interest. Bug reports, ideas and pull requests are welcome.

## Before you start

- For anything bigger than a small fix, open an issue first and describe what you want to change. That avoids work on something that does not fit.
- Security problems are not reported in issues. See [SECURITY.md](SECURITY.md).
- Never attach save files, `.env` files, secrets or invite links to issues or pull requests.

## Setup

See [Development](README.md#development) in the README. In short:

```sh
nvm use                                  # Node 24, from .nvmrc
npm ci
cp .env.development.example .env.local   # localhost values
npm run dev                              # Vite on :5173, API on :3000
```

You need your own Discord application for login and a dataset in `data/<game-version>/` (git-ignored). See [Dataset](README.md#dataset).

An overview of the code is in [docs/architecture.md](docs/architecture.md).

## Branches and versions

ficsmap uses [Semantic Versioning](https://semver.org/). Versions are bumped by hand.

```
feature/<name> ──PR──► version/X.Y.Z ──PR──► master ──► release vX.Y.Z
```

- `master` is the released state and the default branch. Nobody pushes to it directly.
- Each upcoming version has a branch `version/X.Y.Z`, branched from `master`. Its first commit bumps `version` in `package.json` and adds a section to `CHANGELOG.md`:

  ```md
  ## [X.Y.Z] - YYYY-MM-DD
  ```

  The changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) (`Added`, `Changed`, `Fixed`, `Removed`, ...).
- Build features on `feature/<name>`, branched from the current version branch. Open the pull request against that `version/X.Y.Z` branch, not against `master`. Add your change to the version's CHANGELOG section in the same pull request.
- When the version is done, a pull request merges `version/X.Y.Z` into `master`. The merge creates the release automatically: tag `vX.Y.Z`, a GitHub Release with the CHANGELOG section as notes, and the Docker images `ghcr.io/n1ck145/ficsmap:X.Y.Z`, `X.Y` and `latest`.
- Hotfix: create `version/X.Y.(Z+1)` from `master` and follow the same path: bump commit, `feature/<name>` for the fix, pull request into the version branch, then into `master`.

If you are not sure which version branch to target, ask in the issue.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every pull request and on pushes to `version/**` and `feature/**`:

- `npm run typecheck`
- `npm test`
- `npm run build`
- a Docker image build

A pull request into `master` also fails if the version in `package.json` is not higher than the latest release, or if `CHANGELOG.md` has no section for it.

Run the checks locally before you push:

```sh
npm run typecheck
npm test
npm run build
```

Some tests need the real dataset or a save file and are skipped without them. Set `FICSMAP_SAVE_FIXTURE` to the path of a save to run the save tests. Never commit the save.

## Code guidelines

- TypeScript everywhere. Shared types and pure logic go into `src/shared`.
- Server: business rules in `src/server/domain`, thin HTTP handlers in `src/server/http`. Validate every request body and parameter with zod.
- Database changes: append a new migration to `src/server/db/migrations.ts`. Never edit a released migration.
- Frontend: a new feature is a module in `src/web/features/<name>/` registered in `src/web/features/index.ts`. Use the extension points in `src/web/app/feature.ts` instead of editing core screens.
- All user-facing text goes into `src/web/app/i18n/en.json` and `de.json` (ICU message syntax). If you cannot write German, add the English key and mention it in the pull request; a missing German key falls back to English.
- Use the design tokens in `src/web/app/theme.css`, not raw colour values.
- Add or update tests for what you change.
- Keep pull requests focused on one topic.

## Game data

Do not commit game assets: no map tiles, icons, extracted game files or generated datasets. The repository contains only code and the extraction tooling. See [NOTICE](NOTICE).

## Licence

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE) of this project.
