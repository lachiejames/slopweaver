/**
 * `handover wake`'s judging pass — what each waking park comes to BEFORE any is woken: cleared or skipped on its
 * disposition, reported not due or unknown, or handed back due.
 *
 * A park `cmux spawn` will refuse on every tick — a settled ask, a finished or shipped run, a terminal row — is
 * CLEARED before any clock or check is read, with a `park-cleared` line bound to its journal position, and
 * spends none of the run's attempts. MEASURED on a live board: two settled asks took two of every wake's three spawns
 * on a refused spawn and deferred nine live parks behind them. A paused row is skipped and KEPT: unpausing is
 * the owner's decision, and the wake it waits on stands once they make it.
 *
 * **Every row is judged before any is woken, so the judging is bounded**: one GitHub read
 * with no limit of its own would hold every due row behind it. Each checks read is cut at
 * {@link WAKE_CHECKS_READ_TIMEOUT_MS} ({@link boundedReadChecks}) and judged UNKNOWN, which never wakes; reads run
 * {@link WAKE_JUDGE_CONCURRENCY} at a time; and none STARTS once {@link WAKE_JUDGE_DEADLINE_MS} has passed — the
 * rows left are UNKNOWN for now. Reads go longest since the last read — or since the park, never read — first
 * (`../../../handover/wakeTurnStore.ts`), so a row the window shut out is read on a later tick before any row this
 * one read, even while the same oldest reads keep timing out.
 *
 * **What an abandoned read costs, stated.** The race cuts the WAIT, not the request: a read past its limit keeps
 * its socket, or its rate-block timer, until it answers or the process ends — and `runCliProcess`
 * (`../../main.ts`) exits the process with the verb's code once the verb returns, so nothing abandoned outlives the
 * run. Live requests are bounded by the rows read, never by {@link WAKE_JUDGE_CONCURRENCY} alone.
 */
import { err, ok, type Result } from "#lib/result.js";

import { githubToken } from "../../../config.js";
import {
  type ChecksWakeObservation,
  judgeParkWake,
  type ParkWakeJudgement,
  type ReadChecksWake,
} from "../../../handover/parkWake.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { clearRecheck, type WakeCandidate } from "../../../handover/wakeCandidates.js";
import { leastRecentlyTried } from "../../../handover/wakeOrder.js";
import { wakeParkKey } from "../../../handover/wakeTurnStore.js";
import { DECISION_CHECK_LIMIT, makeFetchGithubChecks } from "../../../live/github/checksRead.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../live/github/errors.js";
import { makeFetchPrClosure } from "../../../live/github/prClosure.js";
import { githubReadGraphql } from "../../../live/github/read.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { HandoverWakeDeps, WakeRowReport } from "./wakeRows.js";

/** One checks read's limit: a pull request's ending, then up to one decision's worth of check pages. */
export const WAKE_CHECKS_READ_TIMEOUT_MS = 30_000;

/**
 * The production checks read: the pull request's ending first, then — only while it is open — one checks read
 * walking up to {@link DECISION_CHECK_LIMIT} contexts, so a long acme-admin head is not judged off one page. Cut at
 * {@link WAKE_CHECKS_READ_TIMEOUT_MS} by an unreferenced timer, so an abandoned read never holds the verb open.
 *
 * @param home the state home whose GitHub token the read uses
 * @returns the one read a checks wake makes
 */
export function productionReadChecks({ home }: { home: string }): ReadChecksWake {
  const graphql = githubReadGraphql({ token: githubToken({ home }) });
  const fetchClosure = makeFetchPrClosure({ graphql });
  const fetchChecks = makeFetchGithubChecks({ graphql });
  const timer = ({ ms }: { ms: number }): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms).unref();
    });
  const read: ReadChecksWake = async ({ repo, number }) => {
    const slash = repo.indexOf("/");
    const owner = repo.slice(0, slash);
    const name = repo.slice(slash + 1);
    const closure = await fetchClosure({ number, owner, repo: name });
    if (closure.isErr()) {
      return err(closure.error);
    }
    if (closure.value.state === "MERGED") {
      return ok({ mergeCommitOid: closure.value.mergeCommitOid, prState: "MERGED" });
    }
    if (closure.value.state === "CLOSED") {
      return ok({ prState: "CLOSED" });
    }
    const checks = await fetchChecks({ limit: DECISION_CHECK_LIMIT, number, owner, repo: name });
    if (checks.isErr()) {
      return err(checks.error);
    }
    return ok({ checks: checks.value, prState: "OPEN" });
  };
  return boundedReadChecks({ read, timeoutMs: WAKE_CHECKS_READ_TIMEOUT_MS, timer });
}

/** How many checks reads run at once: enough that 41 parks judge in seven rounds, few enough to stay polite. */
export const WAKE_JUDGE_CONCURRENCY = 6;

/** No checks read starts this long after the judging began, so the whole pass ends inside it plus one read. */
export const WAKE_JUDGE_DEADLINE_MS = 120_000;

/** A park judged due. */
export type DueJudgement = ParkWakeJudgement & { readonly kind: "due" };

/**
 * Cut a checks read at a limit: a read still running then answers a read failure, which judges its park UNKNOWN.
 *
 * @param read the unbounded read
 * @param timeoutMs how long one read may take
 * @param timer resolves once its milliseconds pass — the wall clock in production, a fake in a test
 * @returns the bounded read
 */
export function boundedReadChecks({
  read,
  timeoutMs,
  timer,
}: {
  read: ReadChecksWake;
  timeoutMs: number;
  timer: (args: { ms: number }) => Promise<void>;
}): ReadChecksWake {
  return ({ number, repo }) => {
    const late = timer({ ms: timeoutMs }).then((): Result<ChecksWakeObservation, GithubLiveError> =>
      err(
        GithubLiveErrors.readFailed({
          message: `the read did not answer inside ${String(timeoutMs / 1000)}s, so it was abandoned`,
        }),
      ),
    );
    return Promise.race([read({ number, repo }), late]);
  };
}

/**
 * Retire a park `cmux spawn` would refuse forever, bound to its journal position and only while it still stands
 * and the row, re-read now, is still refused — a park the recheck finds lifted is kept for the next wake to judge.
 *
 * @returns the row's action and its detail
 */
function clearRow({
  candidate,
  dryRun,
  home,
  now,
  rerunAllowed,
}: {
  candidate: WakeCandidate;
  dryRun: boolean;
  home: string;
  now: Date;
  rerunAllowed: boolean;
}): Pick<WakeRowReport, "action" | "detail"> {
  const { parkIndex, slug } = candidate;
  const runsDir = stateHomePaths({ home }).runs;
  const recheck = clearRecheck({ candidate, home, rerunAllowed });
  if (recheck.kind === "lifted") {
    return { action: "none", detail: recheck.reason };
  }
  const why = `${recheck.refusal.reason}, so cmux spawn refuses it on every wake`;
  if (dryRun) {
    return { action: "would-clear", detail: `would clear the park: ${why}` };
  }
  const written = applyRowEvent({
    event: { atIso: now.toISOString(), kind: "park-cleared", parkIndex, why },
    runsDir,
    slug,
  });
  if (written.isErr()) {
    return { action: "park-clear-failed", detail: `the park-cleared line did not write: ${written.error.message}` };
  }
  return { action: "park-cleared", detail: `cleared without a reseat: ${why}` };
}

/**
 * What one candidate comes to before any is woken.
 *
 * @param readChecks the bounded checks read this run makes for every checks wake
 * @returns the row's report, or its due judgement
 */
async function judgedRow({
  candidate,
  deps,
  dryRun,
  home,
  now,
  readChecks,
}: {
  candidate: WakeCandidate;
  deps: HandoverWakeDeps;
  dryRun: boolean;
  home: string;
  now: Date;
  readChecks: ReadChecksWake;
}): Promise<WakeRowReport | DueJudgement> {
  const { disposition, parked, slug } = candidate;
  const base = { slug, wake: parked.wake };
  switch (disposition.kind) {
    case "permanent": {
      const judgement = { kind: "not-judged", reason: disposition.refusal.reason } as const;
      return { ...base, judgement, ...clearRow({ candidate, dryRun, home, now, rerunAllowed: deps.rerunAllowed }) };
    }
    case "paused":
      return {
        ...base,
        action: "paused-skipped",
        detail: disposition.reason,
        judgement: { kind: "not-judged", reason: "the row is paused" },
      };
    case "judge": {
      const judgement = await judgeParkWake({ now, readChecks, wake: parked.wake });
      if (judgement.kind === "due") {
        return judgement;
      }
      return { ...base, action: "none", detail: judgement.reason, judgement };
    }
  }
}

/**
 * Judge every candidate, {@link WAKE_JUDGE_CONCURRENCY} at a time — the longest since its last read, or since its
 * park, first — starting no checks read once {@link WAKE_JUDGE_DEADLINE_MS} has passed on `deps.now`.
 *
 * @param now the run's instant, which every judgement is made at
 * @param lastRead each park's last checks read, by `wakeParkKey`
 * @returns each candidate's report or due judgement, in candidate order, and the keys whose checks this run read
 */
export async function judgeCandidates({
  candidates,
  deps,
  dryRun,
  home,
  lastRead,
  now,
}: {
  candidates: readonly WakeCandidate[];
  deps: HandoverWakeDeps;
  dryRun: boolean;
  home: string;
  lastRead: ReadonlyMap<string, string>;
  now: Date;
}): Promise<{ readonly judged: readonly (WakeRowReport | DueJudgement)[]; readonly read: readonly string[] }> {
  const readChecks = deps.readChecks({ home });
  const startedMs = deps.now().getTime();
  const judged: (WakeRowReport | DueJudgement | undefined)[] = candidates.map(() => undefined);
  const read: string[] = [];
  const keyed = candidates.map(({ parkIndex, parked, slug }, index) => ({
    dueSinceIso: parked.atIso,
    index,
    key: wakeParkKey({ parkIndex, parkedAtIso: parked.atIso, slug }),
    slug,
  }));
  const order = leastRecentlyTried({ due: keyed, lastTried: lastRead });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < order.length) {
      const { index, key } = order[next]!;
      next += 1;
      const candidate = candidates[index]!;
      const { parked, slug } = candidate;
      const reads = candidate.disposition.kind === "judge" && parked.wake.kind === "checks";
      const elapsedMs = deps.now().getTime() - startedMs;
      if (reads && elapsedMs >= WAKE_JUDGE_DEADLINE_MS) {
        const reason =
          `this run's ${String(WAKE_JUDGE_DEADLINE_MS / 1000)}s judging window closed before its checks were ` +
          "read; a later tick reads it before any park this one read";
        judged[index] = {
          action: "none",
          detail: reason,
          judgement: { kind: "unknown", reason },
          slug,
          wake: parked.wake,
        };
        continue;
      }
      if (reads) {
        read.push(key);
      }
      judged[index] = await judgedRow({ candidate, deps, dryRun, home, now, readChecks });
    }
  };
  await Promise.all(Array.from({ length: WAKE_JUDGE_CONCURRENCY }, worker));
  return { judged: judged.map((row) => row!), read };
}
