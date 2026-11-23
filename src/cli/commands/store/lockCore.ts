/**
 * The PURE half of `slopweaver store lock | start`: their flags and the lines they print. The acts are
 * `src/store/lock/reconcile.ts`; the effects are wired in `./lockRun.ts`.
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import type { LockBackupOutcome } from "../../../store/lock/backupGate.js";
import type { LockMeasurement, LockReport } from "../../../store/lock/reconcile.js";
import { parseFlags } from "../../parseFlags.js";

/** What `store lock` and `store start` were asked. */
export interface LockArgs {
  readonly home: string | undefined;
  readonly json: boolean;
  readonly rotate: boolean;
  /** A checkout whose `supabase/config.toml` names the stack — this one when absent. */
  readonly workdir: string | undefined;
}

/**
 * Parse the flags `store lock` and `store start` share.
 *
 * @param rest the argv after the verb
 * @returns the flags, or every reason they were refused
 */
export function parseLockArgs({ rest }: { rest: readonly string[] }): Result<LockArgs> {
  const flags = parseFlags({ args: rest, spec: { boolean: ["json", "rotate"], string: ["home", "workdir"] } });
  if (flags.isErr()) {
    return err(flags.error);
  }
  const { values } = flags.value;
  const home = values["home"];
  const workdir = values["workdir"];
  return ok({
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    rotate: values["rotate"] === true,
    workdir: typeof workdir === "string" ? workdir : undefined,
  });
}

/**
 * How `store start` launches the Supabase CLI: this checkout's pinned launcher by path, never `PATH`, with every
 * {@link SUPABASE_LAUNCHER_ENV_PREFIX} variable dropped from that process, so neither the shell nor a Yarn-injected
 * `.env.yarn` can point the launcher at another binary (`src/environment/storeProbes.ts`). The launcher's one such
 * variable is its binary override (`node_modules/supabase/dist/supabase.js`); dropping the prefix rather than naming
 * it also drops any the launcher adds later.
 *
 * PostgREST is excluded here, at launch, because it shares `[api] enabled` with Kong: switching that off in
 * `supabase/config.toml` would remove the gateway every Storage call goes through. Nothing in this repository calls
 * PostgREST. `postgrest` is the service name the pinned CLI (2.120.0) accepts; `--exclude rest` is not.
 *
 * @param nodePath the running node executable
 * @param treeRoot the checkout whose `node_modules` holds the pinned CLI
 * @param workdir the checkout whose `supabase/config.toml` names the stack
 * @param env the environment to inherit
 * @returns the executable, its argv and its environment
 */
export function pinnedStart({
  nodePath,
  treeRoot,
  workdir,
  env,
}: {
  nodePath: string;
  treeRoot: string;
  workdir: string;
  env: NodeJS.ProcessEnv;
}): { command: string; args: readonly string[]; env: NodeJS.ProcessEnv } {
  return {
    args: [
      join(treeRoot, "node_modules", "supabase", "dist", "supabase.js"),
      "start",
      "--workdir",
      workdir,
      "--exclude",
      "postgrest",
    ],
    command: nodePath,
    env: Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith(SUPABASE_LAUNCHER_ENV_PREFIX))),
  };
}

/** The prefix of the variables the Supabase npm launcher reads to choose which binary it runs. */
const SUPABASE_LAUNCHER_ENV_PREFIX = "SUPABASE_CLI_";

/**
 * The line describing the pre-lock backup.
 *
 * @param backup what the gate did, or `null` when no role was created
 * @returns one line
 */
function backupLine({ backup }: { backup: LockBackupOutcome | null }): string {
  if (backup === null) {
    return "store lock: no pre-lock backup taken — the login role carries the mark of the backup the first lock verified, and that copy is not re-checked";
  }
  if (backup.kind === "empty") {
    return `store lock: nothing to back up — ${backup.database} holds no table in public or drizzle and no Storage bucket or object`;
  }
  const { report } = backup;
  return (
    `store lock: pre-lock backup at ${backup.directory} — restored into a throwaway and checked against live ` +
    `(${String(report.counts.length)} table count(s), ${String(report.sample.length)} sampled row(s), schema identical), ` +
    `${String(backup.storageObjects)} Storage object(s) proven by path, size and digest`
  );
}

/**
 * The human report of one lock run. Never carries the password or the URL.
 *
 * @param report what the run did
 * @returns the lines
 */
export function lockLines({ report }: { report: LockReport }): readonly string[] {
  return [
    `store lock: ${report.projectId} stack, database ${report.database}, Mac logins arrive from ${report.gateway}`,
    backupLine({ backup: report.backup }),
    `store lock: login — ${report.password}${report.storeUrlWritten ? ", secrets/store-url rewritten" : ", secrets/store-url unchanged"}`,
    `store lock: pg_hba.conf ${report.hbaRewritten ? "rewritten" : "already carried the rule"}`,
    ...(report.evicted > 0
      ? [`store lock: ended ${String(report.evicted)} session(s) from the Mac that were not the login`]
      : []),
    ...report.proofs.map((proof) => `store lock: ✓ ${proof}`),
  ];
}

/**
 * The lines `store verify` adds for the lock.
 *
 * @param measurement what held and what did not, or a reason it was not measured
 * @returns the lines
 */
export function lockMeasurementLines({
  measurement,
}: {
  measurement: LockMeasurement | { notMeasured: string };
}): readonly string[] {
  if ("notMeasured" in measurement) {
    return [`store verify: lock not measured — ${measurement.notMeasured}`];
  }
  return [
    ...measurement.held.map((line) => `store verify: lock ✓ ${line}`),
    ...measurement.findings.map((line) => `store verify: lock ✗ ${line}`),
  ];
}
