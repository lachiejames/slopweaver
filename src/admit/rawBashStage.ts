/**
 * What ONE pipeline stage of a Bash command does that makes the call a script rather than a command — the
 * per-program half of `./rawBash.ts`, which owns the chain count, the recursion and the refusal.
 *
 * A stage is judged by its own words: whether it opens a block, where its redirections write, whether it is
 * a bare assignment, and what its resolved program (past redirections, assignments and wrappers, by
 * `./pythonWrappers.ts`' grammars) is asked to do. A stage after the first `|` must be a read-only FILTER,
 * because a pipe into anything else is a program fed a script on stdin.
 *
 * Pure: words in, the classes and the nested scripts to walk out.
 */
import { isJqProgram, jqAtAStart } from "./jqProgram.js";
import {
  ASSIGNMENT,
  assignsInExpansion,
  embeddedShellPayload,
  envSplitString,
  evalText,
  findCommands,
  hereStringBody,
  trapAction,
  watchedCommand,
} from "./launchedText.js";
import { longOption } from "./longOption.js";
import { AWKS, clusterReaching, evaluatesString, isEvaluator, SHELLS, shellPayloadIndex } from "./programText.js";
import { programName, resolveProgram } from "./pythonWrappers.js";
import { namesScriptFile, scriptFromStdin, sedEffects } from "./sedScript.js";
import { type ShellWord, splitOperators, withoutRedirections } from "./shellLexing.js";
import {
  assignsBeforeSpecialBuiltin,
  filterLaunches,
  gluesParenthesis,
  namesDescriptor,
  storesFromArguments,
  teeWrites,
} from "./wordOperators.js";

/** Every class of script the gate refuses, in the order a refusal names them. */
export type RawBashClass =
  | "chain"
  | "write-redirect"
  | "in-place-edit"
  | "sleep"
  | "jq"
  | "program-in-string"
  | "loop-or-branch"
  | "substitution-or-assignment"
  | "stdin-script"
  | "unreadable-wrapper"
  | "unreadable-heredoc"
  | "expanding-option"
  | "split-word";

/** What one stage was found doing, and the script text inside it that the caller walks next. */
export interface StageFinding {
  readonly classes: readonly RawBashClass[];
  /** A shell's `-c` payload or the heredoc body a shell reads as its program. */
  readonly nested: readonly string[];
}

/** A word that opens or continues a compound command: a loop, a branch, a function, a group or a coprocess. */
const BLOCK_WORDS = new Set(
  ["for", "while", "until", "if", "case", "select", "function", "coproc"].concat([
    "then",
    "do",
    "done",
    "elif",
    "else",
    "fi",
    "esac",
  ]),
);

/**
 * Programs whose only effect is to set shell state that the next call never sees. `hash`, `alias`, `enable`
 * and `shopt` can rebind what a later command's NAME runs within the same call, which the gate reads by name:
 * `/bin/bash -c "hash -p /bin/bash q; q -c 'sleep 1'"` sleeps.
 */
const ASSIGNMENT_PROGRAMS = new Set(
  ["export", "declare", "local", "readonly", "typeset", "unset"].concat(
    ["read", "mapfile", "readarray", "let", "getopts"],
    ["hash", "alias", "enable", "shopt"],
  ),
);

/** The read-only filters a later pipe stage may be. jq is not one: it is banned outright (`./jqProgram.ts`). */
const FILTERS = new Set(
  ["grep", "egrep", "fgrep", "rg", "head", "tail", "wc", "sort", "uniq", "cut", "tr"].concat([
    "column",
    "cat",
    "sed",
    "tee",
  ]),
);

/** The programs that read a heredoc or here-string as DATA; any other may run it, as `lua <<EOF` does. */
const STDIN_READERS = new Set([...FILTERS, "git", "slopweaver"]);

/**
 * Whether a word's shape holds an unquoted glob or brace expansion, which lets bash pick the program: `s[h]`,
 * `./run*`, `{ba,}sh`. Read by index rather than one regex, whose `.*` pairs backtrack on a long word.
 */
function expandingName({ shape }: { shape: string }): boolean {
  if (/[*?]/.test(shape)) return true;
  const bracket = shape.indexOf("[");
  if (bracket !== -1 && shape.includes("]", bracket + 1)) return true;
  const brace = shape.indexOf("{");
  if (brace === -1) return false;
  const separator = shape.slice(brace + 1).search(/,|\.\./);
  return separator !== -1 && shape.includes("}", brace + 1 + separator);
}

/** The first output redirection written unquoted in a word's shape; a descriptor before it changes nothing here. */
const WRITE_OPERATOR = /&>>|&>|>>|>\||>&|>/;

/**
 * Where a write goes nowhere a later call would read. A descriptor past stderr may be a file the caller's shell
 * inherited, so `/dev/fd/3` is a write.
 */
const HARMLESS_TARGET = /^\/dev\/(?:null|stdout|stderr|tty|fd\/[012])$/;

/** Words that may precede a compound command in the same pipeline: `! (…)`, `time { …; }`. */
const PIPELINE_PREFIXES = new Set(["!", "time", "-p"]);

/** Whether a stage opens a loop, a branch, a function definition, a subshell or a group, past a `!` or `time`. */
function opensBlock({ words }: { words: readonly ShellWord[] }): boolean {
  const start = words.findIndex((word) => word.quoted || !PIPELINE_PREFIXES.has(word.text));
  if (start === -1) return false;
  const head = words[start]!;
  if (head.quoted) return false;
  return (
    BLOCK_WORDS.has(head.text) ||
    /^[({]/.test(head.unquotedPrefix) ||
    /^[A-Za-z_][\w-]*\(\)/.test(head.unquotedPrefix) ||
    words[start + 1]?.text === "()"
  );
}

/** Whether a redirection's target is a file a later call could read, rather than a descriptor or a sink. */
function writesFile({ op, target }: { op: string; target: ShellWord | undefined }): boolean {
  if (target === undefined) return false;
  // Only the standard descriptors are known not to be files: `>&3` writes wherever descriptor 3 was opened,
  // which may be a file the caller's own shell inherited.
  if (op === ">&" && /^(?:[012]-?|-)$/.test(target.text)) return false;
  return target.dynamic || !HARMLESS_TARGET.test(target.text);
}

/** Whether any of a stage's words redirects output into a file. */
function redirectsIntoFile({ words }: { words: readonly ShellWord[] }): boolean {
  return words.some((word, index) => {
    const match = WRITE_OPERATOR.exec(word.shape);
    if (match === null) return false;
    const op = match[0];
    const rest = word.text.slice(match.index + op.length);
    const target = rest.length > 0 ? { ...word, text: rest } : words[index + 1];
    return writesFile({ op, target });
  });
}

/** The option words of an argument list, so a flag after `--` or a filename is never read as one. */
function flags({ args }: { args: readonly ShellWord[] }): readonly string[] {
  const end = args.findIndex((arg) => arg.text === "--");
  return (end === -1 ? args : args.slice(0, end)).filter((arg) => arg.text.startsWith("-")).map((arg) => arg.text);
}

/** A cluster that edits in place, with or without a backup suffix: `-i`, `-Ei.bak`, `-pi.orig`, never `-Ilib`. */
const IN_PLACE: Readonly<Record<string, RegExp>> = {
  perl: clusterReaching({ digits: "0lC", swallows: "IMmxFDeE", target: "i" }),
  ruby: clusterReaching({ digits: "0WT", swallows: "IrxCEFKe", target: "i" }),
  // BSD sed's `-I` edits in place too, across every file rather than per file. `-l` takes a value only in GNU
  // sed, so it swallows nothing here: macOS reads `-li` as `-l -i`.
  sed: clusterReaching({ swallows: "ef", target: "iI" }),
};

/** A sort cluster naming an output file: `-o out`, `-oout`, `-uo out`, never past `-k` or `-t`'s value. */
const SORT_OUTPUT = clusterReaching({ swallows: "ktST", target: "o" });

/**
 * Whether a sed, perl or ruby option list edits a file in place — shared with `./callStateGuard.ts`, so the call-state
 * tripwire reads `-i` exactly as this classifier does rather than by a second approximation.
 *
 * @param name the program's name
 * @param options the option words before any `--`
 * @returns true when one of them edits in place
 */
export function editsInPlace({ name, options }: { name: string; options: readonly string[] }): boolean {
  const pattern = IN_PLACE[name];
  if (pattern === undefined) return false;
  return options.some(
    (option) =>
      pattern.test(option) || (name === "sed" && longOption({ full: "--in-place", word: option }) !== undefined),
  );
}

/** What a program's own arguments make it do, by the program's name. */
function programClasses({ name, args }: { name: string; args: readonly ShellWord[] }): readonly RawBashClass[] {
  const options = flags({ args });
  const found: RawBashClass[] = [];
  if (name === "sleep") found.push("sleep");
  if (isJqProgram({ name })) found.push("jq");
  if (ASSIGNMENT_PROGRAMS.has(name) || storesFromArguments({ args, name, options })) {
    found.push("substitution-or-assignment");
  }
  if (editsInPlace({ name, options })) found.push("in-place-edit");
  if (writesFromArguments({ args, name, options })) found.push("write-redirect");
  const sedExecutes = name === "sed" && sedEffects({ args }).executes;
  const launches = sedExecutes || filterLaunches({ args, name });
  if (evaluatesString({ args, name, options }) || launches) found.push("program-in-string");
  if ((name === "sed" || AWKS.has(name)) && scriptFromStdin({ args })) found.push("stdin-script");
  return found;
}

/** Whether a program's own arguments name a file it writes: a sed `w`, a `tee` operand, `sort -o`. */
function writesFromArguments({
  name,
  args,
  options,
}: {
  name: string;
  args: readonly ShellWord[];
  options: readonly string[];
}): boolean {
  if (name === "sed") return sedEffects({ args }).writes.some((target) => !HARMLESS_TARGET.test(target));
  if (name === "tee") return teeWrites({ args, harmless: HARMLESS_TARGET });
  return (
    name === "sort" &&
    options.some((option) => SORT_OUTPUT.test(option) || longOption({ full: "--output", word: option }) !== undefined)
  );
}

/** Whether the gate judges a program by its options: an evaluator, an awk, `sed` or `sort`. */
function readsOptions({ name }: { name: string }): boolean {
  return isEvaluator({ name }) || AWKS.has(name) || ["sed", "sort", "find"].includes(name);
}

/**
 * Whether an argument carries a glob or an expansion and opens with one, or with a `-`, so bash may hand the
 * program an option the gate never saw: in a directory holding a file named `-e`, `node [-]e '…'` runs
 * `node -e '…'`, and beside a file named `-exec`, `find /dev/null -e?ec sleep 1 \;` sleeps. A `--` ahead of it
 * makes it an operand, except to `find`, whose `--` ends only its own `-H`/`-L`/`-P` options.
 */
function mayExpandToOption({
  arg,
  index,
  args,
  name,
}: {
  arg: ShellWord;
  index: number;
  args: readonly ShellWord[];
  name: string;
}): boolean {
  if (name !== "find" && args.slice(0, index).some((before) => before.text === "--")) return false;
  if (!expandingName({ shape: arg.shape }) && !arg.dynamic) return false;
  return /^[*?[{]/.test(arg.shape) || /^[-$`]/.test(arg.text);
}

/**
 * Judge one pipeline stage.
 *
 * @param words the stage's words, redirections included
 * @param later whether a `|` feeds this stage, so it must be a read-only filter
 * @param stdinBody the heredoc body this stage reads as stdin, when it reads one; a here-string is found here
 * @returns the classes the stage hits and the scripts inside it to walk next
 */
export function stageFinding({
  words: given,
  later,
  stdinBody,
}: {
  words: readonly ShellWord[];
  later: boolean;
  stdinBody: string | undefined;
}): StageFinding {
  return judgedStage({ later, stdinBody, words: splitOperators({ words: given }) });
}

/** What a stage's shape hits before any program is named: a block, a write redirect, an assignment. */
function statementClasses({
  words,
  bare,
}: {
  words: readonly ShellWord[];
  bare: readonly ShellWord[];
}): readonly RawBashClass[] {
  const classes: RawBashClass[] = [];
  if (opensBlock({ words }) || gluesParenthesis({ words })) classes.push("loop-or-branch");
  if (redirectsIntoFile({ words })) classes.push("write-redirect");
  // `! X=1` and `time X=1` still assign, so the pipeline prefix is stepped over first.
  const statementStart = bare.findIndex((word) => word.quoted || !PIPELINE_PREFIXES.has(word.text));
  const statement = statementStart === -1 ? [] : bare.slice(statementStart);
  const special = assignsBeforeSpecialBuiltin({ assignment: ASSIGNMENT, statement });
  const assigns = special || statement.every((word) => ASSIGNMENT.test(word.unquotedPrefix));
  // An array assignment spans words (`a=(1 2)`), so its first word alone marks it.
  const arrayAssigns = bare.some((word) => ASSIGNMENT.test(word.unquotedPrefix) && /=\(/.test(word.unquotedPrefix));
  const expansionAssigns = words.some((word) => word.dynamic && assignsInExpansion({ text: word.text }));
  const descriptorAssigns = namesDescriptor({ words });
  if ((statement.length > 0 && (assigns || arrayAssigns)) || expansionAssigns || descriptorAssigns) {
    classes.push("substitution-or-assignment");
  }
  return classes;
}

/** What each command `find` runs through an exec action hits, judged as a stage of its own. */
function findFinding({ name, args }: { name: string; args: readonly ShellWord[] }): StageFinding {
  if (name !== "find") return { classes: [], nested: [] };
  const inner = findCommands({ args }).map((command) =>
    judgedStage({ later: false, stdinBody: undefined, words: command }),
  );
  return { classes: inner.flatMap((found) => found.classes), nested: inner.flatMap((found) => found.nested) };
}

/** What a named program's own arguments make it do, and the program text in them to walk next. */
function programFinding({ name, args }: { name: string; args: readonly ShellWord[] }): StageFinding {
  const classes: RawBashClass[] = [...programClasses({ args, name })];
  if (readsOptions({ name }) && args.some((arg, index) => mayExpandToOption({ arg, args, index, name }))) {
    classes.push("expanding-option");
  }
  const nested: string[] = [];
  const payload = SHELLS.has(name) ? shellPayloadIndex({ args }) : undefined;
  if (payload !== undefined && args[payload] !== undefined) nested.push(args[payload].text);
  for (const text of [watchedCommand({ args, name }), evalText({ args, name }), trapAction({ args, name })]) {
    if (text === undefined) continue;
    classes.push("program-in-string");
    nested.push(text);
  }
  const found = findFinding({ args, name });
  classes.push(...found.classes);
  nested.push(...found.nested);
  const embedded = SHELLS.has(name) || FILTERS.has(name) ? undefined : embeddedShellPayload({ args });
  if (embedded !== undefined) {
    classes.push("program-in-string");
    nested.push(embedded);
  }
  return { classes, nested };
}

/** What a named program does with the stdin the stage feeds it: a heredoc, a here-string or a `|`. */
function stdinFinding({
  name,
  words,
  later,
  stdinBody,
}: {
  name: string;
  words: readonly ShellWord[];
  later: boolean;
  stdinBody: string | undefined;
}): StageFinding {
  const classes: RawBashClass[] = [];
  const nested: string[] = [];
  const bodies = STDIN_READERS.has(name) ? [] : [stdinBody, hereStringBody({ words })];
  for (const body of bodies) {
    if (body === undefined) continue;
    classes.push("stdin-script");
    if (SHELLS.has(name)) nested.push(body);
  }
  if (later && !FILTERS.has(name)) classes.push("stdin-script");
  const fed = later || stdinBody !== undefined || hereStringBody({ words }) !== undefined;
  if (fed && (name === "sed" || AWKS.has(name)) && namesScriptFile({ args: words, name })) classes.push("stdin-script");
  return { classes, nested };
}

/** Judge one stage whose operators already stand as words of their own. */
function judgedStage({
  words,
  later,
  stdinBody,
}: {
  words: readonly ShellWord[];
  later: boolean;
  stdinBody: string | undefined;
}): StageFinding {
  if (words.length === 0) return { classes: [], nested: [] };
  const bare = withoutRedirections({ words });
  const jq: readonly RawBashClass[] = jqAtAStart({ words: bare }) ? ["jq"] : [];
  const classes = [...statementClasses({ bare, words }), ...jq];
  const split = envSplitString({ words: bare });
  if (split !== undefined) return { classes: [...classes, "program-in-string"], nested: [split] };
  const resolved = resolveProgram({ words: bare });
  if (resolved.kind === "unknown-option") return { classes: [...classes, "unreadable-wrapper"], nested: [] };
  if (resolved.kind !== "program") {
    // A wrapper naming no program still reads its stdin, and is no filter: `printf 'one\n' | xargs` runs `echo`.
    // A bare `exec` keeps an input it opens on ANY descriptor for the commands after it, so `exec 3<<'EOF'`
    // then `bash <&3` runs the body: any input redirection counts.
    const opensInput = words.some((word) => !bare.includes(word) && word.shape.includes("<"));
    const fed = later || opensInput || stdinBody !== undefined || hereStringBody({ words }) !== undefined;
    return { classes: fed ? [...new Set([...classes, "stdin-script" as const])] : classes, nested: [] };
  }
  // A program named by an expansion (`"$SHELL" -c …`, `/bin/s[h] -c …`) is chosen when it runs, so nothing here
  // can judge it. So is one holding `{}`, which find replaces with each path it visits: `find sleep -exec ./{}`
  // runs `./sleep`.
  const head = resolved.words[0]!;
  if (head.dynamic || expandingName({ shape: head.shape }) || head.text.includes("{}")) {
    return { classes: [...new Set([...classes, "substitution-or-assignment" as const])], nested: [] };
  }
  const [program, ...args] = resolved.words;
  const name = programName({ text: program!.text });
  const own = programFinding({ args, name });
  const input = stdinFinding({ later, name, stdinBody, words });
  return {
    classes: [...new Set([...classes, ...own.classes, ...input.classes])],
    nested: [...new Set([...own.nested, ...input.nested])],
  };
}
