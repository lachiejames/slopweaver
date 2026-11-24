/**
 * The recipe rows this BUILD requires of EVERY install — the generic half of the declaration that makes a
 * vanished schedule loud. The other half is per install: each team repository registered with `automation
 * register-standing --repo` declares its own rows through `./teamStandingRows.ts`, and
 * `./declaredStandingRows.ts` is the one function that composes the two from a home. A fresh home declares only
 * these.
 *
 * ## The failure this closes, measured
 *
 * A `worktree-prune` row ran daily. `live/recipe/lifecycle.jsonl` held twenty-one records for it, the last a
 * `completed` for one slot. Then the row's file left `$SLOPWEAVER_HOME/live/recipe/definitions/` and
 * nothing said so: `automation due` reports the rows that are THERE, so a row that is gone reports as nothing at
 * all. Seventeen days later the owner counted 766 registered worktrees by hand on a volume at 93%, and `docs/worktree-prune/operations.md` still asserted
 * that a row ran this verb daily at 04:00 — canon describing a schedule that had stopped existing.
 *
 * The definition directory is outside the repository by construction (`./definition.ts` says why: a row can
 * carry a real workspace id, an identifier the hygiene gate refuses in a tracked file wherever `IDENTIFIER_VERDICT`
 * reads `refuse`). So a standing row lives only as a file in a directory nothing gates, and deleting one is silent and permanent. **The fix is to declare the
 * set HERE**, in reviewed code, so an absence is a comparison rather than a memory.
 *
 * ## Why this is a declaration and a create, not a second reconciler
 *
 * `live/resync/registrationPlan.ts` reconciles the atlas and corpus rows — it updates, retires and adopts,
 * and every one of those paths had to be taught, by successive Codex passes, not to overwrite somebody's
 * file. That apparatus earns its complexity from an OPEN roster: an atlas joins by being registered, so the
 * registrar cannot know what it will be asked to write next.
 *
 * This roster is CLOSED and short, so the contract can be narrower and the holes simply do not exist:
 * **create what is absent, report everything else, never write over a path that is occupied.** A row
 * somebody paused, a row somebody hand-edited and a row somebody held are each left exactly as they are —
 * `automation due` already renders those three states (`./dueReportLines.ts`'s `lateness`), and re-deciding them
 * here would be a second opinion about a row a reader can already see.
 *
 * Pure, and rows only: the comparison against the store is `./standingRowAbsence.ts`, the read and the write
 * are `../../cli/commands/automation/` and `./standingRowStore.ts`, and the row contract is `./standingRow.ts`.
 */
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "./definition.js";
import { HYGIENE_SWEEP_KIND } from "./kinds.js";
import { ALIGNMENT_BRIEFING_WEEKDAY } from "./standingAlignmentBriefingRows.js";
import { CALL_ASSESSMENT_DAILY } from "./standingCallAssessmentRows.js";
import { THREAD_CHASE_DAILY } from "./standingChaseRows.js";
import { LINEAR_BRIEFING_DAILY } from "./standingLinearBriefingRows.js";
import {
  CONTEXT_COST_WEEKLY,
  FLEET_CEILING_DAILY,
  TOKEN_PASS_WEEKLY,
  VALUE_SAMPLE_WEEKLY,
} from "./standingMeasurementRows.js";
import { MEETING_PREP_HOURLY } from "./standingMeetingPrepRows.js";
import { SLACK_OWED_DAILY } from "./standingOwedRows.js";
import type { StandingRow } from "./standingRow.js";
import { STORE_IMPORT_FLEET_NIGHTLY, STORE_RESTORE_REHEARSAL } from "./standingStoreRows.js";
import { VERB_RUN_KIND } from "./verbRun.js";

/**
 * The hourly worktree prune.
 *
 * **Hourly, because a day's inflow does not fit in one slot.** Deleting a tree is filesystem-bound: one
 * acme-admin `git worktree remove` took 7m45s (545k entries, 429k of them its hardlinks-local
 * `node_modules`), and a parallel `rm` on that volume was no faster. One daily slot under the verb's 15-minute apply budget
 * reclaims two such trees, against around nine acme-admin trees retired a day, so the backlog only grew —
 * the owner expected 300 GB free that morning and read 95. Twenty-four slots are six hours of removal a day
 * against roughly seventy minutes of steady-state work, so a firing with nothing owed costs one scan and
 * stops. The verb holds an operation lock for a whole `--apply`, so a slot that lands while an earlier one or
 * a manual drain is still running says so and removes nothing. Reproduce the removal cost:
 * `time git worktree remove <an acme-admin tree>`.
 *
 * **The argv is deliberately minimal.** `--older-than` and `--budget` are omitted so the row inherits
 * `worktree/pruneOptions.ts`'s own measured defaults (`24h`, the owner's rule; `15m`, the bound taken off
 * two killed slots) rather than freezing those numbers into a file nothing reviews. A row naming them would
 * keep whatever they were on the day it was written, and the next measurement would move the constant while
 * the schedule quietly kept the old one.
 *
 * **No `--repo`, for the same reason the verb sweeps round-robin.** `worktree prune` already covers every
 * declared main checkout, which is exactly the "BOTH repos" this row is for; naming one would reproduce
 * a slot where a bounded run spent itself inside slopweaver and never reached acme-admin's sixteen candidates.
 *
 * **`onMissed: "skip"`, not `backfill`.** A missed prune is not data that is absent — the next slot removes
 * the same trees plus an hour's worth. Backfilling six slots would run six identical sweeps.
 *
 * **`--if-idle`, so it steps aside for an apply already running** rather than waiting on one — the holder is
 * doing its work (`cli/commands/worktree/pruneApplyLock.ts`). An asked-for drain without the flag waits instead.
 *
 * **It supersedes the daily `0 4 * * *` row and the hourly one without `--if-idle`**, either of which an install
 * may already hold: create-if-absent alone would leave that file running while this declaration read otherwise. Read the installed one with
 * `cat "$SLOPWEAVER_HOME/live/recipe/definitions/worktree-prune.json"`.
 *
 * **It fires without a supervisor pass, unlike every other row.** The prune runs on a schedule AND a threshold, free disk never under 100 GB. A pass-driven row
 * had sat 389 slots unrun. So the `PreToolUse` hook runs this row's `run-due` on the first tool call of each
 * hour, and a disk read under the prune floor (`worktree/pruneFloor.ts`) runs the verb itself past this row — `worktree/pruneTrigger.ts` carries
 * both.
 */
const WORKTREE_PRUNE: StandingRow = {
  definition: {
    cadence: "0 * * * *",
    destination: { kind: "local-atlas" },
    effect: "read-write",
    enabled: true,
    kind: VERB_RUN_KIND,
    onMissed: "skip",
    params: { argv: ["worktree", "prune", "--apply", "--if-idle"] },
    recipeId: "worktree-prune",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  supersedes: [
    {
      cadence: "0 * * * *",
      destination: { kind: "local-atlas" },
      effect: "read-write",
      enabled: true,
      kind: VERB_RUN_KIND,
      onMissed: "skip",
      params: { argv: ["worktree", "prune", "--apply"] },
      recipeId: "worktree-prune",
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    },
    {
      cadence: "0 4 * * *",
      destination: { kind: "local-atlas" },
      effect: "read-write",
      enabled: true,
      kind: VERB_RUN_KIND,
      onMissed: "skip",
      params: { argv: ["worktree", "prune", "--apply"] },
      recipeId: "worktree-prune",
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    },
  ],
  why:
    "nothing else removes a worktree when its session ends, so without this row every merged, pushed and " +
    "cold checkout accumulates until somebody counts them by hand — measured at 766 " +
    "registrations on a volume 93% full, seventeen days after the row stopped",
};

/**
 * The daily self-improvement mine.
 *
 * **It died the same afternoon `worktree-prune` did**, and for the same reason: its last slot completed, the
 * definition file left the store, and nothing said so. What made this one worse is that it had a GAUGE. `reflect friction-review` compared
 * the newest report's date against the last publish stamp, and both stall together when the producer stops,
 * so seventeen days of silence read as `current` and the Fleet Briefing rendered it as "nothing waiting".
 * The gauge was fixed first; this row is what gives it something to watch. This row revives it;
 * `alert-findings-push`, which died in the same hour, stays deliberately dead.
 *
 * **`verb-run`, not the briefing-only `investigate` kind**, even though a seated session is what wrote the
 * five reports this row replaces. An `investigate` row's params require `askedBy` and `channel` — both
 * per-install Slack ids — and this file is committed, which a per-install id forbids. It would also put a question in
 * the owner's DM and spend a visible session every morning, to produce a report the miner can render on its own.
 *
 * **`30 6 * * *` is the row's own observed cadence**, not a chosen one: every slot key in the lifecycle log
 * carries `06:30`. Read the last one back with:
 *
 *   grep -o 'self-improvement|[0-9-]*|[0-9:]*' "$SLOPWEAVER_HOME/live/recipe/lifecycle.jsonl" | tail -1
 *
 * **`onMissed: "skip"`, not `backfill`.** `reflect brief` resolves its window against `now` rather than
 * against the slot it is filling, so a backfilled run mines the same window the live one does — duplicate
 * output, and the seen ledger's recurrence counters advanced twice for a single sighting. `./kinds.ts`
 * registers `verb-run` as `perSlot: false` for exactly this.
 *
 * **`--write` and nothing else.** `--from`, `--to` and `--cap` are omitted so the row inherits the miner's
 * own defaults rather than freezing today's numbers into a file nothing reviews — the same reasoning
 * {@link WORKTREE_PRUNE} states for its argv.
 */
const SELF_IMPROVEMENT: StandingRow = {
  definition: {
    cadence: "30 6 * * *",
    destination: { kind: "local-atlas" },
    effect: "read-write",
    enabled: true,
    kind: VERB_RUN_KIND,
    onMissed: "skip",
    params: { argv: ["reflect", "brief", "--write"] },
    recipeId: "self-improvement",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  why:
    "nothing else mines the day's friction into a dated report, so without this row " +
    "`reflect friction-review` has no producer to watch and the loop that turns a recurring failure into a " +
    "board row stops — measured at seventeen days silent, seventeen days of which the gauge " +
    "itself reported `current`",
};

/**
 * The four-hourly dependency-bump drive, declared ONCE PER REPOSITORY.
 *
 * Open dependency bump pull requests are driven over the line on a schedule, so these rows are the automation,
 * and `github bump-drive` is the verb they fire. Their SUBJECT is every dependency bump pull request, auto-merged,
 * in either repository, pressed the moment it is mergeable.
 *
 * **The cadence is also the supersede bound.** A bump of the owner's that Renovate has since merged is closed
 * within hours, never days, and on this job rather than a new one. The pass's first act is
 * `close-superseded` (`skills/github/reference/superseded-bumps.md`), so four hours is that bound.
 *
 * **One row per repository rather than one naming them all, and the caps are the argument.** The three caps in
 * `../../cli/commands/github/bumpDriveCore.ts` are per PASS, not per repository, so a single row reading two
 * would make the two backlogs compete for the same three presses — and MEASURED the team
 * repository carried 20 open bumps to `slopweaver`'s ten, so fleet order alone would starve the smaller one. A
 * row each gives each repository its own three, and the cadences are offset so two never fire in the same
 * minute. This repository's row is built by `./standingOwnRepositoryRows.ts` and a registered team repository's by
 * `./teamStandingRows.ts`, both from this same function.
 *
 * **`--repo` named rather than inherited.** The verb would otherwise resolve whatever checkout the pass ran
 * in, which makes the subject a property of where a session happened to be rather than of the schedule.
 *
 * **No `--limit` and no `--opt-out-label`.** Both would freeze a default into a file nothing reviews, the same
 * reasoning `WORKTREE_PRUNE` states for its own omissions; the per-pass caps live in
 * `cli/commands/github/bumpDriveCore.ts` where they are measured.
 *
 * **`onMissed: "skip"`.** A missed pass is not absent data: the next one reads the same open pull requests plus
 * whatever renovate opened since. Backfilling six slots would run six identical reads and six identical
 * enqueues against a queue GitHub already holds.
 *
 * The `recipeId` is passed rather than derived from the slug: a row's id is the key the definition store is
 * keyed by, and deriving one means a repository rename silently mints a second row beside the first.
 *
 * @param repo the repository slug this row drives
 * @param recipeId the store key, which must never move once a row has fired
 * @param cadence the cron expression, offset so two rows never fire in the same minute
 * @param why what stops happening while this row is gone
 * @returns the declared row
 */
export function bumpDriveRow({
  repo,
  recipeId,
  cadence,
  why,
}: {
  repo: string;
  recipeId: string;
  cadence: string;
  why: string;
}): StandingRow {
  return {
    definition: {
      cadence,
      destination: { kind: "local-atlas" },
      effect: "read-write",
      enabled: true,
      kind: VERB_RUN_KIND,
      onMissed: "skip",
      params: { argv: ["github", "bump-drive", "--repo", repo] },
      recipeId,
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    },
    why,
  };
}

/**
 * The daily bronze compaction.
 *
 * Bronze growing 8,205 → 10,072 MiB in eight days is met by streaming the whole-corpus readers and real
 * compaction, never a workaround. `compact` had only ever run by hand, so every refresh's new window file sat beside the canonical one until
 * somebody remembered — and every cross-window duplicate in them was carried by every reader meanwhile.
 *
 * **Safe to schedule because the verb takes each source's refresh slot** (`../../corpus/refreshSlot.ts`): a
 * source a refresh is writing is skipped, never rewritten under it, and a run where every source was held
 * exits DEFERRED, which the runner leaves due rather than stamping — so the next tick tries again.
 *
 * **Lossless argv, no `--older-than`.** Age-pruning deletes records, and a horizon frozen into a file nothing
 * reviews is exactly the silent loss the verb's own opt-in flag exists to prevent.
 *
 * **`30 2 * * *`, `onMissed: "skip"`.** Off-peak, clear of the 04:00 prune and the 05:00 context check; a
 * missed night is not absent data, because the next run compacts the same windows plus a day's more.
 */
const COMPACT_CORPUS_DAILY: StandingRow = {
  definition: {
    cadence: "30 2 * * *",
    destination: { kind: "local-atlas" },
    effect: "read-write",
    enabled: true,
    kind: VERB_RUN_KIND,
    onMissed: "skip",
    params: { argv: ["compact", "run"] },
    recipeId: "compact-corpus-daily",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  why:
    "nothing else folds a refresh's new window files into each source's canonical file, so without this row " +
    "bronze carries every cross-window duplicate until somebody runs `compact` by hand — measured " +
    "at 8,205 → 10,072 MiB in eight days",
};

/**
 * The daily board sweep, published as JSONL — one finding per line, zero bytes on a clean pass.
 *
 * **No `--probe`.** A row's `command:` probe is a shell string its handover doc supplied, and
 * `../../handover/commandProbe.ts` runs it unrestricted, so a scheduled pass carrying `--probe` would run
 * whatever any doc on the board says, unattended, every morning — a provider write included. Probing stays
 * a choice a session makes by hand; this document reads the journal and the non-command probes. **`--write`**
 * publishes the `--json` lines to `live/hygiene/sweep-board.jsonl`, so a clean pass is a fresh empty file
 * rather than an absence a reader cannot tell from a pass that never ran. **`--queue`** puts the result where the
 * owner reads it: one Queue card a UTC day (`sweep-board-YYYY-MM-DD`) naming each page the owner asked for that
 * never reached their Queue — nothing on a clean pass — and its own earlier cards settled once a later pass
 * contradicts them (`../../sweep/dailyQueue.ts`, `../../sweep/cardRetirement.ts`). Before it, this row's only reader
 * was the Fleet Briefing's "Nothing stale" count. **`--settle-ended`** takes a card off the owner's Queue by itself
 * when every pull request its question names has merged or closed on GitHub — otherwise the owner drops by hand a
 * card asking them to close a pull request already closed. **`--close-shipped`** closes a row whose own witness says
 * the work is in, never carding it, because asking the owner about landing work they already ruled on is a card
 * with nothing to decide. Both capped, one row at a time, re-judged at the write and journalled on both ledgers
 * (`../../cli/commands/sweep/endedSettle.ts`, `../../cli/commands/sweep/shippedClose.ts`).
 *
 * **It supersedes every earlier row** an install may hold — `--write`, `--write --queue` and `--write --queue
 * --settle-ended`: create-if-absent alone would leave any of them firing every morning without the newer flags. Read
 * the installed one with `cat "$SLOPWEAVER_HOME/live/recipe/definitions/sweep-board-daily.json"`.
 *
 * **`0 7 * * *`, `onMissed: "skip"`.** A missed morning is not absent data: the next pass reads the board as
 * it then stands.
 */
const SWEEP_BOARD_DAILY_DEFINITION: RecipeDefinition = {
  cadence: "0 7 * * *",
  destination: { kind: "local-atlas" },
  effect: "read-write",
  enabled: true,
  kind: VERB_RUN_KIND,
  onMissed: "skip",
  params: { argv: ["sweep", "board", "--write", "--queue", "--settle-ended", "--close-shipped"] },
  recipeId: "sweep-board-daily",
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
};

const SWEEP_BOARD_DAILY: StandingRow = {
  definition: SWEEP_BOARD_DAILY_DEFINITION,
  supersedes: [
    { ...SWEEP_BOARD_DAILY_DEFINITION, params: { argv: ["sweep", "board", "--write"] } },
    { ...SWEEP_BOARD_DAILY_DEFINITION, params: { argv: ["sweep", "board", "--write", "--queue"] } },
    { ...SWEEP_BOARD_DAILY_DEFINITION, params: { argv: ["sweep", "board", "--write", "--queue", "--settle-ended"] } },
  ],
  why:
    "nothing else re-reads every board row against its own probes, so without this row a shipped row goes " +
    "on being ranked as work, live/hygiene/sweep-board.jsonl stops saying which rows are safe to sweep, a " +
    "page the owner asked for that closed without a card never reaches their Queue, and a card about a pull request " +
    "that already merged or closed stays on it",
};

/**
 * The daily hygiene seat — ONE visible session handed the landing packet for the owner's open pull requests.
 *
 * A `hygiene-sweep` row is SPAWN-shaped: a supervisor pass seats it with `automation seat --recipe hygiene-sweep
 * --limit 1 --model <m>`, and the seated session runs it under its claim token. The row publishes the packet
 * to `live/hygiene/github-landing.json` and prints it; what the session then does is
 * `skills/automation/SKILL.md` § A hygiene-sweep row. **Empty params**, because the read is fixed in
 * `./hygieneSweep.ts` and a row that carried any would be refused.
 *
 * **`15 7 * * *`, `onMissed: "skip"`.** After the board document is fresh; a missed morning is
 * not absent data, because the next read sees every pull request as it then stands.
 */
const HYGIENE_SWEEP: StandingRow = {
  definition: {
    cadence: "15 7 * * *",
    destination: { kind: "local-atlas" },
    effect: "read-write",
    enabled: true,
    kind: HYGIENE_SWEEP_KIND,
    onMissed: "skip",
    params: {},
    recipeId: "hygiene-sweep",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  why:
    "nothing else hands a visible session the day's landing packet for the owner's own pull requests, so without this " +
    "row a ready one waits on somebody opening `github landing` by hand and live/hygiene/github-landing.json " +
    "goes stale",
};

/**
 * The hourly fleet-capacity survival read — the one pass that asks whether every routable Claude and Codex plan is
 * measured spent until a reset (a monthly-spend plan is never routed, so never counted).
 *
 * It runs `monitor check --only fleet-runs-dry --fire`, which judges the latest `machine capacity` reading the
 * supervisor tick filed and raises a floating note ONLY when no plan of either provider can start a seat for the
 * monitor's threshold; a clear pass settles an open card and posts nothing (never on a schedule).
 * `--only` keeps this row from settling or posting any other monitor's card, which stays the supervisor pass's call.
 *
 * **The recipe id is a legacy storage key.** `claude-survival-forecast` named the Claude drawdown forecast this row
 * once fired; it stays so an installed row keeps its run stamps and slot ledger, and the definition is unchanged, so
 * there is no earlier shape to supersede.
 *
 * **`17 * * * *`, `onMissed: "skip"`.** The tick files a capacity reading every pass, and the monitor refuses one
 * older than two hours; a missed slot is not absent data, because the next read judges the newest reading as it
 * then stands.
 */
const FLEET_CAPACITY_SURVIVAL: StandingRow = {
  definition: {
    cadence: "17 * * * *",
    destination: { kind: "local-atlas" },
    effect: "read-write",
    enabled: true,
    kind: VERB_RUN_KIND,
    onMissed: "skip",
    params: {
      argv: [
        "monitor",
        "check",
        "--only",
        "fleet-runs-dry",
        "--fire",
        "--by-session",
        "recipe:claude-survival-forecast",
      ],
    },
    recipeId: "claude-survival-forecast",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  why:
    "nothing else judges every Claude and Codex plan's capacity together against their resets, so without this " +
    "row a fleet with no route left is found by a seat that cannot start, never by a note naming the reset",
};

/**
 * The daily publication audit — re-read what the fleet has published (GitHub threads, Slack messages, Linear and
 * Notion objects its own write journals record) through the outbound privacy check, then fire the `publication-leak`
 * monitor over the report, so a leak becomes one floating note and Queue card naming its class, door and link.
 *
 * **One verb, no session.** The audit and the pass are reads and local card writes, so this is `verb-run`: the
 * supervisor's `automation run-due` runs it inside the visible session that claimed it, never a daemon (rule 2).
 * `--fire` runs the pass whatever the audit found — a partial or a firing report is exactly what keeps an open card
 * open, or raises one. A run that worked over a report that is not clean exits 3, which `run-due` stamps and settles
 * succeeded: exiting 1 on a finding would retry the slot and hold the row as failing, a second card about the same leak.
 *
 * **No `--repo`.** A generic row names no repository: the verb's own default is the repository this build publishes
 * from.
 *
 * **`45 5 * * *`, `onMissed: "skip"`.** Early in the owner's morning, before the hygiene sweep's landing packet; the
 * next run reads every object a missed day would have.
 *
 * **Declared OFF (`enabled: false`).** The owner's standing ruling keeps every automation off bar the store backup and
 * the self-improvement brief until they say otherwise, so landing this row registers it parked and it never fires; whether to switch it on is asked on the first run's Queue card. This line stays off: an install turns its row on
 * with `automation enable`, on the owner's anchored words.
 */
const PUBLICATION_AUDIT_DAILY: StandingRow = {
  definition: {
    cadence: "45 5 * * *",
    destination: { kind: "local-atlas" },
    effect: "read-write",
    enabled: false,
    kind: VERB_RUN_KIND,
    onMissed: "skip",
    params: {
      argv: ["audit", "publications", "--fire", "--by-session", "recipe:publication-audit-daily"],
    },
    recipeId: "publication-audit-daily",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  why:
    "nothing else re-reads what the fleet has already published, so a leak a write door let through stays live " +
    "until somebody happens on it — measured on the first run: three known leaks on this repository's own pull " +
    "requests, found only by reading every thread back",
};

/**
 * Every row this build requires of EVERY install whatever its address — closed, short, and naming no repository, no
 * person's login and no organisation's Renovate actor. The rows on this repository are
 * `./standingOwnRepositoryRows.ts`'s, a registered team repository's `./teamStandingRows.ts`'s;
 * `./declaredStandingRows.ts` composes all three into what `./standingRowAbsence.ts` judges.
 */
export const GENERIC_STANDING_ROWS: readonly StandingRow[] = [
  COMPACT_CORPUS_DAILY,
  CONTEXT_COST_WEEKLY,
  TOKEN_PASS_WEEKLY,
  VALUE_SAMPLE_WEEKLY,
  FLEET_CEILING_DAILY,
  SELF_IMPROVEMENT,
  WORKTREE_PRUNE,
  SLACK_OWED_DAILY,
  CALL_ASSESSMENT_DAILY,
  THREAD_CHASE_DAILY,
  MEETING_PREP_HOURLY,
  LINEAR_BRIEFING_DAILY,
  ALIGNMENT_BRIEFING_WEEKDAY,
  SWEEP_BOARD_DAILY,
  HYGIENE_SWEEP,
  STORE_RESTORE_REHEARSAL,
  STORE_IMPORT_FLEET_NIGHTLY,
  FLEET_CAPACITY_SURVIVAL,
  PUBLICATION_AUDIT_DAILY,
];
