import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stateHomePaths } from "../../../stateHome.js";
import type { RowAnchors } from "../../../supervisor/intake.js";
import type { TypedIntakeReport } from "../../../supervisor/typedIntake.js";
import { readTypedIntake } from "../../../supervisor/typedIntakeRead.js";
import { callsDir } from "../../../talk/callStore.js";

const CALL = "a0000035-0000-4000-8000-0000000000a1";
const SEGMENT = "typed-owner-aaaaaaaa-0000-4000-8000-000000000001";
const POINTER = `talk-call:${CALL}#${SEGMENT}`;
const TURN_AT = "2026-11-27T01:05:00.000Z";
const WORDS = "fix the button this shows";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "typed-intake-"));
  const dir = callsDir({ home });
  mkdirSync(dir, { recursive: true });
  const text = `${WORDS}\n\n[Attached: "fixture-2.png", a picture of 9 KB, saved at "/synthetic/fixture-2.png". Read it with file_read.]`;
  const line = { atIso: TURN_AT, final: true, id: SEGMENT, kind: "segment", text, who: "owner" };
  const path = join(dir, `${CALL}.jsonl`);
  writeFileSync(path, `${JSON.stringify(line)}\n`);
  // The file was last written as the turn landed, so a read whose floor is past it never opens it again.
  const at = new Date(TURN_AT);
  utimesSync(path, at, at);
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One read at an instant against the rows given. */
function read({ nowIso, rows = [] }: { nowIso: string; rows?: readonly RowAnchors[] }): TypedIntakeReport {
  return readTypedIntake({ home, marks: [], nowIso, rows, sinceIso: undefined });
}

/** The unwitnessed pointers of a read report. */
function unwitnessedOf({ report }: { report: TypedIntakeReport }): readonly string[] {
  expect(report.kind).toBe("read");
  const finding = (report as Extract<TypedIntakeReport, { kind: "read" }>).finding;
  return finding.unwitnessed.map((turn) => turn.pointer);
}

describe("readTypedIntake", () => {
  it("still owes a turn three days on, after the call file has dropped out of discovery", () => {
    expect(unwitnessedOf({ report: read({ nowIso: "2026-11-27T02:00:00.000Z" }) })).toEqual([POINTER]);
    expect(unwitnessedOf({ report: read({ nowIso: "2026-11-30T02:00:00.000Z" }) })).toEqual([POINTER]);
  });

  it("owes a turn on a home's first read, a day and more after it was typed", () => {
    expect(unwitnessedOf({ report: read({ nowIso: "2026-11-28T02:05:00.000Z" }) })).toEqual([POINTER]);
  });

  it("owes a turn whose first read failed, when the next read is past the window", () => {
    const path = join(callsDir({ home }), `${CALL}.jsonl`);
    chmodSync(path, 0o000);
    const failed = read({ nowIso: "2026-11-27T02:00:00.000Z" });
    chmodSync(path, 0o600);
    expect(failed.kind).toBe("read");
    expect((failed as Extract<TypedIntakeReport, { kind: "read" }>).finding.unreadable.length).toBe(1);
    expect(unwitnessedOf({ report: read({ nowIso: "2026-11-28T03:00:00.000Z" }) })).toEqual([POINTER]);
  });

  it("clears for good once a row names it, so a row swept later does not raise it", () => {
    read({ nowIso: "2026-11-27T02:00:00.000Z" });
    const rows: RowAnchors[] = [{ anchor: POINTER, settlementWitness: undefined, slug: "fix-the-button" }];
    expect(unwitnessedOf({ report: read({ nowIso: "2026-11-27T03:00:00.000Z", rows }) })).toEqual([]);
    const after = read({ nowIso: "2026-11-28T03:00:00.000Z" });
    expect(after.kind).toBe("read");
    expect((after as Extract<TypedIntakeReport, { kind: "read" }>).finding.turns).toEqual([]);
  });

  it("keeps the ledger owner-only and free of the turn's words", () => {
    read({ nowIso: "2026-11-27T02:00:00.000Z" });
    const path = stateHomePaths({ home }).typedIntakeJsonl;
    const ledger = readFileSync(path, "utf8");
    expect(ledger).toContain(POINTER);
    expect(ledger).not.toContain(WORDS);
    expect(ledger).not.toContain("fixture-2.png");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("is unavailable, never empty, when the ledger is present and unreadable", () => {
    mkdirSync(stateHomePaths({ home }).typedIntakeJsonl, { recursive: true });
    const report = read({ nowIso: "2026-11-27T02:00:00.000Z" });
    expect(report.kind).toBe("unavailable");
    expect((report as Extract<TypedIntakeReport, { kind: "unavailable" }>).why).toContain("could not be read");
  });
});
