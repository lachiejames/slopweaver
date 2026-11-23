/**
 * What one command's own `NAME=value` / `env` prefix does to an override variable — the half of
 * `./shellSegments.ts`'s hatch resolver that reads a single command, before the export walk across segments.
 * Its own leaf so `./shellSegments.ts` stays under the file-size ratchet.
 */

/** A shell variable assignment word: a name, then `=`. */
export const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** What one command's own prefix does to a variable: nothing, arm it, or clear it. */
export type LocalOverride = "inherit" | "allow" | "clear";

/** The resolver's state as it walks the prefix words. */
type PrefixState = { value: LocalOverride; inEnv: boolean; opaque: boolean };

// `env`'s bare `-` is a third spelling of `-i`, and is deliberately ABSENT: the parser this replaced stopped
// at it, so recognising it would newly ARM the hatch for `env - NAME=1 cmd` — a widening a Codex review
// caught. Resolution stops there instead, which is what the base did.
/** `env` options that empty the environment a command receives. */
const ENV_CLEARING = new Set(["-i", "--ignore-environment"]);

/** `env` options that unset the one variable named after them. */
const ENV_UNSET = new Set(["-u", "--unset"]);

/** A character that can carry a word across whitespace: a quote, an escape, a substitution or an array. */
const SPANNING = /["'\\`$(]/;

/** How many words `env` itself or one of its options consumes at `tokens[index]`, 0 when it is neither. */
function envWordWidth({
  tokens,
  index,
  name,
  state,
}: {
  tokens: readonly string[];
  index: number;
  name: string;
  state: PrefixState;
}): number {
  const token = tokens[index]!;
  // `env` counts only as the FIRST word, exactly as the parser this replaced did. Recognising it after an
  // assignment (`FOO=bar env NAME=1 cmd`) would newly ARM the raw hatch for existing callers, which a Codex
  // review caught: this resolver may only ever narrow what they accept.
  if (token === "env" && index === 0) {
    state.inEnv = true;
    return 1;
  }
  if (state.inEnv && ENV_CLEARING.has(token)) {
    state.value = "clear";
    return 1;
  }
  if (state.inEnv && ENV_UNSET.has(token)) {
    if (tokens[index + 1] === name) state.value = "clear";
    return 2;
  }
  return 0;
}

/**
 * How many prefix words start at `tokens[index]`, applying each to `state` — 0 once the command word is reached.
 *
 * @returns the width consumed, or 0 at the command word
 */
function prefixWordWidth({
  tokens,
  index,
  name,
  state,
}: {
  tokens: readonly string[];
  index: number;
  name: string;
  state: PrefixState;
}): number {
  const token = tokens[index]!;
  let width = envWordWidth({ index, name, state, tokens });
  if (width === 0 && ASSIGNMENT.test(token)) {
    if (token.startsWith(`${name}=`)) state.value = token === `${name}=1` && !state.opaque ? "allow" : "clear";
    width = 1;
  }
  // A whitespace split cannot see where a quoted, escaped or substituted word ends, so once one appears every
  // later token may be its text rather than a word of its own: `FOO="x NAME=1 BAR=y" cmd` sets only FOO. From there on a `NAME=1` clears instead of arming, which only ever narrows.
  if (width > 0 && SPANNING.test(token)) state.opaque = true;
  return width;
}

/**
 * What one command's own `NAME=value` / `env` prefix does to `name`, in shell order: the LAST assignment wins,
 * and `env -u NAME` and `env -i` clear it. Only the exact token `NAME=1` arms it — a quoted `NAME="1"` is read
 * as some OTHER value and clears, deliberately: a Codex review measured that decoding it would newly ARM the
 * raw hatch for every existing caller, and this change may only ever narrow what they accept. A prefix with no
 * command after it is a bare assignment, which scopes nothing to a later command, so it inherits.
 *
 * This is not a boolean ORed with the export walk, which would read `NAME=1 NAME=0 cmd`,
 * `export NAME=1; NAME=0 cmd` and `export NAME=1; env -u NAME cmd` all as armed.
 *
 * @param command one segment's own command text
 * @param name the environment variable whose exact value must be `1`
 * @returns `allow` when the prefix arms it, `clear` when it sets or unsets it otherwise, `inherit` when untouched
 */
export function localOverride({ command, name }: { command: string; name: string }): LocalOverride {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  const state: PrefixState = { inEnv: false, opaque: false, value: "inherit" };
  let index = 0;
  while (index < tokens.length) {
    const width = prefixWordWidth({ index, name, state, tokens });
    if (width === 0) break;
    index += width;
  }
  return index < tokens.length ? state.value : "inherit";
}
