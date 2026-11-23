import { describe, expect, it } from "vitest";

import { loadSampleOf } from "../../../consoleProfile/drive.js";
import { ConsoleProfileErrors } from "../../../consoleProfile/errors.js";
import { blockingBetween, measured, ProbeState } from "../../../consoleProfile/pageProbe.js";
import { isMeasuredRead } from "../../../consoleProfile/readLedger.js";
import { liveSlugOf } from "../../../consoleProfile/verbTiming.js";
import { clickInstants } from "../../../consoleProfile/warmClick.js";

describe("measured", () => {
  it("reads a probe's null as not measured and keeps every number, zero included", () => {
    expect(measured({ value: null })).toBeUndefined();
    expect(measured({ value: 0 })).toBe(0);
    expect(measured({ value: 412.5 })).toBe(412.5);
  });
});

describe("blockingBetween", () => {
  it("counts each long task's excess over 50 ms, inside the window only", () => {
    const long: [number, number][] = [
      [100, 30],
      [200, 80],
      [500, 150],
    ];
    expect(blockingBetween({ from: 150, long, to: 600 })).toBe(130);
    expect(blockingBetween({ from: 0, long, to: 150 })).toBe(0);
  });

  it("counts the task a press was stamped inside, which started just before the window", () => {
    expect(blockingBetween({ from: 100, long: [[99, 501]], to: 600 })).toBe(451);
    expect(blockingBetween({ from: 100, long: [[20, 79]], to: 600 })).toBe(0);
  });

  it("counts no task that only touches the window at an end", () => {
    expect(blockingBetween({ from: 100, long: [[200, 100]], to: 200 })).toBe(0);
    expect(blockingBetween({ from: 100, long: [[0, 100]], to: 200 })).toBe(0);
  });

  it("counts nothing over an empty or reversed window", () => {
    expect(blockingBetween({ from: 100, long: [[0, 200]], to: 100 })).toBe(0);
    expect(blockingBetween({ from: 150, long: [[0, 200]], to: 100 })).toBe(0);
  });
});

describe("ProbeState", () => {
  it("reads a probe answer and names the field a malformed one lacks", () => {
    const answer = {
      carried: null,
      click: null,
      domNodes: 640,
      fcp: 72,
      indicator: true,
      landedAt: 1048,
      lcp: 180,
      long: [[1010, 64]],
      origin: 1000,
      path: "/queue",
      scriptBytes: 945_000,
      ttfb: 5,
    };
    expect(ProbeState.parse(answer).landedAt).toBe(1048);
    const { origin: _origin, ...withoutOrigin } = answer;
    expect(ProbeState.safeParse(withoutOrigin).error!.issues[0]!.path).toEqual(["origin"]);
  });
});

describe("isMeasuredRead", () => {
  it("is every /api read but the call's event stream", () => {
    expect(isMeasuredRead({ path: "/api/live/board", resourceType: "fetch" })).toBe(true);
    expect(isMeasuredRead({ path: "/api/sync/landing", resourceType: "fetch" })).toBe(true);
    expect(isMeasuredRead({ path: "/api/talk/call/c1/events", resourceType: "fetch" })).toBe(false);
    expect(isMeasuredRead({ path: "/api/live/board", resourceType: "eventsource" })).toBe(false);
    expect(isMeasuredRead({ path: "/_next/static/chunk.js", resourceType: "script" })).toBe(false);
  });
});

describe("liveSlugOf", () => {
  it("names a live read by its verb slug and leaves any other path whole", () => {
    expect(liveSlugOf({ path: "/api/live/board" })).toBe("board");
    expect(liveSlugOf({ path: "/api/sync/landing" })).toBe("/api/sync/landing");
  });
});

describe("clickInstants", () => {
  const page = { carried: null, click: null, fcp: 80, landedAt: 1200, origin: 1000 };

  it("takes a document load's response from the press the old page carried over", () => {
    expect(clickInstants({ documentLoad: true, drawn: { ...page, carried: { shownAt: 1050 } } })).toEqual({
      landedAt: 1200,
      shownAt: 1050,
    });
  });

  it("falls back to the new document's first paint when nothing was carried", () => {
    expect(clickInstants({ documentLoad: true, drawn: page })).toEqual({ landedAt: 1200, shownAt: 1080 });
  });

  it("reads an in-page press off the press itself", () => {
    const click = { at: 1000, landedAt: 1100, shownAt: 1030 };
    expect(clickInstants({ documentLoad: false, drawn: { ...page, click } })).toEqual({
      landedAt: 1100,
      shownAt: 1030,
    });
  });

  it("has neither instant when the probe never answered", () => {
    expect(clickInstants({ documentLoad: false, drawn: undefined })).toEqual({
      landedAt: undefined,
      shownAt: undefined,
    });
  });
});

describe("loadSampleOf", () => {
  const state = {
    domNodes: 640,
    fcp: 72,
    indicator: true,
    landedAt: 1200,
    lcp: 180,
    long: [[1100, 150]] as [number, number][],
    origin: 1000,
    scriptBytes: 945_000,
    ttfb: 5,
  };
  const reads = [{ ms: 1900, notMeasured: false, path: "/api/live/board" }];

  it("is fully loaded when the last read answered, and blocking counts up to then", () => {
    const sample = loadSampleOf({
      heapBytes: 48_000_000,
      path: "/queue",
      quiet: { lastAnswer: 3000, reads, unanswered: [] },
      state,
    });
    expect(sample.landedMs).toBe(200);
    expect(sample.settledMs).toBe(2000);
    expect(sample.blockingMs).toBe(100);
  });

  it("is never fully loaded while a read is still unanswered", () => {
    const sample = loadSampleOf({
      heapBytes: 48_000_000,
      path: "/queue",
      quiet: { lastAnswer: 3000, reads, unanswered: ["/api/live/depth"] },
      state,
    });
    expect(sample.settledMs).toBe(undefined);
    expect(sample.unanswered).toEqual(["/api/live/depth"]);
  });

  it("keeps the reads alone when the probe never answered", () => {
    const sample = loadSampleOf({
      heapBytes: undefined,
      path: "/queue",
      quiet: { lastAnswer: 3000, reads, unanswered: [] },
      state: undefined,
    });
    expect(sample.landedMs).toBe(undefined);
    expect(sample.reads).toEqual(reads);
  });
});

describe("ConsoleProfileErrors", () => {
  it("names the console that did not answer, and why", () => {
    const error = ConsoleProfileErrors.consoleUnreachable({ base: "http://localhost:3100", why: "HTTP 502" });
    expect(error.code).toBe("CONSOLE_UNREACHABLE");
    expect(error.message).toContain("http://localhost:3100 did not answer (HTTP 502)");
  });

  it("carries the browser's own reason a launch failed", () => {
    const error = ConsoleProfileErrors.browserLaunchFailed({ cause: new Error("chromium is not installed") });
    expect(error.code).toBe("BROWSER_LAUNCH_FAILED");
    expect(error.message).toContain("chromium is not installed");
  });
});
