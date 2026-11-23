/**
 * The measurement rows: the passes that re-read the fleet's own transcripts and record a reading, so a
 * change that moves every seat's cost at once is seen by something. Declared here and required through
 * `./standingRows.ts`'s `GENERIC_STANDING_ROWS`, like every other generic standing row.
 *
 * The two transcript passes run Monday morning, half an hour apart, over the same seven whole days; the
 * unused-usage report runs every morning after them and lands as a local page, carding the owner's Queue when it matters.
 */
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "./definition.js";
import { FLEET_CEILING_REPORT_KIND } from "./kinds.js";
import type { StandingRow } from "./standingRow.js";
import { VERB_RUN_KIND } from "./verbRun.js";

/**
 * The weekly context-cost check — whether the fleet's context got more expensive since last week.
 *
 * The check runs continuously, given how frequently the setup changes and how many potential inefficiencies can
 * arise. MEASURED over seven days of transcripts: 27.6B cache-read tokens across 148,541 calls, a ~60k boot floor on
 * every one of them, 604 compactions and 47.8% of post-boundary reads fetching back something a summary had
 * dropped. The setup changes weekly — a rule file, a skill description, a hook's output, the compaction
 * window — and each change moves those numbers on every seat at once, where no single seat can see it.
 *
 * **`--alert`, never `--check`.** `--check`'s exit 3 is read by the verb-run runner as "nothing to do", so a
 * regression would stamp as a quiet week; `--alert` fails the row instead, which is what `automation due`
 * surfaces. `../../cli/commands/session/compaction.ts` carries the mapping.
 *
 * **`--record-reading` makes the comparison week-over-week**: each run's document is the next run's
 * baseline, and the signal judges the re-read rate, the boot floor and the per-call cache read against it
 * (`../../sessions/compactionSignal.ts` carries each tolerance and the measurement behind it).
 *
 * **Monday 05:00, `onMissed: "skip"`.** A missed week is not absent data: the next run reads its own seven
 * days, and a backfill would only measure the same window twice.
 */
export const CONTEXT_COST_WEEKLY: StandingRow = {
  definition: {
    cadence: "0 5 * * 1",
    destination: { kind: "local-atlas" },
    effect: "read-write",
    enabled: true,
    kind: VERB_RUN_KIND,
    onMissed: "skip",
    params: {
      argv: ["session", "compaction", "--days", "7", "--alert", "--record-reading", "recipe:context-cost-weekly"],
    },
    recipeId: "context-cost-weekly",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  why:
    "nothing else re-measures what every call costs, so without this row a rule file, skill listing or hook " +
    "that grows the context of every seat goes unseen — measured at a ~60k boot floor on each of " +
    "148,541 calls a week, a third of the fleet's 27.6B cache-read tokens",
};

/**
 * The weekly token-optimisation pass.
 *
 * A pass that runs regularly, finds the fifty-percent wins across the fleet and posts a finding only when it has
 * a win to show, never a status. `session spend --finding` registers one
 * board finding row when units per landed change moved 20% against the last reading or a priced drain is new
 * since its last post, and nothing otherwise; it exits 0 on a quiet week so the row stamps.
 *
 * **`30 5 * * 1`, `onMissed: "skip"`.** Monday, half an hour after `context-cost-weekly` walks the same
 * corpus, so the two passes never contend for it; a missed week is caught by the next, which reads seven
 * whole days again.
 */
export const TOKEN_PASS_WEEKLY: StandingRow = {
  definition: {
    cadence: "30 5 * * 1",
    destination: { kind: "local-atlas" },
    effect: "read-write",
    enabled: true,
    kind: VERB_RUN_KIND,
    onMissed: "skip",
    params: {
      argv: ["session", "spend", "--days", "7", "--finding", "--record-reading", "recipe:token-pass-weekly"],
    },
    recipeId: "token-pass-weekly",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  why:
    "nothing else prices where the fleet's draw goes by seat kind, model and gate, nor what a landed change " +
    "costs — measured over one week, the Opus 5 → 5.5 move cut a landed change from about 32M to 12.8M units, " +
    "and without this row the next such move, or a regression, is seen by nobody",
};

/**
 * The weekly value sample — whether the work the fleet finished got used, a fact only the owner holds.
 *
 * `value sample` draws five asks that ended in the last seven days, at random seeded by the ISO week, each with
 * its model-weighted cost and its outcome, publishes them as a local page and places ONE Queue card asking the
 * owner one word per ask: used, not used, or not yet. Cost and throughput are measured by the two passes above;
 * nothing else asks whether what they bought was worth having. It exits 3 on a week where no ask ended, which the
 * verb-run runner stamps as quiet.
 *
 * **`0 7 * * 1`, `onMissed: "skip"`.** Monday, after both transcript passes have walked the corpus. A missed week
 * is not owed: the next run draws from its own seven days, and the week's kept sample makes a retried firing show
 * the same page and card rather than a second draw.
 */
export const VALUE_SAMPLE_WEEKLY: StandingRow = {
  definition: {
    cadence: "0 7 * * 1",
    destination: { kind: "local-page" },
    effect: "read-write",
    enabled: true,
    kind: VERB_RUN_KIND,
    onMissed: "skip",
    params: { argv: ["value", "sample"] },
    recipeId: "value-sample-weekly",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  why:
    "nothing else asks whether the work the fleet finished was used, so cost and throughput are measured while " +
    "the one number that says the spend was worth it goes unread",
};

/** The Monday Slack-post shape every earlier install was written with, byte for byte — brought forward. */
const FLEET_CEILING_MONDAY_SLACK: StandingRow["definition"] = {
  cadence: "0 6 * * 1",
  destination: { kind: "slack" },
  effect: "read-write",
  enabled: true,
  kind: FLEET_CEILING_REPORT_KIND,
  onMissed: "skip",
  params: { days: 7 },
  recipeId: "fleet-ceiling-weekly",
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
};

/**
 * The daily unused-usage report — how much of the Claude plans' last seven days the fleet left on the table,
 * published each morning as a local page, with a Queue card only when more could have run. A broken measurement
 * fails the firing, so a repair is seated on its failure finding — never asked of the owner.
 *
 * It answers how much of the plan usage is left on the table each week, so a large unused share is found early.
 * MEASURED with `slopweaver fleet ceiling --days 7`: at most 13% of the plans' week unused, with 4.2 seats
 * working on average. It runs DAILY and lands on the Queue or a page on this install, never a Slack post — the
 * Monday Slack row failed on its unresolved channel and sat held.
 *
 * **The recipe id stays `fleet-ceiling-weekly`.** A rename would leave the old file standing and enabled beside
 * the new one; keeping the id lets `register-standing` bring the stored Monday row forward
 * ({@link StandingRow.supersedes}), a failure hold included.
 *
 * **06:00 daily, `onMissed: "skip"`.** Each firing reads the seven whole days ending at its own slot, so a missed
 * morning is covered by the next one's read rather than owed.
 */
export const FLEET_CEILING_DAILY: StandingRow = {
  definition: {
    ...FLEET_CEILING_MONDAY_SLACK,
    cadence: "0 6 * * *",
    destination: { kind: "local-page" },
  },
  supersedes: [FLEET_CEILING_MONDAY_SLACK],
  why:
    "nothing else tells the owner how much of the plans' capacity went unused against the seats that ran, which " +
    "is the number to chase and the only check that the supervisor is filling to the ceiling",
};
