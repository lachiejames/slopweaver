/**
 * `fleet-unhealthy` — the one verdict over the whole fleet's health: automations failing above a share,
 * scheduled runs dying mid-run, and the Slack listener off the air.
 *
 * The owner expects a floating note when syncs are failing across the fleet or the bot is unhealthy: those are
 * escalated to them. On a day when ten corpus seats died mid-run and nine atlas rows exited 1, nothing reached the
 * owner: every piece of that picture was on disk, but no one reading turned it into one sentence, and nothing ran
 * the monitor pass that would have drawn it.
 *
 * ## ONE card, keyed by WHICH signals trip, never by counts
 *
 * The subject is the whole condition. Its key is the tripped signals in a fixed order (`syncs`, `deaths`, `bot`),
 * so the card stands unchanged while the same signals do, is re-cut when the set changes, and settles by the lane's
 * own departure when the fleet recovers. A count in the key would re-cut the card every tick a single run settled.
 *
 * ## A note goes up on a CHANGE, never because the last one was dismissed
 *
 * The owner's Done settles the card, so the lane alone would re-post an identical one the very next tick — ten of
 * them in one morning. So the subject carries what changed since the last note, its rows behind the note's
 * disclosure row, and a `delivery` saying whether this pass shows it at all (`./fleetHealthDelta.ts`).
 *
 * How one attempt counts — and why every attempt in the window counts, not each row's newest — is
 * `./fleetHealthAttempts.ts`'s. Pure: attempts, a clock and the listener's own reading in, a monitor reading out.
 */
import type { Result } from "#lib/result.js";

import type { ListenerStateError } from "../live/listen/supervise/errors.js";
import type { ListenerHeartbeat } from "../live/listen/supervise/heartbeat.js";
import type { ListenerArm } from "../live/listen/supervise/liveness.js";

import { attemptFate, FLEET_HEALTH_WINDOW_MS, failingRows, type ProbedAttempt } from "./fleetHealthAttempts.js";
import {
  deltaClause,
  detailsOnTheNote,
  fleetHealthDelta,
  fleetHealthLines,
  fleetHealthPacing,
  yoursEntry,
} from "./fleetHealthDelta.js";
import type { RowFate } from "./fleetHealthFate.js";
import type { FleetHealthDelta, FleetHealthShown, MonitorReading, MonitorSubject } from "./types.js";

/** The failing share at which `syncs` trips — windows 1, 2, 4 and 6 in the table above, and no quieter one. */
const FAILING_SHARE_TRIP = 0.25;

/** The fewest failing runs `syncs` trips on, so one failure out of two on a quiet day is not a fleet outage. */
const FAILING_MIN = 3;

/** The fewest mid-run deaths `deaths` trips on: at one it tripped every day in the table, at two on windows 2 and 6 only. */
export const DEATHS_MIN = 2;

/** One thing that can be wrong with the fleet, in the order the key and the sentence name them. */
export type FleetSignal = "syncs" | "deaths" | "bot";

/**
 * The note's line for a listener never armed on this install — informational, never a blind spot. It sits at the
 * foot of the Details, kept past the cap's `+N more` line so a long fleet never hides it. It states only the three
 * present absences, never a history: a launch that failed before registering, an unsupervised listener (which
 * answers tags and writes none of the three) and an arm whose journal appends were lost all look the same, so it
 * claims no history, no intent and nothing about what a tag does.
 */
export const NEVER_ARMED_LINE =
  "INFO  no listener arm record, no heartbeat and an empty arm journal on this install, so bot-off-the-air has nothing to judge";

/** Every signal, in key order. */
const FLEET_SIGNALS: readonly FleetSignal[] = ["syncs", "deaths", "bot"];

/** The window's tally: how many succeeded, and which rows failed or died (one entry per attempt). */
export interface FleetTally {
  readonly succeeded: number;
  readonly failing: readonly string[];
  readonly died: readonly string[];
}

/**
 * Tally every attempt started inside the window.
 *
 * @param attempts every stored attempt, probed
 * @param nowIso the end of the window
 * @returns the tally
 */
export function tallyAttempts({
  attempts,
  nowIso,
}: {
  attempts: readonly ProbedAttempt[];
  nowIso: string;
}): FleetTally {
  const since = Date.parse(nowIso) - FLEET_HEALTH_WINDOW_MS;
  let succeeded = 0;
  const failing: string[] = [];
  const died: string[] = [];
  for (const probed of attempts) {
    if (Date.parse(probed.attempt.startedAtIso) < since) {
      continue;
    }
    const fate = attemptFate({ nowIso, probed });
    if (fate === "succeeded") {
      succeeded += 1;
    } else if (fate === "failing") {
      failing.push(probed.attempt.recipeId);
    } else if (fate === "died") {
      died.push(probed.attempt.recipeId);
    }
  }
  return { died, failing, succeeded };
}

/**
 * Which signals a tally and the listener's reading trip, in key order.
 *
 * A failing share counts deaths as failures too — a run that died did not sync — while `deaths` trips on its own,
 * because a death is a class the owner named and writes no failure record anywhere else.
 *
 * @param tally the window's tally
 * @param botDown whether `bot-off-the-air` reads firing
 * @returns the tripped signals, in {@link FLEET_SIGNALS} order
 */
export function trippedSignals({ tally, botDown }: { tally: FleetTally; botDown: boolean }): readonly FleetSignal[] {
  const failing = tally.failing.length + tally.died.length;
  const total = tally.succeeded + failing;
  const tripped = new Set<FleetSignal>();
  if (failing >= FAILING_MIN && failing / total >= FAILING_SHARE_TRIP) {
    tripped.add("syncs");
  }
  if (tally.died.length >= DEATHS_MIN) {
    tripped.add("deaths");
  }
  if (botDown) {
    tripped.add("bot");
  }
  return FLEET_SIGNALS.filter((signal) => tripped.has(signal));
}

/**
 * The signals a subject key names — the inverse of the key {@link evaluateFleetUnhealthy} mints.
 *
 * @param key a `fleet-unhealthy` subject key
 * @returns the signals it names, in key order
 */
export function signalsOfKey({ key }: { key: string }): readonly FleetSignal[] {
  const named = new Set(key.split("-"));
  return FLEET_SIGNALS.filter((signal) => named.has(signal));
}

/**
 * The card's one sentence — the owner's action, never the fleet's — leading with what CHANGED since the last note.
 *
 * With the bot off the air the step is the owner's (rule 2: only the owner seats a visible bot session); without it
 * the fleet is already failing forward and the owner checks. Neither names the fleet or the bot as an actor, which the hand register
 * refuses (`../hand/step.ts` § FLEET_ACTOR). A card only goes up on a change (`./fleetHealthDelta.ts`), so the
 * delta's counts are true for as long as it stands; without a delta the sentence depends on the signal set alone.
 *
 * @param signals the tripped signals
 * @param delta what changed since the last note, when the subject carries one
 * @returns the sentence
 */
export function fleetHealthWhat({
  signals,
  delta,
}: {
  signals: readonly FleetSignal[];
  delta?: FleetHealthDelta | undefined;
}): string {
  const syncs = signals.includes("syncs");
  const deaths = signals.includes("deaths");
  const changed = delta === undefined ? "" : deltaClause({ delta });
  if (signals.includes("bot")) {
    if (changed !== "") {
      return `Seat a visible bot session — it is off Slack; ${changed}`;
    }
    return `Seat a visible bot session — it is off Slack${botJobsClause({ deaths, syncs })}`;
  }
  if (delta?.bot === "back") {
    return `Check fleet health — the bot is back on Slack${changed === "" ? "" : `; ${changed}`}`;
  }
  if (changed !== "") {
    return `Check fleet health — ${changed}`;
  }
  if (syncs && deaths) {
    return "Check fleet health — scheduled jobs are failing and syncs are dying mid-run";
  }
  if (deaths) {
    return "Check fleet health — syncs are dying mid-run";
  }
  return "Check fleet health — scheduled jobs are failing";
}

/** The trailing clause the bot sentence carries for the job signals beside it. */
function botJobsClause({ syncs, deaths }: { syncs: boolean; deaths: boolean }): string {
  if (syncs && deaths) {
    return ", and scheduled jobs are failing and dying mid-run";
  }
  if (syncs) {
    return ", and scheduled jobs are failing";
  }
  if (deaths) {
    return ", and scheduled jobs are dying mid-run";
  }
  return "";
}

/**
 * Whether no supervised listener was ever armed on this install — the `listen status` grade `unarmed`, no beat
 * written, and an arm journal with not one byte in it. All three reads must SUCCEED: a file that would not read is a
 * listener nobody could judge, which stays a blind spot. The journal is what separates this from a supervised
 * listener that armed, died and was cleared before its first beat landed — both current files absent, but journalled
 * lines behind them. It is measured in raw BYTES, never decoded events or trimmed lines: the event reader drops a
 * torn or unknown line, trimming drops a BOM or stray whitespace, and any byte at all is something a writer put there.
 *
 * @param arm the current arm record's read
 * @param heartbeat the heartbeat's read
 * @param journalBytes how many bytes the append-only arm journal holds, 0 when it is absent
 * @returns true only when all three read, both files are absent and the journal holds no byte at all
 */
export function listenerNeverArmed({
  arm,
  heartbeat,
  journalBytes,
}: {
  arm: Result<ListenerArm | undefined, ListenerStateError>;
  heartbeat: Result<ListenerHeartbeat | undefined, ListenerStateError>;
  journalBytes: Result<number>;
}): boolean {
  const nothingJournalled = journalBytes.isOk() && journalBytes.value === 0;
  return (
    arm.isOk() && arm.value === undefined && heartbeat.isOk() && heartbeat.value === undefined && nothingJournalled
  );
}

/** Everything the verdict reads, apart from the clock. */
export interface FleetHealthInputs {
  readonly attempts: readonly ProbedAttempt[];
  /** `bot-off-the-air`'s own reading off the listener heartbeat. */
  readonly bot: MonitorReading;
  /**
   * Whether no supervised listener was ever armed on this install, as {@link listenerNeverArmed} judges it: arm
   * record, heartbeat and arm journal all read, both files absent and the journal holding no byte. Never true when any of the
   * three failed to read, which stays a blind spot.
   */
  readonly listenerNeverArmed: boolean;
  /** How many of the failing or dying rows a seat has taken the repair of — what is being done. */
  readonly repairing: number;
  /**
   * What the fleet is doing about each failing row, by recipe id — its sign-in step, its repair, its failure hold or
   * its next slot — which its line says instead of restating the exit code (`./fleetHealthFate.ts` § RowFate).
   */
  readonly fates: ReadonlyMap<string, RowFate>;
  /** Why part of the ledger did not read, when it did not. */
  readonly blindSpot: string | undefined;
  /** What the last note showed, or `undefined` when none is remembered — every failing row is then news. */
  readonly shown: FleetHealthShown | undefined;
  /** Whether the last note is still on the owner's screen — its card open AND its panel up, never put away with Later. */
  readonly noteUp: boolean;
}

/**
 * The `fleet-unhealthy` reading.
 *
 * An unmeasurable listener is NOT a tripped bot and never blinds the job signals. A NEVER-ARMED one — no arm record,
 * no heartbeat and an empty arm journal, all read — is no blind spot either: no supervised listener ever registered to be
 * judged, so it is one informational line at the foot of the note ({@link NEVER_ARMED_LINE}) and the note posts. Any
 * other unmeasurable listener (a file or journal that would not read, an arm with no beat, a journalled listener cleared
 * before its first beat) is reported beside the signals as a blind spot, which the pass refuses on (`./pass.ts`).
 *
 * Whether the card goes up this pass is the delta's and the pacing's (`./fleetHealthDelta.ts`), carried on the
 * subject as its `delivery`: `recut` when there is news to show — a fresh note even over an open card — and `hold`
 * otherwise, which leaves an open card standing and posts nothing after the owner's Done. `tick close`'s gate rehearses this
 * same pass, so a held card is one it does not ask for (`../supervisor/fleetHealthGate.ts`).
 *
 * @param inputs the attempts, the listener's reading, the repairs in hand, any blind spot and the last note
 * @param nowIso the end of the window
 * @returns firing with ONE subject naming what changed, what is failing and what is being done, or clear
 */
export function evaluateFleetUnhealthy({
  inputs,
  nowIso,
}: {
  inputs: FleetHealthInputs;
  nowIso: string;
}): MonitorReading {
  const tally = tallyAttempts({ attempts: inputs.attempts, nowIso });
  const botDown = inputs.bot.state === "firing";
  const signals = trippedSignals({ botDown, tally });
  const neverArmed = inputs.bot.state === "unmeasurable" && inputs.listenerNeverArmed;
  const blindSpots = [
    ...(inputs.blindSpot === undefined ? [] : [inputs.blindSpot]),
    ...(inputs.bot.state === "unmeasurable" && !neverArmed
      ? [`the listener could not be judged: ${inputs.bot.because}`]
      : []),
  ];
  if (signals.length === 0) {
    return { monitorId: "fleet-unhealthy", state: "clear" };
  }
  const rows = failingRows({ attempts: inputs.attempts, nowIso });
  const broken = rows.filter((row) => row.state === "failing").map((row) => row.recipeId);
  const jobSignals = signals.filter((signal) => signal !== "bot");
  const yours = [...inputs.fates]
    .flatMap(([recipeId, fate]) => (fate.kind === "needs-you" ? [yoursEntry({ card: fate.step.card, recipeId })] : []))
    .toSorted();
  const delta = fleetHealthDelta({
    botDown,
    broken,
    noteUp: inputs.noteUp,
    shown: inputs.shown,
    signals: jobSignals,
    yours,
  });
  const pacing = fleetHealthPacing({ delta, nowIso, shown: inputs.shown });
  const botLine = inputs.bot.state === "firing" ? inputs.bot.subjects.map((one) => one.label).join("; ") : undefined;
  const lines = fleetHealthLines({ botLine, delta, fates: inputs.fates, nowIso, rows });
  const trailing = neverArmed ? [NEVER_ARMED_LINE] : [];
  const subject: MonitorSubject = {
    ...(botDown ? {} : { checkIn: true as const }),
    delivery: pacing.kind === "show" ? { kind: "recut" } : { kind: "hold", why: pacing.why },
    details: detailsOnTheNote({ lines, trailing }),
    detailsInFull: [...lines, ...trailing],
    fleet: { delta, shown: { botDown, broken: broken.toSorted(), shownIso: nowIso, signals: jobSignals, yours } },
    id: "fleet health",
    key: signals.join("-"),
    label: fleetLabel({ nowIso, repairing: inputs.repairing, tally }),
  };
  return {
    ...(blindSpots.length === 0 ? {} : { blindSpot: blindSpots.join("; ") }),
    monitorId: "fleet-unhealthy",
    state: "firing",
    subjects: [subject],
  };
}

/**
 * The subject's label, the note's footer: the numbers as of now, what is being done, and what Done and Later mean.
 * The rows themselves are behind the note's disclosure row, not here — `unblocks` is capped, and a list cut at a
 * cap reads whole when it is not.
 */
function fleetLabel({ tally, repairing, nowIso }: { tally: FleetTally; repairing: number; nowIso: string }): string {
  const failing = tally.failing.length + tally.died.length;
  const total = tally.succeeded + failing;
  return [
    `as of ${nowIso.slice(11, 16)}Z, ${String(failing)} of ${String(total)} scheduled runs in 24h failed, ${String(tally.died.length)} died mid-run`,
    repairingClause({ repairing }),
    "Done or Later: the next note comes only when something changes",
  ].join("; ");
}

/** What is being done about the failing rows, in one clause. */
function repairingClause({ repairing }: { repairing: number }): string {
  if (repairing === 0) {
    return "no seat has a repair yet";
  }
  return `${String(repairing)} in repair by a seat`;
}
