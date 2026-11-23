/**
 * The `automation` noun's manifest in `cli/manifests/automation.ts`: pins the verb set, the six classification fields
 * of each verb (so a classification swapped between two verbs fails under both keys), and that every row quotes the
 * very usage constant its command prints from the leaves the manifest imports. That the manifest imports nothing
 * heavier is `../manifestBarrelClosure.test.ts`'s job; loader resolution is `devLint/manifestLoaderTests.ts`'s.
 */
import { describe, expect, it } from "vitest";

import {
  RECIPE_BLOCKER_USAGE,
  RECIPE_CLAIM_USAGE,
  RECIPE_DUE_USAGE,
  RECIPE_PROPAGATE_USAGE,
  RECIPE_REGISTER_RESYNCS_USAGE,
  RECIPE_REGISTER_STANDING_USAGE,
  RECIPE_REPAIR_USAGE,
  RECIPE_RESYNC_USAGE,
  RECIPE_RUN_DUE_USAGE,
  RECIPE_SEAT_USAGE,
} from "../../../../cli/commands/automation/core.js";
import { RECIPE_EXPLAIN_USAGE } from "../../../../cli/commands/automation/explainUsage.js";
import { RECIPE_FRESHNESS_USAGE } from "../../../../cli/commands/automation/freshnessUsage.js";
import { RECIPE_REPOINT_USAGE } from "../../../../cli/commands/automation/repointUsage.js";
import { RECIPE_STATUS_USAGE } from "../../../../cli/commands/automation/statusUsage.js";
import { RECIPE_DISABLE_USAGE, RECIPE_ENABLE_USAGE } from "../../../../cli/commands/automation/switchUsage.js";
import { automationManifest } from "../../../../cli/manifests/automation.js";
import { classificationsOf } from "./_classification.js";

describe("automationManifest", () => {
  it("declares exactly these verbs", () => {
    expect(Object.keys(automationManifest).toSorted()).toEqual([
      "blocker",
      "claim",
      "disable",
      "due",
      "enable",
      "explain",
      "freshness",
      "propagate",
      "register-resyncs",
      "register-standing",
      "repair",
      "repoint",
      "resync",
      "retire",
      "run-due",
      "seat",
      "status",
    ]);
  });

  it("classifies each verb by its own effect, door, work-item, diagnostic and parse fields", () => {
    expect(classificationsOf({ manifest: automationManifest })).toEqual({
      blocker: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      claim: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      disable: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      due: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      enable: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      explain: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      freshness: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      propagate: {
        createsWorkItem: true,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "register-resyncs": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "register-standing": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      repair: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      repoint: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      resync: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      retire: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "run-due": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      seat: {
        createsWorkItem: true,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      status: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
    });
  });

  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(automationManifest["blocker"]!.meta.usage).toBe(RECIPE_BLOCKER_USAGE);
    expect(automationManifest["claim"]!.meta.usage).toBe(RECIPE_CLAIM_USAGE);
    expect(automationManifest["disable"]!.meta.usage).toBe(RECIPE_DISABLE_USAGE);
    expect(automationManifest["due"]!.meta.usage).toBe(RECIPE_DUE_USAGE);
    expect(automationManifest["enable"]!.meta.usage).toBe(RECIPE_ENABLE_USAGE);
    expect(automationManifest["explain"]!.meta.usage).toBe(RECIPE_EXPLAIN_USAGE);
    expect(automationManifest["freshness"]!.meta.usage).toBe(RECIPE_FRESHNESS_USAGE);
    expect(automationManifest["propagate"]!.meta.usage).toBe(RECIPE_PROPAGATE_USAGE);
    expect(automationManifest["register-resyncs"]!.meta.usage).toBe(RECIPE_REGISTER_RESYNCS_USAGE);
    expect(automationManifest["register-standing"]!.meta.usage).toBe(RECIPE_REGISTER_STANDING_USAGE);
    expect(automationManifest["repair"]!.meta.usage).toBe(RECIPE_REPAIR_USAGE);
    expect(automationManifest["repoint"]!.meta.usage).toBe(RECIPE_REPOINT_USAGE);
    expect(automationManifest["resync"]!.meta.usage).toBe(RECIPE_RESYNC_USAGE);
    expect(automationManifest["run-due"]!.meta.usage).toBe(RECIPE_RUN_DUE_USAGE);
    expect(automationManifest["seat"]!.meta.usage).toBe(RECIPE_SEAT_USAGE);
    expect(automationManifest["status"]!.meta.usage).toBe(RECIPE_STATUS_USAGE);
  });
});
