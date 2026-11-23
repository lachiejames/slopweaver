/**
 * Reducing one console walk to the numbers and sentences its coverage cells read — pure, over plain walk
 * results, with no generation and no disk.
 *
 * The property that earns this file: `complete` counts BOTH ways a route can go missing. A lost session
 * leaves routes in `notAttempted` and a `--limit` leaves them in `omitted`, and reading only the first is
 * what let a three-page smoke run publish the whole console surface as `synced`.
 *
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */
import { describe, expect, it } from "vitest";

import { DATADOG_CONSOLE_ROUTES } from "../../../../atlas/datadog/consolePages.js";
import { consoleUnblockedBy, walkTally } from "../../../../atlas/datadog/consoleTally.js";
import type { DatadogWalkResult } from "../../../../atlas/datadog/consoleWalk.js";

const ORIGIN = "https://ap1.datadoghq.invalid";

/** A walk over the first `landed` declared routes, with whatever else the case needs written over it. */
function walkOver({
  landedCount,
  over = {},
}: {
  landedCount: number;
  over?: Partial<DatadogWalkResult>;
}): DatadogWalkResult {
  return {
    artifactsWritten: landedCount,
    finalUrls: [],
    incompletePages: [],
    nav: null,
    navError: "the nav leg did not run in this case",
    notAttempted: [],
    omitted: [],
    pages: DATADOG_CONSOLE_ROUTES.slice(0, landedCount).map((route) => ({
      artifacts: [],
      finalUrl: `${ORIGIN}${route.href}`,
      outcome: "landed" as const,
      responseAccounting: { bodyFailed: 0, bodySucceeded: 1, eligible: 1, seen: 1 },
      route,
      statusCode: 200,
      title: route.label,
    })),
    palette: null,
    paletteError: "the palette leg did not run in this case",
    requests: [],
    unrenderedPages: [],
    ...over,
  };
}

describe("walkTally", () => {
  it("calls a walk over every declared route complete, with nothing omitted and nothing unattempted", () => {
    const tally = walkTally({ walk: walkOver({ landedCount: DATADOG_CONSOLE_ROUTES.length }) });

    expect(tally.complete).toBe(true);
    expect(tally.omitted).toBe(0);
    expect(tally.landed).toBe(DATADOG_CONSOLE_ROUTES.length);
    expect(tally.attempted).toBe(DATADOG_CONSOLE_ROUTES.length);
  });

  it("refuses to call a BOUNDED walk complete, even though every route it was handed landed", () => {
    const tally = walkTally({
      walk: walkOver({ landedCount: 3, over: { omitted: DATADOG_CONSOLE_ROUTES.slice(3).map((r) => r.href) } }),
    });

    expect(tally.attempted).toBe(3);
    expect(tally.landed).toBe(3);
    // Every page it visited succeeded, and it is still not a walk of this console.
    expect(tally.complete).toBe(false);
    expect(tally.omitted).toBe(DATADOG_CONSOLE_ROUTES.length - 3);
  });

  it("refuses to call a walk complete when a lost session left routes unattempted", () => {
    const tally = walkTally({ walk: walkOver({ landedCount: 2, over: { notAttempted: ["/logs"] } }) });

    expect(tally.complete).toBe(false);
    expect(tally.omitted).toBe(0);
  });
});

describe("consoleUnblockedBy", () => {
  it("names nothing at all when the walk was complete", () => {
    const tally = walkTally({ walk: walkOver({ landedCount: DATADOG_CONSOLE_ROUTES.length }) });

    expect(consoleUnblockedBy({ tally })).toBe(null);
  });

  it("names the BOUND when a --limit left routes unvisited, not the browser session", () => {
    const tally = walkTally({ walk: walkOver({ landedCount: 3, over: { omitted: ["/logs", "/apm/home"] } }) });

    expect(consoleUnblockedBy({ tally })).toBe(
      "slopweaver atlas datadog walk: re-running it without --limit, which left 2 declared page(s) unvisited",
    );
  });

  it("names the SESSION when routes went unattempted with no bound in play", () => {
    const tally = walkTally({ walk: walkOver({ landedCount: 2, over: { notAttempted: ["/logs"] } }) });

    expect(consoleUnblockedBy({ tally })).toBe(
      "slopweaver atlas datadog walk: re-running it with the browser session intact, which went part-way through 1 declared page(s)",
    );
  });
});

describe("consoleUnblockedBy with BOTH causes at once", () => {
  it("names both remedies, because removing --limit alone would fail the same way again", () => {
    // A bounded walk that ALSO lost its session was told only to drop `--limit`.
    const tally = walkTally({
      walk: walkOver({ landedCount: 2, over: { notAttempted: ["/logs"], omitted: ["/apm/home", "/rum/list"] } }),
    });

    expect(tally.complete).toBe(false);
    expect(consoleUnblockedBy({ tally })).toBe(
      "slopweaver atlas datadog walk: re-running it without --limit, which left 2 declared page(s) unvisited; and re-running it with the browser session intact, which went part-way through 1 declared page(s)",
    );
  });
});
