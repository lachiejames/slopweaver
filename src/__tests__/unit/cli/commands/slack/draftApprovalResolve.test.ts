/**
 * `draftApprovalResolve.ts` direct: the approval a recording carries is the owner's WHOLE words at `--approved`, or a refusal
 * naming why they cannot stand as the owner's yes. Driven through the real argv parser, with the owner's words and the register as
 * plain fakes passed in.
 */
import { describe, expect, it } from "vitest";

import { DraftApprovalAnchorErrors } from "../../../../../cli/commands/slack/draftApprovalErrors.js";
import { approvalUnderLock, recordedApproval } from "../../../../../cli/commands/slack/draftApprovalResolve.js";
import type { DraftRecordOptions } from "../../../../../cli/commands/slack/draftCore.js";
import { parseSlackDraftArgs } from "../../../../../cli/commands/slack/draftCore.js";
import type { HisWordsError } from "../../../../../handover/hisWordsErrors.js";
import { HisWordsErrors } from "../../../../../handover/hisWordsErrors.js";
import type { RawWords } from "../../../../../handover/hisWordsResolve.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { slackDraftEventLine } from "../../../../../outbound/slack/draftRegister.js";
import type { ApprovalLaterRelay, ApprovalRelayAnchor } from "../../../../../talk/approvalRelayRead.js";
import { type ApprovalRelayReadError, ApprovalRelayReadErrors } from "../../../../../talk/approvalRelayReadErrors.js";
import { draftItem, KNOCK } from "../../../supervisor/draftItemFixture.js";

const ANCHOR = "talk-call:541f50a8-0000-4000-8000-000000000001#turn_SendIt";
/** A relay turn's anchor — what a relay context is read at. */
const RELAY = "talk:541f50a8-0000-4000-8000-000000000003";
/** The turn after {@link RELAY} on the same call. */
const LATER_TURN = "541f50a8-0000-4000-8000-000000000004";
/** The held row whose card a relay's yes was said over. */
const OLD = "sd-11112222";
/** What the fixture row digests to, so a composed row sharing it carries {@link OLD}'s exact words. */
const OLD_DIGEST = draftItem({ id: OLD, tsIso: "2026-10-07T05:00:00.000Z" }).draft.digest;
/** A composed row's digest no fixture row shares. */
const OTHER_DIGEST = "fedcba9876543210fedcba9876543210";
const WHOLE: RawWords = {
  atIso: "2026-10-07T05:52:59.000Z",
  context: { kind: "call-segment", open: undefined },
  headKnown: true,
  headLost: false,
  tailKnown: true,
  tailLost: false,
  text: "Send it",
  where: "call",
};

/** A parsed `slack draft record` carrying these extra flags. */
function recordOptions({ extra }: { extra: readonly string[] }): DraftRecordOptions {
  const parsed = unwrap(
    parseSlackDraftArgs({
      defaultHome: "/tmp/no-home",
      rest: ["record", "--channel", "C1", "--form", "-", "--why", "w", "--asked-before", "none", ...extra],
    }),
  );
  expect(parsed.mode).toBe("record");
  return parsed as DraftRecordOptions;
}

/** Resolve one recording against these words at its anchor, the relays after it, and a register holding OLD. */
function resolve({
  extra,
  later = ok([]),
  reads = [],
  words,
}: {
  extra: readonly string[];
  later?: Result<readonly ApprovalLaterRelay[], ApprovalRelayReadError>;
  reads?: ApprovalRelayAnchor[];
  words: Result<RawWords, HisWordsError>;
}): ReturnType<typeof recordedApproval> {
  return recordedApproval({
    deps: {
      readApprovalLaterRelays: ({ anchor }) => {
        reads.push(anchor);
        return later;
      },
      readOwnerWords: () => words,
      readLog: () => [HELD_OLD],
    },
    options: recordOptions({ extra }),
  });
}

/** "oh wait, no, not that one", relayed over the next card one card later with no ruling of its own. */
const TAKE_BACK: ApprovalLaterRelay = {
  about: "post:sd-99998888",
  callHeard: "oh wait, no, not that one",
  cardDistance: 1,
  heard: "oh wait, no, not that one",
  triageRuling: null,
  turnId: LATER_TURN,
  wordsWhole: true,
};

/** The register line parking {@link OLD}, held and carrying no approval. */
const HELD_OLD = slackDraftEventLine({
  event: {
    draft: draftItem({ id: OLD, tsIso: "2026-10-07T05:00:00.000Z" }).draft,
    id: OLD,
    kind: "parked",
    tsIso: "2026-10-07T05:00:00.000Z",
  },
});
/** A relay that ruled send-it over {@link OLD}'s card. */
const OVER_OLD: RawWords = {
  ...WHOLE,
  context: { about: `post:${OLD}`, kind: "relay", triageRuling: { label: undefined, verdict: "send-it" } },
};
/** The card refusal a relay over {@link OLD}'s card carries when the recording re-cuts no row. */
const UNBOUND = DraftApprovalAnchorErrors.cardMismatch({
  about: `post:${OLD}`,
  claimed: `--approved ${RELAY}`,
  expectedDraftIds: [],
  why: `the relay was about post:${OLD}`,
});

describe("recordedApproval", () => {
  it("carries nothing when --approved was not passed", () => {
    expect(unwrap(resolve({ extra: [], words: ok(WHOLE) }))).toEqual({});
  });

  it("carries the owner's whole words on a call, the anchor and their instant, with no row yet", () => {
    expect(unwrap(resolve({ extra: ["--approved", ANCHOR], words: ok(WHOLE) }))).toEqual({
      approval: { anchor: ANCHOR, atIso: WHOLE.atIso, heard: "Send it" },
    });
  });

  it("binds a relay's yes over a row's card through the re-cut of that row, having read what the owner said after it", () => {
    const reads: ApprovalRelayAnchor[] = [];

    expect(unwrap(resolve({ extra: ["--approved", RELAY, "--supersedes", OLD], reads, words: ok(OVER_OLD) }))).toEqual({
      approval: { anchor: RELAY, atIso: WHOLE.atIso, heard: "Send it" },
    });
    expect(reads).toEqual([
      {
        anchor: RELAY,
        card: `post:${OLD}`,
        kind: "relay",
        stagedAtIso: WHOLE.atIso,
        turnId: "541f50a8-0000-4000-8000-000000000003",
      },
    ]);
  });

  it("owes a fresh recording of a relay's yes over another row's card that row's exact words, checked under the lock", () => {
    expect(unwrap(resolve({ extra: ["--approved", RELAY], words: ok(OVER_OLD) }))).toEqual({
      approval: { anchor: RELAY, atIso: WHOLE.atIso, heard: "Send it" },
      cardBound: { refusal: UNBOUND, sameMessageAs: [OLD] },
    });
  });

  it("refuses a relay's yes the owner took back on the next card, in four lines naming the later turn", () => {
    const refused = unwrapErr(
      resolve({ extra: ["--approved", RELAY, "--supersedes", OLD], later: ok([TAKE_BACK]), words: ok(OVER_OLD) }),
    );

    expect(refused).toHaveLength(4);
    expect(refused[0]).toBe(
      `slopweaver slack draft record blocked because --approved ${RELAY}: talk:${LATER_TURN}, relayed one card later ` +
        'on the same call, said "oh wait, no, not that one" over post:sd-99998888 — a take-back or another verdict ' +
        "that names no card of its own, so it may take this yes back — nothing was recorded. Ask the owner which card they " +
        "meant and record the ruling they give on it.",
    );
    expect(refused[2]).toContain("There is deliberately NO escape hatch");
  });

  it("refuses a card-bound yes the owner took back too, before any lock", () => {
    const refused = unwrapErr(resolve({ extra: ["--approved", RELAY], later: ok([TAKE_BACK]), words: ok(OVER_OLD) }));

    expect(refused[0]).toContain(`talk:${LATER_TURN}, relayed one card later`);
  });

  it("refuses a relay's yes whose call cannot say what the owner said after it", () => {
    const missing = ApprovalRelayReadErrors.callMissing({ anchor: RELAY });

    const refused = unwrapErr(
      resolve({ extra: ["--approved", RELAY, "--supersedes", OLD], later: err(missing), words: ok(OVER_OLD) }),
    );

    expect(refused).toHaveLength(4);
    expect(refused[0]).toBe(
      `slopweaver slack draft record blocked because --approved ${RELAY}: no call file holds ${RELAY}, so what the owner ` +
        "said after it cannot be read — nothing was recorded. Put the card in front of the owner and record the yes they " +
        "give on it, or name a relay whose call reads whole.",
    );
  });

  it("reads nothing after a call stretch, the gate's stated residue", () => {
    const reads: ApprovalRelayAnchor[] = [];

    unwrap(resolve({ extra: ["--approved", ANCHOR], later: ok([TAKE_BACK]), reads, words: ok(WHOLE) }));

    expect(reads).toEqual([]);
  });

  it("reads nothing after a relay the anchor's own verdict already refused", () => {
    const reads: ApprovalRelayAnchor[] = [];
    const ruled: RawWords = {
      ...WHOLE,
      context: { about: `post:${OLD}`, kind: "relay", triageRuling: { label: undefined, verdict: "rewrite" } },
    };

    unwrapErr(resolve({ extra: ["--approved", RELAY, "--supersedes", OLD], reads, words: ok(ruled) }));

    expect(reads).toEqual([]);
  });

  it("refuses a yes from a relay about no card, in four lines with no hatch", () => {
    const cardless: RawWords = { ...WHOLE, context: { about: "", kind: "relay", triageRuling: null } };

    const refused = unwrapErr(resolve({ extra: ["--approved", RELAY], words: ok(cardless) }));

    expect(refused).toHaveLength(4);
    expect(refused[0]).toBe(
      `slopweaver slack draft record blocked because --approved ${RELAY}: the relay was about no card, so it is not ` +
        "the owner's yes to this draft (a yes here binds no draft at all — a fresh record --approved binds only through " +
        "--supersedes <id>, or by carrying the exact words of the row whose card the owner spoke on) — nothing was recorded. " +
        "Put the card in front of the owner and record the yes they give on it.",
    );
    expect(refused[2]).toContain("There is deliberately NO escape hatch");
  });

  it("refuses an unruled relay's remark over the re-cut row's own card, in four lines, reading nothing after it", () => {
    const reads: ApprovalRelayAnchor[] = [];
    const remark: RawWords = {
      ...WHOLE,
      context: { about: `post:${OLD}`, kind: "relay", triageRuling: null },
      text: "Hm, who's Tobias again?",
    };

    const refused = unwrapErr(resolve({ extra: ["--approved", RELAY, "--supersedes", OLD], reads, words: ok(remark) }));

    expect(refused).toHaveLength(4);
    expect(refused[0]).toBe(
      `slopweaver slack draft record blocked because --approved ${RELAY}: the owner said "Hm, who's Tobias again?" with the ` +
        "card open, and the words carry no yes, so an open card is all that ties it to a yes — nothing was recorded. " +
        "Hold it not-owner-yes, or record the yes they give on its card.",
    );
    expect(refused[2]).toContain("There is deliberately NO escape hatch");
    expect(reads).toEqual([]);
  });

  it("refuses an --approved whose relay ruled needs-more-info, naming the verdict (incident C0SYN000001)", () => {
    const ruled: RawWords = {
      ...WHOLE,
      context: { about: `post:${OLD}`, kind: "relay", triageRuling: { label: undefined, verdict: "needs-more-info" } },
      text: "Yes, of course",
    };

    const refused = unwrapErr(resolve({ extra: ["--approved", RELAY, "--supersedes", OLD], words: ok(ruled) }));

    expect(refused[0]).toContain("the relay recorded the owner's triage verdict as needs-more-info, not send-it");
  });

  it("refuses an anchor whose words do not read, carrying the reader's reason", () => {
    const refused = unwrapErr(
      resolve({ extra: ["--approved", ANCHOR], words: err(HisWordsErrors.notOwnerScheme({ anchor: ANCHOR })) }),
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain("does not point at a record of the owner's words");
  });

  it("refuses words whose start the record cut", () => {
    const refused = unwrapErr(resolve({ extra: ["--approved", ANCHOR], words: ok({ ...WHOLE, headLost: true }) }));
    expect(refused[0]).toContain("holds only part of what the owner said there");
  });

  it("refuses a relay that never recorded whether its start was cut", () => {
    const refused = unwrapErr(resolve({ extra: ["--approved", ANCHOR], words: ok({ ...WHOLE, headKnown: false }) }));
    expect(refused[0]).toContain("predates the record of whether its start was cut");
  });

  // The voice relayed while the owner's stretch was still open, so the call holds what came next.
  it("refuses a relay made mid-sentence, naming the call's own stretch", () => {
    const cut: RawWords = { ...OVER_OLD, tailLost: true };
    const refused = unwrapErr(resolve({ extra: ["--approved", RELAY, "--supersedes", OLD], words: ok(cut) }));
    expect(refused[0]).toContain(
      "the relay was made while the owner was still speaking, so it cannot stand as a yes — name the call's own stretch instead (talk-call:<call>#<segment>)",
    );
  });

  it("refuses a voice relay that never recorded whether the owner was still speaking", () => {
    const refused = unwrapErr(resolve({ extra: ["--approved", ANCHOR], words: ok({ ...WHOLE, tailKnown: false }) }));
    expect(refused[0]).toContain("predates the record of whether the owner was still speaking");
  });

  // An overtaken or dropped call can land a stretch the owner had not finished: the landing that says so, and one
  // written before it could, never bind as their yes over the very card the landing names.
  it("refuses a card landing on this draft's card that cut the owner's words, or predates saying whether it did", () => {
    const landing: RawWords = {
      ...WHOLE,
      context: { cardKey: `post:${OLD}`, draftIds: undefined, draftIdsUnread: undefined, kind: "card-landing" },
      where: "call-landing",
    };
    const extra = ["--approved", `call:541f50a8-0000-4000-8000-000000000001#s-1`, "--supersedes", OLD];
    const cut = unwrapErr(resolve({ extra, words: ok({ ...landing, tailLost: true }) }));
    const older = unwrapErr(resolve({ extra, words: ok({ ...landing, tailKnown: false }) }));
    expect([cut[0], older[0]]).toEqual([
      expect.stringContaining("holds only part of what"),
      expect.stringContaining("the card landing predates the record of whether its words were cut"),
    ]);
    expect(unwrap(resolve({ extra, words: ok(landing) })).approval!.heard).toBe("Send it");
  });

  it("refuses blank words", () => {
    const refused = unwrapErr(resolve({ extra: ["--approved", ANCHOR], words: ok({ ...WHOLE, text: "  " }) }));
    expect(refused[0]).toContain("holds only part of what the owner said there");
  });

  it("refuses words the record cannot date, which the register would never read back", () => {
    const refused = unwrapErr(resolve({ extra: ["--approved", ANCHOR], words: ok({ ...WHOLE, atIso: "yesterday" }) }));
    expect(refused[0]).toContain("does not date the owner's words as an instant (yesterday)");
  });
});

describe("approvalUnderLock", () => {
  const TS = "2026-10-08T00:10:00.000Z";

  it("inherits an approve that landed on the superseded row while the recording read Slack", () => {
    const approved = draftItem({ approval: KNOCK, id: "sd-11112222", tsIso: TS });

    expect(
      unwrap(approvalUnderLock({ approval: {}, digest: OTHER_DIGEST, items: [approved], supersedes: ["sd-11112222"] })),
    ).toEqual({ approval: { ...KNOCK, inheritedFrom: "sd-11112222" } });
  });

  it("binds a fresh yes over a dropped row's card when the composed row carries that row's exact words", () => {
    const dropped = draftItem({ id: OLD, outcome: "moot", state: "dropped", tsIso: TS });
    const approval = { approval: KNOCK, cardBound: { refusal: UNBOUND, sameMessageAs: [OLD] } };

    expect(unwrap(approvalUnderLock({ approval, digest: OLD_DIGEST, items: [dropped], supersedes: [] }))).toEqual({
      approval: KNOCK,
    });
  });

  it("refuses that yes onto other words, naming the card the owner spoke on", () => {
    const held = draftItem({ id: OLD, tsIso: TS });
    const approval = { approval: KNOCK, cardBound: { refusal: UNBOUND, sameMessageAs: [OLD] } };

    const refused = unwrapErr(approvalUnderLock({ approval, digest: OTHER_DIGEST, items: [held], supersedes: [] }));

    expect(refused).toHaveLength(4);
    expect(refused[0]).toContain(
      `slopweaver slack draft record blocked because --approved ${RELAY}: the owner's yes was said over post:${OLD}, and ` +
        "these are not that row's exact words, so it is not the owner's yes to this draft",
    );
  });

  it("keeps a fresh --approved and a declared change, and sets down an inherited yes a hold on words that were not the owner's yes removed", () => {
    const bare = draftItem({ id: "sd-11112222", tsIso: TS });
    const inherited = { approval: { ...KNOCK, inheritedFrom: "sd-11112222" } };

    expect(
      unwrap(approvalUnderLock({ approval: { approval: KNOCK }, digest: OTHER_DIGEST, items: [bare], supersedes: [] })),
    ).toEqual({ approval: KNOCK });
    expect(
      unwrap(
        approvalUnderLock({ approval: inherited, digest: OTHER_DIGEST, items: [bare], supersedes: ["sd-11112222"] }),
      ),
    ).toEqual({});
  });

  it("parks nothing when a superseded row was spent while the recording read Slack", () => {
    const spent = draftItem({ id: "sd-11112222", outcome: "moot", state: "dropped", tsIso: TS });

    const refused = unwrapErr(
      approvalUnderLock({ approval: {}, digest: OTHER_DIGEST, items: [spent], supersedes: ["sd-11112222"] }),
    );

    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain("--supersedes sd-11112222: ");
    expect(refused[0]).toContain("— nothing was parked. Name the cut that is still held.");
  });
});
