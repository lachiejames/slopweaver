/**
 * Finding Codex's freshest budget reading on disk — the effectful half of `./gauge.ts`.
 *
 * ## Why this looks at several files and `./quotaLog.ts` looks at one
 *
 * An exhaustion check wants the newest line that says "stopped", and the newest rollout file is where that
 * is. A BUDGET wants the newest reading full stop, and the newest file by mtime need not hold one: a session
 * opened seconds ago has written its prompt and not yet completed a turn, so its rollout carries no
 * `token_count` event at all. Reading only that file reports "no budget" while a complete reading sits in
 * the file beside it. So this walks several recent files, takes each candidate's bounded tail, and keeps
 * the reading with the latest OBSERVED instant — never the latest mtime, which is a property of the file
 * rather than of the reading inside it.
 *
 * Every read is bounded: files modified within eight days of the newest one, newest by mtime only until no
 * unread file could hold a later or higher reading (below), and each file's two-megabyte tail, widened only when it holds no informative reading
 * (`./quotaLog.ts`'s `readRolloutTailUntil`, so never past the file itself). A machine with 3,881 rollout files
 * must not scan them all to print one number.
 *
 * The premise all of this rests on: one informative reading carries EVERY window its account reports, so the
 * newest one is the account's whole state. MEASURED across three weeks of all three homes, all
 * 39,781 informative readings carried the same single weekly window and none omitted it. Reproduce:
 * `find ~/.codex/sessions -name "rollout-*.jsonl" -mtime -21 -print0 | xargs -0 grep -ho '"window_minutes":[0-9]*' | sort | uniq -c`
 *
 * ## When the walk may stop
 *
 * A reading is written into its file at or before that file's mtime, so a file modified BEFORE the best
 * informative reading's observed instant cannot hold a later one, and neither can any file after it in mtime
 * order. That alone is not enough, because {@link pickGauge} raises each window to its high-water mark and
 * the mark can sit in an OLDER file: a later concurrent session's dipped 97% must not hide an earlier 100% (a
 * third Codex review). {@link pickGauge} picks each window LABEL from the newest reading holding it open, so the
 * walk needs every picked window settled — already at 100%, or every unread file last written before it opened
 * — and every label no reading has named yet settled too: MEASURED, a five-hour window appears in few readings
 * beside many weekly-only ones, so a newer weekly-only file says nothing about an older file's five-hour cap.
 * A label is settled unseen only once every unread file predates the widest window of it that could still be
 * open. The walk stops exactly there, {@link walkMayStop}, and nowhere earlier. It used to stop
 * after twelve files once anything informative was found, and a Codex review broke that: a still-running
 * session that last wrote a reading hours ago keeps a NEWER mtime than a finished session whose reading came
 * after it, so a stale 20% in the first twelve masked a current 100% in the thirteenth.
 * The rule judges the files as they stood when the walk LISTED them: a reading Codex appends mid-walk is one
 * this read began before, the same as any snapshot of a log still being written.
 *
 * ## A reading that says nothing never masks one that does
 *
 * MEASURED on the ambient home: once an account is capped, EVERY new rollout writes one
 * `token_count` whose `rate_limits` is `{"limit_id":"premium","primary":null,"secondary":null,
 * "rate_limit_reached_type":null}` — no window and no reached type. The newest twelve files all held only that
 * shape, so the newest reading was an empty one and `codex route` printed "week unread" for an account whose
 * thirteenth file said `used_percent: 100` on the weekly window, with its reset days ahead.{@link pickGauge} therefore
 * prefers the latest INFORMATIVE reading, and while nothing it opened was informative the walk continues
 * through every file inside the same {@link GAUGE_HORIZON_MS}, and past it only into a file modified after the
 * reading it would show (`pastHorizon`).
 * A count cap was tried first and a Codex review broke it: 200 empty post-cap files in front of the reading
 * would have masked it again. Eight days of mtime are the bound instead, because a weekly reading stays current
 * for seven days after it is written: five day-directories, the first bound, let five newer days of empty
 * post-cap readings hide a cap still in force (a second Codex review), and naming directories at all hid a
 * resumed session's file (a fourth). 701 files on this machine, and the worst
 * case — every file's tail read and every line parsed, nothing informative found — measured 1.3s over 689 of
 * them (count them: `find ~/.codex/sessions -name "rollout-*.jsonl" -mtime -8 | wc -l`).
 * Reproduce the masking shape:
 *
 * ```bash
 * find ~/.codex/sessions -name 'rollout-*.jsonl' -mtime -1 -exec ls -t {} + | head -20 |
 *   xargs -I{} sh -c "grep -o '\"primary\":[^,]*' {} | tail -1"
 * ```
 */
import { parseIsoMs } from "../lib/date.js";
import { type CodexGauge, type CodexWindowReading, gaugeKeepingWindows, parseGaugeLine } from "./gauge.js";
import { resetsMatch, SAME_WINDOW_TOLERANCE_MS } from "./modelBurn.js";
import { readRolloutTailOrUnread } from "./quotaLog.js";
import { horizonStartMs, rolloutsNewestFirst, walkRollouts } from "./rolloutWalk.js";

/** How far behind the newest file's mtime a gauge read looks: a weekly window's seven days and one more, for the reason above. */
const GAUGE_HORIZON_MS = 8 * 24 * 60 * 60 * 1000;

/** A gauge read's first slice of each file, the same two megabytes `./quotaLog.ts`'s fixed tail reads. */
const GAUGE_TAIL_BYTES = 2_000_000;

/** What a scan found, including what it had to leave out. */
export interface CodexGaugeScan {
  /** The reading with the latest observed instant, or undefined when no candidate file carried one. */
  readonly gauge: CodexGauge | undefined;
  /** How many rollout files were opened. */
  readonly filesRead: number;
  /**
   * How many candidate files the scan did not open: past the horizon, or after the walk could stop.
   *
   * Reported rather than dropped: a caller that finds no reading needs to know whether the log is empty or
   * whether this stopped looking, and those are different facts.
   */
  readonly filesSkipped: number;
  /**
   * How many places a newer reading could hide that the scan could not read: rollout files it reached and could not
   * open (counted inside {@link filesRead} too), plus every place the walk passed over in silence — a directory of
   * any age it could not list or search, a symlinked directory, a refused `.jsonl` entry (`walkRollouts`, counted in
   * the same walk that found the candidates).
   *
   * Reported because an unreadable file or directory reads as empty: without this count, a newer file this process
   * cannot open is indistinguishable from one holding no reading, and an older file's reading is returned as the
   * current one. A caller that presents {@link gauge} as current treats a non-zero count as a
   * doubt on it.
   */
  readonly filesUnreadable: number;
}

/**
 * Whether the walk has run out past {@link GAUGE_HORIZON_MS}: the next file is older than the horizon AND cannot
 * hold a reading later than the one the scan would show. The horizon alone dropped a file modified after the shown
 * reading was taken, so an older window was reported measured while a later reading sat unread; a
 * file past the horizon is therefore still read while its mtime is after the shown reading's observation. With
 * nothing to show, the horizon stands: the result is no reading, never a measured one.
 */
function pastHorizon({
  gauges,
  horizonMs,
  nextMtimeMs,
}: {
  gauges: readonly CodexGauge[];
  horizonMs: number;
  nextMtimeMs: number;
}): boolean {
  if (nextMtimeMs >= horizonMs) {
    return false;
  }
  const shown = pickGauge({ gauges });
  if (shown === undefined) {
    return true;
  }
  const shownMs = parseIsoMs({ tsIso: shown.observedAtIso });
  // Strictly before: a file modified at the very instant the shown reading was taken is still read.
  return shownMs !== undefined && nextMtimeMs < shownMs;
}

/**
 * Whether a reading says anything about the budget: a window still open when it was read, or a named reached
 * type on a reading carrying NO window. A window whose reset had already passed at its own reading describes
 * no current budget, so it can neither stand in front of an older reading of a window still open nor end the
 * walk (a Codex review). Its reached type is the same stale report, so it does not rescue the reading either
 * (a later Codex review): Codex's own exhaustion event nulls both slots (`REAL_USAGE_LIMIT_REACHED_LINE`), so
 * a windowless reached type is the one shape that is current.
 *
 * @param gauge the reading
 * @returns true when it carries an open window, or a reached type and no window at all
 */
function isInformative({ gauge }: { gauge: CodexGauge }): boolean {
  return hasOpenWindow({ gauge }) || (gauge.reachedType !== undefined && gauge.windows.length === 0);
}

/** Whether a reading carries at least one window that had not reset when it was read. */
function hasOpenWindow({ gauge }: { gauge: CodexGauge }): boolean {
  return gauge.windows.some((window) => windowOpenWhenRead({ gauge, window }));
}

/** Whether one of a reading's windows had not yet reset when the reading was taken; an undatable one counts. */
function windowOpenWhenRead({ gauge, window }: { gauge: CodexGauge; window: CodexWindowReading }): boolean {
  const observedMs = parseIsoMs({ tsIso: gauge.observedAtIso });
  const resetMs = window.resetAtIso === undefined ? undefined : parseIsoMs({ tsIso: window.resetAtIso });
  return resetMs === undefined || observedMs === undefined || resetMs > observedMs;
}

/**
 * The reading a budget read reports: the latest INFORMATIVE one, or the latest of all when none is.
 *
 * A reading with no window and no reached type — the post-cap `premium` shape this file's header measures —
 * describes nothing, so it cannot stand in front of an older reading that does. When NOTHING is informative
 * the latest reading is still returned, less any window that had reset when read, because a dated empty
 * reading is a truer answer than none.
 *
 * The informative reading supplies the instant, the reached type and the credits; its WINDOWS are chosen per
 * label by {@link windowSources}, because validity is a property of one window, not of a reading. A newer
 * reading can carry an open weekly window beside a five-hour one that had already reset, and taken wholesale
 * it would hide an older reading's current five-hour cap (a Codex review) — as Codex's windowless exhaustion
 * event would hide every window (another).
 *
 * @param gauges every reading found, in any order
 * @returns the reading to report, or undefined when there were none
 */
export function pickGauge({ gauges }: { gauges: readonly CodexGauge[] }): CodexGauge | undefined {
  const informative = latestGauge({ gauges: gauges.filter((gauge) => isInformative({ gauge })) });
  if (informative !== undefined) {
    const reportedMs = parseIsoMs({ tsIso: informative.observedAtIso });
    const windows = windowSources({ gauges })
      .filter(({ gauge, window }) => gauge === informative || stillOpenAt({ atMs: reportedMs, window }))
      .map(({ window }) => atHighWaterMark({ gauges, window }));
    return { ...informative, windows };
  }
  const latest = latestGauge({ gauges });
  if (latest === undefined) {
    return undefined;
  }
  // The dated fallback keeps its instant but never a window that had reset when it was read, nor the reached
  // type reported beside one: shown, either would read as a current cap (two Codex reviews).
  return gaugeKeepingWindows({ gauge: latest, keep: (window) => windowOpenWhenRead({ gauge: latest, window }) });
}

/** Whether a window's reset is after `atMs`; an undatable instant or reset cannot be shown to be. */
function stillOpenAt({ atMs, window }: { atMs: number | undefined; window: CodexWindowReading }): boolean {
  const resetMs = window.resetAtIso === undefined ? undefined : parseIsoMs({ tsIso: window.resetAtIso });
  return atMs !== undefined && resetMs !== undefined && resetMs > atMs;
}

/**
 * For every window label any reading carried OPEN when read, that label's window from the newest such reading,
 * with the reading it came from — one entry per label, in first-seen order.
 *
 * @param gauges every reading found
 * @returns the per-label sources; a label carried only by windows already reset when read has none
 */
function windowSources({
  gauges,
}: {
  gauges: readonly CodexGauge[];
}): readonly { readonly gauge: CodexGauge; readonly window: CodexWindowReading }[] {
  const labels = [...new Set(gauges.flatMap((gauge) => gauge.windows.map((window) => window.label)))];
  return labels.flatMap((label) => {
    const holders = gauges.filter((gauge) =>
      gauge.windows.some((window) => window.label === label && windowOpenWhenRead({ gauge, window })),
    );
    const gauge = latestGauge({ gauges: holders });
    const window = gauge?.windows.find(
      (entry) => entry.label === label && windowOpenWhenRead({ gauge, window: entry }),
    );
    return gauge === undefined || window === undefined ? [] : [{ gauge, window }];
  });
}

/** How many distinct window labels the readings carried, open or not. */
function labelsSeen({ gauges }: { gauges: readonly CodexGauge[] }): number {
  return new Set(gauges.flatMap((gauge) => gauge.windows.map((window) => window.label))).size;
}

/**
 * The latest reading with each window raised to the highest percentage any reading of that SAME window
 * reported. Concurrent sessions report one window's percentage as of their own last turn, so a later reading
 * can dip below an earlier one: MEASURED: 155 of 6,815 weekly readings over four days dipped, by
 * at most 3 points — enough to show a capped account at 97% and rank it as having room. Usage inside one
 * window never falls, so the high-water mark is the truer figure. Reproduce:
 * `cat ~/.codex/sessions/2026/09/2[0-3]/*.jsonl | grep '"token_count"' | sed -nE 's/^\{"timestamp":"([^"]*)".*"primary":\{"used_percent":([0-9.]+),"window_minutes":10080,"resets_at":([0-9]+)\}.+/\3 \1 \2/p' | sort | awk '{ if ($1==w) { d=h-$3; if (d>0) n++; if ($3>h) h=$3 } else { w=$1; h=$3 } } END { print n }'`
 *
 * Every one of those dips was BETWEEN files: within one rollout, a session's own readings never fell — 0 dips
 * across the 652 files that held more than one — so each file's newest reading, the one this scan keeps, is
 * already that file's high-water mark. Reproduce by running the same pipeline per file
 * (`for f in ~/.codex/sessions/2026/09/2[0-3]/*.jsonl; do …; done`).
 *
 * @param gauges every reading found
 * @param window the window being reported
 * @returns `window` at its high-water mark
 */
function atHighWaterMark({
  gauges,
  window,
}: {
  gauges: readonly CodexGauge[];
  window: CodexWindowReading;
}): CodexWindowReading {
  const sameWindowPercents = gauges.flatMap((gauge) =>
    gauge.windows
      .filter(
        (other) =>
          other.label === window.label &&
          resetsMatch({ leftIso: other.resetAtIso, rightIso: window.resetAtIso }) &&
          windowOpenWhenRead({ gauge, window: other }),
      )
      .map((other) => other.usedPercent),
  );
  return { ...window, usedPercent: Math.max(window.usedPercent, ...sameWindowPercents) };
}

/**
 * The readings one file's tail contributes: its newest informative reading, or its newest reading of any kind
 * when none is — and, when that informative reading is Codex's WINDOWLESS exhaustion event, also the newest
 * reading in the same file that carries an open window.
 *
 * Scans newest-line-first. A file whose LAST line is the empty post-cap shape but whose earlier lines carry the
 * window it was spending is why it reads past an uninformative line. It reads past the exhaustion event for
 * the same reason: a session writes its weekly 100% readings and then that event as its last line. MEASURED,
 * found on disk by a fallback review of this diff — weekly 100% three times, then the windowless event:
 * `tail -c 4000 ~/.codex/sessions/2026/09/11/rollout-2026-09-11T17-28-52-a0000068-*.jsonl`. Keeping only the
 * event would drop the file's own window readings before {@link pickGauge} could raise a sibling file's
 * dipped 97% to them.
 *
 * @param text the tail to search
 * @returns the readings, newest first, and whether the tail held everything this file can contribute — a
 *   caller reads further back while it did not
 */
function newestReadingsIn({ nowMs, text }: { nowMs: number; text: string }): {
  complete: boolean;
  readings: readonly CodexGauge[];
} {
  const lines = text.split("\n");
  const informative = newestReadingMatching({ from: lines.length - 1, lines, matches: isInformative, nowMs });
  if (informative === undefined) {
    const newestAny = newestReadingMatching({ from: lines.length - 1, lines, matches: () => true, nowMs });
    return { complete: false, readings: newestAny === undefined ? [] : [newestAny.gauge] };
  }
  if (hasOpenWindow({ gauge: informative.gauge })) {
    return { complete: true, readings: [informative.gauge] };
  }
  const windowed = newestReadingMatching({ from: informative.index - 1, lines, matches: hasOpenWindow, nowMs });
  if (windowed === undefined) {
    return { complete: false, readings: [informative.gauge] };
  }
  return { complete: true, readings: [informative.gauge, windowed.gauge] };
}

/**
 * The newest reading at or before line `from` that `matches`, skipping one claiming a time after the scan.
 *
 * @param from the index of the newest line to consider
 * @param matches which readings qualify
 * @returns the reading and its line index, or undefined when no line qualifies
 */
function newestReadingMatching({
  from,
  lines,
  matches,
  nowMs,
}: {
  from: number;
  lines: readonly string[];
  matches: (args: { gauge: CodexGauge }) => boolean;
  nowMs: number;
}): { gauge: CodexGauge; index: number } | undefined {
  for (let index = from; index >= 0; index--) {
    const gauge = parseGaugeLine({ line: lines[index]! });
    if (gauge !== undefined && !observedAfter({ gauge, nowMs }) && matches({ gauge })) {
      return { gauge, index };
    }
  }
  return undefined;
}

/**
 * The readings one file contributes (see {@link newestReadingsIn}), reading back past a fixed tail when that
 * tail did not hold them all — so a reading written just before an oversized line is never masked by the line
 * (see `readRolloutTailUntil`).
 *
 * @param path the rollout file to read
 * @returns the readings, newest first, empty when the file carries none; `undefined` when it could not be read
 */
function newestReadingsInFile({ nowMs, path }: { nowMs: number; path: string }): readonly CodexGauge[] | undefined {
  const text = readRolloutTailOrUnread({
    holds: (slice) => newestReadingsIn({ nowMs, text: slice }).complete,
    initialBytes: GAUGE_TAIL_BYTES,
    path,
  });
  if (text === undefined) {
    return undefined;
  }
  return newestReadingsIn({ nowMs, text }).readings;
}

/**
 * Whether a reading claims to have been taken after the scan instant. Only a skewed clock or a hand-edited
 * file writes one, `./rank.ts` already refuses to believe it, and a Codex review showed it winning the pick
 * and then being refused, taking a true reading down with it — so the scan never keeps one.
 */
function observedAfter({ gauge, nowMs }: { gauge: CodexGauge; nowMs: number }): boolean {
  const observedMs = parseIsoMs({ tsIso: gauge.observedAtIso });
  return observedMs !== undefined && observedMs > nowMs;
}

/**
 * Pick the reading with the latest OBSERVED instant — PARSED, never compared as text.
 *
 * Comparing the two ISO strings is wrong: take an instant written with a `+01:00` offset against one written
 * in `Z` form 31 minutes later: the offset-bearing string sorts ABOVE the
 * `Z` one while being the earlier instant by 31 minutes, so a stale reading won and the gauge reported an
 * old budget as current. `quotaGate.ts`'s `strictlyLater` already carried exactly this fix; this function
 * did not, which is the same defect in two places rather than one rule with an exception.
 *
 * A reading whose instant will not parse is never picked over one that does — an unreadable timestamp is not
 * evidence of freshness — but is still returned when it is all there is, because a gauge nobody can date is
 * more useful than no gauge at all and `./gaugeRender.ts` prints its age as unknown.
 *
 * @param gauges every reading found, in any order
 * @returns the latest, or undefined when there were none
 */
export function latestGauge({ gauges }: { gauges: readonly CodexGauge[] }): CodexGauge | undefined {
  return gauges.reduce<CodexGauge | undefined>((latest, gauge) => {
    if (latest === undefined) {
      return gauge;
    }
    const candidate = parseIsoMs({ tsIso: gauge.observedAtIso });
    const incumbent = parseIsoMs({ tsIso: latest.observedAtIso });
    if (candidate === undefined) {
      return latest;
    }
    if (incumbent === undefined) {
      return gauge;
    }
    return candidate > incumbent ? gauge : latest;
  }, undefined);
}

/**
 * Whether no file modified at or before `nextMtimeMs` could hold an informative reading later than the best
 * one already found, nor a higher mark of any of its windows — the walk's one stopping rule (see the header's
 * "When the walk may stop"). An undatable best reading or window never stops the walk, because nothing can be
 * proved older than it.
 *
 * @param gauges every reading found so far
 * @param nextMtimeMs the mtime of the next file in newest-first order
 * @param nowMs the scan instant, which bounds how recently a window no reading has named yet could have opened
 * @returns true when the walk may stop
 */
function walkMayStop({
  gauges,
  nextMtimeMs,
  nowMs,
}: {
  gauges: readonly CodexGauge[];
  nextMtimeMs: number;
  nowMs: number;
}): boolean {
  if (!unseenLabelsSettled({ gauges, nextMtimeMs, nowMs })) {
    return false;
  }
  const best = latestGauge({ gauges: gauges.filter((gauge) => isInformative({ gauge })) });
  const bestMs = best === undefined ? undefined : parseIsoMs({ tsIso: best.observedAtIso });
  if (bestMs === undefined || bestMs <= nextMtimeMs) {
    return false;
  }
  // The windows a report names come per label from the newest reading holding each one OPEN, which need not be
  // `best`: so every label seen needs such a source, and each source must be settled. Without the first check a
  // windowless reached reading, or a label read only after its reset, stops the walk vacuously in front of
  // the older reading of that label still open (two Codex reviews).
  const sources = windowSources({ gauges });
  if (sources.length === 0 || sources.length < labelsSeen({ gauges })) {
    return false;
  }
  return sources.every(({ gauge, window }) => {
    const observedMs = parseIsoMs({ tsIso: gauge.observedAtIso });
    return (
      observedMs !== undefined && observedMs > nextMtimeMs && noHigherMarkPossible({ nextMtimeMs, observedMs, window })
    );
  });
}

/**
 * The width of every window label Codex has written. MEASURED over both registered homes: 10,080
 * and 300 minutes and no other (`rg -o --no-filename '"window_minutes":[0-9]+' <home>/sessions | sort | uniq -c`).
 */
const KNOWN_WINDOW_WIDTH_MS: ReadonlyMap<CodexWindowReading["label"], number> = new Map([
  ["five-hour", 300 * 60_000],
  ["weekly", 10_080 * 60_000],
]);

/**
 * Whether no unread file could hold a still-open window of a label no reading read so far has named.
 *
 * A reading need not carry every label its account reports: `~/.codex` interleaves weekly-only readings with
 * five-hour-and-weekly ones across a season, so a newer weekly-only file can sit in front of an
 * older one holding a current five-hour cap (a Codex review). A window open at `nowMs` opened after
 * `nowMs` less its width, so a reading of it sits in a file modified after that too — and a file older than
 * it, less the same-window tolerance, cannot hold one.
 */
function unseenLabelsSettled({
  gauges,
  nextMtimeMs,
  nowMs,
}: {
  gauges: readonly CodexGauge[];
  nextMtimeMs: number;
  nowMs: number;
}): boolean {
  const seen = new Set(gauges.flatMap((gauge) => gauge.windows.map((window) => window.label)));
  return [...KNOWN_WINDOW_WIDTH_MS].every(
    ([label, widthMs]) => seen.has(label) || nextMtimeMs < nowMs - widthMs - SAME_WINDOW_TOLERANCE_MS,
  );
}

/**
 * Whether no unread file could carry a HIGHER reading of this window than the best one already holds: the
 * window is already full, or every unread file was last written before the window opened. Either needs the
 * window still open when the reading was taken — a reading of an already-reset window describes nothing
 * current, so it never ends the walk (a Codex review stamped one on a future-dated file).
 */
function noHigherMarkPossible({
  nextMtimeMs,
  observedMs,
  window,
}: {
  nextMtimeMs: number;
  observedMs: number;
  window: CodexWindowReading;
}): boolean {
  const resetMs = window.resetAtIso === undefined ? undefined : parseIsoMs({ tsIso: window.resetAtIso });
  if (resetMs === undefined || resetMs <= observedMs) {
    return false;
  }
  if (window.usedPercent >= 100) {
    return true;
  }
  if (window.windowMinutes === undefined) {
    return false;
  }
  // Less the same-window tolerance: a reading of this window may name a reset up to that much EARLIER, so
  // the window may have opened that much sooner than this reading's own reset says (a Codex review).
  return nextMtimeMs < resetMs - window.windowMinutes * 60_000 - SAME_WINDOW_TOLERANCE_MS;
}

/**
 * Read Codex's freshest budget reading.
 *
 * @param codexHome the Codex home to scan (see {@link ../codex/quotaLog.resolveCodexHome})
 * @param nowMs the scan instant; a reading claiming a later one is dropped, and a test passes a fixed instant
 * @returns the reading and what the scan covered; `gauge: undefined` means no opened file held one, which is
 *   an ordinary state — Codex writes a reading only when a turn runs
 */
export function scanCodexGauge({
  codexHome,
  nowMs = Date.now(),
}: {
  codexHome: string;
  nowMs?: number;
}): CodexGaugeScan {
  const walk = walkRollouts({ codexHome });
  const ordered = rolloutsNewestFirst({ candidates: walk.candidates });
  const horizonMs = horizonStartMs({ newestFirst: ordered, nowMs, windowMs: GAUGE_HORIZON_MS });
  const gauges: CodexGauge[] = [];
  let filesRead = 0;
  let filesUnreadable = walk.hiddenPlaces;
  for (const candidate of ordered) {
    if (
      pastHorizon({ gauges, horizonMs, nextMtimeMs: candidate.mtimeMs }) ||
      walkMayStop({ gauges, nextMtimeMs: candidate.mtimeMs, nowMs })
    ) {
      break;
    }
    filesRead += 1;
    const readings = newestReadingsInFile({ nowMs, path: candidate.path });
    if (readings === undefined) {
      filesUnreadable += 1;
      continue;
    }
    gauges.push(...readings);
  }
  return { filesRead, filesSkipped: ordered.length - filesRead, filesUnreadable, gauge: pickGauge({ gauges }) };
}
