import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { CorpusCensusErrors } from "../../../corpus/corpusCensus.errors.js";
import { type CensusRow, censusCorpus } from "../../../corpus/corpusCensus.js";
import { readCensusRecords } from "../../../corpus/corpusCensusRead.js";
import { readCorpusDir, readCorpusTally } from "../../../corpus/corpusDirRead.js";
import type { CorpusProjection } from "../../../corpus/corpusRowCore.js";
import { identityOf, latestRecords } from "../../../corpus/latestRecords.js";
import { withRowReader } from "../../../corpus/rowReader.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { recordBody } from "../../../gold/recordBody.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const record = (over: Partial<CorpusRecord>): CorpusRecord => ({
  container: "acme/web",
  kind: "pr",
  refs: [],
  source: "github",
  sourceId: "#1",
  text: "body",
  tsIso: "2026-01-05T00:00:00Z",
  url: "https://example.test/1",
  ...over,
});

/** Write a corpus tree: one file per entry, each line a row (a string is written verbatim). */
function seed({ files }: { files: Readonly<Record<string, readonly (CorpusRecord | string)[]>> }): string {
  const dir = mkdtempSync(join(tmpdir(), "census-"));
  dirs.push(dir);
  for (const [relative, rows] of Object.entries(files)) {
    const path = join(dir, relative);
    mkdirSync(join(path, ".."), { recursive: true });
    const lines = rows.map((row) => (typeof row === "string" ? row : JSON.stringify(row)));
    writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  }
  return dir;
}

// Every tie class the winner rule has, spread across windows and sources so sorted read order is exercised.
const TIE = "2026-01-07T00:00:00Z";
const FIXTURE = {
  "github/2026-01-01_2026-02-01.jsonl": [
    // an edit, in order: the later row supersedes
    record({ sourceId: "#1", text: "the ORIGINAL body", tsIso: "2026-01-05T00:00:00Z" }),
    // an edit, out of order: the newer row was written first
    record({ container: "acme/api", sourceId: "#1", text: "api NEWER", tsIso: "2026-01-09T00:00:00Z" }),
    record({ container: "acme/api", sourceId: "#1", text: "api older", tsIso: "2026-01-08T00:00:00Z" }),
    // `+10:00` sorts above `Z` as a string while being the EARLIER instant
    record({ sourceId: "#3", text: "at 23:30Z the day before", tsIso: "2026-01-05T09:30:00+10:00" }),
    record({ sourceId: "#3", text: "at midnight Z", tsIso: "2026-01-05T00:00:00Z" }),
    // a timestamp tie decided on length
    record({ sourceId: "#4", text: "the longer, richer capture", tsIso: TIE }),
    record({ sourceId: "#4", text: "thin", tsIso: TIE }),
    // a complete row and its partial twin — the marker makes the partial one LONGER, and it must still lose
    record({ sourceId: "#5", text: "same text", tsIso: TIE }),
    record({ attrs: { capture: "partial" }, sourceId: "#5", text: "same text", tsIso: TIE }),
    // a byte-identical re-fetch
    record({ sourceId: "#6", text: "unchanged", tsIso: TIE }),
    record({ sourceId: "#6", text: "unchanged", tsIso: TIE }),
    // equal length, different bytes: the serialised comparison decides
    record({ sourceId: "#8", text: "abd", tsIso: TIE }),
    record({ sourceId: "#8", text: "abc", tsIso: TIE }),
    "",
    '{"source":"github"}',
  ],
  "github/2026-02-01_2026-03-01.jsonl": [
    record({ sourceId: "#1", text: "the EDITED body", tsIso: "2026-01-06T00:00:00Z" }),
    // `raw` is the only difference: longer under `bronze`, identical under `retrieval`
    record({ raw: { a: 1 }, sourceId: "#7", text: "raw differs", tsIso: TIE }),
    record({ raw: { a: 1, b: "a much longer payload" }, sourceId: "#7", text: "raw differs", tsIso: TIE }),
    record({ sourceId: "#9", text: "titled", title: "A title" }),
  ],
  // `self` and `transcript`: a later SHORTER row at the same instant is the current capture
  "self/2026-01-01_2026-02-01.jsonl": [
    record({
      container: "notes",
      kind: "document",
      source: "self",
      sourceId: "n1",
      text: "a long first scan",
      tsIso: TIE,
    }),
    record({ container: "notes", kind: "document", source: "self", sourceId: "n1", text: "edited", tsIso: TIE }),
  ],
  "gmail/2026-01-01_2026-02-01.jsonl": [
    record({
      container: "meet",
      kind: "transcript",
      source: "gmail",
      sourceId: "m1",
      text: "summary and transcript",
      tsIso: TIE,
    }),
    record({ container: "meet", kind: "transcript", source: "gmail", sourceId: "m1", text: "transcript", tsIso: TIE }),
  ],
  "slack/2026-01-01_2026-02-01.jsonl": [record({ container: "C1", kind: "message", source: "slack", sourceId: "1.0" })],
} as const;

/** The census's winners read back in its own order, under the projection the tie was decided under. */
function censusCollapse({
  dir,
  tieProjection,
}: {
  dir: string;
  tieProjection: CorpusProjection;
}): readonly CorpusRecord[] {
  return withRowReader({
    run: (reader) => {
      const census = unwrap(censusCorpus({ dir, home: dir, protection: NO_ENTRIES, reader, tieProjection }));
      return unwrap(readCensusRecords({ entries: [...census.winners.values()], projection: tieProjection, reader }));
    },
  });
}

describe("censusCorpus — the collapse is latestRecords, exactly", () => {
  it("matches latestRecords over a bronze read, record for record and in order", () => {
    const dir = seed({ files: FIXTURE });
    const expected = latestRecords({
      records: unwrap(readCorpusDir({ dir, home: dir, projection: "bronze", protection: NO_ENTRIES })).records,
    });
    expect(expected.length).toBe(12);
    expect(censusCollapse({ dir, tieProjection: "bronze" })).toEqual(expected);
  });

  it("matches latestRecords over a retrieval read, record for record and in order", () => {
    const dir = seed({ files: FIXTURE });
    const expected = latestRecords({
      records: unwrap(readCorpusDir({ dir, home: dir, projection: "retrieval", protection: NO_ENTRIES })).records,
    });
    expect(censusCollapse({ dir, tieProjection: "retrieval" })).toEqual(expected);
  });

  it("decides a tie under the caller's projection — `raw` breaks it under bronze and not under retrieval", () => {
    const dir = seed({ files: FIXTURE });
    const underBronze = censusCollapse({ dir, tieProjection: "bronze" }).find((r) => r.sourceId === "#7")!;
    const underRetrieval = censusCollapse({ dir, tieProjection: "retrieval" }).find((r) => r.sourceId === "#7")!;
    expect(underBronze.raw).toEqual({ a: 1, b: "a much longer payload" });
    expect(underRetrieval.raw).toBe(undefined);
    // Under retrieval the two rows serialise identically, so the incumbent — the FIRST row — holds.
    const pointers = withRowReader({
      run: (reader) =>
        (["bronze", "retrieval"] as const).map((tieProjection) =>
          unwrap(censusCorpus({ dir, home: dir, protection: NO_ENTRIES, reader, tieProjection })).winners.get(
            identityOf({ container: "acme/web", source: "github", sourceId: "#7" }),
          ),
        ),
    });
    expect(pointers[0]!.pointer.byteOffset).toBeGreaterThan(pointers[1]!.pointer.byteOffset);
  });

  it("keeps the named survivors of every tie class", () => {
    const text = ({ id, container = "acme/web" }: { id: string; container?: string }) =>
      censusCollapse({ dir: seed({ files: FIXTURE }), tieProjection: "bronze" }).find(
        (r) => r.sourceId === id && r.container === container,
      )!.text;
    expect(text({ id: "#1" })).toBe("the EDITED body");
    expect(text({ container: "acme/api", id: "#1" })).toBe("api NEWER");
    expect(text({ id: "#3" })).toBe("at midnight Z");
    expect(text({ id: "#4" })).toBe("the longer, richer capture");
    expect(text({ id: "#8" })).toBe("abd");
    expect(text({ container: "notes", id: "n1" })).toBe("edited");
    expect(text({ container: "meet", id: "m1" })).toBe("transcript");
  });
});

describe("censusCorpus — accounting", () => {
  it("counts rows, parses and skips per group exactly as readCorpusTally does", () => {
    const dir = seed({ files: FIXTURE });
    const tally = unwrap(readCorpusTally({ dir, home: dir, projection: "retrieval", protection: NO_ENTRIES }));
    const census = withRowReader({
      run: (reader) =>
        unwrap(censusCorpus({ dir, home: dir, protection: NO_ENTRIES, reader, tieProjection: "bronze" })),
    });
    expect(census.groups.map((g) => [g.group, g.rows, g.parsed, g.skipped])).toEqual(
      tally.tallies.map((t) => [t.group, t.rows, t.records.length, t.skipped]),
    );
    expect(census.admittedRows).toBe(22);
    expect(census.warnings.map((w) => w.replace(dir, "<dir>"))).toEqual(
      unwrap(readCorpusDir({ dir, home: dir, protection: NO_ENTRIES })).warnings.map((w) => w.replace(dir, "<dir>")),
    );
    expect(census.warnings).toHaveLength(1);
  });

  it("hands every admitted physical row to the fold, with its running version count", () => {
    const dir = seed({ files: FIXTURE });
    const seen: CensusRow[] = [];
    withRowReader({
      run: (reader) =>
        unwrap(
          censusCorpus({
            dir,
            home: dir,
            onRow: (row) => seen.push(row),
            protection: NO_ENTRIES,
            reader,
            tieProjection: "bronze",
          }),
        ),
    });
    expect(seen).toHaveLength(22);
    const editedPr = seen.filter((row) => row.record.sourceId === "#1" && row.record.container === "acme/web");
    expect(editedPr.map((row) => row.versions)).toEqual([1, 2]);
    expect(editedPr.map((row) => row.group)).toEqual(["github", "github"]);
  });

  it("leaves a record the admit filter refuses out of the collapse and the row count", () => {
    const dir = seed({ files: FIXTURE });
    const census = withRowReader({
      run: (reader) =>
        unwrap(
          censusCorpus({
            admit: ({ record: r }) => r.source !== "slack",
            dir,
            home: dir,
            protection: NO_ENTRIES,
            reader,
            tieProjection: "bronze",
          }),
        ),
    });
    expect(census.admittedRows).toBe(21);
    expect([...census.winners.values()].filter((entry) => entry.source === "slack")).toEqual([]);
    expect(census.groups.find((g) => g.group === "slack")!.parsed).toBe(1);
  });

  it("carries recordBody's length as bodyChars, titled or not", () => {
    const dir = seed({ files: FIXTURE });
    withRowReader({
      run: (reader) => {
        const census = unwrap(
          censusCorpus({ dir, home: dir, protection: NO_ENTRIES, reader, tieProjection: "bronze" }),
        );
        const entries = [...census.winners.values()];
        const records = unwrap(readCensusRecords({ entries, projection: "retrieval", reader }));
        expect(entries.map((entry) => entry.bodyChars)).toEqual(records.map((r) => recordBody({ record: r }).length));
        expect(entries.find((entry) => entry.sourceId === "#9")!.bodyChars).toBe("A title\ntitled".length);
      },
    });
  });

  it("answers a missing root with an empty census and a warning", () => {
    const home = seed({ files: {} });
    const census = withRowReader({
      run: (reader) =>
        unwrap(
          censusCorpus({
            dir: "/nonexistent/census-root",
            home,
            protection: NO_ENTRIES,
            reader,
            tieProjection: "bronze",
          }),
        ),
    });
    expect(census.winners.size).toBe(0);
    expect(census.warnings).toEqual(["corpus dir not found (treated as empty): /nonexistent/census-root"]);
  });

  it("fails typed when the held row cannot be read back to decide a tie", () => {
    const dir = seed({
      files: { "github/2026-01-01_2026-02-01.jsonl": [record({ tsIso: TIE }), record({ text: "x", tsIso: TIE })] },
    });
    const gone = withRowReader({
      run: (reader) =>
        unwrapErr(
          censusCorpus({
            dir,
            home: dir,
            protection: NO_ENTRIES,
            reader: {
              line: ({ pointer }) =>
                err(
                  CorpusCensusErrors.rowUnreadable({
                    byteOffset: pointer.byteOffset,
                    path: pointer.path,
                    reason: "gone",
                  }),
                ),
              record: reader.record,
            },
            tieProjection: "bronze",
          }),
        ),
    });
    expect(gone.code).toBe("CENSUS_TIE_UNREADABLE");
    const path = join(dir, "github", "2026-01-01_2026-02-01.jsonl");
    // The held row is the file's first, so the re-read that failed was at offset 0.
    expect(gone).toEqual(
      CorpusCensusErrors.tieUnreadable({
        cause: CorpusCensusErrors.rowUnreadable({ byteOffset: 0, path, reason: "gone" }),
        path,
      }),
    );
    expect(gone.message).toContain("(gone) — the file changed underneath this read");
  });
});

describe("RowReader — a row that changed underneath the read", () => {
  it("fails typed, naming the file and offset, when the bytes there no longer parse", () => {
    const dir = seed({ files: { "github/w.jsonl": [record({})] } });
    const failed = withRowReader({
      run: (reader) =>
        unwrapErr(
          reader.record({
            pointer: { byteLength: 5, byteOffset: 3, path: join(dir, "github", "w.jsonl") },
            projection: "bronze",
          }),
        ),
    });
    expect(failed.code).toBe("CENSUS_ROW_UNREADABLE");
    expect(failed.byteOffset).toBe(3);
    expect(failed.message).toContain(`${join(dir, "github", "w.jsonl")}@3: the row could not be read back (`);
  });
});
