/**
 * Which programs run program text of their own, and whether one stage hands them that text in its arguments
 * rather than as a script file on disk — the evaluator half of `./rawBashStage.ts`.
 *
 * Two layers. A per-program rule names the spellings each evaluator documents (`node -e`, `perl -ne`, a shell's
 * `-c`). Under it, one STRUCTURAL rule covers every spelling those miss: an evaluator whose first argument is an
 * option, rather than the script file it runs, fails closed, because an option this table cannot read may be
 * the program itself (`R --expression=…`, `deno --quiet eval …`). The table is what the gate can see; an
 * interpreter it does not name is a documented blind spot, never a guess.
 *
 * Pure: words in, a verdict out.
 */
import { longOption } from "./longOption.js";
import type { ShellWord } from "./shellLexing.js";

/** The shells, whose `-c` payload the caller walks as a nested script. */
export const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "fish", "csh", "tcsh", "ash", "mksh", "yash"]);

/** The awks, whose first operand is their program unless `-f` names a file. */
export const AWKS = new Set(["awk", "gawk", "mawk", "nawk"]);

/** Programs that run their `-e` value as a script in a language of their own. */
const E_EVALUATORS = new Set(["osascript", "lua", "luajit", "Rscript", "R"]);

/** A flag that makes a JavaScript runtime evaluate a program string: `-e`, `-p`, `-pe`, `--eval`, `--print`. */
const JS_EVAL_FLAG = /^-[ep]|^--(?:eval|print)(?:=|$)/;

/** The one argument an evaluator may take first and still run nothing: a version or help query. */
const INFO_QUERY = /^(?:--version|--help|-[vVh])$/;

/**
 * A short-option cluster that reaches one of the `target` letters. It is written by the switches that SWALLOW the
 * rest of the word (perl's `-Ilib`, sort's `-t,`), never by the ones that do not, so a switch this table has
 * not heard of counts as a flag and the letter behind it is still found: a gap refuses rather than passes.
 * `digits` names the switches that take trailing digits in the same cluster (perl's `-0777`).
 *
 * @param swallows the switches that consume the rest of their word as a value
 * @param target the letters whose presence in the cluster is being asked about
 * @param digits the switches that take trailing digits inside the cluster
 * @returns a pattern matching an option word whose cluster reaches a target letter
 */
export function clusterReaching({
  swallows,
  target,
  digits = "",
}: {
  swallows: string;
  target: string;
  digits?: string;
}): RegExp {
  const numbered = digits === "" ? "" : `[${digits}]\\d*|`;
  return new RegExp(`^-(?:${numbered}(?![${swallows}${target}])[A-Za-z])*[${target}]`);
}

/**
 * A gawk cluster reaching `-e` (program text), never past a switch whose value is the rest of the word (`-vx=e`).
 * `-W` counts too: its value is a long option by another spelling, and `-W source 'PROG'` or mawk's `-W exec`
 * runs program text beside any `-f` file, so every `-W` fails closed.
 */
const AWK_SOURCE = clusterReaching({ swallows: "FfvEilLopdD", target: "eW" });

/** A cluster that hands the next word to perl, ruby or php as its program: `-e`, `-ne`, `-0777e`, `-Ue`, `-nr`. */
const EVAL_CLUSTER: Readonly<Record<string, RegExp>> = {
  perl: clusterReaching({ digits: "0lC", swallows: "IMmxFDi", target: "eE" }),
  php: clusterReaching({ swallows: "cdfzFSt", target: "rRBE" }),
  ruby: clusterReaching({ digits: "0WT", swallows: "IrxCEFK", target: "e" }),
};

/** Every program that runs program text of its own, so an option ahead of its script file may be that text. */
const EVALUATORS = new Set([
  ...SHELLS,
  ...E_EVALUATORS,
  ...Object.keys(EVAL_CLUSTER),
  "node",
  "tsx",
  "ts-node",
  "bun",
  "deno",
  "qjs",
  "pwsh",
  "powershell",
  "julia",
  "tclsh",
  "wish",
  "expect",
  "jshell",
  "groovy",
  "scala",
  "swift",
  "erl",
  "escript",
  "elixir",
  "iex",
  "guile",
  "racket",
  "sbcl",
  "clisp",
  "ghci",
  "runghc",
  "java",
]);

/**
 * Whether a program runs program text of its own, so an option it is handed may be that text.
 *
 * @param name the program's name, path and GNU `g` prefix already dropped
 * @returns whether the evaluator table names it
 */
export function isEvaluator({ name }: { name: string }): boolean {
  return EVALUATORS.has(name);
}

/**
 * The index of a shell's `-c` payload (fish's `-C`, `--command`, `--init-command`) among its arguments.
 *
 * @param args the shell's arguments, its own name excluded
 * @returns the index of the word the shell runs as its program, or `undefined` when no payload flag is present
 */
export function shellPayloadIndex({ args }: { args: readonly ShellWord[] }): number | undefined {
  const flag = args.findIndex(
    (arg) =>
      (/^-[A-Za-z]+$/.test(arg.text) && /[cC]/.test(arg.text)) ||
      ["--command", "--init-command"].some((full) => longOption({ full, word: arg.text }) !== undefined),
  );
  return flag === -1 ? undefined : flag + 1;
}

/**
 * Whether a program is handed its program as a string argument rather than a file.
 *
 * @param name the program's name, path and GNU `g` prefix already dropped
 * @param args the program's arguments, its own name excluded
 * @param options the option words among `args`, up to any `--`
 * @returns whether the call carries program text the gate cannot read as a file on disk
 */
export function evaluatesString({
  name,
  args,
  options,
}: {
  name: string;
  args: readonly ShellWord[];
  options: readonly string[];
}): boolean {
  if (EVALUATORS.has(name) && optionLeads({ args })) return true;
  // Each matches a PREFIX, so a value glued on by the shell (`-e'return 7'` is the word `-ereturn 7`) still counts.
  if (["node", "tsx", "bun"].includes(name)) return options.some((o) => JS_EVAL_FLAG.test(o));
  // Any `eval` word, not only the first: a global option (`deno --quiet eval`) may sit before the subcommand.
  if (name === "deno") return args.some((arg) => arg.text === "eval") || options.some((o) => JS_EVAL_FLAG.test(o));
  if (E_EVALUATORS.has(name)) return options.some((o) => o.startsWith("-e"));
  if (name === "pwsh" || name === "powershell") return options.some((o) => /^-{1,2}[ce]/i.test(o));
  const evalCluster = EVAL_CLUSTER[name];
  if (evalCluster !== undefined) return options.some((option) => evalCluster.test(option));
  if (AWKS.has(name)) {
    // gawk runs `-e`/`--source` text BESIDE any `-f` file, so a file option never clears the call on its own.
    const source = options.some((o) => AWK_SOURCE.test(o) || longOption({ full: "--source", word: o }) !== undefined);
    return source || !awkFileBeforeProgram({ args });
  }
  return SHELLS.has(name) && shellPayloadIndex({ args }) !== undefined;
}

/** The awk switches whose value is the next word when nothing follows them in their own word. */
const AWK_VALUE_SWITCH = /[FfvEeil]/;

/** The gawk long options whose value is the next word when it carries no `=`. */
const AWK_VALUE_LONG = ["--file", "--exec", "--source", "--assign", "--field-separator", "--include", "--load"];

/**
 * Whether an awk names a program FILE (`-f`, `-E`, `--file`, `--exec`) before its first operand. The first
 * operand is the program text when no file came first, whatever follows it:
 * `awk 'BEGIN{print "inline ran"}' -f /dev/null` prints `inline ran`.
 */
function awkFileBeforeProgram({ args }: { args: readonly ShellWord[] }): boolean {
  let fromFile = false;
  for (let at = 0; at < args.length; at += 1) {
    const word = args[at]!.text;
    if (word === "--" || word === "-" || !word.startsWith("-")) return fromFile;
    const option = awkOption({ word });
    if (option.file) fromFile = true;
    if (option.takesNext) at += 1;
  }
  return fromFile;
}

/** What one awk option word says: whether it names a program file, and whether its value is the next word. */
function awkOption({ word }: { word: string }): { readonly file: boolean; readonly takesNext: boolean } {
  if (word.startsWith("--")) {
    const long = AWK_VALUE_LONG.find((full) => longOption({ full, word }) !== undefined);
    return { file: long === "--file" || long === "--exec", takesNext: long !== undefined && !word.includes("=") };
  }
  const valueAt = word.slice(1).search(AWK_VALUE_SWITCH);
  if (valueAt === -1) return { file: false, takesNext: false };
  return { file: "fE".includes(word[valueAt + 1]!), takesNext: valueAt + 2 === word.length };
}

/** Whether an evaluator's first argument is an option rather than its script file, a lone version or help query aside. */
function optionLeads({ args }: { args: readonly ShellWord[] }): boolean {
  const first = args[0];
  if (first === undefined || !first.text.startsWith("-")) return false;
  return !(args.length === 1 && INFO_QUERY.test(first.text));
}
