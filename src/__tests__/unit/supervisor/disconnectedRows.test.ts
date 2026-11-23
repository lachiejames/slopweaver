/** The one decoder both supervisor readers share for a reconciliation's disconnected hold. */

import { describe, expect, it } from "vitest";

import { disconnectedSlugsOf, slugNotHeldBlocked } from "../../../supervisor/disconnectedRows.js";

const ROW = { needs: ["fathom"], path: "/h/a.md", slug: "a" };
const NOT_ROWS = "the reconciliation's `disconnectedRows` is not a list of `{ needs, path, slug }` rows";

describe("disconnectedSlugsOf", () => {
  it("reads a reading from before the hold as none held", () => {
    expect(disconnectedSlugsOf({ reconciliation: {} })).toEqual({ kind: "read", value: [] });
  });

  it("reads each held row's slug, one per row, when the store listed", () => {
    const reconciliation = {
      disconnectedRows: [ROW, { ...ROW, path: "/h/b.md", slug: "b" }],
      disconnectedUnread: null,
    };
    expect(disconnectedSlugsOf({ reconciliation })).toEqual({ kind: "read", value: ["a", "b"] });
  });

  it("reads an unlistable store holding nothing as none held", () => {
    const reconciliation = { disconnectedRows: [], disconnectedUnread: "EACCES" };
    expect(disconnectedSlugsOf({ reconciliation })).toEqual({ kind: "read", value: [] });
  });

  it("refuses a row named beside a store that did not list", () => {
    expect(disconnectedSlugsOf({ reconciliation: { disconnectedRows: [ROW], disconnectedUnread: "EACCES" } })).toEqual({
      kind: "unreadable",
      why: "the reconciliation holds rows for a disconnected integration while saying the secrets store did not list",
    });
  });

  it("refuses a list without its null-or-reason partner", () => {
    expect(disconnectedSlugsOf({ reconciliation: { disconnectedRows: [ROW] } })).toEqual({
      kind: "unreadable",
      why: "the reconciliation's `disconnectedUnread` is neither null nor a reason",
    });
  });

  it("refuses a value that is not a list, an empty entry, and a need the table does not carry", () => {
    const shapes = ["x", [{}], [{ ...ROW, needs: ["not-an-integration"] }], [{ ...ROW, slug: "" }]];
    expect(
      shapes.map((disconnectedRows) =>
        disconnectedSlugsOf({ reconciliation: { disconnectedRows, disconnectedUnread: null } }),
      ),
    ).toEqual(shapes.map(() => ({ kind: "unreadable", why: NOT_ROWS })));
  });
});

describe("slugNotHeldBlocked", () => {
  it("finds nothing when every slug is held blocked", () => {
    const held = [{ id: "a", standing: "blocked" }, { id: "b", standing: "blocked" }, { standing: "paused" }];
    expect(slugNotHeldBlocked({ held, slugs: ["a", "b"] })).toBe(undefined);
  });

  it("names a slug held under another standing", () => {
    expect(slugNotHeldBlocked({ held: [{ id: "a", standing: "paused" }], slugs: ["a"] })).toBe("a");
  });

  it("names a slug the held list does not carry at all", () => {
    expect(slugNotHeldBlocked({ held: [{ id: "a", standing: "blocked" }], slugs: ["a", "z"] })).toBe("z");
  });
});
