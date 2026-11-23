/**
 * Nine REAL lines from this machine's Codex rollout log, copied verbatim, and the reason they are copied
 * rather than written.
 *
 * The defect these exist to make unrepeatable: `src/codex/quotaLog.ts` required `payload.info.rate_limits`
 * and Codex writes `payload.rate_limits`, so it matched **0 of 80,935** `token_count` events over a month —
 * and its unit test passed the whole time, because every fixture in it had been typed from the module's own
 * doc comment. A hand-written fixture can only ever prove the parser agrees with the author's belief about
 * the format. These were `grep`-ed out of `$CODEX_HOME/sessions` and pasted unedited,
 * so a parser that passes over them has been shown to read what Codex actually writes.
 *
 * Nothing here is redacted, because nothing here is a secret: a `rate_limits` object carries percentages,
 * window widths, an epoch reset, a plan type and a limit id, and the surrounding `info` carries token
 * counts. `$CODEX_HOME` paths, thread ids and any prompt text are excluded by only keeping `token_count`
 * events — the one event type whose payload is entirely counters.
 *
 * Re-cut any of them:
 *
 * ```bash
 * cd "${CODEX_HOME:-$HOME/.codex}/sessions"
 * grep -rh -m1 '"rate_limit_reached_type":"workspace_member_usage_limit_reached"' . | head -1
 * ```
 */

/**
 * A healthy weekly reading at 18%, `limit_id: codex`, `secondary: null`.
 *
 * The ordinary line — 80,842 of the 80,935 events look like this one, and it is the shape that must read as
 * "no evidence" rather than as an exhaustion.
 */
export const REAL_HEALTHY_WEEKLY_LINE =
  '{"timestamp":"2026-09-13T05:51:14.803Z","ordinal":82,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":694816,"cached_input_tokens":619264,"cache_write_input_tokens":0,"output_tokens":1564,"reasoning_output_tokens":102,"total_tokens":696380},"last_token_usage":{"input_tokens":86513,"cached_input_tokens":85760,"cache_write_input_tokens":0,"output_tokens":278,"reasoning_output_tokens":0,"total_tokens":86791},"model_context_window":258400},"rate_limits":{"limit_id":"codex","limit_name":null,"primary":{"used_percent":18.0,"window_minutes":10080,"resets_at":1789877221},"secondary":null,"credits":{"has_credits":true,"unlimited":false,"balance":null},"individual_limit":null,"spend_control_reached":null,"plan_type":"self_serve_business_prolite","rate_limit_reached_type":null}}}';

/**
 * `workspace_member_usage_limit_reached` — the 85-of-93 majority, and the one the shipped classifier missed.
 *
 * Both windows are null on it and `has_credits` is TRUE, so the reached type is the only exhaustion signal
 * the line carries. That is the whole argument for `usage-limit` being its own kind.
 */
export const REAL_USAGE_LIMIT_REACHED_LINE =
  '{"timestamp":"2026-09-11T07:31:24.319Z","ordinal":120,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1126534,"cached_input_tokens":1013376,"cache_write_input_tokens":0,"output_tokens":3484,"reasoning_output_tokens":1019,"total_tokens":1130018},"last_token_usage":{"input_tokens":110218,"cached_input_tokens":105344,"cache_write_input_tokens":0,"output_tokens":125,"reasoning_output_tokens":6,"total_tokens":110343},"model_context_window":258400},"rate_limits":{"limit_id":"premium","limit_name":null,"primary":null,"secondary":null,"credits":{"has_credits":true,"unlimited":false,"balance":null},"individual_limit":null,"spend_control_reached":null,"plan_type":"self_serve_business_prolite","rate_limit_reached_type":"workspace_member_usage_limit_reached"}}}';

/**
 * `workspace_member_credits_depleted`, from the very incident `quotaLog.ts` was written for.
 *
 * Worth reading closely: it too puts `rate_limits` beside `info` rather than inside it, so the module's
 * claim to have captured the nested shape "live" was never true of any line on this machine.
 */
export const REAL_CREDITS_DEPLETED_LINE =
  '{"timestamp":"2026-08-14T04:28:21.285Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":110246951,"cached_input_tokens":107123328,"cache_write_input_tokens":0,"output_tokens":250325,"reasoning_output_tokens":114288,"total_tokens":110497276},"last_token_usage":{"input_tokens":198577,"cached_input_tokens":197504,"cache_write_input_tokens":0,"output_tokens":1579,"reasoning_output_tokens":1006,"total_tokens":200156},"model_context_window":258400},"rate_limits":{"limit_id":"premium","limit_name":null,"primary":null,"secondary":null,"credits":{"has_credits":false,"unlimited":false,"balance":null},"individual_limit":null,"spend_control_reached":null,"plan_type":"team","rate_limit_reached_type":"workspace_member_credits_depleted"}}}';

/**
 * A five-hour PRIMARY window with the weekly one carried as SECONDARY — and `credits: null`, no
 * `spend_control_reached` key at all.
 *
 * Two facts in one line: which window sits where is not fixed (3,270 events put the 300-minute window in
 * `primary`), and the object's own key set varies by Codex version, so a parser that requires `credits` to
 * be an object refuses a legitimate older reading.
 */
export const REAL_FIVE_HOUR_PRIMARY_LINE =
  '{"timestamp":"2026-07-03T03:51:33.329Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":23256,"cached_input_tokens":4992,"output_tokens":993,"reasoning_output_tokens":516,"total_tokens":24249},"last_token_usage":{"input_tokens":23256,"cached_input_tokens":4992,"output_tokens":993,"reasoning_output_tokens":516,"total_tokens":24249},"model_context_window":258400},"rate_limits":{"limit_id":"codex","limit_name":null,"primary":{"used_percent":1.0,"window_minutes":300,"resets_at":1783068673},"secondary":{"used_percent":13.0,"window_minutes":10080,"resets_at":1783414816},"credits":null,"individual_limit":null,"plan_type":"team","rate_limit_reached_type":null}}}';

/**
 * A weekly window at exactly 100% with `rate_limit_reached_type: null`.
 *
 * The `weekly-limit` kind's only real witness: the reached type says nothing, so the exhaustion is visible
 * solely in `primary.used_percent` against a 10,080-minute window — which is why that branch survives
 * alongside the reached-type map rather than being replaced by it.
 */
export const REAL_WEEKLY_EXHAUSTED_LINE =
  '{"timestamp":"2026-07-19T16:28:08.923Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":21339,"cached_input_tokens":5504,"output_tokens":734,"reasoning_output_tokens":267,"total_tokens":22073},"last_token_usage":{"input_tokens":21339,"cached_input_tokens":5504,"output_tokens":734,"reasoning_output_tokens":267,"total_tokens":22073},"model_context_window":258400},"rate_limits":{"limit_id":"codex","limit_name":null,"primary":{"used_percent":100.0,"window_minutes":10080,"resets_at":1784998696},"secondary":null,"credits":{"has_credits":true,"unlimited":false,"balance":null},"individual_limit":null,"plan_type":"team","rate_limit_reached_type":null}}}';

/**
 * A real EXHAUSTED FIVE-HOUR window — `primary` at 100% of 300 minutes, beside a healthy weekly `secondary`.
 *
 * The line a Codex review of this work produced to break the classifier: it asked only for the weekly
 * window, found it at 46%, and called this healthy. Reproduce that such lines exist:
 *
 * ```bash
 * grep -rlo '"used_percent":100.0,"window_minutes":300' "${CODEX_HOME:-$HOME/.codex}/sessions" | head
 * ```
 */
export const REAL_FIVE_HOUR_EXHAUSTED_LINE =
  '{"timestamp":"2026-06-29T08:01:29.724Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":24855,"cached_input_tokens":4992,"output_tokens":790,"reasoning_output_tokens":516,"total_tokens":25645},"last_token_usage":{"input_tokens":24855,"cached_input_tokens":4992,"output_tokens":790,"reasoning_output_tokens":516,"total_tokens":25645},"model_context_window":258400},"rate_limits":{"limit_id":"codex","limit_name":null,"primary":{"used_percent":100.0,"window_minutes":300,"resets_at":1782399663},"secondary":{"used_percent":46.0,"window_minutes":10080,"resets_at":1782402150},"credits":{"has_credits":true,"unlimited":false,"balance":null},"individual_limit":null,"plan_type":"team","rate_limit_reached_type":null}}}';

/**
 * A HEALTHY line carrying `has_credits: false` — both windows at 0%, a null reached type, and a turn that
 * went on to produce 510 output tokens.
 *
 * The line a Codex review produced to break the classifier a second time: reading `has_credits === false` as
 * exhaustion called this — and 1,010 others on this machine — `credits-out` while nothing was exhausted.
 * Real depletion is named outright, by {@link REAL_CREDITS_DEPLETED_LINE}'s reached type. Reproduce the
 * count, and see that every such line carries the identical null-balance credits object:
 *
 * ```bash
 * grep -rh '"has_credits":false' "${CODEX_HOME:-$HOME/.codex}/sessions" | grep -c 'rate_limit_reached_type":null'
 * grep -rho '"credits":{[^}]*}' "${CODEX_HOME:-$HOME/.codex}/sessions" | sort | uniq -c | sort -rn | head
 * ```
 */
export const REAL_HEALTHY_NO_CREDITS_LINE =
  '{"timestamp":"2026-09-02T02:35:32.040Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":24238,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":510,"reasoning_output_tokens":293,"total_tokens":24748},"last_token_usage":{"input_tokens":24238,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":510,"reasoning_output_tokens":293,"total_tokens":24748},"model_context_window":258400},"rate_limits":{"limit_id":"codex","limit_name":null,"primary":{"used_percent":0.0,"window_minutes":300,"resets_at":1788334518},"secondary":{"used_percent":0.0,"window_minutes":10080,"resets_at":1788921318},"credits":{"has_credits":false,"unlimited":false,"balance":null},"individual_limit":null,"spend_control_reached":null,"plan_type":"team","rate_limit_reached_type":null}}}';

/**
 * A real `task_complete` error for a SPEND CAP — `codex_error_info: usage_limit_exceeded`, wording that names
 * the workspace's spend cap.
 *
 * The counterexample a Codex review used against reading the error CODE alone: this line and the
 * `token_count` immediately before it describe one failure, and classifying the code as credits depletion
 * made the two disagree. The message is what separates them, and the split is exact:
 *
 * ```bash
 * grep -rh 'usage_limit_exceeded' "${CODEX_HOME:-$HOME/.codex}/sessions" | grep -o '"message":"[^"]*"' | sort | uniq -c
 * ```
 *
 * 85 spend-cap messages against 8 out-of-credits ones — the same 85 / 8 as the two reached types.
 */
export const REAL_SPEND_CAP_TASK_COMPLETE_LINE =
  '{"timestamp":"2026-09-11T07:31:24.321Z","ordinal":121,"type":"event_msg","payload":{"type":"task_complete","turn_id":"a0000068-0000-4000-8000-000000000074","last_agent_message":null,"error":{"message":"You hit your spend cap set by the owner of your workspace. Ask an owner to increase your spend cap to continue.","codex_error_info":"usage_limit_exceeded"},"started_at":1789111732,"completed_at":1789111884,"duration_ms":152005,"time_to_first_token_ms":16152}}';

/**
 * A real `task_complete` error for genuine CREDIT DEPLETION — the same `usage_limit_exceeded` code, different
 * wording, from the same incident.
 *
 * The pair to {@link REAL_SPEND_CAP_TASK_COMPLETE_LINE}: one code, two exhaustions, told apart by the message
 * `./quotaBanner.ts` captured against a real exhausted account.
 */
export const REAL_CREDITS_TASK_COMPLETE_LINE =
  '{"timestamp":"2026-08-14T04:41:50.289Z","type":"event_msg","payload":{"type":"task_complete","turn_id":"a0000067-0000-4000-8000-000000000073","last_agent_message":null,"error":{"message":"Your workspace is out of credits. Ask your workspace owner to refill in order to continue.","codex_error_info":"usage_limit_exceeded"},"started_at":1786682499,"completed_at":1786682510,"duration_ms":10881}}';

/**
 * REAL (ambient home rollout file): the ONLY `token_count` a capped account
 * writes. No window and no reached type — it says nothing about the budget, and before `pickGauge` it masked
 * the weekly reading at 100% sitting one file further back. Token counts trimmed; `rate_limits` verbatim.
 */
export const REAL_POST_CAP_PREMIUM_EMPTY_LINE =
  '{"timestamp":"2026-09-22T21:31:50.600Z","type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":{"limit_id":"premium","limit_name":null,"primary":null,"secondary":null,"credits":{"has_credits":false,"unlimited":false,"balance":"0"},"individual_limit":null,"spend_control_reached":null,"plan_type":null,"rate_limit_reached_type":null}}}';
