/**
 * The ledger one `github coderabbit-yield` read accumulates, and the one call every request goes through —
 * so no request escapes the cost booking or the reserve.
 */

import { isRecord } from "../../lib/parsers.js";
import { err, type Result } from "../../lib/result.js";
import { rateOf } from "./coderabbitYieldQueries.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { GithubReadGraphql } from "./read.js";

/** The budget left in reserve: the read stops, and says so, rather than spend the token's last points. */
const RATE_RESERVE = 100;

/** The mutable ledger one walk accumulates. */
export interface Walk {
  readonly graphql: GithubReadGraphql;
  readonly progress: (line: string) => void;
  requests: number;
  cost: number;
  remaining: number | undefined;
  readonly gaps: string[];
}

/**
 * One field of a raw response object.
 *
 * @param value a raw GraphQL response fragment
 * @returns the field, or undefined when the value is not an object
 */
export function fieldOf({ value, key }: { value: unknown; key: string }): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/**
 * One GraphQL call, its rate facts booked on the walk; refused once the reserve is reached.
 *
 * @returns the raw response, or a read failure naming the points left when the reserve stopped it
 */
export async function callWalk({
  walk,
  query,
  variables,
}: {
  walk: Walk;
  query: string;
  variables: Readonly<Record<string, unknown>>;
}): Promise<Result<unknown, GithubLiveError>> {
  if (walk.remaining !== undefined && walk.remaining <= RATE_RESERVE) {
    return err(
      GithubLiveErrors.readFailed({
        message: `stopped with ${String(walk.remaining)} GraphQL points left, the ${String(RATE_RESERVE)} held in reserve`,
      }),
    );
  }
  const response = await walk.graphql({ query, variables });
  walk.requests += 1;
  if (response.isOk()) {
    const rate = rateOf({ data: response.value });
    if (rate !== undefined) {
      walk.cost += rate.cost;
      walk.remaining = rate.remaining;
    }
  }
  return response;
}
