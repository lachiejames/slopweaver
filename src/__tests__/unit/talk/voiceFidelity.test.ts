/**
 * `src/talk/voiceFidelity.ts` over synthetic calls: a qualifier moved
 * from an option's trade-off into the problem, a time phrase added, and a merge of two handed sentences that must NOT
 * read as a move.
 */
import { describe, expect, it } from "vitest";

import { type CallEntry, callEntryOf, foldCall } from "../../../talk/callRecord.js";
import { voiceFidelityReport } from "../../../talk/voiceFidelity.js";
import { contentWords, divergence } from "../../../talk/wordDivergence.js";

const CALL = "a0000075-0000-4000-8000-000000000082";

const HANDED =
  "Take a published page: uploading it needs a service key, and the current code expects that in another local secret file. " +
  "Option A reads the key off the running stack, which exposes the powerful key to the uploading process.";

/** One call's lines, folded the way the store folds them. */
function callOf({ lines }: { lines: readonly Record<string, unknown>[] }): NonNullable<ReturnType<typeof foldCall>> {
  const entries = lines
    .map((value) => callEntryOf({ value }))
    .filter((entry): entry is CallEntry => entry !== undefined);
  return foldCall({ callId: CALL, entries, skipped: 0 })!;
}

/** A segment line. */
function segment({
  at,
  id,
  text,
  who,
}: {
  at: string;
  id: string;
  text: string;
  who: "owner" | "voice";
}): Record<string, unknown> {
  return { atIso: at, beganIso: at, final: true, id, kind: "segment", text, who };
}

const OPEN = {
  atIso: "2026-11-01T03:00:00.000Z",
  kind: "open",
  model: "realtime-v3",
  sessionId: "s-1",
  voice: "spruce",
};

describe("contentWords", () => {
  it("lowercases, drops glue and short words, and folds a plural or possessive s", () => {
    expect(contentWords({ text: "The card's Option needs keys, and it is now." })).toEqual([
      "card",
      "option",
      "need",
      "key",
      "now",
    ]);
  });

  it("drops a possessive pronoun as glue, whichever person it names", () => {
    // A spoken word, spelled through a pattern's source: the owner-pronoun gate reads a pattern as speech, which it is.
    const possessive = /his/u.source;
    expect(contentWords({ text: `${possessive} review and her review` })).toEqual(["review", "review"]);
  });

  it("reads nothing out of an empty text", () => {
    expect(contentWords({ text: "" })).toEqual([]);
  });
});

describe("divergence", () => {
  it("names the P0 shape: 'powerful' moved from the option into the problem, 'right now' added", () => {
    const spoken = "Right now, if you take a published page, uploading it needs a powerful service key.";
    expect(divergence({ handed: HANDED, spoken })).toEqual({ added: ["right", "now"], relocated: ["powerful"] });
  });

  it("does not read a merge of two handed sentences as a move", () => {
    const spoken =
      "Uploading it needs a service key, and option A reads the key off the running stack, exposing it to the uploading process.";
    expect(divergence({ handed: HANDED, spoken })).toEqual({ added: ["exposing"], relocated: [] });
  });

  it("finds nothing in a faithful restatement", () => {
    const spoken =
      "Uploading a published page needs a service key, and the current code expects it in another local secret file.";
    expect(divergence({ handed: HANDED, spoken })).toEqual({ added: [], relocated: [] });
  });

  it("reads a judgement the answer never made as added", () => {
    const spoken = "I think that's a gap in the current proposal.";
    expect(divergence({ handed: HANDED, spoken }).added).toEqual(["think", "gap", "proposal"]);
  });
});

describe("voiceFidelityReport", () => {
  const lines = [
    OPEN,
    { atIso: "2026-11-01T03:01:00.000Z", itemId: "msg-1", kind: "wrote", text: HANDED, turnId: "turn-1" },
    segment({
      at: "2026-11-01T03:01:01.000Z",
      id: "seg-v1",
      text: "Right now, if you take a published page, uploading it needs a powerful service key.",
      who: "voice",
    }),
    segment({ at: "2026-11-01T03:01:20.000Z", id: "seg-h1", text: "How could a page need that?", who: "owner" }),
    segment({
      at: "2026-11-01T03:01:25.000Z",
      id: "seg-v2",
      text: "Something unrelated after the owner's words.",
      who: "voice",
    }),
    {
      atIso: "2026-11-01T03:02:00.000Z",
      itemId: "msg-2",
      kind: "wrote",
      text: "The card does not say.",
      turnId: "turn-2",
    },
    {
      atIso: "2026-11-01T03:03:00.000Z",
      itemId: "msg-3",
      kind: "wrote",
      text: "Nothing voiced this.",
      turnId: "turn-3",
    },
    segment({ at: "2026-11-01T03:02:01.000Z", id: "seg-v3", text: "The card does not say.", who: "voice" }),
  ];
  const report = voiceFidelityReport({
    calls: [callOf({ lines })],
    sinceIso: "2026-11-01T00:00:00.000Z",
    untilIso: "2026-11-02T00:00:00.000Z",
  });

  it("pairs each message with the voice segments that began before the owner's next words or the next message", () => {
    expect(report.pairs.map((pair) => [pair.itemId, pair.anchor, pair.spoken])).toEqual([
      [
        "msg-1",
        `talk-call:${CALL}#seg-v1`,
        "Right now, if you take a published page, uploading it needs a powerful service key.",
      ],
      ["msg-2", `talk-call:${CALL}#seg-v3`, "The card does not say."],
    ]);
  });

  it("counts the day: two pairs, one with an addition and a move", () => {
    expect(report.days).toEqual([
      {
        addedWords: 2,
        day: "2026-11-01",
        pairs: 2,
        pairsWithAdded: 1,
        pairsWithRelocated: 1,
        relocatedWords: 1,
        // right, now, take, published, page, uploading, need, powerful, service, key; then card, not.
        spokenWords: 12,
      },
    ]);
  });

  it("names the message nothing voiced as a gap, never a clean pair", () => {
    expect(report.gaps.map((gap) => gap.kind)).toEqual(["unvoiced"]);
  });

  it("names a voice call with no written message on file", () => {
    const old = voiceFidelityReport({
      calls: [
        callOf({ lines: [OPEN, segment({ at: "2026-11-01T03:01:01.000Z", id: "v", text: "Hi.", who: "voice" })] }),
      ],
      sinceIso: "2026-11-01T00:00:00.000Z",
      untilIso: "2026-11-02T00:00:00.000Z",
    });
    expect(old.gaps.map((gap) => gap.kind)).toEqual(["no-written-record"]);
    expect(old.pairs).toEqual([]);
  });

  it("counts nothing written outside the window", () => {
    const outside = voiceFidelityReport({
      calls: [callOf({ lines })],
      sinceIso: "2026-11-02T00:00:00.000Z",
      untilIso: "2026-11-03T00:00:00.000Z",
    });
    expect(outside.pairs).toEqual([]);
    expect(outside.voiceCalls).toBe(1);
  });

  it("gives a segment to the later of two messages written at one instant, never to both", () => {
    const at = "2026-11-01T03:05:00.000Z";
    const tied = voiceFidelityReport({
      calls: [
        callOf({
          lines: [
            OPEN,
            { atIso: at, itemId: "msg-a", kind: "wrote", text: "Alpha.", turnId: "turn-a" },
            { atIso: at, itemId: "msg-b", kind: "wrote", text: "Beta.", turnId: "turn-b" },
            segment({ at: "2026-11-01T03:05:00.001Z", id: "seg-b", text: "Beta.", who: "voice" }),
          ],
        }),
      ],
      sinceIso: "2026-11-01T00:00:00.000Z",
      untilIso: "2026-11-02T00:00:00.000Z",
    });
    expect(tied.pairs.map((pair) => [pair.itemId, pair.spoken])).toEqual([["msg-b", "Beta."]]);
    expect(tied.gaps.map((gap) => gap.kind)).toEqual(["unvoiced"]);
  });

  it("stops at the owner's words even when they begin the same millisecond the message was written", () => {
    const at = "2026-11-01T03:06:00.000Z";
    const interrupted = voiceFidelityReport({
      calls: [
        callOf({
          lines: [
            OPEN,
            { atIso: at, itemId: "msg-c", kind: "wrote", text: "Gamma.", turnId: "turn-c" },
            segment({ at, id: "seg-h", text: "Wait, stop.", who: "owner" }),
            segment({ at: "2026-11-01T03:06:01.000Z", id: "seg-v", text: "Sure, stopping.", who: "voice" }),
          ],
        }),
      ],
      sinceIso: "2026-11-01T00:00:00.000Z",
      untilIso: "2026-11-02T00:00:00.000Z",
    });
    expect(interrupted.pairs).toEqual([]);
    expect(interrupted.gaps.map((gap) => gap.kind)).toEqual(["unvoiced"]);
  });

  it("counts no call whose open line did not parse, since a torn typed open would read as voice", () => {
    const torn = voiceFidelityReport({
      calls: [
        callOf({
          lines: [
            { atIso: "2026-11-01T03:08:00.000Z", itemId: "msg-e", kind: "wrote", text: "Epsilon.", turnId: "turn-e" },
            segment({ at: "2026-11-01T03:08:01.000Z", id: "seg-v", text: "Epsilon.", who: "voice" }),
          ],
        }),
      ],
      sinceIso: "2026-11-01T00:00:00.000Z",
      untilIso: "2026-11-02T00:00:00.000Z",
    });
    expect([torn.voiceCalls, torn.pairs]).toEqual([0, []]);
    expect(torn.gaps.map((gap) => gap.kind)).toEqual(["unknown-surface"]);
  });

  it("stops at the owner's words that were never written final", () => {
    const cut = voiceFidelityReport({
      calls: [
        callOf({
          lines: [
            OPEN,
            { atIso: "2026-11-01T03:07:00.000Z", itemId: "msg-d", kind: "wrote", text: "Delta.", turnId: "turn-d" },
            {
              ...segment({ at: "2026-11-01T03:07:01.000Z", id: "seg-h", text: "No, stop", who: "owner" }),
              final: false,
            },
            segment({ at: "2026-11-01T03:07:02.000Z", id: "seg-v", text: "Later response.", who: "voice" }),
          ],
        }),
      ],
      sinceIso: "2026-11-01T00:00:00.000Z",
      untilIso: "2026-11-02T00:00:00.000Z",
    });
    expect(cut.pairs).toEqual([]);
    expect(cut.gaps.map((gap) => gap.kind)).toEqual(["unvoiced"]);
  });
});
