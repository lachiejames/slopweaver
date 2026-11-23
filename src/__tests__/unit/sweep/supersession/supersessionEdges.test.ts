/*
 * Edges from declared supersession: a declared slug links to the strictly newer, dated row that declared it, the
 * newest declarer wins a tie of declarers, a row never supersedes itself, and an empty board answers an empty map.
 */
import { describe, expect, it } from "vitest";

import { type SupersessionInput, supersessionEdges } from "../../../../sweep/supersession.js";

function row({
  slug,
  askedIso,
  text,
}: {
  slug: string;
  askedIso: string | undefined;
  text: string;
}): SupersessionInput {
  return { askedIso, slug, text };
}

describe("supersessionEdges", () => {
  it("links a declared slug to the newer row that declared it", () => {
    const edges = supersessionEdges({
      rows: [
        row({ askedIso: "2026-09-01T00:00:00.000Z", slug: "old-row", text: "nothing\n" }),
        row({ askedIso: "2026-09-10T00:00:00.000Z", slug: "new-row", text: "supersedes: old-row\n" }),
      ],
    });
    expect(edges.get("old-row")).toEqual({ kind: "declared", newerSlug: "new-row" });
    expect(edges.size).toBe(1);
  });

  it("refuses a declaration from a row that is not strictly newer", () => {
    const edges = supersessionEdges({
      rows: [
        row({ askedIso: "2026-09-10T00:00:00.000Z", slug: "old-row", text: "nothing\n" }),
        row({ askedIso: "2026-09-10T00:00:00.000Z", slug: "same-day", text: "supersedes: old-row\n" }),
      ],
    });
    expect(edges.size).toBe(0);
  });

  it("refuses a declaration from a row with no asked instant of its own", () => {
    const edges = supersessionEdges({
      rows: [
        row({ askedIso: "2026-09-01T00:00:00.000Z", slug: "old-row", text: "nothing\n" }),
        row({ askedIso: undefined, slug: "undated", text: "supersedes: old-row\n" }),
      ],
    });
    expect(edges.size).toBe(0);
  });

  it("ignores a declaration naming a row that is not live, because only live rows are passed in", () => {
    const edges = supersessionEdges({
      rows: [row({ askedIso: "2026-09-10T00:00:00.000Z", slug: "new-row", text: "supersedes: settled-row\n" })],
    });
    expect(edges.size).toBe(0);
  });

  it("gives the newest declarer when two live rows declare the same slug", () => {
    const edges = supersessionEdges({
      rows: [
        row({ askedIso: "2026-09-01T00:00:00.000Z", slug: "old-row", text: "nothing\n" }),
        row({ askedIso: "2026-09-05T00:00:00.000Z", slug: "middle-row", text: "supersedes: old-row\n" }),
        row({ askedIso: "2026-09-12T00:00:00.000Z", slug: "newest-row", text: "supersedes: old-row\n" }),
      ],
    });
    expect(edges.get("old-row")).toEqual({ kind: "declared", newerSlug: "newest-row" });
  });

  it("never lets a row supersede itself", () => {
    const edges = supersessionEdges({
      rows: [row({ askedIso: "2026-09-10T00:00:00.000Z", slug: "self-row", text: "supersedes: self-row\n" })],
    });
    expect(edges.size).toBe(0);
  });

  it("answers an empty map for an empty board", () => {
    expect(supersessionEdges({ rows: [] }).size).toBe(0);
  });
});
