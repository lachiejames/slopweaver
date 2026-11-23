import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { RunSnapshot } from "../../../sessionStart/reconcile.js";
import {
  latestSnapshot,
  parseSnapshots,
  readRunStore,
  recordRun,
  runStorePath,
  snapshotLine,
} from "../../../sessionStart/runStore.js";

const homes: string[] = [];

/** A throwaway state home, removed after the test that minted it. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-runstore-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

const snapshot = (over: Partial<RunSnapshot> = {}): RunSnapshot => ({
  atIso: "2026-08-29T00:00:00.000Z",
  items: [{ closing: false, identity: "linear:AAA-1", state: "open", whenIso: "2026-08-20T00:00:00.000Z" }],
  ...over,
});

describe("snapshotLine", () => {
  it("renders a fixed key order, so two runs writing one snapshot produce identical bytes", () => {
    expect(snapshotLine({ snapshot: snapshot() })).toBe(
      '{"atIso":"2026-08-29T00:00:00.000Z","items":[{"closing":false,"identity":"linear:AAA-1","whenIso":"2026-08-20T00:00:00.000Z","state":"open"}],"schemaVersion":1}',
    );
  });
});

describe("parseSnapshots", () => {
  it("round-trips a rendered snapshot", () => {
    expect(parseSnapshots({ text: snapshotLine({ snapshot: snapshot() }) })).toStrictEqual([snapshot()]);
  });

  it("skips a truncated final line rather than losing every baseline", () => {
    const text = `${snapshotLine({ snapshot: snapshot() })}\n{"atIso":"2026-08-30","ite`;
    expect(parseSnapshots({ text })).toHaveLength(1);
  });

  it("drops an item it cannot read while keeping the snapshot around it", () => {
    const text = '{"atIso":"t","items":[{"identity":"linear:A","whenIso":"w","closing":false},{"identity":7}]}';
    expect(parseSnapshots({ text })[0]!.items.map((one) => one.identity)).toStrictEqual(["linear:A"]);
  });

  it("reads an empty store as no snapshots at all", () => {
    expect(parseSnapshots({ text: "" })).toStrictEqual([]);
  });
});

describe("latestSnapshot", () => {
  it("takes the last line, which is append order rather than newest instant", () => {
    const older = snapshot({ atIso: "2026-08-31T00:00:00.000Z" });
    const written = snapshot({ atIso: "2026-08-29T00:00:00.000Z" });
    expect(latestSnapshot({ snapshots: [older, written] })!.atIso).toBe("2026-08-29T00:00:00.000Z");
  });

  it("has nothing to offer an empty store", () => {
    expect(latestSnapshot({ snapshots: [] })).toBeUndefined();
  });
});

describe("recordRun", () => {
  it("writes a snapshot a later run reads back", () => {
    const home = scratchHome();
    const written = recordRun({ home, snapshot: snapshot() });
    expect(written.isOk()).toBe(true);
    expect(parseSnapshots({ text: readRunStore({ home }) })).toStrictEqual([snapshot()]);
  });

  it("appends rather than replacing, so yesterday's baseline survives today's run", () => {
    const home = scratchHome();
    recordRun({ home, snapshot: snapshot() });
    recordRun({ home, snapshot: snapshot({ atIso: "2026-08-30T00:00:00.000Z" }) });
    const stored = parseSnapshots({ text: readRunStore({ home }) });
    expect(stored.map((one) => one.atIso)).toStrictEqual(["2026-08-29T00:00:00.000Z", "2026-08-30T00:00:00.000Z"]);
  });

  it("puts the store beside the lock-in ledger", () => {
    const home = scratchHome();
    expect(runStorePath({ home })).toBe(join(home, "ledgers", "session-start", "runs.jsonl"));
  });
});

describe("readRunStore", () => {
  it("reads a home that has never run as empty, not as broken", () => {
    expect(readRunStore({ home: scratchHome() })).toBe("");
  });
});
