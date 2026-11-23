/**
 * `draftComparisonLine.ts` — a register line about a Codex comparison reads only when every field is one this version
 * can vouch for, so an older seat hides a row whose pick it cannot see rather than drawing it sendable.
 */
import { describe, expect, it } from "vitest";

import { comparisonEventOf, parkedComparisonValid } from "../../../../outbound/slack/draftComparisonLine.js";

const AT = "2026-10-09T11:08:00.000Z";

/** The version stamp the writer puts on every line. */
const V1 = { schemaVersion: 1 };

/** A rich drip payload: its one `rich_text` block, as `dripRender` builds it. */
const RICH = {
  blocks: [
    { elements: [{ elements: [{ text: "codex words", type: "text" }], type: "rich_text_section" }], type: "rich_text" },
  ],
  form: "rich",
  text: "codex words",
  unfurl_links: true,
  unfurl_media: true,
};

const CANDIDATE = { advisory: [], digest: "digest of codex words", form: "{}", mentions: [], payload: RICH };

/** A whole plain payload: what a hand-written line carries, never a pass. */
const PLAIN = { form: "plain", text: "See <https://example.com|docs>", unfurl_links: false, unfurl_media: false };

describe("parkedComparisonValid", () => {
  it("reads a park with neither field, a known composer, a pending or a known skip", () => {
    expect(parkedComparisonValid({ value: {} })).toBe(true);
    expect(parkedComparisonValid({ value: { composer: "claude-code", comparison: { state: "pending" } } })).toBe(true);
    const media = [{ name: "shot.png" }];
    expect(parkedComparisonValid({ value: { comparison: { reason: "has-media", state: "skipped" }, media } })).toBe(
      true,
    );
  });

  it("refuses an unknown composer, state or skip reason, and a pending carrying more", () => {
    expect(parkedComparisonValid({ value: { composer: "gemini" } })).toBe(false);
    expect(parkedComparisonValid({ value: { comparison: { state: "queued" } } })).toBe(false);
    expect(parkedComparisonValid({ value: { comparison: { reason: "bored", state: "skipped" } } })).toBe(false);
    expect(parkedComparisonValid({ value: { comparison: { reason: "x", state: "pending" } } })).toBe(false);
    expect(parkedComparisonValid({ value: { comparison: "pending" } })).toBe(false);
    // A skip carrying a field beside its reason is a meaning this version would drop.
    const extra = { futureMeaning: "must-not-send-A", reason: "has-media", state: "skipped" };
    expect(parkedComparisonValid({ value: { comparison: extra } })).toBe(false);
  });

  it("refuses a comparison on a bot row, which never owes one", () => {
    expect(parkedComparisonValid({ value: { actor: "bot", comparison: { state: "pending" } } })).toBe(false);
    expect(parkedComparisonValid({ value: { actor: "bot" } })).toBe(true);
  });

  it("refuses a pending comparison on a park approved at record, which owes a pick nothing can make", () => {
    const approval = { anchor: "slack:C0ME/1790000000.000100", atIso: "2026-10-09T11:06:00.000Z" };
    expect(parkedComparisonValid({ value: { approval, comparison: { state: "pending" } } })).toBe(false);
    const skipped = { reason: "approved-at-record", state: "skipped" };
    expect(parkedComparisonValid({ value: { approval, comparison: skipped } })).toBe(true);
  });

  it("reads a skip only when the row carries its reason, else it frees A from a pick it owes", () => {
    const skip = ({ reason }: { reason: string }): unknown => ({ reason, state: "skipped" });
    const media = [{ name: "shot.png" }];
    expect(parkedComparisonValid({ value: { comparison: skip({ reason: "has-media" }), media } })).toBe(true);
    expect(parkedComparisonValid({ value: { comparison: skip({ reason: "has-media" }) } })).toBe(false);
    expect(parkedComparisonValid({ value: { comparison: skip({ reason: "has-media" }), media: [] } })).toBe(false);
    const codex = { comparison: skip({ reason: "composed-by-codex" }), composer: "codex" };
    expect(parkedComparisonValid({ value: codex })).toBe(true);
    const claude = { comparison: skip({ reason: "composed-by-codex" }), composer: "claude-code" };
    expect(parkedComparisonValid({ value: claude })).toBe(false);
    expect(parkedComparisonValid({ value: { comparison: skip({ reason: "approved-at-record" }) } })).toBe(false);
    // A row that owes no pass is never pending either.
    expect(parkedComparisonValid({ value: { comparison: { state: "pending" }, media } })).toBe(false);
  });

  it("reads a declared reviewer and refuses one this version does not know", () => {
    expect(parkedComparisonValid({ value: { reviewer: "in-thread" } })).toBe(true);
    expect(parkedComparisonValid({ value: { reviewer: "approved" } })).toBe(false);
  });
});

describe("comparisonEventOf", () => {
  it("reads each compared outcome", () => {
    const ready = { candidate: CANDIDATE, elapsedMs: 4200, requestedModel: "gpt-test", state: "ready" };
    expect(comparisonEventOf({ id: "sd-1", tsIso: AT, value: { ...V1, kind: "compared", outcome: ready } })).toEqual({
      id: "sd-1",
      kind: "compared",
      outcome: ready,
      tsIso: AT,
    });
    const refused = { reasons: ["banned word: of"], stage: "voice-rules", state: "refused" };
    expect(
      comparisonEventOf({ id: "sd-1", tsIso: AT, value: { ...V1, kind: "compared", outcome: refused } })!.kind,
    ).toBe("compared");
    const unavailable = { reason: "capped", state: "unavailable" };
    expect(
      comparisonEventOf({ id: "sd-1", tsIso: AT, value: { ...V1, kind: "compared", outcome: unavailable } }),
    ).toEqual({
      id: "sd-1",
      kind: "compared",
      outcome: unavailable,
      tsIso: AT,
    });
  });

  it("reads a tag only with the mention naming it, else the card draws a raw id", () => {
    const tagged = ({ type, key }: { type: string; key: string }): unknown => ({
      ...RICH,
      blocks: [
        {
          elements: [
            {
              elements: [
                { text: "hi ", type: "text" },
                { type, [key]: "S0OPS" },
              ],
              type: "rich_text_section",
            },
          ],
          type: "rich_text",
        },
      ],
    });
    const outcomeOf = ({ mentions, payload }: { mentions: readonly unknown[]; payload: unknown }): unknown => ({
      candidate: { ...CANDIDATE, mentions, payload },
      elapsedMs: 4200,
      requestedModel: "gpt-test",
      state: "ready",
    });
    const group = tagged({ key: "usergroup_id", type: "usergroup" });
    const named = [{ key: "@ops", kind: "group", target: "S0OPS" }];
    const read = ({ outcome }: { outcome: unknown }): ReturnType<typeof comparisonEventOf> =>
      comparisonEventOf({ id: "sd-1", tsIso: AT, value: { ...V1, kind: "compared", outcome } });
    expect(read({ outcome: outcomeOf({ mentions: named, payload: group }) })!.kind).toBe("compared");
    expect(read({ outcome: outcomeOf({ mentions: [], payload: group }) })).toBe(undefined);
    const otherGroup = [{ key: "@eng", kind: "group", target: "S0ENG" }];
    expect(read({ outcome: outcomeOf({ mentions: otherGroup, payload: group }) })).toBe(undefined);
  });

  it("refuses a ready outcome missing its model, a fractional elapsed, or a candidate a pick could not send", () => {
    const base = { candidate: CANDIDATE, elapsedMs: 4200, requestedModel: "gpt-test", state: "ready" };
    const faults = [
      { ...base, requestedModel: "" },
      { ...base, elapsedMs: 1.5 },
      { ...base, candidate: { ...CANDIDATE, digest: undefined } },
      { ...base, candidate: { ...CANDIDATE, mentions: [7] } },
      { ...base, candidate: { ...CANDIDATE, mentions: [{ key: "@seth", kind: "channel", target: "U0SETH" }] } },
      { ...base, candidate: { ...CANDIDATE, mentions: [{ key: "", kind: "person", target: "U0SETH" }] } },
      { ...base, candidate: { ...CANDIDATE, mentions: [{ key: "@ops", kind: "group", target: "U0SETH" }] } },
      { ...base, candidate: { ...CANDIDATE, mentions: [{ key: "@seth", kind: "person", target: "S0OPS" }] } },
      { ...base, candidate: { ...CANDIDATE, mentions: [{ key: "@seth", kind: "constructor", target: "U0SETH" }] } },
      { ...base, candidate: { ...CANDIDATE, payload: { form: "plain" } } },
      { ...base, candidate: { ...CANDIDATE, payload: { form: "rich", text: "fallback only" } } },
      { ...base, candidate: { ...CANDIDATE, payload: { form: "plain", text: "B" } } },
      { ...base, candidate: { ...CANDIDATE, payload: { ...RICH, blocks: [{ type: "section" }] } } },
      { ...base, candidate: { ...CANDIDATE, payload: { ...RICH, blocks: [{ elements: [7], type: "rich_text" }] } } },
      { ...base, candidate: { ...CANDIDATE, payload: { ...RICH, blocks: [RICH.blocks[0], RICH.blocks[0]] } } },
      { ...base, candidate: { ...CANDIDATE, payload: { ...PLAIN, blocks: RICH.blocks } } },
      // A key the payload does not declare: the console would draw `attachments` as a card.
      { ...base, candidate: { ...CANDIDATE, payload: { ...RICH, attachments: [] } } },
      // A whole plain arm: no pass renders one, and Slack reads its text as markup the card draws literally.
      { ...base, candidate: { ...CANDIDATE, payload: PLAIN } },
      // A blank B: an empty block, or a fallback with no words.
      { ...base, candidate: { ...CANDIDATE, payload: { ...RICH, blocks: [{ elements: [], type: "rich_text" }] } } },
      { ...base, candidate: { ...CANDIDATE, payload: { ...RICH, text: "  " } } },
      { ...base, candidate: { ...CANDIDATE, payload: { ...RICH, unfurl_links: false } } },
      { ...base, candidate: { ...CANDIDATE, payload: { ...RICH, unfurl_media: false } } },
      { reason: "  ", state: "unavailable" },
      { reasons: [1], stage: "voice-rules", state: "refused" },
      // A refusal naming no reason.
      { reasons: [], stage: "voice-rules", state: "refused" },
      { reasons: ["  "], stage: "admission", state: "refused" },
      // A key the state does not declare, which the fold would drop.
      { candidate: { payload: { attachments: [] } }, reason: "capped", state: "unavailable" },
      { reasons: ["x"], stage: "voice-rules", state: "refused", why: "x" },
      { ...base, note: "extra" },
      { ...base, candidate: { ...CANDIDATE, extra: 1 } },
      {
        ...base,
        candidate: { ...CANDIDATE, mentions: [{ key: "@seth", kind: "person", label: "Seth", target: "U0SETH" }] },
      },
    ];
    expect(
      faults.map((outcome) =>
        comparisonEventOf({ id: "sd-1", tsIso: AT, value: { ...V1, kind: "compared", outcome } }),
      ),
    ).toEqual(faults.map(() => undefined));
  });

  it("reads a whole rich candidate", () => {
    const outcome = {
      candidate: { ...CANDIDATE, payload: RICH },
      elapsedMs: 1,
      requestedModel: "gpt-test",
      state: "ready",
    };
    expect(comparisonEventOf({ id: "sd-1", tsIso: AT, value: { ...V1, kind: "compared", outcome } })).toEqual({
      id: "sd-1",
      kind: "compared",
      outcome,
      tsIso: AT,
    });
  });

  it("reads a candidate whose mentions are whole", () => {
    const mentions = [
      { key: "@seth", kind: "person", target: "U0SETH" },
      { key: "@ops", kind: "group", target: "S0OPS" },
    ];
    const outcome = { candidate: { ...CANDIDATE, mentions }, elapsedMs: 1, requestedModel: "gpt-test", state: "ready" };
    expect(comparisonEventOf({ id: "sd-1", tsIso: AT, value: { ...V1, kind: "compared", outcome } })).toEqual({
      id: "sd-1",
      kind: "compared",
      outcome,
      tsIso: AT,
    });
  });

  it("reads a pick, with or without a whole voice anchor", () => {
    expect(comparisonEventOf({ id: "sd-1", tsIso: AT, value: { ...V1, kind: "picked", variant: "codex" } })).toEqual({
      id: "sd-1",
      kind: "picked",
      tsIso: AT,
      variant: "codex",
    });
    const voice = { anchor: "talk:abc#t1", atIso: AT, heard: "the second one" };
    expect(
      comparisonEventOf({ id: "sd-1", tsIso: AT, value: { ...V1, kind: "picked", variant: "original", voice } }),
    ).toEqual({
      id: "sd-1",
      kind: "picked",
      tsIso: AT,
      variant: "original",
      voice,
    });
  });

  it("refuses an unknown variant, a partial voice, a bad instant, and any other kind", () => {
    expect(
      comparisonEventOf({ id: "sd-1", tsIso: AT, value: { ...V1, kind: "picked", variant: "both" } }),
    ).toBeUndefined();
    const partial = { anchor: "talk:abc#t1", atIso: AT };
    expect(
      comparisonEventOf({ id: "sd-1", tsIso: AT, value: { ...V1, kind: "picked", variant: "codex", voice: partial } }),
    ).toBeUndefined();
    expect(
      comparisonEventOf({ id: "sd-1", tsIso: "yesterday", value: { ...V1, kind: "picked", variant: "codex" } }),
    ).toBeUndefined();
    expect(comparisonEventOf({ id: "sd-1", tsIso: AT, value: { ...V1, kind: "released" } })).toBeUndefined();
  });

  it("reads the envelope the writer emits and refuses any other key on it", () => {
    const envelope = { id: "sd-1", schemaVersion: 1, tsIso: AT };
    const picked = { ...envelope, kind: "picked", variant: "codex" };
    expect(comparisonEventOf({ id: "sd-1", tsIso: AT, value: picked })!.kind).toBe("picked");
    expect(
      comparisonEventOf({ id: "sd-1", tsIso: AT, value: { ...picked, futureMeaning: "do-not-apply" } }),
    ).toBeUndefined();
    const outcome = { reason: "capped", state: "unavailable" };
    expect(
      comparisonEventOf({ id: "sd-1", tsIso: AT, value: { ...envelope, kind: "compared", note: "x", outcome } }),
    ).toBeUndefined();
    // A line at another version, or none, is a vocabulary this build cannot vouch for.
    const compared = { ...envelope, kind: "compared", outcome };
    expect(comparisonEventOf({ id: "sd-1", tsIso: AT, value: compared })!.kind).toBe("compared");
    expect(comparisonEventOf({ id: "sd-1", tsIso: AT, value: { ...compared, schemaVersion: 2 } })).toBeUndefined();
    const { schemaVersion: _dropped, ...unversioned } = compared;
    expect(comparisonEventOf({ id: "sd-1", tsIso: AT, value: unversioned })).toBeUndefined();
  });

  it("refuses a kind or state naming a prototype property rather than throwing", () => {
    const names = ["constructor", "toString", "__proto__", "hasOwnProperty"];
    expect(names.map((name) => comparisonEventOf({ id: "sd-1", tsIso: AT, value: { ...V1, kind: name } }))).toEqual(
      names.map(() => undefined),
    );
    expect(
      names.map((state) =>
        comparisonEventOf({ id: "sd-1", tsIso: AT, value: { ...V1, kind: "compared", outcome: { state } } }),
      ),
    ).toEqual(names.map(() => undefined));
  });
});
