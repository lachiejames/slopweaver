/**
 * When the console reads a failed Alignment reading again, and what the count says it is doing about it. Pure: the
 * runner that holds the record, arms the timer and calls `refreshLive` is `../components/console/useAlignmentAutoRefresh.ts`.
 *
 * A failed reading needs an owner that reads it again, or its warning stands until a reload. Two of the Alignment
 * count's readings are read ONCE per console session — the autonomy ledger and the owner's answers — and the live
 * channel re-reads only a fetch that never reached its verb (`../components/live/useLiveFetch.ts` `owe`), so a verb's
 * own failure on either stood until a press or a reload. Its other readings poll and recover on their own poll.
 *
 * The backoff starts at a minute and doubles to a ten-minute cap: a failing verb is never looped on, and a read that
 * failed once in passing is asked again within the minute. A hidden window asks nothing
 * (`../components/live/useLive.ts` § onVisibility): what is due waits until it is seen.
 */

/** The Alignment count's read-once channels, by live slug: the ones the runner reads again. */
export const ALIGNMENT_RETRY_SOURCES = ["autonomy", "alignment-answers"] as const;

/** One of the read-once channels the runner owns. */
export type AlignmentRetrySource = (typeof ALIGNMENT_RETRY_SOURCES)[number];

/** The first re-read's wait. */
const FIRST_RETRY_MS = 60_000;

/** The longest wait between re-reads. */
const MAX_RETRY_MS = 600_000;

/**
 * How long the runner waits before its re-read number `attempt` of a reading whose latest read failed.
 *
 * @param attempt how many re-reads of it have already failed, zero for the first
 * @returns the wait, doubling from a minute to the ten-minute cap
 */
export function alignmentRetryDelayMs({ attempt }: { attempt: number }): number {
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, attempt));
}

/** How one source's latest read stands, as the runner judges it. */
export interface AlignmentSourceRead {
  readonly slug: AlignmentRetrySource;
  readonly phase: "current" | "loading" | "failed";
  /** The reading object itself, so a re-read's own answer is told from the failure it was asked over. */
  readonly token: unknown;
}

/** The runner's record of one source it is recovering. */
export interface AlignmentRetryRecord {
  /** How many re-reads of it have failed so far. */
  readonly attempt: number;
  /** When its next re-read falls due (epoch ms). */
  readonly dueAtMs: number;
  /** The failed reading the re-read in flight was asked over, or `undefined` while none is. */
  readonly askedOver?: unknown;
}

/** Every source the runner is recovering, keyed by slug. */
export type AlignmentRetryRecords = Readonly<Partial<Record<AlignmentRetrySource, AlignmentRetryRecord>>>;

/** What the Alignment count says the console is doing about a failed reading. */
export type AlignmentRecovery =
  | { readonly phase: "idle" }
  | { readonly phase: "reading" }
  | { readonly phase: "waiting"; readonly atMs: number; readonly visible: boolean };

/** One step of the runner: its record after this look, what to read again now, when to look next, and what to say. */
export interface AlignmentRecoveryStep {
  readonly records: AlignmentRetryRecords;
  readonly due: readonly AlignmentRetrySource[];
  readonly wakeAtMs: number | undefined;
  readonly recovery: AlignmentRecovery;
}

/** One source's record after this look, before anything due is asked. */
function recordAfter({
  read,
  record,
  nowMs,
}: {
  read: AlignmentSourceRead;
  record: AlignmentRetryRecord | undefined;
  nowMs: number;
}): AlignmentRetryRecord | undefined {
  if (read.phase === "current") {
    return undefined;
  }
  if (read.phase === "loading") {
    return record;
  }
  if (record === undefined) {
    // A first failure waits its first backoff: never an immediate re-read, which a failing verb would loop on.
    return { attempt: 0, dueAtMs: nowMs + alignmentRetryDelayMs({ attempt: 0 }) };
  }
  if (record.askedOver !== undefined && record.askedOver !== read.token) {
    // The re-read in flight answered, and failed again: the next waits one step longer.
    const attempt = record.attempt + 1;
    return { attempt, dueAtMs: nowMs + alignmentRetryDelayMs({ attempt }) };
  }
  return record;
}

/**
 * One look by the runner: fold each source's latest read into its record, ask again every source due while the window
 * is in view, and say what the count should report. A source that reads current leaves the record; one that fails
 * again after a re-read moves one step along its backoff; nothing is due while the window is hidden.
 *
 * @param reads each read-once source's latest read
 * @param records the runner's record before this look
 * @param visible whether the console's window is in view
 * @returns the record after it, what to read again now, the next instant to look, and the recovery to report
 */
export function alignmentRecoveryStepOf({
  reads,
  records,
  nowMs,
  visible,
}: {
  reads: readonly AlignmentSourceRead[];
  records: AlignmentRetryRecords;
  nowMs: number;
  visible: boolean;
}): AlignmentRecoveryStep {
  const next: Partial<Record<AlignmentRetrySource, AlignmentRetryRecord>> = {};
  const due: AlignmentRetrySource[] = [];
  for (const read of reads) {
    const after = recordAfter({ nowMs, read, record: records[read.slug] });
    if (after === undefined) {
      continue;
    }
    if (visible && after.askedOver === undefined && after.dueAtMs <= nowMs) {
      due.push(read.slug);
      next[read.slug] = { ...after, askedOver: read.token };
      continue;
    }
    next[read.slug] = after;
  }
  const kept = Object.values(next);
  const waiting = kept.filter((record) => record.askedOver === undefined).map((record) => record.dueAtMs);
  let wakeAtMs: number | undefined;
  if (waiting.length > 0) {
    wakeAtMs = Math.min(...waiting);
  }
  let recovery: AlignmentRecovery = { phase: "idle" };
  if (kept.some((record) => record.askedOver !== undefined)) {
    recovery = { phase: "reading" };
  } else if (wakeAtMs !== undefined) {
    recovery = { atMs: wakeAtMs, phase: "waiting", visible };
  }
  return { due, recovery, records: next, wakeAtMs };
}

/**
 * The runner's state as the window stands NOW. A step records whether the window was in view when it ran, and the next
 * step runs only after the render a visibility change causes, so a waiting step taken in view would otherwise word a
 * retry time for one render after the window is hidden — a time the runner will skip. The same object comes back
 * whenever nothing differs, so a consumer keyed on its identity sees no change.
 *
 * @param recovery the runner's last step
 * @param visible whether the window is in view at this render
 * @returns the step with its `visible` flag read live
 */
export function alignmentRecoveryAsSeenOf({
  recovery,
  visible,
}: {
  recovery: AlignmentRecovery;
  visible: boolean;
}): AlignmentRecovery {
  if (recovery.phase !== "waiting" || recovery.visible === visible) {
    return recovery;
  }
  return { ...recovery, visible };
}

/**
 * What the count says the console does next about a failed reading, off the runner's real state — never a promise its
 * age implies. A failure the runner does not own is one of the polled readings, which the console reads again on its
 * own poll while the window is in view.
 *
 * @param recovery the runner's state
 * @param clock an instant (epoch ms) in the reader's own clock words ("at <time>")
 * @returns the sentence, without its closing stop
 */
export function alignmentRecoveryWordsOf({
  recovery,
  nowMs,
  clock,
}: {
  recovery: AlignmentRecovery;
  nowMs: number;
  clock: (atMs: number) => string;
}): string {
  if (recovery.phase === "reading") {
    return "The console is reading it again now";
  }
  if (recovery.phase === "idle") {
    return "The console reads it again on its next poll, within a minute while this window is in view";
  }
  if (recovery.visible) {
    return `The console tries again ${clock(recovery.atMs)}`;
  }
  // Hidden past its due instant: the next act is the re-read the moment the window is seen, so no instant is named.
  if (recovery.atMs <= nowMs) {
    return "The console tries again once this window is in view";
  }
  return `The console tries again once this window is in view, not before ${clock(recovery.atMs)}`;
}
