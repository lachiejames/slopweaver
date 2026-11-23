/** The field shapes every row-event schema is built from: non-blank words, a parseable instant, the kind's base. */
import { describe, expect, it } from "vitest";

import { base, instant, words } from "../../../handover/rowEventPrimitives.js";

describe("row event primitives", () => {
  it("refuses blank words and keeps real ones trimmed", () => {
    expect([words.safeParse("  ").success, words.parse("  a word ")]).toEqual([false, "a word"]);
  });

  it("refuses an instant Date.parse cannot read", () => {
    expect([instant.safeParse("2026-11-04T00:34:48.998Z").success, instant.safeParse("tuesday").success]).toEqual([
      true,
      false,
    ]);
  });

  it("builds a base that holds its own kind and refuses another", () => {
    const ruling = base({ kind: "ruling" });
    expect([
      ruling.safeParse({ atIso: "2026-11-04T00:34:48.998Z", kind: "ruling" }).success,
      ruling.safeParse({ atIso: "2026-11-04T00:34:48.998Z", kind: "parked" }).success,
    ]).toEqual([true, false]);
  });
});
