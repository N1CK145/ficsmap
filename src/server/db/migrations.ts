import type { Db } from './db.js';

/** Index i becomes user_version i+1. Never edit a released migration; append a new one. */
export const MIGRATIONS: readonly string[] = [
  `
CREATE TABLE users(id INTEGER PRIMARY KEY, display_name TEXT NOT NULL, avatar_url TEXT,
      email TEXT, email_verified INT NOT NULL DEFAULT 0,
      created_at INT NOT NULL, last_login_at INT NOT NULL);

CREATE TABLE identities(id INTEGER PRIMARY KEY, user_id INT NOT NULL REFERENCES users ON DELETE CASCADE,
      provider TEXT NOT NULL,
      subject TEXT NOT NULL,
      username TEXT, email TEXT, email_verified INT NOT NULL DEFAULT 0,
      created_at INT NOT NULL, last_login_at INT NOT NULL,
      UNIQUE(provider, subject));
CREATE INDEX identities_email ON identities(email);

CREATE TABLE sessions(id_hash BLOB PRIMARY KEY, user_id INT NOT NULL REFERENCES users ON DELETE CASCADE,
      created_at INT NOT NULL, expires_at INT NOT NULL) WITHOUT ROWID;
CREATE INDEX sessions_expires ON sessions(expires_at);

CREATE TABLE worlds(id TEXT PRIMARY KEY CHECK(length(id) = 36),
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
      owner_id INT NOT NULL REFERENCES users, dataset_version TEXT NOT NULL,
      rev INT NOT NULL DEFAULT 0, invite_epoch INT NOT NULL DEFAULT 0,
      created_at INT NOT NULL, last_import_at INT, last_import_meta TEXT);
CREATE INDEX worlds_owner ON worlds(owner_id);

CREATE TABLE world_members(world_id TEXT NOT NULL REFERENCES worlds ON DELETE CASCADE,
      user_id INT NOT NULL REFERENCES users ON DELETE CASCADE,
      joined_at INT NOT NULL, joined_via TEXT NOT NULL,
      PRIMARY KEY(world_id, user_id)) WITHOUT ROWID;
CREATE INDEX members_user ON world_members(user_id);

CREATE TABLE invite_uses(jti TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds ON DELETE CASCADE,
      user_id INT NOT NULL REFERENCES users, used_at INT NOT NULL, expires_at INT NOT NULL) WITHOUT ROWID;

CREATE TABLE marks(world_id TEXT NOT NULL REFERENCES worlds ON DELETE CASCADE, actor_name TEXT NOT NULL,
      mismatch INT NOT NULL DEFAULT 0 CHECK(mismatch IN (0,1)),
      updated_by INT REFERENCES users ON DELETE SET NULL, updated_at INT NOT NULL,
      PRIMARY KEY(world_id, actor_name)) WITHOUT ROWID;

CREATE TABLE routes(id TEXT PRIMARY KEY CHECK(length(id) = 36),
      world_id TEXT NOT NULL REFERENCES worlds ON DELETE CASCADE,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
      start_actor TEXT NOT NULL,
      stops TEXT NOT NULL,
      created_by INT REFERENCES users ON DELETE SET NULL,
      created_at INT NOT NULL, updated_at INT NOT NULL);
CREATE INDEX routes_world ON routes(world_id);
`,
  // 2: resource nodes as the world's last save import reports them (overrides of the default map) and its
  // node randomisation settings (JSON, NodeSettings).
  `
CREATE TABLE resource_node_overrides(world_id TEXT NOT NULL REFERENCES worlds ON DELETE CASCADE,
      node TEXT NOT NULL, resource TEXT,
      purity TEXT CHECK(purity IS NULL OR purity IN ('impure','normal','pure')),
      PRIMARY KEY(world_id, node)) WITHOUT ROWID;
ALTER TABLE worlds ADD COLUMN node_settings TEXT;
`,
  // 3: the extractors standing on resource nodes as the world's last save import reports them: building kind
  // (ExtractorKind), clock speed (1 = 100 %) and Power Shards, null where the building has none. `seq` numbers
  // the extractors of one node (several portable miners can share a node). Validated by the import route.
  `
CREATE TABLE resource_node_extractors(world_id TEXT NOT NULL REFERENCES worlds ON DELETE CASCADE,
      node TEXT NOT NULL, seq INT NOT NULL, kind TEXT NOT NULL, clock REAL, shards INT,
      PRIMARY KEY(world_id, node, seq)) WITHOUT ROWID;
`,
  // 4: factory snapshots (src/shared/factory/snapshot.ts), one per save and world: the snapshot as gzip-compressed
  // JSON, its timeline summary (JSON: buildings, machines, avgProductivity, idle) and the stored size. A save is
  // identified by session name and save time, so importing it again replaces its row. AUTOINCREMENT: ids are never
  // reused, because GET /snapshots/:sid is cached as immutable by id.
  `
CREATE TABLE factory_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL REFERENCES worlds ON DELETE CASCADE,
      session_name TEXT NOT NULL, save_time INT NOT NULL,
      imported_at INT NOT NULL, imported_by INT REFERENCES users ON DELETE SET NULL,
      data BLOB NOT NULL, summary TEXT NOT NULL, bytes INT NOT NULL,
      UNIQUE(world_id, session_name, save_time));
CREATE INDEX factory_snapshots_world_time ON factory_snapshots(world_id, save_time);
`,
  // 5: upload tokens of the save watcher (src/server/domain/uploadTokens.ts): a script uploads saves to one world with
  // `Authorization: Bearer fsm_<id>_<secret>`. Only the SHA-256 of the secret is stored. `any_session` = 1 accepts
  // saves of another session than the world's. Revoked tokens keep their row (revoked_at) and stop working.
  `
CREATE TABLE upload_tokens(id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL REFERENCES worlds ON DELETE CASCADE,
      label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
      secret_hash BLOB NOT NULL,
      any_session INT NOT NULL DEFAULT 0 CHECK(any_session IN (0,1)),
      created_by INT REFERENCES users ON DELETE SET NULL,
      created_at INT NOT NULL, last_used_at INT, revoked_at INT);
CREATE INDEX upload_tokens_world ON upload_tokens(world_id);
`,
  // 6: a member's role in the world (src/shared/roles.ts): 'admin' may do what the owner may, except deleting the
  // world, changing roles and removing admins. The owner stays `worlds.owner_id`; their own row keeps 'member'.
  `
ALTER TABLE world_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin'));
`,
  // 7: the user's own preferences (src/shared/prefs.ts) as a JSON object, e.g. {"wheelSpeed":1.5}; a missing key has
  // its default. Written by PATCH /api/me/prefs (src/server/domain/users.ts).
  `
ALTER TABLE users ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}';
`,
];

export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  // Newer data than this code knows (an older version started on a newer database): never run on it.
  if (current > MIGRATIONS.length) {
    throw new Error(`Database schema ${current} is newer than this version supports (${MIGRATIONS.length}); roll back via the version guard or restore a backup`);
  }
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]!);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
