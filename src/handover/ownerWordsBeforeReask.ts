/**
 * The gate a seat meets before it puts a run's HELD question in front of the owner again — `hand post` naming the
 * run's row, `handover park` carrying the question — when the owner has already spoken over that question's own Queue
 * card (`ask:<slug>`) since it was asked. The seat must name every such utterance's call anchor in
 * `--read-owner-words <reference,...>` before the re-ask goes through.
 *
 * ## The defect it closes
 *
 * The voice opened run `backup-master-password-wraps-the-backup-key`'s card in a call and the owner said "I have
 * saved it". The relay was registered as said over no card and settled against an unrelated row, so the run's
 * question stayed open; a reseat parked on it the next day and a hand note asked the owner again. Nothing between the
 * call file and the re-ask read the words. Find the shape in a call record: an owner segment carrying
 * `"open":"ask:<slug>"` stamped after that run's `question` line, with the run still `waiting-on-owner`.
 *
 * ## What it lists, and what it cannot
 *
 * Every utterance `../talk/cardUtterance.ts`'s `closedCardUtterances` finds over `ask:<slug>` begun at or after the
 * question's `askedIso` — VOICE-opened included, judged an answer or not, a greeting included, since only the seat can
 * tell "good morning" from "I saved it" and a seat cannot be watched reading. Each call is read as ENDED, so a stretch
 * still being said or a relay still in flight is listed rather than held back: the gate lists sooner, never later. A
 * call the desktop test instance touched is not the owner's and lists nothing.
 *
 * MEASURED over the real record: for that run's card it lists one utterance of that call, begun under the
 * voice-opened card, so both the next day's park and the hand note would have been refused with it in front of the
 * seat. Repro: `handover park backup-master-password-wraps-the-backup-key` on a home holding that call and journal.
 *
 * It does NOT see words said over no card or over another card (that is judgement, the voice's), nor the
 * "I have saved it" segment itself, which the page of that day wrote with no `open` stamp. A call file that would not read, or a call
 * naming the card with a line that would not parse ({@link heldQuestionReadGaps}), refuses as a gap until the seat
 * names it as read by hand, since it may hold exactly the words this gate exists to show.
 *
 * Each check is one point-in-time read of the call directory. A file written while the read walks it, or a word
 * appended after it, is residue: the call file is written under its own lock, never the re-asking verb's. Both verbs
 * read again right before their own write (`hand post` under the register lock, `handover park` with no await before
 * its journal append), so the window is that write and nothing longer.
 *
 * Pure: the caller supplies the call lines, the question's instant and what the seat says it read.
 */

import { parseStrictIsoInstantMs } from "#lib/date.js";
import { fitOnOneLine } from "#lib/oneLineSummary.js";

import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { callTouchedByTestInstance } from "../talk/callOrigin.js";
import type { CallEntry } from "../talk/callRecord.js";
import { closedCardUtterances } from "../talk/cardUtterance.js";
import { READ_OWNER_WORDS_FLAG } from "./laterOwnerWords.js";

/** How much of one utterance the refusal quotes, so a long stretch stays one line. */
const EXCERPT_CHARS = 140;

/** One call's lines as read from its file. */
export interface OwnerWordCall {
  readonly callId: string;
  /** The lines that parsed, in file order. */
  readonly entries: readonly CallEntry[];
  /** How many lines did not parse. */
  readonly skipped: number;
}

/**
 * The calls whose unparsed lines may hide the owner's words over one card: those with a line that did not parse AND a
 * line that parsed naming the card — a segment said over it, the voice moving to it. MEASURED on the owner's home
 * (153 call files written in the two weeks after the incident's question, 5 with an unparsed line, none naming the
 * incident's card): counting every unparsed line would refuse every re-ask on every held question on five unrelated
 * calls. Repro, with `SINCE_ISO` set to the held question's `askedIso`:
 * `node_modules/.bin/tsx -e 'import("./src/talk/callStore.ts").then(m => { const r = m.readRecentCallEntries({ home:
 * process.env.SLOPWEAVER_HOME, sinceIso: process.env.SINCE_ISO })._unsafeUnwrap(); console.log(r.calls.length,
 * r.calls.filter(c => c.skipped > 0).length) })'`. The residue, stated: a call
 * whose ONLY line naming the card is the one that did not parse is missed.
 *
 * @param calls the call files written since the question was asked
 * @param cardKey the held question's card
 * @returns one gap per such call, named by its call id
 */
export function heldQuestionReadGaps({
  calls,
  cardKey,
}: {
  calls: readonly OwnerWordCall[];
  cardKey: string;
}): readonly OwnerWordsReadGap[] {
  const quoted = JSON.stringify(cardKey);
  return calls
    .filter((call) => call.skipped > 0 && !callTouchedByTestInstance({ entries: call.entries }))
    .filter((call) => call.entries.some((entry) => JSON.stringify(entry).includes(quoted)))
    .map((call) => ({ reference: call.callId, why: `${call.skipped} line(s) did not parse` }));
}

/** One utterance the owner made over the held question's card since it was asked. */
export interface HeldQuestionOwnerWord {
  /** `call:<callId>#<segment>` — what the seat names as read. */
  readonly anchor: string;
  /** When the owner began. */
  readonly decidedIso: string;
  /** The words, whitespace-normalised. */
  readonly words: string;
  /** Whether the call record may hold fewer words than were said. */
  readonly wordsCut: boolean;
  /** `voice` when the voice put the card in front of the owner. */
  readonly openBy?: "voice";
}

/** Something the gate could not read, named by what the seat would write in the flag once it has read it by hand. */
export interface OwnerWordsReadGap {
  /** A call id, or a call anchor's prefix `call:<callId>`. */
  readonly reference: string;
  /** Why it could not be read. */
  readonly why: string;
}

/** What the re-asking verb should do. */
export type OwnerWordsBeforeReaskVerdict =
  | { readonly kind: "ok" }
  /** Not performed. `lines` is whole — the caller prints it and adds nothing. */
  | { readonly kind: "refused"; readonly lines: readonly string[] };

/**
 * Every utterance the owner made over one card at or after an instant, across the calls given, in the order said.
 * An `askedIso` that does not parse cannot order anything, so every utterance over the card is listed.
 *
 * @param calls the call files written since the question was asked
 * @param askedIso when the held question was first asked
 * @param cardKey the held question's Queue card, `ask:<slug>`
 * @returns the utterances, ascending by when the owner began then by anchor, each anchor once
 */
export function heldQuestionOwnerWords({
  askedIso,
  calls,
  cardKey,
}: {
  askedIso: string;
  calls: readonly OwnerWordCall[];
  cardKey: string;
}): readonly HeldQuestionOwnerWord[] {
  const sinceMs = parseStrictIsoInstantMs({ text: askedIso });
  const byAnchor = new Map<string, HeldQuestionOwnerWord>();
  for (const call of calls) {
    if (callTouchedByTestInstance({ entries: call.entries })) {
      continue;
    }
    for (const utterance of closedCardUtterances({ callId: call.callId, ended: true, entries: call.entries })) {
      const beganMs = Date.parse(utterance.decidedIso);
      const tooEarly = sinceMs !== undefined && Number.isFinite(beganMs) && beganMs < sinceMs;
      if (utterance.cardKey !== cardKey || tooEarly || byAnchor.has(utterance.anchor)) {
        continue;
      }
      const word: HeldQuestionOwnerWord = {
        anchor: utterance.anchor,
        decidedIso: utterance.decidedIso,
        words: utterance.words,
        wordsCut: utterance.wordsCut,
      };
      byAnchor.set(utterance.anchor, utterance.openBy === undefined ? word : { ...word, openBy: utterance.openBy });
    }
  }
  return [...byAnchor.values()].toSorted((a, b) => {
    const left = Date.parse(a.decidedIso);
    const right = Date.parse(b.decidedIso);
    if (left !== right && Number.isFinite(left) && Number.isFinite(right)) {
      return left - right;
    }
    if (a.anchor === b.anchor) {
      return 0;
    }
    return a.anchor < b.anchor ? -1 : 1;
  });
}

/** One utterance as the refusal prints it. */
function wordLine({ word }: { word: HeldQuestionOwnerWord }): string {
  const marks = [word.openBy === "voice" ? "card opened by the voice" : "card opened by the owner"];
  if (word.wordsCut) {
    marks.push("the record may hold fewer words than were said");
  }
  const quoted = fitOnOneLine({ maxChars: EXCERPT_CHARS, text: word.words });
  return `  - ${word.anchor} (${word.decidedIso}; ${marks.join("; ")}): "${quoted}"`;
}

/**
 * The verdict on re-asking a held question, given the owner's words over its card and anything that could not be read.
 *
 * @param acknowledged the references the seat named in `--read-owner-words`, having read each
 * @param command the door being refused, as the owner would type it
 * @param cardKey the held question's card, named in the refusal
 * @param gaps what could not be read — each refuses until its reference is named
 * @param words the owner's utterances over the card since the question was asked
 * @returns `ok`, or the whole refusal to print
 */
export function ownerWordsBeforeReaskVerdict({
  acknowledged,
  cardKey,
  command,
  gaps,
  words,
}: {
  acknowledged: readonly string[];
  cardKey: string;
  command: string;
  gaps: readonly OwnerWordsReadGap[];
  words: readonly HeldQuestionOwnerWord[];
}): OwnerWordsBeforeReaskVerdict {
  // The row's incantation names `hand post`; `handover park` refuses through the same row, so the incantation is
  // re-derived from the verb actually refused rather than telling a parking seat to run a different verb.
  const hatch = {
    ...hatchFor({ id: "held-question-owner-words" }),
    command,
    key: { incantation: `${command} --${READ_OWNER_WORDS_FLAG} <call anchor,...>`, kind: "command" as const },
  };
  const named = new Set(acknowledged);
  const lost = gaps.filter((gap) => !named.has(gap.reference));
  if (lost.length > 0) {
    return {
      kind: "refused",
      lines: [
        hatchRefusal({
          detail: `the call records the owner may have answered ${cardKey} in could not all be read`,
          hatch,
        }),
        ...lost.map((gap) => `  - unreadable: ${gap.reference} (${gap.why})`),
        "NOTHING was done. Repair each record named, then try again — or, having read one by hand and found nothing " +
          `that answers the question, name its reference in --${READ_OWNER_WORDS_FLAG}.`,
      ],
    };
  }
  const unseen = words.filter((word) => !named.has(word.anchor));
  if (unseen.length === 0) {
    return { kind: "ok" };
  }
  return {
    kind: "refused",
    lines: [
      hatchRefusal({
        detail: `the owner has spoken ${unseen.length} time(s) over ${cardKey} since its question was asked`,
        hatch,
      }),
      ...unseen.map((word) => wordLine({ word })),
      "NOTHING was done. Read each around its segment in the call record ($SLOPWEAVER_HOME/talk/calls/<callId>.jsonl); " +
        "if one answers the question, act on it " +
        "and record the answer instead of asking again. Otherwise try again with " +
        `--${READ_OWNER_WORDS_FLAG} ${unseen.map((word) => word.anchor).join(",")}`,
    ],
  };
}
