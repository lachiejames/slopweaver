/**
 * The Codex half of `cmux spawn`: which destination a seat spends against, and whether it is refusing.
 *
 * Its own leaf rather than a section of `./run.ts`, and the seam is the provider: everything else in that
 * module is driver-agnostic, and this is the one place a spawn asks a Codex account a question. The read
 * itself is `codex/quotaNow.ts` — ONE copy, shared with `codex quota show` and with the loop floor
 * `codex status --check` and the landing verbs enforce. The preflight that judges a routed account before it
 * is spent is `codex/seatDecision.ts`'s `codexSeatPreflightRefusal`, shared with the chair and the console voice.
 *
 * ## The destination is an ARGUMENT, and that is the whole contract here
 *
 * Both functions took the ambient destination themselves until routing existed, which was correct while the
 * machine had one Codex home and became a bug the moment the register could hold several: a cap is a fact
 * about ONE account, so a seat reading the ambient record while spending a routed account would refuse the
 * wrong one and, worse, record an exhaustion against an account that never hit it. The caller resolves the
 * destination once (`cmux/seatRoute.ts`) and both the read and the write are addressed to that same pair.
 */

import type { CodexAccountLive } from "../../../codex/accountLiveParse.js";
import type { CodexDestination } from "../../../codex/destinations.js";
import { writeCodexQuotaCache } from "../../../codex/quotaCache.js";
import type { CodexQuotaDecision } from "../../../codex/quotaGate.js";
import { currentCodexQuotaDecision } from "../../../codex/quotaNow.js";
import type { CodexQuotaKind } from "../../../codex/quotaTypes.js";

/**
 * Whether the destination a `--driver codex` seat would spend against is currently refusing.
 *
 * The decision merges the cached record `writeCodexQuotaCache` last wrote with a FRESH read of that
 * destination's own rollout log (`quotaLog.ts`), discards any evidence a newer HEALTHY reading of its own
 * `limit_id` has cleared or an explicit `codex quota clear` came after, and lets the freshest survivor decide
 * (`quotaGate.ts` § Self-healing).
 *
 * @param destination the routed account: the alias its cap record is keyed by, paired with the home its own
 *   rollout log lives in. A test passes a throwaway home, exactly as `codex/landingGateRun.ts`'s does:
 *   without it this read reaches the OPERATOR's real `~/.codex`, and a test whose verdict depends on whether
 *   the machine running it is capped is not a unit test
 * @param home the state home the cached records live under
 * @param live the destination's live answer from the fleet read that routed it — never a second batch
 * @param nowIso the instant a window reset is judged against, ISO-8601
 * @returns the refusal (with its reason), or a clear pass
 */
export function codexQuotaDecision({
  destination,
  home,
  live,
  nowIso,
}: {
  destination: CodexDestination;
  home: string | undefined;
  live: CodexAccountLive;
  nowIso: string;
}): CodexQuotaDecision {
  return currentCodexQuotaDecision({
    alias: destination.alias,
    codexHome: destination.codexHome,
    home,
    live,
    nowIso,
  });
}

/**
 * Record an exhaustion a booted seat just caught, against the destination it was actually spending.
 *
 * The write counterpart of {@link codexQuotaDecision}, and here for the same reason: the alias the record is
 * keyed by must be the one the decision reads, so the pair lives in one file rather than two call sites that
 * could drift onto different destinations.
 *
 * @param destination the routed account the seat was spending when it hit the banner
 * @param home the state home the cached records live under
 * @param kind what the post-boot check saw
 * @param observedAtIso when it saw it, ISO-8601
 * @returns whether the record was written
 */
export function recordCodexSeatExhaustion({
  destination,
  home,
  kind,
  observedAtIso,
}: {
  destination: CodexDestination;
  home: string | undefined;
  kind: CodexQuotaKind;
  observedAtIso: string;
}): boolean {
  return writeCodexQuotaCache({
    alias: destination.alias,
    evidence: { kind, observedAtIso },
    ...(home === undefined ? {} : { home }),
  });
}
