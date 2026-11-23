/**
 * The raw-Bash gate: refuse a Bash call that is a shell SCRIPT rather than one command, the way
 * `./pythonInvocation.ts` refuses Python.
 *
 * ## Why this exists
 *
 * Agents do everything through slopweaver verbs, and raw Bash is banned like raw Python with a few
 * whitelisted exceptions. The line is drawn at ONE command, piped only through read-only filters, or two
 * commands within {@link CHAIN_MAX_CHARS} characters; a 600-character `a; b; c` call is the case it exists for. Everything past that is a
 * script, and a script is a verb that does not exist yet. The measurement that ranks each class, and what it
 * cannot see, is `docs/doctrine-rationale/no-raw-bash.md`.
 *
 * ## What it is not
 *
 * A workflow tripwire, never a safety boundary: a lone `rm -rf dir` is one command and passes. It fails OPEN
 * (`./rawBashGuardRunner.ts`), and `SLOPWEAVER_ALLOW_BASH` is its own AMBIENT hatch — it never opens a raw
 * or Python refusal, and neither of theirs opens it.
 *
 * Pure: a command in, a verdict out.
 */
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { assignsInExpansion } from "./launchedText.js";
import { type RawBashClass, stageFinding } from "./rawBashStage.js";
import { bodySubstitutions, type ShellWord, shellWords, slicedWord } from "./shellLexing.js";
import { type CommandSegment, commandSegments, hasCommandSegmentOverride } from "./shellSegments.js";
import { stdinHeredocIndex } from "./stdinHeredoc.js";

export type { RawBashClass } from "./rawBashStage.js";

/** The variable that opens this gate, from the process environment or a prefix on the command. */
export const RAW_BASH_OVERRIDE_ENV = "SLOPWEAVER_ALLOW_BASH";

/** The longest a two-command chain may be, heredoc bodies excluded (the chair's "about 200"). */
export const CHAIN_MAX_CHARS = 200;

/** How deep a `-c` payload, a substitution or a shell's heredoc is walked. */
const MAX_DEPTH = 3;

/** Each class, in the order a refusal names them, with what to use instead. */
const REPLACEMENTS: Readonly<Record<RawBashClass, string>> = {
  chain: "more than one command chained: make one Bash call per command, or use the verb that does all of it",
  "write-redirect": "a write to a file through a redirect, tee, sed w or sort -o: use the Write tool",
  "in-place-edit": "an in-place edit with sed -i or perl -i: use the Edit tool",
  sleep: "a sleep: use `slopweaver github checks --wait` for CI, the Monitor tool, or run_in_background",
  jq: "jq, which is banned: read JSON through the verb's own flags or the Read tool, edit a file with the verb that owns it or the Edit tool, and when no verb does the job, build one",
  "program-in-string": "a program written in a string (node -e, bash -c, awk '…', perl -e): use a verb",
  "loop-or-branch": "a loop, branch, function or group: use a verb that takes several ids, or one call per item",
  "substitution-or-assignment":
    "a substitution or a variable assignment: read the value in its own call and write it literally",
  "stdin-script": "a program fed a script on stdin, or a pipe into something other than a read-only filter: use a verb",
  "unreadable-wrapper":
    "a wrapper (env, nice, timeout, …) given an option this gate cannot read, so what it runs is unknown: run the program directly",
  "unreadable-heredoc":
    "a heredoc that never closes, or whose delimiter is $'…' or $\"…\", so where bash ends its body is unknown: close it on a plain 'EOF' line",
  "expanding-option":
    "a glob or expansion leading an argument to a program whose options this gate reads (an evaluator, awk, sed, sort), so it may expand to an option: write it as ./*.ts, or put -- before it",
  "split-word":
    "a backslash-newline inside a word or straight after an operator, which bash removes before it reads the line: put a space before the backslash, or write it on one line",
};

/** The canonical order classes are reported in. */
const ORDER: readonly RawBashClass[] = [
  "chain",
  "write-redirect",
  "in-place-edit",
  "sleep",
  "jq",
  "program-in-string",
  "loop-or-branch",
  "substitution-or-assignment",
  "stdin-script",
  "unreadable-wrapper",
  "unreadable-heredoc",
  "expanding-option",
  "split-word",
];

/** What the gate decided about one command. */
export type RawBashVerdict =
  | { readonly blocked: false }
  | { readonly blocked: true; readonly classes: readonly RawBashClass[]; readonly message: string };

/** Whether a segment carries no command at all — a blank line, the tail after a heredoc, or a comment. */
function isBlank({ segment }: { segment: CommandSegment }): boolean {
  const text = segment.command.trim();
  return text.length === 0 || text.startsWith("#");
}

/** A backgrounding `&` in unquoted text: never half of `&&`, nor a redirection's `>&`, `<&`, `&>` or `|&`. */
const LONE_AMPERSAND = /(?<![&<>|])&(?![&>])/g;

/** An arithmetic expansion, to its first closing `))` or, left unclosed, to the end of the word. */
const ARITHMETIC = /\$\(\([\s\S]*?(?:\)\)|$)/g;

/**
 * Where a word backgrounds a command inside itself (`true&true`, `"a"&b`), read off its shape so a quoted `&` is
 * data. An arithmetic expansion's own span is masked first, since `&` inside `$((…))` is an operator; one left
 * unclosed masks the rest of the word.
 */
function ampersandCuts({ word }: { word: ShellWord }): readonly number[] {
  const unmasked = word.shape.replace(ARITHMETIC, (span) => "_".repeat(span.length));
  return [...unmasked.matchAll(LONE_AMPERSAND)].map((match) => match.index);
}

/** The words of one segment, cut at each backgrounding `&` into the commands it really runs. */
function backgrounded({ words }: { words: readonly ShellWord[] }): readonly (readonly ShellWord[])[] {
  const parts: ShellWord[][] = [[]];
  for (const word of words) {
    let start = 0;
    for (const cut of ampersandCuts({ word })) {
      if (cut > start) parts.at(-1)!.push(slicedWord({ end: cut, start, word }));
      parts.push([]);
      start = cut + 1;
    }
    if (word.text.length > start) parts.at(-1)!.push(slicedWord({ end: word.text.length, start, word }));
  }
  return parts.filter((part) => part.length > 0);
}

/** The pipelines of a command line: segments joined by `|`, split at every other separator. */
function pipelines({ segments }: { segments: readonly CommandSegment[] }): readonly (readonly CommandSegment[])[] {
  const found: CommandSegment[][] = [];
  let current: CommandSegment[] = [];
  for (const segment of segments) {
    current.push(segment);
    if (segment.separatorAfter !== "|") {
      found.push(current);
      current = [];
    }
  }
  if (current.length > 0) found.push(current);
  return found;
}

/** The command's length with every heredoc body, and its terminator line, taken out. */
function scriptLength({ command, segments }: { command: string; segments: readonly CommandSegment[] }): number {
  const bodies = segments.flatMap((segment) => segment.heredocs);
  return bodies.reduce(
    (length, heredoc) => length - heredoc.body.length - heredoc.delimiter.length - 2,
    command.trim().length,
  );
}

/** Every class one command line hits, walking its nested scripts while depth remains. */
function scriptClasses({ command, depth }: { command: string; depth: number }): ReadonlySet<RawBashClass> {
  const found = new Set<RawBashClass>();
  const segments = commandSegments({ command }).filter((segment) => !isBlank({ segment }));
  const nested: string[] = [];
  let commands = 0;
  for (const pipeline of pipelines({ segments })) {
    pipeline.forEach((segment, position) => {
      const { words, substitutions, splitsWord } = shellWords({ text: segment.command });
      // Bash removes a backslash-newline before it reads a token, so one glued inside a word or to the operator
      // before it (`$\⏎[1<<2]`, `|\⏎|`) can join what the segmenter read as two tokens.
      if (splitsWord || segment.command.startsWith("\\\n")) found.add("split-word");
      // An unquoted heredoc body expands its substitutions before any program reads it, `cat` included.
      const unquoted = segment.heredocs.filter((heredoc) => !heredoc.quoted);
      const expanded = unquoted.flatMap((heredoc) => bodySubstitutions({ body: heredoc.body }));
      const assigning = unquoted.filter((heredoc) => assignsInExpansion({ text: heredoc.body }));
      if (substitutions.length + expanded.length + assigning.length > 0) found.add("substitution-or-assignment");
      // A body this lexer may have ended somewhere bash does not could be hiding the commands after it.
      if (segment.heredocs.some((heredoc) => !heredoc.readable)) found.add("unreadable-heredoc");
      nested.push(...substitutions, ...expanded);
      const heredoc = stdinHeredocIndex({ command: segment.command });
      let fedBody = heredoc === undefined ? undefined : segment.heredocs[heredoc]?.body;
      // A heredoc held on another descriptor still reaches a program that names it: `bash /dev/fd/3 3<<'EOF'` runs
      // the body, so any heredoc the segment opens counts as fed.
      if (fedBody === undefined && segment.heredocs.length > 0) fedBody = segment.heredocs[0]!.body;
      const parts = backgrounded({ words });
      commands += position === 0 ? parts.length : parts.length - 1;
      parts.forEach((part, index) => {
        const finding = stageFinding({ later: position > 0 && index === 0, stdinBody: fedBody, words: part });
        for (const kind of finding.classes) found.add(kind);
        nested.push(...finding.nested);
      });
    });
  }
  if (commands > 2 || (commands === 2 && scriptLength({ command, segments }) > CHAIN_MAX_CHARS)) found.add("chain");
  if (depth < MAX_DEPTH) {
    for (const inner of nested) {
      for (const kind of scriptClasses({ command: inner, depth: depth + 1 })) found.add(kind);
    }
  }
  return found;
}

/** Whether the command's own first command carries a `SLOPWEAVER_ALLOW_BASH=1` prefix. */
function openedInline({ command }: { command: string }): boolean {
  const first = commandSegments({ command }).findIndex((segment) => !isBlank({ segment }));
  return first !== -1 && hasCommandSegmentOverride({ command, name: RAW_BASH_OVERRIDE_ENV, segmentIndex: first });
}

/**
 * Judge one Bash command.
 *
 * @param command the Bash tool's command, exactly as the model wrote it
 * @param allowBash whether the process environment carries `SLOPWEAVER_ALLOW_BASH=1`
 * @returns not blocked, or every class the command hits with the four-line refusal naming each replacement
 */
export function classifyRawBash({ command, allowBash }: { command: string; allowBash: boolean }): RawBashVerdict {
  if (allowBash || openedInline({ command })) return { blocked: false };
  const found = scriptClasses({ command, depth: 0 });
  return verdictOf({ classes: ORDER.filter((kind) => found.has(kind)) });
}

/**
 * Judge one `Monitor` command for jq alone. A Monitor is a watch loop by design — an `until`, a `sleep`, a chain —
 * so the script classes are its shape rather than a defect, but jq is banned wherever it runs,
 * and a Monitor was the one shell line it still reached.
 *
 * @param command the Monitor tool's command
 * @param allowBash whether the process environment carries `SLOPWEAVER_ALLOW_BASH=1`
 * @returns not blocked, or the jq refusal
 */
export function classifyMonitorCommand({
  command,
  allowBash,
}: {
  command: string;
  allowBash: boolean;
}): RawBashVerdict {
  if (allowBash || openedInline({ command })) return { blocked: false };
  const runsJq = scriptClasses({ command, depth: 0 }).has("jq");
  return verdictOf({ classes: runsJq ? ["jq"] : [] });
}

/** The verdict for the classes a command hit: allowed when none, else the refusal naming each replacement. */
function verdictOf({ classes }: { classes: readonly RawBashClass[] }): RawBashVerdict {
  if (classes.length === 0) return { blocked: false };
  const detail = classes.map((kind) => REPLACEMENTS[kind]).join("; ");
  return { blocked: true, classes, message: hatchRefusal({ detail, hatch: hatchFor({ id: "raw-bash" }) }) };
}
