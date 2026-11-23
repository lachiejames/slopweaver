/**
 * Which export parts are append-only: the parts whose differing imported row is asked as an alignment and never
 * replaces the live one, against the parts whose answered conflict may.
 */
import { describe, expect, it } from "vitest";

import { isAppendOnlyImportPart, STORE_EXPORT_PARTS } from "../../../../store/transfer/parts.js";

describe("isAppendOnlyImportPart", () => {
  it("names the knowledge register, its recall ledger and the steer measurements append-only, and no other part", () => {
    expect(STORE_EXPORT_PARTS.length).toBeGreaterThan(0);
    expect(STORE_EXPORT_PARTS.map((spec) => [spec.kind, isAppendOnlyImportPart({ part: spec.kind })])).toEqual([
      ["memories", true],
      ["memory-recalls", true],
      ["owner-profile", false],
      ["owner-voice", false],
      ["owner-directives", false],
      ["standing-asks", false],
      ["steer-verdicts", true],
    ]);
  });
});
