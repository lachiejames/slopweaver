/**
 * `heldQuestionOwnerWords` and `ownerWordsBeforeReaskVerdict` — what the owner said over a held question's own card
 * since it was asked, and the refusal a seat re-asking that question meets until it names each utterance as read.
 *
 * The incident: the voice opened `ask:backup-master-password-wraps-the-backup-key` and the owner said "I have
 * saved it". The relay landed nowhere, and a seat parked on the same question the next day, then a hand note asked the
 * owner again. The first case is that shape, with the owner's segment stamped as the page now stamps it.
 */
import { describe, expect, it } from "vitest";

import {
  heldQuestionOwnerWords,
  heldQuestionReadGaps,
  type OwnerWordCall,
  type OwnerWordsBeforeReaskVerdict,
  ownerWordsBeforeReaskVerdict,
} from "../../../handover/ownerWordsBeforeReask.js";
import type { CallEntry } from "../../../talk/callRecord.js";
import { CLOSED, said } from "../talk/cardUtteranceFixture.js";

const CALL = "9b2f1c3e-4d5a-4b6c-8d7e-0f1a2b3c4d5e";
const OTHER_CALL = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const CARD = "ask:backup-master-password-wraps-the-backup-key";
const ASKED = "2026-09-25T15:30:00.000Z";
const COMMAND = "slopweaver hand post";

/** A refusal's whole text, throwing on a verdict that let the re-ask through — the `unwrap` of this verdict. */
const refusalText = ({ verdict }: { verdict: OwnerWordsBeforeReaskVerdict }): string => {
  if (verdict.kind !== "refused") {
    throw new Error("expected a refusal, got ok");
  }
  return verdict.lines.join("\n");
};

/** A segment the voice's `open_card` put the card under. */
const voiceOpened = ({ entry }: { entry: CallEntry }): CallEntry => ({ ...entry, openBy: "voice" }) as CallEntry;

const INCIDENT: OwnerWordCall = {
  callId: CALL,
  entries: [
    voiceOpened({ entry: said({ at: "50:29", id: "v-1", open: CARD, text: "Have you saved it?", who: "voice" }) }),
    voiceOpened({ entry: said({ at: "55:41", id: "s-1", open: CARD, text: "Uh, I have saved it" }) }),
    voiceOpened({ entry: said({ at: "55:45", id: "v-2", open: CARD, text: "Great.", who: "voice" }) }),
    CLOSED,
  ],
  skipped: 0,
};

describe("heldQuestionOwnerWords", () => {
  it("lists the incident's shape: words over a voice-opened held-question card, never judged an answer", () => {
    expect(heldQuestionOwnerWords({ askedIso: ASKED, calls: [INCIDENT], cardKey: CARD })).toEqual([
      {
        anchor: `call:${CALL}#s-1`,
        decidedIso: "2026-09-25T15:55:41.000Z",
        openBy: "voice",
        words: "Uh, I have saved it",
        wordsCut: false,
      },
    ]);
  });

  it("leaves out words begun before the question was asked", () => {
    const early: OwnerWordCall = {
      callId: CALL,
      entries: [said({ at: "20:00", id: "s-0", open: CARD, text: "not yet" }), CLOSED],
      skipped: 0,
    };
    expect(heldQuestionOwnerWords({ askedIso: ASKED, calls: [early], cardKey: CARD })).toEqual([]);
  });

  it("leaves out words over another card, and words over no card", () => {
    const elsewhere: OwnerWordCall = {
      callId: CALL,
      entries: [
        said({ at: "40:00", id: "s-1", open: "ask:some-other-run", text: "I have saved it" }),
        said({ at: "41:00", id: "s-2", open: undefined, text: "and the other one too" }),
        CLOSED,
      ],
      skipped: 0,
    };
    expect(heldQuestionOwnerWords({ askedIso: ASKED, calls: [elsewhere], cardKey: CARD })).toEqual([]);
  });

  it("lists a greeting said over the card: only the seat can tell it from an answer", () => {
    const greeting: OwnerWordCall = {
      callId: CALL,
      entries: [said({ at: "40:00", id: "s-1", open: CARD, text: "Good morning" }), CLOSED],
      skipped: 0,
    };
    expect(
      heldQuestionOwnerWords({ askedIso: ASKED, calls: [greeting], cardKey: CARD }).map((word) => word.words),
    ).toEqual(["Good morning"]);
  });

  it("lists the last stretch of a call that never closed, marked as possibly cut", () => {
    const live: OwnerWordCall = {
      callId: CALL,
      entries: [said({ at: "40:00", final: false, id: "s-1", open: CARD, text: "I have sa" })],
      skipped: 0,
    };
    expect(
      heldQuestionOwnerWords({ askedIso: ASKED, calls: [live], cardKey: CARD }).map((word) => [
        word.words,
        word.wordsCut,
      ]),
    ).toEqual([["I have sa", true]]);
  });

  it("orders across calls by when the owner began, and lists each anchor once", () => {
    const later: OwnerWordCall = {
      callId: OTHER_CALL,
      entries: [said({ at: "58:00", id: "s-9", open: CARD, text: "it is in the vault" }), CLOSED],
      skipped: 0,
    };
    expect(
      heldQuestionOwnerWords({ askedIso: ASKED, calls: [later, INCIDENT, INCIDENT], cardKey: CARD }).map(
        (word) => word.anchor,
      ),
    ).toEqual([`call:${CALL}#s-1`, `call:${OTHER_CALL}#s-9`]);
  });

  it("lists every utterance over the card when the question's instant does not parse", () => {
    const early: OwnerWordCall = {
      callId: CALL,
      entries: [said({ at: "20:00", id: "s-0", open: CARD, text: "not yet" }), CLOSED],
      skipped: 0,
    };
    expect(
      heldQuestionOwnerWords({ askedIso: "yesterday", calls: [early], cardKey: CARD }).map((word) => word.anchor),
    ).toEqual([`call:${CALL}#s-0`]);
  });
});

describe("heldQuestionReadGaps", () => {
  it("names a call with an unparsed line only when a line that parsed names the card", () => {
    const naming: OwnerWordCall = { ...INCIDENT, skipped: 2 };
    const unrelated: OwnerWordCall = {
      callId: OTHER_CALL,
      entries: [said({ at: "40:00", id: "s-1", open: "ask:some-other-run", text: "hello" }), CLOSED],
      skipped: 1,
    };
    expect(heldQuestionReadGaps({ calls: [naming, unrelated, INCIDENT], cardKey: CARD })).toEqual([
      { reference: CALL, why: "2 line(s) did not parse" },
    ]);
  });

  it("names no gap in a call the desktop test instance touched: its words are not the owner's", () => {
    const testOpen = {
      atIso: "2026-09-25T15:00:00.000Z",
      kind: "open",
      model: "m",
      origin: { checkoutRoot: "/w/main", defaultPort: 3000, instance: "e2e", mainWorktree: true, port: 3000 },
      sessionId: "x",
      voice: "v",
    } as CallEntry;
    const marked: OwnerWordCall = { ...INCIDENT, entries: [testOpen, ...INCIDENT.entries], skipped: 1 };
    expect(heldQuestionReadGaps({ calls: [marked], cardKey: CARD })).toEqual([]);
    expect(heldQuestionOwnerWords({ askedIso: ASKED, calls: [marked], cardKey: CARD })).toEqual([]);
  });
});

describe("ownerWordsBeforeReaskVerdict", () => {
  const words = heldQuestionOwnerWords({ askedIso: ASKED, calls: [INCIDENT], cardKey: CARD });

  it("refuses a re-ask while the owner's words over the card go unnamed, quoting them and the flag to pass", () => {
    const verdict = ownerWordsBeforeReaskVerdict({
      acknowledged: [],
      cardKey: CARD,
      command: COMMAND,
      gaps: [],
      words,
    });
    const text = refusalText({ verdict });
    expect(text).toContain(`${COMMAND} blocked because`);
    expect(text).toContain(
      `  - call:${CALL}#s-1 (2026-09-25T15:55:41.000Z; card opened by the voice): "Uh, I have saved it"`,
    );
    expect(text).toContain(`--read-owner-words call:${CALL}#s-1`);
  });

  it("names the refused verb in the escape-hatch line, so a parking seat is not told to run hand post", () => {
    const verdict = ownerWordsBeforeReaskVerdict({
      acknowledged: [],
      cardKey: CARD,
      command: "slopweaver handover park",
      gaps: [],
      words,
    });
    expect(refusalText({ verdict })).toContain(
      "To override use the designated escape hatch slopweaver handover park --read-owner-words <call anchor,...>.",
    );
  });

  it("lets the re-ask through once every anchor is named exactly", () => {
    expect(
      ownerWordsBeforeReaskVerdict({
        acknowledged: [`call:${CALL}#s-1`],
        cardKey: CARD,
        command: COMMAND,
        gaps: [],
        words,
      }),
    ).toEqual({ kind: "ok" });
  });

  it("does not take a call id alone as naming an utterance in it", () => {
    expect(
      ownerWordsBeforeReaskVerdict({ acknowledged: [CALL], cardKey: CARD, command: COMMAND, gaps: [], words }).kind,
    ).toBe("refused");
  });

  it("refuses on a call record it could not read until that reference is named", () => {
    const gaps = [{ reference: OTHER_CALL, why: "2 line(s) did not parse" }];
    const refused = ownerWordsBeforeReaskVerdict({
      acknowledged: [],
      cardKey: CARD,
      command: COMMAND,
      gaps,
      words: [],
    });
    expect(refusalText({ verdict: refused })).toContain(`  - unreadable: ${OTHER_CALL} (2 line(s) did not parse)`);
    expect(
      ownerWordsBeforeReaskVerdict({ acknowledged: [OTHER_CALL], cardKey: CARD, command: COMMAND, gaps, words: [] }),
    ).toEqual({ kind: "ok" });
  });

  it("lets a re-ask through when the owner said nothing over the card", () => {
    expect(
      ownerWordsBeforeReaskVerdict({ acknowledged: [], cardKey: CARD, command: COMMAND, gaps: [], words: [] }),
    ).toEqual({ kind: "ok" });
  });
});
