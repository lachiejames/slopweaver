/**
 * How `oxlint` and `tsgolint` read their own words, for `./wholeTreeCheck.ts`: whether a run prints, builds no
 * type checker, is handed source files, or type-checks a whole tree. A flag missing from `OXLINT_VALUE_FLAGS`
 * turns its value into a path operand, which costs a false refusal, never a bypass.
 */

import type { ShellWord } from "./shellLexing.js";
import { SOURCE_FILE } from "./tscInvocation.js";

/** `oxlint` flags that consume the following word, so it is a value and never a path operand. */
const OXLINT_VALUE_FLAGS = new Set(
  ["--tsconfig", "-c", "--config", "-f", "--format", "--ignore-path", "--ignore-pattern", "--max-warnings"].concat([
    "--threads",
    "-A",
    "--allow",
    "-D",
    "--deny",
    "-W",
    "--warn",
    "--plugin",
    "--rules",
    "--debug",
  ]),
);

/**
 * `oxlint` modes that build the type checker: `--type-aware` spawns `tsgolint`, and `--type-check` (oxlint 1.81,
 * `oxlint --help`) adds TypeScript's own compiler diagnostics.
 */
const OXLINT_TYPE_MODES: readonly string[] = ["--type-aware", "--type-check"];

/** `oxlint`/`tsgolint` flags that print and exit before any file is linted. */
const OXLINT_PRINT_ONLY: readonly string[] = ["--help", "-h", "--version", "-V", "--print-config", "--init", "--rules"];

/**
 * What a type-aware lint run covers: `local` when it prints, never builds the checker (`oxlint` without a type
 * mode), or every path operand is one source file or a list computed at run time; otherwise `whole`, naming
 * what it was pointed at.
 *
 * @param args the words after the program
 * @param program `oxlint` or `tsgolint`
 * @returns `local`, or `whole` with the operands it would type-check
 */
export function typeAwareLintScope({
  args,
  program,
}: {
  args: readonly ShellWord[];
  program: string;
}): { kind: "local" } | { kind: "whole"; over: string } {
  // After `--` every word is a path, so `oxlint --type-aware -- . --help` lints `.`.
  const end = args.findIndex((word) => word.text === "--");
  const options = end === -1 ? args : args.slice(0, end);
  const positional = end === -1 ? [] : args.slice(end + 1);
  const texts = new Set(options.map((word) => word.text));
  // `--debug files` is the spaced spelling of `--debug=files`, which prints the file list.
  const debugFiles = options.some((word, at) => debugModes({ next: options[at + 1], word }).includes("files"));
  if (debugFiles || OXLINT_PRINT_ONLY.some((flag) => texts.has(flag))) {
    return { kind: "local" };
  }
  if (program === "oxlint" && !OXLINT_TYPE_MODES.some((flag) => texts.has(flag))) {
    return { kind: "local" };
  }
  const operands = [...pathOperands({ args: options }), ...positional];
  if (operands.length > 0 && operands.every((operand) => operand.dynamic || SOURCE_FILE.test(operand.text))) {
    return { kind: "local" };
  }
  const over = operands.length === 0 ? "the whole tree" : operands.map((operand) => operand.text).join(" ");
  return { kind: "whole", over };
}

/**
 * The modes an `oxlint --debug` option names, a comma list attached or spaced: `files` among them prints the
 * selected files and exits (`oxlint --help`; e.g. `--debug files,timings`).
 *
 * @param word one word of the tail
 * @param next the word after it, the value of a spaced `--debug`
 * @returns the modes it names, none when it is not `--debug`
 */
function debugModes({ next, word }: { next: ShellWord | undefined; word: ShellWord }): readonly string[] {
  if (word.text.startsWith("--debug=")) {
    return word.text.slice("--debug=".length).split(",");
  }
  if (word.text === "--debug" && next !== undefined) {
    return next.text.split(",");
  }
  return [];
}

/**
 * The path operands of an `oxlint`/`tsgolint` tail: every word that is neither a flag nor a flag's value.
 *
 * @param args the words after the program
 * @returns the operands in order
 */
function pathOperands({ args }: { args: readonly ShellWord[] }): readonly ShellWord[] {
  const operands: ShellWord[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index]!;
    if (OXLINT_VALUE_FLAGS.has(word.text)) {
      index += 1;
    } else if (!word.text.startsWith("-")) {
      operands.push(word);
    }
  }
  return operands;
}
