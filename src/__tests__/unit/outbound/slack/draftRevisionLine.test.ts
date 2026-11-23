/**
 * `draftRevisionLine.ts` — a `revised` register line reads only when every field is one this version can vouch for, so
 * an older seat hides a row whose revised words it cannot read rather than drawing them sendable.
 */
import { describe, expect, it } from "vitest";

import { revisedEventOf } from "../../../../outbound/slack/draftRevisionLine.js";

const AT = "2026-10-04T04:34:00.000Z";

/** A rich drip payload: its one `rich_text` block, as `dripRender` builds it. */
const RICH = {
  blocks: [
    {
      elements: [{ elements: [{ text: "warmer words", type: "text" }], type: "rich_text_section" }],
      type: "rich_text",
    },
  ],
  form: "rich",
  text: "warmer words",
  unfurl_links: true,
  unfurl_media: true,
};

const WORDS = { advisory: [], digest: "digest of warmer words", form: "{}", mentions: [], payload: RICH };

/** A whole `revised` line, with any field replaced. */
function line({ over = {} }: { over?: Record<string, unknown> } = {}): Record<string, unknown> {
  return {
    anchor: "talk-call:bc09d7f2#turn_A",
    heard: "make it warmer",
    id: "sd-11112222",
    kind: "revised",
    reading: ["Warmer opening"],
    schemaVersion: 1,
    tsIso: AT,
    version: 2,
    words: WORDS,
    ...over,
  };
}

describe("revisedEventOf", () => {
  // Strict: a restore compares these words whole against the version it names, so reading them back
  // adds no key, not even an undefined one.
  it("reads a whole line into its event, its words exactly as written", () => {
    expect(revisedEventOf({ id: "sd-11112222", tsIso: AT, value: line() })).toStrictEqual({
      anchor: "talk-call:bc09d7f2#turn_A",
      heard: "make it warmer",
      id: "sd-11112222",
      kind: "revised",
      reading: ["Warmer opening"],
      tsIso: AT,
      version: 2,
      words: WORDS,
    });
  });

  it("reads a restore, which names the earlier version it put back", () => {
    const event = revisedEventOf({
      id: "sd-11112222",
      tsIso: AT,
      value: line({ over: { restoredFrom: 1, version: 3 } }),
    });
    expect(event).toEqual(expect.objectContaining({ restoredFrom: 1, version: 3 }));
  });

  it("passes over a field it does not know, a version below two and a restore of itself", () => {
    const read = (over: Record<string, unknown>): unknown =>
      revisedEventOf({ id: "sd-1", tsIso: AT, value: line({ over }) });
    expect(read({ sendNow: true })).toBeUndefined();
    expect(read({ version: 1 })).toBeUndefined();
    expect(read({ version: 2.5 })).toBeUndefined();
    expect(read({ restoredFrom: 2 })).toBeUndefined();
    expect(read({ schemaVersion: 2 })).toBeUndefined();
  });

  it("passes over words that are not whole, and a reading that is empty, too long or blank", () => {
    const read = (over: Record<string, unknown>): unknown =>
      revisedEventOf({ id: "sd-1", tsIso: AT, value: line({ over }) });
    expect(read({ words: { ...WORDS, payload: { ...RICH, unfurl_links: false } } })).toBeUndefined();
    expect(read({ words: { ...WORDS, extra: 1 } })).toBeUndefined();
    expect(read({ reading: [] })).toBeUndefined();
    expect(read({ reading: ["a", "b", "c", "d", "e", "f"] })).toBeUndefined();
    expect(read({ reading: ["  "] })).toBeUndefined();
    expect(read({ heard: "x".repeat(601) })).toBeUndefined();
  });

  it("reads receipts of a parked shape, and passes over any other", () => {
    const words = ({ receipts }: { receipts: unknown }): unknown =>
      revisedEventOf({ id: "sd-1", tsIso: AT, value: line({ over: { words: { ...WORDS, receipts } } }) });
    const attached = { kind: "attached", links: ["https://x.test/a"], media: 0 };
    expect(words({ receipts: attached })).toEqual(expect.objectContaining({ words: { ...WORDS, receipts: attached } }));
    expect(words({ receipts: { kind: "self-evident", why: "a question" } })).toEqual(
      expect.objectContaining({ version: 2 }),
    );
    expect(words({ receipts: { kind: "bogus" } })).toBeUndefined();
    expect(words({ receipts: { kind: "attached", links: [1], media: 0 } })).toBeUndefined();
    expect(words({ receipts: { kind: "tried" } })).toBeUndefined();
  });

  it("passes over receipts with a key or a blank reason the fold would refuse, so the row hides", () => {
    const words = ({ receipts }: { receipts: unknown }): unknown =>
      revisedEventOf({ id: "sd-1", tsIso: AT, value: line({ over: { words: { ...WORDS, receipts } } }) });
    expect(words({ receipts: { extra: true, kind: "self-evident", why: "the message is evidence" } })).toBeUndefined();
    expect(words({ receipts: { extra: 1, kind: "attached", links: [], media: 1 } })).toBeUndefined();
    expect(words({ receipts: { kind: "self-evident", why: "  " } })).toBeUndefined();
    expect(words({ receipts: { kind: "attached", links: [], media: 1, tried: "" } })).toBeUndefined();
    expect(words({ receipts: { kind: "attached", links: [], media: 1, tried: "the console" } })).toEqual(
      expect.objectContaining({ version: 2 }),
    );
  });

  it("passes over a line journalled at no real instant", () => {
    expect(revisedEventOf({ id: "sd-1", tsIso: "yesterday", value: line() })).toBeUndefined();
  });
});
