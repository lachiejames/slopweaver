/**
 * The owed-reply row: one parked reply draft as the owner per followed Slack thread whose last word asks them
 * something.
 * Declared here and required through `./standingRows.ts`'s `GENERIC_STANDING_ROWS`, like every other generic
 * standing row.
 */
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "./definition.js";
import { OWED_REPLY_KIND } from "./kinds.js";
import type { StandingRow } from "./standingRow.js";
import { VERB_RUN_KIND } from "./verbRun.js";

/**
 * The daily standing read of followed Slack threads, SEATED so a question to the owner becomes a draft on their Queue.
 *
 * MEASURED: a colleague asked "what are you trying to achieve there?" under the owner's own post, and the thread
 * sat 38 hours while this row's `live/slack/owed.json` listed it and nothing turned it into a draft — the file only
 * fed a briefing, though the owner expected a draft on the Queue. **A seated kind**, for the reason
 * `THREAD_CHASE_DAILY` is: the row's run is the `slack owed` WORKLIST, read off the corpus in seconds, while what
 * each question needs answering with is judgement a visible session makes (`AGENTS.md` rule 2). The session follows
 * `skills/automation/reference/owed-reply.md`, parks each reply with `slack draft record` — never a send — and
 * runs this row's claimed `run-due` LAST, which rewrites `live/slack/owed.json` as it always did.
 *
 * **`--write` is still the point of the argv**: the document is what the seat and a later briefing read.
 * **`effect: "read"`**: the row's own run only reads the corpus copy, the drafts are the seat's, and `read` is what
 * refuses a hand-edited argv naming a sending verb (`./verbRun.ts`'s `EFFECT_COVERS`). **`55 8 * * *`, `onMissed:
 * "skip"`**: after the 08:00 Slack resync — ordering intent, never a freshness proof, which is why the seat re-reads
 * each thread live — and a missed morning is the same questions a day older.
 *
 * **It supersedes the `verb-run` row** an install already holds, so `automation register-standing` brings an untouched
 * one forward to the seated kind; a row somebody edited stays exactly as it is.
 */
export const SLACK_OWED_DAILY: StandingRow = {
  definition: {
    cadence: "55 8 * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    enabled: true,
    kind: OWED_REPLY_KIND,
    onMissed: "skip",
    params: { argv: ["slack", "owed", "--write"] },
    recipeId: "slack-owed-daily",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  supersedes: [
    {
      cadence: "55 8 * * *",
      destination: { kind: "local-atlas" },
      effect: "read",
      enabled: true,
      kind: VERB_RUN_KIND,
      onMissed: "skip",
      params: { argv: ["slack", "owed", "--write"] },
      recipeId: "slack-owed-daily",
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    },
  ],
  why:
    "nothing else turns a followed Slack thread whose last word asks the owner something into a draft on their " +
    "Queue, so without this row the question waits until they happen to look — measured at 38 hours",
};
