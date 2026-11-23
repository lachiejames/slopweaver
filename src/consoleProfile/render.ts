/**
 * A `slopweaver perf console` run as markdown tables — the same text a terminal prints and a PR body carries.
 *
 * A cell is the row's MEDIAN with its worst run in brackets, and a ✗ when the median is over that column's named
 * budget (`./budget.ts`). A number nobody measured prints as `—`, never as zero: a page whose first paint the
 * browser never reported is a different fact from one that painted instantly.
 */
import { type Budget, budgetBreaches, CONSOLE_BUDGETS } from "./budget.js";
import {
  type ApiRead,
  type ClickSample,
  type ConsoleProfileReport,
  groupInOrder,
  type LoadSample,
  refusedReads,
  type Spread,
  slowestRead,
  spreadOf,
  type VerbSample,
} from "./report.js";

const MB = 1024 * 1024;
const KB = 1024;

/**
 * One cell: median, worst in brackets when it differs, and a ✗ over budget.
 *
 * @param spread the row's spread, `undefined` when unmeasured
 * @param budget the column's budget, when it has one
 * @param suffix the unit printed after the median
 * @returns the cell text
 */
function cell({ spread, budget, suffix }: { spread: Spread | undefined; budget?: Budget; suffix: string }): string {
  if (spread === undefined) {
    return "—";
  }
  const median = Math.round(spread.median);
  const worst = Math.round(spread.worst);
  const over = budget !== undefined && spread.median > budget.ceiling;
  const mark = over ? " ✗" : "";
  if (spread.n === 1 || worst === median) {
    return `${String(median)}${suffix}${mark}`;
  }
  return `${String(median)}${suffix} (${String(worst)})${mark}`;
}

/**
 * The slowest read of a row as `slug 3.6 s`, or `—` when the row started none.
 *
 * @param samples the row's samples
 * @returns the cell text
 */
function slowestCell({ samples }: { samples: readonly { reads: readonly ApiRead[] }[] }): string {
  const slowest = slowestRead({ samples });
  if (slowest === undefined) {
    return "—";
  }
  return `${slowest.path.replace(/^\/api\/live\//u, "")} ${String(Math.round(slowest.ms))} ms`;
}

/**
 * The page-load table: one row per page, cold, in a fresh browser context.
 *
 * @param loads every cold-load sample
 * @returns the table's lines
 */
export function loadTableLines({ loads }: { loads: readonly LoadSample[] }): readonly string[] {
  const lines = [
    "| page | TTFB | FCP | LCP | drawn | fully loaded | reads | slowest read | loading shown | JS | heap | DOM | blocking |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const group of groupInOrder({ keyOf: (sample: LoadSample) => sample.path, samples: loads })) {
    const of = ({ pick }: { pick: (sample: LoadSample) => number | undefined }): Spread | undefined =>
      spreadOf({ values: group.samples.map(pick) });
    const shown = group.samples.every((sample) => sample.loadingIndicator) ? "yes" : "no";
    const unanswered = group.samples.some((sample) => sample.unanswered.length > 0) ? " +unanswered" : "";
    lines.push(
      [
        "",
        ` ${group.key} `,
        ` ${cell({ budget: CONSOLE_BUDGETS.ttfb, spread: of({ pick: (s) => s.ttfbMs }), suffix: " ms" })} `,
        ` ${cell({ budget: CONSOLE_BUDGETS.fcp, spread: of({ pick: (s) => s.fcpMs }), suffix: " ms" })} `,
        ` ${cell({ spread: of({ pick: (s) => s.lcpMs }), suffix: " ms" })} `,
        ` ${cell({ spread: of({ pick: (s) => s.landedMs }), suffix: " ms" })} `,
        ` ${cell({ budget: CONSOLE_BUDGETS.loadSettled, spread: of({ pick: (s) => s.settledMs }), suffix: " ms" })}${unanswered} `,
        ` ${cell({ spread: of({ pick: (s) => s.reads.length }), suffix: "" })} `,
        ` ${slowestCell({ samples: group.samples })} `,
        ` ${shown} `,
        ` ${cell({ spread: of({ pick: (s) => (s.scriptBytes === undefined ? undefined : s.scriptBytes / KB) }), suffix: " KB" })} `,
        ` ${cell({ budget: CONSOLE_BUDGETS.heap, spread: of({ pick: (s) => (s.heapBytes === undefined ? undefined : s.heapBytes / MB) }), suffix: " MB" })} `,
        ` ${cell({ budget: CONSOLE_BUDGETS.domNodes, spread: of({ pick: (s) => s.domNodes }), suffix: "" })} `,
        ` ${cell({ budget: CONSOLE_BUDGETS.blocking, spread: of({ pick: (s) => s.blockingMs }), suffix: " ms" })} `,
        "",
      ].join("|"),
    );
  }
  return lines;
}

/**
 * Whether the router had the destination before the press, across a row's runs.
 *
 * @param samples the row's samples
 * @returns `yes`, `no`, `mixed`, or `—` for a panel, which has no destination to prefetch
 */
function prefetchCell({ samples }: { samples: readonly ClickSample[] }): string {
  const known = samples.flatMap((sample) => (sample.prefetched === undefined ? [] : [sample.prefetched]));
  if (known.length === 0) {
    return "—";
  }
  if (known.every((value) => value)) {
    return "yes";
  }
  if (known.every((value) => !value)) {
    return "no";
  }
  return "mixed";
}

/**
 * The click table: one row per sidebar click or in-page flow, warm, in one browser context.
 *
 * @param clicks every click sample
 * @returns the table's lines
 */
export function clickTableLines({ clicks }: { clicks: readonly ClickSample[] }): readonly string[] {
  const lines = [
    "| click | prefetched | visible response | drawn | fully loaded | reads | slowest read | blocking |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const group of groupInOrder({ keyOf: (sample: ClickSample) => sample.name, samples: clicks })) {
    const skipped = group.samples.find((sample) => sample.skipped !== undefined);
    if (skipped !== undefined) {
      lines.push(`| ${group.key} | not run — ${String(skipped.skipped)} | | | | | | |`);
      continue;
    }
    const of = ({ pick }: { pick: (sample: ClickSample) => number | undefined }): Spread | undefined =>
      spreadOf({ values: group.samples.map(pick) });
    const doc = group.samples.some((sample) => sample.documentLoad) ? " (document load)" : "";
    const unanswered = group.samples.some((sample) => sample.unanswered.length > 0) ? " +unanswered" : "";
    lines.push(
      [
        "",
        ` ${group.key}${doc} `,
        ` ${prefetchCell({ samples: group.samples })} `,
        ` ${cell({ budget: CONSOLE_BUDGETS.clickShown, spread: of({ pick: (s) => s.shownMs }), suffix: " ms" })} `,
        ` ${cell({ budget: CONSOLE_BUDGETS.clickLanded, spread: of({ pick: (s) => s.landedMs }), suffix: " ms" })} `,
        ` ${cell({ budget: CONSOLE_BUDGETS.clickSettled, spread: of({ pick: (s) => s.settledMs }), suffix: " ms" })}${unanswered} `,
        ` ${cell({ spread: of({ pick: (s) => s.reads.length }), suffix: "" })} `,
        ` ${slowestCell({ samples: group.samples })} `,
        ` ${cell({ budget: CONSOLE_BUDGETS.blocking, spread: of({ pick: (s) => s.blockingMs }), suffix: " ms" })} `,
        "",
      ].join("|"),
    );
  }
  return lines;
}

/**
 * A byte count as megabytes to one place, or `—`.
 *
 * @param bytes the count
 * @returns the text
 */
function megabytes({ bytes }: { bytes: number | undefined }): string {
  if (bytes === undefined) {
    return "—";
  }
  return `${(bytes / MB).toFixed(1)} MB`;
}

/** Order two verb samples slowest first, every unmeasured one after every measured one. */
function slowestFirst({ a, b }: { a: VerbSample; b: VerbSample }): number {
  if (a.ms === undefined) {
    return b.ms === undefined ? 0 : 1;
  }
  if (b.ms === undefined) {
    return -1;
  }
  return b.ms - a.ms;
}

/** The verbs behind the reads, slowest first under the launcher's floor; no lines when none were timed. */
function verbTableLines({ report }: { report: ConsoleProfileReport }): readonly string[] {
  if (report.verbs.length === 0) {
    return [];
  }
  const lines = [
    "",
    "The verbs behind the reads, each spawned alone exactly as the live route spawns it:",
    "",
    "| verb | wall |",
    "| --- | --- |",
  ];
  if (report.verbFloorMs !== undefined) {
    lines.push(`| (process start-up, no verb loaded) | ${String(Math.round(report.verbFloorMs))} ms |`);
  }
  for (const verb of [...report.verbs].toSorted((a, b) => slowestFirst({ a, b }))) {
    const wall = verb.ms === undefined ? `not measured — ${String(verb.failed)}` : `${String(Math.round(verb.ms))} ms`;
    lines.push(`| ${verb.slug} | ${wall} |`);
  }
  return lines;
}

/**
 * The whole run as text: the two tables, memory across the walk, the verbs behind the reads, and the verdict.
 *
 * @param report the run
 * @returns every line, ready to print
 */
export function reportLines({ report }: { report: ConsoleProfileReport }): readonly string[] {
  const lines: string[] = [
    `perf console — ${report.base}, ${String(report.runs)} run(s) per row, measured ${report.measuredAtIso}`,
    `Machine load ${report.machine.loadAtStart.toFixed(1)} → ${report.machine.loadAtEnd.toFixed(1)} on ` +
      `${String(report.machine.cores)} cores (one-minute average, start → end of the walk).`,
    "Cells are the median, the worst run in brackets; ✗ is over the column's named budget; — was not measured.",
    "",
    "Cold load, a fresh browser context per page:",
    "",
    ...loadTableLines({ loads: report.loads }),
    "",
    "Clicks, warm, from a page that has already settled:",
    "",
    ...clickTableLines({ clicks: report.clicks }),
  ];
  if (report.memory !== undefined) {
    const memory = report.memory;
    lines.push(
      "",
      `Memory across ${String(memory.roundTrips)} sidebar round trip(s): heap ${megabytes({ bytes: memory.startHeapBytes })} → ` +
        `${megabytes({ bytes: memory.endHeapBytes })}, DOM ${String(memory.startDomNodes)} → ${String(memory.endDomNodes)} nodes`,
    );
  }
  lines.push(...verbTableLines({ report }));
  const refused = refusedReads({ report });
  if (refused.length > 0) {
    lines.push(
      "",
      `NOT A MEASUREMENT: ${String(refused.length)} read(s) failed, never answered or answered NOT MEASURED, so those pages drew ` +
        "a refusal or a stuck tile rather than a reading. A stale built CLI in the serving checkout fails every read " +
        "(`slopweaver dev build`); a read still running at the settle cap is a stall, read against the machine load above.",
      `  ${refused.join(", ")}`,
    );
  }
  const breaches = budgetBreaches({ report });
  lines.push("");
  if (breaches.length === 0) {
    lines.push("Every measured row is inside every budget.");
    return lines;
  }
  lines.push(`${String(breaches.length)} budget breach(es):`);
  for (const breach of breaches) {
    lines.push(
      `  ${breach.row}: ${breach.budget.name} ${String(Math.round(breach.median))} ${breach.budget.unit} > ${String(breach.budget.ceiling)}`,
    );
  }
  return lines;
}
