/**
 * When the shell starts a recovery by itself, and the exact line it types to start one. Pure.
 *
 * ## One automatic attempt per episode, continued only past a deferral
 *
 * An EPISODE opens the first time the fleet reads `down` and closes the first time it reads `healthy` or `degraded`.
 * Inside one, the shell launches `fleet resume` by itself ONCE — never a retry on a timer. Whatever that attempt
 * could not do arrives as the page's reason and its one button, and a button press is the owner's, not the shell's.
 *
 * The one exception is an attempt that finished `deferred`: it stopped on purpose, with work left, because a seat
 * ahead of the rest had not settled yet (the supervisor still reading in, a seat held after a failed relaunch). That
 * is not a failure to retry but a recovery half done, so once no attempt is running the shell continues it — once per
 * deferred attempt, which the attempt id pins, and at most `MAX_LAUNCHES` launches in one episode, so a deferral that
 * repeats forever ends on the page's reason rather than in a loop. A `failed` or `hand-step` outcome is never
 * continued: those are the button's.
 *
 * A line the app typed that no finished attempt ever follows — the tab closed before the shell read it, or its pass
 * died mid-way — is typed again once nothing runs and the shell's two-minute pending bound has passed, inside the same
 * cap. A line the owner's button typed never is: it may be a sign-in waiting on the owner.
 *
 * The episode, its launch count and the deferral it continued are saved (`fleetProcess.ts`), so quitting and
 * reopening the app mid-episode buys no extra attempt.
 *
 * A launch that never reached cmux — macOS refused Automation, or cmux would not open — is not an attempt: no
 * recovery ran. The episode stays unlaunched, the shell's own reason replaces the fleet's (`withBridgeFailure`), and
 * its button clears the failure so the next reading launches.
 *
 * ## Every typed line is built here, from fixed parts
 *
 * The recovery runs in a visible cmux tab (AGENTS.md rule 2), so it starts by typing a line into a terminal. Every
 * part of that line is a constant, the checkout path (quoted), a minted episode id, an alias `fleetHealth.ts`
 * already refused unless it was a plain name, or a hatch from a closed set. Nothing a refusal printed is ever typed.
 */
import { type FleetAutomation, stepFleetAutomation } from "./fleetAutomationEpisode";
import type { AttemptOutcome, FleetHandStep, FleetHealth, FleetSeat } from "./fleetHealth";

/**
 * How long the fleet must read down before the stall note floats. MEASURED: the Slack loop swapping its listener
 * read down for 43s between one arm's disarm and the next arm's arming, and floated a note that was gone before the
 * owner had read it. Four half-minute readings, and the shell's own launch pending bound. Repro, the gap between a
 * `disarmed` line and the next `armed` line's `atIso`:
 * `grep -e '"kind":"disarmed"' -e '"kind":"armed"' "$SLOPWEAVER_HOME/live/listener/arms.jsonl"`.
 */
export const STALL_NOTE_HOLD_MS = 120_000;

/** What a down fleet has that `fleet resume` brings back: the console, the supervisor and worker sessions. */
interface RecoverableDown {
  readonly console: boolean;
  readonly supervisor: boolean;
  readonly workers: readonly FleetSeat[];
}

/**
 * Whether the supervisor is live: its own process runs with no login wall read, as the reading's seat says —
 * never inferred from its colour, which waits on a sign of work a hung cmux can keep from being recorded.
 *
 * @param health the reading
 * @returns true when the reading's supervisor seat is live
 */
export function chairLive({ health }: { health: Pick<FleetHealth, "seats"> }): boolean {
  return health.seats.some((seat) => seat.role === "supervisor" && seat.live);
}

/**
 * What is down that recovery can bring back. `fleet resume` restores the console, then the supervisor, then every
 * walled worker, and never touches the Slack loop or the credential keep-alive, so a red service is not on this list
 * — nor a seat it held as a crash loop, which it deliberately leaves for the supervisor.
 *
 * @param health a down reading
 * @returns the console flag and the down sessions, or `undefined` when nothing down is recovery's to move
 */
function recoverableDown({ health }: { health: FleetHealth }): RecoverableDown | undefined {
  const red = health.seats.filter((seat) => seat.colour === "red" && !seat.held);
  // With no supervisor pin recorded, `fleet resume` refuses before it touches the supervisor (`NO_CHAIR_PIN`).
  const chairMovable = health.reason.code !== "NO_CHAIR_PIN";
  const down = {
    console: health.console !== "serving",
    supervisor: chairMovable && red.some((seat) => seat.role === "supervisor"),
    workers: red.filter((seat) => seat.role === "worker"),
  };
  if (!down.console && !down.supervisor && down.workers.length === 0) {
    return undefined;
  }
  return down;
}

/** Who is down, as the object of a sentence, and whether it reads as more than one. */
function downSubject({ down }: { down: RecoverableDown }): { readonly words: string; readonly plural: boolean } {
  const parts: string[] = [];
  if (down.supervisor) {
    parts.push("the supervisor");
  }
  if (down.console) {
    parts.push("the console");
  }
  const [only] = down.workers;
  if (down.workers.length === 1 && only !== undefined) {
    parts.push(`the session on "${only.rowTitle}"`);
  } else if (down.workers.length > 1) {
    parts.push(`${String(down.workers.length)} sessions`);
  }
  const last = parts.pop()!;
  const words = parts.length === 0 ? last : `${parts.join(", ")} and ${last}`;
  return { plural: parts.length > 0 || down.workers.length > 1, words };
}

/**
 * A clock time in the owner's own words, `h:mm am/pm`. Always a clock time, never an age: an unchanged reading then
 * draws an identical note, so a poll never reloads it and closes a fold the owner opened.
 *
 * @param ms the instant
 * @param timeZone the zone to read it in; the machine's own when undefined
 * @returns the time of day
 */
export function clockTime({ ms, timeZone }: { ms: number; timeZone: string | undefined }): string {
  return new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(ms);
}

/** How a finished attempt ended, as the end of "The last recovery attempt ended …". */
const OUTCOME_WORDS: Readonly<Record<AttemptOutcome, string>> = {
  deferred: "by putting itself off",
  failed: "in a failure",
  "hand-step": "on a step only you can take",
  healthy: "saying all was well",
};

/**
 * What recovery did in this episode, only as far as the journal shows it. Three measured states, and a fourth for a
 * launch never made: an attempt of this episode FINISHED, one STARTED and recorded no end, or lines were typed and
 * no attempt recorded starting at all. MEASURED: the note said "recovery could not bring it back" over
 * an episode whose four typed launches journalled no `attempt-started`, and over a supervisor that was working. Repro:
 * `grep attempt-started "$SLOPWEAVER_HOME/fleet/resume.jsonl" | tail -3` against the app's `fleet.json` episode id.
 *
 * @param health the reading, for the newest started and finished attempts
 * @param automation the open episode, for its id and how many lines it typed
 * @param plural whether what reads down is more than one thing
 * @param unsaved the last automatic launch was held back because its memory could not be saved
 * @returns one sentence
 */
export function recoveryDetail({
  health,
  automation,
  plural,
  unsaved,
}: {
  health: Pick<FleetHealth, "lastAttempt" | "newestAttempt">;
  automation: FleetAutomation;
  plural: boolean;
  unsaved: boolean;
}): string {
  if (unsaved) {
    return "Recovery will not start by itself, because it could not save its progress.";
  }
  const episodeId = automation.episodeId;
  const reads = plural ? "they still read" : "it still reads";
  const { lastAttempt: last, newestAttempt: newest } = health;
  // The newest attempt decides, because an older finished one is not how recovery LAST ended while a newer one is
  // still open.
  if (episodeId !== null && newest?.episodeId === episodeId) {
    if (!newest.finished) {
      return "A recovery attempt started and has not recorded how it ended.";
    }
    if (last?.attemptId === newest.attemptId && last.episodeId === episodeId) {
      return `The last recovery attempt ended ${OUTCOME_WORDS[last.outcome]}, and ${reads} down.`;
    }
    // Finished with no outcome to name is a document the CLI does not print, but the parser accepts it, so the words
    // still say only what it carries.
    return `A recovery attempt finished, and ${reads} down.`;
  }
  // The newest attempt is another episode's, so this episode's finished one is not called the last.
  if (episodeId !== null && last?.episodeId === episodeId) {
    return `A recovery attempt ended ${OUTCOME_WORDS[last.outcome]}, and ${reads} down.`;
  }
  const times = automation.launches === 1 ? "once" : `${String(automation.launches)} times`;
  return `Recovery was sent to cmux ${times}, and no attempt has recorded starting.`;
}

/**
 * The stall note's words: what Slopweaver reads as down and since when it first read so, what recovery did, whether
 * the fleet is off the air, and whether Slack is still answered. It says what was READ, never that something IS
 * down: the first reading is when the app saw it, not when it broke, and a reading can be wrong. The button and the command under it are drawn by the note itself, and why it reads this
 * way sits under its fold (`fleetPage.ts`).
 *
 * @param down what recovery could not bring back
 * @param health the reading, for the Slack loop's seat
 * @param downSinceMs when the shell first read the fleet down
 * @param timeZone the zone the time is read in; the machine's own when undefined
 * @param recovery what recovery did, from {@link recoveryDetail}
 * @returns the note
 */
function stallNote({
  down,
  health,
  downSinceMs,
  timeZone,
  recovery,
}: {
  down: RecoverableDown;
  health: FleetHealth;
  downSinceMs: number | undefined;
  timeZone: string | undefined;
  recovery: string;
}): string {
  // A console that could not be checked is said to be unchecked, never down.
  const unmeasured = down.console && health.console === "unmeasured";
  const named: RecoverableDown = unmeasured ? { ...down, console: false } : down;
  const read: string[] = [];
  if (named.supervisor || named.console || named.workers.length > 0) {
    read.push(`Slopweaver reads ${downSubject({ down: named }).words} as down.`);
  }
  if (unmeasured) {
    read.push("Slopweaver could not check the console.");
  }
  // The instant belongs to the FLEET, never to what reads down now: the episode keeps it while the seat that is down
  // changes.
  if (downSinceMs !== undefined) {
    read.push(
      `It first read the fleet down at ${clockTime({ ms: downSinceMs, timeZone })} and has not read it recovered since.`,
    );
  }
  const what = read.join(" ");
  // Only a supervisor reading red, or none at all, reaches here (`withStalledRecovery`), so the note never calls the
  // supervisor up, and says what its row on the page says.
  const chair = health.seats.find((seat) => seat.role === "supervisor");
  const air =
    chair === undefined
      ? "No supervisor is pinned, so nothing is being supervised."
      : "Nothing is being supervised until the supervisor is back.";
  const loop = health.seats.find((seat) => seat.role === "loop");
  let slack = "";
  if (loop?.colour === "red") {
    slack = " Slack tags are not being answered either.";
  } else if (loop !== undefined) {
    slack = " Slack tags are still being answered.";
  }
  return `${what} ${recovery} ${air}${slack}`;
}

/**
 * The health the page shows once recovery has stopped by itself with the fleet still down and no step of the
 * fleet's own to offer: the cap spent on lines that finished nothing, or an attempt that finished without bringing it
 * back. Then the one button starts recovery again, so a down episode recovery can move never ends with neither a
 * launch nor a button while no supervisor is live to move it instead. It is the owner's press, counted like any other. The same button stands
 * when the app could not save its memory: an automatic launch whose count cannot reach the disk is never typed, so
 * without the button a fleet on an unwritable memory would have neither.
 *
 * The button is offered only when something down is recovery's to bring back. MEASURED: with only the
 * Slack loop down mid-swap, an attempt finished `healthy` in under a second having done nothing (`fleet/resume.jsonl`)
 * and the note offered the owner a button that could not have helped. A
 * loop off the air is `bot-off-the-air`'s card (skills/monitor/reference/the-monitors.md).
 *
 * The button is never offered while the supervisor is LIVE — its own process running with no login wall read —
 * whatever its colour, however many launches the episode spent and however its last attempt ended: the live chair is
 * the fleet's recovery, and the episode's history is not a reading of it. MEASURED: one episode spent
 * four launches, each attempt deferred on CHAIR_REORIENTATION_TIMEOUT over a chair that was running and answering
 * the owner, and the note asked them to press "Start recovery again" while it did. The note is never put in front of
 * the owner then, and the page never contradicts itself about whether the fleet is down. Repro:
 * `grep CHAIR_REORIENTATION_TIMEOUT "$SLOPWEAVER_HOME/fleet/resume.jsonl"`.
 *
 * @param health the health about to be shown
 * @param automation the open episode
 * @param pending a line the shell typed is still awaiting its attempt
 * @param unsaved the last automatic launch was held back because its memory could not be saved
 * @param downSinceMs when the shell first read this episode down, for the note's "since"
 * @param timeZone the zone the note's time is read in; the machine's own when undefined
 * @returns the health, with the button when recovery has stalled on something it can move
 */
export function withStalledRecovery({
  health,
  automation,
  pending,
  unsaved,
  downSinceMs,
  timeZone,
}: {
  health: FleetHealth;
  automation: FleetAutomation;
  pending: boolean;
  unsaved: boolean;
  downSinceMs: number | undefined;
  timeZone: string | undefined;
}): FleetHealth {
  // A supervisor reading anything but red is not down either: this CLI marks every such one live or an attempt
  // running, but the shell reads `fleet health` from the main checkout, which can predate the `live` mark.
  const chairUp = health.seats.some((seat) => seat.role === "supervisor" && seat.colour !== "red");
  const offerable =
    health.state === "down" &&
    health.recoveryPhase === undefined &&
    health.reason.handStep === undefined &&
    !pending &&
    !chairLive({ health }) &&
    !chairUp;
  const down = offerable ? recoverableDown({ health }) : undefined;
  if (down === undefined) {
    return health;
  }
  const { plural } = downSubject({ down });
  if (unsaved) {
    const recovery = recoveryDetail({ automation, health, plural, unsaved: true });
    return withResumeButton({
      health,
      id: "resume-unsaved",
      note: stallNote({ down, downSinceMs, health, recovery, timeZone }),
      recovery,
    });
  }
  const stalled =
    automation.episodeId !== null &&
    automation.launches > 0 &&
    !stepFleetAutomation({ automation, blocked: false, mint: () => automation.episodeId!, reading: health }).launch;
  if (!stalled) {
    return health;
  }
  const recovery = recoveryDetail({ automation, health, plural, unsaved: false });
  return withResumeButton({
    health,
    id: `resume-${String(automation.launches)}`,
    note: stallNote({ down, downSinceMs, health, recovery, timeZone }),
    recovery,
  });
}

/** The health with the one "Start recovery again" button, carrying what recovery did for the note's fold. */
function withResumeButton({
  health,
  id,
  note,
  recovery,
}: {
  health: FleetHealth;
  id: string;
  note: string;
  recovery: string;
}): FleetHealth {
  return {
    ...health,
    reason: {
      ...health.reason,
      handStep: { action: { kind: "resume" }, id, label: "Start recovery again", note, recoveryDetail: recovery },
    },
  };
}

/**
 * Whether the floating note for a step waits: the shell's own "Start recovery again" stays off the owner's screen until
 * the fleet has read down for {@link STALL_NOTE_HOLD_MS}, so a swap or a recovery that settles by itself never reaches
 * them. The Sessions page shows the button at once — the owner opens that page themselves. Every other step is the
 * owner's alone and never settles on its own, so it is never held.
 *
 * @param step the step the note would show
 * @param downSinceMs when the shell first read this episode down
 * @param nowMs the time of the reading
 * @returns true while the note must not float
 */
export function stallNoteHeld({
  step,
  downSinceMs,
  nowMs,
}: {
  step: FleetHandStep;
  downSinceMs: number | undefined;
  nowMs: number;
}): boolean {
  if (step.action.kind !== "resume") {
    return false;
  }
  return downSinceMs === undefined || nowMs - downSinceMs < STALL_NOTE_HOLD_MS;
}

/**
 * When this episode first read down, carried from one reading to the next: set on the first `down`, kept while it
 * is down or an attempt is recovering it, and cleared once the fleet reads healthy or degraded.
 *
 * @param before what the last reading left
 * @param state this reading's state
 * @param nowMs the time of this reading
 * @returns the instant to carry forward
 */
export function nextDownSince({
  before,
  state,
  nowMs,
}: {
  before: number | undefined;
  state: FleetHealth["state"];
  nowMs: number;
}): number | undefined {
  if (state === "healthy" || state === "degraded") {
    return undefined;
  }
  if (before === undefined && state === "down") {
    return nowMs;
  }
  return before;
}
