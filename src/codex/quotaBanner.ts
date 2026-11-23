/**
 * Detect Codex's own known usage-exhaustion banners in already-captured terminal text.
 *
 * There is no distinct exit code or machine-readable status command for either exhaustion kind — checked
 * live against Codex CLI v0.145.0: `codex doctor --json` reports auth/config/network health but
 * no usage/rate-limit/quota check, and no top-level subcommand surfaces one either. Banner text on the
 * booted surface is what `cmux read-screen` actually sees, so it is the signal this module matches — not a
 * fallback chosen for lack of trying the alternative.
 *
 * Both patterns were captured against REAL exhaustion, not guessed:
 *  - credits-out: `codex exec` reproduced `"Your workspace is out of credits. Ask your workspace owner to
 *    refill in order to continue."` verbatim while this machine's account was live-exhausted (confirmed via
 *    the same session's own rollout log carrying `codex_error_info: "usage_limit_exceeded"`).
 *  - weekly-limit: the doc this module implements quotes a live `Weekly limit: [...] 0% left` status bar.
 *    That bar renders at every percentage as ordinary chrome — a HEALTHY session shows it too — so only
 *    N === 0 is exhaustion; matching the bar's mere presence would refuse every codex spawn.
 */
import type { CodexQuotaKind } from "./quotaTypes.js";

const CREDITS_OUT_PATTERN = /workspace is out of credits/i;

/**
 * The workspace SPEND CAP, which is not an empty balance.
 *
 * Separate from {@link CREDITS_OUT_PATTERN} because the two are different exhaustions and Codex says so
 * itself: on this machine's rollouts the spend-cap sentence sits beside
 * `rate_limit_reached_type: "workspace_member_usage_limit_reached"` on all 85 of its events, and the
 * out-of-credits sentence beside `workspace_member_credits_depleted` on all 8 — one `codex_error_info` code,
 * two exhaustions, told apart only by the wording. Reproduce:
 *
 * ```bash
 * grep -rh 'usage_limit_exceeded' "${CODEX_HOME:-$HOME/.codex}/sessions" | grep -o '"message":"[^"]*"' | sort | uniq -c
 * ```
 *
 * They behaved identically before this split — neither self-clears on a clock — so nothing downstream
 * changes except the label, which now matches what Codex's own reached type calls it.
 */
const SPEND_CAP_PATTERN = /hit your spend cap/i;

// The middle class deliberately excludes digits so it can never overlap with the `\d+` group that follows —
// two adjacent quantifiers matching the same characters is what makes a regex engine backtrack exponentially
// on non-matching input.
const WEEKLY_LIMIT_PATTERN = /Weekly limit:[^\d\n]*(\d+)%\s*left/i;

/**
 * Scan already-captured terminal text for a known Codex exhaustion banner.
 *
 * @param text the terminal screen text to scan
 * @returns the exhaustion kind the text shows, or undefined when neither known banner reads as exhausted
 */
export function detectExhaustionBanner({ text }: { text: string }): CodexQuotaKind | undefined {
  if (CREDITS_OUT_PATTERN.test(text)) {
    return "credits-out";
  }
  if (SPEND_CAP_PATTERN.test(text)) {
    return "usage-limit";
  }
  const weeklyMatch = WEEKLY_LIMIT_PATTERN.exec(text);
  if (weeklyMatch?.[1] != null && Number(weeklyMatch[1]) === 0) {
    return "window-limit";
  }
  return undefined;
}
