/**
 * How the static cwd resolver (`./mainCheckoutCommandTarget.ts`) reads one `cd` segment's own words: which of them is
 * the directory operand, which are redirections the shell opens before the `cd` runs, and how a leading `$PWD` reads.
 */

/** A redirection word, `>f`, `2>>f`, `&>f`, or an operator alone (`>`, `2>`) whose target is the next word. */
const REDIRECT = /^(?:\d+|&)?(?:>>|>\||<>|<<<?|[<>])/u;

/** A leading `$PWD`, braced or not, possibly opening a double-quoted word. */
const LEADING_PWD = /^("?)\$(?:\{PWD\}|PWD(?![A-Za-z0-9_]))/u;

/**
 * Where a `cd`'s directory operand sits: past its own options (`-L`, `-P`, `-e`, `-@`), which never change which
 * directory it names (`cd -P <dir>`), and a `--`.
 *
 * @param tokens the segment's words, `cd` first
 * @returns the index of the operand, equal to the word count when there is none
 */
export function cdOperandIndex({ tokens }: { tokens: readonly string[] }): number {
  let offset = 1;
  while (offset < tokens.length && /^-[LPe@]+$/u.test(tokens[offset]!)) {
    offset += 1;
  }
  return tokens[offset] === "--" ? offset + 1 : offset;
}

/**
 * A `cd`'s words with its redirections taken out, and whether it had any. The shell opens a redirection where it
 * stands BEFORE the `cd` runs, so `cd >call-index.txt` truncates the file the `cd` leaves, and the words
 * left are the `cd`'s own.
 *
 * @param tokens the segment's words, `cd` first
 * @returns the words bar every redirection and its target, and whether one was there
 */
export function cdWords({ tokens }: { tokens: readonly string[] }): {
  operands: readonly string[];
  redirects: boolean;
} {
  const operands: string[] = [];
  let redirects = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (index === 0 || !REDIRECT.test(token)) {
      operands.push(token);
      continue;
    }
    redirects = true;
    if (token.replace(REDIRECT, "").length === 0) {
      index += 1;
    }
  }
  return { operands, redirects };
}

/**
 * A word with a leading `$PWD` written as the directory the shell stands in (`git -C "$PWD" reset --hard`).
 *
 * @param token the word as written, quotes included
 * @param cwd the directory the shell stands in when the word is read
 * @returns the word with that directory in place of the variable, unchanged when it opens on none
 */
export function withPwd({ token, cwd }: { token: string; cwd: string }): string {
  return token.replace(LEADING_PWD, (_match, quote: string) => `${quote}${cwd}`);
}
