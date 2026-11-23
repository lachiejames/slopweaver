import { describe, expect, it } from "vitest";

import { schedulingState } from "../../../../../cli/commands/briefing/freshnessProjection.js";
import type { RecipeDefinition } from "../../../../../live/automation/definition.js";
import { buildResyncPolicies, type ResyncPolicy } from "../../../../../live/resync/policy.js";
import { resyncDefinitionFor } from "../../../../../live/resync/registrationPlan.js";

const HOUR = 60 * 60 * 1000;
const NOW_ISO = "2026-10-13T09:00:00.000Z";

/** One seated atlas policy per platform, built by the production roster builder. */
function policiesFor({ platforms }: { platforms: readonly string[] }): readonly ResyncPolicy[] {
  return buildResyncPolicies({
    atlases: platforms.map((platform) => ({
      platform,
      resyncCommand: `slopweaver atlas ${platform} sync`,
      seated: true,
      windowMs: 4 * HOUR,
    })),
    corpus: [],
  }).policies;
}

/** The row this build would register for a platform, as the registrar writes it. */
function rowFor({ platform }: { platform: string }): RecipeDefinition {
  return resyncDefinitionFor({ policy: policiesFor({ platforms: [platform] })[0]! });
}

describe("schedulingState", () => {
  it("registers an enabled row that runs its target and pauses a disabled one", () => {
    const policies = policiesFor({ platforms: ["airtable", "clerk"] });
    const definitions = [rowFor({ platform: "airtable" }), { ...rowFor({ platform: "clerk" }), enabled: false }];
    const state = schedulingState({ definitions, nowIso: NOW_ISO, policies });
    expect({ paused: state.paused, registered: state.registered }).toEqual({
      paused: ["resync-atlas-clerk"],
      registered: ["resync-atlas-airtable"],
    });
  });

  it("counts neither a row whose argv runs another target, nor an unparseable cadence, nor an absent row", () => {
    const policies = policiesFor({ platforms: ["airtable", "clerk", "knock"] });
    const definitions = [
      { ...rowFor({ platform: "airtable" }), params: rowFor({ platform: "clerk" }).params },
      { ...rowFor({ platform: "clerk" }), cadence: "not-a-cron" },
    ];
    const state = schedulingState({ definitions, nowIso: NOW_ISO, policies });
    expect({ paused: state.paused, registered: state.registered }).toEqual({ paused: [], registered: [] });
  });

  it("keeps every stored row's cadence, including rows that schedule nothing and rows naming no policy", () => {
    const policies = policiesFor({ platforms: ["airtable", "clerk"] });
    const definitions = [
      rowFor({ platform: "airtable" }),
      { ...rowFor({ platform: "clerk" }), cadence: "not-a-cron" },
      { ...rowFor({ platform: "knock" }), cadence: "15 3 * * *" },
    ];
    const state = schedulingState({ definitions, nowIso: NOW_ISO, policies });
    expect([...state.storedCadences.entries()]).toEqual([
      ["resync-atlas-airtable", "0 */4 * * *"],
      ["resync-atlas-clerk", "not-a-cron"],
      ["resync-atlas-knock", "15 3 * * *"],
    ]);
    expect({ paused: state.paused, registered: state.registered }).toEqual({
      paused: [],
      registered: ["resync-atlas-airtable"],
    });
  });

  it("schedules nothing and stores nothing for an empty store", () => {
    const state = schedulingState({
      definitions: [],
      nowIso: NOW_ISO,
      policies: policiesFor({ platforms: ["airtable"] }),
    });
    expect({
      cadences: [...state.storedCadences.entries()],
      paused: state.paused,
      registered: state.registered,
    }).toEqual({ cadences: [], paused: [], registered: [] });
  });
});
