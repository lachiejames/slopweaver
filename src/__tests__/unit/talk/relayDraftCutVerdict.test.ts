/*
 * A relay's triage verdict on a voice relay whose words were not stated whole: the row the draft writes says the
 * verdict did NOT apply, rather than stating it as though it took effect. Split from relayDraft.test.ts by scenario.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { formRelayDraft } from "../../../talk/relayDraft.js";
import type { RelayPicture } from "../../../talk/relayPicture.js";

const TURN = "a0000017-0000-4000-8000-000000000019";
const NO_SHARE: RelayPicture = { kind: "none", reason: "screen-not-shared" };
const FULL = { picture: NO_SHARE, readsAfter: [] as readonly string[], typed: false, wordsAlone: false };

describe("formRelayDraft — a triage verdict on words not stated whole", () => {
  // The row stated a cut relay's verdict as though it took effect.
  it("marks the verdict NOT APPLIED on a voice relay not stated whole, cut or unstated", () => {
    const steer = { ...FULL, about: "act:ev-9", heard: "yep", say: "", turnId: TURN, wordsAlone: true };
    const triageRuling = { label: undefined, verdict: "send-it" } as const;
    const tail = " — NOT APPLIED, the words may stop short of a no: ";
    const cut = unwrap(formRelayDraft({ ...steer, heardTailCut: true, triageRuling }));
    const unstated = unwrap(formRelayDraft({ ...steer, triageRuling }));
    const whole = unwrap(formRelayDraft({ ...steer, heardTailCut: false, triageRuling }));
    expect([cut.ask.includes(tail), unstated.ask.includes(tail), whole.ask.includes(tail)]).toEqual([
      true,
      true,
      false,
    ]);
  });
});
