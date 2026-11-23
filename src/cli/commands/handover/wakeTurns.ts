/**
 * The turn memory `handover wake`'s three capped passes rotate on, read once at the top of a run and written once
 * after its finishes — kept apart from the row loop in `./wakeRows.ts`.
 *
 * Two sources, by what each pass already journals:
 *
 * - **Checks reads and finish asks** come from the turn snapshot (`../../../handover/wakeTurnStore.ts`). A snapshot
 *   that will not read costs this run's order alone — a diagnostic says so, the run serves oldest first, and the
 *   snapshot it writes replaces the bad one. A dry run reads it and writes nothing.
 * - **Reseat attempts** come from the wake journal's own `attempt` rows (`../../../handover/wakeJournalStore.ts`),
 *   written durably before every spawn, so a failing reseat goes behind the rest with no second record of it. A
 *   journal that will not read refuses every reseat this run anyway (`./wakeReseat.ts`'s guard reads it too), so its
 *   order there is moot and only the diagnostic is said.
 *
 * The snapshot is written after the finishes, never after the reseats: the reseats are the slow half a tick may
 * kill, and their own turns are already durable in the journal.
 */
import type { WakeCandidate } from "../../../handover/wakeCandidates.js";
import { readWakeJournal } from "../../../handover/wakeJournalStore.js";
import { readWakeTurns, type WakeTurn, wakeParkKey, writeWakeTurns } from "../../../handover/wakeTurnStore.js";
import type { HandoverWakeDeps } from "./wakeRows.js";

/** The one effect this module takes: saying what did not read or write. */
type DiagnosticDeps = Pick<HandoverWakeDeps, "writeDiagnostic">;

/** What the snapshot held when the run began: each park's turns, and the two orders read off them. */
export interface PriorTurns {
  readonly turns: ReadonlyMap<string, WakeTurn>;
  readonly lastRead: ReadonlyMap<string, string>;
  readonly lastAsked: ReadonlyMap<string, string>;
}

/**
 * Read the snapshot, saying so when it did not read.
 *
 * @returns each park's turns and the last read and ask per key — empty when the snapshot did not read
 */
export function priorTurns({ deps, home }: { deps: DiagnosticDeps; home: string }): PriorTurns {
  const read = readWakeTurns({ home });
  if (read.kind === "unreadable") {
    deps.writeDiagnostic(`handover wake: ${read.why} — this run serves oldest first, and its rewrite replaces it`);
    return { lastAsked: new Map(), lastRead: new Map(), turns: new Map() };
  }
  const lastRead = new Map<string, string>();
  const lastAsked = new Map<string, string>();
  for (const [key, turn] of read.turns) {
    if (turn.readAtIso !== undefined) {
      lastRead.set(key, turn.readAtIso);
    }
    if (turn.askedAtIso !== undefined) {
      lastAsked.set(key, turn.askedAtIso);
    }
  }
  return { lastAsked, lastRead, turns: read.turns };
}

/**
 * The keys a rewrite keeps: the waking parks this run could judge when it scanned the board, or — a `--retry` —
 * every prior turn plus this run's own. A park the scan set aside (a duplicate slug, an unreadable journal) loses its
 * turn and comes back as never served, which orders it by its due instant: sooner than its turn would have, never
 * later.
 *
 * @param waking the waking parks this run could judge, or `undefined` for a run that prunes nothing
 * @returns the keys to write a turn for, when one exists
 */
function keptKeys({
  prior,
  served,
  waking,
}: {
  prior: PriorTurns;
  served: readonly string[];
  waking: readonly WakeCandidate[] | undefined;
}): ReadonlySet<string> {
  if (waking === undefined) {
    return new Set([...prior.turns.keys(), ...served]);
  }
  return new Set(
    waking.map(({ parkIndex, parked, slug }) => wakeParkKey({ parkIndex, parkedAtIso: parked.atIso, slug })),
  );
}

/**
 * Write the snapshot: this run's reads and asks stamped at `now` over the prior turns, pruned to the parks still
 * waking. A dry run writes nothing; a failed write costs the next run's order, and says so.
 *
 * @param asked the keys whose finish this run asked
 * @param read the keys whose checks this run read
 * @param waking every waking park a full run's scan could judge, which the rewrite is pruned to; a
 *   `--retry` passes `undefined` and prunes NOTHING. Pruned to its one park, it erased every other park's turns;
 *   pruned to the board it scanned before its wait, it erased the turn of a park that parked
 *   and was served while it waited. The next full run prunes against its own fresh scan.
 */
export function recordTurns({
  asked,
  waking,
  deps,
  dryRun,
  home,
  now,
  prior,
  read,
}: {
  asked: readonly string[];
  waking: readonly WakeCandidate[] | undefined;
  deps: DiagnosticDeps;
  dryRun: boolean;
  home: string;
  now: Date;
  prior: PriorTurns;
  read: readonly string[];
}): void {
  if (dryRun) {
    return;
  }
  const nowIso = now.toISOString();
  const readSet = new Set(read);
  const askedSet = new Set(asked);
  const turns = new Map<string, WakeTurn>();
  for (const key of keptKeys({ prior, served: [...read, ...asked], waking })) {
    const before = prior.turns.get(key);
    const turn: WakeTurn = {
      ...before,
      ...(readSet.has(key) ? { readAtIso: nowIso } : {}),
      ...(askedSet.has(key) ? { askedAtIso: nowIso } : {}),
    };
    // Kept whenever it was there before, `{}` included, so a retry drops nothing it read.
    if (before !== undefined || readSet.has(key) || askedSet.has(key)) {
      turns.set(key, turn);
    }
  }
  const written = writeWakeTurns({ home, turns });
  if (written.isErr()) {
    deps.writeDiagnostic(`handover wake: ${written.error.message} — the next run serves oldest first`);
  }
}

/**
 * Each park's last reseat attempt, off the wake journal's `attempt` rows.
 *
 * @returns the latest attempt instant per `wakeParkKey` — empty, with a diagnostic, when the journal did not read
 */
export function lastAttempts({ deps, home }: { deps: DiagnosticDeps; home: string }): ReadonlyMap<string, string> {
  const rows = readWakeJournal({ home });
  const last = new Map<string, string>();
  if (rows.isErr()) {
    deps.writeDiagnostic(`handover wake: ${rows.error.message} — reseats are ordered longest-due first this run`);
    return last;
  }
  for (const row of rows.value) {
    if (row.kind !== "attempt") {
      continue;
    }
    const key = wakeParkKey({ parkIndex: row.parkIndex, parkedAtIso: row.parkedAtIso, slug: row.slug });
    const prior = last.get(key);
    if (prior === undefined || Date.parse(prior) < Date.parse(row.atIso)) {
      last.set(key, row.atIso);
    }
  }
  return last;
}
