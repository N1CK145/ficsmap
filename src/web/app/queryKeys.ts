/** TanStack Query keys, in one place so invalidation and fetching always agree. */
export const queryKeys = {
  me: () => ['me'] as const,
  worlds: () => ['worlds'] as const,
  world: (worldId: string) => ['world', worldId] as const,
  inviteLink: (worldId: string) => ['invite-link', worldId] as const,
  marks: (worldId: string) => ['marks', worldId] as const,
  routes: (worldId: string) => ['routes', worldId] as const,
  dataset: (version: string) => ['dataset', version] as const,
  biomes: (version: string) => ['biomes', version] as const,
  crashSites: (version: string) => ['crash-sites', version] as const,
  caves: (version: string) => ['caves', version] as const,
  heightmap: (version: string) => ['heightmap', version] as const,
  resourceNodes: (version: string) => ['resource-nodes', version] as const,
  nodeOverrides: (worldId: string) => ['node-overrides', worldId] as const,
  transport: (version: string) => ['transport', version] as const,
};
