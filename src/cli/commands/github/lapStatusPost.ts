/**
 * How `slopweaver github lap` puts its statuses on a head: through the door, each POST re-sent a bounded number of
 * times when it fails, then every one confirmed by read-back. Every status the lap owns goes through {@link post}:
 * pending, a provisioning error, the verdict, and each batch member's.
 *
 * A POST that fails is not known absent: a deadline or a dropped socket can end a request GitHub went on to
 * accept. So before any re-send the head's statuses are read once, and a status already there exactly (context,
 * state, description) counts as posted and is not sent again. MEASURED: a lap ran every step green, then exited 1
 * on `posting "build" failed: unknown error`, and with no re-send the only way back was the whole lap again.
 *
 * Re-sending the identical status is safe for what the lap means by it: GitHub reports the newest status per
 * context, so a duplicate changes no verdict. It is not invisible — each POST is another record, capped at 1,000
 * per commit and context — which is why the read comes first and the budget is three POSTs. A read that lags the
 * POST it follows reads as absent and costs one duplicate, nothing more.
 */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import type { CommitStatus } from "../../../corpus/github/writeStatus.js";
import type { IngestError } from "../../../lib/ingestError.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { LapSession } from "./lapDeps.js";
import { type LapError, LapErrors } from "./lapErrors.js";
import type { LapStatus } from "./lapStatuses.js";
import { lapDoorRequest } from "./lapVerdict.js";

/**
 * The pauses before the second, third and fourth read of ONE confirmation, so four reads per confirmation: a lap
 * confirms twice, its pending statuses and then its verdict, and each gets its own four. GitHub's commit-status
 * list can lag the POST it just accepted: three laps in one day stopped before any lane on `"integration" was not
 * read back as pending`, and a hand rerun cleared each.
 */
const LAP_READBACK_WAITS_MS: readonly number[] = [2_000, 4_000, 8_000];

/** The pauses before the second and third POST of one status whose POST failed and was not read back. */
const LAP_POST_RESEND_WAITS_MS: readonly number[] = [2_000, 4_000];

/**
 * Whether a status read off the head is exactly the one the lap posted: same context, state and description.
 *
 * @param found a status read back off the head
 * @param status the status the lap posted
 * @returns true only when all three fields match
 */
export function sameLapStatus({ found, status }: { found: CommitStatus; status: LapStatus }): boolean {
  return found.context === status.context && found.state === status.state && found.description === status.description;
}

/**
 * Whether a failed POST was GitHub REFUSING it — an HTTP 4xx other than a 429 — which no re-send clears and which
 * means it did not land. Everything else is re-sent: a dropped socket, a deadline, a 429, a 5xx, and a failure that
 * carried no status at all, as the `unknown error` that lost a green lap did. The status alone decides, whatever
 * the kind: `toIngestError` already drops a status an SDK invented over a dead socket, so one that is present is
 * GitHub's own answer. A secondary rate limit arrives as a 403 and is refused too, since no wait this short clears it.
 *
 * @param error the failed POST
 * @returns true only for a definite client refusal
 */
export function isDefinitePostRefusal({ error }: { error: IngestError }): boolean {
  const status = error.status;
  return status !== undefined && status >= 400 && status < 500 && status !== 429;
}

/**
 * Read the head once after a failed POST, to learn whether that POST landed anyway.
 *
 * @returns whether the exact status is there, and the read's own failure as a clause for the final message
 */
async function readAfterFailedPost({
  session,
  status,
}: {
  session: LapSession;
  status: LapStatus;
}): Promise<{ readonly there: boolean; readonly unread: string }> {
  const { api, args, refs } = session;
  const read = await api.statuses({ owner: args.owner, repo: args.repo, sha: refs.headSha });
  if (read.isErr()) {
    return { there: false, unread: `; the read-back after it failed too: ${read.error.message}` };
  }
  return { there: read.value.some((found) => sameLapStatus({ found, status })), unread: "" };
}

/**
 * POST one status, and on a failure read the head once and re-send it only when it is not there, at most three
 * POSTs in all; a definite refusal is never re-sent.
 *
 * @returns nothing once the status was posted or read back as already there, or the failure naming the attempts
 */
async function postWithResend({
  session,
  status,
}: {
  session: LapSession;
  status: LapStatus;
}): Promise<Result<void, LapError>> {
  const { api, args, deps, refs } = session;
  const attempts = LAP_POST_RESEND_WAITS_MS.length + 1;
  for (let attempt = 1; ; attempt += 1) {
    const posted = await api.postStatus({ ...status, owner: args.owner, repo: args.repo, sha: refs.headSha });
    if (posted.isOk()) {
      return ok(undefined);
    }
    if (isDefinitePostRefusal({ error: posted.error })) {
      const what = `posting "${status.context}" was refused, so it is not re-sent: ${posted.error.message}`;
      return err(LapErrors.postFailed({ what }));
    }
    const { there, unread } = await readAfterFailedPost({ session, status });
    if (there) {
      return ok(undefined);
    }
    if (attempt === attempts) {
      const what = `posting "${status.context}" failed on all ${String(attempts)} attempts, the last with: ${posted.error.message}${unread}`;
      return err(LapErrors.postFailed({ what }));
    }
    await deps.wait({ ms: LAP_POST_RESEND_WAITS_MS[attempt - 1]! });
  }
}

/**
 * Read the head's statuses back until every posted one is there, pausing between reads. Only a LAGGING read is
 * read again. A read that FAILS stops at once: its client (`commitStatusesVia`) already retries a transient failure
 * itself, so retrying it here too would compound the two budgets.
 *
 * @returns the statuses, once every one is read back, or the failure naming each one that was not
 */
async function confirmPosted({
  session,
  statuses,
}: {
  session: LapSession;
  statuses: readonly LapStatus[];
}): Promise<Result<readonly LapStatus[], LapError>> {
  const { api, args, deps, refs } = session;
  const attempts = LAP_READBACK_WAITS_MS.length + 1;
  for (let attempt = 1; ; attempt += 1) {
    const read = await api.statuses({ owner: args.owner, repo: args.repo, sha: refs.headSha });
    if (read.isErr()) {
      return err(LapErrors.postFailed({ what: `the read-back failed: ${read.error.message}` }));
    }
    const unconfirmed = statuses.filter((status) => !read.value.some((found) => sameLapStatus({ found, status })));
    if (unconfirmed.length === 0) {
      return ok(statuses);
    }
    if (attempt === attempts) {
      const missing = unconfirmed.map((status) => `"${status.context}" was not read back as ${status.state}`);
      return err(LapErrors.postFailed({ what: `${missing.join("; ")} after ${String(attempts)} read-back attempts` }));
    }
    await deps.wait({ ms: LAP_READBACK_WAITS_MS[attempt - 1]! });
  }
}

/**
 * Post every status in order, stopping at the first that cannot be, then confirm each by read-back.
 *
 * @returns the statuses, posted and confirmed, or the failure that stopped them
 */
async function postAndConfirm({
  session,
  statuses,
}: {
  session: LapSession;
  statuses: readonly LapStatus[];
}): Promise<Result<readonly LapStatus[], LapError>> {
  for (const status of statuses) {
    const posted = await postWithResend({ session, status });
    if (posted.isErr()) {
      return err(posted.error);
    }
  }
  return confirmPosted({ session, statuses });
}

/**
 * Post statuses on the head through the door, printing each one confirmed or every reason it was not.
 *
 * @returns whether every status was posted and read back
 */
export async function post({
  session,
  statuses,
}: {
  session: LapSession;
  statuses: readonly LapStatus[];
}): Promise<boolean> {
  const { args, deps, home, refs } = session;
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => postAndConfirm({ session, statuses }),
    request: lapDoorRequest({ args, headSha: refs.headSha, home }),
  });
  if (!through.performed) {
    for (const line of notPerformedLines({ command: "slopweaver github lap", through })) {
      deps.writeDiagnostic(line);
    }
    return false;
  }
  if (through.result.isErr()) {
    deps.writeDiagnostic(`github lap: ${through.result.error.message}`);
    return false;
  }
  for (const status of through.result.value) {
    deps.out(`github lap: posted ${status.context} ${status.state} — ${status.description}`);
  }
  return true;
}
