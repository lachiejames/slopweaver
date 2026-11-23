/**
 * `queue refusals`: its arguments, and the exit code a read comes to — `0` only for a complete report from a console
 * that answered, so an incomplete one or a silent console never passes `verb || alert`.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { parseRefusalsArgs, refusalsExitCode } from "../../../../../cli/commands/queue/refusalsRun.js";
import { QUEUE_REFUSALS_USAGE } from "../../../../../cli/commands/queue/refusalsUsage.js";

const REPORT_URL = "http://localhost:3100/api/queue-refusals";
const AT = "2026-10-09T06:00:00.000Z";

describe("parseRefusalsArgs", () => {
  it("reads --json, and its absence", () => {
    expect([unwrap(parseRefusalsArgs({ rest: ["--json"] })), unwrap(parseRefusalsArgs({ rest: [] }))]).toEqual([
      { json: true },
      { json: false },
    ]);
  });

  it("documents exactly the one flag it parses", () => {
    expect(QUEUE_REFUSALS_USAGE).toBe("usage: slopweaver queue refusals [--json]");
  });

  it("refuses a flag or argument it does not take", () => {
    expect(unwrapErr(parseRefusalsArgs({ rest: ["--home", "/tmp/x"] })).join(" ")).toContain("--home");
    expect(unwrapErr(parseRefusalsArgs({ rest: ["stray"] })).join(" ")).toContain("stray");
  });
});

describe("refusalsExitCode", () => {
  it("is 0 for a complete report, withheld cards or none", () => {
    const report = { consoleUrl: REPORT_URL, observedAtIso: AT, reached: true as const, unread: [] };
    expect([
      refusalsExitCode({ outcome: { ...report, complete: true, withheld: [] } }),
      refusalsExitCode({
        outcome: { ...report, complete: true, withheld: [{ key: "post:sd-1", kind: "post", title: "t", why: "w" }] },
      }),
    ]).toEqual([0, 0]);
  });

  it("is 1 for an incomplete report and for a console that did not answer", () => {
    expect([
      refusalsExitCode({
        outcome: {
          complete: false,
          consoleUrl: REPORT_URL,
          observedAtIso: AT,
          reached: true,
          unread: [{ source: "board", why: "timed out" }],
          withheld: [],
        },
      }),
      refusalsExitCode({ outcome: { consoleUrl: REPORT_URL, reached: false, why: "did not answer" } }),
    ]).toEqual([1, 1]);
  });
});
