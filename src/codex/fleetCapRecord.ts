/**
 * What the last Codex fleet read concluded about every registered destination, as a record the monitor lane can
 * read without running that read itself.
 *
 * ## Why this exists
 *
 * A fleet of capped Codex accounts must never be learned of from a seat screen, because rule 9's
 * fallback keeps the fleet working without saying why, and the owner wants to be told a cap exists and wants Codex
 * working again. The fleet read is where a cap is known — every pass, `codex route`
 * and a Codex seat go through `./fleetRead.ts` — and the monitor lane is local-only, so the read files its answer
 * here and `codex-fleet-capped` (`../monitor/codexFleetCapped.ts`) reads it. The same seam as `./signInRecord.ts`.
 *
 * ## One row per destination, and each capacity row's reset
 *
 * A row says which of seven states the ranking put the destination in. A capacity row carries the instant it can
 * take a pass again when a source named one: a near-cap row the LATEST reset among the windows at the bar, since the
 * account is back only when every one of them is; a refusing row its evidence's own reset, which a usage limit or a
 * credits refill never names.
 *
 * `usage-limit` and `not-measured` are their OWN states and never a capacity row: each is the owner's register
 * setting (`./fleetTypes.ts`), so a reader of this record — `codex-fleet-capped` above all — must never read one as
 * a provider cap. A `usage-limit` row carries its weekly reset as the instant it takes passes again, read off its
 * own reading and never off quota evidence; a `not-measured` row carries none, since a monthly allowance nothing
 * here reads has no reset to name.
 *
 * Pure: the record is built and decoded here; `./fleetCapPort.ts` reads and files it in the store, where the upsert
 * itself keeps the record judged at the later instant (`./fleetCapStoreRows.ts`).
 */
import { parseIsoMs } from "#lib/date.js";
import { isRecord } from "#lib/parsers.js";

import { isPlanAlias } from "../plans/register.js";
import type { CodexThresholds } from "../plans/thresholds.js";

import type { CodexPlanObservation, CodexPlanRanking, CodexRouteExclusion } from "./fleetTypes.js";
import { codexWindowByLabel } from "./gauge.js";
import { soonestResetExpiry } from "./resetCreditsParse.js";
import { codexNearCapWindows, codexUsageLimitReached } from "./routingCapacity.js";

/** Where the ranking put one destination: eligible, or the exclusion kind it was left out for. */
type CodexFleetRowState = "eligible" | CodexRouteExclusion["kind"];

/** Every {@link CodexFleetRowState}, for decoding a filed row. */
const ROW_STATES: ReadonlySet<string> = new Set<CodexFleetRowState>([
  "eligible",
  "paused",
  "not-measured",
  "signed-out",
  "usage-limit",
  "near-cap",
  "quota-refused",
]);

/** One registered Codex destination as the read left it. */
export interface CodexFleetRow {
  readonly alias: string;
  readonly state: CodexFleetRowState;
  /** For a capacity row, when it can take a pass again, when a source named it; absent otherwise. */
  readonly resetAtIso?: string;
  /**
   * The weekly window the ranking read, as used percent and its own reset — so `fleet-runs-dry` can list every Codex
   * plan with its week and its reset, Codex included. Absent when the read held no
   * weekly reading for the row, and on every record filed before the field.
   */
  readonly week?: { readonly usedPercent: number; readonly resetAtIso?: string };
  /**
   * The free usage-limit resets the store's own live read counted, and the soonest expiry among them. Absent when no
   * signed-in live read counted them, and on every record filed before the field.
   */
  readonly freeResets?: { readonly held: number; readonly soonestExpiryIso?: string };
}

/** The whole fleet as one read left it. */
export interface CodexFleetCapRecord {
  /** The instant the read judged every row against, ISO-8601 as `toISOString` writes it. */
  readonly readAtIso: string;
  /** Every registered Codex row, in register order. */
  readonly rows: readonly CodexFleetRow[];
}

/**
 * The instant one capacity or usage-limit row can take a pass again, when a source named it.
 *
 * A usage-limit row's instant is its own weekly reset, canonicalised as every filed instant is; it is never quota
 * evidence, and a `not-measured` row has none.
 *
 * @param observation the destination's evidence from the same read
 * @param state what the ranking concluded about it
 * @param readAtIso the read's own instant, which the near-cap and usage-limit windows are judged against
 * @param thresholds the register's Codex bars the ranking itself judged with
 * @returns the reset, or undefined for any other row or one no source dates
 */
function capacityResetAtIso({
  observation,
  readAtIso,
  state,
  thresholds,
}: {
  observation: CodexPlanObservation;
  readAtIso: string;
  state: CodexFleetRowState;
  thresholds: CodexThresholds;
}): string | undefined {
  if (state === "near-cap") {
    const resets = codexNearCapWindows({ gauge: observation.gauge, nowIso: readAtIso, thresholds }).map(
      (window) => window.resetAtIso,
    );
    return latestInstant({ instants: resets });
  }
  if (state === "quota-refused" && observation.quota.refuse) {
    return observation.quota.evidence.resetAtIso;
  }
  if (state === "usage-limit") {
    const reached = codexUsageLimitReached({
      gauge: observation.gauge,
      gaugeSource: observation.gaugeSource,
      nowIso: readAtIso,
      usageLimitPercent: observation.plan.usageLimitPercent,
    });
    return canonicalIso({ iso: reached?.resetAtIso });
  }
  return undefined;
}

/**
 * The latest of some instants, or undefined when there are none.
 *
 * @returns the latest instant as given
 */
function latestInstant({ instants }: { instants: readonly string[] }): string | undefined {
  let latest: string | undefined;
  for (const instant of instants) {
    if (latest === undefined || Date.parse(instant) > Date.parse(latest)) {
      latest = instant;
    }
  }
  return latest;
}

/**
 * Build the record one fleet read files.
 *
 * @param observations every registered Codex row's evidence, in register order
 * @param ranking what `./rank.ts` concluded over those same observations
 * @param readAtIso the read's own single instant
 * @param thresholds the register's Codex bars the ranking judged with, so a row's reset is the bar it crossed
 * @returns the record
 */
export function codexFleetCapRecordOf({
  observations,
  ranking,
  readAtIso,
  thresholds,
}: {
  observations: readonly CodexPlanObservation[];
  ranking: CodexPlanRanking;
  readAtIso: string;
  thresholds: CodexThresholds;
}): CodexFleetCapRecord {
  const eligible = new Set(ranking.ranked.map((destination) => destination.alias));
  const excluded = new Map(ranking.excluded.map((exclusion) => [exclusion.destination.alias, exclusion.kind]));
  const rows = observations.map((observation): CodexFleetRow => {
    const alias = observation.destination.alias;
    const kind = excluded.get(alias);
    // Every observation is either ranked or excluded (`./rank.ts`); one in neither is an invariant broken there.
    const state: CodexFleetRowState = eligible.has(alias) ? "eligible" : kind!;
    const resetAtIso = capacityResetAtIso({ observation, readAtIso, state, thresholds });
    const week = weekOf({ observation });
    const freeResets = freeResetsOf({ observation });
    return {
      alias,
      state,
      ...(resetAtIso === undefined ? {} : { resetAtIso }),
      ...(week === undefined ? {} : { week }),
      ...(freeResets === undefined ? {} : { freeResets }),
    };
  });
  return { readAtIso, rows };
}

/**
 * The weekly window the ranking read for one row, or undefined when it held none — and for a `monthly-spend` row,
 * whose allowance is NOT MEASURED, so no percentage of a week may stand for it on a card.
 */
function weekOf({ observation }: { observation: CodexPlanObservation }): CodexFleetRow["week"] {
  if (observation.gauge === undefined || observation.plan.allowance.kind === "monthly-spend") {
    return undefined;
  }
  const weekly = codexWindowByLabel({ gauge: observation.gauge, label: "weekly" });
  if (weekly === undefined) {
    return undefined;
  }
  const resetAtIso = canonicalIso({ iso: weekly.resetAtIso });
  return { usedPercent: weekly.usedPercent, ...(resetAtIso === undefined ? {} : { resetAtIso }) };
}

/**
 * A provider's instant written as canonical UTC, the only form the decoder reads back, or undefined when it names
 * no instant — so the row carries no reset and the card says it is unread, rather than printing a wrong one.
 */
function canonicalIso({ iso }: { iso: string | undefined }): string | undefined {
  if (iso === undefined) {
    return undefined;
  }
  const ms = parseIsoMs({ tsIso: iso });
  if (ms === undefined) {
    return undefined;
  }
  return new Date(ms).toISOString();
}

/** The free resets a signed-in live read counted for one row, or undefined when none counted them. */
function freeResetsOf({ observation }: { observation: CodexPlanObservation }): CodexFleetRow["freeResets"] {
  const { live } = observation;
  if (live.kind !== "signed-in") {
    return undefined;
  }
  const soonestExpiryIso = canonicalIso({ iso: soonestResetExpiry({ credits: live.resetCreditsListed }) });
  return {
    held: live.resetCreditsAvailable,
    ...(soonestExpiryIso === undefined ? {} : { soonestExpiryIso }),
  };
}

/**
 * Whether a filed time is exactly what `Date.prototype.toISOString` writes — the only form a record is written in.
 *
 * @returns true only for a canonical UTC instant that round-trips unchanged
 */
function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const ms = parseIsoMs({ tsIso: value });
  return ms !== undefined && new Date(ms).toISOString() === value;
}

/**
 * Decode one filed row, or say which field stops it decoding.
 *
 * @param value one element of the record's `rows`
 * @returns the row, or why it is not one
 */
function decodeRow({ value }: { value: unknown }): { readonly row: CodexFleetRow } | { readonly why: string } {
  if (!isRecord(value)) {
    return { why: "carries a row that is not a JSON object" };
  }
  const { alias, resetAtIso, state } = value;
  if (typeof alias !== "string" || !isRowState(state)) {
    return { why: `carries a row with no alias or an unknown state ${JSON.stringify(state)}` };
  }
  // Every row is written from a register plan, so an alias the register would refuse is a hand-edited or foreign
  // file; read whole, its name would reach a card line it could outgrow or break.
  if (!isPlanAlias({ alias })) {
    // Cut to 40 and the cut marked, so a shortened name never reads as the whole one.
    const shown = alias.length > 40 ? `${JSON.stringify(alias.slice(0, 40))}…` : JSON.stringify(alias);
    return { why: `carries a row whose alias ${shown} is not a register plan alias` };
  }
  if (resetAtIso !== undefined && !isCanonicalInstant(resetAtIso)) {
    return { why: `carries ${alias}'s resetAtIso ${JSON.stringify(resetAtIso)}, which is not an instant` };
  }
  const week = decodeWeek({ alias, value: value["week"] });
  if ("why" in week) {
    return week;
  }
  const freeResets = decodeFreeResets({ alias, value: value["freeResets"] });
  if ("why" in freeResets) {
    return freeResets;
  }
  return {
    row: {
      alias,
      state,
      ...(resetAtIso === undefined ? {} : { resetAtIso }),
      ...(week.week === undefined ? {} : { week: week.week }),
      ...(freeResets.freeResets === undefined ? {} : { freeResets: freeResets.freeResets }),
    },
  };
}

/** Decode a row's `week`, absent on a record filed before the field. */
function decodeWeek({
  alias,
  value,
}: {
  alias: string;
  value: unknown;
}): { readonly week: CodexFleetRow["week"] } | { readonly why: string } {
  if (value === undefined) {
    return { week: undefined };
  }
  if (!isRecord(value) || typeof value["usedPercent"] !== "number") {
    return { why: `carries ${alias}'s week with no usedPercent` };
  }
  const { usedPercent, resetAtIso } = value;
  if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) {
    return { why: `carries ${alias}'s week at ${String(usedPercent)}% used, outside 0 to 100` };
  }
  if (resetAtIso === undefined) {
    return { week: { usedPercent } };
  }
  // Canonical UTC only, as the row's own reset: a card prints the first sixteen characters as a UTC minute.
  if (!isCanonicalInstant(resetAtIso)) {
    return { why: `carries ${alias}'s week reset ${JSON.stringify(resetAtIso)}, which is not an instant` };
  }
  return { week: { resetAtIso, usedPercent } };
}

/** Decode a row's `freeResets`, absent on a record filed before the field. */
function decodeFreeResets({
  alias,
  value,
}: {
  alias: string;
  value: unknown;
}): { readonly freeResets: CodexFleetRow["freeResets"] } | { readonly why: string } {
  if (value === undefined) {
    return { freeResets: undefined };
  }
  if (!isRecord(value)) {
    return { why: `carries ${alias}'s freeResets that is not a JSON object` };
  }
  const { held, soonestExpiryIso } = value;
  if (typeof held !== "number" || !Number.isInteger(held) || held < 0) {
    return { why: `carries ${alias}'s freeResets with no whole held count` };
  }
  if (soonestExpiryIso === undefined) {
    return { freeResets: { held } };
  }
  if (!isCanonicalInstant(soonestExpiryIso)) {
    return { why: `carries ${alias}'s free-reset expiry ${JSON.stringify(soonestExpiryIso)}, which is not an instant` };
  }
  return { freeResets: { held, soonestExpiryIso } };
}

/**
 * Whether a filed value is one of the row states.
 *
 * @returns true only for a declared state
 */
function isRowState(value: unknown): value is CodexFleetRowState {
  return typeof value === "string" && ROW_STATES.has(value);
}

/**
 * Decode a filed record's parsed JSON, or say which field stops it decoding.
 *
 * @param value the parsed JSON
 * @returns the record, or why it is not one
 */
export function decodeCodexFleetCapRecord({
  value,
}: {
  value: unknown;
}): { readonly record: CodexFleetCapRecord } | { readonly why: string } {
  if (!isRecord(value)) {
    return { why: "is not a JSON object" };
  }
  const { readAtIso, rows } = value;
  if (!isCanonicalInstant(readAtIso)) {
    return { why: `carries readAtIso ${JSON.stringify(readAtIso)}, which is not an instant` };
  }
  if (!Array.isArray(rows)) {
    return { why: "carries no rows array" };
  }
  const decoded: CodexFleetRow[] = [];
  for (const row of rows) {
    const one = decodeRow({ value: row });
    if ("why" in one) {
      return { why: one.why };
    }
    decoded.push(one.row);
  }
  return { record: { readAtIso, rows: decoded } };
}
