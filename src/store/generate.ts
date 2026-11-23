/**
 * Run the `drizzle-kit` CLI's `generate` — the one act that turns a schema edit into a migration file.
 *
 * DrizzleKit has a CLI for generating migration files, so this leans on it, as the archive did. The archive's `db-push` shelled out to
 * `pnpm drizzle-kit generate` and then applied programmatically; this is the same split. `generate` needs
 * no database — it diffs the schema module against the newest snapshot under `<out>/meta` — which is what
 * lets the `drizzle-migrations` lint gate run it into a scratch copy on a machine with no Postgres at all,
 * and what lets `store push` run it before it opens a connection.
 *
 * The CLI is invoked with explicit `--dialect`, `--schema` and `--out` rather than through
 * `drizzle.config.ts`, because the gate needs to point `--out` somewhere that is NOT the committed
 * directory, and a config file has one `out`. `drizzle.config.ts` stays for a person running the bare
 * CLI by hand; both name the same schema module.
 */
import { type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { err, ok, type Result } from "../lib/result.js";
import { type StoreError, StoreErrors } from "./errors.js";

/** The schema module `drizzle-kit` reads — the barrel, the same one `drizzle.config.ts` names. */
const SCHEMA_MODULE = "src/store/schema.ts";

/**
 * Run one command to completion and hand back what {@link generateMigrations} reads of it — the seam a test
 * replaces so no `drizzle-kit` process starts. One object, because a declared function type takes one parameter.
 */
export type GenerateCommand = (input: {
  file: string;
  args: readonly string[];
  options: SpawnSyncOptionsWithStringEncoding;
}) => Pick<SpawnSyncReturns<string>, "error" | "status" | "stderr" | "stdout">;

/** The production {@link GenerateCommand}: a synchronous child process, exactly as the generate always ran. */
const runDrizzleGenerate: GenerateCommand = ({ file, args, options }) => spawnSync(file, args, options);

/** What one generate did. */
export interface GenerateReport {
  /** The `.sql` files present before, by name. */
  readonly before: readonly string[];
  /** The `.sql` files present after, by name. */
  readonly after: readonly string[];
  /** The files the generate added — empty when the schema and the migrations already agreed. */
  readonly created: readonly string[];
}

/**
 * The `.sql` file names in a migrations directory, sorted, or none when the directory is not there yet.
 *
 * @param dir the migrations directory
 * @returns the names
 * @internal
 */
export function migrationFileNames({ dir }: { dir: string }): readonly string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .toSorted();
}

/**
 * Generate a migration from the schema into `out`, reporting what was added.
 *
 * `out` is passed explicitly so the caller decides whether this is the real directory or a scratch copy;
 * nothing here defaults it. It is handed to the CLI RELATIVE to `cwd`, because drizzle-kit prefixes its
 * `--out` with `./` unconditionally — MEASURED, an absolute scratch path became
 * `.//var/folders/…` and the snapshot read failed with ENOENT. The CLI's own exit code and stderr are
 * the failure — drizzle-kit prints its reason plainly when the schema does not load.
 *
 * @param cwd the repository root, where `node_modules/.bin/drizzle-kit` and the schema module live
 * @param out the migrations directory to write into
 * @param runCommand what starts `drizzle-kit`; a child process unless a test supplies a fake
 * @returns the file names before and after, and the ones created
 */
export function generateMigrations({
  cwd,
  out,
  runCommand = runDrizzleGenerate,
}: {
  cwd: string;
  out: string;
  runCommand?: GenerateCommand;
}): Result<GenerateReport, StoreError> {
  const before = migrationFileNames({ dir: out });
  const run = runCommand({
    args: ["generate", "--dialect", "postgresql", "--schema", SCHEMA_MODULE, "--out", relative(cwd, out)],
    file: join(cwd, "node_modules", ".bin", "drizzle-kit"),
    options: { cwd, encoding: "utf8", env: { ...process.env, SLOPWEAVER_STORE_URL: "" } },
  });
  if (run.error !== undefined) {
    return err(StoreErrors.generateLaunchFailed({ detail: run.error.message }));
  }
  if (run.status !== 0) {
    const tail = `${run.stdout}\n${run.stderr}`.trim().split("\n").slice(-12);
    return err(StoreErrors.generateExited({ status: run.status, tail }));
  }
  const after = migrationFileNames({ dir: out });
  const committed = new Set(before);
  return ok({ after, before, created: after.filter((name) => !committed.has(name)) });
}
