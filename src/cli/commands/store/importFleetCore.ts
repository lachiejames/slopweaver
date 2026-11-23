/**
 * `slopweaver store import-fleet`'s pure half — what each leg reports, and the lines it prints.
 *
 * No filesystem, no database, no clock. `./importFleetRun.ts` is the shell that does all three, and this
 * split is what lets the report be tested against a counted result rather than against a live home. The
 * arguments are `./importFleetArgs.ts`; the leg list and usage are the leaf `./importFleetUsage.ts`.
 */
import type { FleetImportError } from "../../../store/fleet/errors.js";

import type { FleetLeg } from "./importFleetUsage.js";

export { FLEET_LEGS, type FleetLeg } from "./importFleetUsage.js";

/** What one leg did. */
export interface LegOutcome {
  readonly leg: FleetLeg;
  /** How many source records were projected successfully. */
  readonly projected: number;
  /**
   * How many rows the store reported affected.
   *
   * It means two different things by leg, and saying so is the point rather than a caveat. `board` and
   * `runs` UPSERT, because their sources are mutable, so a re-run over an unchanged board reports every
   * row again — it really did replace them. `door`, `autonomy`, `grants`, `codex`, `superwhisper`,
   * `codex-messages`, `owner-turns`, `codex-fallback`, `measurements` and `authored` are append-only (the last
   * four counting new bodies plus new locations, new requests plus receipts, new bodies plus new locations, and
   * new bodies plus new files), so a re-run reports only what was new, and a steady zero there is the
   * convergence proof. `autonomy` additionally retires the rows of lines `autonomy adopt` rewrote, and says how
   * many in its {@link notes}.
   */
  readonly written: number;
  /** Source records that could not be projected, each carrying its own typed reason. */
  readonly refused: readonly FleetImportError[];
  /** Physical lines a journal could not decode — reported, never dropped. See `runJournal.ts`. */
  readonly unreadableLines: number;
  /**
   * The source this leg reads, when it is not there at all.
   *
   * Its own field rather than a refusal, and the distinction is load-bearing: `grants/journal.jsonl` does
   * not exist on an install that has never recorded a grant, and reporting that as a failure would make
   * the verb exit non-zero on a correct, expected state — training an operator to ignore its exit code.
   * A record that EXISTS and could not be projected is a refusal; a source that was never written is a
   * fact this prints and moves past.
   */
  readonly absentSource: string | undefined;
  /**
   * Facts a leg states about its own coverage, printed under its line. The `authored` leg says how much it read,
   * and how many binary bodies it could scan only as bytes — a gap it prints rather than implies away. The
   * `autonomy` leg says how many stored rows it retired because their line was rewritten in place; the
   * `superwhisper` and `codex-messages` legs what they skipped and why.
   */
  readonly notes?: readonly string[];
}

/** How many rows one projection pass holds before it is handed to the store — the door and codex legs alike. */
export const FLUSH_ROWS = 5_000;

/** What a leg's projection produced, accumulated as it reads. */
export interface LegTally {
  projected: number;
  written: number;
  readonly refused: FleetImportError[];
  unreadableLines: number;
  absentSource: string | undefined;
}

/**
 * A fresh tally, so every leg starts from the same shape.
 *
 * @returns a tally with nothing counted
 */
export function newTally(): LegTally {
  return { absentSource: undefined, projected: 0, refused: [], unreadableLines: 0, written: 0 };
}

/**
 * The tally as the report's own outcome.
 *
 * @param leg which leg it counted
 * @returns the outcome the report prints
 */
export function outcomeOf({ leg, tally }: { leg: FleetLeg; tally: LegTally }): LegOutcome {
  return {
    absentSource: tally.absentSource,
    leg,
    projected: tally.projected,
    refused: tally.refused,
    unreadableLines: tally.unreadableLines,
    written: tally.written,
  };
}

/** The verb's whole result. */
export interface ImportFleetReport {
  readonly legs: readonly LegOutcome[];
  readonly dryRun: boolean;
}

/**
 * The report, as the lines a human reads.
 *
 * A REFUSED source record is always named with its own message rather than counted, because every one of
 * them is a record that exists on disk and does not exist in the store — the exact asymmetry the import is
 * supposed to remove. The cap is per leg, so one broken ledger cannot bury another leg's report.
 *
 * @param report what each leg did
 * @param refusalCap how many refusals to spell per leg before summarising the rest
 * @returns the lines, in leg order, with a trailing total
 */
export function importFleetLines({
  report,
  refusalCap = 10,
}: {
  report: ImportFleetReport;
  refusalCap?: number;
}): readonly string[] {
  const lines: string[] = [];
  if (report.dryRun) {
    lines.push("store import-fleet: DRY RUN — nothing was written and no connection was opened");
  }
  let written = 0;
  for (const outcome of report.legs) {
    written += outcome.written;
    if (outcome.absentSource !== undefined) {
      lines.push(`${outcome.leg}: nothing to import — ${outcome.absentSource} does not exist`);
      continue;
    }
    lines.push(
      `${outcome.leg}: ${String(outcome.projected)} projected, ${String(outcome.written)} written, ` +
        `${String(outcome.refused.length)} refused`,
    );
    if (outcome.notes !== undefined) {
      lines.push(...outcome.notes.map((note) => `  ${note}`));
    }
    if (outcome.unreadableLines > 0) {
      lines.push(`  ${String(outcome.unreadableLines)} journal line(s) did not decode and were not imported`);
    }
    outcome.refused.slice(0, refusalCap).forEach((refusal) => {
      lines.push(`  ${refusal.code}: ${refusal.message}`);
    });
    const hidden = outcome.refused.length - refusalCap;
    if (hidden > 0) {
      lines.push(`  … and ${String(hidden)} more refusal(s) of the same shape`);
    }
  }
  lines.push(`store import-fleet: ${String(written)} row(s) written across ${String(report.legs.length)} leg(s)`);
  return lines;
}
