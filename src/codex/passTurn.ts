/**
 * One turn of a bounded Codex pass, and how its response becomes an outcome.
 *
 * Split out of `./runPass.ts`'s state machine along the seam between deciding WHICH turn runs and under what
 * clock (there) and what one turn records whichever way it goes (here): the attempt, its measured or
 * unmeasured usage and items, and whether the boundary error it met was an abort.
 */

import type { IngestError } from "#lib/ingestError.js";
import type { Result } from "#lib/result.js";
import type { LockedCodexThread } from "./client.js";
import type { DeadlineRuntime } from "./runPass.js";
import type { CodexAttempt, CodexEventSink, PassSalvage, StructuredPassOutcome, UsageMeasurement } from "./types.js";

/**
 * Whether a typed error is an abort rather than a transport fault.
 *
 * The distinction matters: an abort is a deliberate policy outcome that earns a wrap-up turn, while a
 * genuine transport failure is fatal and must not be retried into.
 */
function isAbort({ error }: { error: IngestError }): boolean {
  const cause = error.cause;
  return cause instanceof Error && cause.name === "AbortError";
}

/** An attempt that produced no `Turn`, so neither usage nor items exist to record. */
function unmeasuredAttempt({
  kind,
  threadId,
  status,
  startedAtIso,
  finishedAtIso,
  elapsedMs,
  reason,
}: {
  kind: CodexAttempt["kind"];
  threadId: string | null;
  status: CodexAttempt["status"];
  startedAtIso: string;
  finishedAtIso: string;
  elapsedMs: number;
  reason: Extract<UsageMeasurement, { kind: "not-measured" }>["reason"];
}): CodexAttempt {
  return {
    elapsedMs,
    finishedAtIso,
    items: { kind: "not-measured", reason },
    kind,
    startedAtIso,
    status,
    threadId,
    usage: { kind: "not-measured", reason },
  };
}

/**
 * Turn a validated (or rejected) response into the pass outcome.
 *
 * It used to also veto a review that had used any tool at all. That veto is gone: with the diff supplied as a
 * FILE, reading it requires a command, so the rule would have rejected every well-behaved review. Web search
 * and scratch writes are legitimate now too. What replaced it is observation — the streamed activity is
 * recorded and assessed while the pass runs, rather than judged from a count after the money is spent.
 *
 * @returns the answered outcome, or an `invalid-output` no-verdict carrying what the pass did
 */
export function outcomeFromResponse<TAnswer>({
  finalResponse,
  salvage,
  validate,
}: {
  finalResponse: string;
  /** Read only on the failing branch — an answered outcome has the whole response and needs no salvage. */
  salvage: () => PassSalvage | null;
  validate: (args: { response: string }) => Result<TAnswer>;
}): StructuredPassOutcome<TAnswer> {
  const validated = validate({ response: finalResponse });
  if (validated.isErr()) {
    // `invalid-output` salvages too: the response is already in `rawFinalResponse`, but WHAT THE PASS DID is
    // the part that tells a reader whether the schema was the problem or the investigation was.
    return { kind: "no-verdict", rawFinalResponse: finalResponse, reason: "invalid-output", salvage: salvage() };
  }
  return { answer: validated.value, kind: "answered", rawFinalResponse: finalResponse };
}

/** What one turn produced, whichever way it went. */
interface OneTurnResult {
  readonly attempt: CodexAttempt;
  readonly finalResponse: string | null;
  readonly aborted: boolean;
  /** The boundary error a failed turn returned — kept, because it is half of what the fault can say. */
  readonly error: IngestError | undefined;
}

/**
 * One turn against a thread, recorded as an attempt whichever way it goes.
 *
 * @returns the attempt, the final response when the turn answered, whether it aborted, and its boundary error
 */
export async function runOneTurn({
  thread,
  input,
  outputSchema,
  signal,
  runtime,
  kind,
  onEvent,
}: {
  thread: LockedCodexThread;
  input: string;
  outputSchema: unknown;
  signal: AbortSignal;
  runtime: DeadlineRuntime;
  kind: CodexAttempt["kind"];
  onEvent?: CodexEventSink | undefined;
}): Promise<OneTurnResult> {
  const startedAtMs = runtime.nowMs();
  const startedAtIso = runtime.nowIso();
  const result = await thread.run({ input, onEvent, outputSchema, signal });
  const finishedAtIso = runtime.nowIso();
  const elapsedMs = runtime.nowMs() - startedAtMs;
  const threadId = thread.currentId();
  if (result.isOk()) {
    const turn = result.value;
    return {
      aborted: false,
      error: undefined,
      attempt: {
        elapsedMs,
        finishedAtIso,
        items: turn.items,
        kind,
        startedAtIso,
        status: "answered",
        threadId,
        usage: turn.usage,
      },
      finalResponse: turn.finalResponse,
    };
  }
  const aborted = isAbort({ error: result.error });
  return {
    aborted,
    attempt: unmeasuredAttempt({
      elapsedMs,
      finishedAtIso,
      kind,
      reason: aborted ? "aborted" : "transport-failed",
      startedAtIso,
      status: aborted ? "aborted" : "failed",
      threadId,
    }),
    error: result.error,
    finalResponse: null,
  };
}
