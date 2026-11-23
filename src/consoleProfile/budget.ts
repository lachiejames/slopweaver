/**
 * The console's named latency and memory budgets, and the verdict of a run against them.
 *
 * Tens of milliseconds can still be meaningful and hundreds certainly are, for a page load or a button to respond
 * after clicking. The proof is profiling across all flows and pages showing latency under a certain number,
 * including time to first byte, first contentful paint, and the time between clicking a nav item and seeing that
 * page fully loaded. Each budget below is one of those numbers, NAMED so a table row and a refusal say which
 * one a page broke. They are judged on the MEDIAN of a row's runs: the worst run is printed beside it, so a single
 * slow outlier is visible without failing a budget it does not describe.
 *
 * The numbers are for a production build served on this machine (`scripts/docs-site.sh --serve`), never a dev
 * server, which compiles a page on its first visit and would measure the compiler. Re-measure with
 * `slopweaver perf console`, and move a number only with a measurement behind the move.
 */
import type { ClickSample, ConsoleProfileReport, LoadSample, Spread } from "./report.js";
import { groupInOrder, spreadOf } from "./report.js";

/** One budget: its name, the field it reads, and its ceiling. */
export interface Budget {
  readonly name: string;
  readonly ceiling: number;
  readonly unit: "ms" | "MB" | "nodes";
}

/** Every budget, by name, so a renderer and a judge read the same number. */
export const CONSOLE_BUDGETS = {
  blocking: { ceiling: 200, name: "main-thread blocking", unit: "ms" },
  clickLanded: { ceiling: 300, name: "click to page drawn", unit: "ms" },
  clickSettled: { ceiling: 1000, name: "click to page fully loaded", unit: "ms" },
  clickShown: { ceiling: 100, name: "click to visible response", unit: "ms" },
  domNodes: { ceiling: 6000, name: "DOM nodes", unit: "nodes" },
  fcp: { ceiling: 500, name: "first contentful paint", unit: "ms" },
  heap: { ceiling: 60, name: "JS heap after GC", unit: "MB" },
  loadSettled: { ceiling: 1500, name: "cold load to fully loaded", unit: "ms" },
  ttfb: { ceiling: 100, name: "time to first byte", unit: "ms" },
} as const satisfies Record<string, Budget>;

/** One budget a row broke, with the number that broke it. */
export interface BudgetBreach {
  readonly row: string;
  readonly budget: Budget;
  readonly median: number;
}

const MB = 1024 * 1024;

/**
 * Whether one spread is over one budget, as a breach naming the row, or nothing.
 *
 * @param row the table row the spread belongs to
 * @param budget the budget judged
 * @param spread the row's spread, `undefined` when nothing was measured (which is not a breach, and is printed)
 * @returns the breach, or `undefined`
 */
function breachOf({
  row,
  budget,
  spread,
}: {
  row: string;
  budget: Budget;
  spread: Spread | undefined;
}): BudgetBreach | undefined {
  if (spread === undefined || spread.median <= budget.ceiling) {
    return undefined;
  }
  return { budget, median: spread.median, row };
}

/**
 * The budgets one page's cold loads broke.
 *
 * @param path the page
 * @param samples every cold load of it
 * @returns its breaches, in budget order
 */
function loadBreaches({ path, samples }: { path: string; samples: readonly LoadSample[] }): readonly BudgetBreach[] {
  const of = ({ pick }: { pick: (sample: LoadSample) => number | undefined }): Spread | undefined =>
    spreadOf({ values: samples.map(pick) });
  const heap = spreadOf({
    values: samples.map((sample) => (sample.heapBytes === undefined ? undefined : sample.heapBytes / MB)),
  });
  return [
    breachOf({ budget: CONSOLE_BUDGETS.ttfb, row: path, spread: of({ pick: (sample) => sample.ttfbMs }) }),
    breachOf({ budget: CONSOLE_BUDGETS.fcp, row: path, spread: of({ pick: (sample) => sample.fcpMs }) }),
    breachOf({ budget: CONSOLE_BUDGETS.loadSettled, row: path, spread: of({ pick: (sample) => sample.settledMs }) }),
    breachOf({ budget: CONSOLE_BUDGETS.blocking, row: path, spread: of({ pick: (sample) => sample.blockingMs }) }),
    breachOf({ budget: CONSOLE_BUDGETS.heap, row: path, spread: heap }),
    breachOf({ budget: CONSOLE_BUDGETS.domNodes, row: path, spread: of({ pick: (sample) => sample.domNodes }) }),
  ].filter((breach): breach is BudgetBreach => breach !== undefined);
}

/**
 * The budgets one click broke.
 *
 * @param name the click's row name
 * @param samples every run of it
 * @returns its breaches, in budget order
 */
function clickBreaches({ name, samples }: { name: string; samples: readonly ClickSample[] }): readonly BudgetBreach[] {
  const of = ({ pick }: { pick: (sample: ClickSample) => number | undefined }): Spread | undefined =>
    spreadOf({ values: samples.map(pick) });
  return [
    breachOf({ budget: CONSOLE_BUDGETS.clickShown, row: name, spread: of({ pick: (sample) => sample.shownMs }) }),
    breachOf({ budget: CONSOLE_BUDGETS.clickLanded, row: name, spread: of({ pick: (sample) => sample.landedMs }) }),
    breachOf({ budget: CONSOLE_BUDGETS.clickSettled, row: name, spread: of({ pick: (sample) => sample.settledMs }) }),
    breachOf({ budget: CONSOLE_BUDGETS.blocking, row: name, spread: of({ pick: (sample) => sample.blockingMs }) }),
  ].filter((breach): breach is BudgetBreach => breach !== undefined);
}

/**
 * Every budget a run broke, page loads first and then clicks, each in walk order.
 *
 * @param report the run
 * @returns the breaches; empty when every measured row is inside every budget
 */
export function budgetBreaches({ report }: { report: ConsoleProfileReport }): readonly BudgetBreach[] {
  const loads = groupInOrder({ keyOf: (sample: LoadSample) => sample.path, samples: report.loads });
  const clicks = groupInOrder({ keyOf: (sample: ClickSample) => sample.name, samples: report.clicks });
  return [
    ...loads.flatMap((group) => loadBreaches({ path: group.key, samples: group.samples })),
    ...clicks.flatMap((group) => clickBreaches({ name: group.key, samples: group.samples })),
  ];
}
