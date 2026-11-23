/**
 * The roster scrub that runs between admission and projection.
 *
 * Two properties carry the weight here. The COUNT is decremented rather than assigned the survivors'
 * length, because `attendeeCount` legitimately exceeds the stored roster on a meeting large enough to hit
 * `MAX_STORED_ATTENDEES` — the "bounded roster" case is what fails if anybody ever simplifies that
 * arithmetic. And a record the scrub does not change is returned BY REFERENCE, which is what keeps this
 * affordable on a per-line pass over a corpus where almost nothing carries a roster at all.
 */
import { describe, expect, it } from "vitest";

import { type IdentityExclusion, normaliseIdentityName } from "../../../corpus/identityExclusion.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { scrubExcludedIdentities } from "../../../store/admission.js";

/** A denylist holding exactly these names. */
function denying({ names }: { names: readonly string[] }): IdentityExclusion {
  return {
    names: new Set(names.map((name) => normaliseIdentityName({ name }))),
    path: "/fixture/identity-exclusion.txt",
  };
}

/** One meeting record, with only the fields a case cares about spelled out. */
function meeting(over: Partial<CorpusRecord> = {}): CorpusRecord {
  return {
    container: "mail/meetings",
    kind: "transcript",
    refs: [],
    source: "gmail",
    sourceId: "1a07e8f2cb5cecfc:meeting",
    text: "transcript body",
    tsIso: "2026-09-08T01:08:26.000Z",
    url: "https://example.invalid/doc",
    ...over,
  };
}

const PHANTOM = denying({ names: ["Tobias Wren, Rosa Lindqvist"] });

describe("scrubExcludedIdentities", () => {
  it("removes the phantom and decrements the count", () => {
    const scrubbed = scrubExcludedIdentities({
      exclusion: PHANTOM,
      record: meeting({
        attrs: {
          attendeeCount: 5,
          attendees: ["Ada Owner", "Seth Tanner", "Tobias Wren", "Tobias Wren, Rosa Lindqvist", "Rosa Lindqvist"],
        },
      }),
    });
    expect(scrubbed.removed).toBe(1);
    expect(scrubbed.record.attrs?.["attendees"]).toEqual(["Ada Owner", "Seth Tanner", "Tobias Wren", "Rosa Lindqvist"]);
    expect(scrubbed.record.attrs?.["attendeeCount"]).toBe(4);
  });

  it("decrements a BOUNDED count rather than assigning the surviving length", () => {
    const scrubbed = scrubExcludedIdentities({
      exclusion: PHANTOM,
      record: meeting({ attrs: { attendeeCount: 40, attendees: ["Tobias Wren, Rosa Lindqvist", "Seth Tanner"] } }),
    });
    expect(scrubbed.record.attrs?.["attendeeCount"]).toBe(39);
    expect(scrubbed.record.attrs?.["attendees"]).toEqual(["Seth Tanner"]);
  });

  it("leaves every other attribute on the record exactly as it was", () => {
    const scrubbed = scrubExcludedIdentities({
      exclusion: PHANTOM,
      record: meeting({
        attrs: { attendees: ["Tobias Wren, Rosa Lindqvist"], meetingDate: "8 Sept 2026", transcriptChars: 23533 },
      }),
    });
    expect(scrubbed.record.attrs?.["meetingDate"]).toBe("8 Sept 2026");
    expect(scrubbed.record.attrs?.["transcriptChars"]).toBe(23533);
    expect(scrubbed.record.text).toBe("transcript body");
  });

  it("carries a roster with no excluded name through untouched, by reference", () => {
    const record = meeting({ attrs: { attendeeCount: 2, attendees: ["Tobias Wren", "Rosa Lindqvist"] } });
    const scrubbed = scrubExcludedIdentities({ exclusion: PHANTOM, record });
    expect(scrubbed.removed).toBe(0);
    expect(scrubbed.record).toBe(record);
  });

  it("carries a record with no attrs at all through untouched, by reference", () => {
    const record = meeting();
    const scrubbed = scrubExcludedIdentities({ exclusion: PHANTOM, record });
    expect(scrubbed.removed).toBe(0);
    expect(scrubbed.record).toBe(record);
  });

  it("carries a record whose attrs hold no roster through untouched, by reference", () => {
    const record = meeting({ attrs: { transcriptChars: 10 } });
    const scrubbed = scrubExcludedIdentities({ exclusion: PHANTOM, record });
    expect(scrubbed.removed).toBe(0);
    expect(scrubbed.record).toBe(record);
  });

  it("leaves a roster alone when the count is absent, and still scrubs it", () => {
    const scrubbed = scrubExcludedIdentities({
      exclusion: PHANTOM,
      record: meeting({ attrs: { attendees: ["Seth Tanner", "Tobias Wren, Rosa Lindqvist"] } }),
    });
    expect(scrubbed.record.attrs?.["attendees"]).toEqual(["Seth Tanner"]);
    expect(scrubbed.record.attrs?.["attendeeCount"]).toBe(undefined);
  });
});

describe("scrubExcludedIdentities on a self-inconsistent count", () => {
  it("falls back to the surviving length rather than writing a count below the list", () => {
    const scrubbed = scrubExcludedIdentities({
      exclusion: PHANTOM,
      record: meeting({
        attrs: { attendeeCount: 1, attendees: ["Seth Tanner", "Rosa Lindqvist", "Tobias Wren, Rosa Lindqvist"] },
      }),
    });
    expect(scrubbed.record.attrs?.["attendees"]).toEqual(["Seth Tanner", "Rosa Lindqvist"]);
    expect(scrubbed.record.attrs?.["attendeeCount"]).toBe(2);
  });

  it("never writes a negative count", () => {
    const scrubbed = scrubExcludedIdentities({
      exclusion: PHANTOM,
      record: meeting({ attrs: { attendeeCount: 0, attendees: ["Tobias Wren, Rosa Lindqvist"] } }),
    });
    expect(scrubbed.record.attrs?.["attendees"]).toEqual([]);
    expect(scrubbed.record.attrs?.["attendeeCount"]).toBe(0);
  });
});
