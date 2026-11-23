/**
 * `console-sync-failed` — failed browser-triggered refreshes visible to the local monitor sweep.
 *
 * ONE subject for the whole set, never one per failure: a card per subject is only for the owner's own act
 * (`../hand/step.ts`, rule 6), and a failed refresh is a check-in a seat repairs. The subject is keyed by the LAST
 * failure to arrive inside the window, so every further failure re-cuts the card, and every failure in the window
 * sits behind its disclosure row.
 *
 * A failure the ledger refused is read from its fallback (`../live/consoleSyncFailureStore.ts`) and cards exactly as
 * one the ledger kept, its refusal named on the card's first detail line — so a ledger path turned into a directory,
 * or a `live/` the console cannot write to, never keeps a failed run off the card.
 */
import type { Result } from "#lib/result.js";

import { DETAIL_LINE_CAP, DETAILS_MAX } from "../hand/details.js";
import { fitLine } from "../hand/push/notice.js";
import type {
  ConsoleSyncAppendFailure,
  ConsoleSyncAppendFailureLedger,
  ConsoleSyncFailure,
  ConsoleSyncLedger,
} from "../live/consoleSyncFailureStore.js";

import type { MonitorReading } from "./types.js";

/** How long a failed run remains actionable to the sweep. */
const CONSOLE_SYNC_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * What the card unblocks, in fixed words. Every field a posting gate reads is fixed text on this card — `what`,
 * `unblocks` and its id's prefix — because a failed verb's stderr can carry a proof word, a run id or a UUID that
 * those gates refuse. The raw reasons sit only in `details`, which the register checks for shape alone.
 *
 * It names where each failure is read rather than promising a list: the Queue card never draws `details`, and this
 * monitor does not float a note (the registry keeps `floats` for notes the owner asked for), so the one place every
 * failure and its reason always prints is the monitor's own check.
 */
export const CONSOLE_SYNC_UNBLOCKS =
  "the console readings those failed refreshes left stale; slopweaver monitor check --only console-sync-failed prints each failure and its reason";

/**
 * Judge the console sync failure ledger and its fallback: one check-in subject naming the latest failure to arrive
 * inside the window, from either, with every failure in it, newest start first, behind the disclosure row.
 *
 * A damaged line never hides a decodable failure: the card still fires, naming the damage in its first detail lines,
 * and a failure the ledger refused names that refusal there too. One ledger that cannot be read is the reading's
 * blind spot while the other still holds a recent failure. The reading is unmeasurable only when no recent failure
 * decodes from either and one of them cannot be read or holds damage — then a failure could be hiding there, so it
 * never reads clear.
 *
 * @param ledger the ledger as read: its decoded rows and damaged count, or why it could not be read
 * @param appendFailures the fallback as read: each failure the ledger refused, or why it could not be read
 * @returns firing over any recent failure, clear with none, or unmeasurable as above
 */
export function evaluateConsoleSyncFailed({
  appendFailures,
  ledger,
  nowIso,
}: {
  appendFailures: Result<ConsoleSyncAppendFailureLedger>;
  ledger: Result<ConsoleSyncLedger>;
  nowIso: string;
}): MonitorReading {
  const sinceMs = Date.parse(nowIso) - CONSOLE_SYNC_FAILURE_WINDOW_MS;
  const isRecent = (failure: ConsoleSyncFailure): boolean => Date.parse(failure.startedAtIso) >= sinceMs;
  const kept = recentOf({ isRecent, name: "console sync failure ledger", read: ledger });
  const refused = recentOf({
    isRecent: (row) => isRecent(row.failure),
    name: "console sync failure fallback ledger",
    read: appendFailures,
  });
  const unreadable = [...kept.unreadable, ...refused.unreadable];
  const damage = [...kept.damage, ...refused.damage];
  // The ledger may have kept a row whose append still threw afterwards (a failed fsync), so a refused id it holds is
  // one failure, counted once, with its refusal still named.
  const keptIds = new Set(kept.entries.map((entry) => entry.row.failureId));
  const recent = mergeByArrival({
    kept: kept.entries,
    refused: refused.entries.filter((entry) => !keptIds.has(entry.row.failure.failureId)),
  });
  const latest = recent.at(-1);
  if (latest === undefined) {
    const hiding = [...unreadable, ...damage];
    if (hiding.length > 0) {
      return {
        because: `${hiding.join("; ")}, and no failure inside 24 hours decodes`,
        monitorId: "console-sync-failed",
        state: "unmeasurable",
      };
    }
    return { monitorId: "console-sync-failed", state: "clear" };
  }
  return firingReading({ damage, latest, recent, refused: refused.entries.map((entry) => entry.row), unreadable });
}

/** One ledger as read: its recent rows with where each starts, why it could not be read, and its damage line. */
interface RecentRows<Row> {
  readonly entries: readonly Positioned<Row>[];
  readonly unreadable: readonly string[];
  readonly damage: readonly string[];
}

/** A row, where its line starts in its own file, and the generation that file carries now. */
interface Positioned<Row> {
  readonly row: Row;
  readonly byteOffset: number;
  readonly generation: string | undefined;
}

/** The recent rows of one ledger, each with its byte offset and its file's generation, or why it could not be read. */
function recentOf<Row>({
  isRecent,
  name,
  read,
}: {
  isRecent: (row: Row) => boolean;
  name: string;
  read: Result<{
    failures: readonly Row[];
    byteOffsets: readonly number[];
    damaged: number;
    generation: string | undefined;
    path: string;
  }>;
}): RecentRows<Row> {
  if (read.isErr()) {
    return { damage: [], entries: [], unreadable: [read.error.join("; ")] };
  }
  const { byteOffsets, damaged, failures, generation, path } = read.value;
  const entries = failures
    .map((row, index) => ({ byteOffset: byteOffsets[index]!, generation, row }))
    .filter((entry) => isRecent(entry.row));
  return { damage: damaged > 0 ? [damageLine({ damaged, name, path })] : [], entries, unreadable: [] };
}

/** The one firing subject over the recent failures, keyed by the latest to arrive. */
function firingReading({
  damage,
  latest,
  recent,
  refused,
  unreadable,
}: {
  damage: readonly string[];
  latest: ConsoleSyncFailure;
  recent: readonly ConsoleSyncFailure[];
  refused: readonly ConsoleSyncAppendFailure[];
  unreadable: readonly string[];
}): MonitorReading {
  const failureLines = recent
    .toSorted((a, b) => Date.parse(b.startedAtIso) - Date.parse(a.startedAtIso))
    .map((failure) => failureLine({ failure }));
  // First, so the cap on the note's lines never cuts them.
  const lines = [...refusalLines({ refused }), ...damage, ...failureLines];
  let label = failureLine({ failure: latest });
  if (recent.length > 1) {
    label = `${String(recent.length)} console refreshes failed in 24 hours; the latest to fail: ${label}`;
  }
  return {
    // Only when one ledger is unreadable, so a whole read carries no blind-spot key at all.
    ...(unreadable.length === 0 ? {} : { blindSpot: unreadable.join("; ") }),
    monitorId: "console-sync-failed",
    state: "firing",
    subjects: [
      {
        checkIn: true,
        details: detailsOnTheNote({ lines }),
        detailsInFull: lines,
        id: `console sync ${latest.failureId}`,
        key: latest.failureId,
        label,
      },
    ],
  };
}

/** A ledger row and where its line starts in the ledger. */
type Kept = Positioned<ConsoleSyncFailure>;

/** A fallback row and where its line starts in the fallback. */
type Refused = Positioned<ConsoleSyncAppendFailure>;

/**
 * The recent failures from both ledgers in the order they ARRIVED, so the last is the latest to fail. Each ledger is
 * already in that order: the route stamps the start before the verb runs and appends only once it has failed, so a
 * ledger's order is the order runs FINISHED — a long run failing after a later, quicker one included, and a tie on the
 * start. Across the two, {@link refusedArrivedFirst} reads the order each row RECORDED, and a merge on it keeps each
 * ledger's own order whole. When the latest leaves the window first, the key falls back to the last still inside it,
 * and the card is re-cut to say only what the window still holds.
 */
function mergeByArrival({
  kept,
  refused,
}: {
  kept: readonly Kept[];
  refused: readonly Refused[];
}): readonly ConsoleSyncFailure[] {
  const merged: ConsoleSyncFailure[] = [];
  let k = 0;
  let r = 0;
  while (k < kept.length && r < refused.length) {
    if (refusedArrivedFirst({ kept: kept[k]!, refused: refused[r]! })) {
      merged.push(refused[r]!.row.failure);
      r += 1;
    } else {
      merged.push(kept[k]!.row);
      k += 1;
    }
  }
  return [...merged, ...kept.slice(k).map((entry) => entry.row), ...refused.slice(r).map((entry) => entry.row.failure)];
}

/**
 * Whether a refused row reached the fallback before a ledger row reached the ledger, by what the two RECORDED rather
 * than by a clock that can step back or tie. Every row stores the other file's size and generation as it was written,
 * and the writes are synchronous in one process, so a row starting below that size was already there — while the
 * file still carries that generation. A file deleted or emptied by hand comes back under a new one, and a size
 * recorded for the old file says nothing about the new one's offsets:
 *
 * 1. the ledger row's `fallbackBytes`, when it was recorded under the fallback's current generation;
 * 2. else the refused row's `ledgerBytes`, when it was recorded under the ledger's current generation;
 * 3. else the console's clock: start plus run time, a tie taking the refused row as the later. Only this arm can
 *    misorder, and it is reached only when neither recorded size applies — neither file measurable when its row was
 *    written, a row written before either field existed, or both files replaced since.
 *
 * A recorded size of zero applies under any generation, since no row in any file starts below byte zero. A nonzero
 * size recorded with no generation — a row written before the field existed — applies to nothing, because a file
 * could have been replaced since and nothing on the row says it was not.
 */
function refusedArrivedFirst({ kept, refused }: { kept: Kept; refused: Refused }): boolean {
  const fallbackBytes = kept.row.fallbackBytes;
  if (
    fallbackBytes !== undefined &&
    recordedSizeApplies({
      bytes: fallbackBytes,
      currentGeneration: refused.generation,
      recordedGeneration: kept.row.fallbackGeneration,
    })
  ) {
    return refused.byteOffset < fallbackBytes;
  }
  const ledgerBytes = refused.row.ledgerBytes;
  if (
    ledgerBytes !== undefined &&
    recordedSizeApplies({
      bytes: ledgerBytes,
      currentGeneration: kept.generation,
      recordedGeneration: refused.row.ledgerGeneration,
    })
  ) {
    return kept.byteOffset >= ledgerBytes;
  }
  return finishedMs({ failure: refused.row.failure }) < finishedMs({ failure: kept.row });
}

/**
 * Whether a size one file's row recorded for the other still locates the other's rows: it is zero, which holds for any
 * file, or it was recorded with a generation and that is the generation the file has now.
 */
function recordedSizeApplies({
  bytes,
  currentGeneration,
  recordedGeneration,
}: {
  bytes: number;
  currentGeneration: string | undefined;
  recordedGeneration: string | undefined;
}): boolean {
  return bytes === 0 || (recordedGeneration !== undefined && recordedGeneration === currentGeneration);
}

/** When a failed run finished, by the console's own clock. */
function finishedMs({ failure }: { failure: ConsoleSyncFailure }): number {
  return Date.parse(failure.startedAtIso) + failure.tookMs;
}

/** The line naming a ledger's undecodable lines. */
function damageLine({ damaged, name, path }: { damaged: number; name: string; path: string }): string {
  return `${String(damaged)} line(s) in the ${name} at ${path} did not decode`;
}

/**
 * One line naming the ledger's refusal of the recent failures its fallback holds, with the latest error, so a seat
 * repairs the ledger as well as the refresh. Empty when the ledger refused none.
 */
function refusalLines({ refused }: { refused: readonly ConsoleSyncAppendFailure[] }): readonly string[] {
  const last = refused.at(-1);
  if (last === undefined) {
    return [];
  }
  const line = `the console sync failure ledger refused ${String(refused.length)} failure(s), read from its fallback instead; the latest refusal: ${last.appendError}`;
  return [line.replace(/\s+/gu, " ").replaceAll("[hand:", "[hand ").trim()];
}

/**
 * One failure as the sentence its detail line and the label carry, on ONE line: the register refuses a multi-line
 * detail entry outright, which would post no card at all. A `[hand:` in the text is broken too, so a reason ending
 * in one is never drawn as a control opening some other card (`../hand/details.ts`'s act marker).
 */
function failureLine({ failure }: { failure: ConsoleSyncFailure }): string {
  return `${failure.title} failed at ${failure.startedAtIso}: ${failure.why}`
    .replace(/\s+/gu, " ")
    .replaceAll("[hand:", "[hand ")
    .trim();
}

/**
 * The lines fitted inside the register's caps (`../hand/details.ts`), which refuses rather than cuts: each line cut
 * at a word and marked, and a list past the cap ending on the verb that prints every one.
 */
function detailsOnTheNote({ lines }: { lines: readonly string[] }): readonly string[] {
  const fitted = lines.map((line) => fitDetail({ text: line }));
  if (fitted.length <= DETAILS_MAX) {
    return fitted;
  }
  const kept = fitted.slice(0, DETAILS_MAX - 1);
  const more = fitted.length - kept.length;
  return [...kept, `+${String(more)} more — slopweaver monitor check --only console-sync-failed prints every one`];
}

/** One line inside {@link DETAIL_LINE_CAP}, cut at a word boundary and marked where it was cut. */
function fitDetail({ text }: { text: string }): string {
  const whole = text.trim();
  if (whole.length <= DETAIL_LINE_CAP) {
    return whole;
  }
  return `${fitLine({ cap: DETAIL_LINE_CAP - 1, text: whole }).replace(/[\s,;:—-]+$/u, "")}…`;
}
