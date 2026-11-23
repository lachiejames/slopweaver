import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { historyFile } from "../../../../corpus/corpusPaths.js";
import {
  freshHistoryRows,
  historyIdentity,
  parseHistoryRow,
  readAllHistory,
  readHistoryRows,
  redactHistoryRow,
  serialiseHistoryRow,
  sortHistoryRows,
  stripNulls,
  writeHistoryRows,
} from "../../../../corpus/history/store.js";
import type { HistoryEventRow } from "../../../../corpus/history/types.js";
import { unwrap } from "../../../../lib/result.js";

/** One event row, defaulted. */
function row({ overrides = {} }: { overrides?: Partial<HistoryEventRow> } = {}): HistoryEventRow {
  return {
    changes: { toState: { name: "Done" } },
    container: "linear/ENG",
    eventId: "h1",
    source: "linear",
    stream: "history",
    subjectId: "ENG-42",
    tsIso: "2026-05-04T10:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp home. A real filesystem round-trip, not a mock — the store's whole job is bytes on disk. */
function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-history-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("stripNulls (pure)", () => {
  it("drops null and undefined values and key-sorts what remains", () => {
    expect(stripNulls({ value: { a: null, b: 2, c: 1, d: undefined } })).toEqual({ b: 2, c: 1 });
    expect(JSON.stringify(stripNulls({ value: { b: 2, c: 1 } }))).toBe('{"b":2,"c":1}');
  });

  it("recurses into nested objects and arrays", () => {
    expect(stripNulls({ value: { list: [1, null, 2], outer: { drop: null, keep: 1 } } })).toEqual({
      list: [1, 2],
      outer: { keep: 1 },
    });
  });

  it("leaves scalars alone, including `false` and `0`", () => {
    expect(stripNulls({ value: { count: 0, flag: false } })).toEqual({ count: 0, flag: false });
  });
});

describe("historyIdentity (the dedup key)", () => {
  it("keys on source + stream + subject + event, so two streams cannot collide", () => {
    const asHistory = historyIdentity({ row: row({ overrides: { eventId: "x", stream: "history" } }) });
    const asState = historyIdentity({ row: row({ overrides: { eventId: "x", stream: "state" } }) });
    expect(asState === asHistory).toBe(false);
  });

  it("is stable for the same event", () => {
    expect(historyIdentity({ row: row() })).toBe(
      historyIdentity({ row: row({ overrides: { changes: { different: true } } }) }),
    );
  });
});

describe("sortHistoryRows (canonical order)", () => {
  it("orders ascending by timestamp, whatever order the crawl saw", () => {
    const sorted = sortHistoryRows({
      rows: [
        row({ overrides: { eventId: "b", tsIso: "2026-05-05T00:00:00.000Z" } }),
        row({ overrides: { eventId: "a", tsIso: "2026-05-04T00:00:00.000Z" } }),
      ],
    });
    // Linear returns DESCENDING createdAt and its orderBy direction is not selectable, so arrival order is
    // incidental and must not be trusted.
    expect(sorted.map((r) => r.eventId)).toEqual(["a", "b"]);
  });

  it("breaks a same-instant tie by event id, so the order is TOTAL", () => {
    const sorted = sortHistoryRows({
      rows: [row({ overrides: { eventId: "z", tsIso: "t" } }), row({ overrides: { eventId: "a", tsIso: "t" } })],
    });
    // A partial order would let two events sharing a timestamp swap places between runs over identical data.
    expect(sorted.map((r) => r.eventId)).toEqual(["a", "z"]);
  });
});

describe("freshHistoryRows (identity dedup)", () => {
  it("keeps only events not already stored", () => {
    const fresh = freshHistoryRows({
      incoming: [
        row({ overrides: { eventId: "h1" } }),
        row({ overrides: { eventId: "h2", tsIso: "2026-05-05T00:00:00.000Z" } }),
      ],
      stored: [row({ overrides: { eventId: "h1" } })],
    });
    expect(fresh.map((r) => r.eventId)).toEqual(["h2"]);
  });

  it("collapses a duplicate WITHIN the incoming batch", () => {
    expect(
      freshHistoryRows({
        incoming: [row({ overrides: { eventId: "h1" } }), row({ overrides: { eventId: "h1" } })],
        stored: [],
      }).length,
    ).toBe(1);
  });

  it("dedupes by identity, NOT by content — an event is immutable, so a changed payload is the same event", () => {
    const fresh = freshHistoryRows({
      incoming: [row({ overrides: { changes: { toState: { name: "Something Else" } }, eventId: "h1" } })],
      stored: [row({ overrides: { eventId: "h1" } })],
    });
    expect(fresh).toEqual([]);
  });

  it("returns the survivors in canonical order", () => {
    const fresh = freshHistoryRows({
      incoming: [
        row({ overrides: { eventId: "b", tsIso: "2026-05-05T00:00:00.000Z" } }),
        row({ overrides: { eventId: "a", tsIso: "2026-05-04T00:00:00.000Z" } }),
      ],
      stored: [],
    });
    expect(fresh.map((r) => r.eventId)).toEqual(["a", "b"]);
  });
});

describe("redactHistoryRow", () => {
  it("scrubs a secret hiding in a payload string leaf", () => {
    // A long digit run, not a token literal: the same secret CLASS the redactor catches, without putting a
    // token-shaped string into a tracked file for the public hygiene gate to (correctly) flag.
    const scrubbed = redactHistoryRow({
      row: row({ overrides: { changes: { toTitle: "account 123456789012 is failing" } } }),
    });
    expect(String(scrubbed.changes["toTitle"])).toBe("account [number] is failing");
  });

  it("keeps the org's own identifiers, which ARE the capture", () => {
    const scrubbed = redactHistoryRow({ row: row({ overrides: { changes: { toState: { name: "In Review" } } } }) });
    expect(scrubbed.changes).toEqual({ toState: { name: "In Review" } });
  });
});

describe("serialise / parse round-trip", () => {
  it("parses a serialised row back to the identical value", () => {
    const original = row({ overrides: { actor: "Seth" } });
    const parsed = parseHistoryRow({ line: serialiseHistoryRow({ row: original }) });
    expect("row" in parsed).toBe(true);
    expect("row" in parsed ? parsed.row : undefined).toEqual(original);
  });

  it("omits an absent actor rather than writing null", () => {
    expect(serialiseHistoryRow({ row: row() }).includes('"actor"')).toBe(false);
  });

  it("rejects an unknown source, an unknown stream and a missing required field", () => {
    const rejects = [
      JSON.stringify({ ...row(), source: "jira" }),
      JSON.stringify({ ...row(), stream: "audit" }),
      JSON.stringify({ ...row(), eventId: "" }),
      JSON.stringify({ ...row(), version: 2 }),
      "not json",
    ].map((line) => parseHistoryRow({ line }));
    expect(rejects.every((result) => "error" in result)).toBe(true);
  });

  it("skips a corrupt line with a numbered warning rather than failing the file", () => {
    // Through the real reader, which streams the file rather than holding it as one string — the whole-file
    // `parseHistoryRows({ content })` this used to call was the shape that cannot read a file past 512 MiB.
    const home = tempHome();
    const path = historyFile({ home, source: "linear" });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${serialiseHistoryRow({ row: row() })}\nnot json\n\n`, "utf8");
    const parsed = readHistoryRows({ home, source: "linear" });
    expect(parsed.rows.length).toBe(1);
    expect(parsed.warnings.length).toBe(1);
    expect(parsed.warnings[0]!).toContain("line 2");
  });
});

describe("writeHistoryRows / readHistoryRows (real filesystem round-trip)", () => {
  it("writes the events and reads them back", () => {
    const home = tempHome();
    const wrote = unwrap(
      writeHistoryRows({
        home,
        rows: [row({ overrides: { eventId: "h1" } }), row({ overrides: { eventId: "h2" } })],
        source: "linear",
      }),
    );
    expect(wrote.written).toBe(2);
    expect(readHistoryRows({ home, source: "linear" }).rows.map((r) => r.eventId)).toEqual(["h1", "h2"]);
  });

  it("is idempotent on a retry — the second write adds nothing", () => {
    const home = tempHome();
    const rows = [row({ overrides: { eventId: "h1" } }), row({ overrides: { eventId: "h2" } })];
    writeHistoryRows({ home, rows, source: "linear" });
    const again = unwrap(writeHistoryRows({ home, rows, source: "linear" }));
    expect(again.written).toBe(0);
    expect(again.deduped).toBe(2);
    expect(readHistoryRows({ home, source: "linear" }).rows.length).toBe(2);
  });

  it("appends only the genuinely new events on an overlapping refresh", () => {
    const home = tempHome();
    writeHistoryRows({ home, rows: [row({ overrides: { eventId: "h1" } })], source: "linear" });
    const second = unwrap(
      writeHistoryRows({
        home,
        rows: [row({ overrides: { eventId: "h1" } }), row({ overrides: { eventId: "h2" } })],
        source: "linear",
      }),
    );
    expect(second.written).toBe(1);
    expect(readHistoryRows({ home, source: "linear" }).rows.map((r) => r.eventId)).toEqual(["h1", "h2"]);
  });

  it("escapes U+2028 so a line terminator in authored text cannot split a record", () => {
    const home = tempHome();
    const separator = String.fromCharCode(0x2028);
    writeHistoryRows({
      home,
      rows: [row({ overrides: { changes: { toTitle: `before${separator}after` } } })],
      source: "linear",
    });
    const raw = readFileSync(historyFile({ home, source: "linear" }), "utf8");
    // The RAW character must not reach disk: `JSON.stringify` leaves it alone, and Node's own `readline`
    // treats it as a line break, so one record would come back as two unparseable halves.
    expect(raw.includes(separator)).toBe(false);
    expect(raw).toContain("\\u2028");
    const back = readHistoryRows({ home, source: "linear" });
    expect(back.rows.length).toBe(1);
    expect(back.rows[0]!.changes["toTitle"]).toBe(`before${separator}after`);
  });

  it("reads an absent file as empty rather than throwing", () => {
    expect(readHistoryRows({ home: tempHome(), source: "linear" })).toEqual({ rows: [], warnings: [] });
  });

  it("writes nothing at all for an empty batch", () => {
    const home = tempHome();
    const wrote = unwrap(writeHistoryRows({ home, rows: [], source: "linear" }));
    expect(wrote.written).toBe(0);
    expect(readHistoryRows({ home, source: "linear" }).rows).toEqual([]);
  });

  it("keeps sources in their own files, and readAllHistory sees both", () => {
    const home = tempHome();
    writeHistoryRows({ home, rows: [row({ overrides: { eventId: "h1" } })], source: "linear" });
    writeHistoryRows({
      home,
      rows: [row({ overrides: { eventId: "g1", source: "github", subjectId: "#1" } })],
      source: "github",
    });
    expect(readHistoryRows({ home, source: "linear" }).rows.map((r) => r.eventId)).toEqual(["h1"]);
    expect(
      readAllHistory({ home })
        .rows.map((r) => r.eventId)
        .toSorted(),
    ).toEqual(["g1", "h1"]);
  });
});
