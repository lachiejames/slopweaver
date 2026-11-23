/**
 * What a sed invocation's own script does beyond printing, for `./rawBashStage.ts`: which files it writes through
 * a `w`/`W` command, bare or after an address, or the `w` flag of an `s` command, under any delimiter and with or
 * without a space before the filename (`wout`, `1w out`, `s|a|b|gw out`); and whether it runs a shell command
 * through an `e` command or an `s` command's `e` flag. Also whether a sed or awk invocation reads its script from
 * stdin, which none of that can see.
 *
 * A regex cannot tell `s/a/b/wout` (a write) from `s/foo/world/` (a replacement that starts with `w`), so this
 * walks the script the way sed does: addresses, then one command, skipping each `s`/`y` operand to its closing
 * delimiter and each text or label argument to its end. It is a scanner for those questions, not a sed parser:
 * a malformed script reads as whatever its characters look like.
 *
 * Pure: arguments in, write targets out.
 */
import { longOption } from "./longOption.js";
import type { ShellWord } from "./shellLexing.js";

/** A cursor over one sed script. */
interface Scan {
  readonly text: string;
  at: number;
  /** Whether the script has run a shell command through `e` or an `s///e` flag so far. */
  executes: boolean;
}

/** What one or more sed scripts do beyond printing. */
interface SedEffects {
  readonly writes: readonly string[];
  readonly executes: boolean;
}

/** Commands whose argument runs to the end of the line: text to insert, a file to read, a command. */
const TO_LINE_END = new Set(["a", "i", "c", "r", "R", "e"]);

/**
 * A label definition and the branches, whose label GNU sed ends at a `;` (`gsed ':x;e cmd'` runs `cmd`). BSD sed
 * reads a `:` label to the end of the line, so reading it the GNU way can only find a command that is not there.
 */
const BRANCHES = new Set([":", "b", "t", "T"]);

/** The flags an `s` command may carry before a `w`. */
const S_FLAGS = /[gpiImMe0-9]/;

/** Advance past the rest of the current line, not over its newline. */
function restOfLine({ scan }: { scan: Scan }): string {
  const end = scan.text.indexOf("\n", scan.at);
  const stop = end === -1 ? scan.text.length : end;
  const rest = scan.text.slice(scan.at, stop);
  scan.at = stop;
  return rest;
}

/** Advance past the next unescaped `delimiter`, the cursor starting just inside the delimited run. */
function pastDelimiter({ scan, delimiter }: { scan: Scan; delimiter: string }): void {
  while (scan.at < scan.text.length) {
    const ch = scan.text[scan.at]!;
    scan.at += ch === "\\" ? 2 : 1;
    if (ch === delimiter) return;
  }
}

/** Advance past every character matching `pattern` from the cursor. */
function skipWhile({ scan, pattern }: { scan: Scan; pattern: RegExp }): void {
  while (scan.at < scan.text.length && pattern.test(scan.text[scan.at]!)) scan.at += 1;
}

/** Advance past a regex address under `/` or `\c`, and its `I`/`M` modifiers. */
function pastRegexAddress({ scan }: { scan: Scan }): void {
  if (scan.text[scan.at] === "\\") scan.at += 1;
  const delimiter = scan.text[scan.at];
  if (delimiter === undefined) return;
  scan.at += 1;
  pastDelimiter({ delimiter, scan });
  skipWhile({ pattern: /[IM]/, scan });
}

/** Advance past one address: a line number or step, `$`, or a regex under `/` or `\c`. */
function pastOneAddress({ scan }: { scan: Scan }): void {
  const ch = scan.text[scan.at];
  if (ch === "$") {
    scan.at += 1;
  } else if (ch !== undefined && /[\d+~]/.test(ch)) {
    skipWhile({ pattern: /[\d+~]/, scan });
  } else if (ch === "/" || ch === "\\") {
    pastRegexAddress({ scan });
  }
}

/** Advance past the separators, an address range and a negation, to the next command character. */
function toCommand({ scan }: { scan: Scan }): void {
  while (scan.at < scan.text.length && /[\s;{}]/.test(scan.text[scan.at]!)) scan.at += 1;
  pastOneAddress({ scan });
  if (scan.text[scan.at] === ",") {
    scan.at += 1;
    pastOneAddress({ scan });
  }
  while (scan.at < scan.text.length && /[\s!]/.test(scan.text[scan.at]!)) scan.at += 1;
}

/** Read an `s` command from just after its `s`, returning the file its `w` flag writes when it has one. */
function substitutionTarget({ scan }: { scan: Scan }): string | undefined {
  const delimiter = scan.text[scan.at];
  if (delimiter === undefined) return undefined;
  scan.at += 1;
  pastDelimiter({ delimiter, scan });
  pastDelimiter({ delimiter, scan });
  while (scan.at < scan.text.length && S_FLAGS.test(scan.text[scan.at]!)) {
    if (scan.text[scan.at] === "e") scan.executes = true;
    scan.at += 1;
  }
  if (scan.text[scan.at] !== "w") return undefined;
  scan.at += 1;
  return restOfLine({ scan }).trim();
}

/** Read one command at the cursor, returning the file it writes when it writes one. */
function commandTarget({ scan }: { scan: Scan }): string | undefined {
  const command = scan.text[scan.at]!;
  scan.at += 1;
  if (command === "w" || command === "W") return restOfLine({ scan }).trim();
  if (command === "s") return substitutionTarget({ scan });
  if (command === "e") scan.executes = true;
  if (command === "y") {
    const delimiter = scan.text[scan.at];
    if (delimiter === undefined) return undefined;
    scan.at += 1;
    pastDelimiter({ delimiter, scan });
    pastDelimiter({ delimiter, scan });
  } else if (command === "#" || TO_LINE_END.has(command)) {
    restOfLine({ scan });
  } else if (BRANCHES.has(command)) {
    while (scan.at < scan.text.length && !/[;\n]/.test(scan.text[scan.at]!)) scan.at += 1;
  }
  return undefined;
}

/** Every file one sed script writes, in script order, and whether it runs a shell command. */
function scriptEffects({ script }: { script: string }): SedEffects {
  const scan: Scan = { at: 0, executes: false, text: script };
  const writes: string[] = [];
  while (scan.at < scan.text.length) {
    const before = scan.at;
    toCommand({ scan });
    if (scan.at >= scan.text.length) break;
    const target = commandTarget({ scan });
    if (target !== undefined) writes.push(target);
    if (scan.at === before) scan.at += 1;
  }
  return { executes: scan.executes, writes };
}

/** Whether a short option cluster sets `-l` before any switch that takes the rest of it: `-l`, `-nl`, `-li`. */
function isShortLineLength({ text }: { text: string }): boolean {
  if (!text.startsWith("-") || text.startsWith("--")) return false;
  return /^-(?:(?![efi])[A-Za-z])*/.exec(text)![0].includes("l");
}

/** One script a sed argument list runs, and whether its text is what bash will hand sed. */
interface SedScript {
  readonly text: string;
  readonly readable: boolean;
}

/**
 * Whether a word's text is the value bash hands the program: no expansion, and no unquoted glob or brace. A sed
 * script spelled by one (`sed " ${X} out"` with `X=w`, a counterexample) may be any command.
 */
function isLiteral({ word }: { word: ShellWord }): boolean {
  return !word.dynamic && !/[*?[{]/.test(word.shape);
}

/** Whether the word a sed option or operand takes its value from is literal: the next word, or its own. */
function sourceIsLiteral({
  args,
  index,
  takesNext,
}: {
  args: readonly ShellWord[];
  index: number;
  takesNext: boolean;
}): boolean {
  const source = takesNext ? args[index + 1] : args[index];
  return source !== undefined && isLiteral({ word: source });
}

/** The scripts a sed argument list runs: each `-e`/`--expression`, else its first operand unless `-f` names a file. */
function sedScripts({ args }: { args: readonly ShellWord[] }): readonly SedScript[] {
  const scripts: SedScript[] = [];
  const operands: SedScript[] = [];
  let fromFile = false;
  let lineLength = false;
  for (let index = 0; index < args.length; index += 1) {
    const text = args[index]!.text;
    if (text === "--") {
      operands.push(...args.slice(index + 1).map((arg) => ({ readable: isLiteral({ word: arg }), text: arg.text })));
      break;
    }
    const word = sedWord({ next: args[index + 1]?.text, text });
    const readable = sourceIsLiteral({ args, index, takesNext: word.takesNext });
    if (word.script !== undefined) scripts.push({ readable, text: word.script });
    if (word.operand !== undefined) operands.push({ readable, text: word.operand });
    fromFile = fromFile || word.fromFile;
    lineLength = lineLength || isShortLineLength({ text });
    if (word.takesNext) index += 1;
  }
  // `-l` takes a value in GNU sed and none in BSD sed, so which operand is the script depends on the build:
  // every one is read as a script, failing closed (a counterexample family).
  if (lineLength) return [...scripts, ...operands];
  if (scripts.length > 0 || fromFile) return scripts;
  return operands.slice(0, 1);
}

/**
 * What one sed argument word gives: the script an `-e`/`--expression` carries, whether `-f`/`--file` names a
 * script file, the operand a plain word is, and whether its value is the next word.
 */
function sedWord({ text, next }: { text: string; next: string | undefined }): {
  readonly script: string | undefined;
  readonly operand: string | undefined;
  readonly fromFile: boolean;
  readonly takesNext: boolean;
} {
  // GNU sed takes any prefix of a long option, so `--expr=…` is `--expression=…`.
  const named = ["--expression", "--file", "--line-length"].map((full) => longOption({ full, word: text }));
  const [expression, file] = named;
  const long = named.find((match) => match !== undefined);
  if (long !== undefined) {
    // A value not attached to the option is the next word, by design.
    let value = next;
    if (long.attached !== undefined) value = long.attached;
    const script = long === expression ? value : undefined;
    return { fromFile: long === file, operand: undefined, script, takesNext: long.attached === undefined };
  }
  const cluster = /^-(?:(?![efi])[A-Za-z])*(?<flag>[ef])(?<attached>.*)$/.exec(text);
  if (cluster?.groups === undefined || text.startsWith("--")) {
    const operand = text.startsWith("-") ? undefined : text;
    return { fromFile: false, operand, script: undefined, takesNext: false };
  }
  const { flag, attached } = cluster.groups;
  const value = attached === "" ? next : attached;
  return {
    fromFile: flag === "f",
    operand: undefined,
    script: flag === "e" ? value : undefined,
    takesNext: attached === "",
  };
}

/**
 * Whether a script file name may be stdin or a descriptor a redirection or here-string feeds. A path has many
 * spellings (`/dev/fd//0`, a counterexample; `/./dev/stdin`; `stdin` after `cd /dev`), so it fails
 * closed: `-`, any path under `/dev` or `/proc` once `//` and `/./` collapse, a `..` step, or a last step that is
 * `stdin` or a descriptor number.
 */
function mayBeStdin({ name }: { name: string }): boolean {
  if (name === "-") return true;
  const path = name.replace(/\/(?:\.\/|\/)+/g, "/");
  if (/^\/(?:dev|proc)(?:\/|$)/.test(path) || /(?:^|\/)\.\.(?:\/|$)/.test(path)) return true;
  return /(?:^|\/)(?:stdin|\d+)\/?$/.test(path);
}

/** The letters that open a short option cluster: `-nf` of `-nfscript`. */
const SHORT_CLUSTER = /^-[A-Za-z]*/;

/**
 * What follows the LAST script-file switch (sed and awk `-f`, gawk `-E` and `-i`) in a short option cluster, or
 * `undefined` when the word holds none. Found by index, since one regex pairing `[A-Za-z]*` with `.*` backtracks.
 */
function scriptFileAttached({ word }: { word: string }): string | undefined {
  const cluster = SHORT_CLUSTER.exec(word)?.[0];
  if (cluster === undefined) return undefined;
  const at = Math.max(...["f", "E", "i"].map((letter) => cluster.lastIndexOf(letter)));
  return at < 1 ? undefined : word.slice(at + 1);
}

/** The long script-file options, each also taken by any prefix of its name. */
const SCRIPT_FILE_LONG = ["--file", "--exec", "--include"];

/**
 * Whether a sed or awk argument list reads its script from stdin (`sed -f -`, `awk -f /dev/stdin`), where a
 * here-string or pipe can hand it a program nothing here reads. Broad on purpose: any short cluster ending in a
 * script-file switch counts, so an unlisted cluster refuses rather than passes.
 *
 * @param args the words after the program name
 * @returns true when any script-file option names stdin
 */
export function scriptFromStdin({ args }: { args: readonly ShellWord[] }): boolean {
  return args.some((arg, index) => {
    const long = SCRIPT_FILE_LONG.map((full) => longOption({ full, word: arg.text })).find((m) => m !== undefined);
    const short = long === undefined ? scriptFileAttached({ word: arg.text }) : undefined;
    if (long === undefined && short === undefined) return false;
    const attached = long === undefined ? short : long.attached;
    const separate = attached === undefined || attached === "";
    const word = separate ? args[index + 1] : arg;
    if (word === undefined) return false;
    // A name an expansion, a glob or a brace spells may be stdin when it runs: `-f /dev/fd/$((0))` (a review's
    // counterexample) or `-f /dev/{stdin,null}`, so it fails closed.
    const value = separate ? word.text : attached;
    return word.dynamic || /[*?[{]/.test(value) || mayBeStdin({ name: value });
  });
}

/**
 * What a sed invocation's own scripts do beyond printing: the files a `w` command or an `s` command's `w` flag
 * writes, and whether an `e` command or an `s` command's `e` flag runs a shell command.
 *
 * @param args the words after `sed`, options and operands both
 * @returns each write target in order, empty when the scripts write nothing, and whether any script executes
 */
export function sedEffects({ args }: { args: readonly ShellWord[] }): SedEffects {
  const scripts = sedScripts({ args });
  const each = scripts.map((script) => scriptEffects({ script: script.text }));
  // A script bash spells at run time is unread, so it counts as running a program (fail closed).
  const executes = each.some((one) => one.executes) || scripts.some((script) => !script.readable);
  return { executes, writes: each.flatMap((one) => one.writes) };
}

/**
 * Whether a sed or awk argument list names any script file at all. Any file may be a link to stdin, one the same
 * command line just made (`ln -sf /dev/stdin s && sed -f s f <<EOF`, a counterexample), so a script
 * file beside a fed stdin fails closed whatever its name.
 *
 * @param name `sed` or an awk: to sed, `-E` is extended regex and `-i` in-place, never a script file
 * @param args the words after the program name, or the whole stage
 * @returns true when any argument is a script-file option
 */
export function namesScriptFile({ name, args }: { name: string; args: readonly ShellWord[] }): boolean {
  const longs = name === "sed" ? ["--file"] : SCRIPT_FILE_LONG;
  return args.some((arg) => {
    if (longs.some((full) => longOption({ full, word: arg.text }) !== undefined)) return true;
    if (name !== "sed") return scriptFileAttached({ word: arg.text }) !== undefined;
    const cluster = SHORT_CLUSTER.exec(arg.text)?.[0];
    return cluster !== undefined && cluster.indexOf("f") >= 1;
  });
}
