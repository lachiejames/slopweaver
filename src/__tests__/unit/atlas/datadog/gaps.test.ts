import { describe, expect, it } from "vitest";

import { openDatadogGap, openDatadogGaps, reconcileDatadogGaps } from "../../../../atlas/datadog/gaps.js";
import { datadogGapId } from "../../../../atlas/datadog/identity.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-06T01:00:00.000Z";
const LATER = "2026-09-07T01:00:00.000Z";

const gap = ({ at = AT, scope = "monitor" }: { at?: string; scope?: string } = {}) =>
  openDatadogGap({
    at,
    channel: "api",
    condition: "api-never-called",
    kind: "monitor",
    reason: "nothing has asked this organisation",
    scope,
  });

describe("openDatadogGap", () => {
  it("keys identity on the condition and scope, never on when it was found", () => {
    expect(gap().id).toBe(datadogGapId({ condition: "api-never-called", scope: "monitor" }));
    expect(gap({ at: LATER }).id).toBe(gap().id);
  });

  it("names the channel the gap is about, which is Datadog's own shape rather than the kit's surface list", () => {
    expect(gap().channel).toBe("api");
    expect(gap().status).toBe("open");
  });

  it("carries a null kind for a cross-kind gap", () => {
    const cross = openDatadogGap({
      at: AT,
      channel: "console",
      condition: "sdk-undeclared-family",
      kind: null,
      reason: "the unified event API is absent from the pinned client",
      scope: "logs-analytics",
    });

    expect(cross.kind).toBe(null);
  });
});

describe("reconcileDatadogGaps", () => {
  it("preserves the original first-detection stamp across a re-run", () => {
    const reconciled = unwrap(
      reconcileDatadogGaps({
        at: LATER,
        observed: [gap({ at: LATER })],
        rechecks: [],
        runFailed: false,
        stored: [gap()],
      }),
    );

    expect(reconciled[0]!.firstDetectedAt).toBe(AT);
    expect(reconciled[0]!.lastDetectedAt).toBe(LATER);
  });

  // A gap closes only when its own (condition, scope) pair is rechecked. The questions that never get
  // answered are exactly the ones nobody rechecks.
  it("closes a gap only on a recheck of its own condition and scope", () => {
    const reconciled = unwrap(
      reconcileDatadogGaps({
        at: LATER,
        observed: [],
        rechecks: [{ condition: "api-never-called", resolved: true, scope: "monitor" }],
        runFailed: false,
        stored: [gap()],
      }),
    );

    expect(reconciled[0]!.status).toBe("closed");
  });

  it("leaves a gap open when an UNRELATED scope was rechecked", () => {
    const reconciled = unwrap(
      reconcileDatadogGaps({
        at: LATER,
        observed: [],
        rechecks: [{ condition: "api-never-called", resolved: true, scope: "dashboard" }],
        runFailed: false,
        stored: [gap()],
      }),
    );

    expect(reconciled[0]!.status).toBe("open");
  });

  it("closes nothing at all when the run itself failed", () => {
    const reconciled = unwrap(
      reconcileDatadogGaps({
        at: LATER,
        observed: [],
        rechecks: [{ condition: "api-never-called", resolved: true, scope: "monitor" }],
        runFailed: true,
        stored: [gap()],
      }),
    );

    expect(reconciled[0]!.status).toBe("open");
  });

  it("REFUSES a run that reported the same gap twice", () => {
    const twice = reconcileDatadogGaps({
      at: AT,
      observed: [gap(), gap()],
      rechecks: [],
      runFailed: false,
      stored: [],
    });

    expect(twice.isErr()).toBe(true);
    expect(unwrapErr(twice)[0]).toContain("same gap twice");
  });
});

describe("openDatadogGaps", () => {
  it("returns only the open ones, which is what a ticket list wants", () => {
    const closed = { ...gap({ scope: "dashboard" }), status: "closed" as const };

    expect(openDatadogGaps({ gaps: [gap(), closed] }).map((one) => one.scope)).toStrictEqual(["monitor"]);
  });
});
