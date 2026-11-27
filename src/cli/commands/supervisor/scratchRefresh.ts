/**
 * `slopweaver supervisor refresh-run` — rebuild a seat's `run.json` from `session-start --json` under its own
 * budget, and the bare-reference-qualified autonomy ledger beside it.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { quietLauncherEnv } from "#lib/launcherEnv.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { renameStagedFile, writeFileAtomicStream } from "#lib/writeAtomic.js";

import type { AutonomyLedgerPort } from "../../../autonomy/port.js";
import { sessionStartDocumentIssues } from "../../../briefing/yourList.js";
import { readJsonlLines } from "../../../corpus/corpusStore.js";
import { exitCodeOf } from "../../../supervisor/scratch/childOutcome.js";
import { type ScratchError, ScratchErrors } from "../../../supervisor/scratch/errors.js";
import { qualifyBareRefs } from "../../../supervisor/scratch/qualifyRefs.js";
import { confinedChildEnv, tickConfinement } from "../../../supervisor/scratch/tickConfinement.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK } from "../../exitCodes.js";
import { resolveHome, verbTail } from "../../optionParsers.js";
import { parseRefreshRunArgs, SUPERVISOR_REFRESH_RUN_USAGE } from "./scratchCore.js";
import { chosenBin, productionScratchDeps, refuse, type ScratchDeps } from "./scratchDeps.js";

/**
 * Stream one file into another, qualifying every bare reference line by line, atomically.
 *
 * @param from the file to read
 * @param to the file to replace
 * @param repo the `owner/name` a bare reference belongs to
 * @returns how many references were qualified
 */
function qualifyFile({ from, to, repo }: { from: string; to: string; repo: string }): number {
  let count = 0;
  writeFileAtomicStream({
    path: to,
    produce: ({ write }) => {
      readJsonlLines({
        onLine: ({ line, index }) => {
          const qualified = qualifyBareRefs({ line, repo });
          count += qualified.count;
          write({ text: index === 0 ? qualified.line : `\n${qualified.line}` });
        },
        path: from,
      });
    },
  });
  return count;
}

/**
 * Rebuild `run.json` and `autonomy-qualified.jsonl` in one scratch directory.
 *
 * @param rest the argv after `supervisor refresh-run`
 * @param deps the injected seams
 * @returns the exit code
 * @internal — read by this module and its own tests.
 */
export async function runRefreshRun({ rest, deps }: { rest: readonly string[]; deps: ScratchDeps }): Promise<number> {
  const parsed = parseRefreshRunArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ deps, error: parsed.error, usage: SUPERVISOR_REFRESH_RUN_USAGE, verb: "refresh-run" });
  }
  const args = parsed.value;
  const dir = resolve(args.dir);
  const chosen = chosenRepo({ deps, repo: args.repo });
  if (chosen.isErr()) {
    return refuse({ deps, error: chosen.error, usage: SUPERVISOR_REFRESH_RUN_USAGE, verb: "refresh-run" });
  }
  // A `--home` other than the ambient one builds the list from that home, never the owner's own.
  const env = confinedChildEnv({
    base: quietLauncherEnv(),
    confinement: tickConfinement({ ambientHome: deps.ambientHome(), home: args.home }),
  });
  const rebuilt = await rebuildRunJson({
    bin: chosenBin({ bin: args.bin, deps }),
    deps,
    dir,
    qualifyAs: chosen.value,
    ...(env === undefined ? {} : { env }),
  });
  if (rebuilt.isErr()) {
    return refuse({ deps, error: rebuilt.error, usage: SUPERVISOR_REFRESH_RUN_USAGE, verb: "refresh-run" });
  }
  const repo = chosen.value;
  const refreshed = await rebuildAutonomy({ autonomy: deps.autonomy, dir, home: args.home, repo });
  if (refreshed.isErr()) {
    return refuse({ deps, error: refreshed.error, usage: SUPERVISOR_REFRESH_RUN_USAGE, verb: "refresh-run" });
  }
  const autonomy = refreshed.value;
  const runCount = rebuilt.value;
  const runJson = join(dir, "run.json");
  if (args.json) {
    deps.writeOut(JSON.stringify({ autonomy, repo, run: { path: runJson, qualified: runCount } }));
    return EXIT_OK;
  }
  deps.writeOut(
    `supervisor refresh-run: wrote ${runJson} — ${String(runCount)} bare reference(s) qualified as ${repo}`,
  );
  deps.writeOut(
    `  wrote ${autonomy.path} — ${String(autonomy.records)} record(s), ${String(autonomy.qualified)} bare reference(s) qualified`,
  );
  return EXIT_OK;
}

/**
 * The repository a bare reference belongs to: `--repo`, or the origin of the checkout this runs in.
 *
 * @param repo the `--repo` value, when passed
 * @param deps the injected seams
 * @returns the `owner/name`, or a usage refusal when neither names one
 */
function chosenRepo({ repo, deps }: { repo: string | undefined; deps: ScratchDeps }): Result<string, ScratchError> {
  if (repo !== undefined) {
    return ok(repo);
  }
  return deps
    .defaultRepo()
    .mapErr((lines) => ScratchErrors.usage({ message: `--repo is required here: ${lines.join("; ")}` }));
}

/**
 * The budget the `session-start` refresh gets before it is killed. A BUDGET: over the chair's passes 597–616
 * a 180-second wait failed 14 of about 18 times at a load average of 25–61, so this is wider,
 * and what it bounds is the wait, never the result — an overrun keeps the previous `run.json`.
 */
export const REFRESH_TIMEOUT_MS = 420_000;

/**
 * How long after launch the child is told to stop reading: its `session-start --deadline`. Under the hard kill by
 * two minutes, the margin for the work a deadline cannot stop — the board, ranking, standings and the write (the
 * Slack scan stops between chunks) — so a loaded run hands back a list cut short, saying which legs it skipped, instead of being killed
 * with half a document. Measured at a load average of 20: a whole run took 37 s wall and 9 s of CPU
 * (`/usr/bin/time -p slopweaver session-start --json --no-record --out <file>`), and the same run with every live
 * read cut took 2.6 s (`… --deadline <an instant already past>`) — so the time is the live reads the deadline races, and
 * the unstoppable remainder is a small fraction of the margin.
 */
export const REFRESH_DEADLINE_MS = 300_000;

/**
 * Why a staged `session-start --json` file is not a document the briefing page could read: not JSON at all
 * (truncated mid-write, say), or JSON missing what a row needs. The check is the page's own
 * ({@link sessionStartDocumentIssues}), so a file this accepts is one the page accepts.
 *
 * @param path the staged file
 * @returns one line per issue, empty when the document reads
 */
function stagedDocumentIssues({ path }: { path: string }): readonly string[] {
  let document: unknown;
  try {
    document = safeJsonParse({ label: "a staged session-start document", text: readFileSync(path, "utf8") });
  } catch (cause: unknown) {
    return [`not JSON: ${cause instanceof Error ? cause.message : "it threw a value that is not an Error"}`];
  }
  return sessionStartDocumentIssues({ document });
}

/**
 * Rebuild `run.json` from `session-start`, through a staged file, leaving the old one when the child fails or
 * overruns its budget.
 *
 * @param dir the scratch directory
 * @param bin the `slopweaver` binary the child launches from
 * @param qualifyAs the `owner/name` every bare reference is rewritten to, or undefined to write the run as
 *   `session-start` printed it — each row's own repository then resolves its references on the page
 * @param deps the injected seams
 * @param env the child's whole environment, set only by a close confined to a scratch home
 *   (`../../../supervisor/scratch/tickConfinement.ts`); absent, it keeps the quiet launcher environment
 * @returns how many references were qualified, or why nothing was written
 */
export async function rebuildRunJson({
  dir,
  bin,
  qualifyAs,
  deps,
  env,
}: {
  dir: string;
  bin: string;
  qualifyAs: string | undefined;
  deps: ScratchDeps;
  env?: NodeJS.ProcessEnv;
}): Promise<Result<number, ScratchError>> {
  if (!existsSync(dir)) {
    return err(ScratchErrors.fileFailed({ cause: new Error("no such directory"), path: dir }));
  }
  const deadline = new Date(Date.parse(deps.now()) + REFRESH_DEADLINE_MS).toISOString();
  const argv = ["session-start", "--json", "--no-record", "--deadline", deadline];
  // One staging name per invocation: two refreshes of one seat (a tick close beside a hand-run refresh) must never
  // promote each other's child output.
  const staged = join(dir, `run.json.session-start.${String(process.pid)}.${randomUUID()}`);
  const promoted = await promoteChildOutput({ argv, bin, deps, dir, env, qualifyAs, staged });
  for (const path of [staged, qualifiedStagePath({ staged })]) {
    try {
      rmSync(path, { force: true });
    } catch (cause: unknown) {
      // A staged file left behind is overwritten by the next refresh; it never outranks why this one failed.
      if (promoted.isOk()) {
        return err(ScratchErrors.fileFailed({ cause, path }));
      }
    }
  }
  return promoted;
}

/**
 * Where the reference-qualified copy of the staged document is written before it is checked and promoted.
 *
 * @param staged the file the child's stdout was written to
 * @returns the path beside it
 */
function qualifiedStagePath({ staged }: { staged: string }): string {
  return `${staged}.qualified`;
}

/**
 * Launch the child into the staged file and put what it printed in place of `run.json`, only when it is a whole
 * document the page reads. Leaves the staged file for the caller to remove.
 *
 * @param argv the `session-start` arguments
 * @param bin the `slopweaver` binary the child launches from
 * @param dir the scratch directory
 * @param qualifyAs the `owner/name` every bare reference is rewritten to, or undefined to rename as printed
 * @param staged the file the child's stdout is written to
 * @param deps the injected seams
 * @param env the child's whole environment, when the refresh is confined
 * @returns how many references were qualified, or why `run.json` was left as it was
 */
async function promoteChildOutput({
  argv,
  bin,
  deps,
  dir,
  env,
  qualifyAs,
  staged,
}: {
  argv: readonly string[];
  bin: string;
  deps: ScratchDeps;
  dir: string;
  env: NodeJS.ProcessEnv | undefined;
  qualifyAs: string | undefined;
  staged: string;
}): Promise<Result<number, ScratchError>> {
  const runJson = join(dir, "run.json");
  try {
    const outcome = await deps.runChild({
      argv,
      bin,
      stderrPath: join(dir, "run.err"),
      stdoutPath: staged,
      timeoutMs: REFRESH_TIMEOUT_MS,
      ...(env === undefined ? {} : { env }),
    });
    if (exitCodeOf({ outcome }) !== 0) {
      return err(ScratchErrors.childFailed({ argv, outcome }));
    }
    // A child that exits 0 with nothing on stdout must never replace a good run.json with an empty one.
    if (statSync(staged).size === 0) {
      return err(ScratchErrors.childSilent({ argv }));
    }
    // Nor with a truncated or schema-invalid one: the page would refuse it, and the good one would be gone.
    const issues = stagedDocumentIssues({ path: staged });
    if (issues.length > 0) {
      return err(ScratchErrors.childUnreadable({ argv, issues }));
    }
    if (qualifyAs === undefined) {
      renameStagedFile({ flushDirectory: true, from: staged, to: runJson });
      return ok(0);
    }
    // Qualify into a second staged file, never straight into run.json: the rewrite lengthens fields, so the document
    // promoted is checked again after it.
    const candidate = qualifiedStagePath({ staged });
    const qualified = qualifyFile({ from: staged, repo: qualifyAs, to: candidate });
    const qualifiedIssues = stagedDocumentIssues({ path: candidate });
    if (qualifiedIssues.length > 0) {
      return err(ScratchErrors.childUnreadable({ argv, issues: qualifiedIssues }));
    }
    renameStagedFile({ flushDirectory: true, from: candidate, to: runJson });
    return ok(qualified);
  } catch (cause: unknown) {
    return err(ScratchErrors.fileFailed({ cause, path: runJson }));
  }
}

/** What `refresh-run` did with the autonomy ledger: how many records it copied, and how many references it qualified. */
export interface AutonomyRefresh {
  readonly path: string;
  readonly records: number;
  readonly qualified: number;
}

/**
 * Rebuild `autonomy-qualified.jsonl` from the store's autonomy ledger, one record per line.
 *
 * An empty ledger writes an empty file rather than none, so a seat never reads a copy older than the store. A
 * store that cannot answer refuses: a stale copy left in place would read as the ledger it no longer matches.
 *
 * @param autonomy the store's autonomy ledger
 * @param dir the scratch directory
 * @param home the state home whose ledger is read, when `--home` named one
 * @param repo the `owner/name` a bare reference belongs to
 * @returns what was written, or why nothing was
 */
export async function rebuildAutonomy({
  autonomy,
  dir,
  home,
  repo,
}: {
  autonomy: AutonomyLedgerPort;
  dir: string;
  home: string | undefined;
  repo: string;
}): Promise<Result<AutonomyRefresh, ScratchError>> {
  const read = await autonomy.readRecords({ home: resolveHome({ named: home }) });
  if (read.isErr()) {
    return err(ScratchErrors.ledgerUnreadable({ reason: read.error.message }));
  }
  const path = join(dir, "autonomy-qualified.jsonl");
  let qualified = 0;
  try {
    writeFileAtomicStream({
      path,
      produce: ({ write }) => {
        read.value.forEach((record) => {
          const line = qualifyBareRefs({ line: JSON.stringify(record), repo });
          qualified += line.count;
          write({ text: `${line.line}\n` });
        });
      },
    });
  } catch (cause: unknown) {
    return err(ScratchErrors.fileFailed({ cause, path }));
  }
  return ok({ path, qualified, records: read.value.length });
}

/** `slopweaver supervisor refresh-run`. */
export const supervisorRefreshRunCommand = defineCommand({
  run: (argv) => runRefreshRun({ deps: productionScratchDeps(), rest: verbTail({ argv, verbs: ["refresh-run"] }) }),
});
