/**
 * The DECISION inside `slopweaver github enqueue`'s asynchronous stack path — when to keep waiting, when to
 * stop, and what the outcome was. Pure: no clock, no network, no filesystem.
 *
 * ## Why an accepted request is not a queued pull request
 *
 * `PUT .../merge-async` answers 200 or 202 and then RUNS. Its own body says what GitHub intends, so the
 * verb's contract is unchanged from the GraphQL path: the enqueue is reported successful only once
 * `PullRequest.mergeQueueEntry` reads back with an entry. What the asynchronous status adds is the two
 * things a bare read-back cannot tell you — that GitHub REFUSED the request (`failed`, under an HTTP 200,
 * carrying the reason), and that it is still working (`pending`, so an absent entry is not yet a defect).
 *
 * ## The budget is a CHOICE, and it is named as one
 *
 * There is no published completion time for this endpoint and none was measured, so the six waits in
 * `../../../cli/commands/github/enqueueAsyncRun.ts` are a finite confirmation budget rather than an SLA.
 * Exhausting it reports UNCONFIRMED and the request's own uuid — never that the request was cancelled or
 * failed, which is a claim nothing here can support.
 */
import type { GithubAsyncMergeState } from "../../../corpus/github/mergeAsync.js";
import type { MergeQueueEntryState } from "../../../live/github/mergeQueue.js";

/**
 * What one round of the confirmation loop concluded.
 *
 * @internal named by this verb's own shell and tests; nothing else in the repo consumes it.
 */
export type AsyncEnqueueDecision = "failed" | "merged" | "confirmed" | "wait" | "unconfirmed";

/**
 * Judge one round: the asynchronous request's latest state, and whether the pull request reads back queued.
 *
 * Precedence is `failed`, `merged`, `confirmed`, `unconfirmed`, `wait`, and the first two lead deliberately.
 * A refusal or a pull request that is no longer open cannot be talked out of by a queue entry that happens to
 * be present — an entry left over from an earlier press would otherwise report a refused request as a success.
 * `merged` is returned when the request reports merged OR when `prState` is anything but `OPEN`, so a pull
 * request read back `CLOSED` without merging also lands on `merged`.
 *
 * @param state the asynchronous request's latest known state
 * @param entry the pull request's own queue entry as the last read-back found it
 * @param exhausted whether the confirmation budget has run out
 * @returns what this round concluded
 */
export function asyncEnqueueDecision({
  state,
  entry,
  prState,
  exhausted,
}: {
  state: GithubAsyncMergeState;
  entry: MergeQueueEntryState | undefined;
  prState: string;
  exhausted: boolean;
}): AsyncEnqueueDecision {
  if (state.status === "failed") {
    return "failed";
  }
  if (state.status === "merged" || prState !== "OPEN") {
    return "merged";
  }
  if (entry !== undefined) {
    return "confirmed";
  }
  return exhausted ? "unconfirmed" : "wait";
}

/**
 * `owner/repo#number`, plus the request's own id when GitHub named one.
 *
 * Every line below opens with this. A line such as `FAILED: … of #N: the stack moved under it`
 * printed as the ENTIRE report under `--json`, where the verb's identity lines are deliberately suppressed
 * — a bare number identifies nothing across repositories, and the uuid is what a follow-up read needs.
 */
function subject({ owner, repo, number, uuid }: AsyncSubject): string {
  const request = uuid === undefined ? "" : `, request ${uuid}`;
  return `${owner}/${repo}#${String(number)}${request}`;
}

/**
 * Who one line is about: the pull request, and the asynchronous request against it.
 *
 * @internal named by this verb's own shell and tests; nothing else in the repo consumes it.
 */
export interface AsyncSubject {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  /** The request's own id, when GitHub named one. */
  readonly uuid: string | undefined;
}

/**
 * The line reporting an asynchronous request that GitHub itself REFUSED.
 *
 * It deliberately carries no in-flight retry warning: a refusal means nothing is running, so warning about
 * a second merge job would be false. {@link asyncInFlightLine} is for the cases where one really may be.
 *
 * @param about the pull request and request this is reporting on
 * @param message GitHub's own reason, printed verbatim rather than reconstructed
 * @returns the single line to print
 */
export function asyncFailedLine({ about, message }: { about: AsyncSubject; message: string }): string {
  return `FAILED: GitHub refused the asynchronous enqueue of ${subject({ ...about })}: ${message}`;
}

/**
 * The line reporting a pull request that is merged, or reads back non-open, rather than queued.
 *
 * It opens `MERGED:` either way; when it is the read-back that settled the round, the body names the state
 * GitHub returned rather than claiming a merge.
 *
 * Non-zero either way, and that is continuity rather than a claim that merging failed: this verb's whole
 * witness is a queue entry, and there is none.
 *
 * @param about the pull request and request this is reporting on
 * @param state the asynchronous request's latest state
 * @param prState GitHub's own state on the read-back, named when IT is what settled this rather than the request
 * @returns the single line to print
 */
export function asyncMergedLine({
  about,
  state,
  prState,
}: {
  about: AsyncSubject;
  state: GithubAsyncMergeState;
  prState: string;
}): string {
  const sha = state.status === "merged" && state.sha !== undefined ? ` (${state.sha})` : "";
  const said =
    state.status === "merged"
      ? `GitHub reports ${subject({ ...about })} already merged${sha}: ${state.message}`
      : `${subject({ ...about })} reads back ${prState} rather than OPEN while the asynchronous request ` +
        `reads ${state.status}`;
  return `MERGED: ${said}. This invocation confirmed no queue ENTRY, which is the only thing it reports success on.`;
}

/**
 * The line reporting a confirmation budget that ran out with the request still in flight.
 *
 * @param about the pull request and request this is reporting on — the uuid is what a re-read needs
 * @param status the last asynchronous status observed
 * @returns the single line to print
 */
export function asyncUnconfirmedLine({ about, status }: { about: AsyncSubject; status: string }): string {
  return (
    `UNCONFIRMED: GitHub accepted the asynchronous enqueue of ${subject({ ...about })} and it still reads ` +
    `${status}; no mergeQueueEntry was observed within this invocation's confirmation budget. ` +
    "Re-read it before retrying — the request may still complete, and a second one would be a second job."
  );
}

/**
 * The line that keeps an ACCEPTED request identifiable when the reads after it fail.
 *
 * A transport error on its own is anonymous — *"github closed the connection"* names neither the pull
 * request nor the merge job already running against it — and under `--json` the identity lines never
 * printed, so the whole report could be that one sentence. A Codex review found it: the operator's next
 * move is exactly the thing this line exists to prevent, because a retry starts a SECOND merge job.
 *
 * @param about the pull request and request this is reporting on
 * @returns the single line to print alongside whatever failed
 */
export function asyncInFlightLine({ about }: { about: AsyncSubject }): string {
  return (
    `IN FLIGHT: GitHub already ACCEPTED an asynchronous merge request for ${subject({ ...about })}. ` +
    "Re-read it before doing anything else — enqueueing again would start a second merge job on the stack."
  );
}

/**
 * The line for a `merge-async` PUT whose own answer could not be read.
 *
 * Distinct from {@link asyncInFlightLine}, which asserts GitHub ACCEPTED the request — here that is exactly
 * what is unknown. The send may have failed before reaching GitHub, or GitHub may have accepted it and
 * answered a body this build could not parse (a `202` with no `details.message` does both at once: the job
 * is running and its uuid is lost). A Codex review found that path reporting the bare parse error and
 * nothing else, which reads like a no-op and invites the retry that would start a second job.
 *
 * @param about the pull request the request was for; its uuid is usually unknown here, by construction
 * @returns the single line to print alongside whatever failed
 */
export function asyncMayHaveStartedLine({ about }: { about: AsyncSubject }): string {
  return (
    `UNCERTAIN: an asynchronous merge request for ${subject({ ...about })} may already have reached GitHub — ` +
    "this failed while sending it or while reading its answer. Re-read the pull request before retrying; " +
    "enqueueing again would start a second merge job on the stack."
  );
}
