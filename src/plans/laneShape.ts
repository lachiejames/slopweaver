/**
 * THE LANE SHAPE — whether each provider's lane is still filling its prepaid plans, or has switched to the lean shape
 * because only one of its plans still stands.
 *
 * ## The owner's ruling this carries
 *
 * Fill capacity while the plans last, and save capacity once one plan is left: "keep capacity-maxxing for as long
 * as we have these plans, then use capacity saving tactics when on 1 plan". So each lane (Claude, Codex) switches on
 * its OWN count, the day its second-to-last plan stops standing, and nothing switches before then. The supervisor is
 * the first consumer: on a lean Claude lane its chair moves off the top model onto Opus and stops re-arming a timer
 * sweep (`../supervisor/chairPolicy.ts`, AGENTS.md rule 5).
 *
 * ## What "standing" means, exactly
 *
 * A plan stands when it is not paused and its recorded lapse (`RegisteredPlan.lapsesAtIso`, written by `plans
 * lapse`) is absent or strictly after now. An ABSENT lapse stands: nobody wrote the end down, and guessing one into
 * the past would switch a lane on no evidence. A lapse exactly at now has ended.
 *
 * Four modes, not two. Zero is not one: with rows registered and none standing there is no lean Claude chair to run,
 * and reading `0 <= 1` as lean would seat Opus on a plan that does not exist. And NO ROW AT ALL is not zero: an
 * install that never registered a plan has measured nothing, so it reads `unregistered` and every consumer keeps
 * today's fill behaviour on it, exactly as on an unreadable register.
 *
 * Pure: the register's rows and an instant in, a verdict per provider out.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import type { PlanProvider, RegisteredPlan } from "./types.js";

/**
 * Every mode a lane can be in, in the order a reader escalates through them. `fill`: two or more plans stand.
 * `lean`: exactly one. `unavailable`: rows are registered and none stands. `unregistered`: the lane has no row at
 * all, so nothing was measured.
 */
type LaneMode = "fill" | "lean" | "unavailable" | "unregistered";

/** One provider's lane, with the counts that decided it. */
export interface PlanLaneShape {
  /** The model host whose lane this is. */
  readonly host: PlanProvider;
  readonly mode: LaneMode;
  /** Plans not paused whose lapse is unrecorded or still ahead. */
  readonly standingPlans: number;
  readonly pausedPlans: number;
  /** Plans not paused whose recorded lapse is at or before the observation instant. */
  readonly lapsedPlans: number;
  /** Standing plans whose lapse nobody recorded — counted as standing, never guessed. */
  readonly unrecordedLapses: number;
}

/** Both lanes, judged at one instant. */
export interface LaneShapes {
  readonly observedAtIso: string;
  readonly claude: PlanLaneShape;
  readonly codex: PlanLaneShape;
}

/**
 * What a consumer is handed: the judged lanes, or why the register could not be judged. An unreadable register is
 * its own arm so every consumer keeps today's fill behaviour on it and says why, rather than switching on silence.
 */
export type LaneShapeRead =
  { readonly kind: "current"; readonly shapes: LaneShapes } | { readonly kind: "unreadable"; readonly why: string };

/**
 * The mode a count of standing plans puts a lane in.
 *
 * @param standing how many of the lane's plans stand
 * @param registered how many rows the lane has at all, standing or not
 * @returns unregistered with no row, else fill at two or more standing, lean at one, unavailable at none
 */
function modeFor({ standing, registered }: { standing: number; registered: number }): LaneMode {
  if (registered === 0) {
    return "unregistered";
  }
  if (standing >= 2) {
    return "fill";
  }
  if (standing === 1) {
    return "lean";
  }
  return "unavailable";
}

/**
 * Judge one model host's lane from its rows.
 *
 * @param rows the register rows already read, every host
 * @param host which lane to judge
 * @param nowMs the observation instant, epoch milliseconds
 * @returns the lane, or the alias of the first row whose recorded lapse would not parse
 */
function judgeLane({
  rows,
  host,
  nowMs,
}: {
  rows: readonly RegisteredPlan[];
  host: PlanProvider;
  nowMs: number;
}): Result<PlanLaneShape> {
  let standingPlans = 0;
  let pausedPlans = 0;
  let lapsedPlans = 0;
  let unrecordedLapses = 0;
  const laneRows = rows.filter((row) => row.provider === host);
  for (const plan of laneRows) {
    if (plan.paused !== undefined) {
      pausedPlans += 1;
      continue;
    }
    if (plan.lapsesAtIso === undefined) {
      standingPlans += 1;
      unrecordedLapses += 1;
      continue;
    }
    const lapseMs = parseStrictIsoInstantMs({ text: plan.lapsesAtIso });
    if (lapseMs === undefined) {
      return err([`${host} plan ${plan.alias}'s recorded lapse ${plan.lapsesAtIso} is not an ISO-8601 instant`]);
    }
    if (lapseMs > nowMs) {
      standingPlans += 1;
    } else {
      lapsedPlans += 1;
    }
  }
  return ok({
    host,
    lapsedPlans,
    mode: modeFor({ registered: laneRows.length, standing: standingPlans }),
    pausedPlans,
    standingPlans,
    unrecordedLapses,
  });
}

/**
 * Judge both lanes at one instant.
 *
 * @param plans the plan register's rows
 * @param nowIso the observation instant
 * @returns each provider's lane, or why it could not be judged: an unparseable instant or recorded lapse
 */
export function judgeLaneShapes({
  plans,
  nowIso,
}: {
  plans: readonly RegisteredPlan[];
  nowIso: string;
}): Result<LaneShapes> {
  const nowMs = parseStrictIsoInstantMs({ text: nowIso });
  if (nowMs === undefined) {
    return err([`the observation instant ${nowIso} is not an ISO-8601 instant`]);
  }
  return judgeLane({ host: "claude", nowMs, rows: plans }).andThen((claude) =>
    judgeLane({ host: "codex", nowMs, rows: plans }).map((codex) => ({ claude, codex, observedAtIso: nowIso })),
  );
}

/**
 * Judge both lanes into the arm every consumer is handed, a register that will not judge becoming `unreadable`.
 *
 * @param plans the plan register's rows
 * @param nowIso the observation instant
 * @returns the current lanes, or why they could not be judged
 */
export function laneShapeReadOf({
  plans,
  nowIso,
}: {
  plans: readonly RegisteredPlan[];
  nowIso: string;
}): LaneShapeRead {
  const judged = judgeLaneShapes({ nowIso, plans });
  if (judged.isErr()) {
    return { kind: "unreadable", why: `the plan register could not be judged (${judged.error.join("; ")})` };
  }
  return { kind: "current", shapes: judged.value };
}

/** Whether the supervisor still owes filling idle capacity this tick, and why not when it does not. */
export type CapacityObligation = { readonly kind: "owed" } | { readonly kind: "not-owed"; readonly why: string };

/**
 * Whether filling idle capacity is still owed: "keep capacity-maxxing for as long as we have these plans".
 *
 * Owed while EITHER lane is still filling, because a seat can run on whichever host still has plans to spend. A lane
 * with no row at all is UNMEASURED, never absent: a host can run here on an ambient sign-in the register never
 * recorded, so a missing row owes exactly as a filling one does. Owed on every read that measured nothing (no
 * read, an unreadable register), so a register nobody wrote never quietly switches the fill gate off. Not owed
 * only when BOTH lanes are recorded and each is lean or unavailable — then a seat running unasked spends the last
 * plan's allowance, which is the saving the ruling asks for.
 *
 * @param lanes the judged lanes, or undefined when nothing read them
 * @returns owed, or not-owed naming each lane's mode
 */
export function capacityObligation({ lanes }: { lanes: LaneShapeRead | undefined }): CapacityObligation {
  if (lanes === undefined || lanes.kind === "unreadable") {
    return { kind: "owed" };
  }
  const { claude, codex } = lanes.shapes;
  if ([claude, codex].some((lane) => lane.mode === "fill" || lane.mode === "unregistered")) {
    return { kind: "owed" };
  }
  return {
    kind: "not-owed",
    why: `no lane is filling (claude ${claude.mode}, codex ${codex.mode}), so idle capacity is saved rather than filled`,
  };
}

/**
 * The one line a reader sees for a lane, as `plans list` and the supervisor's notes print it.
 *
 * @param lane the judged lane
 * @returns `<host> lane: <mode> — <n> standing` with paused, lapsed and unrecorded counts when nonzero
 */
export function laneShapeLine({ lane }: { lane: PlanLaneShape }): string {
  const extras: string[] = [];
  if (lane.unrecordedLapses > 0) {
    extras.push(`${String(lane.unrecordedLapses)} with no recorded lapse`);
  }
  if (lane.pausedPlans > 0) {
    extras.push(`${String(lane.pausedPlans)} paused`);
  }
  if (lane.lapsedPlans > 0) {
    extras.push(`${String(lane.lapsedPlans)} lapsed`);
  }
  const tail = extras.length === 0 ? "" : ` (${extras.join(", ")})`;
  return `${lane.host} lane: ${lane.mode} — ${String(lane.standingPlans)} standing${tail}`;
}
