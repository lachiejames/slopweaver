/**
 * The owner's TYPED console turns as intake obligations: each stays unwitnessed until a board row, the relay row the
 * voice registered off it, or an intake mark covers it, whatever `talk unread` has since marked read.
 *
 * ## Why a ledger, not a window
 *
 * The chair half of intake reads a trailing 24 hours (`./intake.ts` § INTAKE_SWEEP_WINDOW_MS). For typed turns that would
 * be the defect again, one day later: an ask nobody registered would drop out on hour 25. A fixed floor at the day this
 * landed would open every call file since, on every sweep, for ever. So the turns are DISCOVERED over a bounded window
 * and REMEMBERED in a word-free ledger (`./typedIntakeRead.ts`). An `observed` line names a turn, and a `covered` line
 * records the witness that cleared it, so a row swept later does not raise the turn again. A `scanned` line records how
 * far discovery has read, so a chair that slept a week reads that week rather than the last day. A successor chair reads
 * the same `$SLOPWEAVER_HOME`, so it inherits the pending set rather than starting clean.
 *
 * ## No words, anywhere
 *
 * These turns are often private. A turn here is a pointer and an instant, and nothing in this module or its ledger ever
 * holds the text. The register line it suggests carries a fixed ask ({@link TYPED_REGISTER_ASK}), and a mark naming a row
 * slug or pointer clears one without copying its words anywhere.
 *
 * Pure: events, rows and marks in, a finding out.
 */
import { isRecord } from "../lib/parsers.js";
import { parseRelayAnchor, relaySlug } from "../talk/relayDraft.js";
import type { TypedOwnerTurnCandidate } from "../talk/typedOwnerIntake.js";
import { parseCallPointer } from "../talk/unreadWords.js";
import {
  INTAKE_GRACE_MS,
  INTAKE_MARK_KINDS,
  INTAKE_SWEEP_WINDOW_MS,
  type IntakeMark,
  type RowAnchors,
  type TurnWitness,
  type WitnessKind,
} from "./intake.js";
import { preferredMarks } from "./intakeWitness.js";

/**
 * How far behind the last scan the next one starts. A typed line is stamped by the page and appended a moment later
 * (`storedIso`), so a scan that ended between the two must not step past the line on its next read.
 */
const TYPED_SCAN_OVERLAP_MS = 60 * 60 * 1000;

/**
 * Where a ledger that has never completed a scan reads from: a fresh home, or one whose every read so far failed
 * somewhere. Not the sweep window, because a first read a day after a turn, or one after a failed read, would then
 * start past it and the turn would never be owed. Fixed a week before this obligation landed, so the one full read
 * is bounded and still covers the turn this obligation was opened for; a turn older than that predates it.
 */
const TYPED_LEDGER_BOOTSTRAP_ISO = "2026-11-20T00:00:00.000Z";

/** The ask the suggested register line carries: a typed turn's words never leave the call file. */
const TYPED_REGISTER_ASK = "Private console turn";

/** One line of the typed intake ledger. */
export type TypedIntakeEvent =
  | { readonly kind: "scanned"; readonly throughIso: string }
  | {
      readonly kind: "observed";
      readonly pointer: string;
      readonly timestamp: string;
      readonly relayAnchors: readonly string[];
    }
  | {
      readonly kind: "covered";
      readonly pointer: string;
      readonly coveredAtIso: string;
      readonly witness: TurnWitness;
    };

/** A typed turn by pointer and instant. It never carries words. */
export interface TypedOwnerTurn {
  readonly pointer: string;
  readonly timestamp: string;
}

/** One typed turn with its verdict. */
export interface WitnessedTypedTurn {
  readonly turn: TypedOwnerTurn;
  readonly witness: TurnWitness | undefined;
  readonly inGrace: boolean;
}

/** What one read of the typed turns found. */
export interface TypedIntakeFinding {
  /** Every turn still pending as this read began, with its verdict now. */
  readonly turns: readonly WitnessedTypedTurn[];
  /** Pending, past grace, with no witness. */
  readonly unwitnessed: readonly TypedOwnerTurn[];
  readonly inGrace: number;
  /** Witnessed by anything but a `no-ask` mark. */
  readonly witnessed: number;
  readonly markedNoAsk: number;
  /** The instant discovery read call files from. */
  readonly discoveredFromIso: string;
  /** What could not be read: call files and ledger lines, each named. Non-empty means the count may be short. */
  readonly unreadable: readonly string[];
}

/** The typed half of an intake read. */
export type TypedIntakeReport =
  | { readonly kind: "read"; readonly finding: TypedIntakeFinding }
  | { readonly kind: "excluded"; readonly why: string }
  | { readonly kind: "unavailable"; readonly why: string };

/** Every witness kind a `covered` line may carry. */
const WITNESS_KINDS: readonly WitnessKind[] = ["row", "settlement", "wake", ...INTAKE_MARK_KINDS];

/** Whether a value is one of {@link WITNESS_KINDS}. */
function isWitnessKind(value: unknown): value is WitnessKind {
  return WITNESS_KINDS.some((kind) => kind === value);
}

/** Whether a value is an ISO instant `Date.parse` reads. */
function isInstant(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** A `covered` line's witness, or `undefined` when it is not completely one. */
function witnessOf({ value }: { value: unknown }): TurnWitness | undefined {
  if (!isRecord(value) || typeof value["witness"] !== "string") {
    return undefined;
  }
  const kind = value["kind"];
  if (!isWitnessKind(kind)) {
    return undefined;
  }
  return { kind, witness: value["witness"] };
}

/**
 * Read one ledger line, refusing anything that is not completely an event. The reader counts a refused line rather
 * than dropping it in silence, because an `observed` line lost is a turn lost.
 *
 * @param line one line of the ledger
 * @returns the event, or `undefined`
 */
export function parseTypedIntakeLine({ line }: { line: string }): TypedIntakeEvent | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (value["kind"] === "scanned") {
    return isInstant(value["throughIso"]) ? { kind: "scanned", throughIso: value["throughIso"] } : undefined;
  }
  const pointer = typeof value["pointer"] === "string" ? parseCallPointer({ text: value["pointer"] }) : undefined;
  if (pointer === undefined) {
    return undefined;
  }
  if (value["kind"] === "observed") {
    const anchors = value["relayAnchors"];
    const anchorsRead = Array.isArray(anchors) && anchors.every((anchor) => typeof anchor === "string");
    if (!isInstant(value["timestamp"]) || !anchorsRead) {
      return undefined;
    }
    return { kind: "observed", pointer, relayAnchors: anchors, timestamp: value["timestamp"] };
  }
  const witness = witnessOf({ value: value["witness"] });
  if (value["kind"] !== "covered" || !isInstant(value["coveredAtIso"]) || witness === undefined) {
    return undefined;
  }
  return { coveredAtIso: value["coveredAtIso"], kind: "covered", pointer, witness };
}

/**
 * The instant discovery reads call files from: one overlap before the last completed scan (the bootstrap instant when
 * none has completed), never later than the sweep window, and never later than a `--since` the caller asked for. A later `--since` never narrows it, because turns already observed
 * stay in the ledger whatever the floor.
 *
 * @param events the ledger
 * @param nowIso the instant of this read
 * @param sinceIso a floor the caller asked for, or `undefined`
 * @returns the discovery floor, as an ISO instant
 */
export function typedDiscoveryFloor({
  events,
  nowIso,
  sinceIso,
}: {
  events: readonly TypedIntakeEvent[];
  nowIso: string;
  sinceIso: string | undefined;
}): string {
  const floors = [Date.parse(nowIso) - INTAKE_SWEEP_WINDOW_MS];
  const scans = events.flatMap((event) => (event.kind === "scanned" ? [Date.parse(event.throughIso)] : []));
  if (scans.length > 0) {
    floors.push(Math.max(...scans) - TYPED_SCAN_OVERLAP_MS);
  } else {
    floors.push(Date.parse(TYPED_LEDGER_BOOTSTRAP_ISO));
  }
  if (sinceIso !== undefined && !Number.isNaN(Date.parse(sinceIso))) {
    floors.push(Date.parse(sinceIso));
  }
  return new Date(Math.min(...floors)).toISOString();
}

/** Every observed turn, its relay anchors merged across every `observed` line naming it. */
function observedTurns({ events }: { events: readonly TypedIntakeEvent[] }): Map<string, TypedOwnerTurnCandidate> {
  const observed = new Map<string, TypedOwnerTurnCandidate>();
  for (const event of events) {
    if (event.kind !== "observed") {
      continue;
    }
    const known = observed.get(event.pointer);
    const relayAnchors = [...new Set([...(known === undefined ? [] : known.relayAnchors), ...event.relayAnchors])];
    const timestamp = known === undefined ? event.timestamp : known.timestamp;
    observed.set(event.pointer, { pointer: event.pointer, relayAnchors, timestamp });
  }
  return observed;
}

/**
 * The `observed` lines a discovery adds: a turn the ledger has never named, or one whose relay anchors grew since — a
 * relay line can land after the scan that first saw its turn.
 *
 * @param events the ledger
 * @param candidates the turns this discovery found
 * @returns the lines to append, in the candidates' order
 */
export function newlyObserved({
  events,
  candidates,
}: {
  events: readonly TypedIntakeEvent[];
  candidates: readonly TypedOwnerTurnCandidate[];
}): readonly TypedIntakeEvent[] {
  const observed = observedTurns({ events });
  return candidates.flatMap((candidate): TypedIntakeEvent[] => {
    const known = observed.get(candidate.pointer);
    const grew = known !== undefined && candidate.relayAnchors.some((anchor) => !known.relayAnchors.includes(anchor));
    if (known !== undefined && !grew) {
      return [];
    }
    return [{ kind: "observed", ...candidate }];
  });
}

/**
 * The turns still owed a witness: every observed turn no `covered` line has cleared, oldest first.
 *
 * @param events the ledger, with this read's `observed` lines appended
 * @returns the pending turns
 */
export function pendingTypedTurns({
  events,
}: {
  events: readonly TypedIntakeEvent[];
}): readonly TypedOwnerTurnCandidate[] {
  const covered = new Set(events.flatMap((event) => (event.kind === "covered" ? [event.pointer] : [])));
  return [...observedTurns({ events }).values()]
    .filter((turn) => !covered.has(turn.pointer))
    .toSorted((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

/** Every `talk-call:` pointer the board names, and the row that names it: an anchor before a settlement witness. */
function callRowWitnesses({ rows }: { rows: readonly RowAnchors[] }): ReadonlyMap<string, TurnWitness> {
  const witnesses = new Map<string, TurnWitness>();
  const claim = ({ field, kind, slug }: { field: string | undefined; kind: "row" | "settlement"; slug: string }) => {
    const pointer = field === undefined ? undefined : parseCallPointer({ text: field });
    if (pointer !== undefined && !witnesses.has(pointer)) {
      witnesses.set(pointer, { kind, witness: slug });
    }
  };
  for (const row of rows) {
    claim({ field: row.anchor, kind: "row", slug: row.slug });
  }
  for (const row of rows) {
    claim({ field: row.settlementWitness, kind: "settlement", slug: row.slug });
  }
  return witnesses;
}

/**
 * Every relay row on the board by its WHOLE normalised `talk:<turnId>` anchor, kept only where the row's slug is the
 * one that turn mints. The slug alone is twelve hex characters of the turn id, so two relays can share one; matching
 * the whole anchor is what keeps one relay's row from clearing another turn.
 */
function relayRowsByAnchor({ rows }: { rows: readonly RowAnchors[] }): ReadonlyMap<string, string> {
  const byAnchor = new Map<string, string>();
  for (const row of rows) {
    const anchor = row.anchor === undefined ? undefined : parseRelayAnchor({ text: row.anchor });
    if (anchor !== undefined && relaySlug({ turnId: anchor.slice("talk:".length) }) === row.slug) {
      byAnchor.set(anchor, row.slug);
    }
  }
  return byAnchor;
}

/** The relay row one of a turn's relay anchors registered, when the board holds it. */
function relayWitness({
  turn,
  relayRows,
}: {
  turn: TypedOwnerTurnCandidate;
  relayRows: ReadonlyMap<string, string>;
}): TurnWitness | undefined {
  for (const anchor of turn.relayAnchors) {
    const normalised = parseRelayAnchor({ text: anchor });
    const slug = normalised === undefined ? undefined : relayRows.get(normalised);
    if (slug !== undefined) {
      return { kind: "row", witness: slug };
    }
  }
  return undefined;
}

/** A turn's witness in precedence order: a row naming its pointer, then its relay row, then its standing mark. */
function typedWitness({
  turn,
  fromRows,
  relayRows,
  mark,
}: {
  turn: TypedOwnerTurnCandidate;
  fromRows: ReadonlyMap<string, TurnWitness>;
  relayRows: ReadonlyMap<string, string>;
  mark: IntakeMark | undefined;
}): TurnWitness | undefined {
  const fromRow = fromRows.get(turn.pointer);
  if (fromRow !== undefined) {
    return fromRow;
  }
  const fromRelay = relayWitness({ relayRows, turn });
  if (fromRelay !== undefined) {
    return fromRelay;
  }
  return mark === undefined ? undefined : { kind: mark.kind, witness: mark.witness };
}

/**
 * Set every pending typed turn against the board and the intake ledger. A row naming the turn comes first, then the relay
 * row registered off it, then its standing mark; with none, a turn younger than {@link INTAKE_GRACE_MS} is in grace and an
 * older one is unwitnessed.
 *
 * @param turns the pending turns
 * @param rows the board, narrowed to its pointer-bearing fields
 * @param marks the intake mark ledger
 * @param nowIso the instant grace is judged at
 * @param discoveredFromIso the floor discovery read from, carried onto the finding
 * @param unreadable what could not be read, carried onto the finding
 * @returns the finding
 */
export function witnessTypedTurns({
  turns,
  rows,
  marks,
  nowIso,
  discoveredFromIso,
  unreadable,
}: {
  turns: readonly TypedOwnerTurnCandidate[];
  rows: readonly RowAnchors[];
  marks: readonly IntakeMark[];
  nowIso: string;
  discoveredFromIso: string;
  unreadable: readonly string[];
}): TypedIntakeFinding {
  const fromRows = callRowWitnesses({ rows });
  const relayRows = relayRowsByAnchor({ rows });
  const standing = preferredMarks({ marks, slugs: new Set(rows.map((row) => row.slug)) });
  const now = Date.parse(nowIso);
  const judged = turns.map((candidate): WitnessedTypedTurn => {
    const mark = standing.get(candidate.pointer);
    const witness = typedWitness({ fromRows, mark, relayRows, turn: candidate });
    const at = Date.parse(candidate.timestamp);
    const inGrace = witness === undefined && !Number.isNaN(at) && now - at < INTAKE_GRACE_MS;
    return { inGrace, turn: { pointer: candidate.pointer, timestamp: candidate.timestamp }, witness };
  });
  return {
    discoveredFromIso,
    inGrace: judged.filter((item) => item.inGrace).length,
    markedNoAsk: judged.filter((item) => item.witness?.kind === "no-ask").length,
    turns: judged,
    unreadable,
    unwitnessed: judged.filter((item) => item.witness === undefined && !item.inGrace).map((item) => item.turn),
    witnessed: judged.filter((item) => item.witness !== undefined && item.witness.kind !== "no-ask").length,
  };
}

/**
 * The `covered` lines a finding earns: one per turn it found a witness for, so the next read does not judge it again and
 * a row swept later does not raise it.
 *
 * @param finding what this read found
 * @param nowIso the instant of this read
 * @returns the lines to append
 */
export function coveredEvents({
  finding,
  nowIso,
}: {
  finding: TypedIntakeFinding;
  nowIso: string;
}): readonly TypedIntakeEvent[] {
  return finding.turns.flatMap((item): TypedIntakeEvent[] =>
    item.witness === undefined
      ? []
      : [{ coveredAtIso: nowIso, kind: "covered", pointer: item.turn.pointer, witness: item.witness }],
  );
}

/**
 * The exact `handover register` line that would witness one typed turn. Its ask is fixed, so the owner's words never
 * leave the call file. A turn that became no row is marked instead, and `--as card|no-ask` carries no words:
 * `slopweaver supervisor intake-mark --turn <pointer> --as card --witness <question>`. An `answered` mark naming a row
 * copies the turn's words onto that row as a steer (`intake-mark`'s usage), which is the one witness that moves them.
 *
 * @param turn the unwitnessed turn
 * @returns the command line
 */
export function typedRegisterCommandFor({ turn }: { turn: TypedOwnerTurn }): string {
  return `slopweaver handover register --ask ${JSON.stringify(TYPED_REGISTER_ASK)} --anchor ${turn.pointer}`;
}
