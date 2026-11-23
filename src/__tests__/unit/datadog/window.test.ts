import { describe, expect, it } from "vitest";

import { datadogDomainErrorLines } from "../../../datadog/domainErrors.js";
import { durationToMs, resolveBound, resolveWindow, windowAsQueryBounds } from "../../../datadog/window.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** A fixed instant, so nothing here depends on a real clock. */
const NOW = 1_785_628_800_000;

describe("durationToMs", () => {
  it.each([
    ["90s", 90_000],
    ["30m", 1_800_000],
    ["8h", 28_800_000],
    ["7d", 604_800_000],
    ["2w", 1_209_600_000],
  ])("parses %s", (token, expected) => {
    expect(durationToMs({ token })).toBe(expected);
  });

  it.each(["now-7d", "now-24h..now", " 8h ", "NOW-8H"])("accepts the console form %s", (token) => {
    expect(durationToMs({ token })).toBeGreaterThan(0);
  });

  it("leaves a both-ends-relative range unparsed rather than silently taking its first half", () => {
    expect(durationToMs({ token: "now-7d..now-1d" })).toBe(null);
  });

  it.each(["now", "", "8x", "8", "h", "-8h", "1785628800000"])("rejects %s as a duration", (token) => {
    expect(durationToMs({ token })).toBe(null);
  });
});

describe("resolveBound", () => {
  it("resolves now to the supplied instant", () => {
    expect(resolveBound({ token: "now", nowMs: NOW })).toBe(NOW);
  });

  it("resolves an empty token to the supplied instant", () => {
    expect(resolveBound({ token: "  ", nowMs: NOW })).toBe(NOW);
  });

  it("resolves a duration to that long before the instant", () => {
    expect(resolveBound({ token: "15m", nowMs: NOW })).toBe(NOW - 900_000);
  });

  it("takes a bare integer as an absolute epoch", () => {
    expect(resolveBound({ token: "1785000000000", nowMs: NOW })).toBe(1_785_000_000_000);
  });

  it("refuses a near-integer rather than resolving a typo to the epoch", () => {
    expect(resolveBound({ token: "8x", nowMs: NOW })).toBe(null);
  });
});

describe("resolveWindow", () => {
  it("resolves both ends against one instant", () => {
    expect(unwrap(resolveWindow({ from: "15m", to: "now", nowMs: NOW }))).toEqual({
      fromMs: NOW - 900_000,
      toMs: NOW,
    });
  });

  it("accepts an absolute pair", () => {
    expect(unwrap(resolveWindow({ from: "1785000000000", to: "1785000060000", nowMs: NOW }))).toEqual({
      fromMs: 1_785_000_000_000,
      toMs: 1_785_000_060_000,
    });
  });

  it("names the offending bound", () => {
    const error = unwrapErr(resolveWindow({ from: "yesterday", to: "now", nowMs: NOW }));
    expect(error.code).toBe("WINDOW_BOUNDS_INVALID");
    const errors = datadogDomainErrorLines({ error });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("--from 'yesterday' is not a window");
  });

  it("reports both bad bounds at once", () => {
    const error = unwrapErr(resolveWindow({ from: "yesterday", to: "tomorrow", nowMs: NOW }));
    expect(error.code).toBe("WINDOW_BOUNDS_INVALID");
    expect(datadogDomainErrorLines({ error })).toHaveLength(2);
  });

  it("refuses an inverted window, which would otherwise read as an empty result", () => {
    const error = unwrapErr(resolveWindow({ from: "now", to: "15m", nowMs: NOW }));
    expect(error.code).toBe("WINDOW_EMPTY");
    const errors = datadogDomainErrorLines({ error });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("the window is empty");
  });

  it("refuses a zero-length window", () => {
    const error = unwrapErr(resolveWindow({ from: "now", to: "now", nowMs: NOW }));
    expect(error.code).toBe("WINDOW_EMPTY");
    const errors = datadogDomainErrorLines({ error });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("A window must start before it ends");
  });
});

describe("windowAsQueryBounds", () => {
  it("renders the bounds as the epoch-ms strings the API takes", () => {
    expect(windowAsQueryBounds({ window: { fromMs: 1_785_000_000_000, toMs: 1_785_000_060_000 } })).toEqual({
      from: "1785000000000",
      to: "1785000060000",
    });
  });
});
