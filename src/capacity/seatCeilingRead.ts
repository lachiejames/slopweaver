/**
 * The effectful half of `./seatCeiling.ts`: read the drawdown journal `claude watch` writes, the configured
 * unpaused Claude plans, and every supervisor tick's seat counts, then measure.
 *
 * Every source is a file this machine already wrote, so the report costs no plan usage. The tick ledger is
 * streamed one line at a time, and a row is decoded only for its watch reading — a row whose watch was not
 * `read` or `partial` is a tick that saw no fleet, which the measurement treats as unknown time, never zero.
 */
import { existsSync } from "node:fs";

import { err, type Result } from "#lib/result.js";
import { unpausedAccounts } from "../claude/config.js";
import { samplesOf } from "../claude/drawdownJournal.js";
import { readDrawdownJournal } from "../claude/drawdownJournalStore.js";
import { readClaudeFleet } from "../claude/spawnAccounts.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { isRecord } from "../lib/parsers.js";
import { planRegisterPort } from "../plans/port.js";
import { decodePlanAllowance, decodeUsageLimitPercent } from "../plans/usageLimit.js";
import { supervisorTickLedgerPath } from "../supervisor/tickStore.js";
import type { SeatTickSample } from "./seatBurn.js";
import { type FleetCeilingReport, measureFleetCeiling } from "./seatCeiling.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The watch state that draws a plan down; every other state is an open seat that is not drawing. */
const WORKING_STATE = "working";

/**
 * One tick ledger row's seat counts. A row counts only when its watch source was `read` or `partial`, carries
 * its own `observedAtIso` and a `rows` list; anything else saw no fleet.
 *
 * @param row one parsed ledger line, of any shape
 * @returns the tick's working and open seats and its instant, or `undefined` when the tick saw no fleet
 */
export function seatTickOf({ row }: { row: unknown }): SeatTickSample | undefined {
  if (!isRecord(row) || !isRecord(row["sources"])) {
    return undefined;
  }
  const watch = row["sources"]["watch"];
  if (!isRecord(watch) || (watch["status"] !== "read" && watch["status"] !== "partial")) {
    return undefined;
  }
  const observedAtIso = watch["observedAtIso"];
  const facts = watch["facts"];
  if (typeof observedAtIso !== "string" || !isRecord(facts) || !Array.isArray(facts["rows"])) {
    return undefined;
  }
  const rows: readonly unknown[] = facts["rows"];
  return {
    observedAtIso,
    openSeats: rows.length,
    workingSeats: rows.filter((entry) => isRecord(entry) && entry["state"] === WORKING_STATE).length,
  };
}

/** Every tick's seat counts, streamed off the ledger. */
function seatTicks({ home, problems }: { home: string; problems: string[] }): readonly SeatTickSample[] {
  const path = supervisorTickLedgerPath({ home });
  if (!existsSync(path)) {
    problems.push(`seats: no supervisor tick ledger at ${path}`);
    return [];
  }
  const ticks: SeatTickSample[] = [];
  let unreadable = 0;
  readJsonlLines({
    onLine: ({ line }) => {
      if (line.trim().length === 0) {
        return;
      }
      let row: unknown;
      try {
        // One line is one tick row, bounded by the recorder that wrote it.
        row = JSON.parse(line);
      } catch {
        unreadable += 1;
        return;
      }
      const tick = seatTickOf({ row });
      if (tick !== undefined) {
        ticks.push(tick);
      }
    },
    path,
  });
  if (unreadable > 0) {
    problems.push(`seats: ${String(unreadable)} tick ledger line(s) did not parse`);
  }
  return ticks;
}

/**
 * Read every source and measure the span ending at `nowIso`.
 *
 * This IS the production reader — `automation`'s row-runner deps and `fleet ceiling` hand it over by reference,
 * and every test hands those a plain fake instead — so it names the production register port itself.
 *
 * @param home the Slopweaver home the journal, accounts and tick ledger live under
 * @param days how many days back the span reaches
 * @param nowIso the span's end, and the instant the ceiling is judged at
 * @returns the report, or why a source that must exist could not be read
 */
export async function readFleetCeilingReport({
  home,
  days,
  nowIso,
}: {
  home: string;
  days: number;
  nowIso: string;
}): Promise<Result<FleetCeilingReport>> {
  const fleet = await readClaudeFleet({ home, port: planRegisterPort() });
  if (fleet.isErr()) {
    return err([`the Claude accounts could not be read — ${fleet.error.message}`]);
  }
  const { accounts, thresholds } = fleet.value;
  if (accounts === undefined) {
    return err(["no Claude plans are configured on this install, so there is no plan usage to measure"]);
  }
  const journal = readDrawdownJournal({ home });
  if (journal.isErr()) {
    return err([`the drawdown journal could not be read — ${journal.error.message}`]);
  }
  const problems: string[] = [];
  if (journal.value.unreadable > 0) {
    problems.push(`claude: ${String(journal.value.unreadable)} drawdown journal line(s) did not parse`);
  }
  const ticks = seatTicks({ home, problems });
  const fromIso = new Date(Date.parse(nowIso) - days * DAY_MS).toISOString();
  return measureFleetCeiling({
    fromIso,
    plans: unpausedAccounts({ accounts }).map((account) => ({
      alias: account.alias,
      allowance: decodePlanAllowance({ allowance: account.allowance }),
      usageLimitPercent: decodeUsageLimitPercent({ usageLimitPercent: account.usageLimitPercent }),
    })),
    problems,
    samples: samplesOf({ events: journal.value.events }),
    thresholds,
    ticks,
    toIso: nowIso,
  });
}
