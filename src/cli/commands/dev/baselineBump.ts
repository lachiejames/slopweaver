/**
 * `slopweaver dev baseline-bump` — declare what this change loosens against main, as a bump record in the state
 * home (`src/codex/bumpRecordStore.ts`), and print the one Codex review that witnesses it.
 *
 * A ratchet rise is a separate act with its own witness, never the implementing
 * session's. This verb is the implementer's HALF: it writes down exactly what rose and why, and nothing it
 * writes grants anything. `github enqueue` and `github merge --admin` refuse a change whose loosened rows no
 * record with a CLEAN Codex review covers; CI's `baseline-against-main` only reports the loosening, because it
 * cannot see the home. Codex capped means the bump waits — there is no fallback witness.
 *
 * It reads COMMITS: commit the baseline change first, then run this. The record is written to the home, once: a second run with the same rows against the same base is refused, its bytes left as they were.
 * Main is `--base`, else the merge-base of `HEAD` with `origin/main`, printed so the reader can check it.
 */

import { bumpRecordPath, writeBumpRecord } from "../../../codex/bumpRecordStore.js";
import { type BumpManifest, witnessCommand } from "../../../devLint/baselineBump.js";
import { compareAgainstBase } from "../../../devLint/baselineComparison.js";
import { gitLines } from "../../../devLint/gitAtCommit.js";
import { type Logger, logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { bumpManifestFor, DEV_BASELINE_BUMP_USAGE, parseBaselineBumpArgs } from "./baselineBumpCore.js";

/** The one line git printed, or `undefined` when it refused or printed nothing. */
function gitLine({ root, args }: { root: string; args: readonly string[] }): string | undefined {
  const lines = gitLines({ args, root });
  if (lines === undefined) {
    return undefined;
  }
  return lines[0];
}

/**
 * Run the verb against an injected logger and working directory, so a test drives the real verb.
 *
 * @param argv the full process argv (the verb tail starts at index 4)
 * @param log where lines go
 * @param cwd the directory the checkout is resolved from
 * @returns EXIT_OK on a record written (or previewed), EXIT_EXPECTED_EMPTY when nothing loosened,
 *   EXIT_ERROR when the checkout or a commit could not be read or the record already exists, EXIT_USAGE on a
 *   bad flag
 */
export function runDevBaselineBumpWithDeps({
  argv,
  log,
  cwd,
}: {
  argv: readonly string[];
  log: Pick<Logger, "error" | "out">;
  cwd: string;
}): number {
  const rest = argv.slice(4);
  if (rest.includes("--help") || rest.includes("-h")) {
    log.out({ line: DEV_BASELINE_BUMP_USAGE });
    return EXIT_OK;
  }
  const parsed = parseBaselineBumpArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of [...parsed.error, DEV_BASELINE_BUMP_USAGE]) {
      log.error({ msg: problem });
    }
    return EXIT_USAGE;
  }
  const root = gitLine({ args: ["rev-parse", "--show-toplevel"], root: cwd });
  if (root === undefined) {
    log.error({ msg: `baseline-bump: ${cwd} is not inside a git checkout` });
    return EXIT_ERROR;
  }
  const { reason, dryRun } = parsed.value;
  const base = resolveMain({ log, named: parsed.value.base, root });
  if (base === undefined) {
    return EXIT_ERROR;
  }
  const compared = compareAgainstBase({ base, head: "HEAD", root });
  if (compared.isErr()) {
    log.error({ msg: `baseline-bump: ${compared.error.message}` });
    return EXIT_ERROR;
  }
  const manifest = bumpManifestFor({ ...compared.value, base, reason });
  if (manifest === undefined) {
    log.error({ msg: `baseline-bump: nothing to declare — HEAD loosens no baseline against ${base.slice(0, 12)}` });
    return EXIT_EXPECTED_EMPTY;
  }
  const source = parsed.value.base === undefined ? "merge-base with origin/main" : "--base";
  log.out({ line: `main is ${base} (${source})` });
  return writeRecord({ base, dryRun, home: resolveHome({ named: parsed.value.home }), log, manifest });
}

/**
 * Main's full commit, from `--base` or the merge-base of `HEAD` with `origin/main`. The record binds the FULL
 * commit, so a short or symbolic `--base` is resolved before anything is compared.
 *
 * @param named the `--base` the caller gave, if any
 * @param log where the reason goes when it cannot be resolved
 * @returns the commit, or `undefined` once the reason is printed
 */
function resolveMain({
  root,
  named,
  log,
}: {
  root: string;
  named: string | undefined;
  log: Pick<Logger, "error">;
}): string | undefined {
  if (named === undefined) {
    const forked = gitLine({ args: ["merge-base", "HEAD", "origin/main"], root });
    if (forked === undefined) {
      log.error({ msg: "baseline-bump: no merge-base of HEAD with origin/main — fetch origin, or pass --base <sha>" });
      return undefined;
    }
    return resolveMain({ log, named: forked, root });
  }
  const base = gitLine({ args: ["rev-parse", "--verify", "--quiet", `${named}^{commit}`], root });
  if (base === undefined) {
    log.error({ msg: `baseline-bump: ${named} is not a commit in this checkout` });
  }
  return base;
}

/**
 * Print the record's rows and write it into the home, or say what a dry run would write.
 *
 * @param manifest the declaration, its digest naming the record
 * @param home the state home the record goes into
 * @returns EXIT_OK once written or previewed, EXIT_ERROR when the record exists or could not be written
 */
function writeRecord({
  base,
  dryRun,
  home,
  log,
  manifest,
}: {
  base: string;
  dryRun: boolean;
  home: string;
  log: Pick<Logger, "error" | "out">;
  manifest: BumpManifest;
}): number {
  for (const row of manifest.loosenings) {
    log.out({ line: `  ${row.file} ${row.entry}: ${String(row.from)} -> ${String(row.to)} (${row.cause})` });
  }
  if (dryRun) {
    log.out({ line: `dry run: would write ${bumpRecordPath({ name: `${manifest.digest}.json` })} under ${home}` });
    return EXIT_OK;
  }
  const written = writeBumpRecord({ home, manifest });
  if (written.isErr()) {
    log.error({ msg: `baseline-bump: ${written.error.message}` });
    return EXIT_ERROR;
  }
  log.out({ line: `wrote ${written.value.path} under ${home}` });
  log.out({ line: "push the change, then take the witness — the landing verbs refuse without it:" });
  log.out({ line: `  ${witnessCommand({ base, manifest })}` });
  return EXIT_OK;
}

/**
 * Run the verb.
 *
 * @param argv the full process argv (the verb tail starts at index 4 — `dev baseline-bump <tail>`)
 * @returns the process exit code — see {@link runDevBaselineBumpWithDeps}
 */
export function runDevBaselineBump(argv: readonly string[]): number {
  return runDevBaselineBumpWithDeps({ argv, cwd: process.cwd(), log: logger });
}

export const devBaselineBumpCommand = defineCommand({ run: runDevBaselineBump });
