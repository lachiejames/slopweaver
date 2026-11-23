/**
 * Effectful shell for the ASYNCHRONOUS half of `slopweaver github enqueue` — the path a native-stack member
 * takes, because GitHub's GraphQL `enqueuePullRequest` refuses one.
 *
 * ## What this file owns, and what it deliberately does not
 *
 * It owns everything AFTER the one `PUT .../merge-async` has been accepted: polling that request by its own
 * uuid, re-reading the pull request, and deciding when to stop. It never sends the PUT — `./enqueueRun.ts`
 * does that, inside the door — and it NEVER sends a second one. A request that is still pending when the
 * budget runs out is reported with its uuid so the next invocation can read it, precisely so nobody starts
 * a competing job for the same stack.
 *
 * ## The budget: six waits, 60 seconds of scheduled waiting, and no claim beyond that
 *
 * `[1s, 2s, 4s, 8s, 15s, 30s]` — six waits summing to 60 seconds, PLUS however long each request takes, so
 * it is not a 60-second wall-clock deadline. At most six polls of the request and seven read-backs of the
 * pull request follow the PUT. The increasing shape follows `../../../live/github/checks.ts`'s own poll
 * schedule; its nine-minute CI measurement is NOT evidence about this endpoint, and no completion time for
 * this endpoint has been measured here. The budget is a chosen bound, and exhausting it says so.
 *
 * ## Progress goes to the DIAGNOSTIC channel, always
 *
 * `docs/constraints/7-9.md` § "Long-running work is observable" requires the existing emitter rather than a
 * second one, and this verb's `--json` mode answers with exactly one object on stdout — so the emitter's
 * lines ride the same channel every other non-stdout line of this verb rides.
 */
import type { GithubAsyncMergeState } from "../../../corpus/github/mergeAsync.js";
import { createProgressEmitter, type ProgressEmitter } from "../../../lib/progress.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { MergeQueuePrState } from "../../../live/github/mergeQueue.js";
import type { GithubMergeQueueApi } from "../../../outbound/github/mergeQueue.js";
import {
  type AsyncSubject,
  asyncEnqueueDecision,
  asyncFailedLine,
  asyncInFlightLine,
  asyncMergedLine,
  asyncUnconfirmedLine,
} from "./enqueueAsyncCore.js";

/**
 * The confirmation budget: how long to wait before each round, in order.
 *
 * Six entries, 60 seconds of scheduled waiting. A chosen bound rather than a measured one — see this
 * module's header, and do not restate it as a GitHub completion time anywhere.
 */
export const ASYNC_ENQUEUE_WAITS_MS: readonly number[] = [1000, 2000, 4000, 8000, 15_000, 30_000];

/** The pull request one confirmation loop is about. */
interface AsyncIdentity {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/** The seams one confirmation loop needs — the two reads, the wait, and where progress goes. */
export interface AsyncConfirmDeps {
  readonly api: Pick<GithubMergeQueueApi, "read" | "asyncMergeResult">;
  readonly wait: (args: { ms: number }) => Promise<void>;
  readonly progress: ProgressEmitter;
}

/**
 * A settled outcome, rendered, or `undefined` while the request is still live and the pull request open.
 *
 * `prState` defaults to `OPEN` for the call made BEFORE the first read-back, where no read-back exists yet
 * to contradict it — the loop then re-asks with the state GitHub actually reported.
 */
function terminalLine({
  state,
  about,
  prState = "OPEN",
}: {
  state: GithubAsyncMergeState;
  about: AsyncSubject;
  prState?: string;
}): string | undefined {
  if (state.status === "failed") {
    return asyncFailedLine({ about, message: state.message });
  }
  if (state.status === "merged" || prState !== "OPEN") {
    return asyncMergedLine({ about, prState, state });
  }
  return undefined;
}

/** Poll the request once by its uuid, or pass the current state straight through once it is no longer pending. */
async function advance({
  deps,
  identity,
  state,
}: {
  deps: AsyncConfirmDeps;
  identity: AsyncIdentity;
  state: GithubAsyncMergeState;
}): Promise<Result<GithubAsyncMergeState>> {
  if (state.status !== "pending") {
    return ok(state);
  }
  const polled = await deps.api.asyncMergeResult({ ...identity, uuid: state.uuid });
  return polled.isErr() ? err([polled.error.message]) : ok(polled.value);
}

/**
 * A transport failure, reported WITH the subject and the request it belongs to.
 *
 * Every failure path after the PUT has been accepted goes through this. The bare provider message is not
 * enough on its own: under `--json` the verb's identity lines are deliberately suppressed, so an anonymous
 * error would be the entire report about a merge job that is still running.
 *
 * @param message whatever the failing read said
 * @param uuid the request's own id, when GitHub named one
 * @returns the lines to print
 */
function inFlightFailure({
  identity,
  message,
  uuid,
}: {
  identity: AsyncIdentity;
  message: string;
  uuid: string | undefined;
}): Result<MergeQueuePrState> {
  return err([message, asyncInFlightLine({ about: { ...identity, uuid } })]);
}

/**
 * The request's id as GitHub LAST named it: this poll's when it names one, else the one an earlier answer
 * already gave — a poll that omits the id has not withdrawn it.
 */
function lastNamedUuid({
  state,
  held,
}: {
  state: GithubAsyncMergeState;
  held: string | undefined;
}): string | undefined {
  if (state.uuid === undefined) {
    return held;
  }
  return state.uuid;
}

/**
 * Wait for GitHub's accepted asynchronous merge request to show up as a real queue entry.
 *
 * @param deps the two reads, the injected wait, and the progress emitter
 * @param identity the pull request the request was for
 * @param initial the state the accepted `PUT` answered with
 * @returns the pull request as the confirming read-back found it, or the lines explaining why it did not
 */
export async function confirmAsyncEnqueue({
  deps,
  identity,
  initial,
}: {
  deps: AsyncConfirmDeps;
  identity: AsyncIdentity;
  initial: GithubAsyncMergeState;
}): Promise<Result<MergeQueuePrState>> {
  // The LAST uuid GitHub named, not just a pending one's: an acceptance that answers `enqueued` straight
  // away still carries the identifier, and dropping it left the exhaustion line unable to name the request
  // it was telling the operator to re-read. Found by a Codex review.
  let uuid = initial.uuid;
  let state = initial;
  const terminal = terminalLine({ about: { ...identity, uuid }, state });
  if (terminal !== undefined) {
    deps.progress.finish({ counts: { round: 0 }, phase: `async-merge ${state.status}` });
    return err([terminal]);
  }
  deps.progress.update({ counts: { round: 0 }, phase: `async-merge ${state.status}` });
  const first = await deps.api.read(identity);
  if (first.isErr()) {
    deps.progress.finish({ counts: { round: 0 }, phase: "async-merge unreadable" });
    return inFlightFailure({ identity, message: first.error.message, uuid });
  }
  const settledFirst = judgeRead({ deps, identity, read: first.value, round: 0, state, uuid });
  if (settledFirst !== undefined) {
    return settledFirst;
  }
  for (const [index, ms] of ASYNC_ENQUEUE_WAITS_MS.entries()) {
    await deps.wait({ ms });
    const round = index + 1;
    const advanced = await advance({ deps, identity, state });
    if (advanced.isErr()) {
      deps.progress.finish({ counts: { round }, phase: "async-merge unreadable" });
      return inFlightFailure({ identity, message: advanced.error.join("; "), uuid });
    }
    state = advanced.value;
    uuid = lastNamedUuid({ held: uuid, state });
    const settled = await settleRound({ deps, identity, round, state, uuid });
    if (settled !== undefined) {
      return settled;
    }
  }
  // Unreachable: the last entry of the schedule always settles, because `exhausted` is true on it.
  return err([asyncUnconfirmedLine({ about: { ...identity, uuid }, status: state.status })]);
}

/**
 * One round after a wait: report a terminal status, read the pull request back, and judge what to do next.
 *
 * Split out of {@link confirmAsyncEnqueue} so the loop stays readable and each round's short-circuits sit
 * together. Answers `undefined` when the loop should keep going.
 *
 * @param round which round this is, counted from 1, for the progress line
 * @param state the request's state as this round's poll left it
 * @param uuid the request's own id, when its acceptance named one
 * @returns the settled outcome, or `undefined` to keep waiting
 */
async function settleRound({
  deps,
  identity,
  round,
  state,
  uuid,
}: {
  deps: AsyncConfirmDeps;
  identity: AsyncIdentity;
  round: number;
  state: GithubAsyncMergeState;
  uuid: string | undefined;
}): Promise<Result<MergeQueuePrState> | undefined> {
  const terminal = terminalLine({ about: { ...identity, uuid }, state });
  if (terminal !== undefined) {
    deps.progress.finish({ counts: { round }, phase: `async-merge ${state.status}` });
    return err([terminal]);
  }
  const read = await deps.api.read(identity);
  if (read.isErr()) {
    deps.progress.finish({ counts: { round }, phase: "async-merge unreadable" });
    return inFlightFailure({ identity, message: read.error.message, uuid });
  }
  return judgeRead({ deps, identity, read: read.value, round, state, uuid });
}

/**
 * Judge one read-back of the pull request against the request's latest state.
 *
 * Shared by the read taken immediately after acceptance and by every round after a wait, so both apply the
 * same precedence — in particular, neither can call a pull request that has since MERGED "queued" on the
 * strength of a queue entry GitHub has not cleared yet. That was a Codex review finding, and one call site
 * having its own inline entry check is exactly how it happened.
 *
 * @param read the pull request as this read-back found it
 * @param round which round this is, counted from 0 for the read before the first wait
 * @returns the settled outcome, or `undefined` to keep waiting
 */
function judgeRead({
  deps,
  identity,
  read,
  round,
  state,
  uuid,
}: {
  deps: AsyncConfirmDeps;
  identity: AsyncIdentity;
  read: MergeQueuePrState;
  round: number;
  state: GithubAsyncMergeState;
  uuid: string | undefined;
}): Result<MergeQueuePrState> | undefined {
  const decision = asyncEnqueueDecision({
    entry: read.entry,
    exhausted: round >= ASYNC_ENQUEUE_WAITS_MS.length,
    prState: read.state,
    state,
  });
  if (decision === "confirmed") {
    deps.progress.finish({ counts: { round }, phase: "async-merge queued" });
    return ok(read);
  }
  if (decision === "merged") {
    deps.progress.finish({ counts: { round }, phase: "async-merge merged" });
    const about = { ...identity, uuid };
    const lines = [asyncMergedLine({ about, prState: read.state, state })];
    // A pull request that read back CLOSED — not MERGED — while the request itself is still `pending` is an
    // IN-FLIGHT case wearing a settled-looking label: somebody closed the pull request under us and the
    // merge job may still be running. Only GitHub saying `merged` means nothing is left to collide with.
    // Found by a Codex review, which is also why the two are not collapsed into one message.
    if (state.status !== "merged") {
      lines.push(asyncInFlightLine({ about }));
    }
    return err(lines);
  }
  if (decision === "unconfirmed") {
    deps.progress.finish({ counts: { round }, phase: `async-merge ${state.status}` });
    return err([asyncUnconfirmedLine({ about: { ...identity, uuid }, status: state.status })]);
  }
  deps.progress.update({ counts: { round }, phase: `async-merge ${state.status}` });
  return undefined;
}

/**
 * The production progress emitter for this path: every round emitted, on the diagnostic channel.
 *
 * `milestoneEvery: 1` rather than the size-adaptive default, because there are at most seven lines in a
 * whole run and throttling them would leave the operator watching a silent minute — the exact failure
 * `docs/constraints/7-9.md` § "Long-running work is observable" names.
 *
 * @param writeDiagnostic the verb's own non-stdout channel
 * @returns the emitter
 */
export function asyncEnqueueProgress({
  writeDiagnostic,
}: {
  writeDiagnostic: (line: string) => void;
}): ProgressEmitter {
  return createProgressEmitter({
    cadence: { milestoneEvery: 1, minIntervalMs: 0 },
    sink: (line) => {
      writeDiagnostic(line.trimEnd());
    },
    verb: "github enqueue",
  });
}
