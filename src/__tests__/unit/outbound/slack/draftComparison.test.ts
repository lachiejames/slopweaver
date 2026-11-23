/**
 * `draftComparison.ts` — which new row owes a Codex draft, which pass may still land, and what the owner's pick does to
 * the row's words.
 */
import { describe, expect, it } from "vitest";

import {
  type ComparisonOutcome,
  candidateDropsReceipts,
  candidateReceipts,
  codexDropsReceiptsRefusal,
  comparedRow,
  comparisonAtPark,
  comparisonCarried,
  comparisonRunnable,
  draftPickCounts,
  originalWords,
  pickedRow,
  pickOwed,
  pickOwedRefusal,
  type SlackDraftCandidate,
  withParkedComparison,
} from "../../../../outbound/slack/draftComparison.js";
import type { DraftApproval, SlackDraftItem } from "../../../../outbound/slack/draftRegister.js";
import type { ParkedDraftReceipts } from "../../../../outbound/slack/receiptsLine.js";

const APPROVAL: DraftApproval = {
  anchor: "talk-call:541f50a8-0000-4000-8000-000000000001#turn_SendIt",
  atIso: "2026-10-09T11:10:00.000Z",
  heard: "Send it",
};

const CANDIDATE: SlackDraftCandidate = {
  advisory: ["one advisory"],
  digest: "digest of codex words",
  form: '{"text":"codex words"}',
  mentions: [],
  payload: { form: "plain", text: "codex words", unfurl_links: false, unfurl_media: false },
};

const READY: ComparisonOutcome = { candidate: CANDIDATE, elapsedMs: 4200, requestedModel: "gpt-test", state: "ready" };

/** A held as-me row carrying its own words, with whatever comparison, pick or approval a case gives it. */
function row({
  id = "sd-11112222",
  approval,
  state = "held",
  comparison,
  receipts,
  text = "claude words",
}: {
  id?: string;
  approval?: DraftApproval;
  state?: SlackDraftItem["state"];
  comparison?: SlackDraftItem["comparison"];
  receipts?: ParkedDraftReceipts;
  text?: string;
}): SlackDraftItem {
  return {
    draft: {
      advisory: [],
      channel: "C0123456789",
      digest: "digest of claude words",
      form: '{"text":"claude words"}',
      id,
      mentions: [],
      payload: { form: "plain", text, unfurl_links: false, unfurl_media: false },
      shape: "top-level",
      tsIso: "2026-10-09T11:06:00.000Z",
      why: "reply to Seth",
      ...(approval === undefined ? {} : { approval }),
      ...(receipts === undefined ? {} : { receipts }),
    },
    id,
    state,
    ...(comparison === undefined ? {} : { comparison }),
  };
}

const READY_ROW = row({ comparison: { ...READY, atIso: "2026-10-09T11:07:00.000Z" } });

describe("comparisonAtPark", () => {
  it("owes nothing on a bot row", () => {
    expect(comparisonAtPark({ draft: { actor: "bot" } })).toBeUndefined();
  });

  it("owes a pass on a fresh as-me row", () => {
    expect(comparisonAtPark({ draft: { composer: "claude-code" } })).toEqual({ state: "pending" });
  });

  it("skips a row approved at record, with media, or composed by Codex, naming which", () => {
    expect(comparisonAtPark({ draft: { approval: APPROVAL } })).toEqual({
      reason: "approved-at-record",
      state: "skipped",
    });
    expect(comparisonAtPark({ draft: { media: [{ bytes: 4, name: "a.png", sha256: "ab" }] } })).toEqual({
      reason: "has-media",
      state: "skipped",
    });
    expect(comparisonAtPark({ draft: { composer: "codex" } })).toEqual({
      reason: "composed-by-codex",
      state: "skipped",
    });
  });

  it("owes a pass when the media list is empty", () => {
    expect(comparisonAtPark({ draft: { media: [] } })).toEqual({ state: "pending" });
  });
});

describe("comparisonRunnable and pickOwed", () => {
  it("runs on a pending or unavailable held row, never on a final or released one", () => {
    expect(comparisonRunnable({ item: row({ comparison: { state: "pending" } }) })).toBe(true);
    const unavailable = { atIso: "2026-10-09T11:07:00.000Z", reason: "capped", state: "unavailable" } as const;
    expect(comparisonRunnable({ item: row({ comparison: unavailable }) })).toBe(true);
    expect(comparisonRunnable({ item: READY_ROW })).toBe(false);
    expect(comparisonRunnable({ item: row({ comparison: { state: "pending" }, state: "released" }) })).toBe(false);
    expect(comparisonRunnable({ item: row({}) })).toBe(false);
    const bot = row({ comparison: { state: "pending" } });
    expect(comparisonRunnable({ item: { ...bot, draft: { ...bot.draft, actor: "bot" } } })).toBe(false);
  });

  it("owes a pick on a held, unpicked row whose candidate is ready or still pending", () => {
    expect(pickOwed({ item: READY_ROW })).toBe(true);
    expect(pickOwed({ item: row({ comparison: { state: "pending" } }) })).toBe(true);
    const unavailable = { atIso: "2026-10-09T11:07:00.000Z", reason: "capped", state: "unavailable" } as const;
    expect(pickOwed({ item: row({ comparison: unavailable }) })).toBe(false);
    expect(pickOwed({ item: row({ comparison: { state: "pending" }, state: "released" }) })).toBe(false);
    const picked = pickedRow({ event: pickEvent({ variant: "original" }), standing: READY_ROW });
    expect(pickOwed({ item: picked })).toBe(false);
  });

  it("names the retry while pending, and both commands that choose once ready", () => {
    expect(pickOwedRefusal({ id: "sd-11112222", pending: true })).toContain(
      "if no pass is running, finish it: slopweaver slack draft compare sd-11112222",
    );
    expect(pickOwedRefusal({ id: "sd-11112222", pending: false })).toContain(
      "slopweaver slack draft approve sd-11112222 --variant <original|codex> --anchor <anchor>",
    );
    expect(pickOwedRefusal({ id: "sd-11112222", pending: false })).toContain("slopweaver slack draft pick sd-11112222");
  });
});

/** A `compared` event at a fixed instant. */
function comparedEvent({ outcome }: { outcome: ComparisonOutcome }): {
  kind: "compared";
  id: string;
  tsIso: string;
  outcome: ComparisonOutcome;
} {
  return { id: "sd-11112222", kind: "compared", outcome, tsIso: "2026-10-09T11:08:00.000Z" };
}

/** A `picked` event at a fixed instant. */
function pickEvent({ variant }: { variant: "original" | "codex" }): {
  kind: "picked";
  id: string;
  tsIso: string;
  variant: "original" | "codex";
} {
  return { id: "sd-11112222", kind: "picked", tsIso: "2026-10-09T11:12:00.000Z", variant };
}

describe("comparedRow", () => {
  it("takes the outcome onto a pending row, stamped with the event's instant", () => {
    const after = comparedRow({
      event: comparedEvent({ outcome: READY }),
      standing: row({ comparison: { state: "pending" } }),
    });
    expect(after.comparison).toEqual({ ...READY, atIso: "2026-10-09T11:08:00.000Z" });
  });

  it("never overwrites a ready candidate with a late pass", () => {
    const late = comparedEvent({ outcome: { reason: "capped", state: "unavailable" } });
    expect(comparedRow({ event: late, standing: READY_ROW })).toBe(READY_ROW);
  });

  it("never lands on an approved row", () => {
    const approved = row({ approval: APPROVAL, comparison: { state: "pending" } });
    expect(comparedRow({ event: comparedEvent({ outcome: READY }), standing: approved })).toBe(approved);
  });

  it("folds a comparison journalled after the release to nothing", () => {
    const released = row({ comparison: { state: "pending" }, state: "released" });
    expect(comparedRow({ event: comparedEvent({ outcome: READY }), standing: released })).toBe(released);
  });
});

describe("pickedRow", () => {
  it("makes Codex's candidate the row's words on a codex pick, keeping the original beside it", () => {
    const after = pickedRow({ event: pickEvent({ variant: "codex" }), standing: READY_ROW });
    expect(after.draft.digest).toBe("digest of codex words");
    expect(after.draft.form).toBe('{"text":"codex words"}');
    expect(after.original!.digest).toBe("digest of claude words");
    expect(after.pick).toEqual({ atIso: "2026-10-09T11:12:00.000Z", model: "gpt-test", variant: "codex" });
    expect(originalWords({ item: after }).form).toBe('{"text":"claude words"}');
  });

  it("keeps the row's own words on an original pick", () => {
    const after = pickedRow({ event: pickEvent({ variant: "original" }), standing: READY_ROW });
    expect(after.draft.digest).toBe("digest of claude words");
    expect(after.original).toBeUndefined();
    expect(after.pick!.variant).toBe("original");
  });

  it("changes nothing on a row with no ready candidate, or one already approved", () => {
    const pending = row({ comparison: { state: "pending" } });
    expect(pickedRow({ event: pickEvent({ variant: "codex" }), standing: pending })).toBe(pending);
    const approved = row({ approval: APPROVAL, comparison: { ...READY, atIso: "2026-10-09T11:07:00.000Z" } });
    expect(pickedRow({ event: pickEvent({ variant: "codex" }), standing: approved })).toBe(approved);
  });

  it("folds a second pick to nothing, so a hand-written line never swaps back what the owner chose", () => {
    const codex = pickedRow({ event: pickEvent({ variant: "codex" }), standing: READY_ROW });
    const again = pickedRow({ event: pickEvent({ variant: "original" }), standing: codex });
    expect([again, again.draft.digest, again.pick!.variant]).toEqual([codex, "digest of codex words", "codex"]);
  });
});

describe("receipts across a comparison", () => {
  const LINK = "https://github.com/acme/acme-admin/pull/18398";
  const linked = ({ text }: { text: string }) =>
    ({ form: "plain", text, unfurl_links: false, unfurl_media: false }) as const;
  /** sd-d9fa519b's shape: A links to its receipt, and Codex's B, written blind to A, links nowhere. */
  const DROPPING = row({
    comparison: { ...READY, atIso: "2026-10-09T11:07:00.000Z" },
    receipts: { kind: "attached", links: [LINK], media: 0 },
    text: `the PR: <${LINK}|#18398>`,
  });
  const KEEPING = row({
    comparison: {
      ...READY,
      atIso: "2026-10-09T11:07:00.000Z",
      candidate: { ...CANDIDATE, payload: linked({ text: `see <${LINK}|the PR>` }) },
    },
    receipts: { kind: "attached", links: [LINK], media: 0, tried: "the trace view needs a login" },
    text: `the PR: <${LINK}|#18398>`,
  });

  it("derives B's own links, carries A's declaration when B has none, and drops A's links-only receipt", () => {
    expect([
      candidateReceipts({ original: { kind: "tried", tried: "403" }, payload: linked({ text: `<${LINK}|PR>` }) }),
      candidateReceipts({ original: { kind: "self-evident", why: "the question" }, payload: linked({ text: "b" }) }),
      candidateReceipts({ original: { kind: "tried", tried: "403" }, payload: linked({ text: "b" }) }),
      candidateReceipts({ original: { kind: "attached", links: [LINK], media: 0 }, payload: linked({ text: "b" }) }),
      candidateReceipts({ original: undefined, payload: linked({ text: "b" }) }),
    ]).toEqual([
      { kind: "attached", links: [LINK], media: 0, tried: "403" },
      { kind: "self-evident", why: "the question" },
      { kind: "tried", tried: "403" },
      undefined,
      undefined,
    ]);
  });

  it("says B drops A's receipt only when A links to one and B links nowhere", () => {
    const legacy = READY_ROW;
    expect([DROPPING, KEEPING, legacy].map((item) => candidateDropsReceipts({ item }))).toEqual([true, false, false]);
  });

  it("folds a codex pick of a B that drops A's receipt to nothing, while A stays choosable", () => {
    expect(pickedRow({ event: pickEvent({ variant: "codex" }), standing: DROPPING })).toBe(DROPPING);
    const original = pickedRow({ event: pickEvent({ variant: "original" }), standing: DROPPING });
    expect([original.pick!.variant, original.draft.receipts]).toEqual([
      "original",
      { kind: "attached", links: [LINK], media: 0 },
    ]);
  });

  it("gives the row B's own receipts on a codex pick, keeping A's beside its words", () => {
    const after = pickedRow({ event: pickEvent({ variant: "codex" }), standing: KEEPING });
    expect([after.draft.receipts, after.original!.receipts]).toEqual([
      { kind: "attached", links: [LINK], media: 0, tried: "the trace view needs a login" },
      { kind: "attached", links: [LINK], media: 0, tried: "the trace view needs a login" },
    ]);
  });

  it("names both ways forward and the absent hatch in its refusal", () => {
    expect(codexDropsReceiptsRefusal({ id: "sd-d9fa519b" })).toContain(
      "slopweaver slack draft pick sd-d9fa519b --variant original",
    );
    expect(codexDropsReceiptsRefusal({ id: "sd-d9fa519b" })).toContain("There is deliberately NO escape hatch");
  });
});

describe("withParkedComparison and comparisonCarried", () => {
  it("lifts the park's comparison onto the folded row", () => {
    const parked = row({});
    const withPark: SlackDraftItem = { ...parked, draft: { ...parked.draft, comparison: { state: "pending" } } };
    expect(withParkedComparison({ row: withPark }).comparison).toEqual({ state: "pending" });
    expect(withParkedComparison({ row: parked })).toBe(parked);
  });

  it("carries comparison, pick and original across a judgement, and nothing it never held", () => {
    const picked = pickedRow({ event: pickEvent({ variant: "codex" }), standing: READY_ROW });
    expect(Object.keys(comparisonCarried({ standing: picked })).toSorted()).toEqual(["comparison", "original", "pick"]);
    expect(comparisonCarried({ standing: row({}) })).toEqual({});
  });
});

describe("draftPickCounts", () => {
  it("is zero on a register with no pick", () => {
    expect(draftPickCounts({ items: [row({})] })).toEqual({ byModel: {}, codex: 0, original: 0 });
  });

  it("counts each variant, and by the model Codex was asked", () => {
    const codex = pickedRow({ event: pickEvent({ variant: "codex" }), standing: READY_ROW });
    const original = pickedRow({ event: pickEvent({ variant: "original" }), standing: READY_ROW });
    expect(draftPickCounts({ items: [codex, original, codex] })).toEqual({
      byModel: { "gpt-test": { codex: 2, original: 1 } },
      codex: 2,
      original: 1,
    });
  });
});
