/*
 * How `browser shot` resolves its flags: the default evidence-capture profile and its target, readiness timeout
 * and caption, the `--raw` diagnostic profile and its settle, and every refusal on the address and the output.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_READINESS_TIMEOUT_MS,
  MAX_READINESS_TIMEOUT_MS,
} from "../../../../../../browser/evidenceCaptureSnippet.js";
import { resolveShotOptions } from "../../../../../../cli/commands/browser/shotCore.js";
import { SHOT_DEFAULT_SETTLE_MS, SHOT_MAX_SETTLE_MS } from "../../../../../../cli/commands/browser/shotFlags.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";

/** The raw profile's settle, or a throw when the options resolved to the other profile. */
function settleOf({
  options,
}: {
  options: { readonly mode: { readonly kind: string; readonly settleMs?: number } };
}): number {
  return options.mode.settleMs!;
}

describe("resolveShotOptions", () => {
  it("resolves the DEFAULT profile as evidence capture with the target inferred at run time", () => {
    const options = unwrap(
      resolveShotOptions({
        home: undefined,
        json: false,
        out: "/tmp/panel.png",
        settle: undefined,
        url: "https://app.datadoghq.com/logs?viz=timeseries",
      }),
    );
    expect(options.url).toBe("https://app.datadoghq.com/logs?viz=timeseries");
    expect(options.out).toBe("/tmp/panel.png");
    expect(options.mode).toEqual({
      caption: null,
      kind: "evidence",
      readinessTimeoutMs: DEFAULT_READINESS_TIMEOUT_MS,
      target: null,
    });
    expect(options.json).toBe(false);
  });

  it("reads an explicit target, readiness timeout and caption", () => {
    const options = unwrap(
      resolveShotOptions({
        caption: "pool errors by service",
        home: undefined,
        json: false,
        out: "/tmp/panel.png",
        readinessTimeout: "12000",
        settle: undefined,
        target: "datadog-logs-v1:timeseries",
        url: "https://example.com/",
      }),
    );
    expect(options.mode).toEqual({
      caption: "pool errors by service",
      kind: "evidence",
      readinessTimeoutMs: 12000,
      target: { adapterId: "datadog-logs-v1", targetId: "timeseries" },
    });
  });

  it("refuses --settle on the default path, naming the flag that replaced it", () => {
    const problems = unwrapErr(
      resolveShotOptions({
        home: undefined,
        json: false,
        out: "/tmp/a.png",
        settle: "20000",
        url: "https://example.com/",
      }),
    );
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("--settle is the --raw profile's flag");
    expect(problems[0]).toContain("--readiness-timeout");
  });

  it("refuses an unknown target and lists the closed set", () => {
    const problems = unwrapErr(
      resolveShotOptions({
        home: undefined,
        json: false,
        out: "/tmp/a.png",
        settle: undefined,
        target: "datadog-logs-v1:sidebar",
        url: "https://example.com/",
      }),
    );
    expect(problems).toEqual([
      "--target 'datadog-logs-v1:sidebar' is not a target this build knows; the closed set is " +
        "datadog-logs-v1:timeseries, datadog-apm-traces-v1:timeseries",
    ]);
  });

  it("refuses a readiness timeout of zero or above the cap", () => {
    const zero = unwrapErr(
      resolveShotOptions({
        home: undefined,
        json: false,
        out: "/tmp/a.png",
        readinessTimeout: "0",
        settle: undefined,
        url: "https://example.com/",
      }),
    );
    expect(zero).toEqual([`--readiness-timeout takes 1..${String(MAX_READINESS_TIMEOUT_MS)}ms, got '0'`]);
    const over = unwrapErr(
      resolveShotOptions({
        home: undefined,
        json: false,
        out: "/tmp/a.png",
        readinessTimeout: String(MAX_READINESS_TIMEOUT_MS + 1),
        settle: undefined,
        url: "https://example.com/",
      }),
    );
    expect(over).toEqual([`--readiness-timeout takes 1..${String(MAX_READINESS_TIMEOUT_MS)}ms, got '60001'`]);
  });

  it("refuses a blank caption", () => {
    const problems = unwrapErr(
      resolveShotOptions({
        caption: "  ",
        home: undefined,
        json: false,
        out: "/tmp/a.png",
        settle: undefined,
        url: "https://example.com/",
      }),
    );
    expect(problems).toEqual(["--caption cannot be blank"]);
  });

  it("resolves --raw as the diagnostic profile, defaulting the settle", () => {
    const options = unwrap(
      resolveShotOptions({
        home: undefined,
        json: false,
        out: "/tmp/panel.png",
        raw: true,
        settle: undefined,
        url: "https://app.datadoghq.com/dashboard/abc",
      }),
    );
    expect(options.mode).toEqual({ kind: "raw", settleMs: SHOT_DEFAULT_SETTLE_MS });
  });

  it("refuses evidence flags under --raw, each by name", () => {
    const problems = unwrapErr(
      resolveShotOptions({
        caption: "x",
        home: undefined,
        json: false,
        out: "/tmp/a.png",
        raw: true,
        readinessTimeout: "1000",
        settle: undefined,
        target: "datadog-logs-v1:timeseries",
        url: "https://example.com/",
      }),
    );
    expect(problems).toEqual([
      "--target belongs to the default evidence capture and means nothing under --raw",
      "--readiness-timeout belongs to the default evidence capture and means nothing under --raw",
      "--caption belongs to the default evidence capture and means nothing under --raw",
    ]);
  });

  it("reads an explicit settle and home under --raw", () => {
    const options = unwrap(
      resolveShotOptions({
        home: "/tmp/home",
        json: true,
        out: "/tmp/panel.png",
        raw: true,
        settle: "9000",
        url: "https://example.com/",
      }),
    );
    expect(settleOf({ options })).toBe(9000);
    expect(options.home).toBe("/tmp/home");
    expect(options.json).toBe(true);
  });

  it("accumulates both missing flags rather than stopping at the first", () => {
    const problems = unwrapErr(
      resolveShotOptions({ home: undefined, json: false, out: undefined, settle: undefined, url: undefined }),
    );
    expect(problems.length).toBe(2);
    expect(problems[0]).toContain("--url <address>");
    expect(problems[1]).toContain("--out <file.png>");
  });

  it("refuses an --out that is not a .png", () => {
    const problems = unwrapErr(
      resolveShotOptions({
        home: undefined,
        json: false,
        out: "/tmp/panel.jpg",
        settle: undefined,
        url: "https://example.com/",
      }),
    );
    expect(problems).toEqual(["--out takes a .png path, got '/tmp/panel.jpg'"]);
  });

  it("refuses a relative address, which has no origin to bind a lease to", () => {
    const problems = unwrapErr(
      resolveShotOptions({ home: undefined, json: false, out: "/tmp/a.png", settle: undefined, url: "/dashboard" }),
    );
    expect(problems).toEqual(["--url takes an absolute address, got '/dashboard'"]);
  });

  it("refuses a non-http scheme", () => {
    const problems = unwrapErr(
      resolveShotOptions({
        home: undefined,
        json: false,
        out: "/tmp/a.png",
        settle: undefined,
        url: "file:///etc/passwd",
      }),
    );
    expect(problems).toEqual(["--url takes an http or https address, got 'file:///etc/passwd'"]);
  });

  it("refuses a non-numeric settle", () => {
    const problems = unwrapErr(
      resolveShotOptions({
        home: undefined,
        json: false,
        out: "/tmp/a.png",
        raw: true,
        settle: "12s",
        url: "https://example.com/",
      }),
    );
    expect(problems).toEqual(["--settle takes whole milliseconds, got '12s'"]);
  });

  it("refuses a settle above the cap, which would outlive the client", () => {
    const problems = unwrapErr(
      resolveShotOptions({
        home: undefined,
        json: false,
        out: "/tmp/a.png",
        raw: true,
        settle: String(SHOT_MAX_SETTLE_MS + 1),
        url: "https://example.com/",
      }),
    );
    expect(problems).toEqual([`--settle may be at most ${String(SHOT_MAX_SETTLE_MS)}ms, got '60001'`]);
  });

  it("accepts the cap itself", () => {
    const options = unwrap(
      resolveShotOptions({
        home: undefined,
        json: false,
        out: "/tmp/a.png",
        raw: true,
        settle: String(SHOT_MAX_SETTLE_MS),
        url: "https://example.com/",
      }),
    );
    expect(settleOf({ options })).toBe(SHOT_MAX_SETTLE_MS);
  });

  it("accepts a zero settle", () => {
    const options = unwrap(
      resolveShotOptions({
        home: undefined,
        json: false,
        out: "/tmp/a.png",
        raw: true,
        settle: "0",
        url: "https://example.com/",
      }),
    );
    expect(settleOf({ options })).toBe(0);
  });
});
