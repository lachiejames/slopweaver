/**
 * `slopweaver transcripts last-turn --session <id>` — one session's latest turn as ordered parts: the words
 * that opened it, then every text, thinking block and tool call after it, each call joined to its result.
 *
 * What the console's read-only session view shells (`site/lib/sessionTurnVerb.ts`), so the page shows what a
 * running session is saying without the console ever reading a transcript itself. The fold is
 * {@link foldLastTurn}; this module is the thin shell that finds the file and reads its TAIL — never the
 * whole of it, because a long session's transcript runs to hundreds of megabytes and a turn lives at the end.
 */
import { statSync } from "node:fs";

import { logger } from "#lib/logger.js";
import type { Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";
import { readTail } from "../../../sessions/liveSessionStore.js";
import { foldLastTurn, type LastTurn, MAX_TURNS } from "../../../transcripts/lastTurn.js";
import { claudeProjectsDir, findTranscript } from "../../../transcripts/source.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";

/** argv positions before the verb's own arguments: `node`, `index.js`, `transcripts`, `last-turn`. */
const VERB_ARG_OFFSET = 4;

/**
 * How much of a transcript's end is read. A turn of a few hundred tool calls with capped output fits well
 * inside it; a turn that does not is answered with `turnStartSeen: false`, never as if it were whole.
 */
export const LAST_TURN_TAIL_BYTES = 8 * 1024 * 1024;

/** A Claude Code session id: a UUID, and nothing that could name a path. */
const SESSION_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BOOLEAN_FLAGS: readonly string[] = ["json"];
const STRING_FLAGS: readonly string[] = ["session", "projects", "turns"];
const LAST_TURN_FLAGS: FlagSpec = { boolean: [...BOOLEAN_FLAGS], string: [...STRING_FLAGS] };

/** `--`-prefixed, for the help-truth ratchet. */
export const TRANSCRIPTS_LAST_TURN_FLAG_NAMES: readonly string[] = [...STRING_FLAGS, ...BOOLEAN_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `transcripts last-turn` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after `transcripts last-turn`
 * @returns the parsed flags, or every problem found
 */
export function parseTranscriptsLastTurnArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: LAST_TURN_FLAGS });
}

export const LAST_TURN_USAGE =
  "usage: slopweaver transcripts last-turn --session <id> [--turns <n>] [--projects <dir>] [--json]\n" +
  "  One session's latest turn: the words that opened it, then every text, thinking block and tool call after\n" +
  "  it in order, each call joined to its result. --turns <n> (1-40, default 1) adds the turns before it that\n" +
  "  the tail holds. Reads only the last 8 MiB of the transcript; every string is capped and secret-redacted,\n" +
  "  and only the newest 400 parts across the whole answer are kept. --json prints ONE object — sessionId,\n" +
  "  turnId, prompt, parts, partsDropped, earlier, earlierTurnsInTail, turnStartSeen, lastTimestamp, model, cwd.\n" +
  "\n" +
  "example: slopweaver transcripts last-turn --session a0000018-0000-4000-8000-000000000021 --json";

/** Everything `transcripts last-turn` touches outside itself, injected so a test drives the whole verb. */
export interface LastTurnDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** Where the transcripts live when `--projects` is not given. */
  readonly projectsDir: () => string;
}

/**
 * Read a transcript's tail as whole lines.
 *
 * @returns the lines, oldest first, and whether they begin at the file's first byte
 */
function tailLines({ path }: { path: string }): { lines: readonly string[]; fromStart: boolean } {
  const fromStart = statSync(path).size <= LAST_TURN_TAIL_BYTES;
  const lines = readTail({ maxBytes: LAST_TURN_TAIL_BYTES, path }).split("\n");
  // A tail that began mid-file began mid-line: its first fragment is not a record.
  return { fromStart, lines: fromStart ? lines : lines.slice(1) };
}

/** One human-readable line per part. */
function partLines({ parts }: { parts: LastTurn["parts"] }): readonly string[] {
  return parts.map((part) => {
    if (part.type === "tool") {
      return `  [${part.state}] ${part.toolName}`;
    }
    return `  ${part.type}: ${part.text.split("\n")[0]!.slice(0, 120)}`;
  });
}

/** The human-readable lines for every turn answered, oldest first, one per part. */
function turnLines({ sessionId, turn }: { sessionId: string; turn: LastTurn }): readonly string[] {
  const head = `transcripts last-turn: ${sessionId} — ${String(turn.parts.length)} part(s), last record ${turn.lastTimestamp}, ${String(turn.earlierTurnsInTail)} earlier turn(s) in the tail`;
  const earlier = turn.earlier.flatMap((slice) => [
    `  > ${slice.prompt.text.split("\n")[0]!.slice(0, 120)}`,
    ...partLines({ parts: slice.parts }),
  ]);
  const prompt =
    turn.prompt === undefined ? "  (the turn's opening was not in the tail read)" : `  > ${turn.prompt.text}`;
  return [head, ...earlier, prompt, ...partLines({ parts: turn.parts })];
}

/**
 * The `--turns` value as a count, or the reason it is refused.
 *
 * @param raw the flag's value, absent when the flag was not given
 * @returns the count — 1 when absent — or the refusal
 */
function turnsOf({ raw }: { raw: unknown }): { count: number } | { refused: string } {
  if (raw === undefined) {
    return { count: 1 };
  }
  const count = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(count) || count < 1 || count > MAX_TURNS) {
    return { refused: `transcripts last-turn: --turns must be a whole number from 1 to ${String(MAX_TURNS)}` };
  }
  return { count };
}

/**
 * Run `transcripts last-turn` against injected seams.
 *
 * @param rest the argv tail after `transcripts last-turn`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runTranscriptsLastTurn({ rest, deps }: { rest: readonly string[]; deps: LastTurnDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(LAST_TURN_USAGE);
    return EXIT_OK;
  }
  const parsed = parseTranscriptsLastTurnArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(LAST_TURN_USAGE);
    return EXIT_USAGE;
  }
  const { values } = parsed.value;
  const sessionId = values["session"];
  if (typeof sessionId !== "string" || !SESSION_ID_SHAPE.test(sessionId)) {
    deps.writeDiagnostic("transcripts last-turn: --session <id> is required, and must be a Claude session id (a UUID)");
    deps.writeDiagnostic(LAST_TURN_USAGE);
    return EXIT_USAGE;
  }
  const turns = turnsOf({ raw: values["turns"] });
  if ("refused" in turns) {
    deps.writeDiagnostic(turns.refused);
    deps.writeDiagnostic(LAST_TURN_USAGE);
    return EXIT_USAGE;
  }
  const projects = values["projects"];
  const projectsDir = typeof projects === "string" ? projects : deps.projectsDir();
  const located = findTranscript({ projectsDir, sessionId });
  if (located.isErr()) {
    deps.writeDiagnostic(`transcripts last-turn: ${located.error.message}`);
    return EXIT_ERROR;
  }
  let tail: { lines: readonly string[]; fromStart: boolean };
  try {
    tail = tailLines({ path: located.value });
  } catch (cause) {
    deps.writeDiagnostic(`transcripts last-turn: could not read ${located.value}: ${String(cause)}`);
    return EXIT_ERROR;
  }
  const turn = foldLastTurn({ ...tail, turns: turns.count });
  if (values["json"] === true) {
    deps.writeOut(safeJsonStringify({ label: `the last turn of ${sessionId}`, value: { sessionId, ...turn } }));
    return EXIT_OK;
  }
  turnLines({ sessionId, turn }).forEach((line) => {
    deps.writeOut(line);
  });
  return EXIT_OK;
}

/**
 * The real seams: the two output channels and this machine's transcripts directory.
 *
 * @returns the production dependencies for {@link runTranscriptsLastTurn}
 */
export function productionLastTurnDeps(): LastTurnDeps {
  return {
    projectsDir: claudeProjectsDir,
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver transcripts last-turn`. */
export const transcriptsLastTurnCommand = defineCommand({
  run: (argv) => runTranscriptsLastTurn({ deps: productionLastTurnDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
