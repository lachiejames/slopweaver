/**
 * Whether running one row costs a SESSION or costs a command — the field that changes what the supervisor
 * does with a due ask, and the reason `automation due` is not simply a list of ids.
 *
 * **There is no clock.** An automation is run or spawned by the supervisor, by
 * judgement, at the decision point where it already spawns board rows. Measured against `./kinds.ts` as it
 * actually stands, no due row is a spawn decision at all: `verb-run`, `alert-summary` and
 * `datadog-alert-digest` all have executors that run IN the calling process with no model launched, which
 * is what `cli/commands/automation/runDue.ts` already does with them. A digest is the slowest of the three —
 * it takes one Datadog aggregate per declared probe, sequentially, against a shared rate-limit budget — and
 * it is still a command rather than a session.
 *
 * `investigate` is not session-shaped, because the clock JOINS the ask lane. Running the row is a
 * command like any other — `./investigate.ts` posts the row's question and briefs the posted message as an
 * ask — and the session that answers it, if one is needed at all, is dispatched by the ask lane on the
 * ask's own merits, judged by a visible supervisor. The tick no longer holds a slot for a briefing, because
 * the one lane's own backpressure is what a second one was being asked for.
 *
 * Presenting both as "spawn this" is the defect this module exists to prevent: a tick that holds an atlas
 * sync because the fleet is busy has held a one-second command for a cost it does not have, while the row
 * that genuinely competes for a slot is ranked beside it as though they were the same animal.
 *
 * `resync` was the first kind that genuinely competes: a resync target
 * is minutes of provider walking rather than a command, so the pass that runs one is seated as its own
 * visible session and the chair is free while it works. That is the whole of what "retire the standing
 * scheduler" means mechanically — the work did not stop needing a session, it stopped needing a session
 * that is always there.
 *
 * `hygiene-sweep` competes for the other reason a row can: its read is a command, but what it hands over —
 * the day's landing packet of the owner's pull requests — is work only a session the owner can watch may do
 * (rule 2). So it
 * is seated too, and its executor reads and publishes the packet INTO that session rather than acting on it.
 * `bump-fix` is seated for the same reason: its row reads a bump worklist in seconds, but the work the
 * worklist names — a rebase, a red leg read and fixed, a push and its CI — is judgement, and judgement happens in a
 * session the owner can watch (`AGENTS.md` rule 2). The row is seated so that session exists. `error-tracking-batch`
 * is seated on the same terms: its row reads the Error Tracking worklist, and the fixes it names are the session's.
 * So is `thread-chase`: its row reads the `slack awaiting` worklist, and whom to tag and what to ask is the session's.
 * So is `owed-reply`: its row reads the `slack owed` worklist, and what each question needs answering with is the session's.
 * So is `inbox-triage`: its row reads the `gmail triage` worklist, and what each sender group wants is the session's.
 * So is `linear-briefing`: its row reads the `cycle reconcile` worklist, and every write it proposes is the session's.
 * So is `alignment-briefing`: its row reads the `handover currency` worklist, and what the owner's day should aim at is the session's.
 *
 * The mapping is derived from the kind registry rather than listed here, so a kind added to `./kinds.ts`
 * without a decision about its shape fails to compile rather than defaulting to either answer.
 *
 * ## One kind answers differently row by row
 *
 * A `datadog-alert-digest` row is a command: five Datadog aggregates and one post, no model and no browser.
 * The same row with `shots` set is not, because a capture is taken in THE OWNER'S OWN CHROME
 * (`docs/browser-route.md`) by a session that can see it — rule 2 is the whole reason, and no tick may drive
 * a browser unattended. So {@link runShapeForDefinition} reads the row and not only its kind, and the three
 * digest rows can be moved one at a time by editing a definition file rather than by shipping a build.
 */
import { DATADOG_ALERT_DIGEST_KIND, planDatadogAlertDigest } from "./datadogAlertDigest.js";
import type { RecipeDefinition } from "./definition.js";
import {
  ALIGNMENT_BRIEFING_KIND,
  BRIEFING_KIND,
  BUMP_FIX_KIND,
  ERROR_TRACKING_BATCH_KIND,
  FLEET_CEILING_REPORT_KIND,
  HYGIENE_SWEEP_KIND,
  INBOX_TRIAGE_KIND,
  LINEAR_BRIEFING_KIND,
  OWED_REPLY_KIND,
  RESYNC_KIND,
  THREAD_CHASE_KIND,
} from "./kinds.js";

/** What running one row costs the fleet. */
export type RecipeRunShape = "run-here" | "spawn" | "no-executor";

/** Every kind this build can actually execute, and where. */
const EXECUTABLE_IN_PROCESS: ReadonlySet<string> = new Set([
  "verb-run",
  "alert-summary",
  "datadog-alert-digest",
  "metrics-push",
  FLEET_CEILING_REPORT_KIND,
  BRIEFING_KIND,
]);

/** Every kind whose run is a session a supervisor pass seats, rather than a command. */
const EXECUTABLE_IN_A_SEATED_SESSION: ReadonlySet<string> = new Set([
  RESYNC_KIND,
  HYGIENE_SWEEP_KIND,
  BUMP_FIX_KIND,
  ERROR_TRACKING_BATCH_KIND,
  THREAD_CHASE_KIND,
  OWED_REPLY_KIND,
  INBOX_TRIAGE_KIND,
  LINEAR_BRIEFING_KIND,
  ALIGNMENT_BRIEFING_KIND,
]);

/**
 * What running a row of this kind would cost.
 *
 * `no-executor` is its own answer rather than folded into either other one. A row selecting a registered
 * kind nothing implements is a real state — `metrics-push` once stood in it,
 * registered and implemented nowhere — and reporting it as `run-here` would have the supervisor run a row
 * that cannot run, while reporting it as `spawn` would have it hold a slot for one. No kind is in that
 * state today; the answer stays because the next registered-first kind will be.
 *
 * A `spawn` answer means what it always meant — a row the tick must hold a slot for — so `automation due`'s
 * tally, `automation seat` and sweep-contract step 13 all read it unchanged. Nine kinds answer it: `resync`,
 * `hygiene-sweep`, `bump-fix`, `error-tracking-batch`, `thread-chase`, `owed-reply`, `inbox-triage`,
 * `linear-briefing` and `alignment-briefing`,
 * whose executors run in a seated session rather than this process.
 *
 * @param kind the kind the row selected
 * @returns whether running it is a command in this process, a workspace, or nothing this build can do
 */
export function runShapeForKind({ kind }: { readonly kind: string }): RecipeRunShape {
  if (EXECUTABLE_IN_PROCESS.has(kind)) {
    return "run-here";
  }
  if (EXECUTABLE_IN_A_SEATED_SESSION.has(kind)) {
    return "spawn";
  }
  return "no-executor";
}

/**
 * What running THIS row would cost — the answer every caller wants, because one kind's shape depends on
 * what the row asked for.
 *
 * A `datadog-alert-digest` row carrying `shots` is seated, for the reason this module's header gives. A row
 * whose params do not parse at all is left to its kind's answer: the planner is what reports that refusal,
 * with the field and the reason, and a shape function inventing a second verdict for the same row would
 * have a tick and a seat disagree about where a broken row belongs.
 *
 * @param definition the parsed row
 * @returns whether running it is a command in this process, a workspace, or nothing this build can do
 */
export function runShapeForDefinition({ definition }: { readonly definition: RecipeDefinition }): RecipeRunShape {
  if (definition.kind === DATADOG_ALERT_DIGEST_KIND) {
    const plan = planDatadogAlertDigest({ definition });
    if (plan.isOk() && plan.value.shots) {
      return "spawn";
    }
  }
  return runShapeForKind({ kind: definition.kind });
}
