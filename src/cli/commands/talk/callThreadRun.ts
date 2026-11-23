/**
 * `slopweaver talk call-thread --call <uuid>` — one console call's Codex thread journal, a bounded page at a time:
 * what the thread was told at its start, each turn frame and completed item, and every tool answer the console handed
 * it (`src/talk/callThreadStore.ts`). Auditability is a core property, and the
 * thread itself is ephemeral. An AUDIT read: nothing else reads this journal, and it never feeds recall or continuity.
 * A call with no journal is an error, never an empty page.
 */
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { callThreadLines, callThreadPage } from "../../../talk/callThreadPage.js";
import { readCallThreadEntries } from "../../../talk/callThreadStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { talkHomeOf } from "./args.js";
import { parseCallThreadArgs } from "./callThreadArgs.js";
import { TALK_CALL_THREAD_USAGE } from "./callThreadUsage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "call-thread", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Run the `talk call-thread` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkCallThread(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_CALL_THREAD_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCallThreadArgs({ rest });
  if (parsed.isErr()) {
    logger.error({ msg: parsed.error.message });
    logger.error({ msg: TALK_CALL_THREAD_USAGE });
    return EXIT_USAGE;
  }
  const { callId, from, json, limit } = parsed.value;
  const read = readCallThreadEntries({ callId, home: talkHomeOf({ home: parsed.value.home }) });
  if (read.isErr()) {
    logger.error({ msg: `talk call-thread: ${read.error.message}` });
    return EXIT_ERROR;
  }
  const page = callThreadPage({ callId, entries: read.value.entries, from, limit, skipped: read.value.skipped });
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "talk call-thread page", value: page }) });
    return EXIT_OK;
  }
  for (const line of callThreadLines({ page })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

export const talkCallThreadCommand = defineCommand({ run: runTalkCallThread });
