/**
 * `draftReviseRun.ts`'s pure halves: a rewrite never reaches a room the parked words did not,
 * and its receipts follow its links.
 */
import { describe, expect, it } from "vitest";

import { addedReach, revisedReceipts, revisionLineReads } from "../../../../../cli/commands/slack/draftReviseRun.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { DraftRevisedEvent } from "../../../../../outbound/slack/draftRevision.js";

/** A rich payload carrying these inline elements. */
function payload({ elements }: { elements: readonly Record<string, unknown>[] }): unknown {
  return { blocks: [{ elements: [{ elements, type: "rich_text_section" }], type: "rich_text" }], form: "rich" };
}

const PLAIN = payload({ elements: [{ text: "Please review this", type: "text" }] });
const HERE = payload({
  elements: [
    { range: "here", type: "broadcast" },
    { text: " Please review", type: "text" },
  ],
});

const TAGGED = payload({
  elements: [
    { type: "user", user_id: "U1" },
    { text: " and ", type: "text" },
    { type: "usergroup", usergroup_id: "S1" },
  ],
});

describe("addedReach", () => {
  it("names a broadcast or a tag the rewrite adds", () => {
    expect(addedReach({ original: PLAIN, revised: HERE })).toEqual(["@here"]);
    const both = payload({
      elements: [
        { range: "channel", type: "broadcast" },
        { range: "here", type: "broadcast" },
      ],
    });
    expect(addedReach({ original: PLAIN, revised: both })).toEqual(["@channel", "@here"]);
    expect(addedReach({ original: PLAIN, revised: TAGGED })).toEqual(["group:S1", "person:U1"]);
  });

  it("names one the rewrite repeats, since each drip message posts on its own", () => {
    const drip = { messages: [HERE, HERE, TAGGED, TAGGED] };
    expect(addedReach({ original: { messages: [HERE, TAGGED] }, revised: drip })).toEqual([
      "@here",
      "group:S1",
      "person:U1",
    ]);
  });

  it("allows one the parked words already carried, as often, and one dropped", () => {
    expect(addedReach({ original: HERE, revised: HERE })).toEqual([]);
    expect(addedReach({ original: HERE, revised: PLAIN })).toEqual([]);
    expect(addedReach({ original: { messages: [TAGGED, TAGGED] }, revised: TAGGED })).toEqual([]);
  });
});

describe("revisedReceipts", () => {
  const link = payload({ elements: [{ text: "x", type: "link", url: "https://example.com/pr/1" }] });

  it("derives attached receipts from a link in the rewrite", () => {
    expect(unwrap(revisedReceipts({ files: 0, original: undefined, payload: link }))).toEqual(
      expect.objectContaining({ kind: "attached", media: 0 }),
    );
  });

  it("refuses a rewrite that drops the only link the row brought as its receipt", () => {
    const original = { kind: "attached" as const, links: ["https://example.com/pr/1"], media: 0 };
    expect(unwrapErr(revisedReceipts({ files: 0, original, payload: PLAIN })).code).toBe("RECEIPT_DROPPED");
  });

  it("keeps the row's own declaration when neither had a link", () => {
    expect(unwrap(revisedReceipts({ files: 0, original: undefined, payload: PLAIN }))).toBeUndefined();
  });
});

describe("revisionLineReads", () => {
  const rich: DraftRevisedEvent["words"]["payload"] = {
    blocks: [
      {
        elements: [{ elements: [{ text: "Can you look?", type: "text" }], type: "rich_text_section" }],
        type: "rich_text",
      },
    ],
    form: "rich",
    text: "Can you look?",
    unfurl_links: true,
    unfurl_media: true,
  };
  const event = ({ words }: { words: DraftRevisedEvent["words"]["payload"] }): DraftRevisedEvent => ({
    id: "sd-c57b4ade",
    kind: "revised",
    restoredFrom: 1,
    tsIso: "2026-10-04T04:34:00.000Z",
    version: 3,
    words: { advisory: [], digest: "digest of v1", form: "{}", mentions: [], payload: words },
  });

  it("reads back a restore of rich words", () => {
    expect(revisionLineReads({ event: event({ words: rich }) })).toBe(true);
  });

  it("refuses a restore of a v1 parked plain, which the register would hide the row over", () => {
    const plain: DraftRevisedEvent["words"]["payload"] = {
      form: "plain",
      text: "Can you look?",
      unfurl_links: false,
      unfurl_media: false,
    };
    expect(revisionLineReads({ event: event({ words: plain }) })).toBe(false);
  });
});
