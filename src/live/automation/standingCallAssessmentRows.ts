/**
 * The call-assessment row: once a day, a visible session classifies every passage the owner spoke on the calls not
 * yet assessed, and records what they teach. Declared here and required through `./standingRows.ts`'s
 * `GENERIC_STANDING_ROWS`, like every other generic standing row.
 */
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "./definition.js";
import { CALL_ASSESSMENT_KIND } from "./kinds.js";
import type { StandingRow } from "./standingRow.js";

/**
 * The daily reader of the owner's calls, SEATED so the classifying is judgement a session the owner can watch makes.
 *
 * The owner ruled ONE daily visible reader on the plans already owned, with no new spend, so nothing calls a model
 * in a process (`AGENTS.md` rule 2). The row's own argv is the settle check, run LAST by the seat's claimed
 * `run-due`: `talk assessment-due --check` prints counts only — never a passage — and exits deferred while any call
 * is still due, so a firing the seat did not finish stays unstamped and the next pass seats the reader again. The
 * session follows `skills/automation/reference/call-assessment.md`.
 *
 * **`effect: "read"`**: the row's own run only reads the call files and the register; the verdicts and knowledge rows
 * are the seat's, and `read` is what refuses a hand-edited argv naming a writing verb (`./verbRun.ts`'s
 * `EFFECT_COVERS`). **`30 21 * * *`, `onMissed: "skip"`**: in the evening, after the day's calls, in the machine's
 * own time zone; a missed evening loses nothing, because the worklist is every call whose words have no verdict, not
 * a window, so the next firing takes the missed day's calls too.
 */
export const CALL_ASSESSMENT_DAILY: StandingRow = {
  definition: {
    cadence: "30 21 * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    enabled: true,
    kind: CALL_ASSESSMENT_KIND,
    onMissed: "skip",
    params: { argv: ["talk", "assessment-due", "--check"] },
    recipeId: "call-assessment-daily",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  why:
    "nothing else classifies what the owner says on calls, so without this row every call stays unknown, read as " +
    "restricted, and nothing the owner said can ever be shown beyond them",
};
