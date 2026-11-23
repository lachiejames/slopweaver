import { describe, expect, it } from "vitest";

import type { RecipeDefinition } from "../../../../live/automation/definition.js";
import { buildResyncPolicies, type ResyncPolicy } from "../../../../live/resync/policy.js";
import {
  aliasedRecipeIds,
  planResyncRegistration,
  registrationCounts,
  resyncArgv,
  resyncDefinitionFor,
  rowRunsTarget,
} from "../../../../live/resync/registrationPlan.js";

const HOUR = 60 * 60 * 1000;

const policiesFor = ({
  platforms,
  seated = true,
}: {
  platforms: readonly string[];
  seated?: boolean;
}): readonly ResyncPolicy[] =>
  buildResyncPolicies({
    atlases: platforms.map((platform) => ({
      platform,
      resyncCommand: `slopweaver atlas ${platform} sync`,
      seated,
      windowMs: 4 * HOUR,
    })),
    corpus: [],
  }).policies;

/** The one row a compile-only atlas derives: no walk and no model, so the chair's tick runs it with no seat. */
const tickPolicy = (): ResyncPolicy => policiesFor({ platforms: ["airtable"], seated: false })[0]!;

describe("resyncDefinitionFor", () => {
  it("declares `read`, the local destination and backfill, and names the wrapper verb", () => {
    const policy = policiesFor({ platforms: ["airtable"] })[0]!;
    expect(resyncDefinitionFor({ policy })).toEqual({
      cadence: "0 */4 * * *",
      destination: { kind: "local-atlas" },
      effect: "read",
      enabled: true,
      kind: "resync",
      onMissed: "backfill",
      params: { argv: ["recipe", "resync", "--atlas", "airtable"] },
      recipeId: "resync-atlas-airtable",
      schemaVersion: 1,
    });
  });
});

describe("a seated target's managed row always carries the seated kind", () => {
  // The regression, written as the failure that happened. MEASURED: a hand repair moved 44 rows
  // aside and re-ran this pass, and because a CREATE defaulted to the pre-cutover `verb-run`, all 44 came
  // back on a kind `automation seat` cannot reach. `automation due` then read `43 actionable · 0 want a session`.
  it("writes the seated kind on a create, with no flag to remember", () => {
    const plan = planResyncRegistration({
      existing: [],
      owned: [],
      policies: policiesFor({ platforms: ["airtable"] }),
    });
    expect(plan.changes[0]!.definition!.kind).toBe("resync");
  });

  it("leaves a row already on the seated kind alone", () => {
    const policy = policiesFor({ platforms: ["airtable"] })[0]!;
    const seated = resyncDefinitionFor({ policy });
    const plan = planResyncRegistration({
      existing: [seated],
      owned: [seated.recipeId],
      policies: [policy],
    });
    expect(plan.changes[0]!.action).toBe("unchanged");
  });

  // The self-heal: a row a build predating the seated kind wrote, or one a repair recreated, is REPAIRED
  // rather than reported as somebody's edit — which is what `driftedKind` allowing `verb-run` buys.
  it("updates an owned verb-run row that is already in the store to the seated kind", () => {
    const policy = policiesFor({ platforms: ["airtable"] })[0]!;
    const stored = { ...resyncDefinitionFor({ policy }), kind: "verb-run" };
    const plan = planResyncRegistration({
      existing: [stored],
      owned: [stored.recipeId],
      policies: [policy],
    });
    expect(plan.changes[0]!.action).toBe("update");
    expect(plan.changes[0]!.definition!.kind).toBe("resync");
  });

  it("inherits a paused row's own `enabled` through that repair", () => {
    const policy = policiesFor({ platforms: ["airtable"] })[0]!;
    const paused = { ...resyncDefinitionFor({ policy }), enabled: false, kind: "verb-run" };
    const plan = planResyncRegistration({
      existing: [paused],
      owned: [paused.recipeId],
      policies: [policy],
    });
    expect(plan.changes[0]!.definition!.enabled).toBe(false);
  });

  it("inherits a held row's `hold` and `channelApprovals` through that repair — neither is the registrar's", () => {
    const policy = policiesFor({ platforms: ["airtable"] })[0]!;
    const hold = { askedIso: "2026-09-29T15:37:06.542Z", clearedBy: null, finding: "a-finding", reason: "failed" };
    const channelApprovals = [{ atIso: "2026-09-29T15:00:00.000Z", channel: "C-ops", runSlug: "an-ask" }];
    const held = { ...resyncDefinitionFor({ policy }), channelApprovals, hold, kind: "verb-run" };
    const plan = planResyncRegistration({ existing: [held], owned: [held.recipeId], policies: [policy] });
    expect(plan.changes[0]!.action).toBe("update");
    expect(plan.changes[0]!.definition!.hold).toEqual(hold);
    expect(plan.changes[0]!.definition!.channelApprovals).toEqual(channelApprovals);
  });

  it("refuses to repair a row no pass on this install recorded writing", () => {
    const policy = policiesFor({ platforms: ["airtable"] })[0]!;
    const stored = { ...resyncDefinitionFor({ policy }), kind: "verb-run" };
    const plan = planResyncRegistration({
      existing: [stored],
      owned: [],
      policies: [policy],
    });
    expect(plan.changes[0]!.action).toBe("conflict");
    expect(plan.changes[0]!.reason).toContain("somebody else's row");
  });

  it("still refuses a hand-edited kind, and names it rather than rendering two identical argvs", () => {
    const policy = policiesFor({ platforms: ["airtable"] })[0]!;
    const edited = { ...resyncDefinitionFor({ policy }), kind: "investigate" };
    const plan = planResyncRegistration({
      existing: [edited],
      owned: [edited.recipeId],
      policies: [policy],
    });
    expect(plan.changes[0]!.action).toBe("conflict");
    expect(plan.changes[0]!.reason).toContain("carries kind `investigate`");
  });

  it("names the argv when that is what drifted", () => {
    const policy = policiesFor({ platforms: ["airtable"] })[0]!;
    const edited = {
      ...resyncDefinitionFor({ policy }),
      params: { argv: ["recipe", "resync", "--atlas", "clerk"] },
    };
    const plan = planResyncRegistration({
      existing: [edited],
      owned: [edited.recipeId],
      policies: [policy],
    });
    expect(plan.changes[0]!.action).toBe("conflict");
    expect(plan.changes[0]!.reason).toContain("runs `recipe resync --atlas clerk`");
  });

  it("names the params when an extra key is what drifted, since the argv reads identically", () => {
    const policy = policiesFor({ platforms: ["airtable"] })[0]!;
    const edited = {
      ...resyncDefinitionFor({ policy }),
      params: { argv: ["recipe", "resync", "--atlas", "airtable"], extra: 1 },
    };
    const plan = planResyncRegistration({
      existing: [edited],
      owned: [edited.recipeId],
      policies: [policy],
    });
    expect(plan.changes[0]!.action).toBe("conflict");
    expect(plan.changes[0]!.reason).toContain("carries params");
    expect(plan.changes[0]!.reason).toContain('"extra":1');
  });
});

describe("a compile-only atlas's row runs in the tick", () => {
  it("writes the tick kind on a create when the target is not seated", () => {
    const plan = planResyncRegistration({ existing: [], owned: [], policies: [tickPolicy()] });
    expect(plan.changes[0]!.action).toBe("create");
    expect(plan.changes[0]!.definition!.kind).toBe("verb-run");
    expect(plan.changes[0]!.definition!.params).toEqual({ argv: ["recipe", "resync", "--atlas", "airtable"] });
  });

  it("moves an owned seated row onto the tick when its target stops needing a seat", () => {
    const seatedRow = resyncDefinitionFor({ policy: policiesFor({ platforms: ["airtable"] })[0]! });
    const plan = planResyncRegistration({
      existing: [seatedRow],
      owned: [seatedRow.recipeId],
      policies: [tickPolicy()],
    });
    expect(plan.changes[0]!.action).toBe("update");
    expect(plan.changes[0]!.definition!.kind).toBe("verb-run");
  });

  it("leaves an owned tick row alone once it is on the tick", () => {
    const tickRow = resyncDefinitionFor({ policy: tickPolicy() });
    const plan = planResyncRegistration({ existing: [tickRow], owned: [tickRow.recipeId], policies: [tickPolicy()] });
    expect(plan.changes[0]!.action).toBe("unchanged");
  });

  it("still refuses a hand-edited kind on a tick target", () => {
    const edited = { ...resyncDefinitionFor({ policy: tickPolicy() }), kind: "investigate" };
    const plan = planResyncRegistration({ existing: [edited], owned: [edited.recipeId], policies: [tickPolicy()] });
    expect(plan.changes[0]!.action).toBe("conflict");
    expect(plan.changes[0]!.reason).toContain("carries kind `investigate` where this build derives `verb-run`");
  });

  it("is a row the dispatcher runs for its target", () => {
    const policy = tickPolicy();
    expect(rowRunsTarget({ definition: resyncDefinitionFor({ policy }), policy })).toBe(true);
  });
});

describe("an update carries every field only the operator writes", () => {
  // The latent defect a cadence change exposed: the update wrote the derived row whole, so a HELD row lost
  // its hold the first time its window moved — lifting the one rail a hold exists to keep.
  const hold = { askedIso: "2026-09-29T00:00:00.000Z", clearedBy: null, reason: "failed its last pass" };
  const channelApprovals = [{ atIso: "2026-09-21T00:00:00.000Z", channel: "C0DEMO", dmChannel: "D0DEMO", ts: "1.2" }];

  it("keeps a hold and its channel approvals through a cadence update", () => {
    const policies = policiesFor({ platforms: ["airtable"] });
    const held: RecipeDefinition = {
      ...resyncDefinitionFor({ policy: policies[0]! }),
      cadence: "0 0 * * *",
      channelApprovals,
      hold,
    };
    const plan = planResyncRegistration({ existing: [held], owned: [held.recipeId], policies });
    expect(plan.changes[0]!.action).toBe("update");
    expect(plan.changes[0]!.definition!.cadence).toBe("0 */4 * * *");
    expect(plan.changes[0]!.definition!.hold).toEqual(hold);
    expect(plan.changes[0]!.definition!.channelApprovals).toEqual(channelApprovals);
  });

  it("writes no hold key for a row that had none", () => {
    const policies = policiesFor({ platforms: ["airtable"] });
    const stale: RecipeDefinition = { ...resyncDefinitionFor({ policy: policies[0]! }), cadence: "0 0 * * *" };
    const plan = planResyncRegistration({ existing: [stale], owned: [stale.recipeId], policies });
    expect(Object.keys(plan.changes[0]!.definition!)).not.toContain("hold");
    expect(Object.keys(plan.changes[0]!.definition!)).not.toContain("channelApprovals");
  });
});

describe("resyncArgv", () => {
  it("names the wrapper verb and the target, never the underlying command", () => {
    const policy = policiesFor({ platforms: ["clerk"] })[0]!;
    expect(resyncArgv({ policy })).toEqual(["recipe", "resync", "--atlas", "clerk"]);
  });

  it("names a corpus source by --source", () => {
    const roster = buildResyncPolicies({
      atlases: [],
      corpus: [{ source: "notion", subject: { kind: "none" }, windowMs: 4 * HOUR }],
    });
    expect(resyncArgv({ policy: roster.policies[0]! })).toEqual(["recipe", "resync", "--source", "notion"]);
  });
});

describe("planResyncRegistration", () => {
  it("creates every row on an install with an empty definition store", () => {
    const plan = planResyncRegistration({
      existing: [],
      owned: [],
      policies: policiesFor({ platforms: ["airtable", "clerk"] }),
    });
    expect(plan.changes.map((change) => change.action)).toEqual(["create", "create"]);
  });

  it("reports a second pass over its own output as entirely unchanged", () => {
    const policies = policiesFor({ platforms: ["airtable", "clerk"] });
    const existing = policies.map((policy) => resyncDefinitionFor({ policy }));
    const plan = planResyncRegistration({
      existing,
      owned: existing.map((definition) => definition.recipeId),
      policies,
    });
    expect(registrationCounts({ plan })).toEqual({
      conflict: 0,
      create: 0,
      retire: 0,
      unchanged: 2,
      update: 0,
    });
  });

  it("updates a row whose cadence has drifted from what the window now derives", () => {
    const policies = policiesFor({ platforms: ["airtable"] });
    const stale: RecipeDefinition = { ...resyncDefinitionFor({ policy: policies[0]! }), cadence: "0 0 * * *" };
    const plan = planResyncRegistration({ existing: [stale], owned: [stale.recipeId], policies });
    expect(plan.changes[0]!.action).toBe("update");
    expect(plan.changes[0]!.definition!.cadence).toBe("0 */4 * * *");
  });

  it("keeps a paused row paused when it updates it, because pausing is the operator's", () => {
    const policies = policiesFor({ platforms: ["airtable"] });
    const paused: RecipeDefinition = {
      ...resyncDefinitionFor({ policy: policies[0]! }),
      cadence: "0 0 * * *",
      enabled: false,
    };
    const plan = planResyncRegistration({ existing: [paused], owned: [paused.recipeId], policies });
    expect(plan.changes[0]!.definition!.enabled).toBe(false);
  });

  it("refuses to rewrite the cadence of a managed-id row no pass recorded writing", () => {
    const policies = policiesFor({ platforms: ["airtable"] });
    const theirs: RecipeDefinition = { ...resyncDefinitionFor({ policy: policies[0]! }), cadence: "0 0 * * *" };
    // Counterexample: the ownership check was on the retire path and not this one, so a
    // hand-written row with the derived argv had its cadence overwritten AND was then recorded as owned.
    const plan = planResyncRegistration({ existing: [theirs], owned: [], policies });
    expect(plan.changes[0]!.action).toBe("conflict");
    expect(plan.changes[0]!.definition).toBe(null);
    expect(plan.changes[0]!.reason).toContain("none of it is this registrar's to rewrite");
  });

  it("ADOPTS a row that already matches exactly, so a lost ownership file is not 43 conflicts", () => {
    const policies = policiesFor({ platforms: ["airtable", "clerk"] });
    const existing = policies.map((policy) => resyncDefinitionFor({ policy }));
    const plan = planResyncRegistration({ existing, owned: [], policies });
    expect(plan.changes.map((change) => change.action)).toEqual(["unchanged", "unchanged"]);
  });

  it("refuses to adopt an unowned row differing ONLY in enabled, which the executable comparison misses", () => {
    const policies = policiesFor({ platforms: ["airtable"] });
    // Counterexample: adoption compared cadence and onMissed, so somebody's PAUSED row
    // was read as identical and silently recorded as this registrar's.
    const theirs: RecipeDefinition = { ...resyncDefinitionFor({ policy: policies[0]! }), enabled: false };
    const plan = planResyncRegistration({ existing: [theirs], owned: [], policies });
    expect(plan.changes[0]!.action).toBe("conflict");
  });

  it("refuses to adopt an unowned row carrying an extra params field", () => {
    const policies = policiesFor({ platforms: ["airtable"] });
    const base = resyncDefinitionFor({ policy: policies[0]! });
    const theirs: RecipeDefinition = { ...base, params: { ...base.params, note: "mine" } };
    const plan = planResyncRegistration({ existing: [theirs], owned: [], policies });
    expect(plan.changes[0]!.action).toBe("conflict");
  });

  it("still reports an OWNED row as unchanged on the fields that decide a run", () => {
    const policies = policiesFor({ platforms: ["airtable"] });
    const paused: RecipeDefinition = { ...resyncDefinitionFor({ policy: policies[0]! }), enabled: false };
    const plan = planResyncRegistration({ existing: [paused], owned: [paused.recipeId], policies });
    expect(plan.changes[0]!.action).toBe("unchanged");
  });

  it("refuses to overwrite a managed row whose argv was hand-edited", () => {
    const policies = policiesFor({ platforms: ["airtable"] });
    const edited: RecipeDefinition = {
      ...resyncDefinitionFor({ policy: policies[0]! }),
      params: { argv: ["atlas", "airtable", "sync"] },
    };
    const plan = planResyncRegistration({ existing: [edited], owned: [edited.recipeId], policies });
    expect(plan.changes[0]!.action).toBe("conflict");
    expect(plan.changes[0]!.definition).toBe(null);
  });

  it("plans an ALIASED id as a conflict, never an update", () => {
    // Counterexample: an exact copy in `zz-copy.json` carried the airtable id, the plan
    // indexed rows by embedded id and read the copy, and the writer then updated over the hand-edited
    // canonical file. An id the plan cannot tie to one file named for it is not the plan's to write.
    const policies = policiesFor({ platforms: ["airtable"] });
    const stale: RecipeDefinition = { ...resyncDefinitionFor({ policy: policies[0]! }), cadence: "0 0 * * *" };
    const plan = planResyncRegistration({
      aliased: ["resync-atlas-airtable"],
      existing: [stale],
      owned: [stale.recipeId],
      policies,
    });
    expect(plan.changes[0]!.action).toBe("conflict");
    expect(plan.changes[0]!.definition).toBe(null);
    expect(plan.changes[0]!.reason).toContain("read from a file not named for it");
  });

  it("plans an ALIASED obsolete id as ONE conflict, never a retire", () => {
    // Counterexample: the alias check sat only in the wanted-target loop. An owned row
    // for a target this build no longer has, copied into `zz-copy.json`, planned TWO retires — the writer
    // deleted the canonical file and dropped ownership, and the copy it never looked at kept running.
    const obsolete = resyncDefinitionFor({ policy: policiesFor({ platforms: ["airtable"] })[0]! });
    const plan = planResyncRegistration({
      aliased: [obsolete.recipeId],
      existing: [obsolete, obsolete],
      owned: [obsolete.recipeId],
      policies: [],
    });
    expect(plan.changes.map((change) => [change.action, change.recipeId])).toEqual([
      ["conflict", "resync-atlas-airtable"],
    ]);
  });

  it("never overwrites a file the parser REFUSED, which is not the same as an absent one", () => {
    // Counterexample: `loadRecipeDefinitions` returns rejected files separately and the
    // plan only ever saw the readable half, so a row with an unknown kind read as nothing being there —
    // and create then overwrote the operator's file and claimed ownership of it.
    const policies = policiesFor({ platforms: ["airtable"] });
    const plan = planResyncRegistration({
      existing: [],
      owned: [],
      policies,
      unreadable: ["resync-atlas-airtable.json"],
    });
    expect(plan.changes[0]!.action).toBe("conflict");
    expect(plan.changes[0]!.definition).toBe(null);
    expect(plan.changes[0]!.reason).toContain("the definition parser refused");
  });

  it("still creates a row when a DIFFERENT file is the unreadable one", () => {
    const policies = policiesFor({ platforms: ["airtable"] });
    const plan = planResyncRegistration({
      existing: [],
      owned: [],
      policies,
      unreadable: ["resync-atlas-somebody-else.json"],
    });
    expect(plan.changes[0]!.action).toBe("create");
  });

  it("leaves a row it does not own alone entirely, managed prefix or not", () => {
    const foreign: RecipeDefinition = {
      cadence: "0 9 * * *",
      destination: { kind: "slack" },
      effect: "read",
      enabled: true,
      kind: "alert-summary",
      onMissed: "skip",
      params: {},
      recipeId: "knock-alerts",
      schemaVersion: 1,
    };
    const plan = planResyncRegistration({ existing: [foreign], owned: [], policies: [] });
    expect(plan.changes).toEqual([]);
  });

  it("retires a managed row this build no longer derives, but only one it recorded writing", () => {
    const gone: RecipeDefinition = {
      cadence: "0 */4 * * *",
      destination: { kind: "local-atlas" },
      effect: "read",
      enabled: true,
      kind: "verb-run",
      onMissed: "backfill",
      params: { argv: ["recipe", "resync", "--atlas", "retired"] },
      recipeId: "resync-atlas-retired",
      schemaVersion: 1,
    };
    const owned = planResyncRegistration({ existing: [gone], owned: [gone.recipeId], policies: [] });
    expect(owned.changes[0]!.action).toBe("retire");

    const unowned = planResyncRegistration({ existing: [gone], owned: [], policies: [] });
    expect(unowned.changes[0]!.action).toBe("conflict");
    expect(unowned.changes[0]!.reason).toContain("somebody else's row wearing the prefix");
  });

  it("orders its changes by recipe id so two passes never report them differently", () => {
    const plan = planResyncRegistration({
      existing: [],
      owned: [],
      policies: policiesFor({ platforms: ["xero", "airtable", "clerk"] }),
    });
    expect(plan.changes.map((change) => change.recipeId)).toEqual([
      "resync-atlas-airtable",
      "resync-atlas-clerk",
      "resync-atlas-xero",
    ]);
  });
});

describe("registrationCounts", () => {
  it("counts every action, zeroes included", () => {
    expect(registrationCounts({ plan: { changes: [] } })).toEqual({
      conflict: 0,
      create: 0,
      retire: 0,
      unchanged: 0,
      update: 0,
    });
  });
});

describe("rowRunsTarget", () => {
  it("accepts a row whose argv is the one this build derives for that target", () => {
    const policy = policiesFor({ platforms: ["airtable"] })[0]!;
    expect(rowRunsTarget({ definition: resyncDefinitionFor({ policy }), policy })).toBe(true);
  });

  it("refuses a row named for one target whose argv runs ANOTHER", () => {
    const policies = policiesFor({ platforms: ["airtable", "clerk"] });
    // Counterexample: `resync-atlas-airtable.json` running `--atlas clerk` made the
    // freshness page report Airtable as current on the strength of the filename alone.
    const imposter: RecipeDefinition = {
      ...resyncDefinitionFor({ policy: policies[0]! }),
      params: { argv: ["recipe", "resync", "--atlas", "clerk"] },
    };
    expect(rowRunsTarget({ definition: imposter, policy: policies[0]! })).toBe(false);
  });

  it("refuses a row whose KIND this tick would never dispatch, however right its argv", () => {
    const policy = policiesFor({ platforms: ["airtable"] })[0]!;
    // Counterexample: `investigate` parses, so the row exists and looks scheduled, but
    // `automation run-due` reports it "not mine" and never runs it — a target unwatched behind a current page.
    const briefing: RecipeDefinition = { ...resyncDefinitionFor({ policy }), kind: "investigate" };
    expect(rowRunsTarget({ definition: briefing, policy })).toBe(false);
  });

  it("refuses a row the DISPATCHER would refuse, here an extra params key its strict schema rejects", () => {
    const policy = policiesFor({ platforms: ["airtable"] })[0]!;
    // Counterexample: `verbRunParamsSchema` is `.strict()`, so `planVerbRun` refuses and
    // `run-due` never dispatches — while the page read the target as current. Three passes each found a
    // different field deciding dispatch, which is why this now asks the planner rather than mirroring it.
    const base = resyncDefinitionFor({ policy });
    const extra: RecipeDefinition = { ...base, params: { ...base.params, note: "mine" } };
    expect(rowRunsTarget({ definition: extra, policy })).toBe(false);
  });

  it("refuses a row whose argv is missing or malformed", () => {
    const policy = policiesFor({ platforms: ["airtable"] })[0]!;
    const broken: RecipeDefinition = { ...resyncDefinitionFor({ policy }), params: {} };
    expect(rowRunsTarget({ definition: broken, policy })).toBe(false);
  });
});

describe("aliasedRecipeIds", () => {
  const rows = policiesFor({ platforms: ["airtable", "braze"] }).map((policy) => resyncDefinitionFor({ policy }));

  it("answers nothing when every row sits in the one file named for it", () => {
    expect(
      aliasedRecipeIds({
        definitionFiles: ["resync-atlas-airtable.json", "resync-atlas-braze.json"],
        definitions: rows,
      }),
    ).toEqual([]);
  });

  it("answers an id read from a misnamed file", () => {
    expect(
      aliasedRecipeIds({ definitionFiles: ["zz-copy.json", "resync-atlas-braze.json"], definitions: rows }),
    ).toEqual(["resync-atlas-airtable"]);
  });

  it("answers an id that turns up in two files, once", () => {
    expect(
      aliasedRecipeIds({
        definitionFiles: ["resync-atlas-airtable.json", "zz-copy.json"],
        definitions: [rows[0]!, rows[0]!],
      }),
    ).toEqual(["resync-atlas-airtable"]);
  });

  it("answers every id when the file list does not line up, rather than trusting a pairing it cannot read", () => {
    expect(aliasedRecipeIds({ definitionFiles: ["resync-atlas-airtable.json"], definitions: rows })).toEqual([
      "resync-atlas-airtable",
      "resync-atlas-braze",
    ]);
  });
});
