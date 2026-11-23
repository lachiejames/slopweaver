/**
 * The owner's own words as one queryable source — the pure half of `slopweaver profile words`.
 *
 * The owner's words are a data source: queryable, with timestamps, and saying whether each was spoken in a voice
 * conversation or written. Without it, finding a quote means mining transcripts by hand, so a Queue card is often
 * registered with no anchor to the owner's words and says nothing records whose words are behind it.
 *
 * ## Three records, each read by the module that owns it
 *
 * - **Spoken, on a call** — a console call's stretches of the OWNER's speech (`../talk/callRecord.ts`), anchored
 *   `talk-call:`.
 * - **On the console, relayed** — a steer the console put on the board (`../talk/relayStore.ts`), anchored `talk:`,
 *   registered or not: spoken when the voice relayed it, written when the owner typed it.
 * - **Written, to the supervisor** — the owner's turns across the whole pinned chain (`./supervisorWords.ts`),
 *   anchored `transcript:`. A turn opening `[voice relay ` is the console typing a relay into the chair, so it is
 *   left out rather than listed twice; one Claude Code wrote and the owner only accepted is not the owner's.
 *
 * **A spoken relay and the call stretch it came from are BOTH listed.** A relay records no call or segment id, so
 * nothing ties the two but their text, and text is not identity: two steers can say the same thing. They are
 * different records — the stretch is what the call heard, the relay is what reached a row, carrying that row's anchor.
 *
 * **Spoken and written say how the CONVERSATION carried it, not what produced the text.** A chair turn the owner dictated
 * arrived as text in a written conversation, and no record tells dictation from typing, so it reads written.
 *
 * Every instant is the one its record carries: a call stretch's last snapshot, a console steer's staging, a chair
 * turn's own timestamp. Every quote is verbatim, and where the record itself kept only part of what the owner said it says
 * so. Nothing here reads a file or a clock.
 */
import type { RawWords } from "../handover/hisWordsResolve.js";
import type { OwnerTurn } from "../supervisor/intake.js";
import { CALL_TEXT_CHARS, type CallRecord } from "../talk/callRecord.js";
import type { CallsRead } from "../talk/callStore.js";
import { isChairPointerLine } from "../talk/chairWake.js";
import { unwrapPaste } from "../talk/relayLine.js";
import type { TurnRecord } from "../talk/relayStore.js";
import { containsWord, phraseWords } from "../talk/supervisorHistory.js";
import { formatCallPointer } from "../talk/unreadWords.js";

/** How the conversation carried the owner's words. */
export type OwnerWordsHow = "spoken" | "written";

/**
 * Where the owner said them. `claude-session` and `call-landing` are only ever an anchor read whole: a list reads the
 * supervisor chain, the calls and the relays.
 */
export type OwnerWordsWhere =
  "console-call" | "console-relay" | "console-typed" | "supervisor" | "claude-session" | "call-landing";

/**
 * Whether the record holds all of what the owner said, lost its start or its end, or does not say — a relay written before
 * it stored whether it kept only the tail.
 */
export type OwnerWordsCut = "none" | "start" | "end" | "unknown";

/** One thing the owner said, verbatim, and where to read it again. */
export interface OwnerUtterance {
  readonly anchor: string;
  readonly atIso: string;
  readonly how: OwnerWordsHow;
  readonly where: OwnerWordsWhere;
  readonly text: string;
  /** The text's length in UTF-16 units, the measure a Queue card's fold uses. */
  readonly chars: number;
  readonly cut: OwnerWordsCut;
}

/** A record the read could not take whole — so a match missing from the answer may be there. */
export interface OwnerWordsGap {
  readonly source: "console-calls" | "console-relays" | "supervisor";
  readonly why: string;
}

/** What a list asks for. */
export interface OwnerWordsQuery {
  readonly phrase: string | undefined;
  readonly how: OwnerWordsHow | undefined;
  /** Inclusive. */
  readonly sinceIso: string;
  /** Exclusive. */
  readonly untilIso: string;
  readonly limit: number;
}

/** The answer to one query, newest first. */
export interface OwnerWordsReport {
  readonly sinceIso: string;
  readonly untilIso: string;
  readonly phraseWords: readonly string[];
  readonly how: OwnerWordsHow | undefined;
  /** Every utterance the query matched. */
  readonly matched: number;
  readonly spoken: number;
  readonly written: number;
  /** The newest `limit` of them. */
  readonly shown: readonly OwnerUtterance[];
  readonly omitted: number;
  readonly gaps: readonly OwnerWordsGap[];
}

/** The opening the console's relay types into the chair (`../talk/supervisorDelivery.ts`'s `relayTurnLine`). */
const VOICE_RELAY_OPENING = "[voice relay ";

/**
 * Whether a chair turn is the console typing a relay into the supervisor — the relay is the owner's words' record, this line
 * is its delivery, so neither a list nor an attach takes it as a turn of the owner's. Looser than `relayLineSlug`
 * (`../talk/relayLine.ts`): any slug after the marker counts here, where the intake check wants the minted shape.
 *
 * @param text the turn's text
 * @returns true when it opens the way the console's relay line does, bare or inside a paste wrapper
 */
export function isVoiceRelayLine({ text }: { text: string }): boolean {
  return unwrapPaste({ text }).startsWith(VOICE_RELAY_OPENING);
}

/**
 * Whether a chair turn is a line the console typed rather than words of the owner's: a relay's delivery, or a chair's quiet
 * batch (`../talk/chairWake.ts`), which carries none of the owner's words and points at the calls and relays that hold them.
 *
 * @param text the turn's text
 * @returns true for either line, bare or inside a paste wrapper
 */
export function isConsoleTypedLine({ text }: { text: string }): boolean {
  return isVoiceRelayLine({ text }) || isChairPointerLine({ text });
}

/** One utterance built from its record's fields. */
function utterance({ anchor, atIso, how, where, text, cut }: Omit<OwnerUtterance, "chars">): OwnerUtterance {
  return { anchor, atIso, chars: text.length, cut, how, text, where };
}

/**
 * The owner's stretches of speech across the calls read, and every call file or line that would not read.
 *
 * @param read the calls `readCalls` found
 * @returns one spoken utterance per stretch of the owner's, and the gaps
 */
export function utterancesFromCalls({ read }: { read: CallsRead }): {
  readonly utterances: readonly OwnerUtterance[];
  readonly gaps: readonly OwnerWordsGap[];
} {
  const gaps: OwnerWordsGap[] = read.unreadable.map((why) => ({ source: "console-calls" as const, why }));
  const utterances = read.calls.flatMap((call: CallRecord) => {
    if (call.skipped > 0) {
      gaps.push({
        source: "console-calls",
        why: `${String(call.skipped)} line(s) of call ${call.callId} do not parse`,
      });
    }
    return call.segments
      .filter((segment) => segment.who === "owner" && segment.text.trim() !== "")
      .map((segment) => {
        // A stretch the call dropped mid-speech, or one at the file's cap, holds less than the owner said.
        let cut: OwnerWordsCut = "none";
        if (!segment.final || segment.text.length >= CALL_TEXT_CHARS) {
          cut = "end";
        }
        return utterance({
          anchor: formatCallPointer({ callId: call.callId, segmentId: segment.id }),
          atIso: segment.atIso,
          cut,
          how: "spoken",
          text: segment.text,
          where: "console-call",
        });
      });
  });
  return { gaps, utterances };
}

/**
 * Whether a relay kept all of what the owner said, at both ends: it kept only the tail, it was made mid-sentence, or
 * it predates saying either — the same reading `utteranceFromRaw` gives the same record by anchor.
 */
function relayCut({ turn }: { turn: TurnRecord }): OwnerWordsCut {
  if (turn.heardTruncated === true) {
    return "start";
  }
  if (turn.heardTruncated === undefined) {
    return "unknown";
  }
  if (turn.heardTailCut === true) {
    return "end";
  }
  // A typed steer is whole by construction; a voice relay that never said whether it was made mid-sentence is unknown.
  if (turn.heardTailCut === undefined && !turn.typed) {
    return "unknown";
  }
  return "none";
}

/**
 * The steers the owner gave the console — written when typed, spoken when the voice relayed it. A relay carrying
 * no words of the owner's (one written before they were stored) is a gap, never the voice's paraphrase passed off as theirs.
 *
 * @param turns every relay turn read, registered or not
 * @param unreadable why each turn file that would not read did not
 * @returns one utterance per steer carrying the owner's words, and the gaps
 */
export function utterancesFromConsoleTurns({
  turns,
  unreadable,
}: {
  turns: readonly TurnRecord[];
  unreadable: readonly string[];
}): {
  readonly utterances: readonly OwnerUtterance[];
  readonly gaps: readonly OwnerWordsGap[];
} {
  const wordless = turns.filter((turn) => turn.heard.trim() === "");
  const gaps: OwnerWordsGap[] = unreadable.map((why) => ({ source: "console-relays" as const, why }));
  if (wordless.length > 0) {
    gaps.push({
      source: "console-relays",
      why: `${String(wordless.length)} relay(s) recorded the voice's words but none of the owner's (first: ${wordless[0]!.anchor})`,
    });
  }
  const utterances = turns
    .filter((turn) => turn.heard.trim() !== "")
    .map((turn) => {
      let how: OwnerWordsHow = "spoken";
      let where: OwnerWordsWhere = "console-relay";
      if (turn.typed) {
        how = "written";
        where = "console-typed";
      }
      const text = turn.heard;
      return utterance({ anchor: turn.anchor, atIso: turn.stagedAtIso, cut: relayCut({ turn }), how, text, where });
    });
  return { gaps, utterances };
}

/**
 * The owner's turns in the supervisor chat — a console relay and an accepted suggestion left out, a spliced turn counted
 * as a gap because its text joins what the record kept apart.
 *
 * @param turns the owner's turns across the chain, inside each chair's own tenures
 * @param problems what the chain read could not take whole: the journal, or a chair's transcript
 * @returns one written utterance per turn of the owner's, and the gaps
 */
export function utterancesFromSupervisorTurns({
  turns,
  problems,
}: {
  turns: readonly OwnerTurn[];
  problems: readonly string[];
}): { readonly utterances: readonly OwnerUtterance[]; readonly gaps: readonly OwnerWordsGap[] } {
  const gaps: OwnerWordsGap[] = problems.map((why) => ({ source: "supervisor" as const, why }));
  const owners = turns.filter(
    (turn) => turn.source !== "suggestion-accepted" && !isConsoleTypedLine({ text: turn.text }),
  );
  // A record that does not SAY the owner typed or queued it is a gap, never quoted as theirs.
  const unproven = owners.filter((turn) => turn.source === "unknown");
  if (unproven.length > 0) {
    gaps.push({
      source: "supervisor",
      why: `${String(unproven.length)} turn(s) carry no promptSource saying the owner typed or queued them, so none is read as theirs (first: ${unproven[0]!.pointer})`,
    });
  }
  const kept = owners.filter((turn) => turn.source !== "unknown");
  const spliced = kept.filter((turn) => turn.spliced === true);
  if (spliced.length > 0) {
    gaps.push({
      source: "supervisor",
      why: `${String(spliced.length)} turn(s) had a wrapper cut from between the owner's words, so none quotes verbatim (first: ${spliced[0]!.pointer})`,
    });
  }
  const utterances = kept
    .filter((turn) => turn.spliced !== true && turn.text.trim() !== "")
    .map((turn) => {
      let cut: OwnerWordsCut = "none";
      if (turn.tailCut === true) {
        cut = "end";
      }
      return utterance({
        anchor: turn.pointer,
        atIso: turn.timestamp,
        cut,
        how: "written",
        text: turn.text,
        where: "supervisor",
      });
    });
  return { gaps, utterances };
}

/** How and where each record an anchor names carried the owner's words. */
const RAW_PLACE: Readonly<Record<RawWords["where"], { readonly how: OwnerWordsHow; readonly where: OwnerWordsWhere }>> =
  {
    call: { how: "spoken", where: "console-call" },
    "call-landing": { how: "spoken", where: "call-landing" },
    "console-typed": { how: "written", where: "console-typed" },
    "console-voice": { how: "spoken", where: "console-relay" },
    session: { how: "written", where: "claude-session" },
  };

/**
 * One record an anchor names, whole, as an utterance — what `profile words <anchor>` prints.
 *
 * @param anchor the anchor it was read at
 * @param raw the record's whole text, instant and what it kept
 * @returns the utterance
 */
export function utteranceFromRaw({ anchor, raw }: { anchor: string; raw: RawWords }): OwnerUtterance {
  let cut: OwnerWordsCut = "none";
  if (raw.headLost) {
    cut = "start";
  } else if (!raw.headKnown) {
    cut = "unknown";
  } else if (raw.tailLost) {
    cut = "end";
  } else if (!raw.tailKnown) {
    cut = "unknown";
  }
  return utterance({ anchor, atIso: raw.atIso, cut, text: raw.text, ...RAW_PLACE[raw.where] });
}

/** Whether an utterance's text holds every word of the phrase. */
function matchesPhrase({ text, words }: { text: string; words: readonly string[] }): boolean {
  return words.every((word) => containsWord({ text, word }));
}

/**
 * Answer one query: filter by window, how and phrase, newest first, the newest `limit` shown. An utterance whose
 * record carries no instant cannot be placed in any window, so it becomes a gap rather than the oldest line.
 *
 * @param utterances every utterance read, from every source
 * @param gaps what the reads could not take whole
 * @param query the window, how, phrase and limit
 * @returns the report
 */
export function queryOwnerWords({
  utterances,
  gaps,
  query,
}: {
  utterances: readonly OwnerUtterance[];
  gaps: readonly OwnerWordsGap[];
  query: OwnerWordsQuery;
}): OwnerWordsReport {
  const since = Date.parse(query.sinceIso);
  const until = Date.parse(query.untilIso);
  let words: readonly string[] = [];
  if (query.phrase !== undefined) {
    words = phraseWords({ phrase: query.phrase });
  }
  const undated = utterances.filter((one) => Number.isNaN(Date.parse(one.atIso)));
  const allGaps = [...gaps];
  if (undated.length > 0) {
    allGaps.push({
      source: sourceOf({ where: undated[0]!.where }),
      why: `${String(undated.length)} record(s) carry no instant, so no window can hold them (first: ${undated[0]!.anchor})`,
    });
  }
  const matched = utterances
    .filter((one) => {
      const at = Date.parse(one.atIso);
      return !Number.isNaN(at) && at >= since && at < until;
    })
    .filter((one) => query.how === undefined || one.how === query.how)
    .filter((one) => matchesPhrase({ text: one.text, words }))
    .toSorted((a, b) => Date.parse(b.atIso) - Date.parse(a.atIso) || a.anchor.localeCompare(b.anchor));
  const shown = matched.slice(0, query.limit);
  return {
    gaps: allGaps,
    how: query.how,
    matched: matched.length,
    omitted: matched.length - shown.length,
    phraseWords: words,
    shown,
    sinceIso: query.sinceIso,
    spoken: matched.filter((one) => one.how === "spoken").length,
    untilIso: query.untilIso,
    written: matched.filter((one) => one.how === "written").length,
  };
}

/** The gap source a where belongs to. */
function sourceOf({ where }: { where: OwnerWordsWhere }): OwnerWordsGap["source"] {
  if (where === "console-call" || where === "call-landing") {
    return "console-calls";
  }
  if (where === "console-typed" || where === "console-relay") {
    return "console-relays";
  }
  return "supervisor";
}
