/**
 * The read-back `editFrontMatterFields` owes, over front-matter lines directly — every flat key and every comment
 * the edit was not asked about.
 */
import { describe, expect, it } from "vitest";

import { collateralDamage, declaredKey } from "../../../handover/frontmatterDamage.js";

const BEFORE = ["slug: row", "status: ready", "# a note", "registeredBy: a-session"];

describe("collateralDamage", () => {
  it("finds nothing when only the asked key moved", () => {
    const after = ["slug: row", "status: cancelled", "# a note", "registeredBy: a-session"];

    expect(
      collateralDamage({
        after,
        before: BEFORE,
        remove: [],
        set: [{ key: "status", value: "cancelled" }],
        slug: "row",
      }),
    ).toEqual([]);
  });

  it("names a comment the edit lost", () => {
    const after = ["slug: row", "status: cancelled", "registeredBy: a-session"];

    expect(
      collateralDamage({
        after,
        before: BEFORE,
        remove: [],
        set: [{ key: "status", value: "cancelled" }],
        slug: "row",
      }),
    ).toEqual([
      'editing row would also lose the front-matter comment "# a note", which was not in the edit — refusing rather than losing authored text',
    ]);
  });

  it("counts a comment written twice, so one surviving copy does not answer for the other", () => {
    const before = ["slug: row", "# a note", "status: ready", "# a note"];
    const after = ["slug: row", "# a note", "status: cancelled"];

    expect(
      collateralDamage({ after, before, remove: [], set: [{ key: "status", value: "cancelled" }], slug: "row" }),
    ).toEqual([
      'editing row would also lose the front-matter comment "# a note", which was not in the edit — refusing rather than losing authored text',
    ]);
  });

  it("names any flat key whose value moved unasked, not only a listed one", () => {
    const after = ["slug: row", "status: ready", "# a note", "registeredBy: someone-else"];

    expect(collateralDamage({ after, before: BEFORE, remove: [], set: [], slug: "row" })).toEqual([
      'editing row would also change "registeredBy", which was not in the edit — refusing rather than losing authored text',
    ]);
  });

  it("reads an indented `#` inside a block as the block's text, so losing it with the asked key is no comment lost", () => {
    const before = ["slug: row", "statusSummary: >", "  # a heading in the text", "status: ready"];
    const after = ["slug: row", "statusSummary: new", "status: ready"];

    expect(
      collateralDamage({ after, before, remove: [], set: [{ key: "statusSummary", value: "new" }], slug: "row" }),
    ).toEqual([]);
  });

  it("reports a duplicated key alone, ahead of anything else", () => {
    const after = ["slug: row", "status: x", "slug: again"];

    expect(
      collateralDamage({ after, before: BEFORE, remove: [], set: [{ key: "status", value: "x" }], slug: "row" }),
    ).toEqual(['editing row would leave "slug" declared twice, which takes the row off the board']);
  });

  it("names a written key the reader cannot see and a removed key it still reads", () => {
    const after = ["slug: row", "# a note", "registeredBy: a-session"];

    expect(
      collateralDamage({
        after: [...after, "custom: kept"],
        before: [...BEFORE, "custom: old"],
        remove: ["custom"],
        set: [{ key: "status", value: "paused" }],
        slug: "row",
      }),
    ).toEqual([
      'editing row would write "status" where the reader cannot see it — refusing',
      'editing row would remove "custom" and the reader would still read one — refusing',
    ]);
  });
});

describe("declaredKey", () => {
  it("reads a key as the reader does, space before the colon dropped", () => {
    expect(declaredKey({ line: "repo : /x" })).toBe("repo");
  });

  it("reads no key from an indented line or a comment", () => {
    expect(declaredKey({ line: "  - path: a" })).toBe(undefined);
    expect(declaredKey({ line: "# status: ready" })).toBe(undefined);
  });
});
