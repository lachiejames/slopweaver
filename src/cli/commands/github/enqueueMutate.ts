/**
 * `slopweaver github enqueue`'s WRITE and its witness — the send, the read-back that judges it, and what
 * happens when the send fails.
 *
 * Split out of `./enqueueRun.ts` rather than left there because that file crossed the file-size ratchet and
 * this is the real seam: everything here is one act — press, then prove — while what remains in the runner
 * is the verb's ordering, its refusals and its report. The three transports and the one witness are stated
 * in `mutateAndConfirm`'s own block; the argument for the recovery path, including why a second send does
 * not contradict the write lane's `retryMode: "never"`, is in `./enqueueFailure.ts`.
 *
 * It takes the two edges it actually uses rather than the verb's whole `GithubEnqueueDeps`, which is also
 * what keeps the import one-way: the runner imports this, never the reverse.
 */
import { formatIngestError, type IngestError } from "../../../lib/ingestError.js";
import { err, ok, type Result, type ResultAsync } from "../../../lib/result.js";
import type { MergeQueuePrState } from "../../../live/github/mergeQueue.js";
import type { GithubMergeQueueApi } from "../../../outbound/github/mergeQueue.js";
import type { GithubEnqueueArgs } from "./enqueueArgs.js";
import { asyncMayHaveStartedLine } from "./enqueueAsyncCore.js";
import { asyncEnqueueProgress, confirmAsyncEnqueue } from "./enqueueAsyncRun.js";
import { landedDespiteFailureLine, mayResendMutation, mutationFailureLines, resendingLine } from "./enqueueFailure.js";
import type { EnqueueTarget } from "./enqueueTarget.js";

/** The two edges the write needs: where a diagnostic goes, and how the asynchronous path sleeps. */
interface MutateDeps {
  readonly wait: (args: { ms: number }) => Promise<void>;
  readonly writeDiagnostic: (line: string) => void;
}

/** The pull request this invocation is about, in the shape every read and write here takes. */
interface PrIdentity {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/**
 * The pull request's queue-relevant state read back after a mutation, classified against what was ASKED for.
 *
 * `landed` and `absent` are the same read answering two different questions — an enqueue wanted an entry to
 * exist, a dequeue wanted it gone — so the direction is what turns one read into a verdict. `unreadable` is
 * kept distinct rather than folded into `absent`, because a read that failed proves nothing and reporting it
 * as "nothing was applied" would be the confident lie this whole path exists to remove.
 */
type WitnessRead =
  | { readonly kind: "landed"; readonly pr: MergeQueuePrState }
  | { readonly kind: "absent"; readonly pr: MergeQueuePrState }
  | { readonly kind: "unreadable"; readonly why: string };

/** Read `mergeQueueEntry` back and judge it against the direction the caller asked for. */
async function witnessRead({
  api,
  dequeue,
  identity,
}: {
  api: GithubMergeQueueApi;
  dequeue: boolean;
  identity: PrIdentity;
}): Promise<WitnessRead> {
  const after = await api.read(identity);
  if (after.isErr()) {
    return { kind: "unreadable", why: after.error.message };
  }
  const queued = after.value.entry !== undefined;
  const asked = dequeue ? !queued : queued;
  if (asked) {
    return { kind: "landed", pr: after.value };
  }
  return { kind: "absent", pr: after.value };
}

/**
 * What happens after the GraphQL mutation FAILS: read the witness, and act on what it proves.
 *
 * Three outcomes, and `./enqueueFailure.ts` carries why each is the right one — including why a second send
 * here does not contradict the write lane's `retryMode: "never"`, and what the one residual race is. The
 * shape is deliberately not a loop: at most two sends ever leave this function.
 *
 * @param error the typed failure the first send returned
 * @param identity the pull request this invocation is about
 * @param send the mutation, ready to run again; the caller has already bound its direction and arguments
 * @returns the pull request as the witness read found it, or every line the failure should print
 */
async function recoverFailedMutation({
  api,
  args,
  deps,
  error,
  identity,
  send,
}: {
  api: GithubMergeQueueApi;
  args: GithubEnqueueArgs;
  deps: MutateDeps;
  error: IngestError;
  identity: PrIdentity;
  send: () => ResultAsync<void, IngestError>;
}): Promise<Result<MergeQueuePrState>> {
  const subject = { number: identity.number, repo: `${identity.owner}/${identity.repo}` };
  const read = await witnessRead({ api, dequeue: args.dequeue, identity });
  if (read.kind === "landed") {
    deps.writeDiagnostic(landedDespiteFailureLine({ dequeue: args.dequeue, error }));
    return ok(read.pr);
  }
  if (!mayResendMutation({ error, witness: read })) {
    return err(mutationFailureLines({ ...subject, dequeue: args.dequeue, error, witness: read }));
  }
  deps.writeDiagnostic(resendingLine({ dequeue: args.dequeue }));
  const second = await send();
  if (second.isErr()) {
    const again = await witnessRead({ api, dequeue: args.dequeue, identity });
    if (again.kind === "landed") {
      deps.writeDiagnostic(landedDespiteFailureLine({ dequeue: args.dequeue, error: second.error }));
      return ok(again.pr);
    }
    return err(mutationFailureLines({ ...subject, dequeue: args.dequeue, error: second.error, witness: again }));
  }
  const confirmed = await witnessRead({ api, dequeue: args.dequeue, identity });
  if (confirmed.kind === "unreadable") {
    return err([confirmed.why]);
  }
  return ok(confirmed.pr);
}

/**
 * Send the write once and confirm it by a fresh `mergeQueueEntry` read.
 *
 * Three straight-line branches rather than a ternary, because they are three different writes on two
 * different transports: GraphQL `dequeuePullRequest`, GraphQL `enqueuePullRequest`, and — for a native-stack
 * member, the only one GitHub accepts for it — the asynchronous merge REST request, whose acceptance is
 * followed by the bounded confirmation loop in `./enqueueAsyncRun.ts`. Every one of them ends at the SAME
 * witness: `PullRequest.mergeQueueEntry`, read back through the ordinary read path.
 *
 * A GraphQL mutation that fails hands off to the witness-first recovery above rather than reporting the bare
 * provider message, which is what six presses on one `acme/acme-admin` pull request once did.
 *
 * @param target where the pull request lands, and which transport that implies
 * @returns the pull request as the confirming read found it, or every reason it could not be confirmed
 */
export async function mutateAndConfirm({
  api,
  args,
  deps,
  pr,
  target,
}: {
  api: GithubMergeQueueApi;
  args: GithubEnqueueArgs;
  deps: MutateDeps;
  pr: MergeQueuePrState;
  target: EnqueueTarget;
}): Promise<Result<MergeQueuePrState>> {
  const identity = { number: args.number, owner: args.owner, repo: args.repo };
  if (!args.dequeue && target.kind === "stack") {
    const accepted = await api.enqueueStack({ ...identity, expectedHeadOid: pr.headOid });
    if (accepted.isErr()) {
      // The PUT may have LANDED even though this failed: a 202 whose body this build cannot parse is an
      // accepted job with an unreadable uuid. Reporting the bare provider message reads like a no-op and
      // invites exactly the retry that would start a second merge job. Found by a Codex review.
      //
      // FORMATTED, not `.message`: this route is the one that failed on a dead socket too, and a bare
      // `other side closed` here would be the same unreadable line the GraphQL route printed six times
      // in a row. There is no re-send on this transport — an asynchronous merge job cannot be proven
      // absent by one read — so naming the layer and the undici code is all the caller gets.
      return err([
        formatIngestError({ error: accepted.error }),
        asyncMayHaveStartedLine({ about: { ...identity, uuid: undefined } }),
      ]);
    }
    return confirmAsyncEnqueue({
      deps: {
        api,
        progress: asyncEnqueueProgress({ writeDiagnostic: deps.writeDiagnostic }),
        wait: deps.wait,
      },
      identity,
      initial: accepted.value,
    });
  }
  const send = args.dequeue
    ? (): ResultAsync<void, IngestError> => api.dequeue({ nodeId: pr.nodeId })
    : (): ResultAsync<void, IngestError> => api.enqueue({ expectedHeadOid: pr.headOid, nodeId: pr.nodeId });
  const mutated = await send();
  if (mutated.isErr()) {
    return recoverFailedMutation({ api, args, deps, error: mutated.error, identity, send });
  }
  const after = await api.read(identity);
  return after.isErr() ? err([after.error.message]) : ok(after.value);
}
