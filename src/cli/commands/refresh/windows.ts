/**
 * How `refresh` decides the window each source is read over, and how that window is rendered in the run's
 * own log. Split out of {@link ./core} when that file grew past the size ratchet: window planning is a real
 * seam — it is the only part of the pure core that consults the WATERMARK STORE (through an injected
 * reader) and the only part that has to reason about the clock, and it is where the class of defect fixed
 * here lives. Nothing here touches the network, env or disk.
 */
import { type CorpusSource, CURSORLESS_SOURCES, type ExportWindow } from "../../../corpus/types.js";
import { resolveSince } from "../../../corpus/watermark.js";
import { parseYyyyMmDdUtcMs, yyyyMmDdMinusDays } from "../../../lib/date.js";

const GITHUB_LOOKBACK_DAYS = 7;
const SOURCE_LOOKBACK_DAYS = 90;
/**
 * The floor `--all` re-crawls from, and the `since` half of the `self` lane's nominal window. For `self` it
 * names a bronze FILE and nothing more: a full re-scan has no window to respect, and every record carries its
 * own resolved event time.
 */
export const EPOCH_SINCE = "1970-01-01";

/** One source's resolved ingest window. */
export interface RefreshWindow {
  readonly source: CorpusSource;
  readonly window: ExportWindow;
  /**
   * True when the user asked for a specific window (`--since` / `--all` / `--lookback-days`) and it
   * therefore OVERRODE the stored cursor. The shell carries this into GitHub org mode so the SECOND
   * cursor store (the per-repo watermarks) is ignored too — without that, an explicit window is silently
   * narrowed back to each repo's own cursor and a deep backfill ingests nothing.
   */
  readonly cursorOverridden: boolean;
}

/**
 * Whether the user asked for a specific window. Any of `--since` / `--all` / `--lookback-days` is an
 * explicit request, and an explicit request BEATS every stored cursor — the flags mean what they say.
 * Pure.
 *
 * @param sinceFlag the explicit `--since`, if any
 * @param all whether `--all` was set
 * @param lookbackDays the `--lookback-days` override, if any
 * @returns true when a widening/narrowing flag was passed
 */
export function explicitWindowOverride({
  sinceFlag,
  all,
  lookbackDays,
}: {
  sinceFlag: string | undefined;
  all: boolean;
  lookbackDays: number | undefined;
}): boolean {
  return sinceFlag !== undefined || all || lookbackDays !== undefined;
}

/**
 * Plan each source's window.
 *
 * An EXPLICIT request (`--since` / `--all` / `--lookback-days`) wins outright and the stored cursor is not
 * consulted at all; only a bare incremental `refresh` resumes from the cursor. Before PR5.4 the cursor won
 * whenever one existed, so `--all` and `--lookback-days` were silently discarded on an established corpus
 * — the run reported the window it was told to fetch and fetched a different one.
 *
 * `lookbackDays` overrides the per-source default depth (GitHub 7 days, the rest 90). Pure via the injected
 * `readWatermark` seam.
 *
 * @param sources the selected sources
 * @param home the Slopweaver home (passed to `readWatermark`)
 * @param sinceFlag the explicit `--since`, if any
 * @param until the window's exclusive upper bound (`YYYY-MM-DD…`)
 * @param all whether `--all` was set (epoch since)
 * @param lookbackDays the `--lookback-days` override, if any
 * @param readWatermark the per-source cursor reader (injected)
 * @param today today as `YYYY-MM-DD` — the ceiling no STORED cursor may push the window's `since` past
 *   ({@link noLaterThanToday}); passed in rather than read here so this stays pure, exactly as
 *   {@link refreshWindowLogLine} takes it
 * @param orgMode whether GitHub org mode (`--all-repos`) is on — GitHub then IGNORES the per-source
 *   watermark for the base window (the PER-REPO watermark governs resume), so the base is the lookback floor
 * @returns one window per source, in selection order, each flagged with whether it overrode the cursor
 */
export function buildRefreshWindows({
  sources,
  home,
  sinceFlag,
  until,
  all,
  lookbackDays,
  readWatermark,
  today,
  orgMode = false,
}: {
  sources: readonly CorpusSource[];
  home: string;
  sinceFlag: string | undefined;
  until: string;
  all: boolean;
  lookbackDays: number | undefined;
  readWatermark: (args: { home: string; source: CorpusSource }) => string | undefined;
  today: string;
  orgMode?: boolean;
}): readonly RefreshWindow[] {
  const explicit = explicitWindowOverride({ all, lookbackDays, sinceFlag });
  return sources.map((source) => {
    if (CURSORLESS_SOURCES.includes(source)) {
      // A whole-snapshot source: every run reads the entire archive, so the window only names the bronze file
      // and no cursor is consulted. `snapshotNarrowingDiagnostics` has already refused a flag that would narrow it.
      return { cursorOverridden: false, source, window: { since: EPOCH_SINCE, until } };
    }
    const lookback = lookbackDepth({ lookbackDays, source });
    const fallbackSince = all ? EPOCH_SINCE : yyyyMmDdMinusDays({ date: until.slice(0, 10), days: lookback });
    // Org-mode GitHub already skipped the per-source cursor (its per-repo store governs resume); an explicit
    // request now skips it for EVERY source, and `cursorOverridden` propagates that past the per-repo store.
    const ignoreCursor = explicit || (orgMode && source === "github");
    const since = windowSince({
      fallbackSince,
      ignoreCursor,
      readCursor: () => readWatermark({ home, source }),
      sinceFlag,
      today,
    });
    return { cursorOverridden: explicit, source, window: { since, until } };
  });
}

/**
 * How many days back one source is read when nothing narrower was asked for.
 *
 * The absent `--lookback-days` is a named branch rather than a `??`, because the two answers are genuinely
 * different facts: a caller's explicit depth, or this source's shipped default. Pure.
 *
 * @param lookbackDays the `--lookback-days` override, when one was passed
 * @param source the source whose shipped default applies otherwise
 * @returns the lookback depth in days
 */
function lookbackDepth({ lookbackDays, source }: { lookbackDays: number | undefined; source: CorpusSource }): number {
  if (lookbackDays !== undefined) {
    return lookbackDays;
  }
  return source === "github" ? GITHUB_LOOKBACK_DAYS : SOURCE_LOOKBACK_DAYS;
}

/**
 * One source's window lower bound. A run that consults the cursor resumes from it, capped at today; one that
 * ignores it reads from what the CALLER asked for — an explicit `--since`, else the computed lookback floor.
 *
 * The cap is on the CURSOR branch alone, deliberately. An explicit `--since 2999-01-01` is the user asking a
 * question about the future, and silently rewriting it would recreate the PR5.4 defect
 * {@link buildRefreshWindows}'s own header records: a run that reports the window it was told to fetch and
 * fetches another. Pure via the injected cursor read.
 *
 * @param ignoreCursor whether an explicit request or org mode put the stored cursor out of play
 * @param sinceFlag the explicit `--since`, when one was passed
 * @param fallbackSince the lookback floor, used when no `--since` was passed and when no cursor is stored
 * @param readCursor reads this source's stored cursor, consulted only when it is in play
 * @param today today as `YYYY-MM-DD`, the ceiling on a cursor-derived bound
 * @returns the lower bound as `YYYY-MM-DD`
 */
function windowSince({
  ignoreCursor,
  sinceFlag,
  fallbackSince,
  readCursor,
  today,
}: {
  ignoreCursor: boolean;
  sinceFlag: string | undefined;
  fallbackSince: string;
  readCursor: () => string | undefined;
  today: string;
}): string {
  if (!ignoreCursor) {
    return noLaterThanToday({ since: resolveSince({ cursor: readCursor(), fallbackSince }), today });
  }
  if (sinceFlag === undefined) {
    return fallbackSince;
  }
  return sinceFlag;
}

/**
 * A floor no STORED cursor may push past: today.
 *
 * A pooled cursor answers how far through TIME a source has been read, so one ahead of the clock claims a
 * span nobody could have read — and `until` is today+1, so a cursor banked from it comes back as
 * `since == until` and the window is EMPTY. MEASURED on the operator's own home:
 * `corpus/watermarks/fathom.json` held a day-end date ahead of the clock, so `slopweaver automation run-due --recipe
 * resync-corpus-fathom` logged `refresh fathom · window <later>..<earlier>` and stored 0 transcripts,
 * while `slopweaver refresh --source fathom --since "$(date -v-60d +%F)" --sample 3 --no-derive` over the same
 * account stored 1. Reproduce with:
 *
 * ```bash
 * cat "$SLOPWEAVER_HOME/corpus/watermarks/fathom.json"; date -u
 * ```
 *
 * `../../../corpus/watermark.ts#computeSourceWatermarks` stops that value being minted again; this is what
 * repairs a home that ALREADY holds one, because the store merges MAX and a cursor on disk can never be
 * lowered by a later run. The same two-sided shape as the calendar fix and the Slack fix
 * (`../../../corpus/slack/reach.ts#planChannelOldest` is the same cap in Slack epoch seconds).
 *
 * Compared as milliseconds rather than by string order: both operands are bare days HERE, since
 * `resolveSince` slices to ten characters first, so string order happens to be right — and that is exactly
 * the kind of right that stops being right when one of the two shapes changes. An unparseable bound caps
 * nothing, since a broken clock is no evidence about a cursor. Pure.
 *
 * @param since the cursor-derived lower bound, as `YYYY-MM-DD`
 * @param today today as `YYYY-MM-DD`
 * @returns `since`, or `today` when `since` is past it
 * @internal
 */
function noLaterThanToday({ since, today }: { since: string; today: string }): string {
  const sinceMs = parseYyyyMmDdUtcMs({ date: since });
  const todayMs = parseYyyyMmDdUtcMs({ date: today });
  if (sinceMs === undefined || todayMs === undefined) {
    return since;
  }
  return sinceMs > todayMs ? today : since;
}

/**
 * The per-source window log line. The internal `until` is today+1 (an exclusive upper bound); render the
 * actual inclusive end — never past `today` — so the line doesn't look like it's fetching the future. Pure.
 *
 * @param window its resolved window
 * @param today today as `YYYY-MM-DD` (the shell derives it from its clock)
 * @param cursorOverridden whether an explicit window overrode the stored cursor (named so the run SHOWS
 *   that it is deliberately re-fetching, instead of the user having to infer it)
 * @returns the log line
 */
export function refreshWindowLogLine({
  source,
  window,
  today,
  cursorOverridden = false,
}: {
  source: CorpusSource;
  window: ExportWindow;
  today: string;
  cursorOverridden?: boolean;
}): string {
  const shownUntil = window.until < today ? window.until : today;
  // "the POOLED cursor", not "stored cursors": Slack's per-channel store still governs whether a
  // conversation already read from the epoch is resumed rather than re-read, and a line claiming every stored
  // cursor was ignored would describe a resumed backfill as a fresh one.
  if (CURSORLESS_SOURCES.includes(source)) {
    return `refresh ${source} · whole snapshot, no cursor`;
  }
  const suffix = cursorOverridden ? " · explicit window — pooled cursor ignored" : "";
  return `refresh ${source} · window ${window.since}..${shownUntil}${suffix}`;
}
