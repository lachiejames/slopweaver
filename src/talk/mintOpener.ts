/**
 * Everything the voice is told at mint about where it left off: the ordinary opener (`./continuityRender.ts`), and
 * before it, when the console re-opened a call that dropped or rolled a long call over in a pause, the lines that
 * make it the same call carrying on — or, when the owner started this one minutes after their last, that call's last exchange.
 *
 * Pure: every input is already read.
 */
import { NOTE_CHARS, type TalkContinuity } from "./continuity.js";
import { type ContinuityCall, lastSpokenCall } from "./continuityCalls.js";
import { continuityOpener } from "./continuityRender.js";
import { clip } from "./packText.js";
import type { TypedConversation } from "./typedConversation.js";

/** How many of the previous call's newest lines a reconnect's, a rollover's or a resume's opener quotes. */
const RECONNECT_TAIL_LINES = 6;

/**
 * How recently the owner's last call must have ended for a call the owner starts themself to resume from its last exchange. A
 * product judgement, not a measurement: a desktop restart mid-call opens the next one within minutes (a measured
 * restart ended one call and opened the next spoken one under two minutes later), while quoting a call from hours ago would
 * read as a live conversation the owner has long moved on from. Older calls still ride the delegated block whole.
 */
const RESUME_WINDOW_MS = 60 * 60 * 1000;

/**
 * Why the console minted this call: the owner pressing start, a call that dropped under the owner coming back, or a long call
 * rolled over in a pause ahead of its limit (`site/lib/callRollover.ts`).
 */
export type MintMode = "fresh" | "reconnect" | "rollover";

/**
 * The newest call, the one a reconnect or a rollover follows — or none when a call file could not be read, since that
 * file may be the newer call and quoting the readable one would resume from the wrong place.
 *
 * @param continuity the read
 * @returns the newest call, or `undefined`
 */
function newestKnownCall({ continuity }: { continuity: TalkContinuity }): ContinuityCall | undefined {
  if (continuity.unread.some((entry) => entry.section === "calls")) {
    return undefined;
  }
  return continuity.calls[0];
}

/**
 * A call's last exchange, oldest first, an interrupted line marked.
 *
 * @param previous the call quoted: the newest one for a reconnect or a rollover, the owner's last spoken one for a resume
 * @param heading what the quoted call was, opening the quote
 * @param end how the quoted call ended, when the caller knows better than its file: a rollover's predecessor has
 *   its close queued behind the release, so its file says it dropped. Omitted, the file's own end is said
 * @returns the quote's lines, or none when no call was written down or it carried no lines
 */
export function previousExchange({
  previous,
  heading,
  end,
}: {
  previous: ContinuityCall | undefined;
  heading: string;
  end?: string;
}): string[] {
  if (previous === undefined || previous.lines.length === 0) {
    return [];
  }
  let ended = previous.end;
  if (end !== undefined) {
    ended = end;
  }
  const lines = [`${heading} (${ended}) ended on this exchange, oldest first:`];
  // A crash tears at most a file's last line, which the read skips and counts (`./callStore.ts`). Refusing the whole
  // call over it would lose continuity in exactly the crash it exists for, so the gap is said instead.
  if (previous.skipped !== undefined && previous.skipped > 0) {
    lines[0] =
      `${heading} (${ended}) ended on this exchange, oldest first — ${String(previous.skipped)} line(s) of ` +
      "its file could not be read, so its last words may be missing; if the owner says otherwise, they are right:";
  }
  for (const line of previous.lines.slice(-RECONNECT_TAIL_LINES)) {
    const speaker = line.who === "owner" ? "the owner" : "you";
    const cut = line.final ? "" : " (cut off mid-sentence)";
    lines.push(`- ${speaker}${cut}: "${clip({ max: NOTE_CHARS, text: line.text.trim() })}"`);
  }
  return lines;
}

/**
 * The lines the voice is told when the console re-opened a call that dropped under the owner (a call
 * that hits its limit reconnects on its own, and the conversation carries on as one). The newest call is the one that
 * dropped — the page wrote its end before it minted this one — so its last exchange is quoted for the voice to resume
 * from, an interrupted line of its own marked so it finishes the thought rather than starting another.
 *
 * @param continuity the read
 * @returns the lines, which always say it is a reconnect, quoting the dropped call when there is one
 */
export function reconnectOpener({ continuity }: { continuity: TalkContinuity }): string {
  const lines = [
    "This call is an AUTOMATIC RECONNECT: the owner's last call with you dropped a moment ago and the console reopened it on",
    // "Say that you're back" is a status the owner never asked for; that it dropped is theirs to ask about.
    "its own, so it is the same conversation carrying on. Never greet the owner as a new call, never say you are back or",
    "reconnected unless they ask, and never ask them to repeat themselves. If they were showing their screen, the share carried",
    "over, so read_screen works without asking them to share again.",
  ];
  const exchange = previousExchange({ heading: "The dropped call", previous: newestKnownCall({ continuity }) });
  if (exchange.length === 0) {
    return lines.join("\n");
  }
  lines.push(...exchange);
  // A cut-off aside the owner never asked for ("Side note—the") is not a thought to finish.
  lines.push(
    "If your own last line was cut off answering the owner, finish that thought; a line they did not ask for stays dropped.",
    "Otherwise answer their last words if they went unanswered, and if not, say nothing until they speak.",
  );
  return lines.join("\n");
}

/**
 * The lines the voice is told when the console rolled a long call over onto this one in a pause, ahead of its own
 * 90-minute limit (the limit would otherwise cut the owner off mid-sentence) or its thread's context filling. Unlike a
 * reconnect nothing dropped, so the owner must not hear that anything happened: the voice answers the owner's last words
 * if the quoted exchange left them unanswered, and otherwise stays silent until they speak, then answers as the same
 * call. The previous call's last exchange is quoted so it knows where the floor was, its end said as the rollover it
 * was: the page releases the old call before its close reaches the file, so the file alone says it dropped, and a
 * successor told so contradicted the "nothing happened" above it.
 *
 * @param continuity the read
 * @returns the lines, quoting the previous call when there is one, and always saying when to stay silent
 */
export function rolloverOpener({ continuity }: { continuity: TalkContinuity }): string {
  const lines = [
    "This call is an AUTOMATIC ROLLOVER: the console moved the owner's ongoing call with you onto this fresh one in a pause, so",
    "it is the same conversation and, to the owner, nothing happened. Never greet them, never say you are back or",
    "reconnected, and never ask them to repeat themselves; when they speak, answer as the same call. If they were showing",
    "their screen, the share carried over, so read_screen works without asking them to share again.",
  ];
  const exchange = previousExchange({
    end: "rolled over onto this call in a pause",
    heading: "The call before this one",
    previous: newestKnownCall({ continuity }),
  });
  if (exchange.length === 0) {
    lines.push("Say NOTHING until they speak.");
    return lines.join("\n");
  }
  lines.push(
    ...exchange,
    "If the owner's last words in it went unanswered, answer them now as the same call; otherwise say NOTHING until they speak.",
  );
  return lines.join("\n");
}

/**
 * The lines a call the owner started themself opens with when their last spoken call's last line is within {@link RESUME_WINDOW_MS}:
 * its last exchange, both sides, so "where were we" is answered from what was just said — the voice's own last
 * proposal included, which the owner's unrelayed words alone cannot carry. Without it, an owner who restarts the
 * desktop app on the voice's "restart and we'll test it" gets a next call that answers from a steer older than that
 * whole exchange. Judged against the read's own
 * instant, never the wall clock; a call stamped after it, or an instant that does not parse, is not resumed — nor is
 * any call when a call file could not be read, since that file may be the newer call.
 *
 * @param continuity the read
 * @returns the lines, or none when no spoken call's last line falls inside the window
 */
export function resumeLines({ continuity }: { continuity: TalkContinuity }): string[] {
  const last = lastSpokenCall({ continuity });
  // A call file that could not be read may be the newer call, so the readable one is not known to be the owner's last.
  // A last call whose every line was torn has no exchange to resume from.
  if (last === undefined || last.lines.length === 0 || continuity.unread.some((entry) => entry.section === "calls")) {
    return [];
  }
  // Its last SPOKEN line, never its last activity: a tool or usage line written later is not conversation.
  const spokenMs = Math.max(...last.lines.map((line) => Date.parse(line.atIso)));
  const builtMs = Date.parse(continuity.builtIso);
  const age = builtMs - spokenMs;
  // Its newest activity covers every line, the ones cut from `lines` included, so a call stamped after the read is
  // caught even when its newest line was cut. Both compare at the read's own millisecond inclusive:
  // `Date.parse` truncates a finer stamp down to it, and a call worth resuming is minutes old, never 0 ms.
  const lastMs = Date.parse(last.lastIso);
  const stampedAfterRead = Number.isNaN(lastMs) || lastMs >= builtMs;
  if (Number.isNaN(age) || age <= 0 || age > RESUME_WINDOW_MS || stampedAfterRead) {
    return [];
  }
  const exchange = previousExchange({ heading: "The owner's last call with you", previous: last });
  return [
    ...exchange,
    "When the owner carries on or asks where you were, carry on from this exchange; never recap it unasked.",
  ];
}

/**
 * Everything the voice is told at mint about where it left off: a reconnect's or a rollover's lines first when this
 * mint is one, a resume's ({@link resumeLines}) when the owner started it within the window of their last spoken call, then
 * the ordinary {@link continuityOpener}.
 *
 * @param continuity the read
 * @param conversation what the owner typed since their last call, carried by the ordinary opener
 * @param mode whether the owner pressed start, or the console is re-opening a dropped call or rolling one over in a pause
 * @returns the lines, or `undefined` when an ordinary start has nothing to carry
 */
export function mintOpener({
  continuity,
  conversation,
  mode,
}: {
  continuity: TalkContinuity;
  conversation: TypedConversation;
  mode: MintMode;
}): string | undefined {
  const ordinary = continuityOpener({ continuity, conversation });
  let carry: string;
  if (mode === "fresh") {
    const resume = resumeLines({ continuity });
    if (resume.length === 0) {
      return ordinary;
    }
    carry = resume.join("\n");
  } else if (mode === "rollover") {
    carry = rolloverOpener({ continuity });
  } else {
    carry = reconnectOpener({ continuity });
  }
  if (ordinary === undefined) {
    return carry;
  }
  return `${carry}\n\n${ordinary}`;
}
