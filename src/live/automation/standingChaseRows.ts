/**
 * The thread-chase row: one parked, tagged chase draft per Slack thread left quiet on the owner's ask. Declared here and
 * required through `./standingRows.ts`'s `GENERIC_STANDING_ROWS`, like every other generic standing row.
 */
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "./definition.js";
import { THREAD_CHASE_KIND } from "./kinds.js";
import type { StandingRow } from "./standingRow.js";

/**
 * The weekday chase pass over every Slack thread whose last human word is the owner's, still unanswered two business
 * days on.
 *
 * With no reply, a chase tags some specific people and asks specific questions to drive engagement, and the drafts
 * show across all workstreams via the queue; the wait is two business days (`CHASE_QUIET_MS`,
 * `src/sessionStart/slackAwaiting.ts`). **A
 * seated kind**, for the reason `BUMP_FIX_SLOPWEAVER` is: the row's run is the `slack awaiting` WORKLIST, read off
 * the corpus in seconds, while choosing whom to tag and what to ask is judgement a visible session makes
 * (`AGENTS.md` rule 2). The session follows `skills/automation/reference/thread-chase.md`, parks each chase
 * with `slack draft record` — a draft on the owner's queue, never a send — and runs this row's claimed `run-due` LAST.
 *
 * **Not held**: every chase waits on the owner's yes on its own card, so the row itself reaches nobody. **`effect:
 * "read"`**: the row's own run only reads, the drafts are the seat's, and `read` is what refuses a hand-edited argv
 * naming a sending verb such as `slack post` (`./verbRun.ts`'s `EFFECT_COVERS`). **`30 9 * * 1-5`,
 * `onMissed: "skip"`**: weekday mornings in the owner's time, after `slack-owed-daily` refreshes the corpus-side picture; a
 * missed morning is the same quiet threads a day older, and the next pass reads them as they then stand. So two
 * business days is a MINIMUM: a thread that crosses it just after a firing waits for the next one.
 */
export const THREAD_CHASE_DAILY: StandingRow = {
  definition: {
    cadence: "30 9 * * 1-5",
    destination: { kind: "local-atlas" },
    effect: "read",
    enabled: true,
    kind: THREAD_CHASE_KIND,
    onMissed: "skip",
    params: { argv: ["slack", "awaiting", "--write"] },
    recipeId: "thread-chase-daily",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  why:
    "nothing else notices a thread gone quiet on the owner's ask — the waiting side has no clock by design — so " +
    "without this row a workstream slips silently until the owner happens to look",
};
