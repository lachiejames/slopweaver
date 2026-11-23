/**
 * The turn memory `handover wake` rotates on: the snapshot's reads and asks, which a bad file costs only the
 * diagnostic and one run's order, and each park's last reseat attempt off the wake journal's own attempt rows.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import type { HandoverWakeDeps } from "../../../../../cli/commands/handover/wakeRows.js";
import { lastAttempts, priorTurns } from "../../../../../cli/commands/handover/wakeTurns.js";
import type { WakeJournalRow } from "../../../../../handover/wakeJournal.js";
import { appendWakeJournalRow } from "../../../../../handover/wakeJournalStore.js";
import { writeWakeTurns } from "../../../../../handover/wakeTurnStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const PARKED = "2026-10-15T02:00:00.000Z";

/** One attempt row on park `a`, at the instant given. */
function attempt({ atIso, nonce }: { atIso: string; nonce: string }): WakeJournalRow {
  return {
    atIso,
    kind: "attempt",
    nonce,
    observed: { atIso: PARKED, kind: "at" },
    parkIndex: 2,
    parkedAtIso: PARKED,
    slug: "a",
  };
}

describe("wake turns", () => {
  let home: string;
  let diagnostics: string[];
  const deps: Pick<HandoverWakeDeps, "writeDiagnostic"> = {
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "wake-turns-"));
    diagnostics = [];
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("splits the snapshot into each park's last read and last ask", () => {
    const turns = new Map([
      ["a:2:x", { readAtIso: "2026-11-05T05:00:00.000Z" }],
      ["b:2:y", { askedAtIso: "2026-11-05T05:01:00.000Z", readAtIso: "2026-11-05T05:02:00.000Z" }],
    ]);
    unwrap(writeWakeTurns({ home, turns }));
    const prior = priorTurns({ deps, home });
    expect([[...prior.lastRead], [...prior.lastAsked], diagnostics]).toEqual([
      [
        ["a:2:x", "2026-11-05T05:00:00.000Z"],
        ["b:2:y", "2026-11-05T05:02:00.000Z"],
      ],
      [["b:2:y", "2026-11-05T05:01:00.000Z"]],
      [],
    ]);
  });

  it("serves from nothing, and says so, when the snapshot will not read", () => {
    const path = stateHomePaths({ home }).handoverWakeTurnsJson;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{");
    const prior = priorTurns({ deps, home });
    expect([prior.turns.size, prior.lastRead.size, prior.lastAsked.size, diagnostics.length]).toEqual([0, 0, 0, 1]);
    expect(diagnostics[0]).toContain("its rewrite replaces it");
  });

  it("reads each park's latest attempt off the wake journal, settlements aside", () => {
    unwrap(appendWakeJournalRow({ home, row: attempt({ atIso: "2026-11-05T05:00:00.000Z", nonce: "n-1" }) }));
    unwrap(appendWakeJournalRow({ home, row: attempt({ atIso: "2026-11-05T06:00:00.000Z", nonce: "n-2" }) }));
    unwrap(
      appendWakeJournalRow({
        home,
        row: { action: "spawn-failed", atIso: "2026-11-05T06:01:00.000Z", kind: "settled", nonce: "n-2" },
      }),
    );
    expect([...lastAttempts({ deps, home })]).toEqual([[`a:2:${PARKED}`, "2026-11-05T06:00:00.000Z"]]);
  });

  it("orders nothing, and says so, when the wake journal will not read", () => {
    const path = stateHomePaths({ home }).handoverWakeJournalJsonl;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not json\n");
    expect([lastAttempts({ deps, home }).size, diagnostics.length]).toEqual([0, 1]);
  });
});
