/**
 * What the stopped-recipe cases feed `supervisor tick open` and read back from it: one stopped recipe as the monitor
 * prints it, a board the stopped-set gate can read, and the acts a seat is made of. `templateActions` reads the seat
 * directory, so call it only inside a case.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { evaluateRecipeStopped } from "../../../../../../monitor/evaluateStopped.js";
import { stoppedSetOf } from "../../../../../../supervisor/stoppedRecipeSeat.js";
import { RECONCILE } from "../tickFixtures.js";
import { dir } from "./harness.js";
import type { Fake } from "./harnessTypes.js";
import { arrayField, jsonObject, objectItems } from "./parsedJson.js";

/** One stopped recipe, printed as `monitor check --only recipe-stopped --json` prints it. */
export const STOPPED = JSON.stringify({
  actions: [],
  readings: [
    evaluateRecipeStopped({
      rows: [
        {
          cadence: "30 9 * * *",
          currentSlotHold: null,
          detail: "2 slot(s) went by unrun",
          lastRunAtIso: "2026-09-16T03:46:41.000Z",
          missedSlots: 2,
          reason: "MISSED",
          recipeId: "vulnfix-digest-acme-admin",
        },
      ],
      taken: new Map(),
    }),
  ],
});

/**
 * The stopped set's episode key, thrown on when the fixture stops reading open.
 *
 * @returns the episode key
 */
export function stoppedEpisode(): string {
  const set = stoppedSetOf({ document: JSON.parse(STOPPED) });
  if (set.kind !== "open") {
    throw new Error(`the stopped fixture reads ${set.kind}, not open`);
  }
  return set.repair.episodeKey;
}

/**
 * A board the stopped-set gate can read, with any list replaced.
 *
 * @param lists the reconciliation lists to replace — empty, with cmux observed, unless a case places a row
 * @returns the reconciliation's text
 */
export function stoppedBoard(lists: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    ...jsonObject({ text: RECONCILE }),
    duplicateRecipeFailures: [],
    fleet: "observed",
    held: [],
    misaligned: [],
    ready: [],
    repolessRows: [],
    unprioritised: [],
    ...lists,
  });
}

/**
 * The register and spawn children one run launched, the acts a seat is made of — never a capture's own reads.
 *
 * @returns the argv of each act
 */
export function seatActs({ run }: { run: Fake }): readonly (readonly string[])[] {
  return run.children.filter((argv) => ["handover register", "cmux spawn"].includes(argv.slice(0, 2).join(" ")));
}

/**
 * The actions the open wrote into a tick's template.
 *
 * @returns the actions
 */
export function templateActions({ tick }: { tick: number }): readonly Record<string, unknown>[] {
  const template = jsonObject({ text: readFileSync(join(dir, `tick-${String(tick)}`, "tick.json"), "utf8") });
  return objectItems({ items: arrayField({ key: "actions", record: template }) });
}
