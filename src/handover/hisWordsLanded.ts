/**
 * The `call:<callId>#<segment>` scheme of `./hisWordsResolve.ts` — the owner's words as a card landing carries them
 * (`../talk/cardLanding.ts`): the ledger row whose anchor, or one of whose later anchors, is this one. The latest
 * such row wins, as the queue reads it.
 *
 * Its own module because it is the one scheme that reads two records: the landing for the words, and the call file
 * for whether they are now cut (`../talk/landingCut.ts`), which a restored card's ledger cannot say.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type CallLinesRead, cutUnknownWhy } from "../talk/callLines.js";
import { readCallEntriesCounted } from "../talk/callStore.js";
import { type CardLandedRow, landedAnchors } from "../talk/cardLanding.js";
import { readCardLandings } from "../talk/cardLandingStore.js";
import {
  callCarriesLandedWords,
  callEndsLandedWords,
  callHoldsLandedAnchors,
  callPlacesLanding,
  callShowsLandingCut,
} from "../talk/landingCut.js";
import { type HisWordsError, HisWordsErrors } from "./hisWordsErrors.js";
import type { RawWords } from "./hisWordsResolve.js";

/**
 * A call SEGMENT anchor — the only `call:` shape whose landed words `talk land` checks against the call file
 * (`../cli/commands/talk/cardsRun.ts`'s `CALL_ANCHOR`). Any other `call:` anchor a session passes lands the session's
 * own words, so it names none of the owner's.
 */
export const CALL_SEGMENT_ANCHOR = /^call:[^#]+#/u;

/**
 * The latest ledger row carrying this utterance. An unreadable ledger line might be a later one, so it refuses.
 *
 * @returns the row, or why the ledger cannot say which row it is
 */
function latestLanding({ home, anchor }: { home: string; anchor: string }): Result<CardLandedRow, HisWordsError> {
  const ledger = readCardLandings({ home });
  if (ledger.isErr()) {
    return err(HisWordsErrors.recordUnreadable({ anchor, why: ledger.error.message }));
  }
  if (ledger.value.unreadable.length > 0) {
    const lines = ledger.value.unreadable.join(", ");
    return err(HisWordsErrors.recordUnreadable({ anchor, why: `card-landing lines ${lines} do not parse` }));
  }
  const landed = ledger.value.rows.filter(
    (row): row is CardLandedRow => row.kind === "landed" && landedAnchors({ row }).includes(anchor),
  );
  const latest = landed.at(-1);
  if (latest === undefined) {
    return err(HisWordsErrors.recordMissing({ anchor, what: "no card landing carries this utterance" }));
  }
  return ok(latest);
}

/**
 * The call file's lines, read for whether a landing's words are now cut — refused wherever that cannot be known.
 *
 * @param anchors every anchor the landing row carries, which the call must still hold
 * @returns the call's lines, or why they cannot say whether the landing's words were cut
 */
function landingCallEntries({
  anchor,
  anchors,
  callId,
  home,
}: {
  anchor: string;
  anchors: readonly string[];
  callId: string;
  home: string;
}): Result<CallLinesRead["entries"], HisWordsError> {
  const call = readCallEntriesCounted({ callId, home });
  if (call.isErr()) {
    return err(HisWordsErrors.recordUnreadable({ anchor, why: call.error.message }));
  }
  // A landing names a call that was recorded, so an absent file is lost or quarantined evidence, never a clean call:
  // a later cut it held is gone with it.
  if (!call.value.present) {
    const why = "the call file is not there, so whether its words were later cut is unknown";
    return err(HisWordsErrors.recordUnreadable({ anchor, why }));
  }
  const unknownCut = cutUnknownWhy({ read: call.value });
  if (unknownCut !== undefined) {
    return err(HisWordsErrors.recordUnreadable({ anchor, why: unknownCut }));
  }
  if (!callHoldsLandedAnchors({ anchors, callId, entries: call.value.entries })) {
    const why =
      "the call file no longer holds the stretch this landing names, so whether its words were cut is unknown";
    return err(HisWordsErrors.recordUnreadable({ anchor, why }));
  }
  return ok(call.value.entries);
}

/**
 * The latest landing carrying this utterance, read against the call file it was said on.
 *
 * @param home the Slopweaver home the ledger and call files live under
 * @param anchor a `call:<callId>#<segment>` anchor
 * @returns the landing's words, cut when either the landing or the call file now says so, or why they cannot be read
 */
export function landedWords({ home, anchor }: { home: string; anchor: string }): Result<RawWords, HisWordsError> {
  if (!CALL_SEGMENT_ANCHOR.test(anchor)) {
    return err(HisWordsErrors.anchorMalformed({ anchor }));
  }
  const found = latestLanding({ anchor, home });
  if (found.isErr()) {
    return err(found.error);
  }
  const latest = found.value;
  // A call that closed or dropped lands a stretch it never finished, and caps a long one, so the landing says whether
  // its words were cut; one written before it said is never read as whole. A restored card takes no later cut row,
  // so the call file is asked too, and a torn line there might be the cut stretch.
  const callId = anchor.slice("call:".length, anchor.indexOf("#"));
  const anchors = landedAnchors({ row: latest });
  const read = landingCallEntries({ anchor, anchors, callId, home });
  if (read.isErr()) {
    return err(read.error);
  }
  const entries = read.value;
  const callCut = callShowsLandingCut({ anchors, callId, entries });
  // The words are whole only while the call carries exactly them, finished, whatever the row recorded: a final snapshot
  // that arrived after a cut landing proves its words whole, and a whole row the owner's later finished
  // speech has since joined holds less than the utterance now says — the card restored, no row records it.
  const carriedHere = callCarriesLandedWords({ anchors, callId, entries, words: latest.words });
  // A cut the row recorded is lifted only by an utterance the call file itself ended: read as ending here, a last run
  // still open — the owner perhaps still saying it — would lift it. A WHOLE row is not asked the same:
  // its landing was cut at a boundary the append-only file still holds, and the fold holds back an utterance whose
  // relay is still `sending`, which is exactly when the chair approves off a relay's landing. Residue, stated: a call file rewritten to drop
  // that boundary while keeping the anchor and the words reads a whole row whole.
  const carried =
    carriedHere && (latest.wordsCut !== true || callEndsLandedWords({ anchors, callId, entries, words: latest.words }));
  // A transcript landing took its card off the call, so words the call still carries whole but now places elsewhere
  // answer no card it can name; a relay's or a session's landing chose its card itself, and words not
  // carried whole already read as cut below.
  const placed = callPlacesLanding({ anchors, callId, cardKey: latest.cardKey, entries });
  if (latest.source === "transcript" && carried && !placed) {
    const why = `the call no longer places these words on ${latest.cardKey}, opened by the owner, where they landed`;
    return err(HisWordsErrors.recordUnreadable({ anchor, why }));
  }
  // The words are the LANDING's, not the call file's, so the card must not say the call transcript captured them;
  // only a `talk-call:` segment is read off the call itself.
  return ok({
    atIso: latest.decidedIso,
    context: {
      cardKey: latest.cardKey,
      draftIds: latest.draftIds,
      draftIdsUnread: latest.draftIdsUnread,
      kind: "card-landing",
    },
    headKnown: true,
    headLost: false,
    tailKnown: latest.wordsCut !== undefined,
    tailLost: callCut || !carried,
    text: latest.words,
    where: "call-landing",
  });
}
