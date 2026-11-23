/**
 * Which of a tool line's fields the call file keeps: the writer names them, so a page-only field — its latency `ms`,
 * its cost, what the tray draws behind its fold — never reaches the file by accident. Pure; `useCallTranscript.ts` is
 * the shell that stamps the instant and hands the line to the sink.
 */
import type { CallLine } from "../../lib/talkTranscript";
import type { ToolLine } from "./voiceContext";

/**
 * The call-file line one tool line is written as. An optional field the line does not carry stays absent, never
 * `undefined`.
 *
 * @param atIso when the page wrote it
 * @param line the tool line
 * @returns the call-file line
 */
export function transcriptToolLine({
  atIso,
  line,
}: {
  atIso: string;
  line: ToolLine;
}): Extract<CallLine, { kind: "tool" }> {
  const { detail, name, opened, refused, reopenReminder } = line;
  const openedField = opened === undefined ? {} : { opened };
  // Only the opening window's own line carries its measurement.
  const reminderField = reopenReminder !== undefined && name === "reopen-reminder" ? { reopenReminder } : {};
  return { atIso, detail, kind: "tool", name, refused, ...openedField, ...reminderField };
}
