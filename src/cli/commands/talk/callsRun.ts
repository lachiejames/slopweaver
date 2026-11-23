/**
 * `slopweaver talk calls` — the recent console-voice calls as they were written down while they ran, newest first:
 * what they and the voice said, what it looked at, what it relayed, and how each call ended — or that no end was
 * recorded, which is what a dropped call or a reloaded page leaves — and, under a call that dropped, each attempt the
 * console made to re-open it and why one failed.
 */
import { logger } from "../../../lib/logger.js";
import { type TranscriptLag, transcriptLag, transcriptLagPhrase } from "../../../talk/callLag.js";
import { reconnectPhrase } from "../../../talk/callReconnectRecord.js";
import { type CallRecord, callEndPhrase } from "../../../talk/callRecord.js";
import { readCallEntries, readCalls } from "../../../talk/callStore.js";
import type { CallToolNote } from "../../../talk/callToolLine.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { talkHomeOf } from "./args.js";
import { parseCallsArgs } from "./callArgs.js";
import { TALK_CALLS_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "calls", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Run the `talk calls` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkCalls(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_CALLS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCallsArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_CALLS_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const read = readCalls({ home: talkHomeOf({ home: args.home }), keep: { limit: args.limit } });
  if (read.isErr()) {
    logger.error({ msg: `talk calls: ${read.error.message}` });
    return EXIT_ERROR;
  }
  const { calls, unreadable } = read.value;
  const home = talkHomeOf({ home: args.home });
  if (args.json) {
    // Each call carries its end phrase, so a reader that cannot import `src/` says it the same way. A tool line's
    // answer is left off: up to 24 KiB each, the calls' answers together would turn a status read into megabytes, so
    // they are read one call at a time with `talk call-tools`.
    const described = calls.map((call) => ({
      ...call,
      end: callEndPhrase({ call }),
      notes: call.notes.map((note) => withoutAnswer({ note })),
      transcriptLag: lagOf({ callId: call.callId, home }),
    }));
    logger.out({ line: JSON.stringify({ calls: described, observedAtIso: new Date().toISOString(), unreadable }) });
    return EXIT_OK;
  }
  if (calls.length === 0 && unreadable.length === 0) {
    logger.out({ line: "talk calls: no console-voice call has been written down on this install" });
    return EXIT_OK;
  }
  unreadable.forEach((why) => {
    logger.out({ line: `  not read — ${why}` });
  });
  calls.forEach((call) => {
    printCall({ call, home });
  });
  return EXIT_OK;
}

/**
 * A note as `talk calls --json` prints it: a tool line without the answer it kept, any other note as it is.
 *
 * @internal — {@link runTalkCalls} is this module's public surface; exported for its own unit test.
 * @param note one of a call's tool lines or relays
 * @returns the note, its answer left off
 */
export function withoutAnswer({
  note,
}: {
  note: CallRecord["notes"][number];
}): Exclude<CallRecord["notes"][number], { kind: "tool" }> | Omit<CallToolNote, "answer"> {
  if (note.kind !== "tool") {
    return note;
  }
  const { atIso, detail, kind, name, opened, refused } = note;
  return { atIso, detail, kind, name, opened, refused };
}

/**
 * One call's transcript lag, read off its own lines: `readCalls` folds each file away.
 *
 * @param callId the call
 * @param home the talk home its file is under
 * @returns the lag, or `null` when the file could not be read again — the call was read a moment ago, its lag was not
 */
function lagOf({ callId, home }: { callId: string; home: string }): TranscriptLag | null {
  const entries = readCallEntries({ callId, home });
  return entries.isOk() ? transcriptLag({ entries: entries.value }) : null;
}

/**
 * Print one call as text: how it ended, each reconnect step, its transcript lag, what was said and what was relayed.
 *
 * @param call the call
 * @param home the talk home its file is under
 */
function printCall({ call, home }: { call: CallRecord; home: string }): void {
  logger.out({ line: `${call.openedIso}  call ${call.callId} — ${callEndPhrase({ call })}` });
  call.reconnects.forEach((reconnect) => {
    logger.out({ line: `  ${reconnectPhrase({ reconnect })}` });
  });
  const lag = lagOf({ callId: call.callId, home });
  const lagLine = lag === null ? undefined : transcriptLagPhrase({ lag });
  if (lagLine !== undefined) {
    logger.out({ line: `  ${lagLine}` });
  }
  call.segments.forEach((segment) => {
    const partial = segment.final ? "" : " (cut off)";
    logger.out({ line: `  ${segment.who} ${segment.text}${partial}` });
  });
  const relays = call.notes.filter((note) => note.kind === "relay");
  if (relays.length > 0) {
    logger.out({ line: `  ${String(relays.length)} relay(s): ${relays.map((note) => note.outcome).join(", ")}` });
  }
}

export const talkCallsCommand = defineCommand({ run: runTalkCalls });
