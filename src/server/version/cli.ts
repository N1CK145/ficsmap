import { createInterface } from 'node:readline/promises';
import { describe } from './maintenance.js';
import { compareVersions, type RollbackPlan } from './guard.js';

export interface RollbackCliDeps {
  stored: string | null;
  current: string;
  plan: () => RollbackPlan;
  perform: (plan: RollbackPlan) => Promise<void>;
  args: readonly string[];
  out: (line: string) => void;
  /** y/N on a terminal; undefined when there is none. */
  ask?: (question: string) => Promise<string>;
}

/** `rollback [--yes]`: confirms a pending downgrade in a terminal. Returns the exit code. */
export async function runRollbackCli(d: RollbackCliDeps): Promise<number> {
  const { stored, current, out } = d;
  if (stored === null || compareVersions(stored, current) <= 0) {
    out(`Nothing to roll back: the data was last used by ${stored ? `v${stored}` : 'no version yet'}, this is v${current}.`);
    return 0;
  }
  const plan = d.plan();
  const text = describe({ stored, current, plan }, 'en');
  out(`WARNING: ${text.situation}`);
  out(text.effect);
  if (!text.canConfirm) return 1;
  let yes = d.args.includes('--yes') || d.args.includes('-y');
  if (!yes) {
    if (!d.ask) {
      out('No terminal to ask on. Run it with a terminal (docker compose run --rm ficsmap rollback) or pass --yes.');
      return 1;
    }
    yes = /^y(es)?$/i.test((await d.ask(`${text.action}? [y/N] `)).trim());
  }
  if (!yes) {
    out('Cancelled. Nothing was changed.');
    return 1;
  }
  await d.perform(plan);
  out(`Done. ficsmap now runs v${current}; a container waiting in maintenance mode restarts by itself, otherwise run: docker compose up -d`);
  return 0;
}

/** A y/N prompt on stdin, or undefined without a terminal. */
export function terminalAsk(): ((q: string) => Promise<string>) | undefined {
  if (!process.stdin.isTTY) return undefined;
  return async q => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try { return await rl.question(q); } finally { rl.close(); }
  };
}
