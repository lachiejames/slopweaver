import { describe, expect, it } from "vitest";

import {
  type AtlasGap,
  KIT_GAP_CONDITIONS,
  openDisagreementGap,
  openGap,
  openGaps,
  reconcileGaps,
} from "../../../../atlas/kit/gaps.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-08-27T00:00:00.000Z";
const LATER = "2026-08-28T00:00:00.000Z";

function gap({ condition, scope }: { condition: string; scope: string }): AtlasGap {
  return openGap({ at: AT, condition, fields: [], kind: null, reason: "because", scope, surfaces: [] });
}

describe("KIT_GAP_CONDITIONS", () => {
  it("holds only the conditions that concern the relationship between surfaces", () => {
    expect([...KIT_GAP_CONDITIONS]).toEqual(["api-browser-disagreement", "browser-surface-unreadable"]);
  });
});

describe("openDisagreementGap", () => {
  it("records which surfaces disagree and which fields differ", () => {
    const result = openDisagreementGap({
      at: AT,
      fields: ["status", "owner"],
      kind: "control",
      reason: "the api says active and the browser says draft",
      scope: "control/soc2-cc1",
      surfaces: ["manage-api", "browser"],
    });
    expect(result.condition).toBe("api-browser-disagreement");
    expect([...result.surfaces]).toEqual(["manage-api", "browser"]);
    expect([...result.fields]).toEqual(["status", "owner"]);
    expect(result.status).toBe("open");
    expect(result.kind).toBe("control");
  });

  it("gives the same identity to the same disagreement seen twice", () => {
    const first = openDisagreementGap({
      at: AT,
      fields: ["status"],
      kind: "control",
      reason: "a",
      scope: "control/soc2-cc1",
      surfaces: ["manage-api", "browser"],
    });
    const second = openDisagreementGap({
      at: LATER,
      fields: ["owner"],
      kind: "control",
      reason: "b",
      scope: "control/soc2-cc1",
      surfaces: ["manage-api", "browser"],
    });
    expect(second.id).toBe(first.id);
  });
});

describe("reconcileGaps", () => {
  it("keeps the original first-detection stamp when a gap is seen again", () => {
    const stored = [gap({ condition: "schema-drift", scope: "controls" })];
    const observed = [
      openGap({
        at: LATER,
        condition: "schema-drift",
        fields: [],
        kind: null,
        reason: "again",
        scope: "controls",
        surfaces: [],
      }),
    ];
    const result = unwrap(reconcileGaps({ at: LATER, observed, rechecks: [], runFailed: false, stored }));
    expect(result.length).toBe(1);
    expect(result[0]!.firstDetectedAt).toBe(AT);
    expect(result[0]!.lastDetectedAt).toBe(LATER);
    expect(result[0]!.status).toBe("open");
  });

  it("closes a gap only when its own condition and scope were rechecked", () => {
    const stored = [gap({ condition: "schema-drift", scope: "controls" })];
    const result = unwrap(
      reconcileGaps({
        at: LATER,
        observed: [],
        rechecks: [{ condition: "schema-drift", resolved: true, scope: "controls" }],
        runFailed: false,
        stored,
      }),
    );
    expect(result[0]!.status).toBe("closed");
    expect(result[0]!.lastCheckedAt).toBe(LATER);
  });

  it("leaves a gap open when an unrelated condition was rechecked", () => {
    const stored = [gap({ condition: "schema-drift", scope: "controls" })];
    const result = unwrap(
      reconcileGaps({
        at: LATER,
        observed: [],
        rechecks: [{ condition: "pagination-incomplete", resolved: true, scope: "controls" }],
        runFailed: false,
        stored,
      }),
    );
    expect(result[0]!.status).toBe("open");
  });

  it("closes nothing at all when the run itself failed", () => {
    const stored = [gap({ condition: "schema-drift", scope: "controls" })];
    const result = unwrap(
      reconcileGaps({
        at: LATER,
        observed: [],
        rechecks: [{ condition: "schema-drift", resolved: true, scope: "controls" }],
        runFailed: true,
        stored,
      }),
    );
    expect(result[0]!.status).toBe("open");
  });

  it("refuses a run that reported the same gap twice", () => {
    const twice = [
      gap({ condition: "schema-drift", scope: "controls" }),
      gap({ condition: "schema-drift", scope: "controls" }),
    ];
    const result = unwrapErr(reconcileGaps({ at: AT, observed: twice, rechecks: [], runFailed: false, stored: [] }));
    expect(result[0]).toContain("the same gap twice");
  });

  it("returns gaps in a deterministic order, so two runs write identical bytes", () => {
    const stored = [gap({ condition: "z-condition", scope: "b" }), gap({ condition: "a-condition", scope: "a" })];
    const result = unwrap(reconcileGaps({ at: AT, observed: [], rechecks: [], runFailed: false, stored }));
    const ids = result.map((entry) => entry.id);
    expect(ids).toEqual([...ids].toSorted());
  });

  it("reconciles a platform's own stored gap shape without it becoming an AtlasGap", () => {
    // The seam that matters: a gap carrying a platform-specific field reconciles unchanged, so adopting the
    // kit never forces an on-disk rename.
    const platformGap = { ...gap({ condition: "schema-drift", scope: "controls" }), channel: "manage-api" as const };
    const result = unwrap(
      reconcileGaps({ at: LATER, observed: [], rechecks: [], runFailed: false, stored: [platformGap] }),
    );
    expect(result[0]!.channel).toBe("manage-api");
  });
});

describe("openGaps", () => {
  it("returns only the open ones", () => {
    const stored = [gap({ condition: "schema-drift", scope: "controls" })];
    const closed = unwrap(
      reconcileGaps({
        at: LATER,
        observed: [],
        rechecks: [{ condition: "schema-drift", resolved: true, scope: "controls" }],
        runFailed: false,
        stored,
      }),
    );
    expect(openGaps({ gaps: closed }).length).toBe(0);
    expect(openGaps({ gaps: stored }).length).toBe(1);
  });
});
