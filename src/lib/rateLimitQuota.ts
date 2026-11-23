/**
 * The shape of a provider rate limit and the builders every provider block uses: the scope a limit is counted
 * against, how its number was established, the shared derating factor and the one-minute-window helper.
 *
 * The provider blocks themselves live in the category files `./rateLimits.ts` spreads into `PROVIDER_RATE_LIMITS`;
 * they import from here rather than from `./rateLimits.ts`, which would make the registry import itself.
 */

/**
 * WHAT a limit is counted against. This is the key a shared block must use: blocking "slack" globally when
 * the quota is per-workspace would stop an unrelated workspace, and blocking per-token when the quota is
 * per-workspace would let a second token sail past a limit that is already exhausted.
 */
type RateLimitScope = "per-token" | "per-user" | "per-workspace" | "per-tenant" | "app-global";

/**
 * How a number came to be in the registry. `measured` is the only arm that has seen a real 429.
 *
 * `self-imposed` is the third arm and it exists because some providers publish PACING GUIDANCE and no
 * number — JumpCloud directs callers to back off on 429/5xx and warns that insufficient pacing invites
 * suspected-abuse blocking, without ever stating a rate. Filing such a ceiling as `documented` would claim
 * a vendor allowance that does not exist, and as `measured` would claim an observation nobody made.
 *
 * `unverifiedQuotas` (in `./rateLimits.ts`) lists this arm ALONGSIDE `documented`, because "unverified" means "has not been
 * measured against reality" and a self-imposed ceiling is the least verified number in the registry. Excluding
 * it would hide the one quota nobody has any external basis for.
 */
type QuotaProvenance =
  | { readonly status: "measured"; readonly onIso: string; readonly method: string }
  | { readonly status: "documented"; readonly onIso: string; readonly method: string }
  | { readonly status: "self-imposed"; readonly onIso: string; readonly method: string };

/** One endpoint class's quota, derated. */
interface EndpointQuota {
  /** The limit as the provider documents it. */
  readonly documentedLimit: number;
  /** The window that limit applies over, in milliseconds. */
  readonly intervalMs: number;
  /** Fraction of the documented limit actually used, so ordinary jitter is not a 429. */
  readonly safetyFactor: number;
  /** When and how this number was established. */
  readonly verification: QuotaProvenance;
}

/** One provider's whole limit picture. */
export interface ProviderRateLimits {
  readonly scope: RateLimitScope;
  /**
   * The quota per endpoint class. The class NAMES are the provider's own vocabulary, not a forced
   * read/write binary — Slack's real unit is a published per-method tier, and flattening four tiers into
   * "read" would pace its fastest methods fifty times slower than they allow.
   */
  readonly endpointClasses: Readonly<Record<string, EndpointQuota>>;
  /** The class used for an operation this file does not know. Must be the TIGHTEST class the provider has. */
  readonly fallbackClass: string;
}

/** Recorded once so every entry agrees, and so a reviewer can see they were all written at the same time. */
export const RECORDED_ON = "2026-07-27";

/** The shared derating factor. 80% of documented, matching the prior system's measured-safe margin. */
export const SAFETY = 0.8;

/**
 * A documented-but-unmeasured quota over a one-minute window.
 *
 * @param limit the requests per minute the provider documents
 * @param method how the figure was arrived at, recorded as the quota's provenance
 * @returns the quota, derated by the shared safety factor and dated with the shared recording date
 */
export function perMinute({ limit, method }: { limit: number; method: string }): EndpointQuota {
  return {
    documentedLimit: limit,
    intervalMs: 60_000,
    safetyFactor: SAFETY,
    verification: { method, onIso: RECORDED_ON, status: "documented" },
  };
}
