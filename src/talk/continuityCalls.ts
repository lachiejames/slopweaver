/**
 * The calls half of continuity: every console-voice call written down in the window (`./callStore.ts`), and the owner's
 * words on the newest one after their last relayed steer — the words no steer carries. When a call drops, the steers
 * given it are lost unless this half keeps them, because the other halves only see what was RELAYED. Pure;
 * the read is `./continuityRead.ts`, the render `./continuityRender.ts`.
 */
import { type CallRecord, callEndPhrase } from "./callRecord.js";
import { atOrAfter, newestFirst, type TalkContinuity } from "./continuity.js";
import { withoutListSignOff } from "./copyToolSchemas.js";

/** One line of a call as continuity carries it. */
export interface ContinuityCallLine {
  readonly atIso: string;
  readonly who: "owner" | "voice";
  readonly text: string;
  /** `false` when the call dropped in the middle of it. */
  readonly final: boolean;
}

/**
 * The link a call was last reading through a tool, and where the conversation was in it. A call can roll over at its
 * ninety-minute cap while the owner walks a Slack thread with it one claim at a time, and the next call would ask the
 * owner for the link again — the voice had read it off the Slack reply box, so it was in no line the owner said.
 */
export interface ContinuityReading {
  readonly link: string;
  /** The tool that opened it, such as `slack_thread_after` — what opens it again. */
  readonly tool: string;
  readonly atIso: string;
  /**
   * The voice's newest line at or after the read that is more than an acknowledgement: where the conversation was in it.
   * `undefined` when it told the owner nothing from it.
   */
  readonly lastTold: string | undefined;
}

/** One console-voice call as it was written down while it ran. */
export interface ContinuityCall {
  readonly callId: string;
  readonly openedIso: string;
  readonly lastIso: string;
  /** How it ended, in one phrase — or that no end was recorded (`callRecord.callEndPhrase`). */
  readonly end: string;
  /**
   * The instant its end was written, `undefined` when none was (it dropped, or the page went away) — or on a call
   * stored in a pack before this was carried. What a reopen's minute is judged from (`./reopenReminder.ts`).
   */
  readonly endedIso?: string | undefined;
  /** Its newest lines, oldest first; `linesCut` counts the older ones left out. */
  readonly lines: readonly ContinuityCallLine[];
  readonly linesCut: number;
  /**
   * Lines of its file that did not parse, so {@link openedIso} may be later than its real opening;
   * `undefined` on a call stored in a pack before this was carried, where nobody knows.
   */
  readonly skipped: number | undefined;
  /** The link it was last reading, or `undefined` when no tool line of it names one. */
  readonly reading: ContinuityReading | undefined;
}

/** How many of a call's newest lines continuity keeps. */
const CALL_LINES = 40;

/**
 * The fewest words a voice line needs to say where the conversation was in what it read. A call can end on
 * "Mm-hm." two lines after a long claim the voice read out — its voice lines print with
 * `jq -r 'select(.kind=="segment" and .who=="voice" and .final) | .text' ~/.slopweaver/talk/calls/<callId>.jsonl | tail -5`.
 */
const TOLD_MIN_WORDS = 8;

/**
 * How many words a line holds.
 *
 * @returns the count of whitespace-separated runs
 */
function wordCount({ text }: { text: string }): number {
  return text.split(/\s+/u).filter((word) => word !== "").length;
}

/**
 * The newest answered tool line that names a link. The page names one only on an answer that landed — on a
 * delegated call, once the plan thread took it (`site/components/voice/VoiceProvider.tsx`) — so a refused line is
 * skipped as a second guard rather than read as taking one back. Neither order alone is safe: a clock that stepped
 * back between two reads misleads the stamps, and a keepalive batch that overtook an older post misleads
 * the file. So a link is named only when the newest by file order and the newest by stamp are the same line,
 * and two reads of different links stamped the same newest millisecond name none, since neither order can tell them
 * apart. The newest read's link too long to carry, or one it
 * cannot vouch for, names none, rather than letting an older link pass for it. So does a
 * file with a line that did not parse, which may have been the newer read.
 *
 * @param call the call as folded
 * @returns the tool line, or `undefined` when none names a link it can carry
 */
function newestAnswered({
  call,
}: {
  call: CallRecord;
}): { readonly atIso: string; readonly name: string; readonly opened: string } | undefined {
  if (call.skipped > 0) {
    return undefined;
  }
  const reads = call.notes.filter((note) => note.kind === "tool" && !note.refused && note.opened !== undefined);
  const newest = reads.at(-1);
  const byStamp = newestFirst({ at: (note) => note.atIso, items: reads.toReversed() })[0];
  if (newest?.kind !== "tool" || newest !== byStamp || newest.opened == null) {
    return undefined;
  }
  const tied = reads.some(
    (note) => note.atIso === newest.atIso && note.kind === "tool" && note.opened !== newest.opened,
  );
  if (tied) {
    return undefined;
  }
  return { atIso: newest.atIso, name: newest.name, opened: newest.opened };
}

/**
 * The link a call last opened through a read tool that answered, and the voice's newest line from then on that told
 * the owner something.
 *
 * @param call the call as folded
 * @returns the reading, or `undefined` when no answered tool line names a link
 */
function readingOf({ call }: { call: CallRecord }): ContinuityReading | undefined {
  const opened = newestAnswered({ call });
  if (opened === undefined) {
    return undefined;
  }
  const told = newestFirst({
    at: (segment) => segment.atIso,
    items: call.segments
      .filter(
        (segment) =>
          segment.who === "voice" &&
          wordCount({ text: segment.text }) >= TOLD_MIN_WORDS &&
          atOrAfter({ atIso: segment.atIso, sinceIso: opened.atIso }),
      )
      .toReversed(),
  })[0];
  return {
    atIso: opened.atIso,
    lastTold: told === undefined ? undefined : quotableText({ segment: told }).trim(),
    link: opened.opened,
    tool: opened.name,
  };
}

/**
 * A segment's words as the next call may quote them: the voice's own line less every running-list sign-off in it,
 * which, quoted into the next prompt, taught the line back. The owner's
 * words are never cut.
 *
 * @param segment the segment
 * @returns its quotable words, empty when a voice line was nothing but the sign-off
 */
function quotableText({ segment }: { segment: { readonly who: string; readonly text: string } }): string {
  return segment.who === "voice" ? withoutListSignOff({ text: segment.text }) : segment.text;
}

/**
 * The calls written down in the window, newest first, each cut to its newest {@link CALL_LINES} lines. A call the
 * desktop test instance placed (its record keeps the mark once any open carried it) is never the owner's, so it is passed
 * over: the next call never picks up from a walk's own speech.
 *
 * @param calls the calls read (`./callStore.ts`'s `readCalls`)
 * @param sinceIso the window's floor
 * @returns the calls
 */
export function callsSince({
  calls,
  sinceIso,
}: {
  calls: readonly CallRecord[];
  sinceIso: string;
}): readonly ContinuityCall[] {
  const kept = calls
    .filter((call) => call.origin?.instance !== "e2e" && atOrAfter({ atIso: call.lastIso, sinceIso }))
    .map((call) => continuityCallOf({ call }));
  return newestFirst({ at: (call) => call.lastIso, items: kept });
}

/**
 * The calls a mint may read, by what it is minting for. Every surface for the owner's own; for the desktop test
 * instance's call, no conversation typed into the messenger, since a test call may now run beside one at rest
 * (`site/lib/talkArbiter.ts`) and is never to read what the owner typed there.
 *
 * @param calls the calls read (`./callStore.ts`'s `readCalls`)
 * @param typedCalls `keep` for the owner's mint, `drop` for a test call's
 * @returns the calls it may read, in the same order
 */
export function callsForMint({
  calls,
  typedCalls,
}: {
  calls: readonly CallRecord[];
  typedCalls: "keep" | "drop";
}): readonly CallRecord[] {
  if (typedCalls === "keep") {
    return calls;
  }
  return calls.filter((call) => call.surface !== "typed");
}

/**
 * The desktop test instance's OWN calls in the window, newest first, shaped exactly as {@link callsSince} shapes the owner's.
 * Only a call whose record carries the test mark is kept, so nothing the owner said can ever reach a test call's reopen
 * reminder; and nothing here ever enters the owner's continuity, which keeps {@link callsSince} alone.
 *
 * @param calls the calls read (`./callStore.ts`'s `readCalls`)
 * @param sinceIso the window's floor
 * @returns the test instance's calls
 */
export function testCallsSince({
  calls,
  sinceIso,
}: {
  calls: readonly CallRecord[];
  sinceIso: string;
}): readonly ContinuityCall[] {
  const kept = calls
    .filter((call) => call.origin?.instance === "e2e" && atOrAfter({ atIso: call.lastIso, sinceIso }))
    .map((call) => continuityCallOf({ call }));
  return newestFirst({ at: (call) => call.lastIso, items: kept });
}

/**
 * One call record as continuity reads it: its quotable lines, the newest {@link CALL_LINES} kept.
 *
 * @returns the call
 */
function continuityCallOf({ call }: { call: CallRecord }): ContinuityCall {
  const spoken = call.segments
    .map((segment) => ({ ...segment, text: quotableText({ segment }) }))
    .filter((segment) => segment.text.trim() !== "");
  return {
    callId: call.callId,
    end: callEndPhrase({ call }),
    endedIso: call.ended?.atIso,
    lastIso: call.lastIso,
    lines: spoken
      .slice(-CALL_LINES)
      .map((segment) => ({ atIso: segment.atIso, final: segment.final, text: segment.text, who: segment.who })),
    linesCut: Math.max(0, spoken.length - CALL_LINES),
    openedIso: call.openedIso,
    reading: readingOf({ call }),
    skipped: call.skipped,
  };
}

/**
 * The newest call in a newest-first list with a line written down, or a torn one ({@link lastSpokenCall} says why).
 *
 * @param calls newest first
 * @returns the call, or `undefined` when none has a line or a torn one
 */
export function newestSpokenOf({ calls }: { calls: readonly ContinuityCall[] }): ContinuityCall | undefined {
  return calls.find((call) => call.lines.length > 0 || (call.skipped !== undefined && call.skipped > 0));
}

/**
 * The owner's last call: the newest one with a line written down. A call with none is either the one being minted or
 * one that opened and closed on nothing — and taking one of those as the last hid the real one. When the owner
 * restarts the desktop app mid-call, a call opens and closes on nothing, and the call after it would answer "where
 * were we" from a steer older than everything the owner had said since — `jq -c 'select(.kind=="segment")'
 * ~/.slopweaver/talk/calls/<callId>.jsonl` prints nothing for such a call. A call with a line that could not be read
 * counts too, its readable lines or not: the torn line may be the owner's newest words, so a call before it is never
 * taken as the last.
 *
 * @param continuity the read
 * @returns the call, or `undefined` when no call in the window has a line or a torn one
 */
export function lastSpokenCall({ continuity }: { continuity: TalkContinuity }): ContinuityCall | undefined {
  return newestSpokenOf({ calls: continuity.calls });
}

/**
 * What the owner said on their last call ({@link lastSpokenCall}) AFTER their last relay — the words no steer carries, which is
 * what a dropped call used to lose. Nothing when that call's words were all said before that relay.
 *
 * @param continuity the read
 * @returns the call and the owner's words on it after the last steer, oldest first, or `undefined`
 */
export function unrelayedWords({
  continuity,
}: {
  continuity: TalkContinuity;
}): { readonly call: ContinuityCall; readonly words: readonly ContinuityCallLine[] } | undefined {
  const call = lastSpokenCall({ continuity });
  if (call === undefined) {
    return undefined;
  }
  const steer = continuity.steers[0];
  const words = call.lines.filter(
    (line) => line.who === "owner" && (steer === undefined || Date.parse(line.atIso) > Date.parse(steer.atIso)),
  );
  if (words.length === 0) {
    return undefined;
  }
  return { call, words };
}
