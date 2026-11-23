/**
 * ONE effectful read of "is Codex capped right now", shared by every verb that has to know.
 *
 * The defect this exists for, reproduced on a live workspace spend cap: `slopweaver codex quota
 * show` printed `refuse: true` with `usage-limit` evidence observed minutes earlier, while `slopweaver codex
 * status --check` — which `github enqueue` and `github merge --admin` read through `./landingGateRun.ts` —
 * printed `no planning pass has run on this branch` and said nothing whatever about the cap.
 * A session reading that cannot tell a CAPPED Codex from one nobody ran, which is the precondition rule 9's
 * cap path needs in order to work at all. Reproduce on any capped account:
 *
 * ```bash
 * slopweaver codex quota show && slopweaver codex status --check
 * ```
 *
 * The three readers that already made this decision — `cmux spawn --driver codex`, `codex quota show`, and
 * now the loop floor — spelled the same four steps for themselves, so the fix is one function rather than a
 * fourth copy: the cached record, a fresh read of Codex's own rollout log, the instant `codex quota clear`
 * last disregarded both, the healthy readings that may clear either, and the pure decision over whatever
 * survives (`./quotaGate.ts`).
 */

import type { CodexAccountLive } from "./accountLiveParse.js";
import { evidenceFromLive, quotaObservationsFromLive } from "./accountLiveParse.js";
import { readCodexQuotaCache, readCodexQuotaClearMark } from "./quotaCache.js";
import {
  type CodexQuotaDecision,
  evidenceAfterClear,
  resolveCodexQuotaDecisionAcross,
  survivingEvidence,
} from "./quotaGate.js";
import { readLatestCodexQuotaEvidence, readLatestCodexQuotaObservations } from "./quotaLog.js";
import type { CodexQuotaEvidence, CodexQuotaObservation } from "./quotaTypes.js";

/**
 * The pure decision over every source one destination has: the cached record, the rollout log's newest
 * refusal and healthy readings, and the account's own live answer.
 *
 * The live answer joins BOTH sides. Its exhausted windows are candidates like any other, and its healthy
 * buckets are observations dated at the read — so a cap the owner has since reset, still standing in a
 * cached record or a days-old rollout line of the same `limit_id`, is cleared by a strictly later reading
 * rather than refusing until its own reset instant (`./quotaGate.ts` § Self-healing). A live read that did
 * not happen (`unreadable`, `store-missing`, `signed-out`) contributes nothing, so the answer is exactly
 * what it was before the live read existed.
 *
 * The clear mark filters the two NON-LIVE candidates only, and the split is structural rather than inferred
 * from timestamps: the cached record and the rollout evidence pass through `evidenceAfterClear` before the
 * live evidence joins them, so an explicit clear can never lift a refusal the live read itself is making.
 *
 * @param cached the cap record `writeCodexQuotaCache` last wrote for this alias, if any
 * @param clearedAtIso when `codex quota clear` last ran for this alias — required, so a caller states absence
 * @param rolloutEvidence the newest refusal in the destination's own rollout log, if any
 * @param rolloutObservations the rollout log's newest reading per `limit_id`
 * @param live what the destination's app-server answered in this read
 * @param nowIso the instant a window reset is judged against
 * @returns the refusal, with the reason a caller displays, or a clear pass
 */
export function decideCurrentCodexQuota({
  cached,
  clearedAtIso,
  live,
  nowIso,
  rolloutEvidence,
  rolloutObservations,
}: {
  cached: CodexQuotaEvidence | undefined;
  clearedAtIso: string | undefined;
  live: CodexAccountLive;
  nowIso: string;
  rolloutEvidence: CodexQuotaEvidence | undefined;
  rolloutObservations: readonly CodexQuotaObservation[];
}): CodexQuotaDecision {
  const nonLive = evidenceAfterClear({ candidates: [cached, rolloutEvidence], clearedAtIso });
  return resolveCodexQuotaDecisionAcross({
    evidence: survivingEvidence({
      candidates: [...nonLive, ...evidenceFromLive({ live })],
      observations: [...rolloutObservations, ...quotaObservationsFromLive({ live })],
    }),
    nowIso,
  });
}

/**
 * Decide, from every source available for ONE destination, whether it is currently refusing to spend.
 *
 * Both halves of the destination are required and neither is defaulted. A cap is a fact about an account,
 * and the two sources that establish one are addressed differently — the cache by the register ALIAS, the
 * rollout log by that destination's own `$CODEX_HOME` — so a caller supplying one and defaulting the other
 * would be reading two different accounts and calling the result one answer.
 *
 * The live answer is REQUIRED and read by the caller, never here: a fleet read asks every store at once in one
 * batch (`./accountLive.ts`), and a function that launched its own would cost one app-server per destination
 * per caller. A caller with no live answer to give passes an `unreadable` row, which is today's behaviour.
 *
 * @param alias the destination's register alias, which keys its cached record and its clear mark
 * @param codexHome where that destination keeps its own rollout log
 * @param home the state home the cached exhaustion records and clear marks live under
 * @param live that destination's app-server answer, read by the caller
 * @param nowIso the instant a window reset is judged against, ISO-8601 — injected so a test fixes the clock
 * @returns the refusal, with the reason a caller displays, or a clear pass
 */
export function currentCodexQuotaDecision({
  alias,
  codexHome,
  home,
  live,
  nowIso,
}: {
  alias: string;
  codexHome: string;
  home: string | undefined;
  live: CodexAccountLive;
  nowIso: string;
}): CodexQuotaDecision {
  const homeArg = home === undefined ? {} : { home };
  return decideCurrentCodexQuota({
    cached: readCodexQuotaCache({ alias, ...homeArg }),
    clearedAtIso: readCodexQuotaClearMark({ alias, ...homeArg }),
    live,
    nowIso,
    rolloutEvidence: readLatestCodexQuotaEvidence({ codexHome }),
    rolloutObservations: readLatestCodexQuotaObservations({ codexHome }),
  });
}

/**
 * The evidence a refusal stands on, or undefined when nothing is refusing.
 *
 * The shape the pure loop floor takes as its LIVE cap witness: a decision carries a reason a human reads and
 * evidence a gate reasons over, and the floor wants only the second.
 *
 * @param decision the decision {@link currentCodexQuotaDecision} returned
 * @returns the evidence when Codex is capped, undefined when it is not
 */
export function capEvidence({ decision }: { decision: CodexQuotaDecision }): CodexQuotaEvidence | undefined {
  return decision.refuse ? decision.evidence : undefined;
}
