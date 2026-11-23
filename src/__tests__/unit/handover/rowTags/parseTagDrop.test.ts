/*
 * `parseTagDrop` — reading one tag drop, a whole key or one value of it, and refusing a derived key or a value drop
 * on a one-valued key. It moved here when `rowTags.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { RowTagErrors } from "../../../../handover/rowTagErrors.js";
import { parseTagDrop } from "../../../../handover/taggedEvent.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("parseTagDrop", () => {
  it("accepts a whole declared key", () => {
    expect(unwrap(parseTagDrop({ text: "workstream" }))).toBe("workstream");
  });

  it("accepts one value of a key", () => {
    expect(unwrap(parseTagDrop({ text: "workstream=iso-certification" }))).toBe("workstream=iso-certification");
  });

  it("refuses a derived key", () => {
    expect(unwrapErr(parseTagDrop({ text: "kind" })).code).toBe("TAG_DERIVED_KEY");
  });

  it("refuses one value of a one-valued key, naming the whole-key drop", () => {
    const refused = unwrapErr(parseTagDrop({ text: "impact=high" }));
    expect(refused).toEqual(RowTagErrors.valueDropOnOne({ key: "impact" }));
    expect(refused.message).toBe("impact holds one value, so it is dropped whole — write the drop as impact");
  });
});
