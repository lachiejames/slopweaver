/**
 * Lazy manifest for the `automation` noun — the automations, and the two ways one runs. `recipe` is the
 * same noun by its earlier name (`../nounAliases.ts`).
 *
 * **Nothing stands by**. There is no scheduler session, no tick that dispatches a child
 * and waits on it, and no clock. A row runs because a supervisor pass read `due` and decided
 * it was worth the cost: a `run-here` row is a command that pass types, and a `spawn`-shaped row is a
 * session `seat` opens and `run-due --claim-id` is then the only way to run. `skills/automation/SKILL.md`
 * is the whole of it.
 */
import {
  RECIPE_BLOCKER_USAGE,
  RECIPE_CLAIM_USAGE,
  RECIPE_DUE_USAGE,
  RECIPE_PROPAGATE_USAGE,
  RECIPE_REGISTER_RESYNCS_USAGE,
  RECIPE_REGISTER_STANDING_USAGE,
  RECIPE_REPAIR_USAGE,
  RECIPE_RESYNC_USAGE,
  RECIPE_RUN_DUE_USAGE,
  RECIPE_SEAT_USAGE,
} from "../commands/automation/core.js";
import { RECIPE_EXPLAIN_USAGE } from "../commands/automation/explainUsage.js";
import { RECIPE_FRESHNESS_USAGE } from "../commands/automation/freshnessUsage.js";
import { RECIPE_REPOINT_USAGE } from "../commands/automation/repointUsage.js";
import { RECIPE_RETIRE_USAGE } from "../commands/automation/retireUsage.js";
import { RECIPE_STATUS_USAGE } from "../commands/automation/statusUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";
import { automationSwitchManifest } from "./automationSwitch.js";

export const automationManifest: Readonly<Record<string, VerbManifestEntry>> = {
  blocker: lazy({
    load: () => import("../commands/automation/blocker.js").then((m) => m.recipeBlockerCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        'slopweaver automation blocker --atlas trelica --reason "the signed-in session is gone" --steps "Sign in"',
      parseRejectIsIoFree: true,
      summary:
        "Record that ONE scheduled target cannot resync unattended until a human does something, with the " +
        "exact clickops steps that clear it. It shows on the briefing's freshness section and is cleared " +
        "by the next successful resync, so a stale one cannot outlive the problem it describes",
      usage: RECIPE_BLOCKER_USAGE,
    },
  }),
  claim: lazy({
    load: () => import("../commands/automation/claim.js").then((m) => m.recipeClaimCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver automation claim knock-alerts --by supervisor-tick",
      parseRejectIsIoFree: true,
      summary:
        "Take, or release, the claim on one due automation as you spawn the session that runs it, so " +
        "the next tick does not spawn it again. The claim expires at the row's OWN next firing — no TTL " +
        "to tune, and a worker that dies leaves a row that comes back no later than its next slot",
      usage: RECIPE_CLAIM_USAGE,
    },
  }),
  due: lazy({
    load: () => import("../commands/automation/due.js").then((m) => m.recipeDueCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      // A bare run reads the definition store and prints what is due, so it acts rather than printing usage.
      dryParseSafe: false,
      effect: "none",
      example: "slopweaver automation due --brief",
      parseRejectIsIoFree: true,
      summary:
        "Which automations are DUE, for the supervisor's own tick to judge — read-only, no network, no " +
        "model, nothing claimed and nothing written. Each row says whether running it is a command in " +
        "this process or a SPAWNED session, how late it is against its own cadence, and who already holds it; " +
        "--brief keeps only the rows a tick decides on",
      usage: RECIPE_DUE_USAGE,
    },
  }),
  ...automationSwitchManifest,
  explain: lazy({
    load: () => import("../commands/automation/explain.js").then((m) => m.recipeExplainCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        "slopweaver automation explain inbox-triage-daily --slot 2026-11-03T02:00:00.000Z --attempt 1 " +
        '--why "The mail sign-in expired, so reconnecting mail in Setup fixes it."',
      parseRejectIsIoFree: true,
      summary:
        "Say, in one plain sentence, what went wrong with ONE failed firing and what would fix it — written by the " +
        "visible session that ran the row, or the next one to pick up a failure no session watched. The " +
        "Automations page leads that row with it and keeps the raw record " +
        "folded. Refused for a firing that did not fail, or a sentence outside the shape (words and numbers, " +
        "commas, one stop) or naming a code in words",
      usage: RECIPE_EXPLAIN_USAGE,
    },
  }),
  propagate: lazy({
    load: () => import("../commands/automation/propagate.js").then((m) => m.recipePropagateCommand),
    meta: {
      // `--seat` writes a board row and opens a visible session on it.
      createsWorkItem: true,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      // It reads and writes the propagation batch; the session `--seat` opens carries its own effects.
      effect: "local-state",
      example: "slopweaver automation propagate --status",
      parseRejectIsIoFree: true,
      summary:
        "Read, seat and confirm the ONE judgement pass every successful corpus resync joins. " +
        "`--status` lists the syncs the pass covers and what each re-derived, `--done --batch <id> " +
        "--through-revision <n>` confirms it through the batch and revision it read, `--seat` opens its visible session " +
        "by hand. Exit 3 when no pass is open",
      usage: RECIPE_PROPAGATE_USAGE,
    },
  }),
  "register-resyncs": lazy({
    load: () => import("../commands/automation/registerResyncs.js").then((m) => m.recipeRegisterResyncsCommand),
    meta: {
      createsWorkItem: false,
      // Non-zero means a row is not scheduled the way this build says it should be — a finding, not a fault.
      diagnostic: true,
      doorRouted: false,
      // A bare run reads the resync roster and writes the definitions, so it acts rather than printing usage.
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver automation register-resyncs --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Reconcile the definition store against the resync roster this build derives — one row per " +
        "registered atlas and per fetchable corpus source, each on a cadence derived from that target's " +
        "own declared freshness window. Rows it does not own are reported and left alone",
      usage: RECIPE_REGISTER_RESYNCS_USAGE,
    },
  }),
  "register-standing": lazy({
    load: () => import("../commands/automation/registerStanding.js").then((m) => m.recipeRegisterStandingCommand),
    meta: {
      createsWorkItem: false,
      // Non-zero means a row this build requires is neither present nor written — a finding, not a fault.
      diagnostic: true,
      doorRouted: false,
      // A bare run takes a lock and writes the standing rows, so it acts rather than printing usage.
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver automation register-standing --repo acme/acme-admin --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Write back the rows this install declares that the definition store no longer holds — the answer to " +
        "`automation due`'s absent-row line — and bring forward a row still exactly as an earlier build wrote it. " +
        "`--repo <owner/name>` first registers a team repository " +
        "whose rows are then declared. It creates into an empty path and writes over an occupied one only when " +
        "that one file is still exactly an earlier build's row, so a paused, held or hand-edited row is left " +
        "exactly as it is",
      usage: RECIPE_REGISTER_STANDING_USAGE,
    },
  }),
  retire: lazy({
    load: () => import("../commands/automation/retire.js").then((m) => m.recipeRetireCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        'slopweaver automation retire inbox-triage-daily --anchor talk:<id> --words "<their words>" --why "<why>"',
      parseRejectIsIoFree: true,
      summary:
        "Take ONE declared standing row off THIS install for good, on the owner's anchored words: records it in the " +
        "install's retirement registry, then removes its definition, so `automation due` prints one RETIRED line " +
        "and `register-standing` never writes it back. `--undo <recipeId>` gives it back, restored by " +
        "`register-standing`. Another home is untouched, and a firing already running is not cancelled",
      usage: RECIPE_RETIRE_USAGE,
    },
  }),
  repoint: lazy({
    load: () => import("../commands/automation/repoint.js").then((m) => m.recipeRepointCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // Its recipe id is a required positional, so a bare run prints usage and touches nothing.
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver automation repoint bump-drive-slopweaver --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Correct ONE own-repository row `automation due` reports as REPOSITORY DRIFT, in place: its one repository " +
        "flag moves to the repository this install's checkout resolves to, and every other field, `enabled` included, " +
        "is kept. Never a removal, which `register-standing` would answer with the declared row, turned on",
      usage: RECIPE_REPOINT_USAGE,
    },
  }),
  repair: lazy({
    load: () => import("../commands/automation/repair.js").then((m) => m.recipeRepairCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver automation repair knock-alerts --row knock-alerts-stopped-firing-28-sep",
      parseRejectIsIoFree: true,
      summary:
        "Say the seat on one board row has taken the repair of a recipe that stopped firing. " +
        "The stop then reaches the owner as a floating note naming the recipe and that seat, never a " +
        "queue card, until the row is done or its run closes. Refused for an undefined recipe or a dead row",
      usage: RECIPE_REPAIR_USAGE,
    },
  }),
  resync: lazy({
    load: () => import("../commands/automation/resync.js").then((m) => m.recipeResyncCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // It runs atlas syncs and corpus refreshes, which read providers; the steps carry their own door. Those
      // steps write the corpus and this verb writes its own outcome record, both under the home, as `refresh` does.
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver automation resync --atlas trelica",
      parseRejectIsIoFree: true,
      summary:
        "Bring ONE atlas or corpus source current and record whether it actually worked — the verb every " +
        "scheduled resync row selects. An atlas succeeds only when its generation clock MOVED, because a " +
        "sync can exit 0 having published nothing new",
      usage: RECIPE_RESYNC_USAGE,
    },
  }),
  "run-due": lazy({
    load: () => import("../commands/automation/runDue.js").then((m) => m.recipeRunDueCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      // A bare run claims a slot and runs every due row, so it acts rather than printing usage.
      dryParseSafe: false,
      // It writes the last-run stamp itself; the VERBS it runs carry their own effects and their own door.
      effect: "local-state",
      example: "slopweaver automation run-due --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Run the IN-REPO definition store's due rows — the rolling-window tick, separate from the Work " +
        "Console scheduler's own. A `verb-run` row runs one slopweaver verb in this process, an " +
        "`alert-summary` or `datadog-alert-digest` row runs two, the second being the door-routed " +
        "`slack post`, and an `investigate` row ASKS its question in the PRIVATE prompt conversation " +
        "(`slackBot.promptChannel`) and briefs the posted message as an ask, so the ask lane answers it and " +
        "the finished card lands in the row's `params.postTo`; no model is launched",
      usage: RECIPE_RUN_DUE_USAGE,
    },
  }),
  freshness: lazy({
    load: () => import("../commands/automation/freshness.js").then((m) => m.recipeFreshnessCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      // A bare run queries the selected store for each source's newest record, so it acts rather than printing usage.
      dryParseSafe: false,
      effect: "none",
      example: "slopweaver automation freshness --json",
      parseRejectIsIoFree: true,
      summary:
        "How current each provider's stored data is, one row per source — last verified sync, how far past its " +
        "window, newest stored record, and whether its sync is failing, blocked, paused or unscheduled. The small " +
        "local-only report the console polls on every page; read-only",
      usage: RECIPE_FRESHNESS_USAGE,
    },
  }),
  status: lazy({
    load: () => import("../commands/automation/status.js").then((m) => m.recipeStatusCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      // A bare run reads every automation's stores and prints the report, so it acts rather than printing usage.
      dryParseSafe: false,
      effect: "none",
      example: "slopweaver automation status --json",
      parseRejectIsIoFree: true,
      summary:
        "Every automation and corpus sync as the console's Automations page shows them: what each is doing " +
        "now, its health and why, who it waits on, its recorded firings, and what its newest syncs wrote per " +
        "channel, repository or project — read-only, every field read off a store",
      usage: RECIPE_STATUS_USAGE,
    },
  }),
  seat: lazy({
    load: () => import("../commands/automation/seat.js").then((m) => m.recipeSeatCommand),
    meta: {
      createsWorkItem: true,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      // It writes a board row and the claims file; the session it opens carries its own effects.
      effect: "local-state",
      example: "slopweaver automation seat --limit 6 --model sonnet",
      parseRejectIsIoFree: true,
      summary:
        "Open ONE visible session on the automations that need a session, claiming each row it hands " +
        "over — nothing stands by for these, a supervisor pass decides to seat them. A " +
        "spawn that fails releases every claim it took. Exit 3 when nothing needs a session",
      usage: RECIPE_SEAT_USAGE,
    },
  }),
};
