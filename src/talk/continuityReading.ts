/**
 * What the owner's last call was reading when it ended, as the one line both openers carry: the link, the tool that
 * opens it again, and where the owner was in it. The reading itself is `./continuityCalls.ts`'s; the openers are
 * `./continuityRender.ts`.
 *
 * A call rolls over at its ninety-minute cap, and if the owner was walking a channel thread with it one claim at a
 * time, the next call must not ask the owner to paste a link they never said aloud: the link was given before, so the
 * thread is looked up from the transcript history, never asked for again.
 *
 * Pure: every input is already read.
 */
import { parseSlackThreadPermalink } from "../live/slack/permalink.js";
import { NOTE_CHARS, type TalkContinuity } from "./continuity.js";
import { lastSpokenCall } from "./continuityCalls.js";
import { clip } from "./packText.js";

/**
 * The tool that opens a link again. A Slack message link is a thread, read whole by `slack_open` whatever opened it
 * last call — a suffix read or the browser carried forward would repeat that mistake.
 *
 * @param tool the tool that opened it on the last call
 * @returns the tool to name
 */
function reopenToolOf({ link, tool }: { link: string; tool: string }): string {
  if (parseSlackThreadPermalink({ permalink: link }).isOk()) {
    return "slack_open";
  }
  return tool;
}

/**
 * The line naming the link the owner's last call was reading. The delegated model opens it again with the tool itself;
 * the voice cannot, so it is told to delegate naming the link — either way never to ask the owner for it. A call file
 * that could not be read may have been the last call, so its newest readable one is not known to be the owner's last.
 *
 * @param continuity the read
 * @param reader `tool` for the delegated model, which opens it again itself; `voice` for the voice, which delegates
 * @returns the line, or `undefined` when the newest call opened no link or a call file could not be read
 */
export function readingLine({
  continuity,
  reader,
}: {
  continuity: TalkContinuity;
  reader: "tool" | "voice";
}): string | undefined {
  const reading = lastSpokenCall({ continuity })?.reading;
  if (reading === undefined || continuity.unread.some((entry) => entry.section === "calls")) {
    return undefined;
  }
  let where = "";
  if (reading.lastTold !== undefined) {
    where = ` The newest thing you told the owner after opening it was: "${clip({ max: NOTE_CHARS, text: reading.lastTold })}".`;
  }
  let reopen = `open it again with ${reopenToolOf({ link: reading.link, tool: reading.tool })}`;
  if (reader === "voice") {
    reopen = "delegate, naming that link, to open it again";
  }
  return (
    `On the owner's last call with you, you were reading ${reading.link} (opened with ${reading.tool} at ${reading.atIso}).` +
    `${where} That is what the owner means when they refer back to it: ${reopen} and carry on from there, and never ` +
    "ask them for the link or to paste it."
  );
}
