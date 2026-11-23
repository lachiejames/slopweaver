/**
 * The three documents the Fleet page's glance reads beyond the seats and the board: the Claude and Codex plans'
 * ceilings inside `machine capacity` (`src/capacity/ceilings.ts`'s `CeilingsReading`), `fleet ceiling`'s
 * working-seat ceiling (`src/capacity/seatCeiling.ts`'s `WorkingSeatCeiling`), and `fleet why`'s sentences
 * (`src/capacity/fleetWhy.ts`). All three are recorded by the supervisor tick.
 */
import { type Bag, bags, every, isBag, nullableNum, nullableStr, num, str, strings, sub } from "../../lib/bag";
import type { SeatCeiling } from "../../lib/fleetGlance";
import {
  GLANCE_STATUSES,
  type GlancePause,
  type GlancePausedWeek,
  type GlancePlan,
  type GlancePlans,
  type GlanceStatus,
  type GlanceWindow,
} from "../../lib/fleetGlancePlans";
import { type Reading, readingOf } from "./reading";

/**
 * One ceiling window.
 *
 * @returns the window, or `undefined` when a field will not read
 */
function windowOf(bag: Bag): GlanceWindow | undefined {
  const window = str({ bag, key: "window" });
  const used = num({ bag, key: "used" });
  const available = num({ bag, key: "available" });
  const resetAtIso = nullableStr({ bag, key: "resetAtIso" });
  if (window === undefined || used === undefined || available === undefined || resetAtIso === false) {
    return undefined;
  }
  return { available, resetAtIso, used, window };
}

/**
 * A field a newer capture carries and an older one lacks: its value or `null` as `undefined`, a MISSING key as
 * `undefined` too, and any other type as `false`, so a malformed capture still refuses rather than reading blank.
 *
 * @returns the value, `undefined`, or `false`
 */
function laterField<T>({
  bag,
  key,
  read,
}: {
  bag: Bag;
  key: string;
  read: (args: { bag: Bag; key: string }) => T | undefined | false;
}): T | undefined | false {
  if (!Object.hasOwn(bag, key)) {
    return undefined;
  }
  return read({ bag, key });
}

/**
 * Whether the capture itself recorded this key as `null` — an own key, so an inherited one never reads as recorded.
 *
 * @returns true for a recorded `null`
 */
function recordedNull({ bag, key }: { bag: Bag; key: string }): boolean {
  return Object.hasOwn(bag, key) && bag[key] === null;
}

/**
 * A paused plan's week at its pause.
 *
 * @returns the week or the reason it was not read, `undefined` when it will not read
 */
function pausedWeekOf(bag: Bag): GlancePausedWeek | undefined {
  const kind = str({ bag, key: "kind" });
  if (kind === "unavailable") {
    const why = str({ bag, key: "why" });
    return why === undefined ? undefined : { kind, why };
  }
  if (kind !== "read") {
    return undefined;
  }
  const used = num({ bag, key: "used" });
  const available = num({ bag, key: "available" });
  const resetAtIso = nullableStr({ bag, key: "resetAtIso" });
  const readAtIso = str({ bag, key: "readAtIso" });
  if (used === undefined || available === undefined || resetAtIso === false || readAtIso === undefined) {
    return undefined;
  }
  return { available, kind, readAtIso, resetAtIso, used };
}

/**
 * A ceiling's pause: `undefined` for a ceiling that carries none, `false` for one that will not read.
 *
 * @returns the pause, `undefined`, or `false`
 */
function pauseOf(bag: Bag): GlancePause | undefined | false {
  if (!Object.hasOwn(bag, "pause")) {
    return undefined;
  }
  const pause = sub({ bag, key: "pause" });
  if (pause === undefined) {
    return false;
  }
  const sinceIso = str({ bag: pause, key: "sinceIso" });
  const week = sub({ bag: pause, key: "weekAtPause" });
  if (sinceIso === undefined || week === undefined) {
    return false;
  }
  const weekAtPause = pausedWeekOf(week);
  if (weekAtPause === undefined) {
    return false;
  }
  return { sinceIso, weekAtPause };
}

/**
 * A ceiling's status, narrowed to the closed set.
 *
 * @returns the status, or `undefined` for a word outside it
 */
function statusOf(bag: Bag): GlanceStatus | undefined {
  const status = str({ bag, key: "status" });
  return GLANCE_STATUSES.find((known) => known === status);
}

/**
 * One ceiling, or `undefined` when it will not read.
 *
 * @returns the ceiling as a plan with its kind beside it, so the caller drops the machine
 */
function ceilingOf(bag: Bag): { readonly kind: string; readonly plan: GlancePlan | undefined } | undefined {
  const id = str({ bag, key: "id" });
  const kind = str({ bag, key: "kind" });
  const status = statusOf(bag);
  const pause = pauseOf(bag);
  const reason = nullableStr({ bag, key: "reason" });
  const windows = every({ list: bags({ bag, key: "windows" }), read: windowOf });
  // A recorded `null` is the reading's own word that it has none; a missing key says the capture predates the field.
  const account = recordedNull({ bag, key: "account" }) ? null : laterField({ bag, key: "account", read: nullableStr });
  const freeResets = recordedNull({ bag, key: "freeResets" })
    ? null
    : laterField({ bag, key: "freeResets", read: nullableNum });
  if (id === undefined || kind === undefined || status === undefined || reason === false || windows === undefined) {
    return undefined;
  }
  if (account === false || freeResets === false || pause === false) {
    return undefined;
  }
  if (kind === "machine") {
    return { kind, plan: undefined };
  }
  if (kind !== "claude" && kind !== "codex") {
    // A provider this page has never heard of is a reading it cannot draw honestly, not one to skip.
    return undefined;
  }
  return { kind, plan: { account, freeResets, id, pause, provider: kind, reason, status, windows } };
}

/**
 * The Claude and Codex plans' ceilings off a `machine capacity` document, the machine dropped.
 *
 * @param payload the whole `machine capacity --json` document
 * @returns the plans; `absent` for a document from before the ceilings field, `unreadable` when it will not read
 */
export function readGlancePlans({ payload }: { payload: Bag }): GlancePlans {
  if (!("ceilings" in payload)) {
    return { kind: "absent" };
  }
  const reading = sub({ bag: payload, key: "ceilings" });
  if (reading === undefined) {
    return { kind: "unreadable" };
  }
  const ceilings = every({ list: bags({ bag: reading, key: "ceilings" }), read: ceilingOf });
  const lowest = laterField({ bag: reading, key: "lowest", read: nullableStr });
  if (ceilings === undefined || lowest === false) {
    return { kind: "unreadable" };
  }
  return {
    kind: "read",
    lowest,
    plans: ceilings.flatMap((ceiling) => (ceiling.plan === undefined ? [] : [ceiling.plan])),
  };
}

/**
 * `fleet ceiling --json`'s working-seat ceiling.
 *
 * @returns the ceiling, or `undefined` when the document is not a fleet ceiling report
 */
export function readSeatCeiling(payload: unknown): SeatCeiling | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const ceiling = sub({ bag: payload, key: "ceiling" });
  if (ceiling === undefined) {
    return undefined;
  }
  const kind = str({ bag: ceiling, key: "kind" });
  if (kind === "measured") {
    const seats = num({ bag: ceiling, key: "seats" });
    if (seats === undefined) {
      return undefined;
    }
    return { kind, seats };
  }
  if (kind === "unmeasurable") {
    const reason = str({ bag: ceiling, key: "reason" });
    if (reason === undefined) {
      return undefined;
    }
    return { kind, reason };
  }
  return undefined;
}

/**
 * What `fleet why --json` explains (`src/capacity/fleetWhy.ts`'s `FleetWhyReport`), as far as the glance draws it:
 * the sentences its one renderer wrote, so the page and the verb can never say two different things.
 */
export interface FleetWhy {
  /** What the verb judged binds the fleet; `unknown` when its tick's readings could not be judged. */
  readonly binding: string;
  /** The tick of the `machine capacity` reading it judged; `undefined` when its tick's readings did not cohere. */
  readonly judgedTick: string | undefined;
  /** That reading's own instant, which with its tick names the one reading, since a tick label can be reused. */
  readonly judgedMachineAtIso: string | undefined;
  /** The window's length, which the fold's label names. */
  readonly minutes: number;
  /** What binds now, then what the window measured, then where the cpu went. */
  readonly sentences: readonly string[];
}

/**
 * `fleet why --json`'s window and sentences.
 *
 * @returns the explanation, or `undefined` when the document is not a fleet why report or carries no sentence
 */
export function readFleetWhy(payload: unknown): FleetWhy | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const binding = str({ bag: payload, key: "binding" });
  const minutes = num({ bag: payload, key: "minutes" });
  const sentences = strings({ bag: payload, key: "sentences" });
  const current = sub({ bag: payload, key: "current" });
  if (binding === undefined || minutes === undefined || sentences === undefined || sentences.length === 0) {
    return undefined;
  }
  if (current === undefined) {
    return undefined;
  }
  const judgedTick = nullableStr({ bag: current, key: "tick" });
  const judgedMachineAtIso = nullableStr({ bag: current, key: "machineObservedAtIso" });
  if (judgedTick === false || judgedMachineAtIso === false) {
    return undefined;
  }
  return { binding, judgedMachineAtIso, judgedTick, minutes, sentences };
}

/**
 * The last recorded reading of `fleet why`.
 *
 * @returns the reading, or `undefined`
 */
export function readFleetWhyReading(payload: unknown): Reading<FleetWhy> | undefined {
  return readingOf({ payload, read: readFleetWhy });
}

/**
 * The `fleet why` the glance draws beside a capacity reading: one that judged THAT reading — its tick and its instant,
 * since a tick label alone can be reused — explains the verdict shown, and
 * a NEWER one is drawn only when it judged its binding `unknown` — a tick whose own readings never landed together,
 * whose sentences say why it cannot be judged. A newer one that DID judge a binding explains a verdict the glance has
 * not polled yet, and an older one a verdict it is no longer showing, so neither is drawn.
 *
 * @param capacity the `machine capacity` reading the verdict judged, of which only its tick and instant are read
 * @returns the explanation to draw, or `undefined`
 */
export function whyOfTick({
  why,
  capacity,
}: {
  why: Reading<FleetWhy>;
  capacity: { readonly by: string; readonly observedAtIso: string };
}): FleetWhy | undefined {
  const { judgedMachineAtIso, judgedTick } = why.value;
  if (judgedTick === capacity.by && judgedMachineAtIso === capacity.observedAtIso) {
    return why.value;
  }
  const newer = Date.parse(why.observedAtIso) > Date.parse(capacity.observedAtIso);
  if (newer && why.value.binding === "unknown") {
    return why.value;
  }
  return undefined;
}

/**
 * The last recorded reading of `fleet ceiling`.
 *
 * @returns the reading, or `undefined`
 */
export function readSeatCeilingReading(payload: unknown): Reading<SeatCeiling> | undefined {
  return readingOf({ payload, read: readSeatCeiling });
}
