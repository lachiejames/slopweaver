/**
 * The command-token helpers every raw-command guard resolves a tool and a `git` subcommand through: strip an
 * `env`/`VAR=VAL` prefix, reduce a tool path to its basename, and skip `git`'s global flags (`git -C <dir> push`,
 * `git --git-dir=… push`) so the subcommand behind them is found. Pure and dependency-free, so `./rawTools.ts`'s
 * classifier and every guard beside it share one tokenizer without importing the classifier.
 */

/** `git` global flags (before the subcommand) that CONSUME the next token as their value. */
const GIT_VALUE_GLOBALS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--super-prefix",
]);

/**
 * Strip a leading `env …`/`VAR=VAL …` prefix so `env X=1 git push` / `FOO=bar gh pr close` still resolve.
 *
 * @param tokens the whitespace-split command tokens
 * @returns the tokens with any leading env prefix removed
 */
export function stripEnvPrefix({ tokens }: { tokens: readonly string[] }): readonly string[] {
  let i = 0;
  if (tokens[i] === "env") {
    i += 1;
    while (i < tokens.length) {
      const token = tokens[i]!; // i < tokens.length ⇒ in-bounds
      if (token === "-i" || token === "--ignore-environment") {
        i += 1;
      } else if (token === "-u" || token === "--unset") {
        i += 2; // consumes the NAME to unset
      } else if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
        i += 1;
      } else {
        break;
      }
    }
    return tokens.slice(i);
  }
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]!)) {
    i += 1;
  }
  return tokens.slice(i);
}

/**
 * The basename of the tool token (`/usr/bin/gh` ⇒ `gh`). A split always yields ≥1 element, so `pop()` is safe.
 *
 * @param first the command's first whitespace-split token
 * @returns its basename
 */
export function toolName({ first }: { first: string }): string {
  return first.split("/").pop()!;
}

/**
 * Resolve `git`'s subcommand + its flags, skipping global flags (and their values).
 *
 * @param tokens the whitespace-split command tokens, `git` itself included at index 0
 * @returns the subcommand (`undefined` when only global flags were given), globals before it, and flags after it
 */
export function gitSubcommand({ tokens }: { tokens: readonly string[] }): {
  sub: string | undefined;
  flags: readonly string[];
  globals: readonly string[];
} {
  let i = 1;
  while (i < tokens.length) {
    const token = tokens[i]!; // i < tokens.length ⇒ in-bounds
    if (token.startsWith("-")) {
      i += GIT_VALUE_GLOBALS.has(token) ? 2 : 1; // a value-global (spaced form) also eats the next token
      continue;
    }
    return { flags: tokens.slice(i + 1), globals: tokens.slice(1, i), sub: token };
  }
  return { flags: [], globals: tokens.slice(1), sub: undefined };
}
