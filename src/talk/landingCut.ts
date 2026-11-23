/**
 * Whether the call file NOW shows a landed utterance's words cut — the second half of a card landing's `wordsCut`.
 *
 * A landing row records the cut it saw when it was written, and a later re-derivation that finds the same words cut
 * writes a new row only while the card is still off the owner's Queue: once they restored it, the restore wins and no
 * row is written (`./cardLanding.ts` `repeatLanding`). So the row alone can read whole for words the call file now
 * shows cut — an overtaken batch's unfinished stretch, empty after normalising, joined in ahead of them. A reader binding the owner's yes therefore asks the call file too, and a cut either one shows is a cut.
 */
import { CALL_TEXT_CHARS, type CallEntry, type CallSegment, OWNER_SPEAKER } from "./callRecord.js";
import { type CardUtterance, callSegmentAnchor, closedCardUtterances } from "./cardUtterance.js";
import { stretchLineLost } from "./stretchLineLost.js";

/**
 * Whether one stretch holds less than the owner said: the call dropped it mid-speech, the call file capped it, or a
 * line of it may hold words its folded text lost — the one rule `./cardUtterance.ts` reads a card utterance by
 * (`./stretchLineLost.ts`).
 */
function stretchCut({ entries, segment }: { entries: readonly CallEntry[]; segment: CallSegment }): boolean {
  if (!segment.final || segment.text.length >= CALL_TEXT_CHARS) {
    return true;
  }
  return entries.some(
    (entry) => entry.kind === "segment" && entry.id === segment.id && stretchLineLost({ line: entry, winner: segment }),
  );
}

/**
 * Whether any stretch of the unbroken run of the owner's speech that a `talk-call:` anchor's stretch sits in holds
 * less than they said. A run ends, either side, at the voice speaking or at the card changing, so it holds with no
 * card open at all, where {@link callShowsLandingCut} sees no utterance: "yes, send it" then an unfinished "actually,
 * don't" is one run, and its first stretch alone is never their whole yes; nor is a stretch an overtaken, unfinished
 * one ran ahead of (both directions, as for a card landing).
 *
 * @param entries the call's lines that parsed, in file order, whose every snapshot of a stretch is checked
 * @param segments the call's folded stretches, in the order they began
 * @param segmentId the stretch the anchor names
 * @returns `true` when a stretch of its run is cut; `false` when it is not in the call
 */
export function stretchRunCut({
  entries,
  segments,
  segmentId,
}: {
  entries: readonly CallEntry[];
  segments: readonly CallSegment[];
  segmentId: string;
}): boolean {
  const at = segments.findIndex((segment) => segment.id === segmentId);
  if (at < 0) {
    return false;
  }
  const named = segments[at]!;
  const inRun = (segment: CallSegment): boolean => segment.who === OWNER_SPEAKER && segment.open === named.open;
  let start = at;
  while (start > 0 && inRun(segments[start - 1]!)) {
    start -= 1;
  }
  let end = at + 1;
  while (end < segments.length && inRun(segments[end]!)) {
    end += 1;
  }
  return segments.slice(start, end).some((segment) => stretchCut({ entries, segment }));
}

/**
 * Whether any utterance of the call holding one of the landed anchors now has words cut.
 *
 * Every stretch is read as finished-or-not by the call ending here (`ended`), so one still running counts as cut:
 * words the owner may still be saying are never their whole yes.
 *
 * @param callId the call the landing's anchors name
 * @param entries the call's lines that parsed, in file order
 * @param anchors every anchor the landing row carries, its first and its later ones
 * @returns `true` when the call shows a stretch of that utterance unfinished, or at the call file's cap
 */
export function callShowsLandingCut({
  callId,
  entries,
  anchors,
}: {
  callId: string;
  entries: readonly CallEntry[];
  anchors: readonly string[];
}): boolean {
  return landedUtterances({ anchors, callId, entries }).some((utterance) => utterance.wordsCut);
}

/**
 * Whether the call now carries a landed utterance's words EXACTLY, from a stretch it finished: what lifts a cut a row
 * recorded when a later final snapshot arrived after it. Only the same words lift it — a row cut off an
 * unfinished snapshot holds the shorter words, and those are never the owner's whole yes however the call ended.
 * And ONE utterance must hold every anchor the row carries: a row whose stretches the call now splits across two
 * utterances names words no single one of them says. Ask {@link callShowsLandingCut} first: this
 * reads only whether the words match.
 *
 * @param callId the call the landing's anchors name
 * @param entries the call's lines that parsed, in file order
 * @param anchors every anchor the landing row carries
 * @param words the landing row's words
 * @returns `true` when one utterance holding all of the anchors is whole and says exactly `words`
 */
export function callCarriesLandedWords({
  callId,
  entries,
  anchors,
  words,
}: {
  callId: string;
  entries: readonly CallEntry[];
  anchors: readonly string[];
  words: string;
}): boolean {
  return landedUtterances({ anchors, callId, entries }).some((utterance) => carries({ anchors, utterance, words }));
}

/**
 * Whether the call file ITSELF shows a landed utterance ended and saying exactly a landing's words — the only proof
 * that lifts a cut a row recorded. {@link callCarriesLandedWords} reads the call as ending here, so a last run still
 * open, the owner perhaps still saying it, would read finished; this reads the call's own boundaries instead (a close
 * line, the voice speaking, the card changing, a relay starting), so an unterminated run holds no utterance at all and
 * lifts nothing. The fold reads a close line ANYWHERE in the file as ending the last run, so a close ends
 * one here only when it was written after every line of it: one written before the utterance proves nothing about how
 * it ended.
 *
 * @param callId the call the landing's anchors name
 * @param entries the call's lines that parsed, in file order
 * @param anchors every anchor the landing row carries
 * @param words the landing row's words
 * @returns `true` when one utterance the call file itself closed holds all of the anchors, is whole and says `words`
 */
export function callEndsLandedWords({
  callId,
  entries,
  anchors,
  words,
}: {
  callId: string;
  entries: readonly CallEntry[];
  anchors: readonly string[];
  words: string;
}): boolean {
  const unclosed = entries.filter((entry) => entry.kind !== "closed");
  if (closedCardUtterances({ callId, entries: unclosed }).some((utterance) => carries({ anchors, utterance, words }))) {
    return true;
  }
  const lastClose = entries.findLastIndex((entry) => entry.kind === "closed");
  if (lastClose < 0) {
    return false;
  }
  return closedCardUtterances({ callId, entries }).some((utterance) => {
    const held = new Set([utterance.anchor, ...utterance.laterAnchors]);
    const writtenBeforeClose = entries.every(
      (entry, at) =>
        entry.kind !== "segment" || !held.has(callSegmentAnchor({ callId, segmentId: entry.id })) || at < lastClose,
    );
    return writtenBeforeClose && carries({ anchors, utterance, words });
  });
}

/** Whether one utterance holds every anchor a landing carries, is whole, and says exactly its words. */
function carries({
  anchors,
  utterance,
  words,
}: {
  anchors: readonly string[];
  utterance: CardUtterance;
  words: string;
}): boolean {
  const held = new Set([utterance.anchor, ...utterance.laterAnchors]);
  return !utterance.wordsCut && utterance.words === words && anchors.every((one) => held.has(one));
}

/**
 * Whether the call file still holds a stretch for every anchor a landing carries. One it no longer holds — the file
 * rewritten or cut short since the landing — leaves nothing to show those words cut, so finding no cut there proves
 * nothing. Ask this before {@link callShowsLandingCut}.
 *
 * @param callId the call the landing's anchors name
 * @param entries the call's lines that parsed, in file order
 * @param anchors every anchor the landing row carries
 * @returns `true` when every anchor names a stretch the call file has a line for
 */
export function callHoldsLandedAnchors({
  callId,
  entries,
  anchors,
}: {
  callId: string;
  entries: readonly CallEntry[];
  anchors: readonly string[];
}): boolean {
  const held = new Set(
    entries.flatMap((entry) => (entry.kind === "segment" ? [callSegmentAnchor({ callId, segmentId: entry.id })] : [])),
  );
  return anchors.every((anchor) => held.has(anchor));
}

/**
 * Whether the call still places a landing's words where a transcript landing put them: the one utterance holding
 * every anchor is said over the landing's card, opened by the owner. A transcript landing takes its card off the
 * call, and a late snapshot that began earlier re-places a stretch (`./cardUtterance.ts`'s fold), so words that
 * moved to another card, or under a card the voice opened, are no longer an answer to the card they landed on. The fold places a stretch by its earliest line while its words come from the winning one, so EVERY line
 * of the utterance's stretches must name that card, opened by the owner: a line stamped otherwise may be the one
 * whose words won.
 *
 * @param callId the call the landing's anchors name
 * @param entries the call's lines that parsed, in file order, each stamped with the card it was said over
 * @param anchors every anchor the landing row carries
 * @param cardKey the card the landing row names
 * @returns `true` when one utterance holding all of the anchors is over `cardKey`, every line of it so stamped, and
 *   none opened by the voice
 */
export function callPlacesLanding({
  callId,
  entries,
  anchors,
  cardKey,
}: {
  callId: string;
  entries: readonly CallEntry[];
  anchors: readonly string[];
  cardKey: string;
}): boolean {
  return landedUtterances({ anchors, callId, entries }).some((utterance) => {
    const held = new Set([utterance.anchor, ...utterance.laterAnchors]);
    const linesPlaced = entries.every(
      (entry) =>
        entry.kind !== "segment" ||
        !held.has(callSegmentAnchor({ callId, segmentId: entry.id })) ||
        (entry.open === cardKey && entry.openBy !== "voice"),
    );
    return (
      utterance.cardKey === cardKey &&
      utterance.openBy !== "voice" &&
      linesPlaced &&
      anchors.every((one) => held.has(one))
    );
  });
}

/** The call's utterances holding one of a landing's anchors, every stretch read as finished-or-not by the call ending. */
function landedUtterances({
  callId,
  entries,
  anchors,
}: {
  callId: string;
  entries: readonly CallEntry[];
  anchors: readonly string[];
}): readonly CardUtterance[] {
  const landed = new Set(anchors);
  return closedCardUtterances({ callId, ended: true, entries }).filter((utterance) =>
    [utterance.anchor, ...utterance.laterAnchors].some((one) => landed.has(one)),
  );
}
