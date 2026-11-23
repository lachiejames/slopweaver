/**
 * The shared shapes `quotaBanner.ts`, `quotaLog.ts`, `quotaCache.ts` and `quotaGate.ts` all read and write —
 * split out so none of the four needs to import another purely to reach a type.
 */

/**
 * Which known Codex usage-exhaustion state was observed.
 *
 * `window-limit` is the one with a MEASURED window behind it: a reading at 100% of a rate-limit window,
 * which carries a `resets_at` a clock can be compared against, and {@link CodexQuotaEvidence.windowMinutes}
 * records WHICH window. It was called `weekly-limit` while the classifier looked at nothing but the weekly
 * window, and that was the defect rather than the name: a real 100% FIVE-HOUR reading
 * (`used_percent: 100, window_minutes: 300`) exists on this machine and read as healthy. Found against a
 * real rollout line. Reproduce:
 *
 * ```bash
 * grep -rlo '"used_percent":100.0,"window_minutes":300' "${CODEX_HOME:-$HOME/.codex}/sessions" | head
 * ```
 *
 * `usage-limit` is the other thing
 * Codex actually says — a `rate_limit_reached_type` of `workspace_member_usage_limit_reached`, which arrives
 * on an event whose `primary` and `secondary` are both null, so no window and no reset instant exist to read.
 * Folding the second into the first would name a window nothing measured. Reproduce the split:
 *
 * ```bash
 * grep -roh '"rate_limit_reached_type":"[a-z_]*"' "${CODEX_HOME:-$HOME/.codex}/sessions" | sort | uniq -c
 * ```
 *
 * Measured on this machine: 85 `workspace_member_usage_limit_reached`, 8
 * `workspace_member_credits_depleted`, and every one of the 93 sat on `"limit_id":"premium"` with both
 * windows null.
 */
export type CodexQuotaKind = "credits-out" | "usage-limit" | "window-limit";

/**
 * The spelling `window-limit` replaced, kept ONLY so a cache row written before the rename still decodes.
 * See {@link CodexQuotaKind} for the defect the rename records.
 */
export const PRIOR_WINDOW_LIMIT_KIND = "weekly-limit";

/**
 * One piece of exhaustion evidence, timestamped so `quotaGate.ts` can compare freshness across sources (the
 * cached state file versus Codex's own rollout log) and let the more recent one win.
 */
export interface CodexQuotaEvidence {
  readonly kind: CodexQuotaKind;
  /** When this evidence was observed, ISO-8601. */
  readonly observedAtIso: string;
  /**
   * For `window-limit` only: when the window resets, ISO-8601, if a source could supply it. Absent for
   * `credits-out` — a credits refill carries no predictable time, so that case never self-clears on a clock
   * — and absent for `usage-limit`, whose own event carries no window at all (see {@link CodexQuotaKind}).
   */
  readonly resetAtIso?: string;
  /**
   * For `window-limit` only: which window is exhausted, in minutes — 300 or 10,080 on this machine.
   *
   * Carried so a refusal can say WHICH window closed, which is the difference between waiting five hours and
   * waiting a week. The kind deliberately does not encode it: every exhausted window behaves identically
   * (refuse until `resetAtIso`), so making that one distinction a second kind would multiply the union for a
   * difference only the message cares about.
   */
  readonly windowMinutes?: number;
  /**
   * The `limit_id` this exhaustion is ABOUT — `codex` or `premium` on this machine — or absent when the
   * source could not say (the banner scraper, a transport fault's wording, a cache row written before this
   * field existed).
   *
   * It is the scope key {@link CodexQuotaObservation} is compared against, and the reason recovery is not
   * simply "a newer healthy line wins". MEASURED: all 93 exhaustion events on this machine carry
   * `"limit_id":"premium"` and all 80,841 ordinary readings carry `"limit_id":"codex"`, so the two coexist
   * constantly — a healthy `codex` window says nothing whatever about a capped `premium` allowance, and
   * letting one clear the other would lift a real cap on every subsequent turn.
   */
  readonly limitId?: string;
}

/**
 * One rate-limit READING, whether or not it found anything wrong — the thing `./quotaGate.ts`'s header has
 * always described and the code has never had.
 *
 * That header promises a real refill self-heals a stale cache "once some other Codex invocation anywhere
 * writes a healthier snapshot". It could not: `readLatestCodexQuotaEvidence` returns exhaustion evidence or
 * nothing, so a healthy line produced `undefined`, the cached cap was the only candidate left, and it won
 * every comparison forever. A cap could therefore only ever be cleared by hand. Carrying the healthy case as
 * a first-class observation with its own instant is what makes the documented behaviour real.
 */
export interface CodexQuotaObservation {
  /** The rollout event's own timestamp, ISO-8601. */
  readonly observedAtIso: string;
  /** Which `limit_id` this reading is about, or undefined when the event named none. */
  readonly limitId: string | undefined;
  /** The exhaustion this reading found, or undefined when it read HEALTHY — never "we did not look". */
  readonly evidence: CodexQuotaEvidence | undefined;
}

/**
 * Every {@link CodexQuotaKind}, as a set — so a value read from disk or from a record is narrowed in ONE
 * place rather than by a comparison chain each caller spells for itself.
 *
 * It exists because the chain was already spelled three times (`quotaCache.ts`'s decoder, `quotaGate.ts`'s
 * decision, `transportCause.ts`'s defensive read) and adding `usage-limit` had to find all three. A union
 * whose members are enumerated per call site is a union that silently loses its newest member somewhere.
 */
const CODEX_QUOTA_KINDS: ReadonlySet<string> = new Set<CodexQuotaKind>(["credits-out", "usage-limit", "window-limit"]);

/**
 * Narrow an unknown value to a {@link CodexQuotaKind}.
 *
 * A type predicate, so the compiler proves the narrowing rather than a caller asserting it. Predicates
 * cannot take a destructured object — TypeScript refuses with TS1230 — which is the compiler's decision
 * rather than an exception to the named-object-params rule.
 *
 * @returns true only for a value this module declares as a kind
 */
export function isCodexQuotaKind(value: unknown): value is CodexQuotaKind {
  return typeof value === "string" && CODEX_QUOTA_KINDS.has(value);
}
