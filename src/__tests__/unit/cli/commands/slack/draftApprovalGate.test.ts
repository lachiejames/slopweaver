/**
 * `draftApprovalGate.ts` direct: a yes binds a draft only when the record holding the owner's words does not
 * contradict it — a relay's triage verdict is `send-it`, and the card the words were said over is this draft's, or a
 * cut it re-cuts. The two incident shapes of C0SYN000001 lead.
 */
import { describe, expect, it } from "vitest";

import { DraftApprovalAnchorErrors } from "../../../../../cli/commands/slack/draftApprovalErrors.js";
import {
  draftApprovalAnchorError,
  draftApprovalBindingIds,
  draftApprovalCardIds,
  draftApprovalLaterRelayError,
  draftApprovalRefusalLines,
} from "../../../../../cli/commands/slack/draftApprovalGate.js";
import type { RawWordsContext } from "../../../../../handover/hisWordsResolve.js";
import { JUDGEMENT_NOTE } from "../../../../../hatch/render.js";
import type { ApprovalLaterRelay } from "../../../../../talk/approvalRelayRead.js";
import { draftItem, KNOCK } from "../../../supervisor/draftItemFixture.js";

const CLAIMED = "--anchor talk:a0000025-0000-4000-8000-000000000028";
const TARGET = "sd-ffab16e8";
const ONLY_TARGET: ReadonlySet<string> = new Set([TARGET]);

/** The gate over one context, for the target alone, on words that are a plain yes unless a case says otherwise. */
function gate({ context, heard = "Yep, send it." }: { context: RawWordsContext; heard?: string }) {
  return draftApprovalAnchorError({ allowedDraftIds: ONLY_TARGET, claimed: CLAIMED, context, heard });
}

/**
 * The keep-export row: a remark the owner made with the draft's own card open, which bound as their yes. The
 * row kept the shape and not the words, so this is a remark of that shape — a question about the card, no yes in it.
 */
const REMARK_WITH_THE_CARD_OPEN = "Hm, who's Tobias again? Is that the one from the payments thread?";

describe("draftApprovalAnchorError — the remark said while the card was open (keep export)", () => {
  it("refuses an unruled relay over this draft's own card whose words carry no yes", () => {
    const refused = gate({
      context: { about: `post:${TARGET}`, kind: "relay", triageRuling: null },
      heard: REMARK_WITH_THE_CARD_OPEN,
    });

    expect(refused).toEqual(
      DraftApprovalAnchorErrors.noAffirmative({
        claimed: CLAIMED,
        heard: REMARK_WITH_THE_CARD_OPEN,
        why: "the words carry no yes",
      }),
    );
    expect(refused!.message).toBe(
      `${CLAIMED}: the owner said "${REMARK_WITH_THE_CARD_OPEN}" with the card open, and the words carry no yes, so an open ` +
        "card is all that ties it to a yes — nothing was recorded. Hold it not-owner-yes, or record the yes they give on " +
        "its card",
    );
  });

  it("refuses a card landing on this draft's own post card whose words carry no yes", () => {
    const refused = gate({
      context: { cardKey: `post:${TARGET}`, draftIds: undefined, draftIdsUnread: undefined, kind: "card-landing" },
      heard: REMARK_WITH_THE_CARD_OPEN,
    });

    expect(refused!.code).toBe("DRAFT_APPROVAL_NO_AFFIRMATIVE");
  });

  it("refuses a yes beside a take-back, naming the take-back", () => {
    const refused = gate({
      context: { about: `post:${TARGET}`, kind: "relay", triageRuling: null },
      heard: "Yes — actually, hold that one",
    });

    expect(refused!.message).toContain("the words carry a yes beside a take-back");
  });

  it("passes an unruled relay or a landing over this draft's card whose words carry a yes and no take-back", () => {
    expect([
      gate({ context: { about: `post:${TARGET}`, kind: "relay", triageRuling: null }, heard: "Yeah, that looks good" }),
      gate({
        context: { cardKey: `post:${TARGET}`, draftIds: undefined, draftIdsUnread: undefined, kind: "card-landing" },
        heard: "Ship it.",
      }),
    ]).toEqual([undefined, undefined]);
  });

  it("does not word-read a send-it ruling, which is the affirmative act itself", () => {
    expect(
      gate({
        context: { about: `post:${TARGET}`, kind: "relay", triageRuling: { label: undefined, verdict: "send-it" } },
        heard: "Mm.",
      }),
    ).toBe(undefined);
  });

  it("refuses the remark before the card, so a remark over another card says it was no yes", () => {
    const refused = gate({
      context: { about: "post:sd-4c489c6e", kind: "relay", triageRuling: null },
      heard: REMARK_WITH_THE_CARD_OPEN,
    });

    expect(refused!.code).toBe("DRAFT_APPROVAL_NO_AFFIRMATIVE");
  });
});

describe("draftApprovalAnchorError — the incident shapes", () => {
  it("refuses sd-ffab16e8's yes: the relay over its own card ruled needs-more-info, and the refusal names it", () => {
    const refused = gate({
      context: {
        about: `post:${TARGET}`,
        kind: "relay",
        triageRuling: { label: undefined, verdict: "needs-more-info" },
      },
    });

    expect(refused).toEqual(DraftApprovalAnchorErrors.verdict({ claimed: CLAIMED, verdict: "needs-more-info" }));
    expect(refused!.message).toBe(
      `${CLAIMED}: the relay recorded the owner's triage verdict as needs-more-info, not send-it — nothing was recorded. ` +
        "Hold it not-owner-yes, or record the yes they give on its card",
    );
  });

  it("refuses sd-e58a0f4f's yes: the relay was about no card", () => {
    const refused = draftApprovalAnchorError({
      allowedDraftIds: new Set(["sd-e58a0f4f"]),
      claimed: CLAIMED,
      context: { about: "", kind: "relay", triageRuling: null },
      heard: "just send it",
    });

    expect(refused).toEqual(
      DraftApprovalAnchorErrors.cardMismatch({
        about: "",
        claimed: CLAIMED,
        expectedDraftIds: ["sd-e58a0f4f"],
        why: "the relay was about no card",
      }),
    );
    expect(refused!.code).toBe("DRAFT_APPROVAL_CARD_MISMATCH");
  });
});

describe("draftApprovalAnchorError — relays", () => {
  it("passes send-it over this draft's card", () => {
    expect(
      gate({
        context: { about: `post:${TARGET}`, kind: "relay", triageRuling: { label: "action-now", verdict: "send-it" } },
      }),
    ).toBe(undefined);
  });

  it("passes a relay that said it carried no ruling, over this draft's card, when the owner's words carry a yes", () => {
    expect(gate({ context: { about: `post:${TARGET}`, kind: "relay", triageRuling: null } })).toBe(undefined);
  });

  it("refuses a relay that predates storing a ruling, which may have ruled otherwise in prose", () => {
    const refused = gate({ context: { about: `post:${TARGET}`, kind: "relay", triageRuling: undefined } });

    expect(refused).toEqual(DraftApprovalAnchorErrors.verdict({ claimed: CLAIMED, verdict: undefined }));
    expect(refused!.message).toContain("the relay predates storing the owner's triage verdict");
  });

  it("names the verdict before the card, so a ruled relay over the wrong card says what the owner ruled", () => {
    const refused = gate({
      context: { about: "post:sd-4c489c6e", kind: "relay", triageRuling: { label: undefined, verdict: "rewrite" } },
    });

    expect(refused!.code).toBe("DRAFT_APPROVAL_VERDICT");
    expect(refused!.message).toContain("as rewrite, not send-it");
  });

  it("refuses send-it said over another draft's card, naming that card", () => {
    const refused = gate({
      context: { about: "post:sd-4c489c6e", kind: "relay", triageRuling: { label: undefined, verdict: "send-it" } },
    });

    expect(refused!.message).toBe(
      `${CLAIMED}: the relay was about post:sd-4c489c6e, so it is not the owner's yes to this draft (a yes here binds ` +
        `post:${TARGET}) — nothing was recorded. Put the card in front of the owner and record the yes they give on it`,
    );
  });
});

describe("draftApprovalAnchorError — landings, call stretches and typed turns", () => {
  it("judges neither a call stretch nor a typed turn, where the owner agrees content before any card exists", () => {
    expect([
      gate({ context: { kind: "call-segment", open: undefined } }),
      gate({ context: { kind: "call-segment", open: "post:sd-4c489c6e" } }),
      gate({ context: { kind: "transcript" } }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("passes a landing on this draft's post card, or on an ask card that named it as the owner spoke", () => {
    const post = { cardKey: `post:${TARGET}`, draftIds: undefined, draftIdsUnread: undefined } as const;
    const ask = { cardKey: "ask:acme-post", draftIds: ["sd-0000aaaa", TARGET], draftIdsUnread: undefined } as const;

    expect(gate({ context: { ...post, kind: "card-landing" } })).toBe(undefined);
    expect(gate({ context: { ...ask, kind: "card-landing" } })).toBe(undefined);
  });

  it("refuses a landing on an ask card that named other drafts, one whose drafts did not read, and one too old to say", () => {
    const base = { cardKey: "hand:step-1", kind: "card-landing" } as const;

    expect(gate({ context: { ...base, draftIds: ["sd-0000aaaa"], draftIdsUnread: undefined } })!.message).toContain(
      "the landing was on hand:step-1, which named sd-0000aaaa as the owner spoke",
    );
    expect(gate({ context: { ...base, draftIds: undefined, draftIdsUnread: "doc gone" } })!.message).toContain(
      "whose drafts would not read as the owner spoke (doc gone)",
    );
    expect(gate({ context: { ...base, draftIds: undefined, draftIdsUnread: undefined } })!.message).toContain(
      "predates keeping the drafts its card named",
    );
  });

  it("refuses a landing on a card kind that names no draft", () => {
    const context = {
      cardKey: "pr:2260",
      draftIds: undefined,
      draftIdsUnread: undefined,
      kind: "card-landing",
    } as const;

    expect(gate({ context })!.message).toContain("the landing was on pr:2260");
  });
});

describe("draftApprovalCardIds", () => {
  it("names the draft a post card or a relay's post card carries, and the drafts an ask card's landing kept", () => {
    expect([
      draftApprovalCardIds({ context: { about: `post:${TARGET}`, kind: "relay", triageRuling: null } }),
      draftApprovalCardIds({
        context: { cardKey: `post:${TARGET}`, draftIds: undefined, draftIdsUnread: undefined, kind: "card-landing" },
      }),
      draftApprovalCardIds({
        context: { cardKey: "ask:acme", draftIds: ["sd-0000aaaa"], draftIdsUnread: undefined, kind: "card-landing" },
      }),
    ]).toEqual([[TARGET], [TARGET], ["sd-0000aaaa"]]);
  });

  it("names none for a card-less relay, an unread ask card, a call stretch or a typed turn", () => {
    expect([
      draftApprovalCardIds({ context: { about: "", kind: "relay", triageRuling: null } }),
      draftApprovalCardIds({
        context: { cardKey: "ask:acme", draftIds: ["sd-0000aaaa"], draftIdsUnread: "gone", kind: "card-landing" },
      }),
      draftApprovalCardIds({ context: { kind: "call-segment", open: `post:${TARGET}` } }),
      draftApprovalCardIds({ context: { kind: "transcript" } }),
    ]).toEqual([[], [], [], []]);
  });
});

describe("draftApprovalBindingIds", () => {
  const TS = "2026-10-14T00:00:00.000Z";

  it("follows recorded re-cuts and inherited approvals, never equal words", () => {
    const root = draftItem({ id: "sd-00000001", tsIso: TS });
    const middle = { ...draftItem({ id: "sd-00000002", tsIso: TS }) };
    const recut = { ...middle, draft: { ...middle.draft, recuts: ["sd-00000001"] } };
    const leafBase = draftItem({ id: "sd-00000003", tsIso: TS });
    const leaf = {
      ...leafBase,
      draft: { ...leafBase.draft, approval: { ...KNOCK, inheritedFrom: "sd-00000002" } },
    };
    const twin = draftItem({ id: "sd-00000009", tsIso: TS });

    expect([...draftApprovalBindingIds({ items: [root, recut, leaf, twin], targetIds: ["sd-00000003"] })]).toEqual([
      "sd-00000003",
      "sd-00000002",
      "sd-00000001",
    ]);
  });

  it("is empty with no target, so a fresh record --approved re-cutting nothing binds nothing", () => {
    expect(draftApprovalBindingIds({ items: [draftItem({ id: "sd-00000001", tsIso: TS })], targetIds: [] }).size).toBe(
      0,
    );
  });

  it("stops on a cycle", () => {
    const a = draftItem({ id: "sd-0000000a", tsIso: TS });
    const b = draftItem({ id: "sd-0000000b", tsIso: TS });
    const items = [
      { ...a, draft: { ...a.draft, recuts: ["sd-0000000b"] } },
      { ...b, draft: { ...b.draft, recuts: ["sd-0000000a"] } },
    ];

    expect([...draftApprovalBindingIds({ items, targetIds: ["sd-0000000a"] })]).toEqual(["sd-0000000a", "sd-0000000b"]);
  });
});

describe("draftApprovalLaterRelayError — a take-back after the voice moved on", () => {
  const NEXT = "post:sd-4ce1d056";
  const LATER = "a1b2c3d4-0000-4000-8000-000000000002";
  /** One later relay, on the next card with no ruling unless overridden; its call line says what its turn file does. */
  const relay = ({
    heard = "oh wait, no, not that one",
    ...over
  }: Partial<ApprovalLaterRelay> = {}): ApprovalLaterRelay => ({
    about: NEXT,
    callHeard: heard,
    cardDistance: 1,
    heard,
    triageRuling: null,
    turnId: LATER,
    wordsWhole: true,
    ...over,
  });
  const later = ({ laterRelays }: { laterRelays: readonly ApprovalLaterRelay[] }) =>
    draftApprovalLaterRelayError({ anchorCard: `post:${TARGET}`, claimed: CLAIMED, laterRelays });

  it("refuses a yes taken back on the next card, naming the later turn, its words and its card", () => {
    const refused = later({ laterRelays: [relay()] });

    expect(refused).toEqual(
      DraftApprovalAnchorErrors.laterRelay({
        about: NEXT,
        cardDistance: 1,
        claimed: CLAIMED,
        heard: "oh wait, no, not that one",
        laterAnchor: `talk:${LATER}`,
        verdict: null,
      }),
    );
    expect(refused!.message).toBe(
      `${CLAIMED}: talk:${LATER}, relayed one card later on the same call, said "oh wait, no, not that one" over ` +
        `${NEXT} — a take-back or another verdict that names no card of its own, so it may take this yes back — ` +
        "nothing was recorded. Ask the owner which card they meant and record the ruling they give on it",
    );
  });

  it("refuses 'disregard that' on the next card, a counterexample a review found", () => {
    expect(later({ laterRelays: [relay({ heard: "disregard that" })] })).toEqual(
      DraftApprovalAnchorErrors.laterRelay({
        about: NEXT,
        cardDistance: 1,
        claimed: CLAIMED,
        heard: "disregard that",
        laterAnchor: `talk:${LATER}`,
        verdict: null,
      }),
    );
  });

  it("refuses one two cards later, and says so", () => {
    expect(later({ laterRelays: [relay({ cardDistance: 2 })] })!.message).toContain("relayed two cards later");
  });

  it("refuses another verdict on the yes's own card, with no take-back words", () => {
    const refused = later({
      laterRelays: [
        relay({
          about: `post:${TARGET}`,
          cardDistance: 0,
          heard: "park it",
          triageRuling: { label: undefined, verdict: "park-slow-triage" },
        }),
      ],
    });

    expect(refused!.verdict).toBe("park-slow-triage");
    expect(refused!.message).toContain(`said "park it" over post:${TARGET}, ruled park-slow-triage`);
  });

  it("refuses another verdict about no card", () => {
    const refused = later({
      laterRelays: [
        relay({ about: "", heard: "needs more info", triageRuling: { label: undefined, verdict: "needs-more-info" } }),
      ],
    });

    expect(refused!.message).toContain('said "needs more info" over no card, ruled needs-more-info');
  });

  it("refuses another verdict about something that is not a card key", () => {
    const refused = later({
      laterRelays: [
        relay({
          about: "not-a-card",
          heard: "park it",
          triageRuling: { label: undefined, verdict: "park-slow-triage" },
        }),
      ],
    });

    expect(refused!.verdict).toBe("park-slow-triage");
  });

  // A take-back's vocabulary is open, so over no card or the yes's own one an unruled relay refuses whatever its words.
  it.each([
    ["no card", ""],
    ["the yes's own card", `post:${TARGET}`],
  ])("refuses an unruled relay over %s, in words on no list", (_label, about) => {
    const refused = later({ laterRelays: [relay({ about, cardDistance: 0, heard: "on reflection, leave that one" })] });

    expect(refused!.laterAnchor).toBe(`talk:${LATER}`);
    expect(refused!.verdict).toBe(null);
  });

  it("passes the next card ruled on its own, even in take-back words: an ordinary rapid pass", () => {
    const ruled = relay({
      heard: "actually no, needs more info",
      triageRuling: { label: undefined, verdict: "needs-more-info" },
    });

    expect(later({ laterRelays: [ruled] })).toBe(undefined);
  });

  it("passes the next card sent, an aside on it, and the yes said again on its own card", () => {
    expect(
      later({
        laterRelays: [
          relay({ heard: "yes", triageRuling: { label: undefined, verdict: "send-it" } }),
          relay({ heard: "who wrote this one?", turnId: "a1b2c3d4-0000-4000-8000-000000000003" }),
          relay({
            about: `post:${TARGET}`,
            cardDistance: 0,
            heard: "no wait, scratch that, send it",
            triageRuling: { label: undefined, verdict: "send-it" },
          }),
        ],
      }),
    ).toBe(undefined);
  });

  // A review of the held-writes change found that a send-it stored off words cut short stood the yes past a "no, wait".
  it("reads a ruling on words not stated whole as none, so a cut send-it or a cut ruling on the next card refuses", () => {
    const sameCard = relay({
      about: `post:${TARGET}`,
      cardDistance: 0,
      heard: "no, wait",
      triageRuling: { label: undefined, verdict: "send-it" },
      wordsWhole: false,
    });
    const nextCard = relay({ triageRuling: { label: undefined, verdict: "needs-more-info" }, wordsWhole: false });
    expect([
      later({ laterRelays: [sameCard] })!.laterAnchor,
      later({ laterRelays: [{ ...sameCard, wordsWhole: true }] }),
      later({ laterRelays: [nextCard] })!.laterAnchor,
      later({ laterRelays: [{ ...nextCard, wordsWhole: true }] }),
    ]).toEqual([`talk:${LATER}`, undefined, `talk:${LATER}`, undefined]);
    expect(later({ laterRelays: [sameCard] })!.verdict).toBe(null);
  });

  // The call line and the turn file are two records of the owner's words, and the reader had kept only one.
  it("refuses when only the call line carries the take-back, quoting the call line", () => {
    const refused = later({ laterRelays: [relay({ callHeard: "oh wait, no, not that one", heard: "yes" })] });

    expect(refused!.heard).toBe("oh wait, no, not that one");
  });

  it("refuses when only the turn file carries the take-back, quoting the turn file", () => {
    const refused = later({ laterRelays: [relay({ callHeard: "yes", heard: "scratch that" })] });

    expect(refused!.heard).toBe("scratch that");
  });

  it("names the first refusing relay in call order", () => {
    const first = relay({ heard: "scratch that", turnId: "a1b2c3d4-0000-4000-8000-00000000000a" });
    const second = relay({ cardDistance: 2, turnId: "a1b2c3d4-0000-4000-8000-00000000000b" });

    expect(later({ laterRelays: [first, second] })!.laterAnchor).toBe("talk:a1b2c3d4-0000-4000-8000-00000000000a");
  });

  it("passes when nothing came after", () => {
    expect(later({ laterRelays: [] })).toBe(undefined);
  });

  it("renders in the four-line shape with no hatch", () => {
    const lines = draftApprovalRefusalLines({
      command: `slopweaver slack draft approve ${TARGET}`,
      error: later({ laterRelays: [relay()] })!,
    });

    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain(`talk:${LATER}, relayed one card later`);
    expect(lines[1]).toContain("a later relay on the same call that rules the next card with a verdict of its own");
    expect(lines[2]).toContain("There is deliberately NO escape hatch");
  });
});

describe("draftApprovalRefusalLines", () => {
  it("prints the four-line shape, saying there is no hatch", () => {
    const error = DraftApprovalAnchorErrors.verdict({ claimed: CLAIMED, verdict: "park-slow-triage" });

    const lines = draftApprovalRefusalLines({ command: `slopweaver slack draft approve ${TARGET}`, error });

    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(`slopweaver slack draft approve ${TARGET} blocked because ${error.message}.`);
    expect(lines[1]).toContain("Legitimate exceptions may include");
    expect(lines[2]).toContain("There is deliberately NO escape hatch");
    expect(lines[3]).toBe(JUDGEMENT_NOTE);
  });
});
