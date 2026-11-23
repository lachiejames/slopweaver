/**
 * Which plan pays for a Talk call, said the way `talk offer` refuses when none may.
 *
 * One plan of either provider runs all of Slopweaver, and every Claude steer applies to Codex too — so the voice
 * spends a REGISTER row, routed by the same decision a Codex seat takes (`../codex/seatDecision.ts`), and honours that
 * row's pause and usage limit with no override. A call riding whatever ChatGPT login the ambient `$CODEX_HOME` held
 * would let a row the owner had paused or capped still pay.
 *
 * An install with no Codex row gets no voice: the voice speaks through a ChatGPT plan, and AGENTS.md admits no
 * other model egress for it, so whether such an install gets one is the owner's call rather than a fallback this
 * module could choose; the refusal says so in one line instead of launching on the ambient home.
 */

import type { CodexSeatError } from "../codex/seatDecisionErrors.js";

/** The line a Claude-only install gets — the register carries no Codex row for the voice to spend. */
export const TALK_NEEDS_CHATGPT_PLAN =
  "the voice runs on a ChatGPT plan and this install registers none: `slopweaver plans add --provider codex` " +
  "names one, and the sign-in is the owner's own terminal";

/**
 * The sentence `talk offer` refuses with when no register row may pay for the call.
 *
 * @param error why the shared Codex decision would not route a row
 * @returns the refusal, after `talk offer: `
 */
export function talkPlanRefusal({ error }: { error: CodexSeatError }): string {
  if (error.code === "UNROUTED" && error.route.code === "NO_CODEX_DESTINATION") {
    return `refusing — ${TALK_NEEDS_CHATGPT_PLAN}`;
  }
  return error.message;
}
