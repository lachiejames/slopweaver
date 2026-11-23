/**
 * What `slopweaver github checks` writes to the checks-read register, and the production seams that do it.
 *
 * Split out of `checksRun.ts` along the register seam: the poll loops (the status loop there, the event loop
 * in `checksEventWatch.ts`) decide WHEN a snapshot is the first one and what a watch came to; this file owns what a `read`, `watching` and `watch-done` row carries
 * and the never-fatal contract every append shares. The reader side is `src/outbound/github/watchers.ts`,
 * which lands first so every build can parse these rows before any build writes one.
 */
import { currentSessionId } from "../../../handover/runOwner.js";
import { logger } from "../../../lib/logger.js";
import type { GithubChecksSnapshot } from "../../../live/github/checks.js";
import { appendChecksReadRecord, type ChecksWatchMode } from "../../../outbound/github/checksReadLedger.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";

/**
 * The three register seams `GithubChecksDeps` carries — one per row kind the verb writes. Seams rather than
 * direct appends so a unit test drives the whole shell without a state home; a plain function passed in is not
 * the mock `.claude/rules/testing.md` bans.
 */
export interface RegisterRecorders {
  /**
   * Record that this session has now READ one pull request's checks, discharging the obligation
   * `github stack push` left behind when it raised the pull request.
   *
   * A seam rather than a direct append so a unit test can drive the whole shell without touching a state
   * home — `.claude/rules/testing.md` bans the mock a direct call would otherwise need, and a plain function
   * passed in is not one. Failure is REPORTED, never propagated: a register this verb could not write to is
   * not a reason to fail a read that succeeded, and the gate at the other end says so loudly on its own.
   */
  readonly recordChecksRead: (args: {
    repo: string;
    number: number;
    headSha: string;
    rollup: string;
    home: string | undefined;
  }) => void;
  /**
   * Record that this session is now WATCHING the pull request — a `--wait` or `--until` run, on its first
   * read, never a one-shot — and, when the loop returns, that it stopped. The pull-request page's watched
   * column is folded from these two rows (`../../../outbound/github/watchers.ts`). Same seam shape and the
   * same reported-never-fatal contract as `recordChecksRead`.
   */
  readonly recordWatching: (args: {
    repo: string;
    number: number;
    headSha: string;
    mode: ChecksWatchMode;
    timeoutSeconds: number;
    home: string | undefined;
  }) => void;
  readonly recordWatchDone: (args: {
    repo: string;
    number: number;
    headSha: string;
    outcome: string;
    home: string | undefined;
  }) => void;
}

/** The part of a poll target a register row names. */
interface WatchedTarget {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly home: string | undefined;
  readonly timeoutSeconds: number;
}

/**
 * How a poll loop tells the register it has seen a snapshot.
 *
 * Takes the snapshot rather than its parts so a caller cannot record a head and a rollup that came from two
 * different reads.
 */
export type RecordFirstRead = (args: { snapshot: GithubChecksSnapshot }) => void;

/** The first-read sink plus what a watch run needs at its end: the head its `watching` row named, if any. */
export interface FirstReadRecorder {
  readonly recordRead: RecordFirstRead;
  readonly watchedHead: () => string | undefined;
}

/**
 * Record the FIRST snapshot of an invocation and ignore every later one.
 *
 * Once, not per poll, for two reasons that are both the contract. A `--wait` can poll dozens of times, and a
 * register growing a row per poll would bury the raise rows the gate actually reads. And the obligation this
 * discharges is "the session went and LOOKED", which the first successful read already settles — a rollup
 * that still says `PENDING` is an honest record of what the session saw when it looked, not a claim about
 * CI's final verdict. Whether a pull request is GREEN is rule 1's question and the verb's own exit code
 * answers it; whether anybody looked at all is this one's.
 *
 * A watch run (`mode` set) also records a `watching` row on that same first read — the head it names is
 * the one the run saw — and `watchedHead` hands it back so the run can write its `watch-done` against it.
 * A one-shot read has no mode and writes no watch row at all.
 *
 * @param deps the record seam and the diagnostic channel a failed append is reported on
 * @param target the pull request being watched
 * @param mode the watch mode, or undefined for a one-shot read
 * @returns a sink that records once and is a no-op thereafter, plus the head a watch row named
 */
export function recordFirstRead({
  deps,
  target,
  mode,
}: {
  deps: Pick<RegisterRecorders, "recordChecksRead" | "recordWatching">;
  target: WatchedTarget;
  mode: ChecksWatchMode | undefined;
}): FirstReadRecorder {
  let recorded = false;
  let watched: string | undefined;
  const repo = `${target.owner}/${target.repo}`;
  return {
    recordRead: ({ snapshot }) => {
      if (recorded) {
        return;
      }
      recorded = true;
      deps.recordChecksRead({
        headSha: snapshot.headSha,
        home: target.home,
        number: target.number,
        repo,
        rollup: snapshot.rollupState,
      });
      if (mode !== undefined) {
        watched = snapshot.headSha;
        deps.recordWatching({
          headSha: snapshot.headSha,
          home: target.home,
          mode,
          number: target.number,
          repo,
          timeoutSeconds: target.timeoutSeconds,
        });
      }
    },
    watchedHead: () => watched,
  };
}

/**
 * The word a `watch-done` row carries for the loop's exit code.
 *
 * @returns `done`, `stopped`, or `failed (exit n)` — the closed vocabulary `github watchers` folds
 */
export function watchOutcome({ exit }: { exit: number }): string {
  if (exit === EXIT_OK) {
    return "done";
  }
  if (exit === EXIT_EXPECTED_EMPTY) {
    return "stopped";
  }
  return `failed (exit ${String(exit)})`;
}

/**
 * The session a watch row is written as: the Claude Code session id this verb runs under, or the literal
 * `unattended` when there is none — a cron or a shell — so a row never carries a guessed name.
 */
function watchingSession(): string {
  const session = currentSessionId({ env: process.env });
  if (session === undefined) {
    return "unattended";
  }
  return session;
}

/**
 * The three register seams of the production deps — `read`, `watching`, `watch-done` — appending to the
 * real checks-read register under one reported-never-fatal contract: a failed append is a warning on the log,
 * never a failed read or a failed watch.
 *
 * @returns the three recorders, spread into `productionGithubChecksDeps`
 */
export function productionRegisterRecorders(): RegisterRecorders {
  return {
    recordChecksRead: ({ repo, number, headSha, rollup, home }) => {
      // One instant, read once: the row's own `atIso` is what the gate compares against a raise, so it must
      // be the same value the lock's staleness check was given rather than a second clock reading.
      const atIso = new Date().toISOString();
      const appended = appendChecksReadRecord({
        nowIso: atIso,
        row: { atIso, headSha, kind: "read", number, repo, rollup },
        ...(home === undefined ? {} : { home }),
      });
      if (appended.isErr()) {
        // Reported, never fatal: the read itself succeeded, and failing the verb over its bookkeeping would
        // teach sessions to distrust the one command canon tells them to run.
        logger.warn({ msg: `github checks: could not record this read — ${appended.error.message}` });
      }
    },
    recordWatchDone: ({ repo, number, headSha, outcome, home }) => {
      const atIso = new Date().toISOString();
      const appended = appendChecksReadRecord({
        nowIso: atIso,
        row: { atIso, headSha, kind: "watch-done", number, outcome, repo, session: watchingSession() },
        ...(home === undefined ? {} : { home }),
      });
      if (appended.isErr()) {
        logger.warn({ msg: `github checks: could not record the end of this watch — ${appended.error.message}` });
      }
    },
    recordWatching: ({ repo, number, headSha, mode, timeoutSeconds, home }) => {
      const atIso = new Date().toISOString();
      const appended = appendChecksReadRecord({
        nowIso: atIso,
        row: { atIso, headSha, kind: "watching", mode, number, repo, session: watchingSession(), timeoutSeconds },
        ...(home === undefined ? {} : { home }),
      });
      if (appended.isErr()) {
        logger.warn({ msg: `github checks: could not record this watch — ${appended.error.message}` });
      }
    },
  };
}
