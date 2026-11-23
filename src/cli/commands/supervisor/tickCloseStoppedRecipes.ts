/**
 * The close-only unseated-stopped-recipes gate: `supervisor tick close` refuses a tick whose stopped recipe set has
 * neither a seat nor a hold, as it refuses idle capacity. The predicate is `../../../supervisor/stoppedRecipeSeat.ts`
 * `judgeStoppedRecipes`; the seat `tick open` already tried is `./tickOpenStoppedRecipes.ts`, so this refuses only
 * when that seat failed, was left to the chair, or was undone by the chair's own edit of the template.
 *
 * It reads the set the OPEN captured rather than taking a fresh one, so the gate judges exactly what the tick saw.
 */
import { join } from "node:path";

import { hatchFor } from "../../../hatch/lookup.js";
import { hatchOpen } from "../../../hatch/open.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { judgeStoppedRecipes, type StoppedRecipeVerdict } from "../../../supervisor/stoppedRecipeSeat.js";
import type { CloseRead } from "./tickCloseRead.js";
import { readJson } from "./tickFiles.js";
import type { SupervisorTickDraft } from "./tickRecordCore.js";

/** The capture's reading name for `monitor check --only recipe-stopped`. */
const STOPPED_READING = "recipe-stopped";

/**
 * Whether the `unseated-stopped-recipes` hatch is open for this invocation.
 *
 * @returns true when the ambient variable is set
 */
export function stoppedRecipesHatchOpen(): boolean {
  return hatchOpen({ env: process.env, id: "unseated-stopped-recipes", nowIso: new Date().toISOString() });
}

/**
 * The recipe-stopped document the open captured, or why there is none — a reading that did not complete is a set the
 * gate cannot judge, never an empty one.
 *
 * @returns the parsed document, or undefined when it is missing or would not parse
 */
function capturedStopped({ read }: { read: CloseRead }): unknown {
  const reading = read.capture.readings.find((entry) => entry.name === STOPPED_READING);
  if (reading === undefined || !reading.completed || reading.bytes === 0) {
    return undefined;
  }
  const document = readJson({ path: join(read.tickDir, reading.file) });
  return document.isOk() ? document.value : undefined;
}

/**
 * Render the refusal for a stopped set the tick left with neither a seat nor a hold.
 *
 * @param verdict the refused or unreadable verdict
 * @returns the hatch's four lines, the commands that seat it, and the hold shapes that answer instead
 */
export function stoppedRecipesRefusalLines({
  verdict,
}: {
  verdict: Exclude<StoppedRecipeVerdict, { kind: "clean" }>;
}): readonly string[] {
  const hatch = hatchFor({ id: "unseated-stopped-recipes" });
  if (verdict.kind === "unreadable") {
    return [
      ...hatchRefusalLines({ detail: `the stopped recipe set could not be judged — ${verdict.why}`, hatch }),
      "Re-open the tick with this checkout so its recipe-stopped and reconcile readings complete. Neither a spawn nor " +
        "a hold answers THIS arm — the gate refuses before it reads either.",
    ];
  }
  const ids = verdict.repair.recipeIds.map((id) => JSON.stringify(id)).join(", ");
  const spawns = verdict.rows.map((row) => `    slopweaver cmux spawn ${row} --model opus`);
  const rowsLine =
    spawns.length > 0
      ? "  spawn its repair row:"
      : "  no repair row is on the board — re-open the tick to register one, or hold the set:";
  return [
    ...hatchRefusalLines({
      detail: `this tick read the stopped set ${ids} with no seat on its repair, no spawn onto it and no hold`,
      hatch,
    }),
    rowsLine,
    ...spawns,
    'Record the spawn as a `spawned` action whose subject is {"kind":"handover","id":"<row>"}, or a hold-rationale ' +
      'judgement on that row, or a hold-rationale on {"kind":"recipe","id":"<recipe id>"} for EVERY recipe in the set ' +
      "saying why it stays stopped. The floating note stays up either way: only a seat's take settles it.",
  ];
}

/**
 * Run the unseated-stopped-recipes gate, returning the block to print when it refuses.
 *
 * @param read the close's read, whose capture holds the open's recipe-stopped reading
 * @param draft the parsed draft, whose actions and judgements can answer the set
 * @param hatchIsOpen whether the hatch is open, asked only when the gate would refuse
 * @returns the refusal block, or nothing when the tick may be recorded
 */
export function stoppedRecipesRefusal({
  read,
  draft,
  hatchIsOpen,
}: {
  read: CloseRead;
  draft: SupervisorTickDraft;
  hatchIsOpen: () => boolean;
}): readonly (readonly string[])[] {
  const verdict = judgeStoppedRecipes({
    actions: draft.actions,
    document: capturedStopped({ read }),
    judgements: draft.judgements,
    reconciliation: read.reconcile,
  });
  if (verdict.kind === "clean" || hatchIsOpen()) {
    return [];
  }
  return [stoppedRecipesRefusalLines({ verdict })];
}
