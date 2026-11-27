/**
 * `slopweaver talk call-thread-append` — the console server's writer of a call's thread journal
 * (`src/talk/callThreadStore.ts`). The server holds the call's `codex app-server` child, so it is the one that sees
 * every completed item and every tool answer; it pipes a batch on stdin and runs this, one batch in flight per call
 * (`site/lib/talkCallThreadJournal.ts`), so nothing unmasked is written anywhere on the way here.
 *
 * A console that is not theirs is refused before anything is read, exactly as `talk transcript` refuses one writing their
 * live home (`./consoleOrigin.ts`); the journal types into no chat, so the hatch may open it. The desktop test
 * instance's call through the owner's own console (`--console-instance e2e`) records, every entry stamped
 * `instance: "e2e"` so `talk call-thread` never shows it as the owner's. Exit codes are what the
 * console's queue reads: `EXIT_USAGE` is a batch refused for good, never retried; `EXIT_ERROR` a write that may
 * succeed if tried again, whose `writeId`s make that retry safe.
 */
import { loadDenylistResult, unreadableDenylistMessage } from "../../../hygiene/scan.js";
import { logger } from "../../../lib/logger.js";
import { readStdin } from "../../../lib/readStdin.js";
import type { CallThreadError } from "../../../talk/callThreadErrors.js";
import { CallThreadErrors } from "../../../talk/callThreadErrors.js";
import { appendCallThreadEntries, parseCallThreadBatch, readCallThreadBatch } from "../../../talk/callThreadStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { talkHomeOf } from "./args.js";
import { parseCallThreadAppendArgs } from "./callThreadArgs.js";
import { TALK_CALL_THREAD_APPEND_USAGE } from "./callThreadUsage.js";
import { consoleRecordGate } from "./consoleOrigin.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "call-thread-append", ...]`. */
const VERB_ARG_OFFSET = 4;

/** `--entries-file -`: the batch arrives on stdin, so its raw entries are never written anywhere before masking. */
const STDIN_FILE = "-";

/** The failures retrying the same batch can never fix. */
const REFUSED_FOR_GOOD: ReadonlySet<CallThreadError["code"]> = new Set([
  "CALL_THREAD_CALL_INVALID",
  "CALL_THREAD_BATCH_INVALID",
  "CALL_THREAD_SECRET_SURVIVED",
  "CALL_THREAD_WRITE_ID_COLLISION",
  "CALL_THREAD_NOT_A_FILE",
]);

/**
 * Say a batch that did not go in, and exit with how the console's queue should read it.
 *
 * @param error why it did not go in
 * @param json whether to print the refusal as JSON too
 * @returns `EXIT_USAGE` for a batch refused for good, `EXIT_ERROR` for one worth retrying
 */
function notAppended({ error, json }: { error: CallThreadError; json: boolean }): number {
  logger.error({ msg: `talk call-thread-append: ${error.message}` });
  if (json) {
    logger.out({ line: JSON.stringify({ code: error.code, ok: false, why: error.message }) });
  }
  return REFUSED_FOR_GOOD.has(error.code) ? EXIT_USAGE : EXIT_ERROR;
}

/**
 * Run the `talk call-thread-append` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkCallThreadAppend(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_CALL_THREAD_APPEND_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCallThreadAppendArgs({ rest });
  if (parsed.isErr()) {
    logger.error({ msg: parsed.error.message });
    logger.error({ msg: TALK_CALL_THREAD_APPEND_USAGE });
    return EXIT_USAGE;
  }
  const { callId, consoleOrigin, entriesFile, json } = parsed.value;
  const home = talkHomeOf({ home: parsed.value.home });
  const handoverDir = resolveHandoverDir({ dir: undefined, home });
  const gate = consoleRecordGate({ consoleOrigin, handoverDir, home, verb: "talk call-thread-append" });
  if (gate.isErr()) {
    logger.error({ msg: gate.error });
    return EXIT_USAGE;
  }
  // Read off the resolved origin the gate passed, never off an entry: the page cannot claim a call is the walk's.
  const instance = gate.value?.instance;
  const read =
    entriesFile === STDIN_FILE
      ? parseCallThreadBatch({ callId, text: await readStdin() })
      : readCallThreadBatch({ callId, path: entriesFile });
  if (read.isErr()) {
    return notAppended({ error: read.error, json });
  }
  // Loaded once the batch is in hand, never before a stdin wait, so a denylist written meanwhile still masks it.
  const denylist = loadDenylistResult({ home });
  if (denylist.kind === "unreadable") {
    return notAppended({
      error: CallThreadErrors.denylistUnreadable({ message: unreadableDenylistMessage({ load: denylist }) }),
      json,
    });
  }
  const appended = appendCallThreadEntries({
    callId,
    denylist: denylist.kind === "loaded" ? denylist.lines : [],
    entries: read.value,
    home,
    instance,
  });
  if (appended.isErr()) {
    return notAppended({ error: appended.error, json });
  }
  const { paths, repeated } = appended.value;
  if (json) {
    logger.out({ line: JSON.stringify({ appended: appended.value.appended, ok: true, paths, repeated }) });
    return EXIT_OK;
  }
  logger.out({
    line: `talk call-thread-append: ${String(appended.value.appended)} entr(ies) appended, ${String(repeated)} already written → ${paths.join(", ")}`,
  });
  return EXIT_OK;
}

export const talkCallThreadAppendCommand = defineCommand({ run: runTalkCallThreadAppend });
