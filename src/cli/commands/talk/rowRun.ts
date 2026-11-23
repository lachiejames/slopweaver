/**
 * `slopweaver talk row` — one board row, whole and bounded, for the console voice to read out.
 *
 * The voice's `board_row` tool runs this. It exists because the queue's own reading caps a row's summary
 * at 320 characters, and "you said earlier X" needs their words, which sit in the row's `ruling:` and its
 * "Their word…" sections — and where a deliverable is, which a seat writes into the question its run's journal
 * records, so the journal is read beside the doc. What it returns, and what it refuses to open, is
 * `src/talk/boardRow.ts`.
 *
 * The slug is shape-checked before any path is built, so `--slug ../x` is a refusal rather than a read, and
 * the file is resolved only under the board directory.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseHandoverDoc } from "../../../handover/doc.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { logger } from "../../../lib/logger.js";
import { collapseWhitespace } from "../../../lib/oneLineSummary.js";
import { stateHomePaths } from "../../../stateHome.js";
import { BOARD_ROW_MAX_BYTES, boardRowForVoice, isBoardSlug } from "../../../talk/boardRow.js";
import { TalkErrors } from "../../../talk/errors.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { parseRowArgs, talkHomeOf } from "./args.js";
import { TALK_ROW_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "row", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Run the `talk row` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkRow(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_ROW_USAGE });
    return EXIT_OK;
  }
  const parsed = parseRowArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_ROW_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  if (!isBoardSlug({ slug: args.slug })) {
    logger.error({ msg: `talk row: ${TalkErrors.slugInvalid({ slug: args.slug }).message}` });
    return EXIT_USAGE;
  }
  const dir = resolveHandoverDir({ dir: args.dir, home: talkHomeOf({ home: args.home }) });
  const path = join(dir, `${args.slug}.md`);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    logger.error({ msg: `talk row: ${TalkErrors.rowMissing({ slug: args.slug }).message}` });
    return EXIT_ERROR;
  }
  const home = talkHomeOf({ home: args.home });
  const read = readRunJournal({ runsDir: stateHomePaths({ home }).runs, slug: args.slug });
  const journal = read.match(
    (ledger) => ({ events: ledger.events, unreadableLines: ledger.unreadable }),
    (error) => ({ unread: error.message }),
  );
  const row = boardRowForVoice({ doc: parseHandoverDoc({ path, text }), journal, maxBytes: BOARD_ROW_MAX_BYTES, text });
  if (args.json) {
    logger.out({ line: JSON.stringify(row) });
    return EXIT_OK;
  }
  logger.out({ line: `talk row: ${row.slug} (${row.kind}, ${row.status})` });
  row.ownerWords.forEach((words) => {
    logger.out({ line: `  their words: ${words}` });
  });
  if (row.summary !== undefined) {
    logger.out({ line: `  summary: ${collapseWhitespace({ text: row.summary })}` });
  }
  if (row.question !== undefined) {
    logger.out({ line: `  question: ${row.question}` });
  }
  if (row.journalUnread !== undefined) {
    logger.out({ line: `  journal unread: ${row.journalUnread}` });
  }
  row.files.forEach((file) => {
    logger.out({ line: `  file: ${file}` });
  });
  if (row.truncated !== undefined) {
    logger.out({ line: `  truncated: ${row.truncated}` });
  }
  return EXIT_OK;
}

export const talkRowCommand = defineCommand({ run: runTalkRow });
