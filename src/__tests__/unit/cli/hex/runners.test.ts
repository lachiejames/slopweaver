import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cellSourceHead, hexCellsCommand } from "../../../../cli/commands/hex/cellsRun.js";
import { hexConnectionsCommand } from "../../../../cli/commands/hex/connectionsRun.js";
import { hexOutputCommand, outputLines } from "../../../../cli/commands/hex/outputRun.js";
import { hexProjectCommand, projectLines } from "../../../../cli/commands/hex/projectRun.js";
import { hexProjectsCommand } from "../../../../cli/commands/hex/projectsRun.js";
import { hexRawCommand } from "../../../../cli/commands/hex/rawRun.js";
import { hexRunsCommand } from "../../../../cli/commands/hex/runsRun.js";
import { hexVerifyCommand } from "../../../../cli/commands/hex/verifyRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";
import type { HexCell, HexProject, HexTableResult } from "../../../../hex/responses.js";
import { boundOutput, retentionSplit } from "../../../../hex/shape.js";

let home: string | null = null;

/**
 * A throwaway state home with no `secrets/hex-api-token`, pointed at by `$SLOPWEAVER_HOME` for one case.
 *
 * The runners resolve the credential through the ambient home, so an empty one is how a test reaches the
 * no-token path without a seam — and the sandbox guard means this never touches the operator's own store.
 */
function homeWithNoToken(): string {
  const root = mkdtempSync(join(tmpdir(), "hex-runner-"));
  home = root;
  process.env["SLOPWEAVER_HOME"] = root;
  return root;
}

afterEach(() => {
  if (home !== null) {
    rmSync(home, { force: true, recursive: true });
    home = null;
  }
});

/** The argv shape the router hands a verb: runtime, script, noun, verb, then the tail. */
function argv({ verb, tail = [] }: { verb: string; tail?: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "hex", verb, ...tail];
}

const EVERY_VERB = [
  { command: hexCellsCommand, tail: ["--project", "p1"], verb: "cells" },
  { command: hexConnectionsCommand, tail: [], verb: "connections" },
  { command: hexOutputCommand, tail: ["--cell", "c1"], verb: "output" },
  { command: hexProjectCommand, tail: ["--project", "p1"], verb: "project" },
  { command: hexProjectsCommand, tail: [], verb: "projects" },
  { command: hexRawCommand, tail: ["--path", "/v1/users/me"], verb: "raw" },
  { command: hexRunsCommand, tail: ["--project", "p1"], verb: "runs" },
  { command: hexVerifyCommand, tail: [], verb: "verify" },
] as const;

describe("every hex verb the CLI can dispatch", () => {
  it("is wired to a runner the manifest can load", () => {
    expect(EVERY_VERB.length).toBeGreaterThan(0);
    expect(EVERY_VERB.filter((each) => typeof each.command !== "function")).toEqual([]);
  });

  it("prints its usage and exits 0 on --help, reaching no credential at all", async () => {
    for (const each of EVERY_VERB) {
      expect(await each.command(argv({ tail: ["--help"], verb: each.verb }))).toBe(EXIT_OK);
    }
  });

  it("exits 3 — not 1 — when this install holds no Hex token", async () => {
    homeWithNoToken();
    for (const each of EVERY_VERB) {
      expect(await each.command(argv({ tail: each.tail, verb: each.verb }))).toBe(EXIT_EXPECTED_EMPTY);
    }
  });

  it("exits 2 on a caller mistake, before any credential is resolved", async () => {
    homeWithNoToken();
    expect(await hexProjectCommand(argv({ verb: "project" }))).toBe(EXIT_USAGE);
    expect(await hexOutputCommand(argv({ verb: "output" }))).toBe(EXIT_USAGE);
    expect(await hexRawCommand(argv({ verb: "raw" }))).toBe(EXIT_USAGE);
    expect(await hexRunsCommand(argv({ verb: "runs" }))).toBe(EXIT_USAGE);
    expect(await hexCellsCommand(argv({ verb: "cells" }))).toBe(EXIT_USAGE);
    expect(await hexProjectsCommand(argv({ tail: ["--limit", "0"], verb: "projects" }))).toBe(EXIT_USAGE);
  });
});

/** One cell, overridden per case. */
function cell(over: Partial<HexCell> = {}): HexCell {
  return {
    cellType: "SQL",
    contents: { codeCell: null, markdownCell: null, sqlCell: { outputDataframe: "df", source: "select 1\nfrom t" } },
    dataConnectionId: "dc1",
    id: "c1",
    label: "the count",
    projectId: "p1",
    staticId: "s1",
    ...over,
  };
}

describe("cellSourceHead", () => {
  it("takes the SQL arm's first line", () => {
    expect(cellSourceHead({ cell: cell() })).toBe("select 1");
  });

  it("falls to the code arm when there is no SQL", () => {
    expect(
      cellSourceHead({
        cell: cell({
          contents: { codeCell: { source: "import pandas" }, markdownCell: null, sqlCell: null },
        }),
      }),
    ).toBe("import pandas");
  });

  it("takes the markdown arm when it is the only one", () => {
    expect(
      cellSourceHead({
        cell: cell({ contents: { codeCell: null, markdownCell: { source: "# heading" }, sqlCell: null } }),
      }),
    ).toBe("# heading");
  });

  it("says so for a cell carrying no source at all", () => {
    expect(cellSourceHead({ cell: cell({ contents: { codeCell: null, markdownCell: null, sqlCell: null } }) })).toBe(
      "(no source)",
    );
  });
});

/** One table result, overridden per case. */
function table(over: Partial<HexTableResult> = {}): HexTableResult {
  return {
    columns: [{ name: "created_at", type: "timestamp" }],
    rowLimit: 100,
    rows: [{ created_at: "2026-09-10T00:00:00Z" }],
    rowsReturned: 1,
    totalRows: 1,
    totalRowsKind: "EXACT",
    truncated: false,
    type: "table",
    ...over,
  };
}

describe("outputLines", () => {
  it("dates the rows by their run and says nothing was written to disk", () => {
    const lines = outputLines({
      bounded: boundOutput({ limit: 50, result: table() }),
      dateColumn: null,
      result: table(),
      runId: "r1",
      split: null,
    });
    expect(lines[0]).toContain("from run r1 of the DRAFT session, not a fresh execution");
    expect(lines.at(-1)).toBe("nothing above was written to disk — Hex is read, never ingested");
  });

  it("says when HEX truncated the preview, with the kind of total it reported", () => {
    const truncated = table({ totalRows: 9000, totalRowsKind: "LOWER_BOUND", truncated: true });
    const lines = outputLines({
      bounded: boundOutput({ limit: 50, result: truncated }),
      dateColumn: null,
      result: truncated,
      runId: "r1",
      split: null,
    });
    expect(lines.join("\n")).toContain("LOWER_BOUND");
  });

  it("prints the retention split with its edge and both sides", () => {
    const rows = [{ created_at: "2026-09-10T00:00:00Z" }, { created_at: "2026-01-01T00:00:00Z" }];
    const result = table({ rows, rowsReturned: 2, totalRows: 2 });
    const lines = outputLines({
      bounded: boundOutput({ limit: 50, result }),
      dateColumn: "created_at",
      result,
      runId: "r1",
      split: retentionSplit({ dateColumn: "created_at", nowIso: "2026-09-16T00:00:00Z", rows }),
    });
    const text = lines.join("\n");
    expect(text).toContain("1 row(s) inside Datadog's window");
    expect(text).toContain("1 row(s) BEYOND it — only Hex still holds these");
  });

  it("prints NO retention lines when the caller named no date column", () => {
    const lines = outputLines({
      bounded: boundOutput({ limit: 50, result: table() }),
      dateColumn: null,
      result: table(),
      runId: "r1",
      split: null,
    });
    expect(lines.filter((line) => line.includes("retention split"))).toEqual([]);
  });
});

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
    owner: { email: "b@example.com" },
    schedules: [],
    status: null,
    title: "Booking health",
    trashedAt: null,
    type: "PROJECT",
    ...over,
  };
}

describe("projectLines", () => {
  it("leads with the title and the app URL a human opens", () => {
    const lines = projectLines({ project: project(), tables: null });
    expect(lines[0]).toBe("Booking health (PROJECT)");
    expect(lines[1]).toBe("  https://app.hex.tech/app/p1");
  });

  it("prints NO table section when the caller did not ask for tables", () => {
    expect(projectLines({ project: project(), tables: null }).filter((line) => line.includes("warehouse"))).toEqual([]);
  });

  it("prints an EMPTY table section when the caller asked and the project queries none", () => {
    const lines = projectLines({ project: project(), tables: [] });
    expect(lines.filter((line) => line.includes("warehouse tables this project queries (0)")).length).toBe(1);
  });

  it("names each table and the connection it is read through", () => {
    const lines = projectLines({
      project: project(),
      tables: [{ dataConnectionId: "dc1", dataConnectionName: "BigQuery prod", tableName: "public.Booking" }],
    });
    expect(lines.join("\n")).toContain("public.Booking  via BigQuery prod");
  });

  it("warns that a scheduled project refreshes with nobody watching", () => {
    const lines = projectLines({ project: project({ schedules: [{ enabled: true }] }), tables: null });
    expect(lines.join("\n")).toContain("1 schedule(s)");
  });
});
