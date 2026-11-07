import type { Db } from '../db/db.js';
import type { ResourceNodesDto } from '../../shared/api.js';
import type { ExtractorKind, NodeExtractor, NodeSettings, Purity, ResourceNodeOverride, SaveResourceNodes } from '../../shared/resourceNodes.js';

/**
 * Replaces the world's resource node overrides and settings with a save's, and its extractors when the request
 * has them (older clients send none and leave them alone); runs inside the import transaction.
 */
export function replaceResourceNodes(db: Db, worldId: string, data: SaveResourceNodes): void {
  db.prepare('DELETE FROM resource_node_overrides WHERE world_id = ?').run(worldId);
  const insert = db.prepare('INSERT OR REPLACE INTO resource_node_overrides(world_id, node, resource, purity) VALUES (?, ?, ?, ?)');
  for (const [node, resource, purity] of data.overrides) {
    if (resource !== null || purity !== null) insert.run(worldId, node, resource, purity);
  }
  db.prepare('UPDATE worlds SET node_settings = ? WHERE id = ?').run(data.settings ? JSON.stringify(data.settings) : null, worldId);
  if (data.extractors) replaceExtractors(db, worldId, data.extractors);
}

function replaceExtractors(db: Db, worldId: string, extractors: readonly NodeExtractor[]): void {
  db.prepare('DELETE FROM resource_node_extractors WHERE world_id = ?').run(worldId);
  const insert = db.prepare('INSERT INTO resource_node_extractors(world_id, node, seq, kind, clock, shards) VALUES (?, ?, ?, ?, ?, ?)');
  const seq = new Map<string, number>();
  for (const [node, kind, clock, shards] of extractors) {
    const i = seq.get(node) ?? 0;
    seq.set(node, i + 1);
    insert.run(worldId, node, i, kind, clock, shards);
  }
}

export function getResourceNodes(db: Db, worldId: string): ResourceNodesDto {
  const rows = db.prepare('SELECT node, resource, purity FROM resource_node_overrides WHERE world_id = ? ORDER BY node')
    .all(worldId) as { node: string; resource: string | null; purity: Purity | null }[];
  const w = db.prepare('SELECT node_settings FROM worlds WHERE id = ?').get(worldId) as { node_settings: string | null } | undefined;
  const extractors = db.prepare('SELECT node, kind, clock, shards FROM resource_node_extractors WHERE world_id = ? ORDER BY node, seq')
    .all(worldId) as { node: string; kind: ExtractorKind; clock: number | null; shards: number | null }[];
  return {
    overrides: rows.map((r): ResourceNodeOverride => [r.node, r.resource, r.purity]),
    settings: w?.node_settings ? (JSON.parse(w.node_settings) as NodeSettings) : null,
    extractors: extractors.map((r): NodeExtractor => [r.node, r.kind, r.clock, r.shards]),
  };
}
