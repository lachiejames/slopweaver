/*
 * What the `planWatchTick` test files share: the three configured plans, the tick's instant, the stale and
 * recent instants a touch or a swap is recorded at, a gauge parsed from real headers, the healthy readings and
 * the touches that leave every store due. They moved here when the watch tick's tests were split by behaviour.
 */
import type { ClaudeAccount, ClaudeAccountGauge } from "../../../../claude/contracts.js";
import { parseClaudeGauge } from "../../../../claude/usage.js";
import { unwrap } from "../../../../lib/result.js";

export const ACCOUNTS: readonly ClaudeAccount[] = [
  { alias: "plan-one", storeDir: "/stores/one" },
  { alias: "plan-two", storeDir: "/stores/two" },
  { alias: "plan-three", pinned: true, storeDir: "/stores/three" },
];

export const NOW = "2026-09-05T12:00:00.000Z";

/** Long enough ago that every store reads as due, so a test that cares about touching gets one. */
export const STALE = "2026-09-04T12:00:00.000Z";

/**
 * A swap recorded three hours before the tick — inside one access-token lifetime, so the RECORDED answer
 * is still evidence. `STALE` is a day old and would now be refused by the record's own age bound, which is
 * a different property and has its own describe block.
 */
export const RECENT_SWAP = "2026-09-05T09:00:00.000Z";

/**
 * A gauge built the way the real probe builds one: a header record parsed by `usage.ts`. Driving genuine
 * upstream output downstream is the discipline this whole feature was rebuilt around.
 *
 * @returns the parsed gauge for that alias, observed at the tick's own instant
 */
export function gauge({
  alias,
  fiveHour = "0.10",
  fiveHourStatus = "allowed",
  sevenDay = "0.10",
  sevenDayReset = "1789041600",
}: {
  alias: string;
  fiveHour?: string;
  fiveHourStatus?: string;
  sevenDay?: string;
  sevenDayReset?: string;
}): ClaudeAccountGauge {
  return unwrap(
    parseClaudeGauge({
      alias,
      headers: {
        "anthropic-ratelimit-unified-5h-reset": "1788459000",
        "anthropic-ratelimit-unified-5h-status": fiveHourStatus,
        "anthropic-ratelimit-unified-5h-utilization": fiveHour,
        "anthropic-ratelimit-unified-7d-reset": sevenDayReset,
        "anthropic-ratelimit-unified-7d-status": "allowed",
        "anthropic-ratelimit-unified-7d-utilization": sevenDay,
      },
      observedAtIso: NOW,
    }),
  );
}

export const HEALTHY: readonly ClaudeAccountGauge[] = [
  gauge({ alias: "plan-one" }),
  gauge({ alias: "plan-two" }),
  gauge({ alias: "plan-three" }),
];

export const ALL_TOUCHED_LONG_AGO: readonly { alias: string; lastTouchedIso: string }[] = ACCOUNTS.map((account) => ({
  alias: account.alias,
  lastTouchedIso: STALE,
}));
