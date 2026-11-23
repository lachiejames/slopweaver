/**
 * How `prettier` and `knip` read their own words, for `./wholeTreeCheck.ts`: whether a run is a whole-tree
 * check CI's `lint` job already makes, or local work. Neither builds the type checker; each is refused for
 * its own measured cost — the prettier gate is 76.6s and 8,066 MB of the lap, and knip resolves the whole
 * project on every run (`src/devLint/gateGroups.ts`). Pure: words in, a verdict out.
 *
 * A value flag missing from `PRETTIER_VALUE_FLAGS` turns its value into a path operand, which costs a false
 * refusal, never a bypass.
 */

import type { ShellWord } from "./shellLexing.js";

/** `prettier` flags that consume the following word (`prettier --help`, prettier 3), so it is never a path. */
const PRETTIER_VALUE_FLAGS: ReadonlySet<string> = new Set(
  [
    "--arrow-parens",
    "--embedded-language-formatting",
    "--end-of-line",
    "--experimental-operator-position",
    "--html-whitespace-sensitivity",
    "--object-wrap",
    "--parser",
    "--print-width",
    "--prose-wrap",
    "--quote-props",
    "--tab-width",
    "--trailing-comma",
  ].concat([
    "--config",
    "--config-precedence",
    "--ignore-path",
    "--plugin",
    "--cursor-offset",
    "--range-end",
    "--range-start",
    "--cache-location",
    "--cache-strategy",
    "--log-level",
    "--parallel-workers",
  ]),
);

/** `prettier` flags that print and exit, or read one file from stdin, before any tree is walked. */
const PRETTIER_LOCAL_FLAGS: ReadonlySet<string> = new Set([
  "-h",
  "--help",
  "-v",
  "--version",
  "--support-info",
  "--find-config-path",
  "--file-info",
  "--stdin-filepath",
]);

/**
 * `prettier`'s write mode. Its subject is the working tree, which CI cannot rewrite, so it stays local at
 * any width: `yarn format` ends in `prettier --write .`, after Biome's import pass, and is the documented
 * formatter (AGENTS.md § Toolchain).
 */
const PRETTIER_WRITE_FLAGS: ReadonlySet<string> = new Set(["-w", "--write"]);

/** `knip` flags that print and exit before the project is resolved. */
const KNIP_PRINT_ONLY: ReadonlySet<string> = new Set(["-h", "--help", "-V", "--version"]);

/**
 * One file: a last path segment ending in an extension Prettier formats, and no `*` anywhere. A bracket is a
 * literal in a Next.js route file (`site/app/api/act/[verb]/route.ts`), exactly as `./tscInvocation.ts`'s
 * `SOURCE_FILE` reads it; the extension list keeps a dotted directory (`.claude/worktrees.noindex`) a directory,
 * and carries `.har`, the Polly cassettes Prettier parses as JSON (`yarn prettier --file-info <one>.har`).
 * A dotfile with no extension (`.prettierrc`) reads as one too, and costs a false refusal.
 */
const ONE_FILE =
  /^[^*]*[^/]\.(?:[cm]?[jt]sx?|jsonc?|json5|har|md|mdx|ya?ml|css|scss|less|html?|vue|graphql|gql|hbs|handlebars)$/u;

/**
 * `find -exec`'s placeholder, which it replaces with the files it found — a list computed at run time — and the
 * `+` or `;` that closes it.
 */
const FIND_EXEC_WORDS: ReadonlySet<string> = new Set(["{}", "+", ";"]);

/**
 * What a `prettier` run covers: `local` when it writes, prints, reads stdin, names no operand, or every operand
 * is one file or a list computed at run time; otherwise `whole`, naming what it was pointed at.
 *
 * @param args the words after `prettier`
 * @returns `local`, or `whole` with the operands it would check
 */
export function prettierScope({
  args,
}: {
  args: readonly ShellWord[];
}): { kind: "local" } | { kind: "whole"; over: string } {
  const end = args.findIndex((word) => word.text === "--");
  const options = end === -1 ? args : args.slice(0, end);
  const positional = end === -1 ? [] : args.slice(end + 1);
  const names = options.map((word) => flagName({ text: word.text }));
  // After `--` a write flag is a path, so `prettier --check -- --write .` checks the tree. `npx prettier --
  // --write .`, whose `--` npm drops, is refused with it: a false refusal, never a bypass.
  if (names.some((name) => PRETTIER_WRITE_FLAGS.has(name) || PRETTIER_LOCAL_FLAGS.has(name))) {
    return { kind: "local" };
  }
  const operands = [...pathOperands({ args: options }), ...positional];
  const computed = (operand: ShellWord): boolean => operand.dynamic || FIND_EXEC_WORDS.has(operand.text);
  if (operands.every((operand) => computed(operand) || ONE_FILE.test(operand.text))) {
    return { kind: "local" };
  }
  return { kind: "whole", over: operands.map((operand) => operand.text).join(" ") };
}

/**
 * What a `knip` run covers: every run resolves the whole project, so only one that prints is `local`.
 *
 * @param args the words after `knip`
 * @returns `local` for a help or version run, otherwise `whole`
 */
export function knipScope({ args }: { args: readonly ShellWord[] }): "local" | "whole" {
  return args.some((word) => KNIP_PRINT_ONLY.has(word.text)) ? "local" : "whole";
}

/** A flag's name without an attached `=value`. */
function flagName({ text }: { text: string }): string {
  const equals = text.indexOf("=");
  return text.startsWith("-") && equals !== -1 ? text.slice(0, equals) : text;
}

/**
 * The path operands of a `prettier` tail: every word that is neither a flag nor a spaced flag's value.
 *
 * @param args the words before any `--`
 * @returns the operands in order
 */
function pathOperands({ args }: { args: readonly ShellWord[] }): readonly ShellWord[] {
  const operands: ShellWord[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index]!;
    if (PRETTIER_VALUE_FLAGS.has(word.text)) {
      index += 1;
    } else if (!word.text.startsWith("-")) {
      operands.push(word);
    }
  }
  return operands;
}
