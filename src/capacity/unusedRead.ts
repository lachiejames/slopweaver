/**
 * The effectful half of `./unused.ts`: read the three histories a seven-day "what went unused" needs.
 *
 * - **Claude** — `claude watch`'s drawdown journal (`$SLOPWEAVER_HOME/claude-accounts/drawdown.jsonl`), one
 *   sample per plan, window and watch pass.
 * - **Codex** — every registered Codex destination's own rollout logs, through `../codex/gaugeSeries.ts` with its
 *   bounds widened to the span: a Codex budget is only ever written down by Codex itself.
 * - **The machine** — the supervisor tick ledger, whose every row carries the capacity reading its tick took.
 *
 * Nothing here probes a provider. Every source is a file this machine already wrote, so the measurement costs no
 * plan usage and runs as often as anyone likes.
 */
import { existsSync } from "node:fs";
import { cpus } from "node:os";

import { readDrawdownJournal } from "../claude/drawdownJournalStore.js";
import { scanCodexGaugeSeries } from "../codex/gaugeSeries.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { isRecord } from "../lib/parsers.js";
import { loadHoldFor } from "../live/machine/capacityHolds.js";
import type { PlanRegisterPort } from "../plans/port.js";
import { plansForProvider } from "../plans/register.js";
import { supervisorTickLedgerPath } from "../supervisor/tickStore.js";
import type { MachineTickSample, PlanWindowSample } from "./unused.js";

/**
 * How many rollout files one destination's walk may open — each costs one bounded tail read. A bound rather than
 * none so a home with years of logs cannot turn one measurement into a minutes-long scan; a home it cuts short
 * is NAMED in the report's problems rather than measured over less without saying so. Check with
 * `slopweaver machine unused --json | jq .problems`.
 */
const UNUSED_MAX_FILES = 6000;

/** Everything the three readers found, and what each could not see. */
export interface UnusedHistories {
  readonly samples: readonly PlanWindowSample[];
  readonly ticks: readonly MachineTickSample[];
  readonly loadHold: number;
  readonly problems: readonly string[];
}

/** Claude's journalled samples, scaled from a 0..1 fraction to a percentage. */
function claudeSamples({ home, problems }: { home: string; problems: string[] }): readonly PlanWindowSample[] {
  const read = readDrawdownJournal({ home });
  if (read.isErr()) {
    problems.push(`claude: the drawdown journal could not be read — ${read.error.message}`);
    return [];
  }
  if (read.value.unreadable > 0) {
    problems.push(`claude: ${String(read.value.unreadable)} drawdown journal line(s) did not parse`);
  }
  return read.value.events.flatMap((event) =>
    event.kind === "sample"
      ? [
          {
            ceilingId: `claude:${event.planAlias}`,
            observedAtIso: event.observedAtIso,
            resetAtIso: event.resetAtIso,
            usedPct: event.utilization * 100,
            window: event.window,
          },
        ]
      : [],
  );
}

/** Every registered Codex destination's rollout readings over `days` day-directories. */
async function codexSamples({
  home,
  days,
  port,
  problems,
}: {
  home: string;
  days: number;
  port: PlanRegisterPort;
  problems: string[];
}): Promise<readonly PlanWindowSample[]> {
  const register = await port.read({ home });
  if (register.isErr()) {
    problems.push(`codex: the plan register could not be read — ${register.error.message}`);
    return [];
  }
  return plansForProvider({ plans: register.value.plans, provider: "codex" }).flatMap((plan) => {
    // One more day-directory than days, so a window that opened before the span's first day is still seen.
    const series = scanCodexGaugeSeries({ codexHome: plan.storeDir, dayDirs: days + 1, maxFiles: UNUSED_MAX_FILES });
    if (series.filesSkipped > 0) {
      problems.push(
        `codex:${plan.alias}: ${String(series.filesSkipped)} rollout file(s) past the ${String(UNUSED_MAX_FILES)}-file bound were not read`,
      );
    }
    return series.gauges.flatMap((gauge) =>
      gauge.windows.flatMap((window) =>
        window.resetAtIso === undefined
          ? []
          : [
              {
                ceilingId: `codex:${plan.alias}`,
                observedAtIso: gauge.observedAtIso,
                resetAtIso: window.resetAtIso,
                usedPct: window.usedPercent,
                window: window.label,
              },
            ],
      ),
    );
  });
}

/**
 * One tick ledger row's machine reading. A row counts only when its capacity source was `read` or `partial` and
 * carries a numeric `load1`, a boolean `hold` and its own `observedAtIso`; anything else is a tick that read no
 * capacity, which the span treats as unknown time rather than idle time.
 *
 * @param row one parsed ledger line, of any shape
 * @returns the tick's load, hold and instant, or `undefined` when its tick read no capacity
 */
export function tickSampleOf({ row }: { row: unknown }): MachineTickSample | undefined {
  if (!isRecord(row) || !isRecord(row["sources"])) {
    return undefined;
  }
  const capacity = row["sources"]["capacity"];
  if (!isRecord(capacity) || (capacity["status"] !== "read" && capacity["status"] !== "partial")) {
    return undefined;
  }
  const facts = capacity["facts"];
  const observedAtIso = capacity["observedAtIso"];
  if (!isRecord(facts) || typeof observedAtIso !== "string") {
    return undefined;
  }
  const { load1, hold } = facts;
  if (typeof load1 !== "number" || typeof hold !== "boolean") {
    return undefined;
  }
  return { hold, load1, observedAtIso };
}

/** Every tick's machine reading, streamed off the ledger one line at a time. */
function machineTicks({ home, problems }: { home: string; problems: string[] }): readonly MachineTickSample[] {
  const path = supervisorTickLedgerPath({ home });
  if (!existsSync(path)) {
    problems.push(`machine: no supervisor tick ledger at ${path}`);
    return [];
  }
  const ticks: MachineTickSample[] = [];
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
      const tick = tickSampleOf({ row });
      if (tick !== undefined) {
        ticks.push(tick);
      }
    },
    path,
  });
  if (unreadable > 0) {
    problems.push(`machine: ${String(unreadable)} tick ledger line(s) did not parse`);
  }
  return ticks;
}

/**
 * Read the three histories.
 *
 * @param home the Slopweaver home the journal, register and ledger live under
 * @param days how many days back the Codex walk must reach
 * @param port where the plan register naming the Codex destinations is read; a store outage is a named
 *   problem on the report, never an empty Codex history passed off as idle
 * @returns every sample found, today's load hold, and every problem met
 */
export async function readUnusedHistories({
  home,
  days,
  port,
}: {
  home: string;
  days: number;
  port: PlanRegisterPort;
}): Promise<UnusedHistories> {
  const problems: string[] = [];
  const claude = claudeSamples({ home, problems });
  const codex = await codexSamples({ days, home, port, problems });
  const samples = [...claude, ...codex];
  const ticks = machineTicks({ home, problems });
  return { loadHold: loadHoldFor({ cores: cpus().length }), problems, samples, ticks };
}
