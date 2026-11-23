/**
 * The fleet's health as the sessions page reads it: the document `slopweaver fleet health --json` prints, parsed
 * rather than trusted. The CLI's half is `src/fleet/types.ts` — this package imports nothing from `src/`, so the
 * shape is written twice and this side checks every field it receives.
 *
 * One thing is checked harder than its shape: a plan alias, because the sign-in button TYPES it into a terminal
 * (`fleetAutomation.ts`). An alias that is not a plain name is refused here, so nothing a refusal printed can ever
 * become shell text. Pure.
 */
import { err, ok, type Result } from "neverthrow";

import { isRecord } from "./desktopBridge";
import { type FleetError, FleetErrors } from "./errors";

/** One seat's colour. */
export type SeatColour = "red" | "yellow" | "green";

/** What a seat is for. */
export type SeatRole = "supervisor" | "loop" | "keep-alive" | "worker" | "empty";

/** One seat on the page. */
export interface FleetSeat {
  readonly seatId: string;
  readonly role: SeatRole;
  readonly colour: SeatColour;
  readonly flashing: boolean;
  /** `p0`…`p3`, or `unassigned`. */
  readonly priority: string;
  readonly rowTitle: string;
  readonly detail: string;
  /** Recovery held it as a crash loop and handed it to the supervisor, so no attempt moves it. */
  readonly held: boolean;
  /**
   * The supervisor's own process runs with no login wall read, whatever its colour — so no note asks the owner to press
   * recovery over it. Only ever true on its seat.
   */
  readonly live: boolean;
  /** The supervisor's newest sign that it is working, and when: only on its seat, only once one was seen. */
  readonly lastSignal: FleetChairSignal | undefined;
  /** When a sign of working has been expected from: the later of its process starting and its taking the seat. */
  readonly signalExpectedSinceIso: string | undefined;
}

/** One sign the supervisor gave that it is working: it said it is caught up, or it closed a sweep. */
export interface FleetChairSignal {
  readonly kind: "reoriented" | "swept";
  readonly atIso: string;
}

/** The escape hatches a hand step may set on a resume — the exact environment names the gates read. */
export type FleetResumeHatch = "ALLOW_FABLE_OVERRIDE" | "SLOPWEAVER_ALLOW_SPENT_PLAN";

/** What the one button does: a closed set, each mapped to a fixed command. */
export type FleetHandAction =
  | { readonly kind: "claude-signin"; readonly alias: string; readonly email: string | undefined }
  | { readonly kind: "policy-override"; readonly hatch: FleetResumeHatch }
  | { readonly kind: "automation-consent" }
  | { readonly kind: "open-cmux" }
  // The shell's own, never parsed from a reading: recovery stopped launching by itself and the fleet is still down.
  | { readonly kind: "resume" };

/** The one step only the owner can take. */
export interface FleetHandStep {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly action: FleetHandAction;
  /**
   * What recovery did, as measured, for the note's fold to repeat word for word rather than re-derive from prose. Only
   * the shell's own "Start recovery again" carries it; a step parsed off a reading never does.
   */
  readonly recoveryDetail?: string;
}

/** The headline in plain words, and what sits under the fold. */
export interface FleetReason {
  readonly code: string;
  readonly headline: string;
  readonly detail: string;
  readonly raw: string | undefined;
  readonly handStep: FleetHandStep | undefined;
}

/** The whole fleet at one instant. */
export interface FleetHealth {
  readonly observedAtIso: string;
  /** `degraded`: the only red seats are crash loops recovery held, or cmux hung again within the hour after a restart. */
  readonly state: "healthy" | "recovering" | "degraded" | "down";
  readonly capacity: { readonly online: number; readonly configured: number };
  readonly console: "serving" | "down" | "unmeasured";
  readonly seats: readonly FleetSeat[];
  readonly reason: FleetReason;
  readonly unmapped: readonly string[];
  /** The phase of the recovery attempt underway, when one is. */
  readonly recoveryPhase: string | undefined;
  /** The newest finished attempt's episode and outcome, when one has finished. */
  readonly lastAttempt:
    { readonly attemptId: string; readonly episodeId: string; readonly outcome: AttemptOutcome } | undefined;
  /**
   * The newest attempt the journal records as started, finished or not — `lastAttempt` is finished-only, so its
   * absence never proves no attempt began.
   */
  readonly newestAttempt:
    { readonly attemptId: string; readonly episodeId: string; readonly finished: boolean } | undefined;
}

/** How one recovery attempt ended. */
export type AttemptOutcome = "healthy" | "hand-step" | "deferred" | "failed";

const OUTCOMES: readonly AttemptOutcome[] = ["healthy", "hand-step", "deferred", "failed"];

/** A plan alias safe to type: a plain name, never shell text. */
const SAFE_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

const COLOURS: readonly SeatColour[] = ["red", "yellow", "green"];
const SIGNAL_KINDS: readonly FleetChairSignal["kind"][] = ["reoriented", "swept"];
const ROLES: readonly SeatRole[] = ["supervisor", "loop", "keep-alive", "worker", "empty"];
const STATES: readonly FleetHealth["state"][] = ["healthy", "recovering", "degraded", "down"];
const CONSOLE_STATES: readonly FleetHealth["console"][] = ["serving", "down", "unmeasured"];
const HATCHES: readonly FleetResumeHatch[] = ["ALLOW_FABLE_OVERRIDE", "SLOPWEAVER_ALLOW_SPENT_PLAN"];

/**
 * A value as one of a closed set of strings.
 *
 * @returns the member it equals, or `undefined` when it equals none
 */
function oneOf<T extends string>({ value, allowed }: { value: unknown; allowed: readonly T[] }): T | undefined {
  return allowed.find((member) => member === value);
}

/** A whole, non-negative count, or `undefined` when it is not one. */
function countOf({ value }: { value: unknown }): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** A seat's last sign of working: `undefined` when absent, `null` when present and malformed. */
function parseSignal({ value }: { value: unknown }): FleetChairSignal | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return null;
  }
  const kind = oneOf({ allowed: SIGNAL_KINDS, value: value["kind"] });
  const atIso = value["atIso"];
  if (kind === undefined || typeof atIso !== "string" || Number.isNaN(Date.parse(atIso))) {
    return null;
  }
  return { atIso, kind };
}

/** One seat, or `undefined` when it is not exactly one. */
function parseSeat({ value }: { value: unknown }): FleetSeat | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { seatId, flashing, priority, rowTitle, detail } = value;
  const role = oneOf({ allowed: ROLES, value: value["role"] });
  const colour = oneOf({ allowed: COLOURS, value: value["colour"] });
  const typed =
    typeof seatId === "string" &&
    typeof flashing === "boolean" &&
    typeof priority === "string" &&
    typeof rowTitle === "string" &&
    typeof detail === "string";
  // `held` is written only as `true`, on a seat recovery held as a crash loop; absent means not held.
  const held = value["held"];
  // `live` the same way: written only as `true`, on a supervisor whose own process runs with no login wall read.
  const live = value["live"];
  const lastSignal = parseSignal({ value: value["lastSignal"] });
  const signalExpectedSinceIso = value["signalExpectedSinceIso"];
  // An instant the page renders must parse here: one that does not would throw in the clock formatter instead.
  const sinceMalformed =
    signalExpectedSinceIso !== undefined &&
    (typeof signalExpectedSinceIso !== "string" || Number.isNaN(Date.parse(signalExpectedSinceIso)));
  const malformed =
    (held !== undefined && held !== true) ||
    (live !== undefined && live !== true) ||
    lastSignal === null ||
    sinceMalformed;
  if (!typed || role === undefined || colour === undefined || malformed) {
    return undefined;
  }
  return {
    colour,
    detail,
    flashing,
    held: held === true,
    lastSignal,
    live: live === true,
    priority,
    role,
    rowTitle,
    seatId,
    signalExpectedSinceIso: typeof signalExpectedSinceIso === "string" ? signalExpectedSinceIso : undefined,
  };
}

/** A hand step's action, or `undefined` when it is not one this build can carry out safely. */
function parseAction({ value }: { value: unknown }): FleetHandAction | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  switch (value["kind"]) {
    case "claude-signin": {
      const { alias, email } = value;
      if (typeof alias !== "string" || !SAFE_ALIAS.test(alias)) {
        return undefined;
      }
      if (email !== undefined && typeof email !== "string") {
        return undefined;
      }
      return { alias, email, kind: "claude-signin" };
    }
    case "policy-override": {
      const hatch = oneOf({ allowed: HATCHES, value: value["hatch"] });
      return hatch === undefined ? undefined : { hatch, kind: "policy-override" };
    }
    case "automation-consent":
      return { kind: "automation-consent" };
    case "open-cmux":
      return { kind: "open-cmux" };
    default:
      return undefined;
  }
}

/** The hand step, `undefined` when absent, or `null` when present and malformed. */
function parseHandStep({ value }: { value: unknown }): FleetHandStep | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return null;
  }
  const { id, label, note } = value;
  const action = parseAction({ value: value["action"] });
  if (typeof id !== "string" || typeof label !== "string" || typeof note !== "string" || action === undefined) {
    return null;
  }
  return { action, id, label, note };
}

/** The reason, or `undefined` when it is malformed. */
function parseReason({ value }: { value: unknown }): FleetReason | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { code, headline, detail, raw } = value;
  const handStep = parseHandStep({ value: value["handStep"] });
  const typed =
    typeof code === "string" &&
    typeof headline === "string" &&
    typeof detail === "string" &&
    (raw === undefined || typeof raw === "string") &&
    handStep !== null;
  if (!typed) {
    return undefined;
  }
  return { code, detail, handStep, headline, raw };
}

/** The recovery attempt's phase: `undefined` when none is open, `null` when the field is malformed. */
function parseRecoveryPhase({ value }: { value: unknown }): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || typeof value["phase"] !== "string") {
    return null;
  }
  return value["phase"];
}

/** The newest finished attempt: `undefined` when none has finished, `null` when the field is malformed. */
function parseLastAttempt({ value }: { value: unknown }): FleetHealth["lastAttempt"] | null {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return null;
  }
  const { attemptId, episodeId } = value;
  const outcome = oneOf({ allowed: OUTCOMES, value: value["outcome"] });
  if (typeof attemptId !== "string" || typeof episodeId !== "string" || outcome === undefined) {
    return null;
  }
  return { attemptId, episodeId, outcome };
}

/** The newest started attempt: `undefined` when none was recorded, `null` when the field is malformed. */
function parseNewestAttempt({ value }: { value: unknown }): FleetHealth["newestAttempt"] | null {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return null;
  }
  const { attemptId, episodeId, finished } = value;
  if (typeof attemptId !== "string" || typeof episodeId !== "string" || typeof finished !== "boolean") {
    return null;
  }
  return { attemptId, episodeId, finished };
}

/**
 * The fleet's health off what `fleet health --json` printed. Its exit code is not read: `3` is a fleet that is not
 * healthy, which is exactly the document this page exists to show.
 *
 * @param text everything the verb printed on stdout
 * @returns the health, or which field was malformed
 */
export function parseFleetHealth({ text }: { text: string }): Result<FleetHealth, FleetError> {
  const line = text
    .split("\n")
    .map((candidate) => candidate.trim())
    .findLast((candidate) => candidate.startsWith("{"));
  if (line === undefined) {
    return err(FleetErrors.malformed({ field: "the output (no JSON document)" }));
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return err(FleetErrors.malformed({ field: "the output (not JSON)" }));
  }
  if (!isRecord(value) || value["schemaVersion"] !== 1) {
    return err(FleetErrors.malformed({ field: "schemaVersion" }));
  }
  const { observedAtIso, capacity, console: consoleField, seats, unmapped } = value;
  const state = oneOf({ allowed: STATES, value: value["state"] });
  if (state === undefined) {
    return err(FleetErrors.malformed({ field: "state" }));
  }
  // The page reads times against this instant (`fleetPage.ts`), so one that does not parse is refused here.
  if (typeof observedAtIso !== "string" || Number.isNaN(Date.parse(observedAtIso))) {
    return err(FleetErrors.malformed({ field: "observedAtIso" }));
  }
  const online = isRecord(capacity) ? countOf({ value: capacity["online"] }) : undefined;
  const configured = isRecord(capacity) ? countOf({ value: capacity["configured"] }) : undefined;
  if (online === undefined || configured === undefined) {
    return err(FleetErrors.malformed({ field: "capacity" }));
  }
  const consoleState = isRecord(consoleField)
    ? oneOf({ allowed: CONSOLE_STATES, value: consoleField["state"] })
    : undefined;
  if (consoleState === undefined) {
    return err(FleetErrors.malformed({ field: "console" }));
  }
  if (!Array.isArray(seats)) {
    return err(FleetErrors.malformed({ field: "seats" }));
  }
  const parsedSeats = seats.map((seat: unknown) => parseSeat({ value: seat }));
  const seatIndex = parsedSeats.indexOf(undefined);
  if (seatIndex !== -1) {
    return err(FleetErrors.malformed({ field: `seats[${String(seatIndex)}]` }));
  }
  const reason = parseReason({ value: value["reason"] });
  if (reason === undefined) {
    return err(FleetErrors.malformed({ field: "reason" }));
  }
  if (!Array.isArray(unmapped) || !unmapped.every((entry: unknown) => typeof entry === "string")) {
    return err(FleetErrors.malformed({ field: "unmapped" }));
  }
  const recoveryPhase = parseRecoveryPhase({ value: value["recovery"] });
  if (recoveryPhase === null) {
    return err(FleetErrors.malformed({ field: "recovery" }));
  }
  const lastAttempt = parseLastAttempt({ value: value["lastAttempt"] });
  if (lastAttempt === null) {
    return err(FleetErrors.malformed({ field: "lastAttempt" }));
  }
  const newestAttempt = parseNewestAttempt({ value: value["newestAttempt"] });
  if (newestAttempt === null) {
    return err(FleetErrors.malformed({ field: "newestAttempt" }));
  }
  return ok({
    capacity: { configured, online },
    console: consoleState,
    lastAttempt,
    newestAttempt,
    observedAtIso,
    reason,
    recoveryPhase,
    seats: parsedSeats.filter((seat) => seat !== undefined),
    state,
    unmapped: unmapped.filter((entry: unknown): entry is string => typeof entry === "string"),
  });
}
