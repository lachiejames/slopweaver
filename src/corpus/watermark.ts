/**
 * The per-source watermark: the max `tsIso` we've ever observed for a source, so the next refresh
 * resumes from there instead of re-scanning history. It's the max OBSERVED timestamp, deliberately not
 * the window's `until` — advancing to `until` would skip any records that land later with an earlier
 * timestamp (a gap). The one case that DOES fall back to `until` is a source read that yielded no usable
 * timestamp at all, and because `until` is today+1 that fallback is capped at the clock; the measurement
 * that forced the cap is on {@link computeSourceWatermarks}. Merge is MAX at the leaf, so a narrower
 * re-run can never move a cursor backwards — which also means a cursor that reaches disk can never be
 * lowered, so `../cli/commands/refresh/core.ts#buildRefreshWindows` caps what it reads BACK as well.
 * Writes are atomic (tmp + rename) so a crash mid-write can't corrupt the cursor.
 *
 * Each source's cursor lives in its OWN file (`corpus/watermarks/<source>.json`) rather than one shared
 * `.watermark.json`. That's what makes concurrent per-source refreshes safe: two sources finishing at the
 * same moment write DIFFERENT files, so neither can clobber the other's cursor (a single shared file's
 * read-modify-write would). The combined `.watermark.json` is READ as a migration fallback,
 * so a home written before the split keeps resuming.
 */

import { readFileSync } from "node:fs";
import { slopweaverHome } from "../config.js";
import { appendAll } from "../lib/arrays.js";
import { clampIsoToClock } from "../lib/date.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { sourceWatermarkPath, watermarkPath } from "./corpusPaths.js";
import { type CorpusSource, CURSORLESS_SOURCES, type SourceWatermark } from "./types.js";

/**
 * Whether a source has no resume cursor at all, so no watermark may ever be written for it. Pure.
 *
 * @param source the source to classify
 * @returns true when the source is cursorless (see {@link ./types.CURSORLESS_SOURCES})
 */
export function isCursorlessSource({ source }: { source: CorpusSource }): boolean {
  return CURSORLESS_SOURCES.includes(source);
}

/**
 * Max observed `tsIso` per source, capped at the clock that read it. Sources with no records are omitted;
 * `fallbackUntil` fills a gap only when a source's records all carry an empty `tsIso`.
 *
 * The cap is the whole reason this function takes a clock, and it is not a tidiness measure.
 * `fallbackUntil` is `job.window.until` (`./ingestSource.ts#advanceForRun`), which is **today+1** — an
 * EXCLUSIVE upper bound — so a source that was read and yielded no usable timestamp banked TOMORROW, and
 * `../cli/commands/refresh/core.ts#buildRefreshWindows` reads that value straight back as the next run's
 * `window.since`. MEASURED on the operator's own home: `corpus/watermarks/fathom.json` held
 * tomorrow's date while the clock still read today, so every pass planned
 * `refresh fathom · window <tomorrow>..<today>` and `src/corpus/fathom/fetch.ts#windowFilter` turned that
 * into `created_after == created_before`, storing 0 transcripts while the same verb over an explicit window
 * stored 1. Reproduce with:
 *
 * ```bash
 * cat "$SLOPWEAVER_HOME/corpus/watermarks/fathom.json"; date -u
 * ```
 *
 * The cap is applied to the RESULT rather than to `fallbackUntil` alone, for the reason
 * `slack/channelWatermark.ts#computeChannelWatermarks` gives: an OBSERVED timestamp ahead of the clock is a
 * defect signal too, and capping only the fallback would encode the weaker claim. It does NOT replace
 * `calendar/ingest.ts#pooledCursor`, which caps a diary's legitimately future records before they ever reach
 * the pooled path. The merge in {@link advanceWatermark} is MAX, so a cursor that reaches disk can never be
 * lowered — `buildRefreshWindows`' own cap is the other half, and the half that repairs an existing home.
 *
 * @param records the just-written records (only `source` + `tsIso` are read)
 * @param fallbackUntil the window `until`, used only when a source has no non-empty `tsIso`
 * @param nowIso the instant this pass ran — no source banks a cursor later than it
 * @returns one watermark per source seen
 */
export function computeSourceWatermarks({
  records,
  fallbackUntil,
  nowIso,
}: {
  records: readonly { source: CorpusSource; tsIso: string }[];
  fallbackUntil: string;
  nowIso: string;
}): readonly SourceWatermark[] {
  const maxBySource = new Map<CorpusSource, string>();
  const seenSources = new Set<CorpusSource>();
  for (const { source, tsIso } of records) {
    seenSources.add(source);
    const currentMax = maxBySource.get(source);
    if (tsIso.length > 0 && (currentMax === undefined || tsIso > currentMax)) {
      maxBySource.set(source, tsIso);
    }
  }
  return [...seenSources].map((source) => ({
    cursor: clampIsoToClock({
      nowIso,
      tsIso: readThrough({ fallbackUntil, observedMax: maxBySource.get(source) }),
    }),
    source,
  }));
}

/**
 * What one source was read THROUGH: its max observed `tsIso`, or the window end when it yielded none.
 *
 * The absent case is a named branch rather than a `??`, because it is the one the defect fired on — a
 * source that was READ and held nothing still banks a cursor, and what it banks is today+1. Pure.
 *
 * @param observedMax the source's max non-empty `tsIso`, when it had one
 * @param fallbackUntil the window end, standing in for a read that saw no usable timestamp
 * @returns the timestamp this source was read through, BEFORE the clock cap
 */
function readThrough({
  observedMax,
  fallbackUntil,
}: {
  observedMax: string | undefined;
  fallbackUntil: string;
}): string {
  if (observedMax === undefined) {
    return fallbackUntil;
  }
  return observedMax;
}

/** The `cursor` string from a validated `{ cursor }` object, or undefined. Pure. */
function cursorOf({ raw }: { raw: unknown }): string | undefined {
  return isRecord(raw) && typeof raw["cursor"] === "string" ? raw["cursor"] : undefined;
}

/** Read a source's cursor from its OWN file (`corpus/watermarks/<source>.json`); missing/invalid ⇒ undefined. */
function readSourceFile({ home, source }: { home: string; source: CorpusSource }): string | undefined {
  try {
    return cursorOf({ raw: JSON.parse(readFileSync(sourceWatermarkPath({ home, source }), "utf8")) });
  } catch {
    return undefined; // no per-source file yet (or unreadable) — the caller falls back to the combined file
  }
}

/** Read a source's cursor from the combined `.watermark.json` (a home that predates per-source files). */
function readCombinedCursor({ home, source }: { home: string; source: CorpusSource }): string | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(watermarkPath({ home }), "utf8"));
  } catch {
    return undefined;
  }
  const sources = isRecord(raw) ? raw["sources"] : undefined;
  return isRecord(sources) ? cursorOf({ raw: sources[source] }) : undefined;
}

/**
 * The stored cursor for a source, if any — its own per-source file wins, else the combined file
 * (so a home written before the per-source split still resumes). Pure-ish (reads two candidate files).
 *
 * @param source the corpus source
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the stored cursor, or undefined when none
 */
export function readWatermark({
  source,
  home = slopweaverHome(),
}: {
  source: CorpusSource;
  home?: string;
}): string | undefined {
  const own = readSourceFile({ home, source });
  if (own !== undefined) {
    return own;
  }
  // No per-source file (or an unreadable one): a home written before the split keeps its cursor in the
  // combined file, and a home with neither has no cursor at all.
  return readCombinedCursor({ home, source });
}

/**
 * Pick the export `since`: the stored cursor (sliced to a date), else the fallback.
 *
 * @param cursor the stored cursor, if any
 * @param fallbackSince the since to use when there's no cursor
 * @returns the resolved since date
 */
export function resolveSince({ cursor, fallbackSince }: { cursor: string | undefined; fallbackSince: string }): string {
  return cursor !== undefined && cursor.length > 0 ? cursor.slice(0, 10) : fallbackSince;
}

/** Write ONE source's cursor to its own file atomically and durably. */
function writeSourceFile({
  home,
  source,
  cursor,
}: {
  home: string;
  source: CorpusSource;
  cursor: string;
}): Result<{ path: string }> {
  const path = sourceWatermarkPath({ home, source });
  try {
    writeFileAtomic({ contents: `${JSON.stringify({ cursor, version: 1 }, null, 2)}\n`, path });
  } catch (error: unknown) {
    return err([error instanceof Error ? error.message : `failed to write watermark ${path}`]);
  }
  return ok({ path });
}

/**
 * Advance each source's cursor (MAX-merged against its stored value, so a narrower re-run never rewinds),
 * writing each to its OWN file. Because sources write separate files, two concurrent per-source refreshes
 * can't clobber each other. Written atomically per file.
 *
 * @param watermarks the per-source cursors to merge in
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the written per-source paths, or an error on any write failure
 */
export function advanceWatermark({
  watermarks,
  home = slopweaverHome(),
}: {
  watermarks: readonly SourceWatermark[];
  home?: string;
}): Result<{ paths: readonly string[] }> {
  const paths: string[] = [];
  const errors: string[] = [];
  for (const { source, cursor } of watermarks) {
    // The CHOKE-POINT refusal, not a caller's responsibility. A cursorless source has no resume state, and
    // writing one would create a cursor nothing reads today that a later refresh might — turning a lane that
    // should always re-scan into one that silently skips. Enforcing it here rather than at each call site means
    // a forgotten flag cannot do it: the first version of this guard was an optional field on the ingest job,
    // and a review pass showed that omitting it persisted `watermarks/self.json`.
    if (isCursorlessSource({ source })) {
      continue;
    }
    const existing = readWatermark({ home, source }); // MAX-merge: keep the later of stored vs incoming
    const next = existing !== undefined && existing > cursor ? existing : cursor;
    const written = writeSourceFile({ cursor: next, home, source });
    if (written.isOk()) {
      paths.push(written.value.path);
    } else {
      appendAll({ from: written.error, into: errors });
    }
  }
  return errors.length > 0 ? err(errors) : ok({ paths });
}
