/**
 * The one-time door import, over a temp ledger and an in-memory {@link DoorImportStore} that keeps the table's
 * unique import key, its `seq` order and the fill-only-an-empty-record upsert. What only Postgres decides is
 * `integration/doorLedgerStore.test.ts`'s.
 */
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runDoorLeg } from "../../../../cli/commands/store/importDoorLeg.js";
import type { DoorImportStore } from "../../../../cli/commands/store/importDoorPasses.js";
import { FLUSH_ROWS } from "../../../../cli/commands/store/importFleetCore.js";
import { err, ok, unwrap } from "../../../../lib/result.js";
import { StoreErrors } from "../../../../store/errors.js";
import { LAST_PROVEN_TEST_WRITE_ISO, projectDoorLine } from "../../../../store/fleet/doorEvent.js";
import type { StoredDoorImportRow } from "../../../../store/fleet/doorImport.js";
import type { NewDoorEventRecord } from "../../../../store/schema/ledgers.js";

/** Every directory this file has minted, so `afterEach` can remove them. */
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway ledger holding these lines, and its path. */
function ledger({ lines }: { lines: readonly string[] }): string {
  const dir = mkdtempSync(join(tmpdir(), "door-leg-"));
  dirs.push(dir);
  const path = join(dir, "door.jsonl");
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

/** One door decision's line, distinct per `n`. */
function decision({ n }: { n: number }): string {
  return JSON.stringify({
    action: "verb:slack.post",
    effect: "external-write",
    findings: [],
    overridden: [],
    runId: `run-${String(n)}`,
    schemaVersion: 1,
    status: "pass",
    tsIso: "2026-10-01T00:00:00.000Z",
  });
}

/** The row the import projects for a line at this physical line number. */
function rowOf({
  line,
  lineNumber,
  path,
}: {
  line: string;
  lineNumber: number;
  path: string;
}): NewDoorEventRecord & { record: Readonly<Record<string, unknown>> } {
  const row = unwrap(projectDoorLine({ guardIso: LAST_PROVEN_TEST_WRITE_ISO, line, lineNumber, path }));
  // A projected line always carries its record; only a hand-built row leaves it out.
  return { ...row, record: row.record! };
}

/** The seeded store row for a line: only the import key and record, so the store assigns `seq` itself. */
function seedOf({ line, lineNumber, path }: { line: string; lineNumber: number; path: string }): {
  importKey: string;
  record: Readonly<Record<string, unknown>>;
} {
  const { importKey, record } = rowOf({ line, lineNumber, path });
  return { importKey, record };
}

/** The stored shape of a row's record: a row built without one is stored as `null`, never as a missing key. */
function storedRecord({ row }: { row: NewDoorEventRecord }): Readonly<Record<string, unknown>> | null {
  if (row.record === undefined) {
    return null;
  }
  return row.record;
}

/** An in-memory import store: one row per import key, `seq` in insertion order, an empty record filled once. */
function memoryImportStore({
  failInsert = false,
  imported = false,
  onImported = () => undefined,
  onMark = () => undefined,
  seed = [],
}: {
  failInsert?: boolean;
  imported?: boolean;
  onImported?: () => void;
  onMark?: () => void;
  seed?: readonly { importKey: string; record: Readonly<Record<string, unknown>> | null; seq?: number }[];
} = {}): DoorImportStore & { rows: StoredDoorImportRow[]; marked: () => boolean; insertCalls: () => number } {
  const rows: StoredDoorImportRow[] = seed.map((row, index) => ({ seq: index + 1, ...row }));
  const state = { insertCalls: 0, marked: imported };
  return {
    imported: () => {
      onImported();
      return Promise.resolve(ok(state.marked));
    },
    insert: ({ rows: incoming }) => {
      state.insertCalls += 1;
      if (failInsert) {
        return Promise.resolve(err(StoreErrors.queryFailed({ cause: new Error("boom"), what: "insert" })));
      }
      let written = 0;
      for (const row of incoming) {
        const at = rows.findIndex((held) => held.importKey === row.importKey);
        if (at === -1) {
          rows.push({ importKey: row.importKey, record: storedRecord({ row }), seq: rows.length + 1 });
          written += 1;
          continue;
        }
        if (rows[at]!.record === null) {
          rows[at] = { ...rows[at]!, record: storedRecord({ row }) };
          written += 1;
        }
      }
      return Promise.resolve(ok(written));
    },
    insertCalls: () => state.insertCalls,
    mark: () => {
      onMark();
      state.marked = true;
      return Promise.resolve(ok(undefined));
    },
    marked: () => state.marked,
    readPage: ({ afterSeq, limit }) =>
      Promise.resolve(
        ok(
          rows
            .filter((row) => !row.importKey.startsWith("written:") && (afterSeq === undefined || row.seq > afterSeq))
            .toSorted((a, b) => a.seq - b.seq)
            .slice(0, limit),
        ),
      ),
    rows,
  };
}

describe("runDoorLeg", () => {
  it("names an absent ledger rather than reading nothing quietly", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "door-leg-")), "door.jsonl");
    dirs.push(join(path, ".."));

    const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store: undefined });

    expect(outcome.absentSource).toBe(path);
    expect(outcome.projected).toBe(0);
    expect(outcome.leg).toBe("door");
  });

  it("validates every line on a dry run, skipping a blank one and naming the one it refused", async () => {
    const path = ledger({ lines: [decision({ n: 1 }), "", "{not json", decision({ n: 2 })] });

    const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store: undefined });

    expect(outcome.projected).toBe(2);
    expect(outcome.written).toBe(0);
    expect(outcome.refused.map((error) => error.message)).toEqual([`${path}:3 did not decode as a JSON object`]);
  });

  it("imports every line verbatim, reads it back clean and marks the import last", async () => {
    const lines = [decision({ n: 1 }), decision({ n: 2 })];
    const path = ledger({ lines });
    const store = memoryImportStore();

    const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store });

    expect(outcome.refused).toEqual([]);
    expect(outcome.written).toBe(2);
    expect(store.marked()).toBe(true);
    expect(outcome.notes).toEqual(["marked imported — the store is the door's ledger from here on"]);
    expect(store.rows.map((row) => row.record)).toEqual(lines.map((line) => JSON.parse(line)));
  });

  it("writes nothing and marks nothing while any line is refused", async () => {
    const path = ledger({ lines: [decision({ n: 1 }), '{"status":"pass"}'] });
    const store = memoryImportStore();

    const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store });

    expect(store.insertCalls()).toBe(0);
    expect(store.marked()).toBe(false);
    expect(outcome.refused.map((error) => error.code)).toEqual(["MISSING_FIELD"]);
    expect(outcome.notes).toEqual(["nothing written — 1 line(s) refused; repair them, then import again"]);
  });

  it("refuses a line holding a NUL rather than storing it stripped", async () => {
    const nul = JSON.stringify({ ...JSON.parse(decision({ n: 1 })), note: "a\u0000b" });
    const path = ledger({ lines: [nul] });
    const store = memoryImportStore();

    const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store });

    expect(store.insertCalls()).toBe(0);
    expect(store.marked()).toBe(false);
    expect(outcome.refused).toHaveLength(1);
    expect(outcome.refused[0]!.code).toBe("DOOR_IMPORT_DIVERGED");
    expect(outcome.refused[0]!.message).toContain(`${path}:1 cannot be stored as the door's verbatim record`);
  });

  it("fills the record of a mirror row the one-way mirror projected without one", async () => {
    const line = decision({ n: 1 });
    const path = ledger({ lines: [line] });
    const { importKey } = rowOf({ line, lineNumber: 1, path });
    const store = memoryImportStore({ seed: [{ importKey, record: null }] });

    const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store });

    expect(outcome.refused).toEqual([]);
    expect(outcome.written).toBe(1);
    expect(store.rows[0]!.record).toEqual(JSON.parse(line));
    expect(store.marked()).toBe(true);
  });

  it("never overwrites a stored record that differs from its line, and leaves the door refused", async () => {
    const line = decision({ n: 1 });
    const path = ledger({ lines: [line] });
    const { importKey } = rowOf({ line, lineNumber: 1, path });
    const store = memoryImportStore({ seed: [{ importKey, record: { status: "hold" } }] });

    const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store });

    expect(store.rows[0]!.record).toEqual({ status: "hold" });
    expect(outcome.refused.map((error) => error.message)).toEqual([
      `${path} and door_event disagree at ${importKey}: the stored record differs from the line; nothing was overwritten`,
    ]);
    expect(store.marked()).toBe(false);
  });

  it("refuses a stored row the file has no line for, but ignores the rows the door wrote live", async () => {
    const path = ledger({ lines: [decision({ n: 1 })] });
    const store = memoryImportStore({
      seed: [
        { importKey: "stray", record: { status: "pass" } },
        { importKey: "written:abc", record: { status: "pass" } },
      ],
    });

    const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store });

    expect(outcome.refused.map((error) => error.message)).toEqual([
      `${path} and door_event disagree at stray: the store holds a row the file has no line for; nothing was overwritten`,
    ]);
    expect(store.marked()).toBe(false);
  });

  it("refuses loudly when a line is appended while the marker is being written, and the rerun names it", async () => {
    const path = ledger({ lines: [decision({ n: 1 })] });
    const store = memoryImportStore({ onMark: () => appendFileSync(path, `${decision({ n: 2 })}\n`) });

    const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store });

    expect(outcome.refused.map((error) => error.message)).toEqual([
      `the store refused rows projected from ${path}: the file changed while the import was being marked — the marker stands; stop every seat still writing it, then import again to verify`,
    ]);
    expect(outcome.notes).toEqual([]);
    const second = rowOf({ line: decision({ n: 2 }), lineNumber: 2, path }).importKey;
    const rerun = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store });
    expect(rerun.refused.map((error) => error.message)).toEqual([
      `${path} and door_event disagree at ${second}: the file's line has no row; nothing was overwritten`,
    ]);
  });

  it("refuses a verify-only run when a line is appended after the file was read", async () => {
    const line = decision({ n: 1 });
    const path = ledger({ lines: [line] });
    const { importKey, record } = rowOf({ line, lineNumber: 1, path });
    const store = memoryImportStore({
      imported: true,
      onImported: () => appendFileSync(path, `${decision({ n: 2 })}\n`),
      seed: [{ importKey, record }],
    });

    const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store });

    expect(outcome.refused.map((error) => error.message)).toEqual([
      `the store refused rows projected from ${path}: the file changed while it was being verified — stop every seat still writing it, then import again`,
    ]);
  });

  it("reads back a stray row written by hand at the lowest seq a number can hold", async () => {
    const line = decision({ n: 1 });
    const path = ledger({ lines: [line] });
    const { importKey, record } = rowOf({ line, lineNumber: 1, path });
    const store = memoryImportStore({
      imported: true,
      seed: [
        { importKey, record, seq: 1 },
        { importKey: "stray", record: { status: "pass" }, seq: Number.MIN_SAFE_INTEGER },
      ],
    });

    const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store });

    expect(outcome.refused.map((error) => error.message)).toEqual([
      `${path} and door_event disagree at stray: the store holds a row the file has no line for; nothing was overwritten`,
    ]);
  });

  it("reports a failed write as the store's own failure and marks nothing", async () => {
    const path = ledger({ lines: [decision({ n: 1 })] });
    const store = memoryImportStore({ failInsert: true });

    const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store });

    expect(outcome.refused.map((error) => error.code)).toEqual(["LEG_WRITE_FAILED"]);
    expect(store.marked()).toBe(false);
  });

  it("only verifies once the import is marked, writing nothing", async () => {
    const line = decision({ n: 1 });
    const path = ledger({ lines: [line] });
    const { importKey, record } = rowOf({ line, lineNumber: 1, path });
    const store = memoryImportStore({ imported: true, seed: [{ importKey, record }] });

    const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store });

    expect(store.insertCalls()).toBe(0);
    expect(outcome.refused).toEqual([]);
    expect(outcome.notes).toEqual([
      "already imported — verified only; the store is the ledger and the file is not read for it",
    ]);
  });

  it("names a still-unfilled row and a line with no row when it verifies a marked import", async () => {
    const lines = [decision({ n: 1 }), decision({ n: 2 })];
    const path = ledger({ lines });
    const first = rowOf({ line: lines[0]!, lineNumber: 1, path }).importKey;
    const second = rowOf({ line: lines[1]!, lineNumber: 2, path }).importKey;
    const store = memoryImportStore({ imported: true, seed: [{ importKey: first, record: null }] });

    const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store });

    expect(outcome.refused.map((error) => error.message)).toEqual([
      `${path} and door_event disagree at ${first}: the row's record was never filled; nothing was overwritten`,
      `${path} and door_event disagree at ${second}: the file's line has no row; nothing was overwritten`,
    ]);
  });

  describe("--adopt-unmatched-door-lines", () => {
    /** A marked store holding rows for the first `held` of these lines — the rest appended after the marker. */
    function markedAfterLateAppend({ held, total }: { held: number; total: number }): {
      path: string;
      lines: string[];
      store: ReturnType<typeof memoryImportStore>;
    } {
      const lines = Array.from({ length: total }, (_, n) => decision({ n }));
      const path = ledger({ lines });
      const seed = lines.slice(0, held).map((line, n) => seedOf({ line, lineNumber: n + 1, path }));
      return { lines, path, store: memoryImportStore({ imported: true, seed }) };
    }

    it("writes nothing without the flag, naming each late line as before", async () => {
      const { path, store } = markedAfterLateAppend({ held: 1, total: 2 });

      const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store });

      expect(store.insertCalls()).toBe(0);
      expect(outcome.refused.map((error) => error.code)).toEqual(["DOOR_IMPORT_DIVERGED"]);
    });

    it("adopts every late line in file order, reads back clean and names each one", async () => {
      const { lines, path, store } = markedAfterLateAppend({ held: 1, total: 3 });
      const second = rowOf({ line: lines[1]!, lineNumber: 2, path }).importKey;
      const third = rowOf({ line: lines[2]!, lineNumber: 3, path }).importKey;

      const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: true, path, store });

      expect(outcome.refused).toEqual([]);
      expect(outcome.written).toBe(2);
      expect(store.rows.map((row) => row.importKey).slice(1)).toEqual([second, third]);
      expect(store.rows.map((row) => row.record)).toEqual(lines.map((line) => JSON.parse(line)));
      expect(outcome.notes).toEqual([
        `adopted door line ${path}:2 as ${second}`,
        `adopted door line ${path}:3 as ${third}`,
        "adopted — the final read-back is clean; the store is the door's ledger",
      ]);
      const verify = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store });
      expect(verify.refused).toEqual([]);
      expect(store.insertCalls()).toBe(1);
    });

    it("adopts nothing when any divergence is not a line with no row, and keeps every stored record", async () => {
      const lines = [decision({ n: 1 }), decision({ n: 2 })];
      const path = ledger({ lines });
      const first = rowOf({ line: lines[0]!, lineNumber: 1, path }).importKey;
      const store = memoryImportStore({
        imported: true,
        seed: [
          { importKey: first, record: { status: "hold" } },
          { importKey: "stray", record: { status: "pass" } },
        ],
      });

      const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: true, path, store });

      expect(store.insertCalls()).toBe(0);
      expect(store.rows.map((row) => row.record)).toEqual([{ status: "hold" }, { status: "pass" }]);
      expect(outcome.refused).toHaveLength(3);
      expect(outcome.notes).toEqual([
        "adoption skipped — a divergence other than a line with no row, or a changed file; nothing written",
      ]);
    });

    it("adopts nothing when the file changed after it was read", async () => {
      const lines = [decision({ n: 1 }), decision({ n: 2 })];
      const path = ledger({ lines });
      const store = memoryImportStore({
        imported: true,
        onImported: () => appendFileSync(path, `${decision({ n: 3 })}\n`),
        seed: [seedOf({ line: lines[0]!, lineNumber: 1, path })],
      });

      const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: true, path, store });

      expect(store.insertCalls()).toBe(0);
      expect(outcome.refused.map((error) => error.code)).toEqual(["DOOR_IMPORT_DIVERGED", "LEG_WRITE_FAILED"]);
    });

    it("reports a failed adoption write as the store's failure and claims no adopted line", async () => {
      const lines = [decision({ n: 1 }), decision({ n: 2 })];
      const path = ledger({ lines });
      const store = memoryImportStore({
        failInsert: true,
        imported: true,
        seed: [seedOf({ line: lines[0]!, lineNumber: 1, path })],
      });

      const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: true, path, store });

      expect(outcome.refused.map((error) => error.code)).toEqual(["LEG_WRITE_FAILED", "DOOR_IMPORT_DIVERGED"]);
      expect(outcome.notes).toEqual([
        "adoption not confirmed — the final read-back is not clean; import again with the flag",
      ]);
    });

    it("refuses on an unmarked store rather than running a first import nobody asked it for", async () => {
      const path = ledger({ lines: [decision({ n: 1 })] });
      const store = memoryImportStore();

      const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: true, path, store });

      expect(store.insertCalls()).toBe(0);
      expect(store.marked()).toBe(false);
      expect(outcome.refused.map((error) => error.code)).toEqual(["LEG_WRITE_FAILED"]);
      expect(outcome.notes).toEqual(["nothing written — adoption needs a marked import"]);
    });

    it("says there is nothing to adopt when a marked import already reads back clean", async () => {
      const { path, store } = markedAfterLateAppend({ held: 2, total: 2 });

      const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: true, path, store });

      expect(store.insertCalls()).toBe(0);
      expect(outcome.refused).toEqual([]);
      expect(outcome.notes).toEqual(["already imported — verified clean; no line without a row, so nothing to adopt"]);
    });
  });

  it("keeps line numbers absolute across resumed batches and pages, so a large ledger reads back clean", async () => {
    const lines = Array.from({ length: FLUSH_ROWS + 300 }, (_, n) => decision({ n }));
    const path = ledger({ lines });
    const store = memoryImportStore();

    const outcome = await runDoorLeg({ adoptUnmatchedDoorLines: false, path, store });

    expect(store.insertCalls()).toBeGreaterThan(1);
    expect(outcome.refused).toEqual([]);
    expect(outcome.written).toBe(FLUSH_ROWS + 300);
    expect(store.rows.at(-1)!.importKey).toBe(
      rowOf({ line: lines.at(-1)!, lineNumber: FLUSH_ROWS + 300, path }).importKey,
    );
    expect(store.marked()).toBe(true);
  });
});
