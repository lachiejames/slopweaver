import { describe, expect, it } from "vitest";

import { ASSUMED_RETENTION_DAYS } from "../../../datadog/detective/search.js";
import type { HexProject, HexTableResult } from "../../../hex/responses.js";
import { boundOutput, filterProjects, hexAppUrl, renderOutputTable, retentionSplit } from "../../../hex/shape.js";

/** One project, overridden per case. */
function project(over: Partial<HexProject> = {}): HexProject {
  return {
    analytics: { lastViewedAt: null, publishedResultsUpdatedAt: null },
    archivedAt: null,
    categories: [],
    createdAt: "2026-01-01T00:00:00Z",
    creator: { email: "a@example.com" },
    description: null,
    id: "p1",
    lastEditedAt: "2026-09-01T00:00:00Z",
    lastPublishedAt: null,
    owner: { email: "a@example.com" },
    schedules: [],
    status: null,
    title: "Growth cockpit",
    trashedAt: null,
    type: "PROJECT",
    ...over,
  };
}

/** One table result, overridden per case. */
function table(over: Partial<HexTableResult> = {}): HexTableResult {
  return {
    columns: [
      { name: "id", type: "string" },
      { name: "created_at", type: "timestamp" },
    ],
    rowLimit: 100,
    rows: [],
    rowsReturned: 0,
    totalRows: 0,
    totalRowsKind: "EXACT",
    truncated: false,
    type: "table",
    ...over,
  };
}

describe("hexAppUrl", () => {
  it("builds the app URL a human opens", () => {
    expect(hexAppUrl({ projectId: "abc-123" })).toBe("https://app.hex.tech/app/abc-123");
  });
});

describe("filterProjects", () => {
  it("requires EVERY usable word, not any of them", () => {
    const filtered = filterProjects({
      projects: [project({ title: "Growth cockpit" }), project({ id: "p2", title: "Growth and retention cockpit" })],
      words: ["growth", "retention"],
    });
    expect(filtered.matched.map((each) => each.id)).toEqual(["p2"]);
  });

  it("matches a word in the description", () => {
    const filtered = filterProjects({
      projects: [project({ description: "every cancelled booking, by site" })],
      words: ["cancelled"],
    });
    expect(filtered.matched.length).toBe(1);
  });

  it("matches a project nobody described on its title alone, and never on another project's description", () => {
    const filtered = filterProjects({
      projects: [
        project({ description: null, id: "p1", title: "Cancelled bookings" }),
        project({ description: null, id: "p2", title: "Growth cockpit" }),
        project({ description: "every cancelled booking", id: "p3", title: "Site view" }),
      ],
      words: ["cancelled"],
    });
    expect(filtered.matched.map((each) => each.id)).toEqual(["p1", "p3"]);
  });

  it("matches a category name", () => {
    const filtered = filterProjects({
      projects: [project({ categories: [{ description: null, name: "Imports" }] })],
      words: ["imports"],
    });
    expect(filtered.matched.length).toBe(1);
  });

  it("is case-insensitive", () => {
    expect(filterProjects({ projects: [project()], words: ["GROWTH"] }).matched.length).toBe(1);
  });

  it("names a word too short to narrow on rather than silently ignoring it", () => {
    const filtered = filterProjects({ projects: [project()], words: ["of"] });
    expect(filtered.ignored).toEqual(["of"]);
    expect(filtered.matched.length).toBe(1);
  });

  it("returns everything when no words are given at all", () => {
    expect(filterProjects({ projects: [project(), project({ id: "p2" })], words: [] }).matched.length).toBe(2);
  });
});

describe("boundOutput", () => {
  it("keeps every column in Hex's own order when none is named", () => {
    const bounded = boundOutput({ limit: 10, result: table({ rows: [{ created_at: "x", id: "1" }] }) });
    expect(bounded.columns).toEqual(["id", "created_at"]);
  });

  it("projects only the columns asked for, in the order asked", () => {
    const bounded = boundOutput({
      columns: ["created_at"],
      limit: 10,
      result: table({ rows: [{ created_at: "2026-09-01T00:00:00Z", id: "1" }] }),
    });
    expect(bounded.columns).toEqual(["created_at"]);
    expect(bounded.rows).toEqual([{ created_at: "2026-09-01T00:00:00Z" }]);
  });

  it("names a column the result does not carry rather than dropping it silently", () => {
    const bounded = boundOutput({ columns: ["nope"], limit: 10, result: table() });
    expect(bounded.missingColumns).toEqual(["nope"]);
  });

  it("counts the rows the limit dropped", () => {
    const bounded = boundOutput({
      limit: 1,
      result: table({ rows: [{ id: "1" }, { id: "2" }, { id: "3" }] }),
    });
    expect(bounded.rows.length).toBe(1);
    expect(bounded.omittedRows).toBe(2);
  });

  it("answers an empty result with no rows and nothing omitted", () => {
    const bounded = boundOutput({ limit: 10, result: table() });
    expect(bounded.rows).toEqual([]);
    expect(bounded.omittedRows).toBe(0);
  });

  it("fills a column a row omits with null rather than leaving the key absent", () => {
    const bounded = boundOutput({ limit: 10, result: table({ rows: [{ id: "1" }] }) });
    expect(bounded.rows).toEqual([{ created_at: null, id: "1" }]);
  });
});

describe("retentionSplit", () => {
  const now = "2026-09-16T00:00:00Z";

  it("puts a row inside the window when it is newer than the edge", () => {
    const split = retentionSplit({
      dateColumn: "created_at",
      nowIso: now,
      rows: [{ created_at: "2026-09-10T00:00:00Z" }],
    });
    expect(split.inside).toBe(1);
    expect(split.beyond).toBe(0);
  });

  it("puts a row BEYOND the window when Datadog no longer holds it", () => {
    const split = retentionSplit({
      dateColumn: "created_at",
      nowIso: now,
      rows: [{ created_at: "2026-07-01T00:00:00Z" }],
    });
    expect(split.beyond).toBe(1);
    expect(split.inside).toBe(0);
  });

  it("counts a row ON the edge as inside", () => {
    const split = retentionSplit({
      dateColumn: "created_at",
      nowIso: now,
      rows: [{ created_at: "2026-09-01T00:00:00Z" }],
      retentionDays: 15,
    });
    expect(split.edgeIso).toBe("2026-09-01T00:00:00.000Z");
    expect(split.inside).toBe(1);
  });

  it("reports an unreadable date in its own bucket rather than folding it into a side", () => {
    const split = retentionSplit({
      dateColumn: "created_at",
      nowIso: now,
      rows: [{ created_at: "not a date" }, { created_at: null }, {}],
    });
    expect(split.unparseable).toBe(3);
    expect(split.inside).toBe(0);
    expect(split.beyond).toBe(0);
  });

  it("defaults to Datadog's own assumed retention rather than restating a number", () => {
    expect(retentionSplit({ dateColumn: "c", nowIso: now, rows: [] }).retentionDays).toBe(ASSUMED_RETENTION_DAYS);
  });

  it("answers three zeros for no rows at all", () => {
    const split = retentionSplit({ dateColumn: "c", nowIso: now, rows: [] });
    expect(split.inside).toBe(0);
    expect(split.beyond).toBe(0);
    expect(split.unparseable).toBe(0);
  });
});

describe("renderOutputTable", () => {
  it("prints a header, a rule and one line per row", () => {
    const lines = renderOutputTable({
      output: boundOutput({ limit: 10, result: table({ rows: [{ created_at: "2026-09-01", id: "1" }] }) }),
    });
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("id");
    expect(lines[2]).toContain("2026-09-01");
  });

  it("marks a null value rather than printing an empty cell", () => {
    const lines = renderOutputTable({
      output: boundOutput({ limit: 10, result: table({ rows: [{ created_at: null, id: "1" }] }) }),
    });
    expect(lines[2]).toContain("∅");
  });

  it("says so when the projection left no columns at all", () => {
    expect(renderOutputTable({ output: { columns: [], missingColumns: [], omittedRows: 0, rows: [] } })).toEqual([
      "(no columns)",
    ]);
  });
});
