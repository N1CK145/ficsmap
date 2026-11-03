import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configWarnings, loadConfig } from './config.js';
import { openDb } from './db/db.js';
import { MIGRATIONS } from './db/migrations.js';
import { buildApp } from './app.js';
import { indexDataset, type Dataset } from '../shared/dataset.js';
import { createDiscordClient } from './auth/discord.js';
import { startHousekeeping } from './housekeeping.js';
import { appVersion } from './version/appVersion.js';
import { runRollbackCli, terminalAsk } from './version/cli.js';
import {
  backupBeforeUpgrade, performRollback, planRollback, readStoredVersion, startDecision, writeStoredVersion, type RollbackPlan,
} from './version/guard.js';
import { buildMaintenanceApp } from './version/maintenance.js';

const config = loadConfig(process.env);
const current = appVersion();
const stateDir = dirname(config.dbPath);
const backupsDir = join(stateDir, 'backups');
const stored = readStoredVersion(stateDir);
const plan = () => planRollback({ dbPath: config.dbPath, backupsDir, current, supportedSchema: MIGRATIONS.length });
const perform = (p: RollbackPlan) =>
  performRollback({ dbPath: config.dbPath, stateDir, backupsDir, from: stored!, to: current, plan: p, now: Date.now() });

if (process.argv[2] === 'rollback') {
  // `docker compose run --rm ficsmap rollback [--yes]`
  const ask = terminalAsk();
  process.exit(await runRollbackCli({ stored, current, plan, perform, args: process.argv.slice(3), out: l => console.log(l), ...(ask ? { ask } : {}) }));
}

const discord = createDiscordClient(config);

if (startDecision(stored, current) === 'downgrade') {
  // An older version on newer data: touch nothing until someone confirms the rollback.
  const state = { stored: stored!, current, plan: plan() };
  const restart = () => setTimeout(() => process.exit(0), 200);
  const app = await buildMaintenanceApp({ config, discord, state, confirm: () => perform(state.plan), restart });
  app.log.warn(`maintenance mode: data was last used by v${state.stored}, this is v${current} (${state.plan.kind})`);
  await app.listen({ host: '0.0.0.0', port: config.port });
  // A rollback confirmed in a terminal (`rollback` command) writes the version file: restart then.
  setInterval(() => { if (readStoredVersion(stateDir) === current) process.exit(0); }, 3000).unref();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => void app.close().finally(() => process.exit(0)));
} else {
  if (startDecision(stored, current) === 'upgrade') {
    const file = await backupBeforeUpgrade(config.dbPath, backupsDir, stored!, current, Date.now());
    if (file) console.log(`upgrade v${stored} -> v${current}: database backed up to ${file}`);
  }
  const db = openDb(config.dbPath);
  // Recorded right after the migrations, so a crash later cannot cause a second "pre-upgrade" backup of migrated data.
  if (config.dbPath !== ':memory:') writeStoredVersion(stateDir, current, Date.now());
  const dataset = indexDataset(
    JSON.parse(readFileSync(join(config.datasetDir, config.datasetVersion, 'collectibles.min.json'), 'utf8')) as Dataset,
  );

  const app = await buildApp({ config, db, dataset, discord });
  for (const warning of configWarnings(config)) app.log.warn(warning);
  await app.listen({ host: '0.0.0.0', port: config.port });

  const stopHousekeeping = startHousekeeping(db, config);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      stopHousekeeping();
      void app.close().finally(() => {
        db.close();
        process.exit(0);
      });
    });
  }
}
