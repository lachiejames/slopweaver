/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import {
  type ErrorsReport,
  parseDatadogErrorsOptions,
  renderErrorsText,
} from "../../../../../cli/commands/datadog/errorsCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const NOW_MS = Date.UTC(2026, 8, 29);
const DAY_MS = 86_400_000;

describe("parseDatadogErrorsOptions", () => {
  it("defaults to a day of every state on the trace track, most events first", () => {
    expect(unwrap(parseDatadogErrorsOptions({ rest: [] }))).toEqual({
      from: "1d",
      json: false,
      limit: 25,
      order: "count",
      query: "*",
      states: [],
      to: "now",
      track: "trace",
    });
  });

  it("reads the console's state words and the newest-first order", () => {
    const options = unwrap(
      parseDatadogErrorsOptions({ rest: ["--state", "for-review,reviewed", "--order", "newest", "--limit", "5"] }),
    );
    expect(options.states).toEqual(["OPEN", "ACKNOWLEDGED"]);
    expect(options.order).toBe("newest");
    expect(options.limit).toBe(5);
  });

  it("refuses every bad value at once", () => {
    const error = unwrapErr(
      parseDatadogErrorsOptions({ rest: ["--track", "spans", "--state", "triaged", "--limit", "0"] }),
    );
    expect(error.code).toBe("OPTIONS_REFUSED");
    expect(error.message).toContain("--track must be one of trace, logs, rum, got 'spans'");
    expect(error.message).toContain("--state 'triaged'");
    expect(error.message).toContain('--limit must be a whole number of at least 1, not "0"');
  });
});

describe("renderErrorsText", () => {
  const report: ErrorsReport = {
    byState: {
      OPEN: { capped: true, events: 5310, issues: 100, medianAgeDays: 64, oldestAgeDays: 281, olderThan30Days: 71 },
    },
    fromMs: NOW_MS - DAY_MS,
    issues: [
      {
        count: 412,
        errorMessage: "Invoice 123456789 already exported\n    at send (export.ts:1)",
        errorType: "DuplicateExportError",
        firstSeenMs: NOW_MS - 75 * DAY_MS,
        firstSeenVersion: "f00dcafe",
        id: "6d6d6d6d",
        lastSeenMs: NOW_MS,
        link: "https://ap1.datadoghq.com/error-tracking/issue/6d6d6d6d",
        service: "billing-api",
        state: "OPEN",
      },
    ],
    nowMs: NOW_MS,
    order: "count",
    query: "env:production",
    site: "ap1.datadoghq.com",
    states: ["OPEN"],
    toMs: NOW_MS,
    track: "trace",
  };

  it("marks a capped state as a floor and keeps a multi-line message on one line", () => {
    const text = renderErrorsText({ limit: 25, report });
    expect(text).toContain("For Review  ≥100 issue(s) · 5,310 event(s) · median age 64d · oldest 281d");
    expect(text).toContain("DuplicateExportError: Invoice 123456789 already exported at send (export.ts:1)");
    expect(text).toContain("first seen 2026-07-16T00:00:00.000Z (75d) in f00dcafe");
  });
});
