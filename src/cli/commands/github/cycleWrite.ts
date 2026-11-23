/** The write half of `github cycle`: the close and the confirmed reopen, performed inside the door. */

import { err, ok, type Result } from "../../../lib/result.js";
import type { CyclePr, GithubCycleApi } from "../../../outbound/github/cycle.js";
import { cycleStateRefusal, type GithubCycleArgs, mergeMovedSinceJudged } from "./cycleCore.js";
import { type GithubVerbError, GithubVerbErrors } from "./errors.js";
import { sendOutcomeUnknown } from "./rerunCore.js";

/** How many times the reopen is sent before the verb reports the pull request left closed. */
const REOPEN_ATTEMPTS = 2;

/**
 * Wrap a provider failure as this verb directory's own error.
 *
 * @param operation the step that failed, as the refusal names it
 * @returns the upstream-refused verb error carrying the provider's message
 */
export function upstream({ operation, message }: { operation: string; message: string }): GithubVerbError {
  return GithubVerbErrors.upstreamRefused({ operation, reasons: [message] });
}

/** What one close send established: it landed, or its answer was lost and it may have. */
type CloseOutcome = { readonly kind: "closed" } | { readonly kind: "unknown"; readonly cause: string };

/**
 * Close once. A send that failed without a definite answer is read back, because GitHub may have closed it
 * before the answer went missing. A read-back that fails, or still says open, proves nothing — a lagging read
 * can say open about a pull request that is closed — so that outcome is `unknown` and the reopen is sent
 * anyway: reopening an open pull request changes nothing, and leaving a closed one is the outcome to avoid.
 */
async function close({
  api,
  args,
}: {
  api: GithubCycleApi;
  args: GithubCycleArgs;
}): Promise<Result<CloseOutcome, GithubVerbError>> {
  const { owner, repo, number } = args;
  const sent = await api.close({ number, owner, repo });
  if (sent.isOk()) {
    return ok({ kind: "closed" });
  }
  if (!sendOutcomeUnknown({ error: sent.error })) {
    return err(upstream({ message: sent.error.message, operation: "close" }));
  }
  const reread = await api.read({ number, owner, repo });
  if (reread.isOk() && reread.value.state.toLowerCase() === "closed") {
    return ok({ kind: "closed" });
  }
  return ok({ cause: sent.error.message, kind: "unknown" });
}

/**
 * Reopen, confirmed by GitHub's OWN answer to the reopen — the pull request it sends back — and never by a
 * separate read, which can lag a close and say open about a pull request that is closed. A reopen is safe to
 * send twice, an open pull request stays open, so a second attempt is made before the verb reports the one
 * outcome it exists to avoid.
 */
async function reopen({
  api,
  args,
  url,
}: {
  api: GithubCycleApi;
  args: GithubCycleArgs;
  url: string;
}): Promise<Result<void, GithubVerbError>> {
  const { owner, repo, number } = args;
  let cause = "no attempt was made";
  for (let attempt = 1; attempt <= REOPEN_ATTEMPTS; attempt += 1) {
    const sent = await api.reopen({ number, owner, repo });
    if (sent.isOk() && sent.value.toLowerCase() === "open") {
      return ok(undefined);
    }
    if (sent.isErr()) {
      cause = sent.error.message;
    } else {
      cause = `GitHub answered the reopen with state ${sent.value}`;
    }
  }
  return err(GithubVerbErrors.cycleLeftClosed({ cause, url }));
}

/**
 * The whole transition as one door-recorded action: close, then reopen, confirmed by GitHub's answer. The pull
 * request is read and refused AGAIN immediately before the close, because the judgement's reads, the door and
 * write pacing leave a window in which somebody can close or enqueue it — and a cycle after that would undo a
 * deliberate close — and it must still carry the head and merge the freshness judgement passed, or the cycle
 * re-runs CI on something else. What remains is the round trip between this read and the close, and the base
 * moving, which no pull-request read shows; the usage names both.
 *
 * @param judged the pull request as the freshness judgement read it
 * @returns nothing on a confirmed reopen, else the refusal or write failure that stopped it
 */
export async function cycleAndConfirm({
  api,
  args,
  judged,
}: {
  api: GithubCycleApi;
  args: GithubCycleArgs;
  judged: CyclePr;
}): Promise<Result<void, GithubVerbError>> {
  const { owner, repo, number } = args;
  const { url } = judged;
  const latest = await api.read({ number, owner, repo });
  if (latest.isErr()) {
    return err(GithubVerbErrors.prUnread({ cause: latest.error.message, number, owner, repo }));
  }
  const refusal = cycleStateRefusal({ pr: latest.value });
  if (refusal !== undefined) {
    return err(GithubVerbErrors.cycleRefused({ reason: `${refusal}, as read just before the close` }));
  }
  const moved = mergeMovedSinceJudged({ judged, latest: latest.value });
  if (moved !== undefined) {
    return err(GithubVerbErrors.mergeRefMovedBeforeClose({ number, reason: moved }));
  }
  const closed = await close({ api, args });
  if (closed.isErr()) {
    return err(closed.error);
  }
  const reopened = await reopen({ api, args, url });
  if (reopened.isErr() || closed.value.kind === "closed") {
    return reopened;
  }
  return err(GithubVerbErrors.cycleCloseUnconfirmed({ cause: closed.value.cause, url }));
}
