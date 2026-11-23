/**
 * Does a shell line run a migration, or write to a live system? The pure classifier behind the bot-turn
 * live-write guard (`./botLiveWriteGuardRunner.ts`).
 *
 * The rule: the bot never runs a migration unless the owner explicitly asks it to, and takes no actions on
 * staging or prod, generally ever. Reading and reporting is the lane that stays open, an important layer of
 * defence; this walk is what tells the two apart on a command line.
 *
 * ## What it opens, and what it reuses
 *
 * The walk is `./pythonInvocation.ts`'s shape on purpose, over the same lexer: every segment
 * (`commandSegments`), its `$(…)` and backtick substitutions, the substitutions an unquoted heredoc expands, a
 * shell's `-c` payload or the heredoc it reads as its program — sharing ONE depth budget of {@link MAX_DEPTH}.
 * OS wrappers are peeled by `resolvePrograms`, package and container runners by `./liveWriteUnwrap.ts`, and
 * the program that is left is judged by the two tables, migration first.
 *
 * Any `slopweaver` verb is out of scope by construction: it is its own door, with its own refusals, and the
 * word `migrate` inside `slopweaver store migrate` is not evidence of anything.
 *
 * ## What it cannot see, stated
 *
 * An alias or function; a program held in a variable; a script whose NAME reveals nothing (`./deploy.sh`,
 * a package script called `release`); a migration a test suite runs against its own throwaway database; an
 * SDK write from Node or Ruby code; anything a tool runs transitively. **A refusal confirms the command
 * would write; its absence proves nothing.**
 */
import { infraFinding } from "./liveWriteInfra.js";
import { migrationFinding, scriptRunsMigration } from "./liveWriteMigrations.js";
import type { ClientStdin } from "./liveWriteSql.js";
import type { LiveWriteFinding, LiveWriteVerdict } from "./liveWriteTypes.js";
import { type Unwrapped, unwrapRunner } from "./liveWriteUnwrap.js";
import { shellInput } from "./pythonInvocation.js";
import { programName, resolvePrograms } from "./pythonWrappers.js";
import { bodySubstitutions, type ShellWord, shellWords, withoutRedirections } from "./shellLexing.js";
import { type CommandSegment, commandSegments } from "./shellSegments.js";
import { stdinHeredocIndex } from "./stdinHeredoc.js";

/** How many nested sources (payloads, substitutions, heredocs, runner layers) the walk opens. */
const MAX_DEPTH = 4;

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

/** A stdin redirection from a file — `< dump.sql`, `0<x` — and not a heredoc, here-string or `<(…)`. */
const FILE_STDIN = /^0?<(?![<(&])/;

/** A finding located in the segment that carries it. */
type Located = LiveWriteFinding & { readonly segment: string };

/** A literal word, for handing a runner's unwrapped words back to the shell grammar. */
function plainWord({ text }: { text: string }): ShellWord {
  return { dynamic: false, quoted: false, shape: text, text, unquotedPrefix: text };
}

/** What a shell runner executes, walked one level down. */
function shellFinding({
  args,
  stdin,
  depth,
}: {
  args: readonly string[];
  stdin: ClientStdin;
  depth: number;
}): LiveWriteFinding | undefined {
  const input = shellInput({ args: args.map((text) => plainWord({ text })) });
  if (depth >= MAX_DEPTH) return undefined;
  if (input.kind === "payload") return walkLine({ depth: depth + 1, line: input.line });
  if (input.kind === "stdin" && stdin?.kind === "heredoc") return walkLine({ depth: depth + 1, line: stdin.body });
  return undefined;
}

/**
 * Judge one program and its words: a shell runs its payload, a runner runs what it wraps, and anything else
 * is looked up in the migration table, then the live-write table.
 *
 * @param words the program word and its arguments, already literal
 * @param stdin what the segment's stdin reads
 * @param depth how many nested sources this walk has opened
 * @returns the finding, or `undefined`
 */
function programFinding({
  words,
  stdin,
  depth,
}: {
  words: readonly string[];
  stdin: ClientStdin;
  depth: number;
}): LiveWriteFinding | undefined {
  const [head, ...args] = words;
  if (head === undefined) return undefined;
  const name = programName({ text: head });
  if (name === "slopweaver") return undefined;
  if (SHELLS.has(name)) return shellFinding({ args, depth, stdin });
  const unwrapped = unwrapRunner({ args, name });
  if (unwrapped !== undefined) return runnerFinding({ depth, name, stdin, unwrapped });
  const migration = migrationFinding({ args, name });
  if (migration !== undefined) return migration;
  return infraFinding({ args, name, stdin });
}

/** What a package, container or task runner runs: a named script, a whole line, or another program. */
function runnerFinding({
  unwrapped,
  name,
  stdin,
  depth,
}: {
  unwrapped: Unwrapped;
  name: string;
  stdin: ClientStdin;
  depth: number;
}): LiveWriteFinding | undefined {
  if (unwrapped.kind === "script") {
    const migrates = scriptRunsMigration({ script: unwrapped.script });
    return migrates ? { kind: "migration", operation: `script ${unwrapped.script}`, tool: name } : undefined;
  }
  if (depth >= MAX_DEPTH) return undefined;
  if (unwrapped.kind === "line") return walkLine({ depth: depth + 1, line: unwrapped.line });
  return programFinding({ depth: depth + 1, stdin, words: unwrapped.words });
}

/** What one segment's stdin reads: the heredoc a shell would hand it, or a file. */
function segmentStdin({ segment, words }: { segment: CommandSegment; words: readonly ShellWord[] }): ClientStdin {
  const index = stdinHeredocIndex({ command: segment.command });
  const body = index === undefined ? undefined : segment.heredocs[index]?.body;
  if (body !== undefined) return { body, kind: "heredoc" };
  return words.some((word) => FILE_STDIN.test(word.unquotedPrefix)) ? { kind: "file" } : undefined;
}

/** One segment: what its substitutions run first, then every program its wrappers could resolve to. */
function segmentFinding({ segment, depth }: { segment: CommandSegment; depth: number }): Located | undefined {
  const { words, substitutions } = shellWords({ text: segment.command });
  if (depth < MAX_DEPTH) {
    const expanded = segment.heredocs
      .filter((heredoc) => !heredoc.quoted)
      .flatMap((h) => bodySubstitutions({ body: h.body }));
    for (const inner of [...substitutions, ...expanded]) {
      const nested = walkLine({ depth: depth + 1, line: inner });
      if (nested !== undefined) return nested;
    }
  }
  const stdin = segmentStdin({ segment, words });
  for (const resolution of resolvePrograms({ words: withoutRedirections({ words }) })) {
    if (resolution.kind !== "program" || resolution.words[0]!.dynamic) continue;
    const found = programFinding({ depth, stdin, words: resolution.words.map((word) => word.text) });
    if (found !== undefined) return { ...found, segment: segment.command.trim() };
  }
  return undefined;
}

/** Every segment of one line, in order, until one writes. */
function walkLine({ line, depth }: { line: string; depth: number }): Located | undefined {
  for (const segment of commandSegments({ command: line })) {
    const found = segmentFinding({ depth, segment });
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Classify a Bash or Monitor command line: does it run a migration, or write to a live system?
 *
 * @param command the raw command line
 * @returns the first finding, located in the segment that carries it, or `allowed`
 */
export function classifyLiveWrite({ command }: { command: string }): LiveWriteVerdict {
  const found = walkLine({ depth: 0, line: command });
  if (found !== undefined) return found;
  return { kind: "allowed" };
}
