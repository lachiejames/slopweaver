/**
 * THE TURN LEDGER — one row per ask, joined from every record set a turn leaves behind, and the mean/median
 * footer that answers "did the bot feel slow today" in one command instead of one scratch script.
 *
 * ## Why this module exists
 *
 * Measuring a single day's turns took a throwaway node script joining SIX record sets by
 * hand: `live/slack/asks.jsonl`, `ledgers/turn-completions.jsonl`, `briefs/`, `live/slack/dispatches/`,
 * `live/slack/progress/` and one `live/slack/reviews/<key>/record.json` plus its verdict files. Nothing in the
 * tree read them together — `turn dispatch --sweep` reads only OPEN dispatches, `turn watch` reads one
 * brief, and `turn-completions.jsonl` had no reader at all. A hand-joined measurement like that belongs in
 * typed, tested code.
 *
 * So the arithmetic lives here, pure, and `../../cli/commands/turn/ledger.ts` is the shell that reads the
 * files. Nothing below touches the filesystem or the clock, which is what makes every phase boundary
 * assertable without a home on disk. WHICH asks a run is about — grouping a log by ask, narrowing to a
 * `--since`/`--channel` window, and gathering the completion log — is `./ledgerWindow.ts`, because that
 * half runs first and its whole job is to keep this half from being asked about an ask nobody wanted.
 *
 * ## Two record sets the finding named and this join does NOT read, deliberately
 *
 * `briefs/` and `dispatches/` carry nothing a phase needs that `asks.jsonl` does not already carry: a
 * `dispatched` event embeds the whole `RespondDecision` and its own lease. Dropping them is a
 * simplification, not an omission — do not "restore" them without a column that needs one.
 *
 * ## The generation problem, stated rather than discovered
 *
 * Every one of these record sets is keyed `(channel, messageTs)`, and `dispatchId` is a pure encoding of
 * that pair (`./dispatchStore.ts#currentGenerationDispatchRecord`), so a RE-DISPATCHED ask carries two
 * generations under one key. Three consequences, each handled here rather than left to a reader:
 *
 *  - {@link TurnLedgerRow.completions} counts the completion events for the ask; the model label and the
 *    secondary failures come from the LAST one, which is the one that matches the terminal event.
 *  - `spinUp` measures from `captured` to the FIRST dispatch ("how fast did we start"), while
 *    `investigation` and `review` measure from the LAST dispatch ("how long did the attempt that produced
 *    the answer take"). The asymmetry is the point, not an inconsistency.
 *  - {@link GENERATION_SCOPED_PHASES} names the two phases a re-dispatched row is excluded from in the
 *    footer, so a mean is never taken over a span that includes a dead generation and the gap after it.
 *
 * ## What this cannot report, and says so
 *
 * A SPAN WHOSE END PRECEDES ITS START. Two of the five phases open on the tag's own SLACK instant and
 * close on an instant this MACHINE wrote, so the two clocks can disagree and a `messageTs` can even be
 * authored by hand. MEASURED on the operator's own home — three `notice` spans came back at
 * roughly -3h, and folded straight into that phase's mean
 * (repro: `slopweaver turn ledger --json | grep '"noticed": -'`, which must now print nothing). Such a
 * phase is named in {@link TurnLedgerRow.reversedPhases} and left out of {@link TurnLedgerRow.phases}
 * entirely, so it can neither be rendered as a duration nor averaged — and the row says `reversed` rather
 * than the `—` an unmeasurable phase gets, because "the records disagree" is not "the records are silent".
 *
 * REACTIONS ON THE ANSWER. No record set on this machine holds a human reaction to a bot answer — the
 * lifecycle vocabulary (`../ask/lifecycleEvents.ts`) has no such event and `turn settle-reaction` writes
 * one without recording it per ask. The finding scoped this "(after the reaction row lands)", and it has
 * not landed. `turn ledger`'s footer prints the absence rather than an empty column.
 */
import type { ReviewOutcome } from "../../admit/reviewVerdict.js";
import { parseIsoMs } from "../../lib/date.js";
import { slackTsToIso } from "../../lib/slackTs.js";
import type { AskIdentity } from "../ask/identity.js";
import { type AskLifecycleEvent, type CapturedEvent, terminalAskLifecycleEvent } from "../ask/lifecycleEvents.js";
import type { CheckpointSet } from "./checkpoint.js";
import type { TurnCompletion } from "./envelope.js";

/** Every phase one row measures, in the order a reader walks a turn. */
export const TURN_LEDGER_PHASE_KEYS = ["noticed", "spinUp", "investigation", "review", "total"] as const;

/** One measured span of a turn. */
export type TurnLedgerPhaseKey = (typeof TURN_LEDGER_PHASE_KEYS)[number];

/** What each phase is called on a line a person reads, and in the footer. */
export const TURN_LEDGER_PHASE_LABELS: Readonly<Record<TurnLedgerPhaseKey, string>> = {
  investigation: "invest",
  noticed: "notice",
  review: "review",
  spinUp: "spin-up",
  total: "total",
};

/** What each phase's two boundaries are, for the usage text and the footer's own legend. */
export const TURN_LEDGER_PHASE_BOUNDS: Readonly<Record<TurnLedgerPhaseKey, string>> = {
  investigation: "last dispatch → first validated draft (else first review round)",
  noticed: "the tag's own Slack instant → the listener's `captured` row",
  review: "first review round of that dispatch → the ask's terminal event",
  spinUp: "`captured` → the FIRST dispatch",
  total: "the tag's own Slack instant → the ask's terminal event",
};

/**
 * The phases measured inside ONE dispatch generation, and therefore the two a re-dispatched row is left
 * out of when the footer averages. See this module's header for why the asymmetry is deliberate.
 */
export const GENERATION_SCOPED_PHASES: ReadonlySet<TurnLedgerPhaseKey> = new Set<TurnLedgerPhaseKey>([
  "investigation",
  "review",
]);

/**
 * What a round's verdict said, or that the file would not read — never a round silently dropped.
 *
 * @internal exported for {@link TurnLedgerRound}'s own field, which callers reach structurally through
 * {@link TurnLedgerRow.rounds}; no module outside this one names either type.
 */
export type TurnLedgerRoundOutcome = ReviewOutcome | "unreadable";

/**
 * One review round the record set can prove, with the verdict it produced.
 *
 * @internal reached through {@link TurnLedgerRow.rounds} rather than named — see
 * {@link TurnLedgerRoundOutcome}.
 */
export interface TurnLedgerRound {
  /** The instant that round's reviewer was spawned — its position in the ordering. */
  readonly spawnedAtIso: string;
  readonly outcome: TurnLedgerRoundOutcome;
}

/** One ask, as every record set together has it. */
export interface TurnLedgerRow extends AskIdentity {
  readonly surface: "channel" | "dm";
  readonly userId: string;
  /** What was asked, when the `captured` row carries it — absent on a row predating that field. */
  readonly askText?: string | undefined;
  /** The tag's own instant, derived from `messageTs` and floored to whole seconds by `slackTsToIso`. */
  readonly taggedIso?: string | undefined;
  readonly capturedIso: string;
  /** How many `dispatched` events this one key carries — more than one means a re-dispatch. */
  readonly dispatches: number;
  readonly firstDispatchedIso?: string | undefined;
  readonly lastDispatchedIso?: string | undefined;
  /** When the answering generation first had something to review — a validated draft, else a round spawn. */
  readonly composedIso?: string | undefined;
  /** The first review round of the answering generation. */
  readonly firstRoundIso?: string | undefined;
  /** The terminal event's instant, absent while the ask is still open. */
  readonly endedIso?: string | undefined;
  /** The terminal kind, or `open:<kind>` naming the most recent event of an ask nothing has closed. */
  readonly ending: string;
  readonly terminal: boolean;
  /** Every round the ask was EVER reviewed through, oldest first — across generations. */
  readonly rounds: readonly TurnLedgerRound[];
  /** The model label the last completion event stamped, when the ask has one. */
  readonly modelId?: string | undefined;
  readonly completions: number;
  /** The last completion's secondary diagnostics, as `<kind>: <reason>` — empty, never omitted. */
  readonly secondaryFailures: readonly string[];
  /**
   * Each phase in whole seconds, present only when both of its boundaries are on disk AND the closing one
   * is not before the opening one. Never negative, and never a zero standing in for one.
   */
  readonly phases: { readonly [K in TurnLedgerPhaseKey]?: number };
  /**
   * Phases whose two instants were both readable and in the WRONG ORDER, so no duration exists to print or
   * average. Empty, never omitted — see this module's header for the clocks that produce one.
   */
  readonly reversedPhases: readonly TurnLedgerPhaseKey[];
}

/** Everything one ask's record sets contribute, already read. */
export interface TurnLedgerAskInput {
  /** Every lifecycle event for this one key, in file order. */
  readonly events: readonly AskLifecycleEvent[];
  /** Every completion for this one key, in file order. */
  readonly completions: readonly TurnCompletion[];
  /** The drafts and rounds `readCheckpointSet` found for it. */
  readonly checkpoint: CheckpointSet;
}

/** Seconds between two instants, or `undefined` when either is absent or unparseable. */
function secondsBetween({
  fromIso,
  toIso,
}: {
  fromIso: string | undefined;
  toIso: string | undefined;
}): number | undefined {
  if (fromIso === undefined || toIso === undefined) {
    return undefined;
  }
  const from = parseIsoMs({ tsIso: fromIso });
  const to = parseIsoMs({ tsIso: toIso });
  if (from === undefined || to === undefined) {
    return undefined;
  }
  return Math.round((to - from) / 1000);
}

/** The earliest of a list of instants that is not before a floor, or `undefined` when none qualifies. */
function earliestAtOrAfter({
  candidates,
  floorIso,
}: {
  candidates: readonly string[];
  floorIso: string | undefined;
}): string | undefined {
  let floor = Number.NEGATIVE_INFINITY;
  if (floorIso !== undefined) {
    const parsed = parseIsoMs({ tsIso: floorIso });
    if (parsed !== undefined) {
      floor = parsed;
    }
  }
  const ordered = candidates
    .map((iso) => ({ iso, ms: parseIsoMs({ tsIso: iso }) }))
    .filter((entry): entry is { iso: string; ms: number } => entry.ms !== undefined && entry.ms >= floor)
    .toSorted((left, right) => left.ms - right.ms);
  const first = ordered[0];
  if (first === undefined) {
    return undefined;
  }
  return first.iso;
}

/**
 * The instant the answering generation began, and therefore the floor no round or draft may precede. With
 * nothing dispatched there is no generation to scope to, so the capture instant stands in — every record a
 * turn holds is at or after it, which makes the floor a no-op rather than a filter that quietly drops one.
 */
function generationFloorOf({
  capturedIso,
  lastDispatchedIso,
}: {
  capturedIso: string;
  lastDispatchedIso: string | undefined;
}): string {
  if (lastDispatchedIso === undefined) {
    return capturedIso;
  }
  return lastDispatchedIso;
}

/** The rounds of an ask, flattened to the two facts a row shows. */
function roundsOf({ checkpoint }: { checkpoint: CheckpointSet }): readonly TurnLedgerRound[] {
  return checkpoint.rounds.map((entry) => {
    if (entry.verdict === undefined) {
      return { outcome: "unreadable", spawnedAtIso: entry.round.spawnedAt };
    }
    return { outcome: entry.verdict.outcome, spawnedAtIso: entry.round.spawnedAt };
  });
}

/** The `<kind>: <reason>` lines the last completion's secondary diagnostics contribute. */
function secondaryFailuresOf({ completion }: { completion: TurnCompletion | undefined }): readonly string[] {
  if (completion === undefined) {
    return [];
  }
  return completion.secondaryFailures.map((entry) => `${entry.kind}: ${entry.reason}`);
}

/**
 * Build one ask's row, or `undefined` when its event list has no `captured` event to open it — the same
 * rule `foldAskLifecycle` applies, and for the same reason: a resolution with no capture behind it carries
 * nothing a reader can act on.
 *
 * @param checkpoint the drafts and review rounds this ask's record set holds
 * @param completions every completion event recorded under this ask's key, in file order
 * @param events every lifecycle event for this ask's key, in file order
 * @returns the row, or `undefined` when the ask was never captured
 */
export function turnLedgerRow({ checkpoint, completions, events }: TurnLedgerAskInput): TurnLedgerRow | undefined {
  const captured = events.find((event): event is CapturedEvent => event.kind === "captured");
  const lastEvent = events.at(-1);
  if (captured === undefined || lastEvent === undefined) {
    return undefined;
  }
  const dispatched = events.filter((event) => event.kind === "dispatched");
  const firstDispatchedIso = dispatched.at(0)?.tsIso;
  const lastDispatchedIso = dispatched.at(-1)?.tsIso;
  const terminal = events.findLast((event) => terminalAskLifecycleEvent({ event }) !== undefined);
  const rounds = roundsOf({ checkpoint });
  const generationFloor = generationFloorOf({ capturedIso: captured.tsIso, lastDispatchedIso });
  const firstRoundIso = earliestAtOrAfter({
    candidates: rounds.map((round) => round.spawnedAtIso),
    floorIso: generationFloor,
  });
  const composedIso = earliestAtOrAfter({
    candidates: [...checkpoint.drafts.map((draft) => draft.recordedAtIso), ...rounds.map((r) => r.spawnedAtIso)],
    floorIso: generationFloor,
  });
  const taggedIso = slackTsToIso({ ts: captured.messageTs });
  const endedIso = terminal?.tsIso;
  const lastCompletion = completions.at(-1);
  const modelId = lastCompletion?.provenance.modelId;
  const { phases, reversedPhases } = measurePhases({
    bounds: {
      investigation: { fromIso: lastDispatchedIso, toIso: composedIso },
      noticed: { fromIso: taggedIso, toIso: captured.tsIso },
      review: { fromIso: firstRoundIso, toIso: endedIso },
      spinUp: { fromIso: captured.tsIso, toIso: firstDispatchedIso },
      total: { fromIso: taggedIso, toIso: endedIso },
    },
  });
  return {
    capturedIso: captured.tsIso,
    channel: captured.channel,
    completions: completions.length,
    dispatches: dispatched.length,
    ending: terminal === undefined ? `open:${lastEvent.kind}` : terminal.kind,
    messageTs: captured.messageTs,
    phases,
    reversedPhases,
    rounds,
    secondaryFailures: secondaryFailuresOf({ completion: lastCompletion }),
    surface: captured.surface,
    terminal: terminal !== undefined,
    threadTs: captured.threadTs,
    userId: captured.userId,
    ...(captured.text === undefined ? {} : { askText: captured.text }),
    ...(taggedIso === undefined ? {} : { taggedIso }),
    ...(firstDispatchedIso === undefined ? {} : { firstDispatchedIso }),
    ...(lastDispatchedIso === undefined ? {} : { lastDispatchedIso }),
    ...(composedIso === undefined ? {} : { composedIso }),
    ...(firstRoundIso === undefined ? {} : { firstRoundIso }),
    ...(endedIso === undefined ? {} : { endedIso }),
    ...(modelId === undefined ? {} : { modelId }),
  };
}

/**
 * Every phase's seconds, split into the ones a reader may average and the ones whose own two instants
 * disagree about which came first. A reversed span is NOT clamped to zero: a zero would join the mean and
 * claim the turn was instant, which is the one reading the records cannot support.
 */
function measurePhases({
  bounds,
}: {
  bounds: Readonly<Record<TurnLedgerPhaseKey, { fromIso: string | undefined; toIso: string | undefined }>>;
}): {
  readonly phases: { readonly [K in TurnLedgerPhaseKey]?: number };
  readonly reversedPhases: readonly TurnLedgerPhaseKey[];
} {
  const phases: { [K in TurnLedgerPhaseKey]?: number } = {};
  const reversedPhases: TurnLedgerPhaseKey[] = [];
  for (const key of TURN_LEDGER_PHASE_KEYS) {
    const seconds = secondsBetween(bounds[key]);
    if (seconds === undefined) {
      continue;
    }
    if (seconds < 0) {
      reversedPhases.push(key);
      continue;
    }
    phases[key] = seconds;
  }
  return { phases, reversedPhases };
}

/** One phase's footer figures, over the rows that actually carry it. */
export interface TurnLedgerPhaseStats {
  readonly key: TurnLedgerPhaseKey;
  /** How many rows contributed — printed beside the figures so a mean over three is never read as thirty. */
  readonly count: number;
  /** How many rows were excluded for being re-dispatched, on a generation-scoped phase. */
  readonly excludedRedispatched: number;
  /** How many rows had this phase's own two instants in the wrong order, so it has no duration at all. */
  readonly reversed: number;
  readonly meanSeconds?: number | undefined;
  readonly medianSeconds?: number | undefined;
}

/** The median of a non-empty list of seconds. */
function medianOf({ values }: { values: readonly number[] }): number {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) {
    return 0;
  }
  if (sorted.length % 2 === 1) {
    return upper;
  }
  const lower = sorted[middle - 1];
  if (lower === undefined) {
    return upper;
  }
  return Math.round((lower + upper) / 2);
}

/**
 * The mean and median of every phase, each over only the rows that carry it — and, for a generation-scoped
 * phase, only over rows that were dispatched exactly once.
 *
 * @param rows the rows in the window
 * @returns one entry per declared phase, in {@link TURN_LEDGER_PHASE_KEYS} order
 */
export function turnLedgerStats({ rows }: { rows: readonly TurnLedgerRow[] }): readonly TurnLedgerPhaseStats[] {
  return TURN_LEDGER_PHASE_KEYS.map((key) => {
    const scoped = GENERATION_SCOPED_PHASES.has(key);
    const eligible = rows.filter((row) => !scoped || row.dispatches <= 1);
    const excludedRedispatched = rows.filter(
      (row) => scoped && row.dispatches > 1 && row.phases[key] !== undefined,
    ).length;
    const reversed = rows.filter((row) => row.reversedPhases.includes(key)).length;
    const values = eligible.map((row) => row.phases[key]).filter((seconds): seconds is number => seconds !== undefined);
    if (values.length === 0) {
      return { count: 0, excludedRedispatched, key, reversed };
    }
    const total = values.reduce((sum, seconds) => sum + seconds, 0);
    return {
      count: values.length,
      excludedRedispatched,
      key,
      meanSeconds: Math.round(total / values.length),
      medianSeconds: medianOf({ values }),
      reversed,
    };
  });
}
