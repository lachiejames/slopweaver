/**
 * A parked draft is spent by its OTHER rows too: a re-cut names what it replaces, a release spends every held
 * cut of the same message, and a second release of the same digest names where the first landed.
 */
import { describe, expect, it } from "vitest";

import {
  type ParkedSlackDraft,
  parkedDraftDigest,
  type SlackDraftItem,
} from "../../../../outbound/slack/draftRegister.js";
import {
  heldCutsOf,
  keptCutNote,
  recordedCutOf,
  releasedTwinOf,
  releaseSpendsCuts,
  supersedeRefusal,
} from "../../../../outbound/slack/draftSpent.js";

const FIRST_LINE =
  "P2 in production, not tracked yet: every third-party provider call for the acme booking service has 404'd since 24 sep";

/** One row carrying `text`, its digest computed as the recorder computes it. */
function row({
  id,
  text,
  state = "held",
  channel = "C0SYN000003",
  authorId = "U0SYN000001",
  tsIso = "2026-09-28T14:00:00.000Z",
  resolvedIso,
  outcome,
}: {
  id: string;
  text: string;
  state?: SlackDraftItem["state"];
  channel?: string;
  authorId?: string;
  tsIso?: string;
  resolvedIso?: string;
  outcome?: string;
}): SlackDraftItem {
  const content = {
    authorId,
    channel,
    mentions: [],
    payload: { form: "plain" as const, text, unfurl_links: false, unfurl_media: false },
  };
  const draft: ParkedSlackDraft = {
    ...content,
    advisory: [],
    digest: parkedDraftDigest({ draft: content }),
    form: "{}",
    id,
    shape: "top-level",
    tsIso,
    why: "the row under test",
  };
  return {
    draft,
    id,
    state,
    ...(resolvedIso === undefined ? {} : { resolvedIso }),
    ...(outcome === undefined ? {} : { outcome }),
  };
}

describe("releaseSpendsCuts — a release spends only what the register records as this message", () => {
  const released = row({ id: "sd-19bcb871", text: `${FIRST_LINE}\nthird cut` });

  it("spends a copy of the same words and keeps a cut that only opens alike", () => {
    const copy = row({ id: "sd-2a84c6d4", text: `${FIRST_LINE}\nthird cut` });
    const alike = row({ id: "sd-1cdf3a4c", text: `${FIRST_LINE}\na different update` });

    const cuts = releaseSpendsCuts({ draft: released, items: [released, copy, alike] });

    expect(cuts.spend.map((item) => item.id)).toEqual(["sd-2a84c6d4"]);
    expect(cuts.kept.map((item) => item.id)).toEqual(["sd-1cdf3a4c"]);
    expect(keptCutNote({ id: "sd-19bcb871", kept: "sd-1cdf3a4c" })).toContain(
      'retire it with `slopweaver slack draft drop sd-1cdf3a4c --note "superseded by sd-19bcb871"`',
    );
  });
});

describe("recordedCutOf — record, never resemblance", () => {
  const older = row({ id: "sd-00000001", text: `${FIRST_LINE}\nfirst cut` });

  it("is true for the same words, a recorded re-cut, or a chain of them", () => {
    const recut = { ...row({ id: "sd-00000002", text: "fixed the tag" }) };
    const recorded = { ...recut, draft: { ...recut.draft, recuts: ["sd-00000001"] } };
    const later = row({ id: "sd-00000003", text: "fixed the em dash" });
    const chained = { ...later, draft: { ...later.draft, recuts: ["sd-00000002"] } };
    const items = [older, recorded, chained];

    expect(
      recordedCutOf({ carrier: row({ id: "sd-0000000a", text: `${FIRST_LINE}\nfirst cut` }), items, row: older }),
    ).toBe(true);
    expect(recordedCutOf({ carrier: recorded, items, row: older })).toBe(true);
    expect(recordedCutOf({ carrier: chained, items, row: older })).toBe(true);
  });

  it("follows a yes inherited from the row", () => {
    const recut = row({ id: "sd-00000002", text: "fixed the tag" });
    const inherited = {
      ...recut,
      draft: {
        ...recut.draft,
        approval: {
          anchor: "talk-call:x#1",
          atIso: "2026-09-28T14:00:00.000Z",
          heard: "send it",
          inheritedFrom: "sd-00000001",
        },
      },
    };

    expect(recordedCutOf({ carrier: inherited, items: [older, inherited], row: older })).toBe(true);
  });

  it("is false for a cut that only opens alike, or names another row", () => {
    const alike = row({ id: "sd-00000002", text: `${FIRST_LINE}\nsecond cut` });
    const elsewhere = { ...alike, draft: { ...alike.draft, recuts: ["sd-0000000f"] } };

    expect(recordedCutOf({ carrier: alike, items: [older, alike], row: older })).toBe(false);
    expect(recordedCutOf({ carrier: elsewhere, items: [older, elsewhere], row: older })).toBe(false);
  });
});

describe("heldCutsOf — what a release spends", () => {
  const released = row({ id: "sd-19bcb871", text: `${FIRST_LINE}\nthird cut` });

  it("spends a held cut with the same opening line and a held copy of the same words, oldest first", () => {
    const items = [
      released,
      row({ id: "sd-1cdf3a4c", text: `${FIRST_LINE}\nsecond cut`, tsIso: "2026-09-28T09:29:00.000Z" }),
      row({ id: "sd-2a84c6d4", text: `${FIRST_LINE}\nthird cut`, tsIso: "2026-09-28T08:00:00.000Z" }),
    ];
    expect(heldCutsOf({ draft: released, items }).map((item) => item.id)).toEqual(["sd-2a84c6d4", "sd-1cdf3a4c"]);
  });

  it("spends nothing in another place, under another author, already dropped, or opening differently", () => {
    const items = [
      released,
      row({ channel: "C0OTHER", id: "sd-00000001", text: `${FIRST_LINE}\nx` }),
      row({ authorId: "U0SYNSOMEONE", id: "sd-00000002", text: `${FIRST_LINE}\nx` }),
      row({ id: "sd-00000003", state: "dropped", text: `${FIRST_LINE}\nx` }),
      row({ id: "sd-00000004", text: "A different finding entirely, about the staging pool and its limits\nx" }),
    ];
    expect(heldCutsOf({ draft: released, items })).toEqual([]);
  });

  it("matches a short opening only on the whole words, since a short line is not a message's identity", () => {
    const short = row({ id: "sd-00000010", text: "thanks!\nfor the review" });
    const items = [short, row({ id: "sd-00000011", text: "thanks!\nfor the fix" })];
    expect(heldCutsOf({ draft: short, items })).toEqual([]);
  });
});

describe("releasedTwinOf — a second release of the same digest", () => {
  it("answers the earliest released row carrying the same digest, and nothing for a fresh message", () => {
    const text = `${FIRST_LINE}\ncut`;
    const held = row({ id: "sd-0000000a", text });
    const early = row({ id: "sd-0000000b", resolvedIso: "2026-09-28T14:01:00.000Z", state: "released", text });
    const late = row({ id: "sd-0000000c", resolvedIso: "2026-09-28T16:05:00.000Z", state: "released", text });
    expect(releasedTwinOf({ draft: held, items: [held, late, early] })!.id).toBe("sd-0000000b");
    expect(releasedTwinOf({ draft: held, items: [held] })).toBe(undefined);
  });
});

describe("supersedeRefusal — what --supersedes may name", () => {
  const items = [
    row({ id: "sd-0000000d", text: "held" }),
    row({
      id: "sd-0000000e",
      outcome: "C0SYN000003 1790604264.247109 · https://acme.slack.com/archives/C0SYN000003/p1790604264247109",
      resolvedIso: "2026-09-28T14:01:00.000Z",
      state: "released",
      text: "gone",
    }),
  ];

  it("allows a held row", () => {
    expect(supersedeRefusal({ id: "sd-0000000d", items })).toBe(undefined);
  });

  it("refuses a released row, naming where it landed", () => {
    expect(supersedeRefusal({ id: "sd-0000000e", items })).toBe(
      "--supersedes sd-0000000e: as-me draft sd-0000000e was already released (C0SYN000003 1790604264.247109 · " +
        "https://acme.slack.com/archives/C0SYN000003/p1790604264247109); a spent row is never performed twice " +
        "— nothing was parked. Name the cut that is still held.",
    );
  });

  it("refuses an id the register does not hold", () => {
    expect(supersedeRefusal({ id: "sd-ffffffff", items })).toContain("no as-me draft carries the id sd-ffffffff");
  });
});
