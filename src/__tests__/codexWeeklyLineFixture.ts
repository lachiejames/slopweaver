/**
 * One real-shaped Codex `token_count` line at a chosen weekly percentage, shared by the fleet-route tests that
 * write it into a temp store's rollout log. The shape is `REAL_HEALTHY_WEEKLY_LINE`'s
 * (`./codexRolloutLines.ts`) with the percentage and instant parameterised, so the parser under test reads what
 * Codex actually writes.
 */

/**
 * One real-shaped `token_count` line reporting an open weekly window at `percent`, observed at `observedIso`.
 *
 * @returns the line as one JSON string, without a trailing newline
 */
export function weeklyLine({ observedIso, percent }: { observedIso: string; percent: number }): string {
  return JSON.stringify({
    ordinal: 1,
    payload: {
      info: { model_context_window: 258400 },
      rate_limits: {
        credits: { balance: null, has_credits: true, unlimited: false },
        limit_id: "codex",
        limit_name: null,
        plan_type: "pro",
        primary: { resets_at: 1790500000, used_percent: percent, window_minutes: 10080 },
        rate_limit_reached_type: null,
        secondary: null,
      },
      type: "token_count",
    },
    timestamp: observedIso,
    type: "event_msg",
  });
}
