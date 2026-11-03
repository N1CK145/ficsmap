# data/

The map dataset goes here as `data/<game-version>/` (git-ignored): `collectibles.min.json`, `map.json`,
`biomes.geojson`, `crash-sites.json`, `tiles/` and `icons/`. It is built from your own game install with
`npm run dataset` (see the README, "Map dataset"). In Docker it is mounted read-only at `/app/data`.
