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
