/**
 * Which plan the fleet is currently on, and why — parsed and reduced as pure functions.
 *
 * This record, not `~/.claude.json`, is the identity authority for every report. Measured: that
 * file's `oauthAccount` block is a display cache carrying the email, organisation and rate-limit tier of
 * whichever account was last profiled, and a credential swap does not update it. A fleet briefing that read
 * it would confidently name the wrong plan, which is the single likeliest defect in this whole feature.
 *
 * A state record therefore carries only what this repository itself wrote: the selected alias, when it was
 * selected, and the reason. No credential value, no email, no organisation — an alias is a neutral local
 * label, and this record is printed into events and sidebar rows.
 *
 * `unavailableUntil` is what stops a rotation flapping. A plan refused at 04:12 is not eligible again merely
 * because the next gauge read happens to look calmer; it is ineligible until the reset the refusal itself
 * named. Without that, two plans near the wall can hand the fleet back and forth on every cycle.
 */
import { isRecord } from "../lib/parsers.js";
import type { ClaudeAccountAlias } from "./contracts.js";

/**
 * One plan held out of selection until a known instant.
 *
 * @internal — an element of {@link ClaudeRotationState}'s own list; every reader goes through this file's
 *   reducers rather than building one.
 */
export interface ClaudeUnavailability {
  readonly alias: ClaudeAccountAlias;
  /** When this plan may be selected again, ISO-8601 — the reset the refusal itself named. */
  readonly untilIso: string;
  readonly reason: string;
}

/**
 * What this repository knows about the fleet's current plan.
 *
 * @internal — the shape {@link parseRotationState} returns and the reducers thread through; a caller reads
 *   it back from those rather than constructing one.
 */
export interface ClaudeRotationState {
  /** The plan the fleet is on, or undefined before the first selection has ever been made. */
  readonly selected?: ClaudeAccountAlias;
  /** When {@link selected} was chosen, ISO-8601. */
  readonly selectedAtIso?: string;
  /** Why it was chosen — a sentence for the sidebar row, never a credential. */
  readonly reason?: string;
  readonly unavailable: readonly ClaudeUnavailability[];
}

/** The state of an install that has never rotated. */
export const EMPTY_ROTATION_STATE: ClaudeRotationState = { unavailable: [] };

/**
 * Structurally validate one decoded unavailability entry.
 *
 * @param value one decoded element of the stored `unavailable` list
 * @returns the entry, or undefined when it is malformed
 */
function parseUnavailability({ value }: { value: unknown }): ClaudeUnavailability | undefined {
  if (
    !isRecord(value) ||
    typeof value["alias"] !== "string" ||
    typeof value["untilIso"] !== "string" ||
    typeof value["reason"] !== "string"
  ) {
    return undefined;
  }
  return { alias: value["alias"], reason: value["reason"], untilIso: value["untilIso"] };
}

/**
 * Read a stored state record, tolerating anything unrecognisable.
 *
 * Deliberately tolerant where `usage.ts` is strict: a corrupt state file means this code forgot which plan
 * it chose, which the next gauge read repairs, whereas a misread gauge would rotate on a wrong number.
 *
 * @param value the decoded contents of the state file, or undefined when there is none
 * @returns the state, or {@link EMPTY_ROTATION_STATE} when nothing usable was stored
 */
export function parseRotationState({ value }: { value: unknown }): ClaudeRotationState {
  if (!isRecord(value)) {
    return EMPTY_ROTATION_STATE;
  }
  const rawUnavailable = Array.isArray(value["unavailable"]) ? value["unavailable"] : [];
  const unavailable = rawUnavailable
    .map((entry) => parseUnavailability({ value: entry }))
    .filter((entry): entry is ClaudeUnavailability => entry !== undefined);
  const selected = typeof value["selected"] === "string" ? value["selected"] : undefined;
  const selectedAtIso = typeof value["selectedAtIso"] === "string" ? value["selectedAtIso"] : undefined;
  const reason = typeof value["reason"] === "string" ? value["reason"] : undefined;
  return {
    unavailable,
    ...(reason === undefined ? {} : { reason }),
    ...(selected === undefined ? {} : { selected }),
    ...(selectedAtIso === undefined ? {} : { selectedAtIso }),
  };
}

/**
 * Drop every hold whose reset has passed, so a plan becomes eligible again on its own clock.
 *
 * @param state the stored state
 * @param nowIso the current instant, ISO-8601 — injected, never read from a hidden clock
 * @returns the state with expired holds removed
 */
export function expireUnavailability({
  nowIso,
  state,
}: {
  nowIso: string;
  state: ClaudeRotationState;
}): ClaudeRotationState {
  return { ...state, unavailable: state.unavailable.filter((entry) => entry.untilIso > nowIso) };
}

/**
 * Record that a plan is spent until its reset, replacing any hold already standing for it.
 *
 * @param state the stored state
 * @param alias the plan that refused
 * @param untilIso when it may be selected again, ISO-8601
 * @param reason what refused, for the sidebar row
 * @returns the state with the hold applied
 */
export function holdAccount({
  alias,
  reason,
  state,
  untilIso,
}: {
  alias: ClaudeAccountAlias;
  reason: string;
  state: ClaudeRotationState;
  untilIso: string;
}): ClaudeRotationState {
  return {
    ...state,
    unavailable: [...state.unavailable.filter((entry) => entry.alias !== alias), { alias, reason, untilIso }],
  };
}

/**
 * Record a completed selection.
 *
 * @param state the stored state
 * @param alias the plan now in the chair
 * @param nowIso when the selection happened, ISO-8601
 * @param reason why this plan was chosen
 * @returns the state naming the new selection
 */
export function selectAccount({
  alias,
  nowIso,
  reason,
  state,
}: {
  alias: ClaudeAccountAlias;
  nowIso: string;
  reason: string;
  state: ClaudeRotationState;
}): ClaudeRotationState {
  return { ...state, reason, selected: alias, selectedAtIso: nowIso };
}

/**
 * Whether a plan may be selected right now.
 *
 * @param state the stored state
 * @param alias the plan to test
 * @param nowIso the current instant, ISO-8601
 * @returns true when no unexpired hold stands against it
 */
export function isSelectable({
  alias,
  nowIso,
  state,
}: {
  alias: ClaudeAccountAlias;
  nowIso: string;
  state: ClaudeRotationState;
}): boolean {
  return !state.unavailable.some((entry) => entry.alias === alias && entry.untilIso > nowIso);
}
