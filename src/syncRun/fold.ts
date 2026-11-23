/**
 * One run file's rows folded into what the Automations page shows about that sync. Pure.
 *
 * Every number here is READ — a count a row carries, or a difference between two instants rows carry. There is no
 * projection of when the run will end and there never should be: the owner's complaint was a progress bar that
 * cannot say whether it is moving, and a guessed finish time is the same lie with a clock on it.
 */
import { DEFAULT_PROGRESS_CONFIG } from "../lib/progress.js";
import type { SyncKindCount, SyncRunEvent, SyncRunFinished, SyncRunProgress, SyncRunStarted } from "./event.js";
import { lastActivityIsoOf, lastCommittedIsoOf } from "./instants.js";

/**
 * Where a run stands.
 *
 * - `running` — no finish row, and the process that started it still holds that source's refresh slot.
 * - `finished` — it wrote a finish row saying it succeeded.
 * - `failed` — it wrote a finish row saying it did not.
 * - `ended-unfinished` — no finish row, and its process no longer holds the slot: killed or crashed part-way.
 * - `unreadable` — the file carries no readable `started` row, so nothing about it can be said.
 */
type SyncRunState = "running" | "finished" | "failed" | "ended-unfinished" | "unreadable";

/** One container's totals across every commit this run made to it. */
interface SyncContainerView {
  readonly container: string;
  readonly label: string;
  readonly kinds: Readonly<Record<string, SyncKindCount>>;
  readonly offered: number;
  readonly written: number;
}

/** A rate between two of this run's own rows: how much moved, over which measured span. */
interface MeasuredRate {
  readonly amount: number;
  /** What was counted — a phase's unit (`channel`, `repos`) or `new rows`. */
  readonly unit: string;
  readonly overMs: number;
}

/** The newest progress checkpoint, as the connector reported it. */
interface SyncProgressView {
  readonly atIso: string;
  readonly phase: string;
  readonly done?: number;
  readonly total?: number;
  readonly item?: string;
  readonly metrics: Readonly<Record<string, number>>;
}

/** Everything the page says about one run. */
export interface SyncRunView {
  readonly runId: string;
  readonly source: string;
  readonly state: SyncRunState;
  /** One sentence a person can act on, built from the rows. */
  readonly why: string;
  readonly pid: number | null;
  readonly startedAtIso: string | null;
  readonly finishedAtIso: string | null;
  /** The window the run was asked to read, `YYYY-MM-DD` to `YYYY-MM-DD` exclusive, or `null` when unreadable. */
  readonly window: { readonly since: string; readonly until: string } | null;
  /** Start to finish, or start to now while it runs. */
  readonly elapsedMs: number | null;
  /** The newest row's instant — the last time this run said anything at all. */
  readonly lastActivityIso: string | null;
  /** How long since that row, while the run is `running`; `null` otherwise. */
  readonly quietForMs: number | null;
  /** True when a running run has been quiet longer than the terminal's own stall mark. */
  readonly stalled: boolean;
  readonly progress: SyncProgressView | null;
  /** New rows the ledger saw committed, over the run's elapsed time. `null` before anything was committed. */
  readonly writtenRate: MeasuredRate | null;
  /** Progress between the newest two checkpoints of the same phase, when both carry a `done`. */
  readonly progressRate: MeasuredRate | null;
  /** Containers with new rows, most first. */
  readonly containers: readonly SyncContainerView[];
  /** Containers that were offered records and had nothing new. */
  readonly quietContainers: readonly SyncContainerView[];
  /** New rows by record kind, summed over every container. */
  readonly newByKind: Readonly<Record<string, number>>;
  /** New rows the ledger saw committed. */
  readonly committedWritten: number;
  /** When the newest commit that wrote new rows landed — never a later progress or finish row; `null` before one. */
  readonly lastCommittedIso: string | null;
  /** The run's own reported totals, once it finished. */
  readonly reported: { readonly written: number; readonly deduped: number; readonly excluded: number } | null;
  readonly errors: readonly string[];
  readonly warnings: number;
  readonly gaps: number;
  readonly ledgerFailures: number;
  /** Lines in the run file that did not decode. */
  readonly malformedLines: number;
}

/** How long a running sync may say nothing before it reads as stalled — the terminal emitter's own mark. */
const SYNC_STALL_MS = DEFAULT_PROGRESS_CONFIG.stallMs;

/** Milliseconds between two ISO instants, or `null` when either fails to parse. */
function spanMs({ fromIso, toIso }: { fromIso: string; toIso: string }): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return null;
  }
  return to - from;
}

/** Fold every `committed` row into per-container totals, summing kind by kind. */
function containerViews({ events }: { events: readonly SyncRunEvent[] }): SyncContainerView[] {
  const byContainer = new Map<string, { label: string; kinds: Record<string, SyncKindCount> }>();
  for (const event of events) {
    if (event.type !== "committed") {
      continue;
    }
    let entry = byContainer.get(event.container);
    if (entry === undefined) {
      entry = { kinds: {}, label: event.label };
      byContainer.set(event.container, entry);
    }
    for (const [kind, tally] of Object.entries(event.kinds)) {
      const previous = entry.kinds[kind];
      entry.kinds[kind] =
        previous === undefined
          ? tally
          : { offered: previous.offered + tally.offered, written: previous.written + tally.written };
    }
  }
  return [...byContainer.entries()].map(([container, { label, kinds }]) => {
    const tallies = Object.values(kinds);
    return {
      container,
      kinds,
      label,
      offered: tallies.reduce((sum, tally) => sum + tally.offered, 0),
      written: tallies.reduce((sum, tally) => sum + tally.written, 0),
    };
  });
}

/** The rate between the newest two checkpoints of the newest phase, when both report `done`. */
function progressRateOf({ checkpoints }: { checkpoints: readonly SyncRunProgress[] }): MeasuredRate | null {
  const newest = checkpoints.at(-1);
  if (newest?.done === undefined) {
    return null;
  }
  const samePhase = checkpoints.filter(
    (checkpoint) => checkpoint.phase === newest.phase && checkpoint.done !== undefined,
  );
  const previous = samePhase.at(-2);
  if (previous?.done === undefined) {
    return null;
  }
  const overMs = spanMs({ fromIso: previous.atIso, toIso: newest.atIso });
  if (overMs === null || overMs <= 0 || newest.done < previous.done) {
    return null;
  }
  return { amount: newest.done - previous.done, overMs, unit: newest.phase };
}

/** The newest checkpoint as a view. */
function progressViewOf({ checkpoint }: { checkpoint: SyncRunProgress | undefined }): SyncProgressView | null {
  if (checkpoint === undefined) {
    return null;
  }
  return {
    atIso: checkpoint.atIso,
    metrics: checkpoint.metrics,
    phase: checkpoint.phase,
    ...(checkpoint.done !== undefined ? { done: checkpoint.done } : {}),
    ...(checkpoint.total !== undefined ? { total: checkpoint.total } : {}),
    ...(checkpoint.item !== undefined ? { item: checkpoint.item } : {}),
  };
}

/** The state and the sentence that goes with it. */
function stateOf({
  started,
  finished,
  holding,
  lastActivityIso,
}: {
  started: SyncRunStarted;
  finished: SyncRunFinished | undefined;
  holding: boolean;
  lastActivityIso: string;
}): { state: SyncRunState; why: string } {
  if (finished?.ok === true) {
    return { state: "finished", why: `finished at ${finished.atIso}` };
  }
  if (finished !== undefined) {
    const [first] = finished.errors;
    if (first === undefined) {
      return {
        state: "failed",
        why: `finished at ${finished.atIso} and failed: it reported failure without an error line`,
      };
    }
    return { state: "failed", why: `finished at ${finished.atIso} and failed: ${first}` };
  }
  if (holding) {
    return { state: "running", why: `running in process ${String(started.pid)}` };
  }
  return {
    state: "ended-unfinished",
    why:
      `process ${String(started.pid)} no longer holds the ${started.source} refresh slot and the run never wrote its finish — it was killed or crashed ` +
      `after its last row at ${lastActivityIso}; the next refresh of ${started.source} re-reads the same window`,
  };
}

/** What the finish row reports, or the empty reading of a run that has not written one. */
function finishedFields({
  finished,
}: {
  finished: SyncRunFinished | undefined;
}): Pick<SyncRunView, "errors" | "finishedAtIso" | "gaps" | "ledgerFailures" | "reported" | "warnings"> {
  if (finished === undefined) {
    return { errors: [], finishedAtIso: null, gaps: 0, ledgerFailures: 0, reported: null, warnings: 0 };
  }
  return {
    errors: finished.errors,
    finishedAtIso: finished.atIso,
    gaps: finished.gaps,
    ledgerFailures: finished.ledgerFailures,
    reported: { deduped: finished.deduped, excluded: finished.excluded, written: finished.written },
    warnings: finished.warnings,
  };
}

/** New rows by record kind, summed over every container. */
function newByKindOf({ views }: { views: readonly SyncContainerView[] }): Record<string, number> {
  const byKind: Record<string, number> = {};
  for (const [kind, tally] of views.flatMap((view) => Object.entries(view.kinds))) {
    if (tally.written === 0) {
      continue;
    }
    const before = byKind[kind];
    byKind[kind] = before === undefined ? tally.written : before + tally.written;
  }
  return byKind;
}

/** New rows over the run's elapsed time, or `null` before anything was committed or when no time is measured. */
function writtenRateOf({
  committedWritten,
  elapsedMs,
}: {
  committedWritten: number;
  elapsedMs: number | null;
}): MeasuredRate | null {
  if (committedWritten === 0 || elapsedMs === null || elapsedMs <= 0) {
    return null;
  }
  return { amount: committedWritten, overMs: elapsedMs, unit: "new rows" };
}

/** A view of a file that carries no readable `started` row. */
function unreadableView({
  runId,
  source,
  malformedLines,
}: {
  runId: string;
  source: string;
  malformedLines: number;
}): SyncRunView {
  return {
    committedWritten: 0,
    containers: [],
    elapsedMs: null,
    errors: [],
    finishedAtIso: null,
    gaps: 0,
    lastActivityIso: null,
    lastCommittedIso: null,
    ledgerFailures: 0,
    malformedLines,
    newByKind: {},
    pid: null,
    progress: null,
    progressRate: null,
    quietContainers: [],
    quietForMs: null,
    reported: null,
    runId,
    source,
    stalled: false,
    startedAtIso: null,
    state: "unreadable",
    warnings: 0,
    why: "this run file has no readable start row, so nothing it holds can be attributed",
    window: null,
    writtenRate: null,
  };
}

/**
 * Fold one run file's rows into its view.
 *
 * @param runId the run the file is named for
 * @param source the source directory it was read from
 * @param events the file's decoded rows, in file order
 * @param malformedLines how many lines did not decode
 * @param nowIso the instant elapsed and quiet time are measured to
 * @param holdsSlot whether THIS run's process still holds the source's refresh slot — the pid, the source, and a slot
 *   taken no later than the run started, so a recycled pid refreshing the same source later cannot keep a dead run
 *   reading as running
 * @returns the run's view
 */
export function foldSyncRun({
  runId,
  source,
  events,
  malformedLines,
  nowIso,
  holdsSlot,
}: {
  runId: string;
  source: string;
  events: readonly SyncRunEvent[];
  malformedLines: number;
  nowIso: string;
  holdsSlot: (args: { pid: number; source: string; startedAtIso: string }) => boolean;
}): SyncRunView {
  const started = events.find((event): event is SyncRunStarted => event.type === "started");
  if (started === undefined) {
    return unreadableView({ malformedLines, runId, source });
  }
  const finished = events.find((event): event is SyncRunFinished => event.type === "finished");
  const checkpoints = events.filter((event): event is SyncRunProgress => event.type === "progress");
  const lastActivityIso = lastActivityIsoOf({ events, startedAtIso: started.atIso });
  const { state, why } = stateOf({
    finished,
    lastActivityIso,
    holding:
      finished === undefined && holdsSlot({ pid: started.pid, source: started.source, startedAtIso: started.atIso }),
    started,
  });
  const endIso = finished === undefined ? nowIso : finished.atIso;
  const elapsedMs = spanMs({ fromIso: started.atIso, toIso: endIso });
  const quietForMs = state === "running" ? spanMs({ fromIso: lastActivityIso, toIso: nowIso }) : null;
  const all = containerViews({ events });
  const committedWritten = all.reduce((sum, view) => sum + view.written, 0);
  return {
    committedWritten,
    containers: all.filter((view) => view.written > 0).toSorted((a, b) => b.written - a.written),
    elapsedMs,
    ...finishedFields({ finished }),
    lastActivityIso,
    lastCommittedIso: lastCommittedIsoOf({ events }),
    malformedLines,
    newByKind: newByKindOf({ views: all }),
    pid: started.pid,
    progress: progressViewOf({ checkpoint: checkpoints.at(-1) }),
    progressRate: progressRateOf({ checkpoints }),
    quietContainers: all.filter((view) => view.written === 0),
    quietForMs,
    runId,
    source,
    stalled: quietForMs !== null && quietForMs > SYNC_STALL_MS,
    startedAtIso: started.atIso,
    state,
    why,
    window: { since: started.since, until: started.until },
    writtenRate: writtenRateOf({ committedWritten, elapsedMs }),
  };
}
