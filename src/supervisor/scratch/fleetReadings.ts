/**
 * The readings a sweep tick takes that need nothing from the seat — every source the fleet as a whole reports on,
 * in the order they run after the seat's own (`./tickCapture.ts`). The order is load-bearing: each comment below
 * says what a reading must come before or after, and why.
 *
 * No I/O, no clock.
 */
import { TURN_DISPATCH_SWEEP_READING } from "../digestTurnSweep.js";
import type { TickReading } from "./tickCapture.js";

/** The readings that take nothing from the seat: every source the fleet as a whole reports on. */
export const FLEET_READINGS: readonly TickReading[] = [
  // Every open bot-turn dispatch reconciled — ready, phantom, worker-failed, lease-expired — by the global sweep the
  // loop runs at turn start. Here so a turn dispatched from a host with no same-session wake (Codex) is reconciled by
  // the next visible tick; it relaunches nothing and resends no pickup (`../../cli/commands/turn/dispatchSweep.ts`).
  // A completed sweep always prints its summary, so an empty one is a failed read and earns the one retry. FIRST, so
  // its digest lines are this tick's before anything a later reading fires.
  { argv: ["turn", "dispatch", "--sweep"], format: "text", name: TURN_DISPATCH_SWEEP_READING, retryWhenEmpty: true },
  { argv: ["recipe", "due", "--json"], draftSource: "recipeDue", format: "json", name: "recipe-due" },
  // How current each provider's data is — the numbers the console sidebar strip once drew
  // (`site/lib/sourceFreshness.ts` still words the same document). MEASURED: the owner saw Notion failing
  // there twelve hours after its sync broke, and no tick had read this. Exit 0 for any report (`../../cli/commands/automation/freshness.ts`).
  { argv: ["automation", "freshness", "--json"], format: "json", name: "freshness" },
  {
    argv: ["machine", "capacity", "--json"],
    completedExits: [0, 1],
    draftSource: "capacity",
    format: "json",
    name: "capacity",
  },
  // How many working seats the plans carry until they reset; `tick-draft` folds it into the capacity facts and the
  // idle-capacity gate fills to it (`../idleCapacityGate.ts`).
  {
    argv: ["fleet", "ceiling", "--days", "7", "--json"],
    draftSource: "seatCeiling",
    format: "json",
    name: "seat-ceiling",
  },
  // A Codex plan at routing's 99% bar while its window runs is claimed its held usage-limit reset here, once per
  // account, each claim journalled with the store before and after (`../../cli/commands/codex/resetFleetRun.ts`) —
  // the owner's rule is to take a plan all the way up to 99 percent and then do the reset. Exit 4 is a claim
  // whose answer never came back, settled under the same key next tick. A FAILED claim is exit 1, and the monitor
  // fired straight after it raises the one floating note it earns; a claim that refilled its plan says nothing.
  {
    argv: ["codex", "reset", "--at-limit"],
    completedExits: [0, 4],
    format: "text",
    name: "codex-reset-at-limit",
  },
  {
    argv: ["monitor", "check", "--only", "codex-reset-failed", "--fire", "--by-session", "supervisor", "--json"],
    format: "json",
    name: "codex-reset-failed",
    producer: "monitor check codex-reset-failed",
  },
  // Why the fleet is not running more working seats, and what the machine measured over the last hour — the Fleet
  // page's glance reads it with `reading last --producer "fleet why"`. It reads the ledger only, so it sits AFTER
  // `watch-report`, `capacity` and `seat-ceiling`: each is recorded as it lands, and it judges those three as one tick.
  { argv: ["fleet", "why", "--minutes", "60", "--json"], format: "json", name: "fleet-why" },
  // Each host's tokens over the last 24 hours and its sessions drawing now — the Fleet page's per-host usage line
  // reads it with `reading last --producer "fleet burn"`. MEASURED: 5.1s wall over 207 Claude sessions
  // and 404 Codex rollouts (`/usr/bin/time -p slopweaver fleet burn`), well inside the reading budget.
  { argv: ["fleet", "burn", "--json"], format: "json", name: "fleet-burn" },
  { argv: ["claude", "gauge"], format: "text", name: "gauge" },
  { argv: ["claude", "gauge", "--json"], draftSource: "gauge", format: "json", name: "gauge-report" },
  // A registered plan signed out, missing locally or failing its probe, FIRED: one card per fault, its note naming
  // the plan by email and the owner's one step (`../../monitor/claudePlanUnusable.ts`). AFTER
  // `gauge-report`, whose probes it judges, so the card is this tick's. MEASURED: `plan-two`
  // sat unread about 72 hours with no card anywhere, because no monitor read a Claude plan's fault at all.
  {
    argv: ["monitor", "check", "--only", "claude-plan-unusable", "--fire", "--by-session", "supervisor", "--json"],
    format: "json",
    name: "claude-plans",
    producer: "monitor check claude-plan-unusable",
  },
  // Every Codex store read live, filing each alias's sign-in observation; then the Codex sign-out card FIRED over
  // those rows (`../../monitor/codexPlanSignedOutDefinition.ts`). Adjacent, so the judged rows are this tick's —
  // before this, only a Codex pass or seat filed them and no tick fired the card at all.
  { argv: ["codex", "route", "--json"], format: "json", name: "codex-route" },
  {
    argv: ["monitor", "check", "--only", "codex-plan-signed-out", "--fire", "--by-session", "supervisor", "--json"],
    format: "json",
    name: "codex-plans",
    producer: "monitor check codex-plan-signed-out",
  },
  // Either model host's plans together projected to run out before a reset, FIRED: one floating card, held while the
  // same plans run out (`../../monitor/hostWeekRunsOut.ts`). AFTER
  // `capacity`, whose filed reading starts the Codex plans, and `gauge-report`, whose probes the Claude journal holds.
  {
    argv: ["monitor", "check", "--only", "host-week-runs-out", "--fire", "--by-session", "supervisor", "--json"],
    format: "json",
    name: "plan-week",
    producer: "monitor check host-week-runs-out",
  },
  { argv: ["velocity", "--json"], draftSource: "velocity", format: "json", name: "velocity" },
  {
    argv: ["handover", "reconcile", "--json"],
    completedExits: [0, 1],
    draftSource: "reconcile",
    format: "json",
    name: "reconcile",
  },
  // The Queue cards a gate withheld, read from the running console (`../../cli/commands/queue/refusalsRun.ts`): a
  // withheld card never reaches the owner, so this is how the chair learns of it and routes it to a fixing seat this pass.
  // Exit 1 still prints the whole document — an incomplete report, or the console not answering — and the digest
  // says each in capitals. The verb's own HTTP read (100s) sits inside the shared reading budget.
  { argv: ["queue", "refusals", "--json"], completedExits: [0, 1], format: "json", name: "queue-refusals" },
  {
    argv: ["reflect", "friction-review", "--json"],
    completedExits: [0, 3],
    draftSource: "friction",
    format: "json",
    name: "friction",
  },
  // `turn blocked` exits 3 (EXIT_EXPECTED_EMPTY) when nothing waits on the owner — the healthy answer, not a failure.
  // Residue: the verb reads an unreadable ask store as empty too (`readAskLifecycleText` returns ""), so that
  // failure also exits 3 and reads as nothing waiting. Refusing 3 would call every quiet tick unavailable instead;
  // the store swallowing its own read failure is the verb's defect to fix, not this reading's.
  { argv: ["turn", "blocked", "--json"], completedExits: [0, 3], format: "json", name: "blocked" },
  {
    argv: ["listen", "status", "--json"],
    completedExits: [0, 3],
    draftSource: "listener",
    format: "json",
    name: "listen",
  },
  // An automation stopped on the owner's own uncleared hold, FIRED: one card per held row, marked as stopping the owner's work so it
  // stands after their priorities until they answer it, settled the tick the hold clears, and not posted again for a hold
  // the owner answered until it is placed again (`../../monitor/automationHeldOnYou.ts`).
  // This is a P0 rule: the security-fix top-up once stood on the owner's hold for two days with no card anywhere. BEFORE `queue-stopping`, so the card the
  // digest names is the one already posted.
  {
    argv: ["monitor", "check", "--only", "automation-held-on-you", "--fire", "--by-session", "supervisor", "--json"],
    format: "json",
    name: "automation-held",
    producer: "monitor check automation-held-on-you",
  },
  // Every open step whose precondition already holds — the owner is signed in, the owner is in the channel — retired before the owner
  // opens its card (`../../cli/commands/hand/recheck.ts`). BEFORE the sign-in walls: a `mon-signin-*`
  // card it settles is then HELD by that monitor rather than re-posted, and the seat re-seats the stopped resync.
  // Exit 3 is the quiet answer: no open step names a precondition the fleet reads.
  {
    argv: ["hand", "recheck", "--by-session", "supervisor", "--json"],
    completedExits: [0, 3],
    format: "json",
    name: "hand-recheck",
  },
  // A bot turn blocked on a browser sign-in its answer needs, FIRED: one floating work card per origin, the page opened
  // in the owner's work Chrome (`../../monitor/turnSignedOut.ts`). `turn block` and `turn unblock`
  // fire it themselves; this is the catch-up for a pass either verb reported refused. AFTER hand recheck, whose settle
  // of a card the owner already answered this monitor then holds.
  {
    argv: ["monitor", "check", "--only", "turn-signed-out", "--fire", "--by-session", "supervisor", "--json"],
    format: "json",
    name: "turn-sign-ins",
    producer: "monitor check turn-signed-out",
  },
  // A scheduled resync that stopped at a sign-in page, FIRED on the fleet-health cadence: one card per origin, the
  // sign-in on the owner's pasteboard (`../../monitor/resyncSignedOut.ts`). BEFORE fleet health,
  // whose line for that row says the step is open — so the card is up by the time the note says so.
  {
    argv: ["monitor", "check", "--only", "resync-signed-out", "--fire", "--by-session", "supervisor", "--json"],
    format: "json",
    name: "sign-in-walls",
    producer: "monitor check resync-signed-out",
  },
  // A standing recipe gone quiet that no seat has and no hold explains, FIRED: one card for the whole stopped set,
  // settled the tick its set clears or a seat takes it (`../../monitor/evaluateStopped.ts`). A hold the chair records
  // THIS tick lands in the ledger at tick close, after this pass, so it settles the card on the next tick.
  // Nothing else fires it, so without it a card outlived its subject: MEASURED, the top of the owner's Queue was
  // a set posted 28h earlier that a dry `monitor check --only recipe-stopped` would have settled. The
  // stopped card FIRST: a stop a seat took before the tick has its stopped note taken down here, before the repairing
  // notice after it draws. A notice whose note went down without the owner's press is raised again by a later pass
  // (`../../monitor/noticeReraise.ts`). Both BEFORE fleet health, whose note then draws in front of them when it
  // has one. MEASURED, a dry pass each on one install: 4.04s and 3.87s wall
  // (`/usr/bin/time -p slopweaver monitor check --only recipe-stopped`, then `--only recipe-repairing`).
  {
    argv: ["monitor", "check", "--only", "recipe-stopped", "--fire", "--by-session", "supervisor", "--json"],
    format: "json",
    name: "recipe-stopped",
    producer: "monitor check recipe-stopped",
  },
  {
    argv: ["monitor", "check", "--only", "recipe-repairing", "--fire", "--by-session", "supervisor", "--json"],
    format: "json",
    name: "recipe-repairing",
    producer: "monitor check recipe-repairing",
  },
  // The fleet health verdict, FIRED: a tripped verdict posts its one floating note here, at tick open, and
  // `tick close` refuses a tick whose verdict is tripped with no note up (`../fleetHealthGate.ts`).
  {
    argv: ["monitor", "check", "--only", "fleet-unhealthy", "--fire", "--by-session", "supervisor", "--json"],
    format: "json",
    name: "fleet-health",
    producer: "monitor check fleet-unhealthy",
  },
  // A refresh the console started that failed, FIRED: one check-in card for every failed run inside 24 hours
  // (`../../monitor/consoleSyncFailed.ts`), so a reading the console still shows stale has its cause in front of the
  // fleet rather than only in the browser tab that pressed. Nothing else fires it.
  {
    argv: ["monitor", "check", "--only", "console-sync-failed", "--fire", "--by-session", "supervisor", "--json"],
    format: "json",
    name: "console-sync-failed",
    producer: "monitor check console-sync-failed",
  },
  // The cards stopping the owner's work, in the owner's Queue order, read from the running console
  // (`../../cli/commands/queue/stoppingRun.ts`): the digest's FIRST line names the first, so the chat update to the owner
  // raises it where the Queue draws it (a P0 rule). AFTER every monitor that marks a card stopping the owner's work fired — automation-held,
  // recipe-stopped — so the card it names is one already posted. Exit 1 still prints the whole document.
  { argv: ["queue", "stopping", "--json"], completedExits: [0, 1], format: "json", name: "queue-stopping" },
  // The organisation's incidents: the one live read writes the snapshot, then the monitor judges it and FIRES — one
  // note when an incident starts or its severity changes (`../../monitor/orgHealth.ts`). Adjacent, so the judged snapshot
  // is this tick's; a read that fails or is killed leaves it unmeasurable, never last tick's. Its note stacks in the
  // ordinary cascade beside fleet health's, newest in front; meeting prep's floats one level above both.
  { argv: ["org-health", "read", "--json"], format: "json", name: "org-health-read" },
  {
    argv: ["monitor", "check", "--only", "org-health", "--fire", "--by-session", "supervisor", "--json"],
    format: "json",
    name: "org-health",
    producer: "monitor check org-health",
  },
  // A running session the owner's profile never reached, FIRED: one quiet card the tick it is seen
  // (`../../monitor/profileUnloaded.ts`). From the CHAIR because the seat that failed may be on
  // a worktree too old to say so itself.
  {
    argv: ["monitor", "check", "--only", "profile-unloaded", "--fire", "--by-session", "supervisor", "--json"],
    format: "json",
    name: "profile-unloaded",
    producer: "monitor check profile-unloaded",
  },
  // A deliverable the owner explicitly steered now at risk, FIRED: one note per row the tick it is known, never at the
  // deadline (`../../monitor/steerAtRisk.ts`), and `tick close` refuses a tick that read one
  // with its note down (`../../cli/commands/supervisor/steerRiskRead.ts`).
  {
    argv: ["monitor", "check", "--only", "steer-at-risk", "--fire", "--by-session", "supervisor", "--json"],
    format: "json",
    name: "steer-at-risk",
    producer: "monitor check steer-at-risk",
  },
  // fseventsd past 2 GiB, FIRED: its restart goes on the owner's queue as a hand step, never while a voice call is live
  // (`../../monitor/fseventsdBloated.ts`). It raises no note, so its place among the fired monitors decides nothing the owner sees.
  {
    argv: ["monitor", "check", "--only", "fseventsd-bloated", "--fire", "--by-session", "supervisor", "--json"],
    format: "json",
    name: "fseventsd",
    producer: "monitor check fseventsd-bloated",
  },
  // A prep page tagged to a meeting starting within the hour, FIRED: its note floats above every other note with the
  // page as its Open button (`../../monitor/meetingPrepDue.ts`).
  {
    argv: ["monitor", "check", "--only", "meeting-prep-due", "--fire", "--by-session", "supervisor", "--json"],
    format: "json",
    name: "meeting-prep",
    producer: "monitor check meeting-prep-due",
  },
  // The owner's snoozes coming due: each lapsed one raises its step's note again (`../../cli/commands/hand/wake.ts`). AFTER
  // every fired monitor, because a woken note gives way to one already on screen and keeps its snooze for the next
  // tick, so nothing a monitor drew this tick is covered. Exit 3 is the quiet answer: no snooze has lapsed.
  {
    argv: ["hand", "wake", "--by-session", "supervisor", "--json"],
    completedExits: [0, 3],
    format: "json",
    name: "snooze-wake",
  },
  // Whether each Queue card is still the owner's: the console reads it with `reading last --producer "handover currency"`.
  // AFTER every fired monitor and `hand recheck`, so it reads the registers this tick's settles left, never the ones
  // they replaced.
  { argv: ["handover", "currency", "--json"], format: "json", name: "currency" },
  { argv: ["github", "hold", "--status"], format: "text", name: "hold" },
];
