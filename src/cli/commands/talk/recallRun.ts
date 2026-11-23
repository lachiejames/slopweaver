/**
 * `slopweaver talk recall` — "did I already give a steer on this?": the console voice's search over the owner's call
 * transcripts, the steers it relayed, the owner's rulings and the knowledge register, all time unless the owner names a window.
 *
 * The voice's `recall` and `recall_open` tools run this. `--words` answers every source's exact count and the newest
 * hits, each with a pointer; `--open <pointer>` returns one record whole, paged by `--from`. What matches and how
 * an answer is packed is `src/talk/recall.ts`; the reads are `src/talk/recallRead.ts`, `recallRulings.ts`,
 * `recallOpenRead.ts` and `recallKnowledge.ts`.
 *
 * It fits the console's 20 s tool timeout (`TOOL_TIMEOUT_MS`, `site/lib/talkToolsList.ts`) with room. MEASURED
 * on the owner's install, a loaded machine: 4.85 s for `xero steer`, 7.91 s for `xero` (the widest common
 * word), 2.45 s for a glue-only phrase; rulings are the slowest source, 7.23 s alone over 4,024 run journals, about
 * 2.2 s of it file opens and reads and the rest launcher start-up. Repro:
 * `time slopweaver talk recall --words "xero steer" --json` and `--source rulings`.
 */
import { logger } from "../../../lib/logger.js";
import { type Result } from "../../../lib/result.js";
import {
  buildRecallAnswer,
  RECALL_SOURCES,
  type RecallSearchAnswer,
  type RecallSource,
  type RecallSourceRead,
  recallWords,
} from "../../../talk/recall.js";
import { type RecallError } from "../../../talk/recallErrors.js";
import { openKnowledge, searchKnowledge } from "../../../talk/recallKnowledge.js";
import { buildRecallOpenAnswer, type RecallOpenAnswer, type RecallOpened } from "../../../talk/recallOpen.js";
import { openDiskRecall } from "../../../talk/recallOpenRead.js";
import { parseRecallPointer } from "../../../talk/recallPointer.js";
import { searchCalls, searchSteers } from "../../../talk/recallRead.js";
import { searchRulings } from "../../../talk/recallRulings.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { talkHomeOf } from "./args.js";
import { TALK_RECALL_USAGE } from "./knowUsage.js";
import { parseRecallArgs, type RecallOpenArgs, type RecallSearchArgs } from "./recallArgs.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "recall", ...]`. */
const VERB_ARG_OFFSET = 4;

/** Milliseconds in a day, for `--days`. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Run the `talk recall` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkRecall(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_RECALL_USAGE });
    return EXIT_OK;
  }
  const parsed = parseRecallArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_RECALL_USAGE });
    return EXIT_USAGE;
  }
  return talkRecall({
    args: parsed.value,
    fail: (message) => {
      logger.error({ msg: message });
    },
    out: (line) => {
      logger.out({ line });
    },
  });
}

/** Where the verb's body prints: its answer, and why it could not give one. */
interface RecallSinks {
  readonly out: (line: string) => void;
  readonly fail: (message: string) => void;
}

/**
 * The verb's body over parsed arguments: search, or open one pointer, and print the answer.
 *
 * @param args one rung's parsed arguments
 * @returns the process exit code
 */
export async function talkRecall({
  args,
  out,
  fail,
}: RecallSinks & { args: RecallSearchArgs | RecallOpenArgs }): Promise<number> {
  if (args.mode === "open") {
    return runOpen({ args, fail, out });
  }
  const searched = await search({ args });
  if (searched.isErr()) {
    fail(searched.error.message);
    return EXIT_ERROR;
  }
  const answer = searched.value;
  if (args.json) {
    out(JSON.stringify(answer));
    return EXIT_OK;
  }
  const counted = RECALL_SOURCES.map((source) => `${source} ${String(answer.counts[source])}`).join(", ");
  out(`talk recall: ${answer.words.join(" ")} — ${counted}; ${String(answer.notShown)} not shown`);
  answer.hits.forEach((hit) => {
    out(`  ${hit.atIso} ${hit.source}/${hit.who} ${hit.pointer}\n    ${hit.excerpt}`);
  });
  // A source read in part still counts what it read, so its count is a floor and says so here as in the JSON.
  answer.incomplete.forEach((partial) => {
    out(`  incomplete — ${partial.source} is at least its count: ${partial.why}`);
  });
  answer.notSearched.forEach((unsearched) => {
    out(`  not searched — ${unsearched.source}: ${unsearched.why}`);
  });
  return EXIT_OK;
}

/** Search every asked-for source and assemble the answer. */
async function search({ args }: { args: RecallSearchArgs }): Promise<Result<RecallSearchAnswer, RecallError>> {
  const home = talkHomeOf({ home: args.home });
  const words = recallWords({ phrase: args.words });
  let sinceMs: number | undefined;
  if (args.days !== undefined) {
    const nowMs = args.now === undefined ? Date.now() : Date.parse(args.now);
    sinceMs = nowMs - args.days * DAY_MS;
  }
  const sinceIso = sinceMs === undefined ? null : new Date(sinceMs).toISOString();
  const skipped = ({ source }: { source: RecallSource }): string | undefined => {
    if (words.length === 0) {
      return "the words had nothing searchable in them";
    }
    if (args.source !== undefined && args.source !== source) {
      return `not asked for: --source ${args.source}`;
    }
    return undefined;
  };
  const disk = ({ source, read }: { source: RecallSource; read: () => RecallSourceRead }): RecallSourceRead => {
    const why = skipped({ source });
    return why === undefined ? read() : { searched: false, why };
  };
  // The disk sources first, then the store inside its own deadline, so a slow store cannot cost the disk answer.
  const calls = disk({ read: () => searchCalls({ home, sinceMs, words }), source: "calls" });
  const steers = disk({ read: () => searchSteers({ home, sinceMs, words }), source: "steers" });
  const rulings = disk({ read: () => searchRulings({ home, sinceMs, words }), source: "rulings" });
  const knowledgeSkipped = skipped({ source: "knowledge" });
  let knowledge: RecallSourceRead;
  if (knowledgeSkipped === undefined) {
    knowledge = await searchKnowledge({ sinceIso, words });
  } else {
    knowledge = { searched: false, why: knowledgeSkipped };
  }
  return buildRecallAnswer({ maxBytes: args.maxBytes, reads: { calls, knowledge, rulings, steers }, sinceIso, words });
}

/** Open one pointer and print its page, or why it could not be opened. */
async function runOpen({ args, out, fail }: RecallSinks & { args: RecallOpenArgs }): Promise<number> {
  const pointer = parseRecallPointer({ text: args.pointer });
  if (pointer.isErr()) {
    fail(pointer.error.message);
    return EXIT_USAGE;
  }
  const home = talkHomeOf({ home: args.home });
  const target = pointer.value;
  let opened: Result<RecallOpened, RecallError>;
  if (target.kind === "knowledge") {
    opened = await openKnowledge({ memoryId: target.memoryId, text: args.pointer });
  } else {
    opened = openDiskRecall({ home, pointer: target, text: args.pointer });
  }
  const page = opened.andThen((record) =>
    buildRecallOpenAnswer({ from: args.from, maxBytes: args.maxBytes, opened: record }),
  );
  if (page.isErr()) {
    fail(page.error.message);
    return EXIT_ERROR;
  }
  printOpen({ answer: page.value, json: args.json, out });
  return EXIT_OK;
}

/** Print one opened page, as JSON for the voice or as lines for a person. */
function printOpen({
  answer,
  json,
  out,
}: Pick<RecallSinks, "out"> & { answer: RecallOpenAnswer; json: boolean }): void {
  if (json) {
    out(JSON.stringify(answer));
    return;
  }
  out(`talk recall: ${answer.pointer} — ${answer.source}/${answer.who} at ${answer.atIso}`);
  answer.before.forEach((turn) => {
    out(`  ${turn.atIso} ${turn.who}: ${turn.text}`);
  });
  out(`> ${answer.text}`);
  answer.after.forEach((turn) => {
    out(`  ${turn.atIso} ${turn.who}: ${turn.text}`);
  });
  out(answer.next);
}

export const talkRecallCommand = defineCommand({ run: runTalkRecall });
