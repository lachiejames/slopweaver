/**
 * Every gate `github stack push` runs before it opens a pull request — the creation door's local checks, and
 * the one write-access preflight that needs the API.
 *
 * `stack push` is the only verb that opens a pull request. They sit in their own file rather than inlined
 * into `./stackPushRun.ts` because of the file-size ratchet.
 */
import type { AutonomyLedgerPort } from "../../../autonomy/port.js";
import type { GithubWriteApi } from "../../../corpus/github/write.js";
import type { Result } from "../../../lib/result.js";
import type { PrTarget } from "../../../outbound/github/types.js";
import { answerFirstGateRefused } from "./answerFirstGate.js";
import type { AlreadyLanded, BaseFreshness, BaseFreshnessAcknowledgement } from "./baseFreshnessCore.js";
import { createBaseGatesRefused } from "./createBaseFreshness.js";
import type { GithubVerbResult } from "./errors.js";
import { createFindingGateRefused } from "./findingRulingGate.js";
import type { ReadQueueGate } from "./queueGateRun.js";

/** The measurement edges the local gates read, injectable so a test never shells real git. */
export interface StackPushGateDeps {
  readonly cwd: () => string;
  readonly measureAlreadyLanded: (args: { cwd: string; remote: string; target: PrTarget }) => Result<AlreadyLanded>;
  readonly measureBaseFreshness: (args: {
    cwd: string;
    remote: string;
    target: PrTarget;
  }) => GithubVerbResult<BaseFreshness>;
  readonly out: (args: { line: string }) => void;
  /**
   * Read what the base branch's merge queue gates on, so a `base-moved` head that queue already tests is
   * permitted rather than sent round a rebase-and-revalidate lap. Called only on a measured `base-moved`,
   * after the synchronous freshness fetch and before any write client — see `./createBaseFreshness.ts`.
   * Optional: absent, or answering `undefined`, the refusal stands exactly as it did.
   */
  readonly readQueueGate?: ReadQueueGate | undefined;
  /** The autonomy ledger the internal finding door records its act in (`./findingRulingGate.ts`). */
  readonly autonomy: AutonomyLedgerPort;
}

/**
 * Every gate that reads LOCAL state — git and the board — and therefore runs BEFORE the first API call.
 *
 * Base freshness first, deliberately. It shells out to `git fetch` synchronously, and a synchronous child
 * process between a pooled GET and the create POST is a socket that dies under the POST: the event loop is
 * blocked while the server closes the idle keep-alive connection, so the close is only read AFTER the POST
 * has been written onto it. Measured under fleet load — `canPush` then a slow fetch, then "other
 * side closed" in 9 ms, on every attempt. Measuring first leaves no idle pooled socket for the POST to
 * inherit. BOTH base gates sit here for that reason; the second answers a question freshness structurally
 * cannot — freshness compares by ancestry, and a squash merge makes a branch whose work has already landed
 * read as perfectly unmerged. The finding gate reads only the
 * board on disk, and sits last because it is the cheapest and the newest: a fleet finding the owner has not ruled
 * on must not reach a teammate, which a pull request opened on a team base from a row nobody asked for
 * would do.
 *
 * The answer-first gate sits beside it, on the same reasoning and the same cost: it reads only the ask
 * lifecycle log and at most one worker-session record per LIVE ask. It is the ordering half of the
 * answer-first ruling — a dispatched worker on a public ask answers the thread before it opens a pull request —
 * and unlike the finding gate it is about WHO is pushing rather than what is being pushed, so it is
 * checked for every base. See `./answerFirstGate.ts` for the measurement.
 *
 * @param args the fields the gates read: `cwd`, `remote` and the acknowledgement
 * @param deps the measurement edges and the output sink
 * @param home the state home whose board the finding gate reads, and whose credential the queue read uses
 * @param target the pull request's routing fields
 * @returns `true` when the caller must refuse, `false` when every local gate let it through
 */
export async function stackPushLocalGatesRefused({
  args,
  deps,
  home,
  target,
}: {
  args: {
    readonly cwd?: string | undefined;
    readonly remote?: string | undefined;
    readonly baseFreshnessAcknowledgement: BaseFreshnessAcknowledgement;
  };
  deps: StackPushGateDeps;
  home: string;
  target: PrTarget;
}): Promise<boolean> {
  if (await createBaseGatesRefused({ args, deps, home, target })) {
    return true;
  }
  if (answerFirstGateRefused({ env: process.env, home, out: deps.out })) {
    return true;
  }
  return createFindingGateRefused({
    autonomy: deps.autonomy,
    base: target.base,
    head: target.head,
    home,
    out: deps.out,
    owner: target.owner,
    repo: target.repo,
  });
}

/**
 * Confirm the repository is writable before anything is reserved.
 *
 * @param api the GitHub write surface
 * @param target the pull request's routing fields, naming the repository
 * @returns the refusal line, or `undefined` when the token can push
 */
export async function stackPushWriteBlocked({
  api,
  target,
}: {
  api: GithubWriteApi;
  target: PrTarget;
}): Promise<string | undefined> {
  const push = await api.canPush({ owner: target.owner, repo: target.repo });
  if (push.isErr()) {
    return `could not check write access to ${target.owner}/${target.repo}: ${push.error.message}`;
  }
  if (!push.value) {
    return (
      `${target.owner}/${target.repo} is readable but this token cannot push to it, so a pull request would ` +
      "fail at the API after you believed it was settled. Note this reports the VIEWER's repository role, " +
      "which is the strongest signal a read-only probe can give — it is not a token-grant attestation."
    );
  }
  return undefined;
}
