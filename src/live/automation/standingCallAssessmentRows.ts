/**
 * The data-class assessment row: once a day, a visible session classifies every passage the owner spoke on the calls
 * not yet assessed, records what they teach, then classifies the day's slice of stored rows the data-class rules send
 * for assessment. Declared here and required through `./standingRows.ts`'s `GENERIC_STANDING_ROWS`, like every other
 * generic standing row.
 */
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "./definition.js";
import { CALL_ASSESSMENT_KIND } from "./kinds.js";
import type { StandingRow } from "./standingRow.js";

/**
 * The daily reader of the owner's calls and stored rows, SEATED so the classifying is judgement a session the owner
 * can watch makes.
 *
 * The owner ruled ONE daily visible reader on the plans already owned, with no new spend, so nothing calls a model
 * in a process (`AGENTS.md` rule 2). The row's own argv is the settle check, run LAST by the seat's claimed
 * `run-due`: `store assessment-due --check --with-calls` prints counts only — never a passage or a row's words — and
 * exits deferred while any call is still due or the day's slice of stored rows still has one due, so a firing the
 * seat did not finish stays unstamped and the next pass seats the reader again. A stored-row backlog past the day's
 * slice never defers (`src/store/storedRowAssessment.ts`). The session follows
 * `skills/automation/reference/call-assessment.md`.
 *
 * **`effect: "read"`**: the row's own run only reads the call files, the register and the store; the verdicts and
 * knowledge rows are the seat's, and `read` is what refuses a hand-edited argv naming a writing verb (`./verbRun.ts`'s
 * `EFFECT_COVERS`). **`30 21 * * *`, `onMissed: "skip"`**: in the evening, after the day's calls, in the machine's
 * own time zone; a missed evening loses nothing, because the worklist is every call and row whose words have no
 * verdict, not a window, so the next firing takes the missed day's too.
 *
 * **It supersedes the calls-only check** an install may already hold: create-if-absent alone would leave that file
 * settling on calls while the stored rows went unread.
 */
export const CALL_ASSESSMENT_DAILY: StandingRow = {
  definition: {
    cadence: "30 21 * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    enabled: true,
    kind: CALL_ASSESSMENT_KIND,
    onMissed: "skip",
    params: { argv: ["store", "assessment-due", "--check", "--with-calls"] },
    recipeId: "call-assessment-daily",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  supersedes: [
    {
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
  ],
  why:
    "nothing else classifies what the owner says on calls or writes in a dictation, a Codex message or a private " +
    "thread, so without this row every one stays unknown, read as restricted, and none of it can ever be shown " +
    "beyond them",
};
