/**
 * The snapshot guard for `refresh`: a cursorless source ({@link CURSORLESS_SOURCES}) projects a whole archive every
 * run, so a flag that narrows the window or the read cannot mean anything for it.
 */
import { type CorpusSource, CURSORLESS_SOURCES } from "../../../corpus/types.js";
import type { RefreshOptions } from "./core.js";

/**
 * Refuse a flag that NARROWS the window (`--since`, `--until`, `--lookback-days`) or the read (`--sample`,
 * `--fetch-cap`) beside a cursorless source — the job reads the whole export or nothing. Refused rather than
 * ignored, because a flag that is silently dropped reads exactly like one that worked. `--all` is not refused: a
 * whole snapshot is already what it asks for. Pure.
 *
 * @param sources the selected sources
 * @param options the parsed options, for the five narrowing flags
 * @returns the usage errors (empty when the request is allowed)
 */
export function snapshotNarrowingDiagnostics({
  sources,
  options,
}: {
  sources: readonly CorpusSource[];
  options: Pick<RefreshOptions, "since" | "until" | "lookbackDays" | "sample" | "fetchCap">;
}): readonly string[] {
  const snapshots = sources.filter((source) => CURSORLESS_SOURCES.includes(source));
  const narrowing = [
    ...(options.since !== undefined ? ["--since"] : []),
    ...(options.until !== undefined ? ["--until"] : []),
    ...(options.lookbackDays !== undefined ? ["--lookback-days"] : []),
    ...(options.sample !== undefined ? ["--sample"] : []),
    ...(options.fetchCap !== undefined ? ["--fetch-cap"] : []),
  ];
  if (snapshots.length === 0 || narrowing.length === 0) {
    return [];
  }
  return [
    `refresh: ${snapshots.join(", ")} reads a whole export every run, so ${narrowing.join(", ")} cannot narrow it.`,
    `refresh: drop ${narrowing.join(", ")}, or refresh ${snapshots.join(", ")} in a run of its own.`,
  ];
}
