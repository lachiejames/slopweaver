/**
 * The provider's content-policy refusal, told apart from every other way a Codex turn can fail.
 *
 * OpenAI ends a turn with `"This content was flagged for possible cybersecurity risk. If this seems wrong, try
 * rephrasing your request. To get authorized for security work, join the Trusted Access for Cyber program:
 * https://chatgpt.com/cyber"` beside `codex_error_info: "cyber_policy"` in the rollout's `task_complete.error`.
 * The SDK hands a pass only the sentence, so the sentence is what is matched. Before this module a refused
 * review recorded as the same `FATAL` as a dropped network, and the only fallback open to it was the uncapped
 * hatch, whose receipt then said "no fleet-wide cap was read" — the class was on disk and invisible.
 *
 * MEASURED, and the measurement is the design. It is REVIEW-only: 31 pass records over two weeks,
 * every one `mode: "review"`, none a plan. It is NOT deterministic per request: six identical (diff, pass,
 * property) triples were both refused and answered, which is why one retry earns its place and a second does
 * not. And it fires MID-TURN, after minutes of reading, not on the opening prompt. Reproduce:
 *
 * ```bash
 * grep -l 'flagged for possible cybersecurity' "$SLOPWEAVER_HOME"/orchestration/*\/record.json | wc -l
 * ```
 *
 * Classified at READ time from the recorded words, never written as a new field, so every record written
 * before this module existed counts exactly as one written after it.
 */

import { isRecord } from "#lib/parsers.js";

/** Which content-policy refusal a turn ended on. One member today; the union is the place a second goes. */
export type CodexPolicyRefusal = "cyber-policy";

/**
 * The captured sentence's whole first clause, exactly as OpenAI writes it. The advice and program URL after it
 * are wording that may move; a shorter fragment would match a model merely QUOTING the refusal in its prose.
 */
const CYBER_POLICY_PATTERN = /This content was flagged for possible cybersecurity risk\./;

/**
 * Classify the words a failed turn left behind.
 *
 * @param text the stream's reported failure, or the thrown message when the stream reported none
 * @returns the refusal the words name, or null when they name none
 */
export function detectPolicyRefusal({ text }: { text: string }): CodexPolicyRefusal | null {
  return CYBER_POLICY_PATTERN.test(text) ? "cyber-policy" : null;
}

/**
 * The refusal a recorded transport cause names, read defensively.
 *
 * Takes `unknown` for the reason `./transportCause.ts`'s `transportFaultQuota` does: a pass record is
 * shallow-decoded from disk, so an old record has no cause and a hand-edited one may carry a malformed one.
 * The stream's report is asked first and the thrown message second — the same order the cause line prints in.
 *
 * @param cause the recorded cause, as read
 * @returns the refusal, or null when the cause names none or cannot be read
 */
export function transportFaultRefusal({ cause }: { cause: unknown }): CodexPolicyRefusal | null {
  if (!isRecord(cause)) {
    return null;
  }
  for (const field of ["reported", "thrown"] as const) {
    const text = cause[field];
    const refusal = typeof text === "string" ? detectPolicyRefusal({ text }) : null;
    if (refusal !== null) {
      return refusal;
    }
  }
  return null;
}
