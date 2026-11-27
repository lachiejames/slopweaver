/**
 * The one step of a close that runs someone else's code: the owner's list refreshed by a `slopweaver session-start`
 * child, in a private directory, and copied into the tick's own only once that directory is checked to be the one
 * the close read — or, with `--your-list`, a list the chair already produced copied in with no child at all.
 *
 * ## Why a handed list, and not a wider budget
 *
 * The child runs under `REFRESH_TIMEOUT_MS` (`./scratchRefresh.ts`), and under load (a load average near 27) it
 * does not finish inside it: every route the chair has to a fresh list — this one and `supervisor refresh-run` —
 * kills it at 420 s, the seat's list is then over ninety minutes old, and the render refuses the page. Run bare, the same
 * `session-start` finished. So the budget stays (it bounds the close, never the result), the ninety-minute door
 * stays, and a close that overran says exactly how to produce the list bare and hand it back.
 *
 * The child is now also handed a soft `--deadline` inside that budget (`REFRESH_DEADLINE_MS`), past which it skips
 * its remaining live legs and its live re-read and writes the list it has, its `cutShort` naming what it skipped.
 * So under load the close gets a fresh list cut short rather than a stale one; the overrun route below is the
 * backstop for a run whose local reads alone outlast the budget.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sha256Hex } from "#lib/hash.js";
import { quietLauncherEnv } from "#lib/launcherEnv.js";
import { err, ok, type Result } from "#lib/result.js";
import { shellCommandLine } from "#lib/shellCommandLine.js";
import { writeFileAtomicBytes } from "#lib/writeAtomic.js";

import type { ScratchError } from "../../../supervisor/scratch/errors.js";
import { confinedChildEnv, tickConfinement } from "../../../supervisor/scratch/tickConfinement.js";
import { type TickWorkflowError, TickWorkflowErrors } from "../../../supervisor/tickWorkflowErrors.js";
import { rebuildRunJson } from "./scratchRefresh.js";
import { stagedListDecision } from "./tickCloseListPolicy.js";
import type { CloseRead } from "./tickCloseRead.js";
import type { TickCloseArgs } from "./tickCore.js";
import type { SupervisorTickDeps } from "./tickDeps.js";
import { datableRun, isRegularFile, readRegularFileBytes, runAgeMinutes, tickDirIntact } from "./tickFiles.js";

/** The file the overrun route tells the chair to write the owner's list to, inside the seat's directory. */
const HANDED_LIST_FILE = "run.fresh.json";

/**
 * Which list a close renders: the tick's staged `run.json` with the digest of its exact bytes, or the seat's own,
 * which carries none. A discriminated pair, so a staged render without a digest cannot be built.
 */
export type RefreshedList =
  { readonly refreshed: true; readonly listSha256: string } | { readonly refreshed: false; readonly listSha256: null };

/** The seat's own list is rendered; nothing staged is bound. */
const SEAT_LIST: RefreshedList = { listSha256: null, refreshed: false };

/**
 * The bytes of the regular file at a staged list's path, once — only when they still hash to the digest a close
 * bound. Read strictly, so a link or a directory there is a refusal rather than something followed. Whoever uses
 * the list uses THESE bytes, never the path again, so nothing can be swapped in between the check and the use.
 *
 * @param path the tick's staged `run.json`
 * @param listSha256 the digest the close bound
 * @returns the bound bytes, or the line naming the path and what is there instead
 */
export function boundListBytes({ path, listSha256 }: { path: string; listSha256: string }): Result<Buffer, string> {
  const bytes = readRegularFileBytes({ path });
  if (bytes.isErr()) {
    return err(bytes.error);
  }
  const now = sha256Hex({ bytes: bytes.value });
  if (now === listSha256) {
    return ok(bytes.value);
  }
  return err(listReplacedLine({ bound: listSha256, now, path }));
}

/**
 * The one line naming a staged list replaced since the close bound it.
 *
 * @param bound the digest the close bound
 * @param now the digest of what is there now
 * @returns the line
 */
export function listReplacedLine({ path, bound, now }: { path: string; bound: string; now: string }): string {
  return (
    `${path} is no longer the list this close bound (sha256 ${bound.slice(0, 12)}, now ${now.slice(0, 12)}) ` +
    "— restore that list to resume, or remove close-state.json to restart the close"
  );
}

/**
 * The digest of the regular file at the staged path, when the policy needs it: only a close state recording a
 * staged-list digest compares one.
 *
 * A bound list that exists but cannot be READ fails the resume closed, even when its bytes are unchanged: the
 * close can no longer show the list is the one it bound, and that showing is the whole point. Reusing the file
 * on `isRegularFile` alone would complete such a resume; restoring read access to the file is the route back.
 *
 * @param staged the tick's `run.json`
 * @returns the digest, undefined when there is no regular file or no comparison to make, or the read's failure
 */
function stagedDigest({ read, staged }: { read: CloseRead; staged: string }): Result<string | undefined, string> {
  if (typeof read.state?.listSha256 !== "string" || !isRegularFile({ path: staged })) {
    return ok(undefined);
  }
  return readRegularFileBytes({ path: staged }).map((bytes) => sha256Hex({ bytes }));
}

/**
 * Refresh the owner's list into the tick's own directory. A child failure leaves the seat's `run.json` to be rendered and
 * says how old it is; the render's own ninety-minute gate then decides whether that is publishable.
 *
 * A list an earlier close of this tick staged is reused only once that close committed a stage AND its bytes still
 * hash to the digest the close state recorded; an uncommitted retry replaces it, so a refused close cannot freeze
 * the tick on its list, and a replaced one is refused (`./tickCloseListPolicy.ts`).
 *
 * The child runs in a PRIVATE directory, never the tick's: it is a `--bin` of the caller's choosing, and a list
 * promoted into the tick's directory after the child could have swapped that directory for a link would land on
 * the seat. The close copies the result in itself, after checking the directory is the one it read.
 *
 * @returns which list the close renders and the digest of the staged bytes, or why the list could not be used
 */
export async function refreshList({
  args,
  deps,
  read,
}: {
  args: TickCloseArgs;
  deps: SupervisorTickDeps;
  read: CloseRead;
}): Promise<Result<RefreshedList, TickWorkflowError>> {
  const staged = join(read.tickDir, "run.json");
  const source = args.yourList;
  const digest = stagedDigest({ read, staged });
  if (digest.isErr()) {
    return listRefused({ reason: digest.error });
  }
  // ANY state file counts as committed, `done: []` included: `commitClose` saves that state only after the render
  // accepted the staged list, and right before the first stage's side effect, so a kill inside that stage leaves
  // `done` empty with the form already written (reading `done: []` as nothing decided would be wrong).
  const decision = stagedListDecision({
    recordedListSha256: read.state?.listSha256,
    stagedListSha256: digest.value,
  });
  switch (decision.kind) {
    case "reuse":
      if (source !== undefined) {
        deps.scratch.writeDiagnostic(
          `supervisor tick close: this close already committed a stage, so it keeps the list it staged at ${staged} ` +
            `and does not read --your-list ${source}`,
        );
      }
      return ok({ listSha256: decision.listSha256, refreshed: true });
    case "refuse":
      // Its committed stages were decided against a list that is gone or replaced; another would not be that list.
      return listRefused({ reason: `${staged}: ${decision.reason}` });
    case "replace":
      return replaceList({ args, deps, read, source, staged });
    default: {
      const unreachable: never = decision;
      return unreachable;
    }
  }
}

/**
 * Stage a fresh list in the tick: the handed one copied in, or the refresh child's.
 *
 * @param source the `--your-list` path, undefined for a bare close
 * @param staged the tick's own `run.json`
 * @returns which list the close renders, or why a handed list could not be used
 */
async function replaceList({
  args,
  deps,
  read,
  source,
  staged,
}: {
  args: TickCloseArgs;
  deps: SupervisorTickDeps;
  read: CloseRead;
  source: string | undefined;
  staged: string;
}): Promise<Result<RefreshedList, TickWorkflowError>> {
  if (source !== undefined) {
    return copyHandedList({ read, source, staged });
  }
  const { bin = deps.scratch.defaultBin() } = args;
  // A close confined to a scratch `--home` refreshes the list from that home, never the owner's own.
  const confinement = tickConfinement({ ambientHome: deps.defaultHome(), home: args.home });
  const env = confinedChildEnv({ base: quietLauncherEnv(), confinement });
  const privateDir = mkdtempSync(join(tmpdir(), "tick-refresh-"));
  try {
    const rebuilt = await rebuildRunJson({
      bin,
      deps: deps.scratch,
      dir: privateDir,
      qualifyAs: undefined,
      ...(env === undefined ? {} : { env }),
    });
    if (rebuilt.isErr()) {
      return ok(staleList({ args, deps, failure: rebuilt.error, read }));
    }
    // Read BEFORE the check, so nothing but the check stands between it and the write it guards.
    const bytes = readFileSync(join(privateDir, "run.json"));
    const intact = tickDirIntact({ identity: read.tickDirIdentity, tickDir: read.tickDir });
    if (intact.isErr()) {
      return ok(staleList({ args, deps, failure: intact.error, read }));
    }
    writeFileAtomicBytes({ bytes, path: staged });
    return ok({ listSha256: sha256Hex({ bytes }), refreshed: true });
  } finally {
    rmSync(privateDir, { force: true, recursive: true });
  }
}

/**
 * Copy a list the chair handed in into the tick, launching no child. Refused rather than falling back to the
 * seat's list, because a named source silently ignored could publish a different list than the one the owner was
 * told was used. Whether to copy at all is `refreshList`'s call, through the shared policy.
 *
 * @param source the `--your-list` path
 * @param staged the tick's own `run.json`
 * @returns the handed bytes' digest once the tick holds them, or the refusal naming the source
 */
function copyHandedList({
  read,
  source,
  staged,
}: {
  read: CloseRead;
  source: string;
  staged: string;
}): Result<RefreshedList, TickWorkflowError> {
  // Read BEFORE the check, exactly as the child's list is, so only the check stands between it and the write.
  const bytes = readRegularFileBytes({ path: source });
  if (bytes.isErr()) {
    return listRefused({ reason: bytes.error });
  }
  const datable = datableRun({ bytes: bytes.value, path: source });
  if (datable.isErr()) {
    return listRefused({ reason: datable.error.message });
  }
  const intact = tickDirIntact({ identity: read.tickDirIdentity, tickDir: read.tickDir });
  if (intact.isErr()) {
    return err(intact.error);
  }
  try {
    writeFileAtomicBytes({ bytes: bytes.value, path: staged });
  } catch (cause: unknown) {
    return listRefused({ reason: `${staged}: ${cause instanceof Error ? cause.message : "could not be written"}` });
  }
  return ok({ listSha256: sha256Hex({ bytes: bytes.value }), refreshed: true });
}

/**
 * A list refused, as the close's preflight refusal naming `--your-list`.
 *
 * @param reason the line naming the file and what is wrong with it
 * @returns the refusal
 */
function listRefused({ reason }: { reason: string }): Result<RefreshedList, TickWorkflowError> {
  return err(TickWorkflowErrors.preflightRefused({ reasons: [reason], stage: "--your-list" }));
}

/**
 * Say that the owner's list was not refreshed, and how old the seat's own is — and, when the child overran its budget,
 * the two commands that produce the list with no budget and hand it back.
 *
 * @param failure the refresh's own failure
 * @returns the seat's list, so the render reads it and nothing staged is bound
 */
function staleList({
  args,
  deps,
  read,
  failure,
}: {
  args: TickCloseArgs;
  deps: SupervisorTickDeps;
  read: CloseRead;
  failure: ScratchError | TickWorkflowError;
}): RefreshedList {
  const age = runAgeMinutes({ nowIso: deps.scratch.now(), path: join(read.dir, "run.json") });
  const stated = age === undefined ? "the seat has none" : `the seat's is ${String(Math.round(age))} min old`;
  deps.scratch.writeDiagnostic(
    `supervisor tick close: the owner's list was not refreshed (${failure.message}); ${stated}`,
  );
  if (failure.code === "CHILD_FAILED" && failure.outcome.kind === "timed-out") {
    for (const line of overrunRoute({ args, dir: read.dir })) {
      deps.scratch.writeDiagnostic(line);
    }
  }
  return SEAT_LIST;
}

/**
 * What to do when the refresh child overran: build the list bare, in the background, then close with it.
 *
 * @param dir the seat's scratch directory, where the handed list is written
 * @returns the lines, each command a line that pastes and runs
 */
function overrunRoute({ args, dir }: { args: TickCloseArgs; dir: string }): readonly string[] {
  const handed = join(dir, HANDED_LIST_FILE);
  const close = [
    "slopweaver",
    "supervisor",
    "tick",
    "close",
    "--dir",
    dir,
    ...(args.tick === undefined ? [] : ["--tick", String(args.tick)]),
    ...(args.home === undefined ? [] : ["--home", args.home]),
    "--your-list",
    handed,
  ];
  return [
    "supervisor tick close: the refresh overran its budget under load — build the list with no budget, as a " +
      "background job that resumes you (never a sleep-poll):",
    `  ${shellCommandLine({
      command: [
        "slopweaver",
        "session-start",
        "--json",
        "--no-record",
        ...(args.home === undefined ? [] : ["--home", args.home]),
        "--out",
        handed,
      ],
    })}`,
    `  then: ${shellCommandLine({ command: close })}`,
  ];
}
