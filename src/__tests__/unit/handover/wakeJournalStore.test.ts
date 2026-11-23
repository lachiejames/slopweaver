/**
 * The wake journal's file and the per-park claim, over a throwaway home: a fresh install reads empty, an unreadable
 * line fails the whole read, and a live claim turns a second claimant away until it is released.
 */
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import type { WakeAttemptRow } from "../../../handover/wakeJournal.js";
import { appendWakeJournalRow, claimWakePark, readWakeJournal } from "../../../handover/wakeJournalStore.js";
import { stateHomePaths } from "../../../stateHome.js";

const ROW: WakeAttemptRow = {
  atIso: "2026-10-15T03:13:00.000Z",
  kind: "attempt",
  nonce: "n-1",
  observed: { atIso: "2026-10-15T03:00:00Z", kind: "at" },
  parkIndex: 2,
  parkedAtIso: "2026-10-15T02:00:00.000Z",
  slug: "row",
};

const PARK = { parkIndex: 2, parkedAtIso: "2026-10-15T02:00:00.000Z", slug: "row" } as const;

describe("wakeJournalStore", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "wake-journal-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const path = (): string => stateHomePaths({ home }).handoverWakeJournalJsonl;

  it("reads a missing journal as no rows", () => {
    expect(unwrap(readWakeJournal({ home }))).toEqual([]);
  });

  it("appends owner-only rows and reads them back in order", () => {
    const settled = { action: "spawned", atIso: "2026-10-15T03:14:00.000Z", kind: "settled", nonce: "n-1" } as const;
    unwrap(appendWakeJournalRow({ home, row: ROW }));
    unwrap(appendWakeJournalRow({ home, row: settled }));
    expect(unwrap(readWakeJournal({ home }))).toEqual([ROW, settled]);
    expect(statSync(path()).mode & 0o777).toBe(0o600);
  });

  it("fails the whole read on a line that is not a row, naming the line", () => {
    mkdirSync(dirname(path()), { recursive: true });
    writeFileSync(path(), `${JSON.stringify(ROW)}\n{"kind":"attempt"}\n`);
    const failure = unwrapErr(readWakeJournal({ home }));
    expect(failure.code).toBe("WAKE_JOURNAL_UNREADABLE");
    expect(failure.message).toContain("line 2 is not a wake row");
  });

  it("turns a second claim on the same park away while the first is held, and grants it once released", () => {
    const nowIso = "2026-10-15T03:13:00.000Z";
    const first = unwrap(claimWakePark({ home, nowIso, ...PARK }));
    const second = unwrap(claimWakePark({ home, nowIso, ...PARK }));
    const otherPark = unwrap(claimWakePark({ home, nowIso, ...PARK, parkIndex: 5 }));
    expect([first.kind, second.kind, otherPark.kind]).toEqual(["claimed", "in-flight", "claimed"]);
    if (first.kind !== "claimed" || otherPark.kind !== "claimed") {
      throw new Error("expected both distinct parks claimed");
    }
    first.release();
    otherPark.release();
    expect(unwrap(claimWakePark({ home, nowIso, ...PARK })).kind).toBe("claimed");
  });
});
