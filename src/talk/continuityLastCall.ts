/**
 * What the opener says about the owner's last spoken call: their words on it after their last relay, or that there is
 * no record of one. Told nothing of the call the owner had just restarted out of, the voice once talked about a mobile
 * app the owner never mentioned.
 *
 * Pure: every input is already read.
 */
import { HEARD_CHARS, NOTE_CHARS, type TalkContinuity } from "./continuity.js";
import { lastSpokenCall, unrelayedWords } from "./continuityCalls.js";

/**
 * A passage's last `max` characters, cut at its START so the newest words survive, counted in code points so the cut
 * never splits an emoji's surrogate pair into a replacement character.
 */
function lastChars({ text, max }: { text: string; max: number }): string {
  const points = Array.from(text);
  if (points.length <= max) {
    return text;
  }
  return `…${points.slice(-max).join("")}`;
}

/**
 * A passage flattened to one line and cut at a character bound from its START: a "last said" line quoting the oldest
 * 300 characters of what the owner said after their last relay dropped their actual last words.
 */
function tailClip({ text, max }: { text: string; max: number }): string {
  return lastChars({ max, text: text.replace(/\s+/gu, " ").trim() });
}

/**
 * The owner's words on their last spoken call after their last relay, as one quoted run — the newest kept when it must
 * be cut.
 *
 * @param continuity the read
 * @returns how that call went and the owner's words, or `undefined` when every word there was relayed
 */
export function unrelayedQuote({
  continuity,
}: {
  continuity: TalkContinuity;
}): { call: string; quote: string } | undefined {
  const unrelayed = unrelayedWords({ continuity });
  if (unrelayed === undefined) {
    return undefined;
  }
  // Flattened before the cut, so a run of whitespace never spends the bound the later clip counts.
  const joined = unrelayed.words.map((line) => line.text.replace(/\s+/gu, " ").trim()).join(" … ");
  const quote = lastChars({ max: HEARD_CHARS, text: joined });
  return { call: `opened ${unrelayed.call.openedIso}, ${unrelayed.call.end}`, quote };
}

/**
 * What the voice says when there is no last call to answer "where were we" from: the calls could not be read, or none
 * in the window has a line. A read that failed never establishes that there was no call, so it is said first and
 * instead.
 *
 * @param continuity the read
 * @returns the one line saying so, or none when a spoken call is on record
 */
export function callRecordLines({ continuity }: { continuity: TalkContinuity }): readonly string[] {
  if (continuity.unread.some((entry) => entry.section === "calls")) {
    return [
      "The owner's earlier calls could not be read: if they ask where you were, say you could not read them — never guess.",
    ];
  }
  const last = lastSpokenCall({ continuity });
  if (last === undefined) {
    return [
      `No earlier call of yours with the owner is written down since ${continuity.sinceIso}: if they ask where you were, ` +
        "say you have no record of it — never guess or invent what it was about.",
    ];
  }
  if (last.lines.length === 0) {
    return [
      `The owner's last call with you (${last.end}) has no line that could be read: if they ask where you were, say you could ` +
        "not read it — never guess.",
    ];
  }
  return [];
}

/**
 * What the owner said on their last spoken call after their last relay, their newest words kept, and whether it says
 * that is where they left off. A call file that could not be read may be the newer call, so then it never does.
 *
 * @param continuity the read
 * @returns the line and whether it names where the owner left off, or `undefined` when every word there was relayed
 */
export function unrelayedLine({
  continuity,
}: {
  continuity: TalkContinuity;
}): { line: string; leftOff: boolean } | undefined {
  const unrelayed = unrelayedQuote({ continuity });
  if (unrelayed === undefined) {
    return undefined;
  }
  let quote = `"${tailClip({ max: NOTE_CHARS, text: unrelayed.quote })}".`;
  // A crash, a desktop restart among them, tears at most a file's last line, which may hold the owner's newest words; the gap
  // is said rather than the call dropped, as the resume heading does (`./mintOpener.ts`).
  const skipped = lastSpokenCall({ continuity })?.skipped;
  if (skipped !== undefined && skipped > 0) {
    quote += ` ${String(skipped)} line(s) of that call's file could not be read, so the owner's newest words may be missing; if they say otherwise, they are right.`;
  }
  if (continuity.unread.some((entry) => entry.section === "calls")) {
    return {
      leftOff: false,
      line: `On a call with you that may not be the owner's last (${unrelayed.call}) they said: ${quote}`,
    };
  }
  return {
    leftOff: true,
    line: `Where you left off: on the owner's last call with you (${unrelayed.call}) they last said: ${quote}`,
  };
}
