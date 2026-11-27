/**
 * What every step of `supervisor hand-off` (`./chairHandOffRun.ts`) shares: the seams it reaches, the context one
 * invocation carries, and the four moves every step is built from — print a line, journal an event, stop where the
 * episode stands, and re-check the lock and the owner's hold before an irreversible step.
 */
import type { OperationLockHandle } from "../../../admit/operationLock.js";
import type { Result } from "../../../lib/result.js";
import type { SessionHarness } from "../../../sessionHarness/sessionHarness.js";
import type { ChairHandOffEvent, ChairHandOffStarted } from "../../../supervisor/chairHandOff.js";
import { appendEpisodeEvent } from "../../../supervisor/chairHandOffStore.js";
import { type ChairWatchHold, type ChairWatchReport, withoutAddresses } from "../../../supervisor/chairWatch.js";
import { EXIT_DEFERRED, EXIT_ERROR } from "../../exitCodes.js";
import type { ChairHandOffOptions } from "./chairHandOffArgs.js";
import type { SuccessorSpawn } from "./chairSuccessorLaunch.js";

/** The verb, as every line names it. */
export const VERB = "supervisor hand-off";

/**
 * The harness operations the hand-off uses: resolve a session, message it, and list what the app runs — the last so
 * a resumed run asks the app whether a successor opened before spawning another.
 */
export type HandOffHarness = Pick<SessionHarness, "resolve" | "message" | "list">;

/** What the hand-off touches outside itself: each a seam a test replaces with a plain function. */
export interface ChairHandOffDeps {
  /** A fresh watch pass over the home. */
  readonly watch: (input: { home: string }) => Promise<ChairWatchReport>;
  /** The owner's hold in force, re-read at each re-check. */
  readonly readHold: (input: { home: string }) => Result<ChairWatchHold | undefined, { readonly message: string }>;
  /** The session harness, run around the transaction so a socket opens only once a hand-off is actually running. */
  readonly withHarness: <T>(input: { body: (options: { harness: HandOffHarness }) => Promise<T> }) => Promise<T>;
  readonly spawn: SuccessorSpawn;
  /** The main checkout the successor chair runs in. */
  readonly repo: (input: { home: string }) => Result<string, string>;
  readonly nowIso: () => string;
  readonly sleep: (input: { ms: number }) => Promise<void>;
  readonly out: (input: { line: string }) => void;
  readonly hold: (input: { rest: readonly string[] }) => number;
  readonly release: (input: { rest: readonly string[] }) => number;
}

/** A refusal: the exit code and the line naming what refused and its override. */
export interface Refusal {
  readonly exit: number;
  readonly line: string;
}

/** Everything one invocation carries through its steps. */
export interface Ctx {
  readonly options: ChairHandOffOptions;
  readonly deps: ChairHandOffDeps;
  readonly harness: HandOffHarness;
  readonly predecessor: string;
  readonly episodeId: string;
  readonly lock: OperationLockHandle;
}

/**
 * Print one line, prefixed with the verb, every account address replaced: a line can quote a `--plan` the owner
 * typed or a nested verb's failure.
 *
 * @param line what to print after the prefix
 */
export function say({ ctx, line }: { ctx: Ctx; line: string }): void {
  ctx.deps.out({ line: `${VERB}: ${withoutAddresses({ text: line })}` });
}

/**
 * Append one event to the episode's journal, printing why when it fails.
 *
 * @param event what to append
 * @returns whether it was appended
 */
export function journal({ ctx, event }: { ctx: Ctx; event: ChairHandOffEvent }): boolean {
  const appended = appendEpisodeEvent({ episodeId: ctx.episodeId, event, home: ctx.options.home });
  if (appended.isErr()) {
    say({ ctx, line: `refused: the journal would not take ${event.kind}: ${appended.error.message}` });
    return false;
  }
  return true;
}

/**
 * Stop where the episode stands, journalled, so the next run re-checks and continues from the same step.
 *
 * @param why the line printed and journalled
 * @param exit the code to stop with
 * @returns that exit code
 */
export function stop({ ctx, why, exit }: { ctx: Ctx; why: string; exit: number }): number {
  journal({ ctx, event: { atIso: ctx.deps.nowIso(), kind: "stopped", why } });
  say({ ctx, line: why });
  return exit;
}

/**
 * The re-check before an irreversible step: the lock still ours, the owner's hold not in force unless `--now`.
 *
 * @param started the episode's opening event, whose basis says whether `--now` waives the hold
 * @param before the step about to run, named in the refusal
 * @returns the refusal, or undefined when the step may run
 */
export function recheck({
  ctx,
  started,
  before,
}: {
  ctx: Ctx;
  started: ChairHandOffStarted;
  before: string;
}): Refusal | undefined {
  if (!ctx.lock.stillHeld()) {
    return {
      exit: EXIT_DEFERRED,
      line: `stopped before ${before}: this run no longer holds its lock; re-run to resume`,
    };
  }
  if (started.basis.kind === "now") {
    return undefined;
  }
  const hold = ctx.deps.readHold({ home: ctx.options.home });
  if (hold.isErr()) {
    return {
      exit: EXIT_ERROR,
      line: `stopped before ${before}: the hold journal would not read (${hold.error.message})`,
    };
  }
  if (hold.value !== undefined) {
    return {
      exit: EXIT_ERROR,
      line: `stopped before ${before}: the owner HELD automatic hand-off (${withoutAddresses({ text: hold.value.reason })}); \`slopweaver supervisor hand-off release --reason "<why>"\` and re-run resumes it`,
    };
  }
  return undefined;
}
