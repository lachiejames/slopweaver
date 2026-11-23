/**
 * The page's half of holding the voice to what the call said: each of the voice's FINAL
 * sentences is checked against the counts the app shows, and a wrong count posted to the held plan call's
 * `count-grounding` route (`../../lib/talkCountGrounding.ts`); a done claim or PR number nothing on the call said first
 * is posted to its `claim-grounding` route (`../../lib/talkSpokenClaims.ts`; a "draft sent" claim with nothing sent is
 * the case), as is fleet work it promised as its own (`../../lib/talkFleetPromises.ts`; a promised briefing is the
 * case) and a question asked again after the owner spoke to it that no answer since asked
 * (`../../lib/talkRepeatedAsk.ts`). All are kept as the call's provenance, so
 * the thread answering "where did that come from" can say. A done claim and a fleet promise are the ones the voice
 * hears back, with a draft said to be on the owner's running list when no offer landed that they have not moved on from
 * (`../../lib/talkRunningListClaims.ts`): the server owes each a fixed correction aloud,
 * said once the floor is clear (`../../lib/talkPlanCompletionCorrection.ts`); a count, a PR
 * number and a repeated ask are never handed back, so the voice says nothing the owner did not ask
 * about. And every Codex turn that starts is posted the completed speech the thread has not
 * had to its `spoken-record` route (`../../lib/spokenRecordQueue.ts`), with the draft of the card the owner's newest words began
 * over, so reading it back costs the turn no tool call. The folds are pure; this file
 * only feeds them, posts, and logs what they say. One watcher per call, made where the call's other handlers are, so a
 * reconnect starts clean. Its own file so `VoiceProvider.tsx` stays under the line cap.
 */
import { openCardDraftForVoice } from "../../lib/openCardDraft";
import type { PlanCallEvent } from "../../lib/planCallContract";
import type { QueueShownCounts } from "../../lib/queueShownCounts";
import { type GateEntry, OPEN_CARD_DRAFT_READ } from "../../lib/relayGate";
import type { SentSlackSendOutcome } from "../../lib/slackSendWatch";
import { foldSpokenRecord, NO_SPOKEN_RECORD, type SpokenRecordInput } from "../../lib/spokenRecordQueue";
import { countGroundingDetail, foldCountGrounding, NO_COUNT_GROUNDING } from "../../lib/talkCountGrounding";
import { foldRepeatedAsks, NO_REPEATED_ASKS, type RepeatedAskInput } from "../../lib/talkRepeatedAsk";
import {
  claimShapeOf,
  foldSpokenClaims,
  NO_SPOKEN_CLAIMS,
  type SpokenClaim,
  type SpokenClaimsInput,
  spokenGroundingDetail,
} from "../../lib/talkSpokenClaims";
import type { OpenCardDraft } from "../../lib/talkVoiceRecord";
import type { HeardStamp } from "../../lib/transcriptSinkContract";
import type { VoiceCards } from "./openCardRun";
import type { PlanPost } from "./planCallClient";
import type { HeldPlanCall } from "./planWiringHeld";
import type { Segment, ToolLine } from "./voiceContext";
import { groundingPoster, REAL_VOICE_RECORD_SEAMS, type VoiceRecordSeams } from "./voiceRecordWiringPoster";

/** How many of the thread's newest completed messages a wrong count is checked against, for its attribution. */
const WRITTEN_KEPT = 4;

/** What the provider holds of the live call's watcher: its end, the Slack sends the page read as gone, and the offers. */
export type LiveVoiceRecord = Pick<ReturnType<typeof voiceRecordWatcher>, "landed" | "offerLanded" | "end">;

/** The watcher held while no call is live, which drops what it is told. */
export const IDLE_VOICE_RECORD: LiveVoiceRecord = {
  end: () => undefined,
  landed: () => undefined,
  offerLanded: () => undefined,
};

/**
 * The watcher's two card seams on the page: a key's draft, over the cards the page holds as the owner's words are first heard,
 * and the read that draft is to the relay gate. A card the owner has open after it left the Queue is read from the cards that
 * left in the last day, as `read_card` reads one.
 *
 * @param cards reads the page's live Queue rows and the cards that recently left it, at that moment
 * @param gateLog the call's relay-gate record, which a draft reaching the model is written into as a read
 * @returns the watcher's `openCardDraft` and `recordRead`
 */
export function openCardReads({
  cards,
  gateLog,
}: {
  cards: () => Pick<VoiceCards, "recentlyLeft" | "rows">;
  gateLog: { current: GateEntry[] };
}): {
  openCardDraft: (input: { key: string | undefined }) => OpenCardDraft | undefined;
  recordRead: () => void;
} {
  return {
    openCardDraft: ({ key }) => {
      const { rows, recentlyLeft } = cards();
      // Live rows first, so a card still on the owner's Queue is read as it stands now.
      return openCardDraftForVoice({ key, rows: [...rows, ...recentlyLeft.map(({ row }) => row)] });
    },
    recordRead: () => {
      gateLog.current.push({ kind: "read", tool: OPEN_CARD_DRAFT_READ });
    },
  };
}

/**
 * One call's watcher.
 *
 * @param held the plan call the page holds now
 * @param current whether the session this watcher was made for is still the live one
 * @param shownNow the counts the app shows at this instant
 * @param heardStamp what a segment, the owner's or the voice's, was stamped with when first heard: the card it began over
 * @param openCardDraft the draft of the card a key names, or `undefined` when it is no post card on the owner's Queue
 * @param recordRead tells the relay gate the open card's draft is about to reach the model
 * @param note writes a line in the call's log, and so on its file
 * @param seams the routes and the timer
 * @returns what the call's speech and plan events feed it
 */
export function voiceRecordWatcher({
  held,
  current,
  shownNow,
  heardStamp,
  openCardDraft,
  recordRead,
  note,
  seams = REAL_VOICE_RECORD_SEAMS,
}: {
  held: () => HeldPlanCall | undefined;
  current: () => boolean;
  shownNow: () => QueueShownCounts;
  heardStamp: (input: { segmentId: string }) => HeardStamp | undefined;
  openCardDraft: (input: { key: string | undefined }) => OpenCardDraft | undefined;
  recordRead: () => void;
  note: (input: { line: ToolLine }) => void;
  seams?: VoiceRecordSeams;
}): {
  speech: (input: { speech: Segment; final: boolean }) => void;
  event: (input: { event: PlanCallEvent }) => void;
  landed: (input: { outcome: SentSlackSendOutcome }) => void;
  offerLanded: () => void;
  end: () => void;
} {
  let counts = NO_COUNT_GROUNDING;
  let claims = NO_SPOKEN_CLAIMS;
  let asks = NO_REPEATED_ASKS;
  let record = NO_SPOKEN_RECORD;
  let written: readonly string[] = [];
  // The draft of the card the owner's newest segment began over, read as that segment is first heard: a turn can start
  // before their words are final, its card is the one they began over — never the one open when the turn starts, which
  // they may have moved off since — and a reply sent in between leaves no row to read it from. Newest by first
  // hearing, so a late update to an older segment never takes the card back.
  const ownerHeard = new Set<string>();
  let ownerCard: OpenCardDraft | undefined;
  const log = ({ name, detail, refused }: { name: string; detail: string; refused: boolean }): void => {
    if (current()) {
      note({ line: { detail, ms: undefined, name, refused, usage: undefined } });
    }
  };
  const poster = groundingPoster({ after: seams.after, current, held });
  const checkCounts = ({ id, text }: { id: string; text: string }): void => {
    const step = foldCountGrounding({ id, shown: shownNow(), state: counts, text, written });
    counts = step.state;
    for (const each of step.notes) {
      log({ detail: countGroundingDetail({ note: each }), name: "count-grounding", refused: true });
    }
    for (const { claim, grounding } of step.owed) {
      poster.owe({
        owed: {
          post: ({ callId }) => seams.countGrounding({ callId, grounding }),
          settled: ({ outcome }) => {
            const detail = countGroundingDetail({ note: { ...outcome, claim } });
            log({ detail, name: "count-grounding", refused: outcome.kind !== "recorded" });
          },
        },
      });
    }
  };
  // A claim nothing grounds goes to the call's provenance, under the voice segment's key; the server alone decides
  // whether it is corrected aloud, in its own words, so nothing posted here is ever words.
  const owe = ({ claims: owed, id }: { claims: readonly SpokenClaim[]; id: string }): void => {
    for (const claim of owed) {
      log({
        detail: spokenGroundingDetail({ note: { claim, kind: "ungrounded" } }),
        name: "spoken-grounding",
        refused: true,
      });
      const grounding = { ...claimShapeOf({ claim }), key: `${id}:${String(claim.start)}` };
      poster.owe({
        owed: {
          post: ({ callId }) => seams.claimGrounding({ callId, grounding }),
          settled: ({ outcome }) => {
            const detail = spokenGroundingDetail({ note: { ...outcome, claim } });
            log({ detail, name: "spoken-grounding", refused: outcome.kind !== "recorded" });
          },
        },
      });
    }
  };
  // Only a voice segment ever owes one: the owner's words and the thread's ground claims, they never make one.
  const foldClaims = ({ input }: { input: SpokenClaimsInput }): void => {
    const step = foldSpokenClaims({ input, state: claims });
    claims = step.state;
    if (input.kind === "said") {
      owe({ claims: step.owed, id: input.id });
    }
  };
  // The same for a question asked again: only a voice sentence carries a card, so a stale card never matches.
  const foldRepeats = ({ input }: { input: RepeatedAskInput }): void => {
    const step = foldRepeatedAsks({ input, state: asks });
    asks = step.state;
    owe({ claims: step.owed, id: input.id });
  };
  const queue = ({ input }: { input: SpokenRecordInput }): void => {
    const step = foldSpokenRecord({ input, state: record });
    record = step.state;
    for (const detail of step.notes) {
      log({ detail, name: "spoken-record", refused: input.kind === "posted" && !input.taken });
    }
    const post = step.post;
    const on = held();
    if (post === undefined) {
      return;
    }
    // The step that made a post numbered it last, so its answer names that post and no other.
    const sent = { post: record.posts, turnId: post.turnId };
    if (on === undefined) {
      queue({ input: { ...sent, kind: "posted", taken: false, why: "this page holds no plan call" } });
      return;
    }
    if (post.openCard !== undefined) {
      // Recorded before the post, as a tool answer's read is: a post whose answer is lost may still reach the model.
      recordRead();
    }
    void seams.record({ callId: on.callId, record: post }).then((posted: PlanPost) => {
      if (current() && held() === on) {
        const why = posted.kind === "taken" ? undefined : posted.why;
        queue({ input: { ...sent, kind: "posted", taken: posted.kind === "taken", why } });
      }
      return undefined;
    });
  };
  return {
    // Only a send the page's watch read as gone grounds "sent", "posted" or "went up" — never said unasked, so this
    // grounds the "sent" the voice says when the owner asks. Held or failed never reach here and ground nothing.
    landed: () => {
      if (current()) {
        foldClaims({ input: { acts: ["sent", "posted", "went up"], kind: "confirmed" } });
      }
    },
    // Only an offer the list's receipt holds, on this call, grounds the voice saying it put a draft on the owner's running list.
    offerLanded: () => {
      if (current()) {
        foldClaims({ input: { kind: "offer-landed" } });
      }
    },
    // Called as the call is released, while it is still the live one, so a grounding still unkept is on its file
    // rather than its last line reading as still in flight.
    end: () => {
      poster.end();
    },
    event: ({ event }) => {
      if (!current()) {
        return;
      }
      if (event.kind === "codex-turn" && event.phase === "started") {
        queue({ input: { kind: "turn-started", openCard: ownerCard, turnId: event.turnId } });
      }
      if (event.kind === "codex-turn" && event.phase === "completed") {
        queue({ input: { kind: "turn-completed", turnId: event.turnId } });
      }
      if (event.kind === "written" && event.final) {
        written = [...written.slice(-(WRITTEN_KEPT - 1)), event.text];
        foldClaims({ input: { id: event.itemId, kind: "wrote", text: event.text } });
        foldRepeats({ input: { id: event.itemId, kind: "wrote", text: event.text } });
      }
    },
    speech: ({ speech, final }) => {
      if (!current()) {
        return;
      }
      if (speech.who === "owner" && !ownerHeard.has(speech.id)) {
        ownerHeard.add(speech.id);
        ownerCard = openCardDraft({ key: heardStamp({ segmentId: speech.id })?.open });
        foldClaims({ input: { kind: "owner-began" } });
      }
      if (!final) {
        return;
      }
      queue({ input: { kind: "final", line: { id: speech.id, text: speech.text, who: speech.who } } });
      if (speech.who !== "voice") {
        foldClaims({ input: { id: speech.id, kind: "heard", text: speech.text } });
        foldRepeats({ input: { id: speech.id, kind: "heard", text: speech.text } });
        return;
      }
      checkCounts({ id: speech.id, text: speech.text });
      foldClaims({ input: { id: speech.id, kind: "said", text: speech.text } });
      // The card the sentence began over, as its call-file line names it: a repeat over another card is a new ask.
      const card = heardStamp({ segmentId: speech.id })?.open;
      foldRepeats({ input: { card, id: speech.id, kind: "said", text: speech.text } });
    },
  };
}
