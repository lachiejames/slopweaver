/**
 * PULL REQUESTS — the GitHub rate-limit budget this poller stays inside.
 *
 * Split out of {@link ./prStatus.js} (the file-size ratchet, step 2): the poller's own spend accounting,
 * kept apart from both the domain/ranking logic and the `gh` collection edge because it answers a different
 * question — not "what does this pull request need next" but "how much of the shared token is this page
 * allowed to spend".
 */

import { isRecord } from "../../lib/parsers.js";
import type { CommandReader } from "../../measurement/measure.js";
import { type Measured, measured, unmeasurable } from "../../measurement/status.js";

/**
 * The share of a GitHub rate-limit bucket this poller may spend.
 *
 * The owner's constraint: poll quietly and cap at 20% of whatever rate limit applies, so other agents doing
 * GitHub operations are never blocked.
 */
export const POLL_BUDGET_FRACTION = 0.2;

/** One GitHub rate-limit bucket, as the API reports it. A payload shape — nothing here paces anything. */
interface BudgetBucket {
  readonly limit: number;
  readonly remaining: number;
  readonly used: number;
}

/** The three buckets that matter here. `search` is watched precisely because nothing here may touch it. */
export interface RateLimits {
  readonly core: BudgetBucket;
  readonly graphql: BudgetBucket;
  readonly search: BudgetBucket;
}

/** One bucket of the `gh api rate_limit` payload, or `undefined` when it is absent or the wrong shape. */
function bucketAt({ resources, name }: { resources: Record<string, unknown>; name: string }): BudgetBucket | undefined {
  const value = resources[name];
  if (!isRecord(value)) {
    return undefined;
  }
  const record = value;
  const [limit, remaining, used] = ["limit", "remaining", "used"].map((key) => {
    const field = record[key];
    return typeof field === "number" ? field : undefined;
  });
  return limit === undefined || remaining === undefined || used === undefined ? undefined : { limit, remaining, used };
}

/**
 * Parse `gh api rate_limit`.
 *
 * @param stdout what `gh` printed
 * @returns the three buckets, or the reason they could not be read
 */
export function parseRateLimit({ stdout }: { stdout: string }): RateLimits | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return "`gh api rate_limit` returned output that is not JSON";
  }
  if (!isRecord(parsed)) {
    return "`gh api rate_limit` returned no object";
  }
  const resources = parsed["resources"];
  if (!isRecord(resources)) {
    return "`gh api rate_limit` returned no `resources` object";
  }
  const [core, graphql, search] = ["core", "graphql", "search"].map((name) => bucketAt({ name, resources }));
  return core === undefined || graphql === undefined || search === undefined
    ? "`gh api rate_limit` did not report all of core, graphql and search"
    : { core, graphql, search };
}

/**
 * What this poller costs and what is left, in one sentence printed on the page.
 *
 * A poller whose spend is invisible is the thing the owner objects to everywhere else, so the interval, the
 * arithmetic and the remaining budget all go on screen rather than into a comment. Search is stated
 * separately because six calls an hour is a prohibition rather than a budget, and starving it is exactly the
 * cross-agent blocking the cap exists to prevent.
 *
 * @param limits the buckets as GitHub reported them, or the reason they are unknown
 * @param ttlMs how long one measurement is served before a request re-takes it
 * @param repoCount how many repositories are asked per measurement
 * @returns the sentence
 */
export function rateLimitLine({
  limits,
  ttlMs,
  repoCount,
}: {
  limits: Measured<RateLimits>;
  ttlMs: number;
  repoCount: number;
}): string {
  const perHour = Math.ceil((3_600_000 / ttlMs) * repoCount);
  const plan = `Poll: at most one \`gh pr list\` per repository per ${String(Math.round(ttlMs / 1000))}s while this page is open — ${String(perHour)} call(s)/hour for ${String(repoCount)} repo(s).`;
  if (!limits.known) {
    return `${plan} BUDGET NOT MEASURED — ${limits.why}. Search is never queried by this poller either way.`;
  }
  const { graphql, search } = limits.value;
  const budget = Math.floor(graphql.limit * POLL_BUDGET_FRACTION);
  const searchNote =
    search.remaining === search.limit
      ? `search UNTOUCHED at ${String(search.remaining)}/${String(search.limit)}`
      : `search at ${String(search.remaining)}/${String(search.limit)} — ${String(search.limit - search.remaining)} spent this hour by SOMETHING ELSE on this machine, not by this poller`;
  return (
    `${plan} That is ${String(perHour)} of a ${String(budget)}/hour budget (${String(Math.round(POLL_BUDGET_FRACTION * 100))}% of the ${String(graphql.limit)} graphql limit);` +
    ` ${String(graphql.remaining)} remaining, ${String(graphql.used)} used this hour by every agent sharing this token.` +
    ` This poller issues NO search query — a 20% share of the 30/hour search limit would be six calls, which is a prohibition rather than a budget — and ${searchNote}.`
  );
}

/**
 * Ask GitHub what is left of each rate-limit bucket.
 *
 * The `rate_limit` endpoint does not itself consume the core budget, so watching the budget costs nothing
 * out of it.
 *
 * @param cwd the directory `gh` is run from
 * @param read how `gh` is run
 * @returns the buckets, or the reason they could not be read
 */
export function readRateLimit({ cwd, read }: { cwd: string; read: CommandReader }): Measured<RateLimits> {
  const stdout = read({ args: ["api", "rate_limit"], command: "gh", cwd });
  if (!stdout.known) {
    return unmeasurable({ why: stdout.why });
  }
  const parsed = parseRateLimit({ stdout: stdout.value });
  return typeof parsed === "string" ? unmeasurable({ why: parsed }) : measured({ value: parsed });
}
