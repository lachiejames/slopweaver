import { describe, expect, it } from "vitest";

import type { RecipeDefinition } from "../../../../live/automation/definition.js";
import { driftedKind, withOperatorFields } from "../../../../live/resync/managedRowFields.js";
import { buildResyncPolicies } from "../../../../live/resync/policy.js";
import { resyncDefinitionFor } from "../../../../live/resync/registrationPlan.js";

const HOUR = 60 * 60 * 1000;

/** The row this build derives for one atlas, seated or run in the tick. */
const derivedRow = ({ seated }: { seated: boolean }): RecipeDefinition =>
  resyncDefinitionFor({
    policy: buildResyncPolicies({
      atlases: [{ platform: "airtable", resyncCommand: "slopweaver atlas airtable sync", seated, windowMs: 4 * HOUR }],
      corpus: [],
    }).policies[0]!,
  });

describe("driftedKind", () => {
  it("accepts a stored row on either managed kind, in either direction", () => {
    const seated = derivedRow({ seated: true });
    const tick = derivedRow({ seated: false });
    expect(driftedKind({ current: tick, wanted: seated })).toBe(false);
    expect(driftedKind({ current: seated, wanted: tick })).toBe(false);
  });

  it("reports a kind no pass writes as somebody's edit", () => {
    const wanted = derivedRow({ seated: true });
    expect(driftedKind({ current: { ...wanted, kind: "investigate" }, wanted })).toBe(true);
  });
});

describe("withOperatorFields", () => {
  const hold = { askedIso: "2026-09-29T00:00:00.000Z", clearedBy: null, reason: "failed its last pass" };
  const channelApprovals = [{ atIso: "2026-09-21T00:00:00.000Z", channel: "C0DEMO", dmChannel: "D0DEMO", ts: "1.2" }];

  it("carries enabled, hold and channel approvals from the stored row onto the derived one", () => {
    const wanted = derivedRow({ seated: false });
    const current: RecipeDefinition = { ...derivedRow({ seated: true }), channelApprovals, enabled: false, hold };
    const written = withOperatorFields({ current, wanted });
    expect(written).toEqual({ ...wanted, channelApprovals, enabled: false, hold });
  });

  it("writes no hold or approvals key when the stored row had none", () => {
    const wanted = derivedRow({ seated: true });
    const written = withOperatorFields({ current: { ...wanted, cadence: "0 0 * * *" }, wanted });
    expect(written).toEqual(wanted);
    expect(Object.keys(written)).not.toContain("hold");
    expect(Object.keys(written)).not.toContain("channelApprovals");
  });
});
