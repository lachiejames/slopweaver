/**
 * `slopweaver codex extend` — the pinned supervisor approves ONE exact diff to review past the two-pass cap, for
 * one run's branch in one lane, with its reason on the record (`../../../codex/passExtension.ts`).
 *
 * A pass past the cap is a supervisor-approved extension, and reaches the owner only when the approach itself
 * carries a big trade-off. So a seat whose review is refused at the cap sends the supervisor one line naming the
 * run, the diff the refusal printed, and why; the supervisor judges it and runs this; the seat's next review of
 * THAT diff (`codex review` or `review-fallback prepare`) is admitted and names the row by id. A later fix is a new
 * diff and is refused again.
 *
 * ## What it refuses
 *
 * - **Any caller but the pinned supervisor** (`../../../codex/passExtensionGrant.ts`): no pin, an unreadable pin,
 *   no session identity, two identities, another holder. No hatch: a hatch is the self-grant it exists to refuse.
 * - **A run it cannot place** on its journalled branch and a checkout with that branch out (`./extendPlacement.ts`).
 * - **A second extension for the run's lane that does not name the first**, `--after` on a first, or a second row
 *   for a diff already approved (`../../../codex/passExtensionSequence.ts`).
 * - **A grant while another holds the register's lock.** The read, that sequence check and the append run under one
 *   operation lock (`../../../admit/operationLock.ts`), so two concurrent grants cannot both read an empty register,
 *   or the same latest row, and both pass; the loser records nothing and says to run again.
 *
 * - **A damaged register line that may be this run's own** — one that will not decode and does not name another run
 *   — since skipping it would let this grant pass as a first. The refusal names the lines to repair by hand.
 *
 * A damaged line that still names ANOTHER run approves nothing at the gate and is no part of this run's history,
 * so here it is skipped and reported rather than blocking the supervisor. The verb records the diff hash it is
 * given and computes none: the supervisor reads that diff before granting. `--list` reads the register back. The
 * flags and usage are `./extendArgs.ts`.
 */

import { randomUUID } from "node:crypto";

import { acquireOperationLock } from "../../../admit/operationLock.js";
import { type CodexPassExtension, runExtensions } from "../../../codex/passExtension.js";
import { passExtensionGrantVerdict } from "../../../codex/passExtensionGrant.js";
import { damagedHistoryProblem, extensionSequenceProblem } from "../../../codex/passExtensionSequence.js";
import { appendPassExtension, PASS_EXTENSION_LOCK_KEY, readPassExtensions } from "../../../codex/passExtensionStore.js";
import { logger } from "../../../lib/logger.js";
import { readSupervisorPinDisposition } from "../../../sessions/supervisorPinStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { detectSupervisorSession } from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import {
  CODEX_EXTEND_USAGE,
  type ExtendGrantArgs,
  extendGrantArgs,
  parseCodexExtendArgs,
  stringFlag,
} from "./extendArgs.js";
import { type PlacedRun, placeRun } from "./extendPlacement.js";

const VERB_ARG_OFFSET = 4;

/**
 * How old a held register lock must be before another grant may take it over: the locked body is one small read
 * and one append, milliseconds, so a lock this old was left by a process that died holding it.
 */
const LOCK_STALE_AFTER_MS = 60_000;

/**
 * Run the verb over the process environment.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function runCodexExtend(argv: readonly string[]): number {
  return runCodexExtendOver({ argv, env: process.env });
}

/**
 * Run the verb over an injected environment, so a test can be the chair or a seat without touching the process.
 *
 * @param argv the whole process argv
 * @param env the environment the caller's session identity is read from
 * @returns the process exit code
 */
export function runCodexExtendOver({
  argv,
  env,
}: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
}): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CODEX_EXTEND_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCodexExtendArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      logger.error({ msg: problem });
    }
    logger.error({ msg: CODEX_EXTEND_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: stringFlag({ name: "home", parsed: parsed.value }) });
  if (parsed.value.values["list"] === true) {
    return listExtensions({ branch: stringFlag({ name: "branch", parsed: parsed.value }), home });
  }
  const args = extendGrantArgs({ parsed: parsed.value });
  if (args.isErr()) {
    logger.error({ msg: args.error.message });
    if (args.error.showUsage) {
      logger.error({ msg: CODEX_EXTEND_USAGE });
    }
    return EXIT_USAGE;
  }
  return grant({ args: args.value, env, home });
}

/**
 * Print the refusal for a caller that is not the chair, in the shape of a hold: no hatch, the fix named.
 *
 * @param reason why the caller is not the pinned supervisor
 */
function refuseSeat({ reason }: { reason: string }): void {
  logger.error({ msg: `codex extend: REFUSED — ${reason}.` });
  logger.error({
    msg:
      "No hatch opens this: a pass a seat grants itself is exactly what it refuses. NOTHING was recorded — send the " +
      "pinned supervisor one line naming the run, the diff the cap printed and why one more pass earns its cost " +
      "(SendMessage; ListAgents resolves its name). If THIS session is the chair, `slopweaver cmux pin` records it.",
  });
}

/** Print a refusal that recorded nothing. */
function refuse({ why }: { why: string }): number {
  logger.error({ msg: `codex extend: REFUSED — ${why}. NOTHING was recorded.` });
  return EXIT_ERROR;
}

/**
 * Judge the caller, place the run, and — holding the register's lock — check its earlier extensions and append one
 * row for one diff.
 *
 * @param args the grant's checked flags
 * @param env the environment the caller's session identity is read from
 * @returns the process exit code
 */
function grant({
  args,
  env,
  home,
}: {
  args: ExtendGrantArgs;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}): number {
  const verdict = passExtensionGrantVerdict({
    detection: detectSupervisorSession({ env }),
    pin: readSupervisorPinDisposition({ home }),
  });
  if (verdict.kind === "refused") {
    refuseSeat({ reason: verdict.reason });
    return EXIT_ERROR;
  }
  const placed = placeRun({ home, repo: args.repo, run: args.run });
  if (placed.isErr()) {
    return refuse({ why: placed.error.message });
  }
  const lock = acquireOperationLock({
    home,
    key: PASS_EXTENSION_LOCK_KEY,
    nowIso: new Date().toISOString(),
    staleAfterMs: LOCK_STALE_AFTER_MS,
  });
  if (lock.isErr()) {
    return refuse({ why: `another codex extend is recording right now (${lock.error}); run this again` });
  }
  try {
    return recordUnderLock({ args, grantedBy: verdict.grantedBy, home, placed: placed.value });
  } finally {
    lock.value.release();
  }
}

/**
 * Read the register, check the run's earlier extensions and append one row — all under the caller's lock, so two
 * concurrent grants cannot both read the same register and both pass the one-per-run-and-lane rule.
 *
 * @param grantedBy the pinned supervisor's session the verdict named
 * @param placed the run's branch, checkout and repository
 * @returns the process exit code
 */
function recordUnderLock({
  args,
  grantedBy,
  home,
  placed,
}: {
  args: ExtendGrantArgs;
  grantedBy: CodexPassExtension["grantedBy"];
  home: string;
  placed: PlacedRun;
}): number {
  const register = readPassExtensions({ home });
  if (register.isErr()) {
    return refuse({ why: register.error.message });
  }
  const damaged = damagedHistoryProblem({ run: args.run, unreadable: register.value.unreadable });
  if (damaged !== undefined) {
    return refuse({ why: `${damaged} (${stateHomePaths({ home }).codexPassExtensionsJsonl})` });
  }
  for (const line of register.value.unreadable) {
    logger.error({
      msg: `codex extend: skipped run ${String(line.run)}'s unreadable register row, which approves nothing (${line.detail})`,
    });
  }
  const { gitCommonDir } = placed;
  const prior = runExtensions({ lane: args.lane, rows: register.value.rows, run: args.run });
  const problem = extensionSequenceProblem({ after: args.after, diff: args.diff, prior });
  if (problem !== undefined) {
    return refuse({ why: problem });
  }
  const row: CodexPassExtension = {
    after: args.after,
    atIso: new Date().toISOString(),
    branch: placed.branch,
    diffSha256: args.diff,
    gitCommonDir,
    grantedBy,
    id: randomUUID(),
    lane: args.lane,
    reason: args.reason,
    repoRoot: placed.repoRoot,
    run: args.run,
    schemaVersion: 1,
  };
  const written = appendPassExtension({ home, row });
  if (written.isErr()) {
    logger.error({ msg: `codex extend: ${written.error.message}` });
    return EXIT_ERROR;
  }
  printGranted({ row });
  return EXIT_OK;
}

/** Print the row just recorded, and what it admits. */
function printGranted({ row }: { row: CodexPassExtension }): void {
  logger.out({
    line:
      `codex extend: ${row.lane} review of diff ${row.diffSha256} approved past the cap on ${row.branch} ` +
      `for run ${row.run} (${row.id})`,
  });
  logger.out({ line: `  reason: ${row.reason}` });
  logger.out({ line: "  a review of exactly that diff is admitted and names this row; a later fix is a new diff" });
}

/**
 * Print every recorded extension, optionally only those recorded for one literal branch name.
 *
 * @param branch the recorded branch name to filter by — literal, never a rename's continuation
 * @returns the process exit code: an error when any line would not read
 */
function listExtensions({ branch, home }: { branch: string | undefined; home: string }): number {
  const register = readPassExtensions({ home });
  if (register.isErr()) {
    logger.error({ msg: `codex extend: ${register.error.message}` });
    return EXIT_ERROR;
  }
  const rows = register.value.rows.filter((row) => branch === undefined || row.branch === branch);
  if (rows.length === 0) {
    logger.out({ line: "codex extend: no extension recorded" });
  }
  for (const row of rows) {
    const follows = row.after === undefined ? "" : `  after ${row.after}`;
    logger.out({
      line:
        `${row.atIso}  ${row.id}  ${row.lane}  ${row.branch}  run ${row.run}  diff ${row.diffSha256}${follows}  ` +
        `by ${row.grantedBy.host} ${row.grantedBy.id}  ${row.repoRoot} — ${row.reason}`,
    });
  }
  for (const line of register.value.unreadable) {
    logger.error({ msg: `codex extend: unreadable ${line.detail}` });
  }
  if (register.value.unreadable.length > 0) {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/** `slopweaver codex extend`. */
export const codexExtendCommand = defineCommand({ run: runCodexExtend });
