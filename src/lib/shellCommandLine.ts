import { UNPRINTABLE } from "#lib/oneLineSummary.js";

/**
 * Render one argv as a shell command line a reader can paste and run.
 *
 * A capability's command is an ARRAY, and printing it with `join(" ")` is only lossless while every token
 * happens to be shell-safe. Review measured what that costs: a brief asked "What's the
 * history?" printed `ask --store What's the history? --home /tmp/home-b`, whose apostrophe opens a quote that
 * never closes — `bash -n` exits 2 and `zsh -n` exits 1, so the command a turn was told to run cannot
 * launch at all. An ordinary question with an apostrophe is not an edge case.
 *
 * Single quotes, because they are the only POSIX quoting that is literal throughout; an embedded `'` is
 * closed, escaped and reopened (`'\\''`), which is the standard idiom rather than anything clever. A token
 * of only safe characters is left bare, so the common line stays readable. A token holding a control character — a
 * newline in a path is legal — takes bash and zsh's ANSI-C quoting (`$'…'`) instead, every control character written
 * as an escape, so the printed command stays ONE line and a reader pasting that line into bash or zsh gets the token
 * back exactly. A shell without that quoting, dash for one, reads such a token as a literal `$` and its escapes: the
 * one line is chosen over that shell, and only a token holding a control character pays it. Every control is written
 * as its UTF-8 bytes (`\xHH`), so the bash 3.2 macOS ships and zsh in any locale both read it back.
 */
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** The escape ANSI-C quoting gives each character it must not carry literally. */
const ANSI_C_ESCAPES: ReadonlyMap<string, string> = new Map([
  ["\\", "\\\\"],
  ["'", "\\'"],
  ["\n", "\\n"],
  ["\r", "\\r"],
  ["\t", "\\t"],
]);

/**
 * Whether a character is one no printed line may carry raw: Unicode general category Cc, Cf, Zl or Zp
 * (`UNPRINTABLE`) — controls, format characters such as a bidi override, and the line and paragraph separators.
 */
function isControl({ character }: { character: string }): boolean {
  return UNPRINTABLE.test(character);
}

/**
 * One character as it must appear inside `$'…'`: a control as each byte of its UTF-8 (`\xHH`), which every shell with
 * that quoting reads in any locale — a C1 control's `\uHHHH` would need bash 4.2 and, in zsh, a UTF-8 locale.
 */
function ansiCEscaped({ character }: { character: string }): string {
  const named = ANSI_C_ESCAPES.get(character);
  if (named !== undefined) {
    return named;
  }
  if (!isControl({ character })) {
    return character;
  }
  return [...Buffer.from(character, "utf8")].map((byte) => `\\x${byte.toString(16).padStart(2, "0")}`).join("");
}

/**
 * Quote one argv token for a shell, leaving an already-safe token bare.
 *
 * @param token the argv element
 * @returns the token as it must appear on a command line
 * @internal exported for the unit test that asserts the quoting, not for callers — use {@link shellCommandLine}
 */
export function shellQuoteToken({ token }: { token: string }): string {
  if (token.length > 0 && SHELL_SAFE.test(token)) {
    return token;
  }
  // Code point by code point: every control is one code point, so a character outside the BMP is copied whole.
  let escaped = "";
  let controlled = false;
  for (const character of token) {
    if (isControl({ character })) {
      controlled = true;
    }
    escaped += ansiCEscaped({ character });
  }
  if (controlled) {
    return `$'${escaped}'`;
  }
  return `'${token.replaceAll("'", `'\\''`)}'`;
}

/**
 * Render an argv as a runnable shell command line.
 *
 * @param command the argv to print
 * @returns one line, each token quoted only where it needs to be
 */
export function shellCommandLine({ command }: { command: readonly string[] }): string {
  return command.map((token) => shellQuoteToken({ token })).join(" ");
}
