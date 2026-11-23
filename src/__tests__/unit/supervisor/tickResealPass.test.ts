/**
 * The streamed tick-reseal pass on its own: what it counts and writes over a real ledger file, the digest it takes,
 * and the refusal a finished pass earns, a moved digest first.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { TickResealErrors } from "../../../supervisor/tickResealErrors.js";
import { type PassOutcome, passRefusal, resealPass, sha256OfFile } from "../../../supervisor/tickResealPass.js";
import { supervisorTickLine } from "../../../supervisor/tickStore.js";
import type { SupervisorTickRow } from "../../../supervisor/tickTypes.js";
import { backwardsTick, soundTick, staleTick } from "./tickResealFixture.js";

const FIRST = soundTick({ finalisedIso: "2026-11-10T09:00:00.000Z", tickId: "tick-1" });
const SECOND = soundTick({ finalisedIso: "2026-11-10T09:20:00.000Z", tickId: "tick-2" });

/** A pass that stands: one row read, one changed, no defect. */
const STANDING: PassOutcome = {
  defects: [],
  rowsChanged: 1,
  rowsRead: 1,
  rowsRenderedAsRead: 1,
  sha256: "a".repeat(64),
};

describe("tickResealPass", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  /**
   * A throwaway ledger file holding the given rows, one line each.
   *
   * @param rows the rows, in file order
   * @returns the file's path
   */
  function ledgerOf({ rows }: { rows: readonly SupervisorTickRow[] }): string {
    const dir = mkdtempSync(join(tmpdir(), "tick-pass-"));
    dirs.push(dir);
    const path = join(dir, "supervisor-ticks.jsonl");
    writeFileSync(path, rows.map((row) => `${supervisorTickLine({ row })}\n`).join(""));
    return path;
  }

  it("hashes a whole file to the digest of its bytes", () => {
    const path = ledgerOf({ rows: [FIRST, SECOND] });
    expect(sha256OfFile({ path })).toBe(createHash("sha256").update(readFileSync(path)).digest("hex"));
  });

  it("counts a stale row, rewrites only it, and keeps the sound row's exact line", () => {
    const path = ledgerOf({ rows: [FIRST, staleTick({ row: SECOND })] });
    const written: string[] = [];
    const outcome = resealPass({ label: path, source: path, write: ({ text }) => written.push(text) });
    expect([outcome.rowsRead, outcome.rowsChanged, outcome.defects]).toEqual([2, 1, []]);
    expect(outcome.sha256).toBe(sha256OfFile({ path }));
    expect(written).toEqual([`${supervisorTickLine({ row: FIRST })}\n`, `${supervisorTickLine({ row: SECOND })}\n`]);
  });

  it("records a defect a reseal does not repair, naming the ledger line", () => {
    const path = ledgerOf({ rows: [FIRST, backwardsTick({ row: SECOND })] });
    const outcome = resealPass({ label: path, source: path, write: undefined });
    expect(outcome.defects.length).toBe(1);
    expect(outcome.defects[0]).toContain(`${path}:2:`);
  });

  it("refuses a moved digest before any other finding", () => {
    const outcome: PassOutcome = { ...STANDING, defects: ["x:1: broken"] };
    expect(passRefusal({ expected: "b".repeat(64), outcome, path: "ledger" })).toEqual(
      TickResealErrors.sourceMoved({ actual: "a".repeat(64), expected: "b".repeat(64) }),
    );
  });

  it("refuses a pass with defects, and one that read no rows", () => {
    expect(passRefusal({ expected: undefined, outcome: { ...STANDING, defects: ["x:1: broken"] }, path: "l" })).toEqual(
      TickResealErrors.ledgerRefused({ reasons: ["x:1: broken"] }),
    );
    expect(passRefusal({ expected: undefined, outcome: { ...STANDING, rowsRead: 0 }, path: "l" })).toEqual(
      TickResealErrors.ledgerUnreadable({ path: "l", why: "it holds no tick rows" }),
    );
  });

  it("lets a standing pass through, with or without a digest named", () => {
    expect(passRefusal({ expected: undefined, outcome: STANDING, path: "l" })).toBeUndefined();
    expect(passRefusal({ expected: "a".repeat(64), outcome: STANDING, path: "l" })).toBeUndefined();
  });
});
