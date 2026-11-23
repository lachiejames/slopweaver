/*
 * Whether a relay's words ended before the owner did (`heardTailCut`) — what the row says, what the draft carries and
 * what its digest binds. A relay made mid-stretch may stop short of the "no, wait" that follows.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { TalkErrors } from "../../../talk/errors.js";
import { relayAskText, STILL_SPEAKING } from "../../../talk/relayAskText.js";
import { formRelayDraft } from "../../../talk/relayDraft.js";
import { type DigestBound, draftDigest } from "../../../talk/relayDraftDigest.js";
import type { RelayPicture } from "../../../talk/relayPicture.js";

const TURN = "a0000017-0000-4000-8000-000000000019";
const NO_SHARE: RelayPicture = { kind: "none", reason: "screen-not-shared" };
const FULL = { picture: NO_SHARE, readsAfter: [] as readonly string[], typed: false, wordsAlone: false };
const YES = { about: "", heard: "yes", quoteCut: undefined, readsAfter: [], words: "Yes.", wordsAlone: false };

describe("relayAskText — a relay made mid-stretch", () => {
  it("says right after the owner's words that they were still speaking, and says nothing once they had finished", () => {
    const cut = relayAskText({ ...YES, heardTailCut: true, picture: NO_SHARE });
    expect(cut).toContain(
      `spoken to the console voice (speech-to-text): "yes" — ${STILL_SPEAKING} — The voice's reading: Yes. — ` +
        "No picture: screen not shared.",
    );
    expect(relayAskText({ ...YES, heardTailCut: false, picture: NO_SHARE })).not.toContain(STILL_SPEAKING);
  });
});

describe("formRelayDraft — whether the owner was still speaking", () => {
  const SPOKEN = { ...FULL, about: "", heard: "yes send it", say: "Send it.", turnId: TURN };

  it("carries the flag as stated and binds a stated one into the digest, leaving an unstated one digesting as before", () => {
    const unstated = unwrap(formRelayDraft(SPOKEN));
    const cut = unwrap(formRelayDraft({ ...SPOKEN, heardTailCut: true }));
    const whole = unwrap(formRelayDraft({ ...SPOKEN, heardTailCut: false }));
    expect([unstated.heardTailCut, cut.heardTailCut, whole.heardTailCut]).toEqual([undefined, true, false]);
    expect(new Set([unstated.digest, cut.digest, whole.digest]).size).toBe(3);
    expect(cut.ask).toContain(STILL_SPEAKING);
    expect(whole.ask).not.toContain(STILL_SPEAKING);
  });

  it("records a typed steer as whole, and refuses one marked cut", () => {
    const typed = { ...FULL, about: "", heard: "x", say: "", turnId: TURN, typed: true };
    const notAttached: RelayPicture = { kind: "none", reason: "not-attached" };
    expect(unwrap(formRelayDraft({ ...typed, picture: notAttached })).heardTailCut).toBe(false);
    expect(unwrapErr(formRelayDraft({ ...typed, heardTailCut: true, picture: notAttached }))).toEqual(
      TalkErrors.typedInvalid({
        why: "--heard-tail cut marks a spoken relay made while a call stretch was still open; a typed steer is whole",
      }),
    );
  });
});

describe("draftDigest — the cut flag", () => {
  const BOUND: DigestBound = {
    alsoAnswers: [],
    candidateVerdict: undefined,
    discussFirst: undefined,
    heardTailCut: undefined,
    offered: undefined,
    triageRuling: undefined,
    workspace: undefined,
  };
  const digestOf = ({ heardTailCut }: { heardTailCut: boolean | undefined }): string =>
    draftDigest({ ask: "ask", bound: { ...BOUND, heardTailCut }, picture: NO_SHARE, wholeHeard: undefined });

  it("digests an unstated flag as the ask and picture alone, and a stated one as a different turn each way", () => {
    // The digest a relay made before the flag existed carried: its ask and its picture key, nothing more.
    const legacy = createHash("sha256").update("ask\npicture:none:screen-not-shared", "utf8").digest("hex");
    expect(digestOf({ heardTailCut: undefined })).toBe(legacy);
    expect(new Set([digestOf({ heardTailCut: true }), digestOf({ heardTailCut: false })]).size).toBe(2);
  });
});
