/**
 * Decoding ONE stored slot row — the pure half of `./slotLedger.ts`, split out so the ledger's file stays a
 * store of locked read-modify-writes and this stays a codec a test can feed a bare value.
 *
 * Every reader here answers `undefined` for a value that is not the shape it names, never a partial row:
 * `./slotLedger.ts#readSlotAttempt` turns that into a REFUSAL, because reading a corrupt row as "never
 * attempted" would run the firing a second time, which is the failure the ledger exists to prevent.
 */
import { isRecord } from "../../lib/parsers.js";
import {
  RECIPE_SLOT_ATTEMPT_SCHEMA_VERSION,
  RECIPE_SLOT_DEATH_REASONS,
  type RecipeSlotAttempt,
  type RecipeSlotDeathReason,
  type RecipeSlotOutcome,
} from "./slotAttempt.js";

/** A stored `failed` outcome's exit code: a number when it reached one, `null` when it never did. */
function storedExitCode({ value }: { value: unknown }): number | null {
  // An `if` rather than `??`: `no-silent-fallback` bans the coalesce, and the absent case is real — a
  // failure that never reached an exit code at all records `null` on purpose.
  if (typeof value === "number") {
    return value;
  }
  return null;
}

/** The `succeeded` reading of a stored outcome, or `undefined` when it is not one. */
function succeededOf({
  value,
  settledAtIso,
}: {
  value: Readonly<Record<string, unknown>>;
  settledAtIso: string;
}): RecipeSlotOutcome | undefined {
  if (value["kind"] !== "succeeded" || typeof value["exitCode"] !== "number") {
    return undefined;
  }
  return { exitCode: value["exitCode"], kind: "succeeded", settledAtIso };
}

/** The `failed` reading of a stored outcome, or `undefined` when it is not one. */
function failedOf({
  value,
  settledAtIso,
}: {
  value: Readonly<Record<string, unknown>>;
  settledAtIso: string;
}): RecipeSlotOutcome | undefined {
  const { detail, retryNotBeforeIso } = value;
  if (value["kind"] !== "failed" || typeof detail !== "string" || typeof retryNotBeforeIso !== "string") {
    return undefined;
  }
  return {
    detail,
    exitCode: storedExitCode({ value: value["exitCode"] }),
    kind: "failed",
    retryNotBeforeIso,
    settledAtIso,
  };
}

/** The `deferred` reading of a stored outcome, or `undefined` when it is not one. */
function deferredOf({
  value,
  settledAtIso,
}: {
  value: Readonly<Record<string, unknown>>;
  settledAtIso: string;
}): RecipeSlotOutcome | undefined {
  const { detail } = value;
  if (value["kind"] !== "deferred" || typeof detail !== "string") {
    return undefined;
  }
  return { detail, kind: "deferred", settledAtIso };
}

/** The `dead` reading of a stored outcome, or `undefined` when it is not one. */
function deadOf({
  value,
  settledAtIso,
}: {
  value: Readonly<Record<string, unknown>>;
  settledAtIso: string;
}): RecipeSlotOutcome | undefined {
  const { detail, reason } = value;
  if (value["kind"] !== "dead" || typeof detail !== "string") {
    return undefined;
  }
  if (!isDeathReason(reason)) {
    return undefined;
  }
  return { detail, kind: "dead", reason, settledAtIso };
}

/** Whether a stored value is exactly one of the death reasons this build writes — anything else is unreadable. */
function isDeathReason(value: unknown): value is RecipeSlotDeathReason {
  return RECIPE_SLOT_DEATH_REASONS.some((reason) => reason === value);
}

/**
 * One outcome, or `undefined` when the stored value is not one.
 *
 * One reader per kind rather than one branching function: each arm has its own required fields, and a
 * single body over four of them is exactly the shape `cognitive-complexity` names as unreviewable.
 */
function outcomeOf({ value }: { value: unknown }): RecipeSlotOutcome | undefined {
  if (!isRecord(value) || typeof value["settledAtIso"] !== "string") {
    return undefined;
  }
  const settledAtIso = value["settledAtIso"];
  // Walked rather than chained with `??`, which `no-silent-fallback` bans: reading "the next reader, when
  // this one did not recognise the row" out of an operator is exactly the substitution that rule makes
  // visible, and four readers with no match is a real answer rather than a fallback.
  for (const read of [succeededOf, failedOf, deferredOf, deadOf]) {
    const outcome = read({ settledAtIso, value });
    if (outcome !== undefined) {
      return outcome;
    }
  }
  return undefined;
}

/**
 * A stored holder pid: `null` when absent or null, the pid when it is a positive safe integer, and
 * `undefined` — an unreadable row — for anything else.
 *
 * Absent reads as `null` because every row written before the field existed is PID-less, which keeps the
 * lease-only judgement it always had. A malformed value refuses rather than reading `null`: zero and a
 * negative number name a process GROUP to `kill(pid, 0)`, so guessing here could abandon a live attempt.
 */
function storedHolderPid({ value }: { value: unknown }): number | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  return undefined;
}

/**
 * One slot row, or `undefined` when the stored value is not one.
 *
 * @param value the decoded JSON of one ledger file
 * @returns the row, or `undefined` when the value is not a row this build wrote
 */
export function attemptOf({ value }: { value: unknown }): RecipeSlotAttempt | undefined {
  if (!isRecord(value) || value["schemaVersion"] !== RECIPE_SLOT_ATTEMPT_SCHEMA_VERSION) {
    return undefined;
  }
  const { recipeId, slotIso, attempt, holder, holderToken, startedAtIso, leaseExpiresIso } = value;
  if (
    typeof recipeId !== "string" ||
    typeof slotIso !== "string" ||
    typeof attempt !== "number" ||
    typeof holder !== "string" ||
    typeof holderToken !== "string" ||
    typeof startedAtIso !== "string" ||
    typeof leaseExpiresIso !== "string"
  ) {
    return undefined;
  }
  // A row written before the run stamp existed reads as NOT STARTED, which is the fail-safe direction here:
  // such a row lives at most one cadence period, and the alternative would refuse to run a firing forever.
  let runStartedAtIso: string | null = null;
  if (typeof value["runStartedAtIso"] === "string") {
    runStartedAtIso = value["runStartedAtIso"];
  }
  const holderPid = storedHolderPid({ value: value["holderPid"] });
  if (holderPid === undefined) {
    return undefined;
  }
  const base = {
    attempt,
    holder,
    holderPid,
    holderToken,
    leaseExpiresIso,
    recipeId,
    runStartedAtIso,
    schemaVersion: RECIPE_SLOT_ATTEMPT_SCHEMA_VERSION,
    slotIso,
    startedAtIso,
  } as const;
  const rawOutcome = value["outcome"];
  if (rawOutcome === null || rawOutcome === undefined) {
    return { ...base, outcome: null };
  }
  const outcome = outcomeOf({ value: rawOutcome });
  if (outcome === undefined) {
    return undefined;
  }
  return { ...base, outcome };
}
