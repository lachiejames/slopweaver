/**
 * The linear-briefing row: one end-of-day briefing of every write the owner should make into Linear. Declared here and
 * required through `./standingRows.ts`'s `GENERIC_STANDING_ROWS`, like every other generic standing row.
 */
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "./definition.js";
import { LINEAR_BRIEFING_KIND } from "./kinds.js";
import type { StandingRow } from "./standingRow.js";

/**
 * The daily pass that briefs every Linear write — comments, state changes, project updates, superseded tickets,
 * stale ones back to the backlog — as one page and one Queue card the owner's yes applies.
 *
 * This ONE read-only automation replaces the weekly project-update drafts and the daily
 * cycle reconcile. **A seated kind**, for the reason `THREAD_CHASE_DAILY` is: the row's run is the `cycle reconcile
 * --verify` WORKLIST, read in seconds, while what each ticket's evidence means is judgement a visible session makes
 * (`AGENTS.md` rule 2). The session follows `skills/automation/reference/linear-briefing.md`, registers ONE Queue
 * card and runs this row's claimed `run-due` LAST. Nothing is written to Linear: each proposed write runs only on the owner's
 * yes.
 *
 * **`effect: "read"`**: `cycle reconcile` declares `local-state` because `--write` publishes only a local document
 * (`live/hygiene/cycle-reconcile.json`, which the nothing-stale page still reads), the card is the seat's, and
 * `read` is what refuses a hand-edited argv naming a Linear write (`./verbRun.ts`'s `EFFECT_COVERS`). **`--verify`**,
 * because a stale corpus would propose a write the owner already made. **`30 17 * * *`, `onMissed: "skip"`**: end of day
 * in the owner's time, weekends included. Cumulative rather than windowed — the evidence floor is the last briefing whose every
 * write landed — so a missed evening is the same evidence a day older and never a lost item.
 */
export const LINEAR_BRIEFING_DAILY: StandingRow = {
  definition: {
    cadence: "30 17 * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    enabled: true,
    kind: LINEAR_BRIEFING_KIND,
    onMissed: "skip",
    params: { argv: ["cycle", "reconcile", "--verify", "--write"] },
    recipeId: "linear-briefing-daily",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  why:
    "nothing else proposes the writes that would make Linear match reality, so without this row a shipped ticket " +
    "stays open, a stale one stays in the owner's cycle and a project goes quiet until the owner notices by hand",
};
