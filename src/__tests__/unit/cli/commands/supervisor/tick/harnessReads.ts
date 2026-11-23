/**
 * The seams of a fake `supervisor tick` run that only read: the cadence, the hatches, the fleet, the steers and the
 * voice. Each answers from the options `fake()` resolved, so a case sets one and every other reads clear.
 */
import { join } from "node:path";

import type { SupervisorTickDeps } from "../../../../../../cli/commands/supervisor/tickDeps.js";
import { ok } from "../../../../../../lib/result.js";
import { FILL_LANES } from "../../../../plans/laneFixtures.js";
import type { FakeValues } from "./harnessTypes.js";
import { root } from "./workdir.js";

/** The seams that only read: the cadence, the hatches, the fleet, the steers and the voice. */
type ReadDeps = Pick<
  SupervisorTickDeps,
  | "cadenceReads"
  | "contractPath"
  | "defaultHome"
  | "fleetHatchOpen"
  | "hatches"
  | "readFleetHealth"
  | "readLanes"
  | "readSteerRisk"
  | "repairCheckout"
  | "steerRiskHatchOpen"
  | "stoppedRecipesHatchOpen"
  | "noWorkClaimHatchOpen"
  | "readApprovedDrafts"
  | "readUnpickedSteers"
  | "readVoiceUnread"
>;

/**
 * The seams that only read.
 *
 * @returns the read deps
 */
export function readDepsFor({ values }: { values: FakeValues }): ReadDeps {
  const { cadenceReads, fleet, fleetHatch, recipeHatch, steer, steerHatch, steers, stoppedHatch } = values;
  return {
    cadenceReads,
    contractPath: () => "/checkout/skills/supervisor/reference/sweep-contract.md",
    defaultHome: () => join(root, "home"),
    fleetHatchOpen: () => fleetHatch,
    hatches: () => ({
      approvedDrafts: true,
      idle: true,
      load: true,
      recipeFailures: recipeHatch,
      steers: false,
      sweep: true,
      voice: false,
    }),
    readFleetHealth: () => Promise.resolve(fleet),
    readLanes: () => Promise.resolve(FILL_LANES),
    readSteerRisk: () => Promise.resolve(steer),
    repairCheckout: () => ok("/checkout"),
    steerRiskHatchOpen: () => steerHatch,
    stoppedRecipesHatchOpen: () => stoppedHatch,
    noWorkClaimHatchOpen: () => false,
    readApprovedDrafts: () => ({
      items: [],
      answers: new Map(),
      kind: "read",
      landings: { bound: [], unreadable: [] },
      skippedLines: 0,
      unreadApproved: [],
      unsureIds: [],
    }),
    readUnpickedSteers: () => Promise.resolve({ kind: "read", steers, undecodedRelays: 0 }),
    readVoiceUnread: () => ({
      kind: "read",
      neverMarked: values.voiceNeverMarked,
      unparseable: [],
      words: values.voiceWords,
    }),
  };
}
