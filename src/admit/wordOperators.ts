/**
 * Operators bash reads out of what the lexer passed through as a plain word — a `(` glued inside one, the `{fd}` a
 * redirection names its descriptor by, and an argument a builtin stores into a variable or evaluates as
 * arithmetic. `./rawBashStage.ts` refuses each as the class its effect falls in.
 *
 * Pure: words in, a verdict out.
 */
import { storesInArithmetic } from "./launchedText.js";
import { longOption } from "./longOption.js";
import { type ShellWord } from "./shellLexing.js";

/** The conditionals that evaluate an operand as arithmetic: `[[ x=1 -eq 1 ]]`, `test -v 'a[x=1]'` under bash 5. */
const CONDITIONALS = new Set(["[[", "test", "["]);

/** A conditional's own operator words, never an operand: `test "$a" = b` compares, it does not assign. */
const CONDITIONAL_OPERATORS = new Set(["=", "==", "!=", "=~", "<", ">", "<=", ">="]);

/**
 * Whether a builtin's arguments store into a variable: `printf -v X` and `wait -p X` store their result, and a
 * conditional evaluates an operand holding `=`, `++` or `--` as arithmetic, which assigns (MEASURED: `[[ y=1 -eq 1
 * ]]` sets `y` on bash 3.2.57, `test -v 'a[z=1]'` sets `z` on bash 5.3.9 — a counterexample family).
 *
 * @param name the resolved program name
 * @param args the words after the program name
 * @param options the option words before any `--`
 * @returns true when the call stores into a variable through its arguments
 */
export function storesFromArguments({
  name,
  args,
  options,
}: {
  name: string;
  args: readonly ShellWord[];
  options: readonly string[];
}): boolean {
  if (name === "printf") return options.some((option) => option.includes("v"));
  if (name === "wait") return options.some((option) => option.includes("p"));
  if (!CONDITIONALS.has(name)) return false;
  // A subscript is expanded again when evaluated, quotes or not: `[[ -v 'a[$(sleep 1)]' ]]` runs the sleep on bash
  // 5.3.9 (a counterexample), so any operand holding one fails closed.
  return args.some(
    (arg) => !CONDITIONAL_OPERATORS.has(arg.text) && (arg.text.includes("[") || storesInArithmetic({ text: arg.text })),
  );
}

/**
 * The `{fd}` a redirection names its descriptor by, unquoted, standing as its own word once the operator after it
 * is split off: `{fd}<in`, `{a[1]}>&2`. A `{X}` merely followed by a spaced redirection reads the same, and is
 * refused with it.
 */
const NAMED_DESCRIPTOR = /^\{[A-Za-z_]\w*(?:\[[^\]]*\])?\}$/;

/** An expansion whose span may hold a `(` that is arithmetic rather than an operator: `$((…))`, `$[…]`, `${…}`. */
const PAREN_SAFE_SPAN = /\$\(\([\s\S]*?(?:\)\)|$)|\$\[[^\]]*\]?|\$\{[^}]*\}?/g;

/**
 * Whether an unquoted `(` sits inside a word, outside an expansion or an array assignment. Bash reads it as an
 * operator, so `time(sleep 1)` opens a subshell the lexer read as the word `time(sleep` (a
 * counterexample); anywhere else it is a syntax error, and refusing that costs nothing.
 *
 * @param words a stage's words, operators already split into words of their own
 * @returns true when some word glues a `(` bash reads as an operator
 */
export function gluesParenthesis({ words }: { words: readonly ShellWord[] }): boolean {
  return words.some((word) => {
    const shape = word.shape.replace(PAREN_SAFE_SPAN, (span) => "_".repeat(span.length));
    return shape.includes("(") && !/^[A-Za-z_]\w*\+?=\(/.test(shape);
  });
}

/**
 * Whether a redirection names its descriptor by a variable. Bash 5's `{fd}</dev/null` allocates a descriptor and
 * stores its number in `fd`, an assignment one command makes (a counterexample).
 *
 * @param words a stage's words, operators already split into words of their own
 * @returns true when a `{name}` word stands straight before a redirection
 */
export function namesDescriptor({ words }: { words: readonly ShellWord[] }): boolean {
  return words.some((word, index) => {
    const next = words[index + 1];
    return NAMED_DESCRIPTOR.test(word.shape) && next !== undefined && /^[<>]/.test(next.shape);
  });
}

/** The options that make a read-only filter launch a program, by filter; each also taken by any prefix of its name. */
const LAUNCHING_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  rg: ["--pre", "--hostname-bin"],
  sort: ["--compress-program"],
};

/**
 * Whether a filter the gate otherwise trusts to only read is told to launch a program: `rg --pre /bin/sleep`
 * (a counterexample) runs it once per file searched.
 *
 * @param name the program the stage runs
 * @param args the words after the program name
 * @returns true when an argument is one of that filter's launching options
 */
export function filterLaunches({ name, args }: { name: string; args: readonly ShellWord[] }): boolean {
  const options = LAUNCHING_OPTIONS[name];
  if (options === undefined) return false;
  return args.some((arg) => options.some((full) => longOption({ full, word: arg.text }) !== undefined));
}

/**
 * Whether `tee` writes a file its words name. BSD tee stops reading options at the first operand, so every word
 * after it is a file even when it opens with `-` (`tee /dev/null -a`, a counterexample), and a lone
 * `-` is a file too.
 *
 * @param args the words after `tee`
 * @param harmless the targets a write to changes nothing: `/dev/null`, a standard stream
 * @returns true when any word tee reads as a file is not a harmless target
 */
export function teeWrites({ args, harmless }: { args: readonly ShellWord[]; harmless: RegExp }): boolean {
  let operands = false;
  for (const arg of args) {
    if (!operands && arg.text === "--") {
      operands = true;
      continue;
    }
    if (!operands && arg.text.startsWith("-") && arg.text !== "-") continue;
    operands = true;
    if (!harmless.test(arg.text)) return true;
  }
  return false;
}

/** POSIX's special builtins: under `set -o posix`, an assignment prefixed to one outlives the command. */
const SPECIAL_BUILTINS = new Set([":", ".", "break", "continue", "eval", "exec", "exit", "export", "readonly"]);
for (const name of ["return", "set", "shift", "source", "times", "trap", "unset"]) SPECIAL_BUILTINS.add(name);

/**
 * Whether a statement's assignment prefix lands on a special builtin, where POSIX mode keeps it as a shell
 * variable: `set -o posix; X=1 :` sets `X` (a counterexample). Fails closed in every mode.
 *
 * @param statement the statement's words, pipeline prefixes stepped over
 * @param assignment what an assignment word's unquoted opening matches
 * @returns true when one or more assignments precede a special builtin
 */
export function assignsBeforeSpecialBuiltin({
  statement,
  assignment,
}: {
  statement: readonly ShellWord[];
  assignment: RegExp;
}): boolean {
  const program = statement.findIndex((word) => !assignment.test(word.unquotedPrefix));
  return program > 0 && SPECIAL_BUILTINS.has(statement[program]!.text);
}
