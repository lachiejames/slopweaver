/**
 * Whose words stand behind a landed change — the row's stored quote, the owner's ruling on it as it stood when the
 * change landed, or what the row says about where it came from instead — and every way that read stops, said rather
 * than dropped to "unasked". Pure: the row, and the two reads past it, in; one `LandedWords` out.
 *
 * Nothing drawn here as the owner's words is anything but the owner's words read off a record of theirs: a session's
 * paraphrase, a voice relay and a turn typed outside the supervisor pin's tenure each read as not shown, naming why.
 */
import type { HandoverDoc } from "../handover/doc.js";
import { type HisWords, type HisWordsCut, ownerWordsSchemeOf } from "../handover/hisWords.js";
import type { RunEvent } from "../handover/ledger.js";
import {
  latestRuling,
  type RulingEvidence,
  rulingAnchor,
  rulingBackfilledFrom,
  rulingDecisionOrder,
  rulingWords,
} from "../handover/ruling.js";
import { chairBatchMembers } from "../talk/chairBatchLine.js";
import { chairWakeCallId } from "../talk/chairWake.js";
import { unwrapPaste } from "../talk/relayLine.js";
import type { LandedOutsideChair, LandedReads, LandedRow, LandedWords } from "./landedTypes.js";

/**
 * A session turn the console typed into the chair to relay the owner — `[voice relay <row>] <owner> said: …` — read
 * once any paste wrapper is off, since one pasted whole opens with the harness's wrapper first.
 */
const VOICE_RELAY = /^\[voice relay ([^\]\s]+)\]/;

/**
 * Why words read off a record are not the owner's to quote, or `undefined` when they are.
 *
 * Two shapes reach here looking like the owner's words and are not. A quote whose anchor is not an owner-words scheme
 * names nothing of the owner's at all. A `transcript:` turn opening `[voice relay …]` is the console typing a relay
 * into the chair: the record says it was typed, so the resolver reads it, but its text is the relay's — the owner
 * spoken of in the third person, the relay's own ellipsis, and its instructions to the supervisor.
 * `../profile/ownerWords.ts` leaves the same turns out for the same reason. The owner's words sit on the relay's own
 * row. A chair wake (`../talk/chairWake.ts`) is the third: a fixed line carrying none of the owner's words, which sit
 * in its call.
 *
 * A `transcript:` turn typed into a session that did not hold the supervisor pin is not the owner's either, by the
 * rule `profile words` and `handover quote --anchor` already apply: any session can type into another. A spawn's
 * generated pickup line ("Read …, then run: slopweaver handover start …") can be stored as a row's quote. A stored
 * quote was checked against the chair when it was attached, if at all, so it is checked again here.
 *
 * @param quote the words and the anchor they were read off
 * @param outsideChair why a transcript turn at that instant was typed outside the chair, if it was
 * @returns the reason, phrased to follow "the quote …" or "the record there …"
 */
function notOwnerWordsWhy({
  quote,
  outsideChair,
}: {
  quote: HisWords;
  outsideChair: LandedOutsideChair;
}): string | undefined {
  if (ownerWordsSchemeOf({ anchor: quote.anchor }) === undefined) {
    return `is anchored at ${quote.anchor}, which is not a record of your own words`;
  }
  const relay = VOICE_RELAY.exec(unwrapPaste({ text: quote.words }));
  if (quote.where === "session" && relay !== null) {
    return `is the voice relay ${relay[1]!} typed into a session, in the relay's words rather than yours — yours are on that relay's row`;
  }
  const woken = chairWakeCallId({ text: quote.words });
  if (quote.where === "session" && woken !== undefined) {
    return `is the chair wake the console typed for call ${woken}, which carries none of your words — yours are in that call`;
  }
  if (quote.where === "session" && chairBatchMembers({ text: quote.words }) !== undefined) {
    return "is the chair's quiet batch the console typed, which carries none of your words — yours are in the calls and relays it names";
  }
  const outside = outsideChair({ anchor: quote.anchor, atIso: quote.atIso });
  if (outside !== undefined) {
    return `is not read as yours: ${outside}`;
  }
  return undefined;
}

/**
 * What a row with no stored quote and no ruling of the owner's says about where it came from.
 *
 * Only a fleet finding is unasked: it declares that a session, not the owner, raised it. A row with no anchor that is
 * not one proves nothing either way — an ask registered off a relay of the owner's and never anchored is still the
 * owner's ask (a row of `kind: ask` registered under a talk run, with the owner's call quoted in its body) — so
 * it reads unread, naming what is missing, rather than unasked.
 */
function unquotedRowWords({ doc }: { doc: HandoverDoc }): LandedWords {
  if (ownerWordsSchemeOf({ anchor: doc.anchor }) !== undefined) {
    return { kind: "unread", why: `the row names your words at ${doc.anchor!} and stores no quote of them` };
  }
  if (doc.origin === "finding") {
    let by = "a fleet session";
    if (doc.observedBy !== undefined) {
      by = `session ${doc.observedBy}`;
    }
    return { kind: "unasked", why: `a fleet finding observed by ${by}` };
  }
  if (doc.anchor !== undefined) {
    return { anchor: doc.anchor, kind: "elsewhere" };
  }
  let registered = "";
  if (doc.registeredBy !== undefined) {
    registered = ` (registered by session ${doc.registeredBy})`;
  }
  return {
    kind: "unread",
    why: `this ${doc.kind} row${registered} is not a fleet finding and records no anchor, so any words of yours behind it cannot be shown`,
  };
}

/** Why a ruling's words cannot be quoted as the owner's before its anchor is even read, or `undefined` when they may be. */
function rulingUnquotableWhy({ ruling, anchor }: { ruling: RulingEvidence; anchor: string }): string | undefined {
  if (rulingBackfilledFrom({ evidence: ruling }) !== undefined) {
    return `your ruling on this row (${anchor}) was reconstructed from an answer by the backfill, so its words are not quoted as yours`;
  }
  if (ownerWordsSchemeOf({ anchor }) === undefined) {
    return `you ruled on this row at ${anchor}, which is not a record of your own words, so the ruling is not quoted`;
  }
  return undefined;
}

/**
 * The owner's ruling on a row as it stood when the change landed — or why a ruling of theirs cannot be shown as their
 * words.
 *
 * A ruling is shown only when all four hold: it was decided at or before the merge (one given after is about the
 * change, never behind it), it was recorded as the owner gave it rather than reconstructed from an answer by the
 * backfill, its anchor is a record of the owner's own words, and those words read. Each one that fails is said rather
 * than skipped, because skipping it would drop the row to "unasked" for a change the owner ruled on.
 *
 * **The quote is read off the anchor, never the ruling's text.** A ruling's text is what the owner said as the session
 * that heard it wrote it down (`../handover/ledger.ts`'s `ruling` event) — a session's paraphrase, attributable and
 * never verbatim: a row's recorded summary can read nothing like the call stretch it was taken from. So the words come
 * from the record, as a stored quote's do, and the session's text travels beside them as `recorded`.
 *
 * **A ruling with no decision instant is placed by its record's.** The front-matter pair carries none, and a journal
 * line whose instants will not parse sorts first; neither is evidence it came before the merge. Every record's own
 * instant is at or after the owner spoke — a relay is staged after the words, a call stretch re-recorded after them —
 * so one at or before the merge proves the ruling was too, and one after says so.
 *
 * @param doc the row's front-matter
 * @param events its journal's events
 * @param mergedIso when the change landed
 * @param reads the owner's words at the ruling's anchor, and whether they were typed outside the chair
 * @returns the owner's ruling, why it is not shown, or `undefined` when nothing of theirs had ruled on the row by then
 */
function rulingAtMerge({
  doc,
  events,
  mergedIso,
  reads,
}: {
  doc: HandoverDoc;
  events: readonly RunEvent[];
  mergedIso: string;
  reads: LandedReads;
}): LandedWords | undefined {
  const merged = Date.parse(mergedIso);
  const before = events.filter((event) => event.kind !== "ruling" || rulingDecisionOrder({ event }) <= merged);
  const ruling = latestRuling({ doc, events: before });
  if (ruling === undefined) {
    return undefined;
  }
  const anchor = rulingAnchor({ evidence: ruling });
  const unquotable = rulingUnquotableWhy({ anchor, ruling });
  if (unquotable !== undefined) {
    return { kind: "unread", why: unquotable };
  }
  const heard = reads.wordsAt({ anchor });
  if (heard.isOk()) {
    const notOwners = notOwnerWordsWhy({ outsideChair: reads.outsideChair, quote: heard.value });
    if (notOwners !== undefined) {
      return { kind: "unread", why: `you ruled on this row at ${anchor}, but the record there ${notOwners}` };
    }
  }
  if (heard.isErr()) {
    return {
      kind: "unread",
      why: `you ruled on this row at ${anchor}, and your words there would not read: ${heard.error.message}`,
    };
  }
  let decidedIso: string | undefined;
  if (ruling.from === "register" && Number.isFinite(rulingDecisionOrder({ event: ruling.event }))) {
    decidedIso = ruling.decidedIso;
  }
  if (decidedIso === undefined && !(Date.parse(heard.value.atIso) <= merged)) {
    return {
      kind: "unread",
      why: `your ruling on this row (${anchor}) carries no instant it was decided, and its record dates from ${heard.value.atIso}, after the change landed, so it cannot be placed before it`,
    };
  }
  const quote = heard.value;
  return {
    anchor,
    atIso: quote.atIso,
    cut: quote.cut,
    decidedIso,
    kind: "ruling",
    recorded: rulingWords({ evidence: ruling }),
    where: quote.where,
    words: quote.words,
  };
}

/**
 * The owner's words behind a row: the quote it stores of the ask, else their ruling on it as it stood when the change
 * landed,
 * else what the row says about where it came from instead.
 *
 * @param row the row as the reader found it
 * @param branch the branch the row was looked up by, for the miss
 * @param mergedIso when the change landed, which bounds the ruling read
 * @param reads the owner's words at a ruling's anchor, and whether a transcript turn was typed outside the chair
 * @returns the words, or why there are none
 */
export function landedWordsOf({
  row,
  branch,
  mergedIso,
  reads,
}: {
  row: LandedRow;
  branch: string;
  mergedIso: string;
  reads: LandedReads;
}): LandedWords {
  if (row.kind === "absent") {
    return { kind: "not-joined", why: `no board row is named ${branch}, live or archived` };
  }
  if (row.kind === "not-a-slug") {
    return { kind: "not-joined", why: `the branch ${branch} is not a shape a board row's slug can take` };
  }
  if (row.kind === "unreadable") {
    return { kind: "unread", why: `the row ${branch} would not read: ${row.why}` };
  }
  const said = row.doc.hisWords;
  if (said.kind === "held") {
    const quote = said.hisWords;
    const notOwners = notOwnerWordsWhy({ outsideChair: reads.outsideChair, quote });
    if (notOwners !== undefined) {
      return { kind: "unread", why: `the quote stored on the row ${notOwners}` };
    }
    return {
      anchor: quote.anchor,
      atIso: quote.atIso,
      cut: quote.cut,
      kind: "asked",
      where: quote.where,
      words: quote.words,
    };
  }
  if (said.kind === "unread" || said.kind === "defect") {
    return { kind: "unread", why: `the quote stored on the row does not read: ${said.why}` };
  }
  if (row.undecoded > 0) {
    return {
      kind: "unread",
      why: `${String(row.undecoded)} line(s) of the row's run journal do not decode in this checkout, and a ruling of yours may be among them`,
    };
  }
  const ruling = rulingAtMerge({ doc: row.doc, events: row.events, mergedIso, reads });
  if (ruling !== undefined) {
    return ruling;
  }
  return unquotedRowWords({ doc: row.doc });
}

/**
 * A quote in quotation marks, with an ellipsis OUTSIDE the words where the record is known to be short — the stored
 * words never carry a marker (`../handover/hisWords.ts`), so the reader draws it, as the console's card does.
 */
function quoted({ words, cut }: { words: string; cut: HisWordsCut }): string {
  if (cut === "start") {
    return `…"${words}"`;
  }
  if (cut === "end") {
    return `"${words}"…`;
  }
  return `"${words}"`;
}

/**
 * The owner's words, or their absence, as one line of text.
 *
 * @param words how the join ended
 * @returns the line
 */
export function landedWordsLine({ words }: { words: LandedWords }): string {
  switch (words.kind) {
    case "asked": {
      return `you said: ${quoted({ cut: words.cut, words: words.words })}`;
    }
    case "ruling": {
      return `your ruling (${words.anchor}): you said ${quoted({ cut: words.cut, words: words.words })} — recorded by the session as: ${words.recorded}`;
    }
    case "elsewhere": {
      return `came from ${words.anchor}`;
    }
    case "unread":
    case "unasked":
    case "not-joined": {
      return `${words.kind}: ${words.why}`;
    }
    default: {
      const exhausted: never = words;
      return exhausted;
    }
  }
}
