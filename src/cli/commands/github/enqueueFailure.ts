/**
 * What `slopweaver github enqueue` says when its GraphQL mutation FAILS — as pure functions, so the lines a
 * reader sees are assertable without a socket.
 *
 * ## Why a failed press is answered with a READ rather than with a message
 *
 * MEASURED on one `acme/acme-admin` pull request: six presses over about forty minutes whose
 * entire output was the single line `other side closed`, exit 1, while GitHub's own `enqueuePullRequest`
 * under the raw break-glass queued the same head at position 2 first try. That line named no
 * operation, no layer and no next step, and — the part that actually stalled the landing — it did not say
 * whether the press had reached GitHub. A session facing it cannot tell a no-op from a completed press, so
 * the only safe act left is to stop.
 *
 * The answer was already in the verb. `../../../outbound/github/mergeQueue.ts` states the design: a mutation
 * that reports its own success is the class of claim this repository refuses, so the witness is a SEPARATE
 * read of `PullRequest.mergeQueueEntry`. If that read is authoritative enough to CONFIRM a press, it is
 * authoritative enough to REFUTE one — so the failure path takes the same read, and the ambiguity is gone.
 *
 * ## What makes a second send safe here, when the lane says `retryMode: "never"`
 *
 * `../../../corpus/github/writeQueue.ts` never retries, and that stays right: it would be retrying BLIND,
 * and a blind re-send of an enqueue is a second entry's worth of churn on somebody else's branch. The shell
 * re-sends SIGHTED — only after the witness read has proven no entry exists, which is proof that the first
 * send created none. The rule is about what a re-send can DUPLICATE, and a proven-absent entry can duplicate
 * nothing.
 *
 * Bounded deliberately at ONE further send, and only when the failure was a transport one
 * ({@link hadNoProviderResponse}): a provider that ANSWERED has already decided what to do with the request,
 * so re-asking it is not a recovery, it is an argument. The residual race — a witness read that reports no
 * entry while one exists — is not claimed closed here. What bounds it is the ordering and the reporting: the
 * second failure is printed with its own cause, so a double press is visible rather than silent.
 */
import { formatIngestError, hadNoProviderResponse, type IngestError } from "../../../lib/ingestError.js";

/** What the witness read found after a failed mutation. */
export type MutationWitness =
  /** The read-back shows the state the caller asked for — the press landed before the transport dropped. */
  | { readonly kind: "landed" }
  /** The read-back proves the state is NOT there, so the failed send changed nothing. */
  | { readonly kind: "absent" }
  /** The witness read itself failed, so nothing is proven either way. */
  | { readonly kind: "unreadable"; readonly why: string };

/** `enqueue`/`dequeue` as the report names them, so one renderer serves both directions. */
function act({ dequeue }: { dequeue: boolean }): string {
  return dequeue ? "dequeue" : "enqueue";
}

/**
 * Whether a failed mutation may be sent once more.
 *
 * Both conditions are load-bearing and neither is sufficient alone: the witness must have PROVEN the state
 * absent (so a second send can duplicate nothing), and the failure must have been a transport one (so there
 * is no provider verdict to argue with).
 *
 * @param error the typed failure the mutation returned
 * @param witness what the read-back found afterwards
 * @returns true only when sending the same mutation again is provably safe
 */
export function mayResendMutation({ error, witness }: { error: IngestError; witness: MutationWitness }): boolean {
  return witness.kind === "absent" && hadNoProviderResponse({ error });
}

/**
 * The line printed immediately BEFORE a second send, so the act is on the page before it happens rather
 * than inferred from a success that arrived out of nowhere.
 *
 * @param dequeue whether the invocation ran backwards, out of the queue
 * @returns the one diagnostic line
 */
export function resendingLine({ dequeue }: { dequeue: boolean }): string {
  return (
    `the ${act({ dequeue })} died at the transport and the queue read back shows nothing was applied — ` +
    "sending it once more. This is the only re-send; a second failure is reported, not retried."
  );
}

/**
 * The line printed when the transport dropped but the read-back shows GitHub applied the press anyway.
 *
 * @param dequeue whether the invocation ran backwards, out of the queue
 * @param error the typed failure the mutation returned
 * @returns the one diagnostic line
 */
export function landedDespiteFailureLine({ dequeue, error }: { dequeue: boolean; error: IngestError }): string {
  return (
    `the ${act({ dequeue })} reported a failure (${formatIngestError({ error })}) but GitHub had already ` +
    "applied it — the connection dropped after the mutation was accepted. The queue read below is the witness."
  );
}

/**
 * Every line a mutation failure that could NOT be recovered prints, in order.
 *
 * The formatted failure comes first because it names the operation, the layer and the provider's own words;
 * the residue line after it answers the only question a caller actually has, which is whether anything
 * happened. A transport failure with an unreadable witness is the one case where the honest answer is
 * "unknown", and it says so rather than implying a no-op.
 *
 * @param error the typed failure the last send returned
 * @param dequeue whether the invocation ran backwards, out of the queue
 * @param repo the `owner/name` slug
 * @param number the pull request number
 * @param witness what the read-back found, or why it could not be read
 * @returns the lines to print, most specific first
 */
export function mutationFailureLines({
  error,
  dequeue,
  repo,
  number,
  witness,
}: {
  error: IngestError;
  dequeue: boolean;
  repo: string;
  number: number;
  witness: MutationWitness;
}): readonly string[] {
  const subject = `${repo}#${String(number)}`;
  const lines = [formatIngestError({ error })];
  if (witness.kind === "unreadable") {
    lines.push(
      `UNCERTAIN: the ${act({ dequeue })} of ${subject} failed and the queue read that would settle whether ` +
        `it landed also failed (${witness.why}). Read the pull request's merge queue before pressing again.`,
    );
    return lines;
  }
  if (hadNoProviderResponse({ error })) {
    lines.push(
      `no HTTP response came back at all, so GitHub never answered this ${act({ dequeue })} of ${subject}; the ` +
        "queue read back shows nothing was applied, and the one permitted re-send failed the same way. " +
        "Nothing was changed on GitHub — run the verb again.",
    );
    return lines;
  }
  lines.push(
    `GitHub answered and refused this ${act({ dequeue })} of ${subject}; the queue read back confirms nothing ` +
      "was applied. Re-sending would earn the same refusal — fix what it named.",
  );
  return lines;
}
