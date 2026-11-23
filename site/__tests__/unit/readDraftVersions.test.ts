/*
 * `readDraftVersions.ts` — a revised draft's history reads only when it is numbered from the words the owner first saw, so a
 * card never draws a v1 that is not the original.
 */
import { describe, expect, it } from "vitest";

import { type DraftVersionView, draftRevisionOf, versionLine } from "../../components/live/readDraftVersions";

const V1 = { atIso: "2026-10-04T04:30:00.000Z", digest: "d1", number: 1, text: "Can you look?" };
const V2 = {
  anchor: "talk-call:bc09d7f2#turn_A",
  atIso: "2026-10-04T04:34:00.000Z",
  digest: "d2",
  heard: "make it warmer",
  number: 2,
  reading: ["Warmer opening"],
  text: "Hey, could you look?",
};

describe("draftRevisionOf", () => {
  it("reads a never-revised row as its editable words and no history", () => {
    expect(draftRevisionOf({ item: { editableText: "Can you look?" } })).toEqual({
      editableText: "Can you look?",
      versions: undefined,
    });
    expect(draftRevisionOf({ item: {} })).toEqual({ editableText: undefined, versions: undefined });
  });

  it("reads a revised row's versions oldest first", () => {
    const view = draftRevisionOf({ item: { editableText: "Hey, could you look?", versions: [V1, V2] } });
    expect(view).toEqual({
      editableText: "Hey, could you look?",
      versions: [
        {
          atIso: V1.atIso,
          heard: undefined,
          number: 1,
          reading: undefined,
          restoredFrom: undefined,
          text: "Can you look?",
        },
        {
          atIso: V2.atIso,
          heard: "make it warmer",
          number: 2,
          reading: ["Warmer opening"],
          restoredFrom: undefined,
          text: "Hey, could you look?",
        },
      ],
    });
  });

  it("refuses a history of one, one out of order, an unknown key and a restore of a later version", () => {
    expect(draftRevisionOf({ item: { versions: [V1] } })).toBe("malformed");
    expect(draftRevisionOf({ item: { versions: [V2, V1] } })).toBe("malformed");
    expect(draftRevisionOf({ item: { versions: [V1, { ...V2, sendNow: true }] } })).toBe("malformed");
    expect(draftRevisionOf({ item: { versions: [V1, { ...V2, restoredFrom: 2 }] } })).toBe("malformed");
    expect(draftRevisionOf({ item: { editableText: 7 } })).toBe("malformed");
    // The register refuses a fractional restore, so the card must too.
    const fractional = { atIso: V2.atIso, number: 3, restoredFrom: 1.5, text: "three" };
    expect(draftRevisionOf({ item: { versions: [V1, V2, fractional] } })).toBe("malformed");
  });
});

describe("versionLine", () => {
  /** One version view, numbered. */
  const view = ({ number, restoredFrom }: { number: number; restoredFrom?: number }): DraftVersionView => ({
    atIso: V1.atIso,
    heard: undefined,
    number,
    reading: undefined,
    restoredFrom,
    text: "words",
  });

  it("says which version the card reads as and that the earlier ones are kept", () => {
    expect(versionLine({ versions: [view({ number: 1 }), view({ number: 2 })] })).toBe("v2 · v1 kept");
  });

  it("names a put-back version", () => {
    const versions = [view({ number: 1 }), view({ number: 2 }), view({ number: 3, restoredFrom: 1 })];
    expect(versionLine({ versions })).toBe("v3 (v1 put back) · v1 to v2 kept");
  });
});
