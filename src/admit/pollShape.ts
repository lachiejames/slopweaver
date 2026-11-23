/**
 * The pure classifier behind the poll gate: is this tool call a POLL — a turn that only looks at whether
 * something else has finished — and if so, what is it looking at?
 *
 * ## Why a poll is a class, not a command
 *
 * Measured by replaying every tool call of the previous 24 hours from every transcript on the
 * machine through THIS classifier (`~/.slopweaver/evidence/token-usage-audit-03sep.md`, reproduce with the
 * replay script it names): 1,959 of the fleet's 15,540 requests did nothing but re-read a log, `kill -0` a
 * pid, call `TaskOutput` again, or run an `until` loop — 13.7% of the day's spend — and 642 of the 909
 * repeats of a target came under 60 seconds after the previous one (median 16s), each re-sending a
 * ~300K-token context to learn that nothing had changed. The rule: never poll; set monitors with timeouts
 * on everything.
 *
 * ## What counts
 *
 * A `Bash` call is poll-shaped when EVERY segment of it is a probe or a no-op. A probe is a read of a
 * log-like file (`cat`/`head`/`wc`/`grep`/`ls`/`stat` on a path under a temp or state directory, or with a
 * log extension), a `tail` of anything, a `kill -0`, a `sleep`, a `test -f`, or an `until`/`while`/`for` loop —
 * because a loop that waits in the foreground is the same turn-per-tick cost with extra steps. A no-op is a
 * `cd`, an `echo`, a `date`, a variable assignment. One segment that does real work makes the whole call
 * work, never a poll: a compound command is judged segment by segment for the same reason `rawTools.ts`
 * does it. A `TaskOutput` call is a poll of its task. `Monitor` is the recipe, never a poll.
 *
 * The TARGET is what the gate keys its 60-second window on: the file paths and pids the probes name, or,
 * for a loop that names none, the loop text itself. A leading `S=/some/dir` assignment is substituted into
 * later segments, because `S=…; tail -c 400 "$S/validate.log"` was the second most common poll shape measured.
 * Beside the target it hands back the PATHS, when every probe is a file, so the gate can tell a static file from
 * a growing one (`./pollFingerprint.ts`): the window is the clock rule, the paths are what lets an unchanged
 * file through it.
 */
import {
  ASSIGNMENT,
  bareCommandWord,
  hasInertDollar,
  LOG_EXTENSIONS,
  MAX_EXPANDED_CHARS,
  neutralReads,
  readOperands,
  shellWords,
  substituteLiteralAssignments,
} from "./pollWords.js";
import { shellSegments } from "./shellSegments.js";

/** What the classifier concluded about one tool call. */
export type PollShape =
  | { readonly kind: "not-poll" }
  | {
      readonly kind: "poll";
      /** The stable key the gate stores the last-seen instant under. */
      readonly target: string;
      /** A short human label for the refusal (`log read`, `pid probe`, `task output`, `foreground loop`). */
      readonly label: string;
      /**
       * Every path-looking operand the read probes name, sorted, which `./pollFingerprint.ts` stats to tell a
       * static file from a growing one; each must exist. EMPTY when any probe is not a file read — a pid, a task, a
       * foreground loop — because a token for the files alone would vouch for a target it does not cover, and empty
       * keeps the clock rule.
       */
      readonly paths: readonly string[];
      /**
       * The read probes' OTHER operands — a grep pattern, a bare file name with no slash or log extension — which
       * the classifier cannot tell apart without the filesystem. The token includes each that exists as a regular
       * file, and refuses to vouch when one exists as anything else.
       */
      readonly operands: readonly string[];
    };

/**
 * A foreground wait loop: `while`/`until`/`for` … `sleep` … `done`. A loop with no sleep in it is processing,
 * not waiting.
 *
 * **`for` is in this alternation because leaving it out made the gate blind to four fifths of the class it
 * exists to refuse.** MEASURED over 185,333 Bash calls deduplicated by tool-use id from every
 * transcript on the machine: of 841 foreground poll loops written, **665 were
 * `for i in $(seq 1 N); do … sleep N; done`** and named no `while` or `until` anywhere. Such a command never
 * reached this branch, and the segment walk below then judged its `slopweaver …` body real WORK and returned
 * `not-poll` — so a bounded counting loop around a provider read was invisible while the identical `while`
 * spelling was refused. Repro: extract every Bash `tool_use` from `~/.claude/projects/**`, dedupe
 * by `.id`, `grep -E '(while|for) .*sleep [0-9]'`, then `grep -E 'for [A-Za-z_]+ in ' | grep -vE '(while|until) '`.
 *
 * A `for` that iterates real work and sleeps between items is caught too, and that is the same trade the
 * `while` arm has always made: the gate refuses only the SECOND run of one within a minute, so a loop run once
 * is untouched and a loop re-run unchanged is the thing being priced.
 *
 * **The `for` arm demands loop SYNTAX, and that is not symmetry with the other two — it is the price of the
 * word.** `while` and `until` match bare because they are rare outside a loop; "for" is one of the commonest
 * words in English, and this matcher reads a command's whole text. Measured on the shipped classifier,
 * `git commit -m "Wait for the lock instead of a sleep loop; the retry is done"` matched a bare `\bfor\b`
 * alternation — for, then sleep, then done, all three inside one quoted message — and a `git commit` is real
 * work with no loop in it at all. So this arm requires `for <name> in` or the C-style `for ((`, which is the
 * same criterion the measurement above used (`grep -E 'for [A-Za-z_]+ in '`) and still covers all 665.
 */
const WAIT_LOOP =
  /(?:\b(?:until|while)\b|\bfor\s+(?:[A-Za-z_][A-Za-z0-9_]*\s+in\b|\(\())[\s\S]*?\bsleep\b[\s\S]*?\bdone\b/;

/** The same three keywords, anchored — a real loop OPENS a segment; a quoted example of one sits inside a word. */
const LOOP_OPENER = /^(?:(?:until|while)\b|for\s+(?:[A-Za-z_][A-Za-z0-9_]*\s+in\b|\(\())/;

/**
 * Whether a command is a foreground wait loop: the shape above, opened by a segment that really starts with
 * the keyword.
 *
 * **Both halves are load-bearing, and the second was written the first time this gate refused a real call.**
 * `slopweaver knowledge record --evidence "665 were \`for i in $(seq 1 N); do … sleep N; done\`"` carries a
 * perfect loop inside one quoted argument, and the shape test alone cannot tell a loop from a description of
 * one. `shellSegments` is quote-aware, so that whole command is ONE segment whose first word is
 * `slopweaver` — while every real loop measured puts `for`, `while` or `until` at the head of a segment. No
 * regex over raw text can draw that line; the splitter can.
 *
 * @param command the tool call's command text
 * @returns true when some segment opens a loop and a `sleep` and a `done` follow the keyword
 */
function isWaitLoop({ command }: { command: string }): boolean {
  if (!WAIT_LOOP.test(command)) {
    return false;
  }
  return shellSegments({ command }).some((segment) => LOOP_OPENER.test(segment.command.trim()));
}

/** Command words that never do anything the gate cares about, so they neither qualify nor disqualify. */
const NEUTRAL_WORDS: ReadonlySet<string> = new Set([
  "cd",
  "echo",
  "date",
  "true",
  ":",
  "export",
  "set",
  "printf",
  "pwd",
]);

/**
 * Stream filters. With no path of their own they only reshape what a probe before them in the pipe produced
 * (`cat x.output | tail -12`, `| cut -c1-300`), so they neither qualify nor disqualify a call.
 */
const FILTER_WORDS: ReadonlySet<string> = new Set([
  "tail",
  "head",
  "cut",
  "grep",
  "egrep",
  "wc",
  "sort",
  "uniq",
  "tr",
  "sed",
  "awk",
  "jq",
  "column",
]);

/** Command words that read a file. The read is a probe only when the file looks like a log (see below). */
const FILE_READ_WORDS: ReadonlySet<string> = new Set([
  "cat",
  "head",
  "wc",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ls",
  "stat",
  "test",
  "[",
]);

/**
 * File reads that report what a file IS rather than what it holds — its access time, mode, owner, link count, a
 * directory's entries — none of which the change token covers. `stat -f %a` answers differently after any other
 * process reads the file, and access time cannot join the token: the first poll's own read
 * moves it. So these stay polls, and carry no token.
 */
const METADATA_READ_WORDS: ReadonlySet<string> = new Set(["ls", "stat", "test", "["]);

/** Path fragments that mark a file as scratch or state — somewhere a background process writes its progress. */
const LOG_DIR_MARKERS: readonly string[] = ["/tmp/", "/var/folders/", "/scratchpad/", "/.slopweaver/", "/.claude/"];

/**
 * Split one segment into shell words, dropping quotes. Deliberately shallow: no expansion beyond the
 * assignments the caller already substituted.
 *
 * @param text the segment text
 * @returns the words
 */
function words({ text }: { text: string }): readonly string[] {
  return Array.from(text.matchAll(/"[^"]*"|'[^']*'|\S+/g), ([word]) => word.replace(/^["']|["']$/g, ""));
}

/**
 * Whether a path names something a background process writes progress to.
 *
 * @param path the candidate path
 * @returns true for a scratch, temp or state path, or a log-extension file
 */
export function isLogLikePath({ path }: { path: string }): boolean {
  return LOG_DIR_MARKERS.some((marker) => path.includes(marker)) || LOG_EXTENSIONS.test(path);
}

/**
 * The first word of a segment that looks like a file path — contains a slash or a log extension, and is
 * not an option.
 *
 * @param segmentWords the segment's words after the command word
 * @returns the path, or `undefined`
 */
function firstPath({ segmentWords }: { segmentWords: readonly string[] }): string | undefined {
  return segmentWords.find(
    (word) => !word.startsWith("-") && !/^\d*[<>]/.test(word) && (word.includes("/") || LOG_EXTENSIONS.test(word)),
  );
}

/** A `cd`, `pushd` or `popd` anywhere in a command, as a word on its own. */
const CHANGES_DIRECTORY = /(?:^|[\s(;&|`])(?:cd|pushd|popd)(?=$|[\s;&|)])/;

/** The same words, matched against a segment's lexed command word so a quoted `'cd'` is caught too. */
const DIRECTORY_WORDS: ReadonlySet<string> = new Set(["cd", "pushd", "popd"]);

/**
 * Shell state that decides how an unquoted expansion splits or globs: `IFS` named anywhere, or an option builtin as a
 * command word. `IFS=,; X=a.log,b.log; tail $X` reads two files the substituted text names as one.
 */
const SPLITS_EXPANSIONS = /\bIFS\b/;

/**
 * Any character but printable ASCII, tab and newline. Whitespace JavaScript splits on and the shell does not — a
 * no-break space, a carriage return — would make the segmenter this classifier shares with origin/main read
 * `notes<U+00A0>file` as two missing names while grep opens one real file, and Unicode's own whitespace is wider than
 * `\s` (U+0085). Rather than enumerate those classes, a call carrying any character outside this set names no file.
 */
const BEYOND_PRINTABLE_ASCII = /[^\t\n\x20-\x7e]/;

/** The option builtins of bash and zsh, matched against a segment's command word. */
const OPTION_WORDS: ReadonlySet<string> = new Set(["set", "setopt", "unsetopt", "shopt", "emulate"]);

/** One segment's verdict: neutral, a probe of a target, or real work. */
type SegmentVerdict =
  | { readonly kind: "neutral" }
  | { readonly kind: "work" }
  | {
      readonly kind: "probe";
      readonly target: string;
      readonly label: string;
      /**
       * For a file read, every path-looking operand and every other operand; absent for any other probe, and for a
       * read with a word that could hide a file.
       */
      readonly files?: { readonly paths: readonly string[]; readonly operands: readonly string[] } | undefined;
    };

/**
 * Judge a segment whose command word is a pid probe (`kill -0 <pid>`, `ps -p <pid>`), or report that it is not one.
 *
 * @param word the command word, path stripped
 * @param rest the words after it
 * @returns the probe, or `undefined` when the word is not a pid probe
 */
function pidProbe({ word, rest }: { word: string; rest: readonly string[] }): SegmentVerdict | undefined {
  if (word === "kill" && rest[0] === "-0" && rest[1] !== undefined) {
    return { kind: "probe", label: "pid probe", target: `pid:${rest[1]}` };
  }
  if (word === "ps") {
    const pidIndex = rest.indexOf("-p");
    const pid = pidIndex === -1 ? undefined : rest[pidIndex + 1];
    return pid === undefined ? { kind: "work" } : { kind: "probe", label: "pid probe", target: `pid:${pid}` };
  }
  return undefined;
}

/**
 * Judge a segment whose command word reads or filters a file: `tail` of anything, a log-like read, or a
 * bare filter riding a pipe.
 *
 * @param word the command word, path stripped
 * @param path the first path-looking argument, if any
 * @param text the whole segment, which a file read's operands are lexed from
 * @param lex whether to lex its operands at all — false once the call can carry no token
 * @returns the verdict
 */
function readVerdict({
  word,
  path,
  text,
  lex,
}: {
  word: string;
  path: string | undefined;
  text: string;
  lex: boolean;
}): SegmentVerdict {
  // `rg` reads ignore files and a config file the command never names, and a metadata read reports what the token does
  // not cover, so neither ever carries a token.
  const files = word === "rg" || METADATA_READ_WORDS.has(word) || !lex ? undefined : readOperands({ text });
  if (word === "tail") {
    return path === undefined ? { kind: "neutral" } : { files, kind: "probe", label: "log read", target: path };
  }
  if (FILE_READ_WORDS.has(word) && path !== undefined && isLogLikePath({ path })) {
    return { files, kind: "probe", label: "log read", target: path };
  }
  if (FILTER_WORDS.has(word) && path === undefined) {
    return { kind: "neutral" };
  }
  return { kind: "work" };
}

/**
 * Judge one segment on its own words.
 *
 * @param text the segment, assignments already substituted
 * @param lex whether a file read's operands are lexed — false once the call can carry no token
 * @returns the verdict
 */
function judgeSegment({ text, lex }: { text: string; lex: boolean }): SegmentVerdict {
  const trimmed = text.trim();
  if (trimmed.length === 0 || ASSIGNMENT.test(trimmed)) {
    return { kind: "neutral" };
  }
  const [command, ...rest] = words({ text: trimmed });
  if (command === undefined) {
    return { kind: "neutral" };
  }
  const word = command.replace(/^.*\//, "");
  if (NEUTRAL_WORDS.has(word)) {
    return { kind: "neutral" };
  }
  if (word === "sleep") {
    return { kind: "probe", label: "sleep", target: "sleep" };
  }
  const present = pidProbe({ rest, word });
  if (present === undefined) {
    return readVerdict({ lex, path: firstPath({ segmentWords: rest }), text: trimmed, word });
  }
  return present;
}

/**
 * Substitute the leading `NAME=value` assignments of a command into every later segment — the shallow rule the
 * gate's TARGET is keyed by, so a record written before the change token existed still matches the same call.
 *
 * @param segments the segment texts in order
 * @returns the same segments with `$NAME`, `${NAME}` and `"$NAME"` replaced
 */
function substituteAssignments({ segments }: { segments: readonly string[] }): readonly string[] {
  const bindings = new Map<string, string>();
  return segments.map((segment) => {
    let text = segment;
    for (const [name, value] of bindings) {
      text = text.replaceAll(`\${${name}}`, value).replaceAll(`$${name}`, value);
    }
    const match = ASSIGNMENT.exec(text.trim());
    if (match !== null && !/\s/.test(match[2]!.replace(/^["']|["']$/g, ""))) {
      bindings.set(match[1]!, match[2]!.replace(/^["']|["']$/g, ""));
    }
    return text;
  });
}

/** Command or process substitution, in bash or zsh: it runs a command whose reads no word of this one names. */
const SUBSTITUTION = /\$\(|`|[<>=]\(/;

/** What a foreground wait loop waits on: the path it polls, else the pid it probes, else the loop's own text. */
function waitLoopTarget({ command }: { command: string }): string {
  const inner = words({ text: command }).map((word) => word.replace(/[;&|]+$/, ""));
  const path = inner.find((word) => !word.startsWith("-") && word.includes("/"));
  if (path !== undefined) {
    return path;
  }
  const pid = /kill -0\s+(\S+)/.exec(command)?.[1];
  if (pid !== undefined) {
    return `pid:${pid}`;
  }
  return `loop:${command.replace(/\s+/g, " ").trim().slice(0, 200)}`;
}

/**
 * Whether the change token may cover the call at all, before any segment is lexed: the strict substitution pass agrees
 * with the shallow one, and nothing in the command expands, splits or runs a word the token would not see.
 *
 * @param command the tool call's command text
 * @param raw the segment texts as written
 * @param segments the same segments after the shallow substitution the target is keyed by
 * @returns true when the token may still cover the call
 */
function strictPassAgrees({
  command,
  raw,
  segments,
}: {
  command: string;
  raw: readonly string[];
  segments: readonly string[];
}): boolean {
  const literal = substituteLiteralAssignments({ segments: raw });
  const substituted = segments.some((text, index) => text !== raw[index]);
  return (
    command.length <= MAX_EXPANDED_CHARS &&
    literal !== undefined &&
    literal.every((text, index) => text === segments[index]) &&
    !SPLITS_EXPANSIONS.test(command) &&
    !BEYOND_PRINTABLE_ASCII.test(command) &&
    !SUBSTITUTION.test(command) &&
    // The classifier judges a command by its name with any path stripped, so `~/bin/echo` or `./tail` is judged as
    // the builtin it names while running whatever that file is: the token vouches only for command words that are
    // bare and literal AS WRITTEN, before any assignment is substituted into them — `C=tail; "$C" x` names no file.
    raw.every((text) => ASSIGNMENT.test(text.trim()) || bareCommandWord({ text })) &&
    // A single-quoted `$` is inert and harmless — `grep '^\s*$'` — until an assignment is substituted into it.
    (!substituted || !hasInertDollar({ text: command }))
  );
}

/**
 * Lex one segment of a call the token still covers: add the files it names, and say whether the token survives it.
 *
 * @param text the segment, assignments already substituted
 * @param verdict the segment's own verdict, never `work`
 * @param paths the call's path-looking operands so far; added to in place
 * @param operands the call's other operands so far; added to in place
 * @returns whether the token still covers the call, and whether this segment changes directory
 */
function lexCoveredSegment({
  text,
  verdict,
  paths,
  operands,
}: {
  text: string;
  verdict: Exclude<SegmentVerdict, { kind: "work" }>;
  paths: Set<string>;
  operands: Set<string>;
}): { covers: boolean; changesDirectory: boolean } {
  const commandWord = shellWords({ text })[0];
  // The command word as the shell sees it, quotes removed: `'cd' /x` changes directory as surely as `cd /x`.
  const changesDirectory = commandWord !== undefined && DIRECTORY_WORDS.has(commandWord.value);
  let covers = !(commandWord !== undefined && OPTION_WORDS.has(commandWord.value));
  if (verdict.kind === "neutral") {
    const read = neutralReads({ text });
    covers = covers && read !== undefined;
    read?.forEach((operand) => operands.add(operand));
  }
  if (verdict.kind === "probe" && verdict.files === undefined) {
    // A sleep reads nothing, but its words still pass the same check: `sleep 0 </tmp/x` opens a file.
    const quietSleep = verdict.target === "sleep" && readOperands({ text }) !== undefined;
    covers = covers && quietSleep;
  }
  if (verdict.kind === "probe" && verdict.files !== undefined) {
    verdict.files.paths.forEach((path) => paths.add(path));
    verdict.files.operands.forEach((operand) => operands.add(operand));
  }
  return { changesDirectory, covers };
}

/**
 * Classify a `Bash` command.
 *
 * @param command the tool call's command text
 * @returns a poll with its target when every segment is a probe or a no-op and at least one is a probe
 */
export function classifyBashPoll({ command }: { command: string }): PollShape {
  if (isWaitLoop({ command })) {
    // A loop waits in the foreground on whatever its body reads, so it never carries a token: the clock rule.
    return { kind: "poll", label: "foreground loop", operands: [], paths: [], target: waitLoopTarget({ command }) };
  }
  const raw = shellSegments({ command }).map((segment) => segment.command);
  const segments = substituteAssignments({ segments: raw });
  const targets: string[] = [];
  const labels = new Set<string>();
  const paths = new Set<string>();
  const operands = new Set<string>();
  // Every lexing below sits behind the strict pass's agreement, so it is skipped once the call can carry no token.
  let tokenCoversTheCall = strictPassAgrees({ command, raw, segments });
  let changesDirectory = CHANGES_DIRECTORY.test(command);
  // Once the call can carry no token nothing here is lexed: what is left is origin/main's own walk over its own
  // expanded text. While it still can, every segment equals the strict pass's, which stays inside its budget.
  for (const text of segments) {
    const verdict = judgeSegment({ lex: tokenCoversTheCall, text });
    if (verdict.kind === "work") {
      return { kind: "not-poll" };
    }
    if (verdict.kind === "probe") {
      targets.push(verdict.target);
      labels.add(verdict.label);
    }
    if (tokenCoversTheCall) {
      const lexed = lexCoveredSegment({ operands, paths, text, verdict });
      changesDirectory = changesDirectory || lexed.changesDirectory;
      tokenCoversTheCall = lexed.covers;
    }
  }
  const real = targets.filter((target) => target !== "sleep");
  if (real.length === 0) {
    return { kind: "not-poll" };
  }
  const unique = [...new Set(real)].toSorted();
  // A directory change inside the command moves where a relative word lands, away from the payload's cwd the token
  // resolves against, and walks a directory the token never records — so a command that changes directory names no
  // file at all.
  const nameable = tokenCoversTheCall && !changesDirectory;
  return {
    kind: "poll",
    label: [...labels].filter((label) => label !== "sleep").join(" + "),
    operands: nameable ? [...operands].toSorted() : [],
    paths: nameable ? [...paths].toSorted() : [],
    target: unique.join(" "),
  };
}

/**
 * Classify one PreToolUse call by tool name and input.
 *
 * @param toolName the `tool_name` from the payload
 * @param toolInput the `tool_input` from the payload
 * @returns the poll shape, or `not-poll` for a tool this gate does not judge
 */
export function classifyPollShape({
  toolName,
  toolInput,
}: {
  toolName: string;
  toolInput: Readonly<Record<string, unknown>>;
}): PollShape {
  if (toolName === "Bash") {
    const command = toolInput["command"];
    return typeof command === "string" ? classifyBashPoll({ command }) : { kind: "not-poll" };
  }
  if (toolName === "TaskOutput") {
    const taskId = toolInput["task_id"];
    return typeof taskId === "string" && taskId.length > 0
      ? { kind: "poll", label: "task output", operands: [], paths: [], target: `task:${taskId}` }
      : { kind: "not-poll" };
  }
  return { kind: "not-poll" };
}
