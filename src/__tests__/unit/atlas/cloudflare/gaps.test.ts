import { describe, expect, it } from "vitest";

import { CloudflareClientErrors } from "../../../../atlas/cloudflare/errors.js";
import {
  CLOUDFLARE_GAP_CONDITIONS,
  classifyCloudflareClientErrorGap,
  openCloudflareGap,
  openCloudflareGaps,
  recheckEveryCondition,
  reconcileCloudflareGaps,
} from "../../../../atlas/cloudflare/gaps.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";

describe("classifyCloudflareClientErrorGap", () => {
  it("maps every client error kind to its own gap condition", () => {
    const cause = new Error("x");
    expect(
      classifyCloudflareClientErrorGap({ error: CloudflareClientErrors.authentication({ cause, operation: "o" }) }),
    ).toBe("authentication-refused");
    expect(
      classifyCloudflareClientErrorGap({ error: CloudflareClientErrors.permission({ cause, operation: "o" }) }),
    ).toBe("permission-refused");
    expect(
      classifyCloudflareClientErrorGap({ error: CloudflareClientErrors.notFound({ cause, operation: "o" }) }),
    ).toBe("not-found");
    expect(
      classifyCloudflareClientErrorGap({ error: CloudflareClientErrors.rateLimit({ cause, operation: "o" }) }),
    ).toBe("rate-limited");
    expect(
      classifyCloudflareClientErrorGap({
        error: CloudflareClientErrors.provider({ cause, operation: "o", status: 500 }),
      }),
    ).toBe("provider-error");
    expect(
      classifyCloudflareClientErrorGap({ error: CloudflareClientErrors.transport({ cause, operation: "o" }) }),
    ).toBe("transport-error");
    expect(
      classifyCloudflareClientErrorGap({ error: CloudflareClientErrors.responseEnvelope({ cause, operation: "o" }) }),
    ).toBe("response-envelope-error");
    expect(classifyCloudflareClientErrorGap({ error: CloudflareClientErrors.schema({ cause, operation: "o" }) })).toBe(
      "schema-drift",
    );
  });
});

describe("openCloudflareGap", () => {
  it("stamps a fresh open gap", () => {
    const gap = openCloudflareGap({ at: AT, condition: "transport-error", kind: "zone", reason: "boom", scope: "s" });
    expect(gap.status).toBe("open");
    expect(gap.firstDetectedAt).toBe(AT);
    expect(gap.lastDetectedAt).toBe(AT);
    expect(gap.kind).toBe("zone");
  });
});

describe("reconcileCloudflareGaps", () => {
  it("accumulates a newly observed gap", () => {
    const gap = openCloudflareGap({ at: AT, condition: "transport-error", kind: "zone", reason: "boom", scope: "s" });
    const result = reconcileCloudflareGaps({ at: AT, observed: [gap], rechecks: [], runFailed: true, stored: [] });
    expect(unwrap(result)).toEqual([gap]);
  });

  it("preserves firstDetectedAt across runs for the same gap", () => {
    const first = openCloudflareGap({ at: AT, condition: "transport-error", kind: "zone", reason: "boom", scope: "s" });
    const second = openCloudflareGap({
      at: LATER,
      condition: "transport-error",
      kind: "zone",
      reason: "boom again",
      scope: "s",
    });
    const result = unwrap(
      reconcileCloudflareGaps({ at: LATER, observed: [second], rechecks: [], runFailed: true, stored: [first] }),
    );
    expect(result[0]?.firstDetectedAt).toBe(AT);
    expect(result[0]?.lastDetectedAt).toBe(LATER);
  });

  it("refuses the same gap id reported twice in one run", () => {
    const gap = openCloudflareGap({ at: AT, condition: "transport-error", kind: "zone", reason: "boom", scope: "s" });
    const result = reconcileCloudflareGaps({
      at: AT,
      observed: [gap, gap],
      rechecks: [],
      runFailed: true,
      stored: [],
    });
    expect(unwrapErr(result)).toEqual([`this run reported the same gap twice: ${gap.id}`]);
  });

  it("closes a gap only when its exact condition/scope is rechecked and resolved", () => {
    const gap = openCloudflareGap({ at: AT, condition: "transport-error", kind: "zone", reason: "boom", scope: "s" });
    const result = unwrap(
      reconcileCloudflareGaps({
        at: LATER,
        observed: [],
        rechecks: [{ condition: "transport-error", resolved: true, scope: "s" }],
        runFailed: false,
        stored: [gap],
      }),
    );
    expect(result[0]?.status).toBe("closed");
  });

  it("leaves a gap open when its recheck is not resolved", () => {
    const gap = openCloudflareGap({ at: AT, condition: "transport-error", kind: "zone", reason: "boom", scope: "s" });
    const result = unwrap(
      reconcileCloudflareGaps({
        at: LATER,
        observed: [],
        rechecks: [{ condition: "transport-error", resolved: false, scope: "s" }],
        runFailed: false,
        stored: [gap],
      }),
    );
    expect(result[0]?.status).toBe("open");
  });

  it("closes nothing when the run itself failed, even with rechecks supplied", () => {
    const gap = openCloudflareGap({ at: AT, condition: "transport-error", kind: "zone", reason: "boom", scope: "s" });
    const result = unwrap(
      reconcileCloudflareGaps({
        at: LATER,
        observed: [],
        rechecks: [{ condition: "transport-error", resolved: true, scope: "s" }],
        runFailed: true,
        stored: [gap],
      }),
    );
    expect(result[0]?.status).toBe("open");
  });
});

describe("openCloudflareGaps", () => {
  it("filters to only the open gaps", () => {
    const open = openCloudflareGap({ at: AT, condition: "transport-error", kind: "zone", reason: "boom", scope: "s" });
    const closed = { ...open, id: "closed-id", status: "closed" as const };
    expect(openCloudflareGaps({ gaps: [open, closed] })).toEqual([open]);
  });
});

describe("recheckEveryCondition", () => {
  it("resolves every condition at the one scope it is given, and nowhere else", () => {
    const rechecks = recheckEveryCondition({ scope: "zone/z/legacy-waf/packages" });
    expect(rechecks.length).toBe(CLOUDFLARE_GAP_CONDITIONS.length);
    expect(new Set(rechecks.map((recheck) => recheck.condition))).toEqual(new Set(CLOUDFLARE_GAP_CONDITIONS));
    expect(new Set(rechecks.map((recheck) => `${recheck.scope}:${String(recheck.resolved)}`))).toEqual(
      new Set(["zone/z/legacy-waf/packages:true"]),
    );
  });

  it("closes an open gap at that scope", () => {
    const gap = openCloudflareGap({ at: AT, condition: "graphql-error", kind: "zone", reason: "boom", scope: "s" });
    const gaps = unwrap(
      reconcileCloudflareGaps({
        at: LATER,
        observed: [],
        rechecks: recheckEveryCondition({ scope: "s" }),
        runFailed: false,
        stored: [gap],
      }),
    );
    expect(gaps).toEqual([{ ...gap, lastCheckedAt: LATER, status: "closed" }]);
  });
});
