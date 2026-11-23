/*
 * `rowTagsOf` — a row's whole tag set: declared tags before derived ones, a now-derived key's old declared value set
 * apart, and a later single write settling a key set twice. It moved here when `rowTags.test.ts` was split by
 * behaviour.
 */
import { describe, expect, it } from "vitest";

import { rowTagsOf } from "../../../../handover/rowTagFold.js";
import { fields, LATER, tagged, waiting } from "./harness.js";

describe("rowTagsOf", () => {
  it("puts declared tags before derived ones", () => {
    const { tags } = rowTagsOf({
      events: [tagged({ set: [{ key: "platform", value: "linear" }] })],
      fields: fields({ lines: [] }),
    });
    expect(tags.map((tag) => `${tag.source}:${tag.key}=${tag.value}`)).toEqual([
      "declared:platform=linear",
      "derived:kind=doc",
      "derived:priority=p2",
    ]);
  });

  it("sets a now-derived key's old declared value apart, so only the derived value can be matched", () => {
    const row = rowTagsOf({
      events: [
        tagged({
          set: [
            { key: "reply", value: "drafted" },
            { key: "impact", value: "huge" },
            { key: "impact", value: "high" },
          ],
        }),
      ],
      fields: fields({ lines: [], run: waiting({ drafted: false }) }),
    });
    expect(row.tags.filter((tag) => tag.key === "reply")).toEqual([{ key: "reply", source: "derived", value: "none" }]);
    expect(row.tags.filter((tag) => tag.key === "impact")).toEqual([]);
    expect(row.unrecognised).toEqual([
      { key: "impact", source: "unrecognised", value: "huge" },
      { key: "impact", source: "unrecognised", value: "high" },
      { key: "reply", source: "unrecognised", value: "drafted" },
    ]);
  });

  it("lets a later single write settle a key a hand-edited line set twice", () => {
    const row = rowTagsOf({
      events: [
        tagged({
          set: [
            { key: "impact", value: "huge" },
            { key: "impact", value: "high" },
          ],
        }),
        tagged({ atIso: LATER, set: [{ key: "impact", value: "low" }] }),
      ],
      fields: fields({ lines: [] }),
    });
    expect(row.tags.filter((tag) => tag.key === "impact")).toEqual([
      { key: "impact", source: "declared", value: "low" },
    ]);
    expect(row.unrecognised).toEqual([]);
  });
});
