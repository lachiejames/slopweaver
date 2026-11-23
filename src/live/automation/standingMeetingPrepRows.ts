/**
 * The meeting-prep row: the owner's calendar read every hour for meetings they will talk in, each one put on the
 * board for a visible session to brief before it starts. Declared here and required through `./standingRows.ts`'s
 * `GENERIC_STANDING_ROWS`, like every other generic standing row.
 */
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "./definition.js";
import type { StandingRow } from "./standingRow.js";
import { VERB_RUN_KIND } from "./verbRun.js";

/**
 * The hourly pass that registers a brief for every upcoming meeting the owner will talk in.
 *
 * A briefing for each such meeting happens automatically, without the owner having to ask for it. Before this row
 * nothing did: a recurring meeting started with no brief, because `page tag` and the `meeting-prep-due` monitor only
 * float a page a session already wrote, and every brief had been a row registered by hand. `calendar prep-due` is the missing half — it registers the row; the seated session writes the page and tags
 * it; the monitor floats it.
 *
 * **`verb-run`, `effect: "read"`**: the verb reads the calendar and writes only board rows on this machine, and the
 * brief itself is a visible session's (`AGENTS.md` rule 2). `read` is what refuses a hand-edited argv naming a
 * calendar write. **`5 * * * *`, `onMissed: "skip"`**: the verb looks four hours ahead, so a meeting is first seen
 * three to four hours before it starts; a missed slot is the same calendar an hour later, read as it then stands. An
 * exit 3, no meeting owed a brief, stamps the slot.
 */
export const MEETING_PREP_HOURLY: StandingRow = {
  definition: {
    cadence: "5 * * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    enabled: true,
    kind: VERB_RUN_KIND,
    onMissed: "skip",
    params: { argv: ["calendar", "prep-due"] },
    recipeId: "meeting-prep-hourly",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  why:
    "nothing else reads the owner's calendar for meetings they will talk in, so without this row they walk into " +
    "each one unbriefed unless they ask — measured on a recurring weekly meeting",
};
