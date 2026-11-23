/**
 * How old the Datadog census is, as the one line a reader prints to say so. Pure.
 *
 * The census's failure mode is a false NEGATIVE: an error shape that first appeared after the build is simply
 * absent, and a gate reading it says "Datadog has nothing to say" with full confidence. So `store detect`
 * prints this line whether or not a question hit anything — a hit is no evidence the census is current, and a
 * miss is exactly where a stale one lies.
 *
 * ## Which readers print it — "every census read" was twice the wrong answer
 *
 * `store detect` prints it unconditionally (`src/cli/commands/store/detect.ts`). `turn brief` prints it on a
 * HIT only, because `route/censusReading.ts`'s `censusBriefLines` deliberately returns nothing on a miss.
 * `route plan` and the alert card's `behind` lane read the same manifest and print no age at all — the plan is
 * host-neutral JSON with no notes channel, and the `alert-summary` form has no field for one. Those two are
 * known gaps rather than oversights, so name the reader when you cite this file rather than generalising.
 *
 * Two thresholds, each owned elsewhere rather than chosen here:
 *
 * - **stale** — older than the Datadog atlas's own freshness window, which is the schedule that rebuilds it
 *   (`src/atlas/datadog/descriptor.ts`). A census past it means a scheduled rebuild did not land.
 * - **expired** — the start of the window it measured has fallen out of the shortest log retention the map
 *   reported, so the query a row carries can no longer reproduce its own count.
 */

import { renderAge, renderDuration } from "../../lib/duration.js";
import type { CatalogueManifest } from "./catalogue.js";

/** Milliseconds in one day, the unit a log index states its retention in. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What a census's age means for a reader.
 *
 * @internal — read it through {@link CensusAge}; nothing outside this file names the union today.
 */
export type CensusAgeState = "fresh" | "stale" | "expired";

/** The age of one census and the one line that says it. */
export interface CensusAge {
  readonly state: CensusAgeState;
  /** Milliseconds since the census was built. */
  readonly ageMs: number;
  /** One line a gate, a brief or a report prints verbatim. */
  readonly line: string;
}

/**
 * Judge one census's age.
 *
 * @param manifest the census manifest — its build instant, measured window and retention
 * @param nowMs the instant the reader is judging at, passed in so this stays pure
 * @param staleAfterMs the rebuild schedule's window; past it the census is stale
 * @returns the state and the line to print
 */
export function censusAge({
  manifest,
  nowMs,
  staleAfterMs,
}: {
  manifest: Pick<CatalogueManifest, "builtAtIso" | "retentionDays" | "window">;
  nowMs: number;
  staleAfterMs: number;
}): CensusAge {
  const ageMs = Math.max(0, nowMs - Date.parse(manifest.builtAtIso));
  const age = renderAge({ ms: ageMs });
  const measured = `measured ${manifest.window.fromIso} .. ${manifest.window.toIso}`;
  const rebuild = "rebuild with `slopweaver datadog catalogue build --from 7d`";
  const retentionMs = manifest.retentionDays === null ? null : manifest.retentionDays * DAY_MS;
  if (retentionMs !== null && nowMs - Date.parse(manifest.window.fromIso) > retentionMs) {
    return {
      ageMs,
      line: `Datadog census EXPIRED — built ${age} ago, ${measured}, and that window has left the ${String(manifest.retentionDays)}-day log retention, so its counts no longer reproduce; ${rebuild}`,
      state: "expired",
    };
  }
  if (ageMs > staleAfterMs) {
    return {
      ageMs,
      line: `Datadog census STALE — built ${age} ago (${measured}), past its ${renderDuration({ ms: staleAfterMs })} rebuild window, so a shape newer than the build is invisible to it and a miss proves nothing; ${rebuild}`,
      state: "stale",
    };
  }
  return { ageMs, line: `Datadog census built ${age} ago (${measured})`, state: "fresh" };
}
