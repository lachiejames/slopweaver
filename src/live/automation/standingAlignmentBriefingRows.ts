/**
 * The alignment-briefing row: one weekday-morning page of what the owner's manager will look for by end of day,
 * carded on the owner's Queue. Declared here and required through `./standingRows.ts`'s `GENERIC_STANDING_ROWS`, like every other
 * generic standing row.
 */
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "./definition.js";
import { ALIGNMENT_BRIEFING_KIND } from "./kinds.js";
import type { StandingRow } from "./standingRow.js";

/**
 * The weekday pass that briefs the owner's morning: what the owner's manager will look for by end of day, every
 * item held on the owner's permission ranked by confidence the owner could act on it unasked, the Vanta controls
 * each of the owner's actions flips, and one goal line.
 *
 * The briefing comes early in the morning and anticipates what the owner's manager will expect by the end of
 * the day, giving the owner a goal for what to have done by the end of today. **A seated kind**, for the reason
 * `THREAD_CHASE_DAILY` is: the row's run is the `handover currency` WORKLIST (every ask waiting on the owner, each
 * re-checked), read in seconds, while what Linear, Slack, Vanta and last week's meetings mean for the owner's day
 * is judgement a visible session makes (`AGENTS.md` rule 2). The session follows
 * `skills/automation/reference/alignment-briefing.md`, publishes ONE dated page and ONE Queue card, and runs this
 * row's claimed `run-due` LAST. Nothing is sent: every write the page proposes waits on the owner's yes.
 *
 * **`effect: "read"`**: `handover currency` declares `external-read`, and `read` is what refuses a hand-edited argv
 * naming a sending verb (`./verbRun.ts`'s `EFFECT_COVERS`). **`0 8 * * 1-5`, `onMissed: "skip"`**: weekday mornings
 * in the owner's time, before the day starts. A missed morning is the same sources a few hours older, and the page is read live,
 * so a backfill would only publish yesterday's day twice.
 */
export const ALIGNMENT_BRIEFING_WEEKDAY: StandingRow = {
  definition: {
    cadence: "0 8 * * 1-5",
    destination: { kind: "local-atlas" },
    effect: "read",
    enabled: true,
    kind: ALIGNMENT_BRIEFING_KIND,
    onMissed: "skip",
    params: { argv: ["handover", "currency", "--json"] },
    recipeId: "alignment-briefing-weekday",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  why:
    "nothing else joins what the owner's manager will look for, the work held on the owner's permission, the " +
    "controls each action flips and last week's meetings into one goal for the day, so without this row the " +
    "owner's day starts on whatever they notice",
};
