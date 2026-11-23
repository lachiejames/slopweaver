/**
 * Provider rate limits AS DATA, with provenance — the piece PR3.6's resilience layer was missing.
 *
 * PR3.6 already shipped the mechanisms (`p-throttle` pacing, `p-retry` backoff, `p-limit` concurrency).
 * What it did not have was anywhere to write down WHAT the limits are. The rate was a bare number passed
 * at each call site (`LINEAR_RATE_PER_SEC`, `NOTION_RATE_PER_SEC`, a `ratePerSec` argument), which leaves
 * four things unrecordable and all four of them matter:
 *
 *  1. **The scope the limit applies to.** Slack's quota is per-WORKSPACE, so two concurrent slopweaver runs
 *     against one workspace share it; Linear's and GitHub's are per-token. A bare number cannot say which,
 *     so a shared block has nothing to key on.
 *  2. **That different endpoints have different quotas.** Slack publishes a per-METHOD tier, and they range
 *     over two orders of magnitude. One number per provider is therefore either far too slow for the fast
 *     methods or too fast for the slow ones.
 *  3. **How the number was arrived at.** A limit nobody can date or attribute is folklore. Every entry here
 *     carries the date it was recorded and the method used, and says plainly when it has NOT been measured.
 *  4. **The safety factor.** Running at exactly the documented limit means every clock skew is a 429, so
 *     each quota is derated before use.
 *
 * The numbers are TRANSCRIBED FROM DOCUMENTATION, not measured against a live 429. Every entry says
 * so in its own `verification` field, and {@link unverifiedQuotas} exists so a test and a diagnostic can
 * both enumerate what still needs measuring. That is the honest state, and it is recorded rather than
 * rounded off.
 *
 * One block per provider this install calls, each carrying its own scope, endpoint classes, safety factor
 * and provenance. The blocks live in four category files, spread into the one `PROVIDER_RATE_LIMITS` below in
 * a fixed order, so a reader still compares quotas across one table:
 *
 * - `./rateLimitsPlatforms.ts` — code hosting, Google Workspace and admin surfaces, automation;
 * - `./rateLimitsMailAndWork.ts` — mail, recorded calls and issue tracking;
 * - `./rateLimitsAdminServices.ts` — identity, security training and message delivery;
 * - `./rateLimitsChatAndDocs.ts` — documents and chat.
 *
 * The shape of a limit, the derating factor and the `perMinute` builder are in `./rateLimitQuota.ts`. A new
 * provider goes in its category file, and a category file nearing 300 code lines splits again; the cap is met
 * by a split, never by a marker.
 */

import { OPERATION_ENDPOINT_CLASS } from "#lib/operationEndpointClass.js";
import type { ProviderRateLimits } from "#lib/rateLimitQuota.js";
import { ADMIN_SERVICE_RATE_LIMITS } from "#lib/rateLimitsAdminServices.js";
import { CHAT_AND_DOCS_RATE_LIMITS } from "#lib/rateLimitsChatAndDocs.js";
import { MAIL_AND_WORK_RATE_LIMITS } from "#lib/rateLimitsMailAndWork.js";
import { PLATFORM_RATE_LIMITS } from "#lib/rateLimitsPlatforms.js";

export type { ProviderRateLimits };

/**
 * The registry.
 *
 * Slack's classes are its published method tiers. `chat-post` is separate from `tier3` because
 * `chat.postMessage` is documented with its own special allowance (roughly one message per second per
 * channel) rather than a tier, and it is also the one irreversible call in the program — so it gets its own
 * row rather than being lumped in with the repeatable ones.
 */
export const PROVIDER_RATE_LIMITS: Readonly<Record<string, ProviderRateLimits>> = {
  ...PLATFORM_RATE_LIMITS,
  ...MAIL_AND_WORK_RATE_LIMITS,
  ...ADMIN_SERVICE_RATE_LIMITS,
  ...CHAT_AND_DOCS_RATE_LIMITS,
};

export { OPERATION_ENDPOINT_CLASS };

/**
 * The endpoint class for one operation label, falling back to the provider's tightest class.
 *
 * @param provider the external system
 * @param operation the operation label, e.g. `slack.chat.update`
 * @returns the class name, and whether it came from the map or the fallback
 */
export function endpointClassFor({ provider, operation }: { provider: string; operation: string }): {
  readonly endpointClass: string;
  readonly classified: boolean;
} {
  const mapped = OPERATION_ENDPOINT_CLASS[operation];
  if (mapped !== undefined) {
    return { classified: true, endpointClass: mapped };
  }
  const limits = PROVIDER_RATE_LIMITS[provider];
  return { classified: false, endpointClass: limits === undefined ? "unknown" : limits.fallbackClass };
}

/**
 * The derated sustained rate for one operation, in requests per second.
 *
 * @param provider the external system
 * @param operation the operation label
 * @returns the requests-per-second ceiling, or undefined when the provider is not registered
 */
export function effectiveRatePerSec({
  provider,
  operation,
}: {
  provider: string;
  operation: string;
}): number | undefined {
  const limits = PROVIDER_RATE_LIMITS[provider];
  if (limits === undefined) {
    return undefined;
  }
  const { endpointClass } = endpointClassFor({ operation, provider });
  const quota = limits.endpointClasses[endpointClass] ?? limits.endpointClasses[limits.fallbackClass];
  if (quota === undefined) {
    return undefined;
  }
  return (quota.documentedLimit / quota.intervalMs) * 1000 * quota.safetyFactor;
}

/**
 * Every quota still resting on documentation rather than a measured 429.
 *
 * This exists so "we have not verified these" is a value the program can report rather than a caveat in a
 * comment that rots. A `doctor` line and a unit test both read it.
 *
 * @returns one entry per unmeasured quota, as `provider/class` plus how it was recorded
 */
export function unverifiedQuotas(): readonly {
  readonly provider: string;
  readonly endpointClass: string;
  readonly recordedOnIso: string;
  readonly method: string;
}[] {
  const out: { provider: string; endpointClass: string; recordedOnIso: string; method: string }[] = [];
  for (const [provider, limits] of Object.entries(PROVIDER_RATE_LIMITS)) {
    for (const [endpointClass, quota] of Object.entries(limits.endpointClasses)) {
      if (quota.verification.status !== "measured") {
        out.push({
          endpointClass,
          method: quota.verification.method,
          provider,
          recordedOnIso: quota.verification.onIso,
        });
      }
    }
  }
  return out;
}
