/**
 * What a `refresh` run uses when a caller left something unset: the state home, the `--if-stale` threshold,
 * the slot acquirer and the window's end. Each one is absent BY DESIGN — a bare `refresh` passes none of
 * these flags — so each reads its field off the declared-optional record and RETURNS the shipped value when
 * it is unset, rather than carrying an absence on into the run. `./request.ts`, `./slotNarrowing.ts` and
 * `./run.ts` are the shells that call them.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { acquireRefreshSlot } from "../../../corpus/refreshSlot.js";
import { yyyyMmDdTodayPlus } from "../../../lib/date.js";
import { STALE_AFTER_DAYS } from "../../../retrieval/coverage.js";
import type { RefreshOptions } from "./core.js";
import type { RefreshDeps } from "./deps.js";

/** Milliseconds in a day — the unit the shipped `STALE_AFTER_DAYS` default is converted through. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The home this run reads and writes under: `--home` when given, else the install's own.
 *
 * @param options the parsed refresh options
 * @param deps the effectful seams, for the install's home
 * @returns the state home
 */
export function refreshHome({ options, deps }: { options: RefreshOptions; deps: Pick<RefreshDeps, "home"> }): string {
  const named = unsetFieldAsNull({ key: "home", record: options });
  if (named === null) {
    return deps.home();
  }
  return named;
}

/**
 * How old a source's cursor may be before `--if-stale` calls it behind: `--stale-after` when given, else the
 * shipped `STALE_AFTER_DAYS` the coverage report judges by.
 *
 * @param options the parsed refresh options
 * @returns the threshold in milliseconds
 */
export function staleThresholdMs({ options }: { options: RefreshOptions }): number {
  const given = unsetFieldAsNull({ key: "staleAfterMs", record: options });
  if (given === null) {
    return STALE_AFTER_DAYS * DAY_MS;
  }
  return given;
}

/**
 * Who takes a source's refresh slot: the injected seam a test wires, else the production lock.
 *
 * @param deps the effectful seams
 * @returns the slot acquirer
 */
export function refreshSlotAcquirer({
  deps,
}: {
  deps: Pick<RefreshDeps, "acquireRefreshSlot">;
}): typeof acquireRefreshSlot {
  const injected = unsetFieldAsNull({ key: "acquireRefreshSlot", record: deps });
  if (injected === null) {
    return acquireRefreshSlot;
  }
  return injected;
}

/**
 * The window's end: `--until` when given, else tomorrow by the injected clock.
 *
 * @param options the parsed refresh options
 * @param deps the effectful seams, for the clock
 * @returns the end date, `YYYY-MM-DD`
 */
export function refreshUntil({
  options,
  deps,
}: {
  options: RefreshOptions;
  deps: Pick<RefreshDeps, "nowDate">;
}): string {
  const given = unsetFieldAsNull({ key: "until", record: options });
  if (given === null) {
    return yyyyMmDdTodayPlus({ days: 1, now: deps.nowDate() });
  }
  return given;
}
