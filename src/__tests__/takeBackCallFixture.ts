/**
 * A triage call as the shipped writers leave it: relay turns claimed by `claimTurn`, and the call's lines in the shapes
 * the page writes them (`site/components/voice/relayAttempt.ts`, `triageRun.ts`). Shared by the unit test of
 * `talk/approvalRelayRead.ts` and the replay witness of a yes taken back on the next card, so both read one world.
 */
import { unwrap } from "../lib/result.js";
import type { CallEntry } from "../talk/callRecord.js";
import { formRelayDraft } from "../talk/relayDraft.js";
import { claimTurn } from "../talk/relayStore.js";
import type { TriageRuling } from "../talk/triageVocabulary.js";

/**
 * Claim one relay turn in a home, as `talk relay` does.
 *
 * @param home the throwaway home
 * @param turnId the turn, a v4 UUID
 * @param heard what the owner said on it
 * @param about the card it was about, or empty
 * @param triageRuling the owner's ruling on that card, when one was given
 * @param nowIso when it was staged
 * @param heardTailCut whether a stretch of the call was still open when the voice relayed; whole unless a test says
 */
export function claimRelayTurn({
  about,
  heard,
  heardTailCut = false,
  home,
  nowIso,
  triageRuling,
  turnId,
}: {
  about: string;
  heard: string;
  heardTailCut?: boolean;
  home: string;
  nowIso: string;
  triageRuling: TriageRuling | undefined;
  turnId: string;
}): void {
  const draft = unwrap(
    formRelayDraft({
      about,
      heard,
      heardTailCut,
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say: heard,
      triageRuling,
      turnId,
      typed: false,
      wordsAlone: false,
    }),
  );
  unwrap(claimTurn({ draft, home, nowIso }));
}

/**
 * The page's `sending` line for one relay.
 *
 * @param turnId the turn, or `null` for one the gate shut
 * @returns the call line
 */
export function relayLine({
  about,
  atIso,
  heard,
  turnId,
}: {
  about: string;
  atIso: string;
  heard: string;
  turnId: string | null;
}): CallEntry {
  return { about, atIso, detail: "running talk relay", heard, kind: "relay", outcome: "sending", say: "", turnId };
}

/**
 * A `triage_next` line, as the page writes one for a card it opened (or did not).
 *
 * @param outcome what became of the open: `opened`, `refused` or `skipped`
 * @returns the call line
 */
export function triageNextLine({ atIso, card, outcome }: { atIso: string; card: string; outcome: string }): CallEntry {
  return {
    atIso,
    detail: `triage 4/101: ${card}, card ${outcome}, page none, thread none`,
    kind: "tool",
    name: "triage_next",
    refused: false,
  };
}

/**
 * The line a call opens with.
 *
 * @returns the call line
 */
export function openLine({ atIso }: { atIso: string }): CallEntry {
  return { atIso, kind: "open", model: "gpt-realtime", sessionId: "sess_fixture", voice: "marin" };
}
