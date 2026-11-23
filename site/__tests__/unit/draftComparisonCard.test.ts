/*
 * A Codex draft beside the original on a Queue post card: the reader carries B only while the owner's pick is owed, refuses a
 * comparison it cannot read whole, and the card asks "Claude's or Codex's?" with two picks that never send.
 */

import { describe, expect, it } from "vitest";

import { pickOwed } from "../../components/live/readDraftComparison";
import { readParkedDrafts } from "../../components/live/readSlackDrafts";
import { postCard } from "../../lib/postCard";
import { postChoiceOf } from "../../lib/postHead";

/** A plain payload carrying `text`, as the escape hatch emits it. */
function plain({ text }: { text: string }): Record<string, unknown> {
  return { form: "plain", text, unfurl_links: false, unfurl_media: false };
}

/** Codex's ready candidate, in the register's shape. */
const CANDIDATE = {
  advisory: [],
  digest: "c0dec0dec0dec0de",
  form: "{}",
  mentions: [],
  payload: plain({ text: "B words" }),
};

/** A `--json` payload holding one held row, its item fields laid over by `item`. */
function payload({ item = {}, composer }: { item?: Record<string, unknown>; composer?: string }): unknown {
  return {
    items: [
      {
        draft: {
          advisory: [],
          channel: "C0ISO",
          ...(composer === undefined ? {} : { composer }),
          digest: "3f2a9c11d4e5b6a7",
          mentions: [],
          payload: plain({ text: "A words" }),
          shape: "top-level",
          tsIso: "2026-10-09T11:06:00.000Z",
          why: "the ISO group question",
        },
        id: "sd-1a2b3c4d",
        release: {
          command: "slopweaver slack post --as me --draft sd-1a2b3c4d --approve 3f2a9c11d4e5b6a7",
          kind: "send",
        },
        state: "held",
        ...item,
      },
    ],
  };
}

const READY = {
  atIso: "2026-10-09T11:07:00.000Z",
  candidate: CANDIDATE,
  elapsedMs: 4200,
  requestedModel: "gpt-test",
  state: "ready",
};

describe("a row's comparison, read", () => {
  it("carries B's words, the model and the composer while the owner's pick is owed", () => {
    const drafts = readParkedDrafts(payload({ composer: "claude-code", item: { comparison: READY } }))!;
    const comparison = drafts[0].comparison!;
    expect([comparison.state, comparison.model, comparison.composer, comparison.codex!.fallback]).toEqual([
      "ready",
      "gpt-test",
      "claude-code",
      "B words",
    ]);
    expect(postChoiceOf({ post: drafts[0] })).toEqual({
      dropsReceipts: false,
      model: "gpt-test",
      originalBy: "Claude's",
      question: "Claude's draft or Codex's?",
    });
  });

  it("reads the list's verdict that B drops A's receipt, and refuses one on a B no longer offered", () => {
    const drops = readParkedDrafts(payload({ item: { codexDropsReceipts: true, comparison: READY } }))!;
    expect(postChoiceOf({ post: drops[0] })!.dropsReceipts).toBe(true);
    const picked = { atIso: "2026-10-09T11:12:00.000Z", variant: "original" };
    expect([
      readParkedDrafts(payload({ item: { codexDropsReceipts: false, comparison: READY } })),
      readParkedDrafts(payload({ item: { codexDropsReceipts: true, comparison: { state: "pending" } } })),
      readParkedDrafts(payload({ item: { codexDropsReceipts: true, comparison: READY, pick: picked } })),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("drops B once the owner has picked, and keeps the original's words a Codex pick replaced", () => {
    const original = { advisory: [], digest: "3f2a9c11d4e5b6a7", mentions: [], payload: plain({ text: "A words" }) };
    const item = { comparison: READY, original, pick: { atIso: "2026-10-09T11:12:00.000Z", variant: "codex" } };
    const comparison = readParkedDrafts(payload({ item }))![0].comparison!;
    expect([comparison.codex, comparison.original!.fallback, comparison.pick]).toEqual([
      undefined,
      "A words",
      { atIso: "2026-10-09T11:12:00.000Z", variant: "codex" },
    ]);
  });

  it("says why there is no B on a skipped or refused row, and offers no choice", () => {
    const skipped = readParkedDrafts(payload({ item: { comparison: { reason: "has-media", state: "skipped" } } }))!;
    expect(skipped[0].comparison!.detail).toBe("has-media");
    const refused = { atIso: READY.atIso, reasons: ["banned word: of"], stage: "voice-rules", state: "refused" };
    const drafts = readParkedDrafts(payload({ item: { comparison: refused } }))!;
    expect(drafts[0].comparison!.detail).toBe("voice-rules: banned word: of");
    expect(postChoiceOf({ post: drafts[0] })).toBe(undefined);
  });

  it("names the recording session rather than Claude when the composer was not detected", () => {
    const drafts = readParkedDrafts(payload({ composer: "undetected", item: { comparison: READY } }))!;
    expect(postChoiceOf({ post: drafts[0] })).toEqual({
      dropsReceipts: false,
      model: "gpt-test",
      originalBy: "the recording session's",
      question: "The recording session's draft or Codex's?",
    });
  });

  it("refuses the whole reading on a comparison it cannot read", () => {
    expect(readParkedDrafts(payload({ item: { comparison: { state: "queued" } } }))).toBe(undefined);
    expect(readParkedDrafts(payload({ item: { comparison: { ...READY, requestedModel: undefined } } }))).toBe(
      undefined,
    );
    expect(readParkedDrafts(payload({ item: { comparison: READY, pick: { variant: "both" } } }))).toBe(undefined);
    expect(readParkedDrafts(payload({ item: { comparison: READY, original: { digest: 7 } } }))).toBe(undefined);
  });

  it("owes the owner's pick only while B is ready or coming and neither is chosen, so the send line says it waits", () => {
    const owed = (item: Record<string, unknown>): boolean =>
      pickOwed({ comparison: readParkedDrafts(payload({ item }))![0].comparison });
    const original = { advisory: [], digest: "3f2a9c11d4e5b6a7", mentions: [], payload: plain({ text: "A words" }) };
    const picked = { comparison: READY, original, pick: { atIso: "2026-10-09T11:12:00.000Z", variant: "codex" } };
    expect([
      owed({ comparison: READY }),
      owed({ comparison: { state: "pending" } }),
      owed(picked),
      owed({ comparison: { reason: "has-media", state: "skipped" } }),
      owed({ comparison: { reason: "capped", state: "unavailable" } }),
      owed({}),
    ]).toEqual([true, true, false, false, false, false]);
  });

  it("refuses Codex's words or model on any state but ready", () => {
    const unavailable = { reason: "capped", state: "unavailable" };
    expect(readParkedDrafts(payload({ item: { comparison: unavailable } }))![0].comparison!.detail).toBe("capped");
    const faults = [
      { ...unavailable, candidate: CANDIDATE, requestedModel: "gpt-test" },
      { ...unavailable, requestedModel: "gpt-test" },
      { candidate: CANDIDATE, state: "pending" },
      { candidate: CANDIDATE, reasons: ["x"], stage: "voice-rules", state: "refused" },
    ];
    expect(faults.map((comparison) => readParkedDrafts(payload({ item: { comparison } })))).toEqual(
      faults.map(() => undefined),
    );
  });

  it("refuses a Codex draft carrying a style flag the card does not draw, where the original's reader drops it", () => {
    const rich = ({ style }: { style: Record<string, boolean> }): Record<string, unknown> => ({
      blocks: [
        {
          elements: [{ elements: [{ style, text: "B words", type: "text" }], type: "rich_text_section" }],
          type: "rich_text",
        },
      ],
      text: "B words",
    });
    const withStyle = ({ style }: { style: Record<string, boolean> }): unknown =>
      payload({ item: { comparison: { ...READY, candidate: { ...CANDIDATE, payload: rich({ style }) } } } });
    expect(readParkedDrafts(withStyle({ style: { bold: true, strike: true } }))).toBe(undefined);
    expect(readParkedDrafts(withStyle({ style: { bold: true } }))![0].comparison!.codex!.fallback).toBe("B words");
  });
});

describe("postCard with a choice", () => {
  const post = {
    act: undefined,
    addressed: "in #iso-27001",
    advisory: [],
    choice: { dropsReceipts: false, model: "gpt-test", originalBy: "Claude's", question: "Claude's draft or Codex's?" },
    context: "in #iso-27001",
    digest: "3f2a9c11d4e5b6a7",
    id: "sd-1a2b3c4d",
    mentions: [],
    parent: undefined,
    people: [],
    receiptsLine: "Receipts: 1 link",
    release: {
      command: "slopweaver slack post --as me --draft sd-1a2b3c4d --approve 3f2a9c11d4e5b6a7",
      kind: "send",
    } as const,
    row: undefined,
    text: "A words",
    why: "the ISO group question",
  };

  it("asks which draft, and offers two picks and silence, none of them a send", () => {
    const card = postCard({ post });
    expect(card.question).toBe("Claude's draft or Codex's?");
    expect(card.options.map((option) => option.how)).toEqual([
      {
        command: "slopweaver slack draft pick sd-1a2b3c4d --variant original --anchor <where the owner chose>",
        kind: "elsewhere",
        where: "a session, off your words",
      },
      {
        command: "slopweaver slack draft pick sd-1a2b3c4d --variant codex --anchor <where the owner chose>",
        kind: "elsewhere",
        where: "a session, off your words",
      },
      { kind: "silence" },
    ]);
    expect(card.what!.whole).toContain(
      "Codex drafted the same message blind to A, on gpt-test; choose one before either can be sent.",
    );
  });

  it("offers B as a re-cut rather than a pick when it drops A's receipt, and says so", () => {
    const card = postCard({ post: { ...post, choice: { ...post.choice, dropsReceipts: true } } });
    expect(card.options[1]).toEqual({
      how: {
        command: "slopweaver slack draft record … --supersedes sd-1a2b3c4d",
        kind: "elsewhere",
        where: "a session, re-cutting Codex's wording with A's link in it",
      },
      letter: "B",
      sentence:
        "Prefer Codex's words? It drops the link A brings, so it is re-cut with the link before you can choose it.",
    });
    expect(card.what!.whole).toContain("Codex's draft drops the link A brings as its receipt.");
    expect(postCard({ post }).what!.whole).not.toContain("drops the link");
  });

  it("asks the plain send question once there is nothing to choose", () => {
    expect(postCard({ post: { ...post, choice: undefined } }).question).toBe("Post this as you?");
  });

  it("says B has not arrived on a pending row, and only there", () => {
    const owed = "Codex's draft beside this one has not arrived yet, and this one is not sent before both are shown.";
    expect(postCard({ post: { ...post, choice: undefined, codexOwed: true } }).what!.whole).toContain(owed);
    expect(postCard({ post: { ...post, choice: undefined, codexOwed: false } }).what!.whole).not.toContain(owed);
  });
});
