/**
 * Detect Claude Code's own usage-limit retry banner in already-captured terminal text — the backstop behind
 * the pre-spawn gate (`./spawnStore.ts`), for the case where a plan reads healthy at boot and hits its wall
 * on the very first request anyway.
 *
 * There is no exit code, no status file and no machine-readable signal for this state: the process stays
 * ALIVE and the harness reports it busy. MEASURED, and it is why the screen is what gets read —
 * two bot workers sat for hours with `ListAgents` calling them busy, zero tool calls, and their card reading
 * stale, while `cmux read-screen` showed the whole story on one line.
 *
 * The pattern is the captured text, not a guessed one. Both workers rendered, byte for byte:
 *
 * ```
 * ✻ Weekly limit reached · Retrying in 5h (<reset day> at <reset hour>) · attempt 1/300
 * ```
 *
 * Two properties of the matcher are deliberate rather than incidental:
 *
 * - **`limit reached` and `Retrying in` must be on the SAME line**, in that order. The screen this is read
 *   from also carries the pickup command that was just typed into it, so matching `limit reached` alone would
 *   refuse any ask whose own question mentions one. The retry chrome is what makes the line the spinner's
 *   rather than the prompt's.
 * - **The window is not named**, so `Weekly limit reached`, `5-hour limit reached` and an Opus- or
 *   Fable-specific wording all match. Which window it is changes only how long the wall lasts; it never
 *   changes the verdict, which is that this session cannot answer.
 *
 * An ABSENT banner is not proof of health, only the bound the caller was willing to spend finding out — the
 * same honesty `codex/quotaBanner.ts` states about its own.
 */

/**
 * `limit reached` followed by the retry chrome on one line, with a bounded gap so the two cannot be matched
 * across unrelated text. The gap excludes newlines rather than being greedy, so the bound is a real one.
 */
const LIMIT_RETRY_PATTERN = /[^\n]*\blimit reached\b[^\n]{0,80}?\bretrying in\b[^\n]*/i;

/**
 * Scan already-captured terminal text for Claude Code's usage-limit retry banner.
 *
 * @param text the terminal screen text to scan
 * @returns the matched banner line, trimmed, or undefined when the text shows no such banner
 */
export function detectLimitRetryBanner({ text }: { text: string }): string | undefined {
  const matched = LIMIT_RETRY_PATTERN.exec(text);
  return matched === null ? undefined : matched[0].trim();
}
