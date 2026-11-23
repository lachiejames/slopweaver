/**
 * GitHub's ASYNCHRONOUS merge result — the shape both halves of the stack-enqueue path read, in one place
 * so the write that starts the request and the read that follows it can never disagree about what a status
 * means.
 *
 * ## Why this endpoint exists at all
 *
 * `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async` "merges a pull request into the base branch
 * in the background", and it is the ONLY way to land or queue a native-stack member: GitHub's own docs say
 * *"If you merge via the API and want to use stacked pull requests, you'll need use the asynchronous merge
 * API for stacks"*, and its GraphQL `enqueuePullRequest` answers a member *"This pull request is part of a
 * stack and must be enqueued using the asynchronous merge REST API"*. Neither route has a generated
 * `@octokit/openapi-types` entry, so this is a hand-narrowed, defensive projection of the raw body — the
 * same posture `./stack.ts` takes for the native-stack endpoints, and for the same reason.
 *
 * ## A 200 or a 202 is a transport acknowledgement, never a witness
 *
 * The request is accepted and then RUNS, so its own answer says what GitHub intends rather than what
 * happened. `status: "enqueued"` is consumed here for progress and for failure reporting only; the enqueue
 * is reported successful by `PullRequest.mergeQueueEntry` read back afterwards, exactly as the GraphQL
 * path's is (`../../cli/commands/github/enqueueCore.ts`'s `enqueueWitnessOutcome`).
 *
 * `status: "failed"` is the case that makes the projection load-bearing rather than decorative: it arrives
 * under an HTTP 200, so a caller that only checked the status code would report a refusal as a success.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubAsyncMergeError, GithubAsyncMergeErrors } from "./errors.js";

/**
 * One asynchronous merge request's current state, as GitHub reports it.
 *
 * A discriminated union rather than a bare record because callers genuinely branch on `status` — `pending`
 * is the only state that GUARANTEES a `uuid`, and `merged` is the only one that can name a commit.
 *
 * Every other state carries the `uuid` when GitHub sends one, and that is not decoration: a Codex review
 * found that discarding it on an `enqueued` acceptance left the confirmation loop unable to NAME the
 * request it had started when its budget ran out, so the operator was told to re-read something the report
 * could not identify.
 */
export type GithubAsyncMergeState =
  | { readonly status: "pending"; readonly message: string; readonly uuid: string }
  | { readonly status: "enqueued"; readonly message: string; readonly uuid: string | undefined }
  | { readonly status: "failed"; readonly message: string; readonly uuid: string | undefined }
  | {
      readonly status: "merged";
      readonly message: string;
      readonly sha: string | undefined;
      readonly uuid: string | undefined;
    };

/** Every status GitHub documents for this endpoint. Anything else is refused rather than guessed at. */
const KNOWN_STATUSES = ["pending", "merged", "enqueued", "failed"] as const;

/** A non-blank string, or `undefined` when the payload carried something else there. */
function text({ value }: { value: unknown }): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** How deep {@link salvageUuid} looks. Four covers the documented shape and one nesting either side of it. */
const UUID_SEARCH_DEPTH = 4;

/**
 * The request id, from wherever it sits in a body this projection is about to REFUSE.
 *
 * GitHub documents it at `details.uuid` and the happy path reads it straight from there. This search exists
 * for the other case, and its justification is that case rather than a theory about the schema: a body the
 * projection cannot parse is a body whose shape did NOT hold, and the request it describes may be a merge
 * job GitHub is already running. The id is the only field that can find that job again, so it is worth
 * looking for wherever it landed instead of insisting on the position that already turned out to be wrong.
 *
 * Bounded at {@link UUID_SEARCH_DEPTH} rather than unbounded: these bodies are a handful of fields, and a
 * salvage routine that could walk an arbitrary structure would be a worse thing to own than a lost id.
 *
 * @param value the raw body, or a nested part of it
 * @param depth how many levels are left to look
 * @returns the first non-blank `uuid` found, or `undefined`
 */
function salvageUuid({ value, depth = UUID_SEARCH_DEPTH }: { value: unknown; depth?: number }): string | undefined {
  if (depth <= 0 || !isRecord(value)) {
    return undefined;
  }
  const here = text({ value: value["uuid"] });
  if (here !== undefined) {
    return here;
  }
  for (const nested of Object.values(value)) {
    const found = salvageUuid({ depth: depth - 1, value: nested });
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * Narrow one raw `merge-async` body into the state both the write and the poll read.
 *
 * A `uuid` is kept wherever GitHub sends one, whatever the status — see the type above for the measured
 * reason. Unknown statuses, a missing message and a `pending` with no `uuid` are all REFUSED rather than
 * coerced:
 * the only thing a caller can do with a state it did not understand is guess, and the guess that costs
 * something here is reading a refusal as an acceptance.
 *
 * Fields beyond the four consumed ones are ignored, so GitHub adding to the payload cannot break this.
 *
 * @param data the unwrapped REST body — `response.data`, not the response
 * @returns the narrowed state, or the reason the payload could not be read
 */
export function parseGithubAsyncMergeState({
  data,
}: {
  data: unknown;
}): Result<GithubAsyncMergeState, GithubAsyncMergeError> {
  if (!isRecord(data)) {
    return err(GithubAsyncMergeErrors.notAnObject());
  }
  const details = data["details"];
  // Two reads, deliberately not one. `uuid` is the DOCUMENTED position and the only one a returned state
  // carries, because polling with an id found somewhere unexpected is a guess about a route that has not
  // agreed to it. `salvaged` is for the REFUSAL messages only: see `salvageUuid`'s header for why a body
  // that failed to parse is exactly where insisting on a position is the wrong instinct.
  const uuid = isRecord(details) ? text({ value: details["uuid"] }) : undefined;
  const salvaged = uuid ?? salvageUuid({ value: data });
  const status = KNOWN_STATUSES.find((known) => known === data["status"]);
  if (status === undefined) {
    return err(GithubAsyncMergeErrors.unknownStatus({ request: salvaged, status: String(data["status"]) }));
  }
  if (!isRecord(details)) {
    return err(GithubAsyncMergeErrors.missingDetails({ request: salvaged, status }));
  }
  const message = text({ value: details["message"] });
  if (message === undefined) {
    return err(GithubAsyncMergeErrors.missingMessage({ request: salvaged, status }));
  }
  return shapeState({ message, salvaged, status, uuid, value: details });
}

/**
 * The state itself, once the response has been established as readable.
 *
 * Split from {@link parseGithubAsyncMergeState} so that function stays a readable sequence of refusals and
 * this holds the per-status shaping — the split the complexity ceiling asked for, along the seam the
 * function already had.
 *
 * @param value the response's `details` object, already narrowed
 * @param salvaged the request id found anywhere in the response, for the one refusal that can still fire
 * @param uuid the request id at its DOCUMENTED position, which is the only one a state may carry
 * @returns the narrowed state, or the reason a pending one cannot be polled
 */
function shapeState({
  value,
  status,
  message,
  uuid,
  salvaged,
}: {
  value: Record<string, unknown>;
  status: (typeof KNOWN_STATUSES)[number];
  message: string;
  uuid: string | undefined;
  salvaged: string | undefined;
}): Result<GithubAsyncMergeState, GithubAsyncMergeError> {
  if (status === "merged") {
    return ok({ message, sha: text({ value: value["sha"] }), status, uuid });
  }
  if (status !== "pending") {
    return ok({ message, status, uuid });
  }
  if (uuid !== undefined) {
    return ok({ message, status, uuid });
  }
  // When the id exists but not where the poll route needs it, the refusal reports the id too, so an operator
  // can still find the job GitHub accepted. Polling with it is not attempted, for the reason above.
  return err(GithubAsyncMergeErrors.pendingWithoutUuid({ salvaged }));
}
