/**
 * Claude Code's OWN `matcher` semantics, reimplemented once so a folded check applies to exactly the calls
 * its `hooks.json` entry used to be handed.
 *
 * Folding ten entries into one moved matching from the harness into this repository, and a matcher is only
 * "the same" if it is evaluated the same way. It is NOT a plain regex, and assuming it was is how the fold
 * silently widens a guard: the harness picks one of three modes from the CHARACTERS in the string
 * (https://code.claude.com/docs/en/hooks § Matcher patterns).
 *
 * - `"*"`, `""` or absent — match every call.
 * - Only letters, digits, `_`, `-`, spaces, `,` and `|` — an EXACT name, or a list of exact names separated
 *   by `|` or `,`. So `Edit|Write` matches `Edit` and `Write` and NOT `TodoWrite`, and `Agent|Task` does not
 *   match `TaskOutput`.
 * - Anything else — a JavaScript regular expression, tested UNANCHORED. `mcp__claude-in-chrome__.*` is this
 *   mode; so is `^Notebook`.
 *
 * The middle case is the one that matters here and the one a reader assumes away: seven of the ten folded
 * matchers are exact lists, and reading them as regexes hands `admit` every `BashOutput` call, the memory
 * gate every `TodoWrite`, and the sub-agent ban every `TaskOutput`. Each of those guards happens to re-check
 * the tool name itself and stay inert, so the damage would have been wasted work rather than a wrong
 * refusal — which is exactly why it would not have shown up in a test of any single guard.
 */

/** The characters that keep a matcher on the EXACT-list path. Any other character makes it a regex. */
const EXACT_MATCHER_CHARS = /^[A-Za-z0-9_\-, |]+$/u;

/**
 * Whether one `hooks.json` matcher selects a tool call naming this tool, by the harness's own rules.
 *
 * @param matcher the matcher string, exactly as `hooks.json` spells it
 * @param toolName the payload's `tool_name`
 * @returns whether the entry would have run for this call
 */
export function hookMatcherSelects({ matcher, toolName }: { matcher: string; toolName: string }): boolean {
  if (matcher === "" || matcher === "*") {
    return true;
  }
  if (EXACT_MATCHER_CHARS.test(matcher)) {
    return matcher
      .split(/[|,]/u)
      .map((name) => name.trim())
      .includes(toolName);
  }
  return new RegExp(matcher, "u").test(toolName);
}
