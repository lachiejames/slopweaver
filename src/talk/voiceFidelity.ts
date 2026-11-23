/**
 * Where the voice said something other than what the thinking model handed it: the pure half of `slopweaver talk
 * fidelity`. For each message the thinking model wrote on a voice call, it pairs the voice's final segments that spoke
 * it and reads the pair with `./wordDivergence.ts`, which names the content words the voice ADDED and RELOCATED.
 *
 * The owner's P0: the voice said uploading "needs a powerful service key" where the card said "a service key". The
 * owner asked whether that failure is a regression or always there, from evidence, so this counts it per day across
 * every call that keeps a `wrote` line (`./callRecord.ts`).
 *
 * **A candidate, never a verdict**, for the reasons `./wordDivergence.ts` states. What it cannot see, it names: a call
 * with no `wrote` line, a handed message the voice never spoke before the next one or the owner's next words, and a call file
 * with torn lines.
 *
 * The pairing is by time, never by a recorded link, because no line records which speech voiced which message: a
 * `held-answer` tool line exists only for a message the console held off the voice (`site/components/voice/planWiringLines.ts`).
 * A message's voice segments are the final voice segments that BEGAN at or after it was written and before the next
 * message was, stopping at the first segment of the owner's that began in between.
 *
 * Repro over every call on the install: `slopweaver talk fidelity --since <iso-instant>`.
 */
import { type CallRecord, type CallSegment, type CallWritten, OWNER_SPEAKER } from "./callRecord.js";
import { contentWords, divergence } from "./wordDivergence.js";

/** One handed message and what the voice said for it. */
export interface FidelityPair {
  readonly callId: string;
  /** `talk-call:<call>#<segment>` of the first voice segment that spoke it. */
  readonly anchor: string;
  /** When the thinking model's message was written. */
  readonly writtenIso: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly handed: string;
  readonly spoken: string;
  /** Content words the voice said that no handed sentence holds, in the order said. */
  readonly added: readonly string[];
  /** Content words the voice said in a sentence other than the handed one(s) that hold them, in the order said. */
  readonly relocated: readonly string[];
}

/** What the read could not see, so a low count is never read as a clean one. */
interface FidelityGap {
  readonly callId: string;
  readonly kind: "no-written-record" | "unvoiced" | "torn-lines" | "unknown-surface";
  readonly detail: string;
}

/** One UTC day's counts, the regression question's unit. */
interface FidelityDay {
  readonly day: string;
  readonly pairs: number;
  readonly pairsWithAdded: number;
  readonly pairsWithRelocated: number;
  /** Content words spoken across the day's pairs: the denominator for the two counts below. */
  readonly spokenWords: number;
  readonly addedWords: number;
  readonly relocatedWords: number;
}

/** The whole reading. */
export interface FidelityReport {
  /** Voice calls read; a typed conversation has no voice paraphrase, so it is not one. */
  readonly voiceCalls: number;
  /** Every pair, oldest first. */
  readonly pairs: readonly FidelityPair[];
  /** Oldest day first. */
  readonly days: readonly FidelityDay[];
  readonly gaps: readonly FidelityGap[];
}

/**
 * The fidelity reading over some calls: only voice calls, only messages written inside the window.
 *
 * @param calls the calls read
 * @param sinceIso count only messages written at or after this instant
 * @param untilIso count only messages written before this instant
 * @returns every pair oldest first, the per-day counts, and what could not be read
 */
export function voiceFidelityReport({
  calls,
  sinceIso,
  untilIso,
}: {
  calls: readonly CallRecord[];
  sinceIso: string;
  untilIso: string;
}): FidelityReport {
  const sinceMs = Date.parse(sinceIso);
  const untilMs = Date.parse(untilIso);
  // `foldCall` reads a call whose open line did not parse as voice, so a torn typed open would count a typed
  // conversation. An open line always carries a session id, so a record without one has no surface it can prove.
  // Known limit: a record keeps only the newest session's surface, so a call id reused by a typed
  // session and then a voice one counts the typed activity too. Closing it means the fold keeping a surface per
  // session, which every call reader shares; until then a count here is a candidate, as the verb's header says.
  const unproven = calls.filter((call) => call.sessionId === undefined);
  const voiceCalls = calls.filter((call) => call.surface === "voice" && call.sessionId !== undefined);
  const pairs: FidelityPair[] = [];
  const gaps: FidelityGap[] = unproven.map((call) => ({
    callId: call.callId,
    detail: `opened ${call.openedIso}: no open line parsed, so whether it was a voice call is unknown and it is not counted`,
    kind: "unknown-surface",
  }));
  for (const call of voiceCalls) {
    const inWindow = call.written.filter((one) => {
      const atMs = Date.parse(one.atIso);
      return atMs >= sinceMs && atMs < untilMs;
    });
    gaps.push(...callGaps({ call, inWindow }));
    pairs.push(...callPairs({ call, inWindow }));
  }
  const sorted = pairs.toSorted((left, right) => Date.parse(left.writtenIso) - Date.parse(right.writtenIso));
  return { days: daysOf({ pairs: sorted }), gaps, pairs: sorted, voiceCalls: voiceCalls.length };
}

/** What one call's read could not see. */
function callGaps({ call, inWindow }: { call: CallRecord; inWindow: readonly CallWritten[] }): readonly FidelityGap[] {
  const gaps: FidelityGap[] = [];
  const spoke = call.segments.some((segment) => segment.who === "voice" && segment.final);
  if (call.written.length === 0 && spoke) {
    gaps.push({
      callId: call.callId,
      detail: `opened ${call.openedIso}: the voice spoke but no message the thinking model wrote is on file`,
      kind: "no-written-record",
    });
  }
  if (call.skipped > 0) {
    gaps.push({
      callId: call.callId,
      detail: `${String(call.skipped)} line(s) did not parse, so a message or segment in one is not read`,
      kind: "torn-lines",
    });
  }
  const unvoiced = inWindow.filter((one) => voicedBy({ call, written: one }).length === 0);
  if (unvoiced.length > 0) {
    gaps.push({
      callId: call.callId,
      detail: `${String(unvoiced.length)} message(s) with no voice segment before the next message or the owner's next words (held, dropped or cut off)`,
      kind: "unvoiced",
    });
  }
  return gaps;
}

/** One call's pairs: each message in the window with the voice segments that spoke it. */
function callPairs({
  call,
  inWindow,
}: {
  call: CallRecord;
  inWindow: readonly CallWritten[];
}): readonly FidelityPair[] {
  return inWindow.flatMap((written) => {
    const voiced = voicedBy({ call, written });
    const first = voiced[0];
    if (first === undefined) {
      return [];
    }
    const spoken = voiced.map((segment) => segment.text.trim()).join(" ");
    const { added, relocated } = divergence({ handed: written.text, spoken });
    return [
      {
        added,
        anchor: `talk-call:${call.callId}#${first.id}`,
        callId: call.callId,
        handed: written.text,
        itemId: written.itemId,
        relocated,
        spoken,
        turnId: written.turnId,
        writtenIso: written.atIso,
      },
    ];
  });
}

/**
 * The final voice segments that spoke one message: began from it to the next message, stopping at the owner's next words. Two
 * messages written at the same instant cannot both own what followed, so the one written later in the file takes it
 * and the earlier one owns nothing — a segment is never paired twice.
 */
function voicedBy({ call, written }: { call: CallRecord; written: CallWritten }): readonly CallSegment[] {
  const fromMs = Date.parse(written.atIso);
  const sameInstantLater = call.written
    .slice(call.written.indexOf(written) + 1)
    .some((one) => Date.parse(one.atIso) === fromMs);
  if (sameInstantLater) {
    return [];
  }
  const nextWritten = call.written
    .map((one) => Date.parse(one.atIso))
    .filter((atMs) => atMs > fromMs)
    .toSorted((left, right) => left - right)[0];
  let toMs = Number.POSITIVE_INFINITY;
  if (nextWritten !== undefined) {
    toMs = nextWritten;
  }
  const ownerNext = call.segments
    // Any of the owner's words cut the pair off, final or not: an interruption cut short may never be written final.
    .filter((segment) => segment.who === OWNER_SPEAKER)
    .map((segment) => Date.parse(segment.beganIso))
    .filter((atMs) => atMs >= fromMs)
    .toSorted((left, right) => left - right)[0];
  if (ownerNext !== undefined && ownerNext < toMs) {
    toMs = ownerNext;
  }
  return call.segments
    .filter((segment) => {
      const beganMs = Date.parse(segment.beganIso);
      return segment.who === "voice" && segment.final && beganMs >= fromMs && beganMs < toMs;
    })
    .toSorted((left, right) => Date.parse(left.beganIso) - Date.parse(right.beganIso));
}

/** The per-day counts, oldest day first. */
function daysOf({ pairs }: { pairs: readonly FidelityPair[] }): readonly FidelityDay[] {
  const byDay = new Map<string, FidelityPair[]>();
  for (const pair of pairs) {
    const day = new Date(Date.parse(pair.writtenIso)).toISOString().slice(0, 10);
    const list = byDay.get(day);
    if (list === undefined) {
      byDay.set(day, [pair]);
    } else {
      list.push(pair);
    }
  }
  return [...byDay.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([day, list]) => ({
      addedWords: list.reduce((sum, pair) => sum + pair.added.length, 0),
      day,
      pairs: list.length,
      pairsWithAdded: list.filter((pair) => pair.added.length > 0).length,
      pairsWithRelocated: list.filter((pair) => pair.relocated.length > 0).length,
      relocatedWords: list.reduce((sum, pair) => sum + pair.relocated.length, 0),
      spokenWords: list.reduce((sum, pair) => sum + new Set(contentWords({ text: pair.spoken })).size, 0),
    }));
}
