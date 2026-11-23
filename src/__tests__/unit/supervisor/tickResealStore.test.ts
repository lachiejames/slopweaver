/**
 * `supervisor tick-reseal` against a real throwaway home: the preview writes nothing, the apply backs up, rewrites,
 * reads back clean and journals, a moved digest or a defect a reseal does not repair leaves the home untouched, and
 * the append shares the reseal's lock.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../admit/operationLock.js";
import { runSupervisorTickReseal } from "../../../cli/commands/supervisor/tickResealRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { visitSupervisorTicks } from "../../../supervisor/tickLedgerCheck.js";
import { TickResealErrors } from "../../../supervisor/tickResealErrors.js";
import {
  applyTickReseal,
  previewTickReseal,
  tickResealBackupPath,
  tickResealJournalPath,
} from "../../../supervisor/tickResealStore.js";
import {
  appendSupervisorTick,
  supervisorLedgerDir,
  supervisorTickLedgerPath,
  supervisorTickLine,
  TICK_LEDGER_LOCK_KEY,
} from "../../../supervisor/tickStore.js";
import type { SupervisorTickRow } from "../../../supervisor/tickTypes.js";
import { backwardsTick, soundTick, staleTick } from "./tickResealFixture.js";

const NOW = "2026-11-17T10:20:30.456Z";
const FIRST = soundTick({ finalisedIso: "2026-11-10T09:00:00.000Z", tickId: "tick-1" });
const SECOND = soundTick({ finalisedIso: "2026-11-10T09:20:00.000Z", tickId: "tick-2" });
const THIRD = soundTick({ finalisedIso: "2026-11-10T09:40:00.000Z", tickId: "tick-3" });

/**
 * The sha256 of a file's bytes.
 *
 * @param path the file
 * @returns the hex digest
 */
function sha256Of({ path }: { path: string }): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("supervisor tick-reseal", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  /**
   * A throwaway home whose ledger holds the given rows, one line each.
   *
   * @param rows the rows, in file order
   * @returns the home and its ledger's path
   */
  function homeWith({ rows }: { rows: readonly SupervisorTickRow[] }): { home: string; path: string } {
    const home = mkdtempSync(join(tmpdir(), "tick-reseal-"));
    homes.push(home);
    mkdirSync(supervisorLedgerDir({ home }), { recursive: true });
    const path = supervisorTickLedgerPath({ home });
    writeFileSync(path, rows.map((row) => `${supervisorTickLine({ row })}\n`).join(""), { mode: 0o600 });
    return { home, path };
  }

  const carried = (): { home: string; path: string } =>
    homeWith({ rows: [FIRST, staleTick({ row: SECOND }), staleTick({ row: THIRD })] });

  it("previews: counts the stale rows, prints the whole file's digest, and writes nothing", () => {
    const { home, path } = carried();
    const before = readFileSync(path);

    const plan = unwrap(previewTickReseal({ home }));

    expect(plan).toEqual({
      path,
      rowsChanged: 2,
      rowsRead: 3,
      rowsRenderedAsRead: 3,
      sourceSha256: sha256Of({ path }),
    });
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(supervisorLedgerDir({ home }))).toEqual(["supervisor-ticks.jsonl"]);
  });

  it("refuses a row with a defect a reseal does not repair, naming its line", () => {
    const { home, path } = homeWith({ rows: [FIRST, backwardsTick({ row: SECOND })] });

    const error = unwrapErr(previewTickReseal({ home }));

    expect(error.code).toBe("LEDGER_REFUSED");
    expect(error.message).toContain(`${path}:2: `);
    expect(error.message).toContain("is before startedIso");
  });

  it("refuses a ledger the ordinary reader refuses for its order — a repeated tickId", () => {
    const { home, path } = homeWith({ rows: [FIRST, staleTick({ row: FIRST })] });

    const error = unwrapErr(previewTickReseal({ home }));

    expect(error.code).toBe("LEDGER_REFUSED");
    expect(error.message).toContain(`${path}:2: tickId tick-1 appears twice`);
  });

  it("applies: backs up the original, rewrites only the stale rows, reads back clean, and journals a receipt", () => {
    const { home, path } = carried();
    const original = readFileSync(path);
    const sourceSha256 = sha256Of({ path });
    expect(visitSupervisorTicks({ onTick: () => undefined, path }).isErr()).toBe(true);

    const { receipt, journalPath } = unwrap(
      applyTickReseal({ home, nowIso: NOW, reason: "carried home", sourceSha256 }),
    );

    const backupPath = tickResealBackupPath({ home, nowIso: NOW });
    expect(backupPath).toBe(join(supervisorLedgerDir({ home }), "supervisor-ticks.pre-reseal-20261117T102030Z.jsonl"));
    expect(readFileSync(backupPath).equals(original)).toBe(true);
    expect(statSync(backupPath).mode & 0o777).toBe(0o600);
    expect(unwrap(visitSupervisorTicks({ onTick: () => undefined, path })).ticksRead).toBe(3);
    expect(readFileSync(path, "utf8")).toBe(
      [FIRST, SECOND, THIRD].map((row) => `${supervisorTickLine({ row })}\n`).join(""),
    );
    expect(receipt).toEqual({
      backupPath,
      ledgerPath: path,
      reason: "carried home",
      resealedAtIso: NOW,
      resultSha256: sha256Of({ path }),
      rowsChanged: 2,
      rowsRead: 3,
      sourceSha256,
    });
    expect(journalPath).toBe(tickResealJournalPath({ home }));
    expect(JSON.parse(readFileSync(journalPath, "utf8"))).toEqual(receipt);
    expect(statSync(journalPath).mode & 0o777).toBe(0o600);
    expect(readdirSync(supervisorLedgerDir({ home })).toSorted()).toEqual([
      "supervisor-ticks.jsonl",
      "supervisor-ticks.pre-reseal-20261117T102030Z.jsonl",
      "tick-reseals.jsonl",
    ]);
  });

  it("keeps an unchanged row's exact bytes, even where a re-render would differ", () => {
    // A sound row written with a space after its first colon: it still parses, and its stats still match, so it
    // must come back exactly as it was rather than re-rendered.
    const spaced = supervisorTickLine({ row: FIRST }).replace('":', '": ');
    const { home, path } = homeWith({ rows: [] });
    writeFileSync(path, `${spaced}\n${supervisorTickLine({ row: staleTick({ row: SECOND }) })}\n`);

    expect(unwrap(previewTickReseal({ home })).rowsRenderedAsRead).toBe(1);
    unwrap(applyTickReseal({ home, nowIso: NOW, reason: "carried home", sourceSha256: sha256Of({ path }) }));

    expect(readFileSync(path, "utf8")).toBe(`${spaced}\n${supervisorTickLine({ row: SECOND })}\n`);
  });

  it("refuses a digest the ledger no longer hashes to, and leaves the home exactly as it was", () => {
    const { home, path } = carried();
    const before = readFileSync(path);

    const error = unwrapErr(
      applyTickReseal({ home, nowIso: NOW, reason: "carried home", sourceSha256: "0".repeat(64) }),
    );

    expect(error).toEqual(TickResealErrors.sourceMoved({ actual: sha256Of({ path }), expected: "0".repeat(64) }));
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(supervisorLedgerDir({ home }))).toEqual(["supervisor-ticks.jsonl"]);
  });

  it("refuses an apply with nothing stale, writing no backup", () => {
    const { home, path } = homeWith({ rows: [FIRST, SECOND] });

    const error = unwrapErr(
      applyTickReseal({ home, nowIso: NOW, reason: "carried home", sourceSha256: sha256Of({ path }) }),
    );

    expect(error).toEqual(TickResealErrors.nothingToReseal({ path }));
    expect(readdirSync(supervisorLedgerDir({ home }))).toEqual(["supervisor-ticks.jsonl"]);
  });

  it("shares one lock with the append: both refuse while it is held, and both proceed once it is released", () => {
    const { home, path } = carried();
    const held = unwrap(acquireOperationLock({ home, key: TICK_LEDGER_LOCK_KEY, nowIso: NOW, staleAfterMs: Infinity }));

    expect(unwrapErr(appendSupervisorTick({ home, nowIso: NOW, row: THIRD })).code).toBe("LEDGER_BUSY");
    expect(unwrapErr(applyTickReseal({ home, nowIso: NOW, reason: "r", sourceSha256: sha256Of({ path }) })).code).toBe(
      "BUSY",
    );
    held.release();

    unwrap(applyTickReseal({ home, nowIso: NOW, reason: "r", sourceSha256: sha256Of({ path }) }));
    const fourth = soundTick({ finalisedIso: "2026-11-10T10:00:00.000Z", tickId: "tick-4" });
    expect(unwrap(appendSupervisorTick({ home, nowIso: NOW, row: fourth }))).toBe(path);
    expect(unwrap(visitSupervisorTicks({ onTick: () => undefined, path })).ticksRead).toBe(4);
  });

  describe("the verb", () => {
    /**
     * Run the verb against a home, capturing what it prints.
     *
     * @param rest the flag tail
     * @returns the exit code and every line printed
     */
    function run({ rest }: { rest: readonly string[] }): { code: number; out: string[]; diagnostics: string[] } {
      const out: string[] = [];
      const diagnostics: string[] = [];
      const code = runSupervisorTickReseal({
        deps: {
          now: () => NOW,
          writeDiagnostic: (line) => {
            diagnostics.push(line);
          },
          writeOut: (line) => {
            out.push(line);
          },
        },
        rest,
      });
      return { code, diagnostics, out };
    }

    it("previews with the exact apply command, then applies it", () => {
      const { home, path } = carried();
      const digest = sha256Of({ path });

      const preview = run({ rest: ["--home", home] });

      expect(preview.code).toBe(EXIT_OK);
      expect(preview.out.at(-1)).toBe(
        `to apply: slopweaver supervisor tick-reseal --apply --source-sha256 ${digest} --reason "<why>" --home ${home}`,
      );
      const applied = run({ rest: ["--apply", "--source-sha256", digest, "--reason", "carried", "--home", home] });
      expect(applied.code).toBe(EXIT_OK);
      expect(applied.out[0]).toBe(`supervisor tick-reseal: resealed 2 of 3 rows in ${path}; it reads back clean`);
      expect(run({ rest: ["--home", home] }).code).toBe(EXIT_EXPECTED_EMPTY);
    });

    it("refuses --apply without a digest or a reason before reading anything", () => {
      const result = run({ rest: ["--apply", "--home", "/nonexistent-home"] });

      expect(result.code).toBe(EXIT_USAGE);
      expect(result.diagnostics.slice(0, 2)).toEqual([
        "supervisor tick-reseal: --apply needs --source-sha256 <hex>: the 64-character digest the preview printed",
        'supervisor tick-reseal: --apply needs --reason "<why>": it is journalled on the receipt',
      ]);
    });
  });
});
