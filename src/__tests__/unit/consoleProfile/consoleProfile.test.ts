import { describe, expect, it } from "vitest";

import { onlyOf, parsePerfConsoleArgs, runDirectoryOf, runsOf } from "../../../cli/commands/perf/console.js";
import { budgetBreaches, CONSOLE_BUDGETS } from "../../../consoleProfile/budget.js";
import { CONSOLE_FLOWS, CONSOLE_ROUTES, sidebarClicks } from "../../../consoleProfile/plan.js";
import { clickTableLines, loadTableLines, reportLines } from "../../../consoleProfile/render.js";
import {
  type ClickSample,
  type ConsoleProfileReport,
  groupInOrder,
  type LoadSample,
  lastWindowChange,
  liveReadFailure,
  readsOwedSince,
  refusedReads,
  slowestRead,
  spreadOf,
  verbSampleOf,
} from "../../../consoleProfile/report.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const load = (over: Partial<LoadSample> = {}): LoadSample => ({
  blockingMs: 0,
  domNodes: 400,
  fcpMs: 80,
  heapBytes: 8 * 1024 * 1024,
  landedMs: 120,
  lcpMs: 200,
  loadingIndicator: true,
  path: "/queue",
  reads: [],
  scriptBytes: 900 * 1024,
  settledMs: 900,
  ttfbMs: 5,
  unanswered: [],
  ...over,
});

const click = (over: Partial<ClickSample> = {}): ClickSample => ({
  blockingMs: 0,
  documentLoad: false,
  from: "/queue",
  landedMs: 20,
  name: "/queue → /pull-requests",
  prefetched: true,
  reads: [],
  settledMs: 400,
  shownMs: 5,
  skipped: undefined,
  to: "/pull-requests",
  unanswered: [],
  ...over,
});

const report = (over: Partial<ConsoleProfileReport> = {}): ConsoleProfileReport => ({
  base: "http://localhost:3100",
  clicks: [],
  loads: [],
  machine: { cores: 15, loadAtEnd: 9.5, loadAtStart: 8.25 },
  measuredAtIso: "2026-10-04T07:00:00.000Z",
  memory: undefined,
  runs: 1,
  verbFloorMs: undefined,
  verbs: [],
  ...over,
});

describe("spreadOf", () => {
  it("takes the middle of an odd count and the worst", () => {
    expect(spreadOf({ values: [30, 10, 20] })).toEqual({ median: 20, n: 3, worst: 30 });
  });

  it("averages the two middles of an even count", () => {
    expect(spreadOf({ values: [10, 40, 20, 30] })).toEqual({ median: 25, n: 4, worst: 40 });
  });

  it("ignores runs that could not take the number", () => {
    expect(spreadOf({ values: [undefined, 7, undefined] })).toEqual({ median: 7, n: 1, worst: 7 });
  });

  it("answers undefined when no run took it, never zero", () => {
    expect(spreadOf({ values: [undefined] })).toBeUndefined();
    expect(spreadOf({ values: [] })).toBeUndefined();
  });
});

describe("slowestRead and groupInOrder", () => {
  it("finds the slowest read across every run of a row", () => {
    const samples = [
      { reads: [{ ms: 100, notMeasured: false, path: "/api/live/hands" }] },
      { reads: [{ ms: 3900, notMeasured: false, path: "/api/live/build" }] },
    ];
    expect(slowestRead({ samples })).toEqual({ ms: 3900, path: "/api/live/build" });
    expect(slowestRead({ samples: [{ reads: [] }] })).toBeUndefined();
  });

  it("never ranks a read that failed as the slowest", () => {
    const failed = { ms: undefined, notMeasured: true, path: "/api/live/hands" };
    const answered = { ms: 300, notMeasured: false, path: "/api/live/build" };
    expect(slowestRead({ samples: [{ reads: [failed, answered] }] })).toEqual({ ms: 300, path: "/api/live/build" });
  });

  it("owes a window only the reads it sent, never one still in flight from the page before", () => {
    const inflight = [
      { path: "/api/live/build", sentAt: 999 },
      { path: "/api/live/hands", sentAt: 1000 },
      { path: "/api/live/board", sentAt: 1400 },
    ];
    expect(readsOwedSince({ inflight, since: 1000 })).toEqual(["/api/live/hands", "/api/live/board"]);
    expect(readsOwedSince({ inflight, since: 1401 })).toEqual([]);
  });

  it("counts the quiet window from the window's own reads, never from an older one landing inside it", () => {
    const settled = [
      { classified: 1900, start: 500 },
      { classified: 1300, start: 1100 },
    ];
    expect(lastWindowChange({ inflight: [{ sentAt: 1200 }], settled, since: 1000 })).toBe(1300);
    expect(lastWindowChange({ inflight: [{ sentAt: 1500 }], settled, since: 1000 })).toBe(1500);
    expect(lastWindowChange({ inflight: [{ sentAt: 900 }], settled: [settled[0]!], since: 1000 })).toBe(1000);
  });

  it("groups in first-seen order", () => {
    const groups = groupInOrder({ keyOf: (value: string) => value[0]!, samples: ["b1", "a1", "b2"] });
    expect(groups).toEqual([
      { key: "b", samples: ["b1", "b2"] },
      { key: "a", samples: ["a1"] },
    ]);
  });
});

describe("the walk plan", () => {
  it("clicks each sidebar item in turn from the queue, the docs as a destination, and returns to the queue", () => {
    expect(sidebarClicks({ routes: CONSOLE_ROUTES }).map((step) => step.name)).toEqual([
      "/queue → /alignment",
      "/alignment → /pull-requests",
      "/pull-requests → /workstreams",
      "/workstreams → /automations",
      "/automations → /fleet",
      "/fleet → /store",
      "/store → /docs",
      "/store → /queue",
    ]);
  });

  it("presses the sidebar's own link for each destination, with or without its work-context query", () => {
    expect(sidebarClicks({ routes: CONSOLE_ROUTES })[0]!.target).toBe(
      'aside.sw-glass-sidebar a[href="/alignment"], aside.sw-glass-sidebar a[href^="/alignment?"]',
    );
  });

  it("walks nothing when no route is in the sidebar", () => {
    expect(sidebarClicks({ routes: [{ inSidebar: false, path: "/fleet" }] })).toEqual([]);
  });

  it("starts every in-page flow on a page the walk loads", () => {
    expect(CONSOLE_FLOWS.length).toBeGreaterThan(0);
    const paths = new Set(CONSOLE_ROUTES.map((route) => route.path));
    expect(CONSOLE_FLOWS.filter((flow) => !paths.has(flow.from))).toEqual([]);
  });

  it("reaches Alignment from the sidebar, between the Queue and Pull requests, and no longer from a Queue link", () => {
    // Alignment is a sidebar entry. A flow still aimed at the Queue's old link would match nothing,
    // and a target matching nothing is a skipped sample, never a failure, so it would time nothing silently.
    expect(CONSOLE_ROUTES.slice(0, 3)).toEqual([
      { inSidebar: true, path: "/queue" },
      { inSidebar: true, path: "/alignment" },
      { inSidebar: true, path: "/pull-requests" },
    ]);
    expect(CONSOLE_FLOWS.filter((flow) => flow.to === "/alignment")).toEqual([]);
  });
});

describe("budgetBreaches", () => {
  it("names the row and the budget a median broke", () => {
    const breaches = budgetBreaches({
      report: report({ loads: [load({ settledMs: 13_000 }), load({ settledMs: 14_000 }), load({ settledMs: 200 })] }),
    });
    expect(breaches).toEqual([{ budget: CONSOLE_BUDGETS.loadSettled, median: 13_000, row: "/queue" }]);
  });

  it("does not fail a budget on one slow outlier the median does not describe", () => {
    const loads = [load({ fcpMs: 90 }), load({ fcpMs: 95 }), load({ fcpMs: 4000 })];
    expect(budgetBreaches({ report: report({ loads }) })).toEqual([]);
  });

  it("judges the heap in megabytes", () => {
    const breaches = budgetBreaches({ report: report({ loads: [load({ heapBytes: 61 * 1024 * 1024 })] }) });
    expect(breaches.map((breach) => breach.budget.name)).toEqual(["JS heap after GC"]);
    expect(breaches[0]!.median).toBe(61);
  });

  it("judges a click's visible response, drawn and fully loaded", () => {
    const breaches = budgetBreaches({
      report: report({ clicks: [click({ landedMs: 301, settledMs: 5000, shownMs: 101 })] }),
    });
    expect(breaches.map((breach) => breach.budget.name)).toEqual([
      "click to visible response",
      "click to page drawn",
      "click to page fully loaded",
    ]);
  });

  it("never judges a flow that was not run", () => {
    const skipped = click({
      landedMs: undefined,
      settledMs: undefined,
      shownMs: undefined,
      skipped: "nothing to press",
    });
    expect(budgetBreaches({ report: report({ clicks: [skipped] }) })).toEqual([]);
  });
});

describe("refusedReads", () => {
  it("lists each live read that answered NOT MEASURED once", () => {
    const refused = { ms: 2000, notMeasured: true, path: "/api/live/hands" };
    const answered = { ms: 2000, notMeasured: false, path: "/api/live/build" };
    const loads = [load({ reads: [refused, answered] }), load({ reads: [refused] })];
    expect(refusedReads({ report: report({ loads }) })).toEqual(["/api/live/hands"]);
  });

  it("counts a verb timed alone that failed, so --check cannot pass over it", () => {
    const verbs = [
      { failed: "the route answered HTTP 500", ms: undefined, slug: "hands" },
      { failed: undefined, ms: 300, slug: "build" },
    ];
    expect(refusedReads({ report: report({ verbs }) })).toEqual(["/api/live/hands"]);
  });

  it("counts a read still unanswered at the settle cap, on a page or a click", () => {
    const loads = [load({ unanswered: ["/api/live/hands"] })];
    const clicks = [click({ unanswered: ["/api/live/build"] })];
    expect(refusedReads({ report: report({ clicks, loads }) })).toEqual(["/api/live/hands", "/api/live/build"]);
  });
});

const READING = JSON.stringify({
  observedAtIso: "2026-10-04T07:00:00.000Z",
  ok: true,
  payload: {},
  stampedByRoute: true,
});

const SHAPE_REFUSED = "GET /api/live/[verb] answered a shape this version does not read — refused, not guessed: ";

describe("liveReadFailure", () => {
  it("judges a page's read by its status before its body", () => {
    expect(liveReadFailure({ status: 500, text: READING })).toBe("the route answered HTTP 500");
    expect(liveReadFailure({ status: 404, text: '{"error":"no such verb"}' })).toBe("the route answered HTTP 404");
    expect(liveReadFailure({ status: 200, text: READING })).toBeUndefined();
  });

  it("refuses a 200 that is not JSON, or not a LiveResult, by the boundary's own sentence", () => {
    expect(liveReadFailure({ status: 200, text: "<html>" })).toBe(
      "GET /api/live/[verb] answered a body that is not JSON",
    );
    expect(liveReadFailure({ status: 200, text: '{"ok":true}' })).toContain(SHAPE_REFUSED);
  });

  it("refuses a reading carrying a field LiveResult does not declare, naming it", () => {
    const drifted = JSON.stringify({ ...JSON.parse(READING), extra: 1 });
    expect(liveReadFailure({ status: 200, text: drifted })).toBe(`${SHAPE_REFUSED}new field "extra"`);
  });

  it("refuses a reading with no payload", () => {
    const text = JSON.stringify({ observedAtIso: "2026-10-04T07:00:00.000Z", ok: true, stampedByRoute: true });
    expect(liveReadFailure({ status: 200, text })).toBe(`${SHAPE_REFUSED}field "payload" is missing`);
  });
});

describe("verbSampleOf", () => {
  it("times only a 200 that carries a reading", () => {
    expect(verbSampleOf({ ms: 812, slug: "hands", status: 200, text: READING })).toEqual({
      failed: undefined,
      ms: 812,
      slug: "hands",
    });
  });

  it("gives a fast error no number, whatever its body", () => {
    expect(verbSampleOf({ ms: 2, slug: "hands", status: 500, text: '{"error":"boom"}' })).toEqual({
      failed: "the route answered HTTP 500",
      ms: undefined,
      slug: "hands",
    });
  });

  it("carries the route's own NOT MEASURED reason", () => {
    const text = JSON.stringify({
      notMeasured: "the verb exited 1",
      observedAtIso: "2026-10-04T07:00:00.000Z",
      ok: false,
    });
    expect(verbSampleOf({ ms: 40, slug: "board", status: 200, text }).failed).toBe("the verb exited 1");
  });

  it("refuses a 200 whose body is not a LiveResult", () => {
    const sample = verbSampleOf({ ms: 2, slug: "hands", status: 200, text: '{"error":"boom"}' });
    expect(sample.ms).toBeUndefined();
    expect(sample.failed).toContain(SHAPE_REFUSED);
  });
});

describe("the tables", () => {
  it("prints median with the worst in brackets and marks a breach", () => {
    const lines = loadTableLines({ loads: [load({ settledMs: 13_000 }), load({ settledMs: 14_000 })] });
    expect(lines[2]).toContain(" 13500 ms (14000) ✗ ");
  });

  it("prints a number nobody measured as a dash, never as zero", () => {
    expect(loadTableLines({ loads: [load({ fcpMs: undefined })] })[2]!.split("|")[3]).toBe(" — ");
  });

  it("says a flow was not run, and why", () => {
    const skipped = click({ name: "open a session", skipped: "/fleet drew nothing matching main a" });
    expect(clickTableLines({ clicks: [skipped] })[2]).toBe(
      "| open a session | not run — /fleet drew nothing matching main a | | | | | | |",
    );
  });

  it("refuses to present a walk over refusals as a measurement", () => {
    const loads = [load({ reads: [{ ms: 10, notMeasured: true, path: "/api/live/hands" }] })];
    expect(
      reportLines({ report: report({ loads }) }).some((line) =>
        line.startsWith("NOT A MEASUREMENT: 1 read(s) failed, never answered or answered NOT MEASURED"),
      ),
    ).toBe(true);
  });

  it("closes on the verdict when every row is inside every budget", () => {
    expect(reportLines({ report: report({ loads: [load()] }) }).at(-1)).toBe(
      "Every measured row is inside every budget.",
    );
  });
});

describe("perf console's flags", () => {
  it("defaults to three runs and refuses a run count that is not a positive whole number", () => {
    expect(unwrap(runsOf({ parsed: unwrap(parsePerfConsoleArgs({ rest: [] })) }))).toBe(3);
    expect(unwrapErr(runsOf({ parsed: unwrap(parsePerfConsoleArgs({ rest: ["--runs", "0"] })) }))).toEqual([
      "perf console: --runs 0 is not a positive whole number",
    ]);
  });

  it("narrows to the paths --only names, slash or none", () => {
    expect(onlyOf({ parsed: unwrap(parsePerfConsoleArgs({ rest: ["--only", "queue, /fleet"] })) })).toEqual([
      "/queue",
      "/fleet",
    ]);
    expect(onlyOf({ parsed: unwrap(parsePerfConsoleArgs({ rest: [] })) })).toBeUndefined();
  });

  it("keeps a run under the home, named for its instant", () => {
    expect(runDirectoryOf({ home: "/h", measuredAtIso: "2026-10-04T07:00:00.123Z" })).toBe(
      "/h/perf/console/2026-10-04T07-00-00-123Z",
    );
  });
});
