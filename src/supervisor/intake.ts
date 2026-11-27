/**
 * The supervisor's INTAKE check: every turn the owner typed into ANY supervisor in the chain, set against the
 * board and the intake ledger, and the one clause that says how many of them nothing witnessed.
 *
 * The scope is the chain rather than one chat because the pin record names only its current holder, so a
 * check reading it saw one session and reported a clean week — `./chain.ts` carries that measurement, the
 * succession record that fixed it, and why every finding here carries its own coverage.
 *
 * ## The defect, measured
 *
 * What the owner sends to the supervisor must never end up unacted on or forgotten. The owner once told a
 * supervisor they had already asked a previous one to trace where a pull request had come from; that
 * predecessor had answered in its own chat, never carded or registered it, and the answer died with the
 * session. Reproduce the shape with
 * `slopweaver transcripts turns --session <id> --json` over the two supervisor sessions involved:
 * fifteen owner turns between them, eighty-seven ask rows on the board, and not one row anchored to any of
 * the fifteen. The board could not have said which of the owner's turns had been acted on, because nothing tied a
 * turn to a row.
 *
 * ## The rule this enforces, and where it bites
 *
 * An ask typed into the supervisor becomes a board row or a page card THE SAME TICK — never a chat reply
 * alone. Two mechanisms carry it. A row registered with `--anchor transcript:<session>#<turn>` (or an ask
 * settled with that pointer as its witness) is found by reading the board, and so is a voice relay's delivery
 * line, by the relay row it names (`witnessTurns` says why); anything else — a card on the
 * briefing page, a ruling that answered a run's question, a turn that asked for nothing — is written to the
 * intake ledger by `slopweaver supervisor intake-mark`, attributably, with a witness and a reason — and an
 * `answered` witness naming a row carries the owner's words onto that row first (`./intakeRoute.ts`). Every
 * turn older than {@link INTAKE_GRACE_MS} with neither is `unwitnessed`, and that count goes into the
 * reconciliation headline, which `../outbound/briefing/schema.ts` makes the fleet briefing REFUSE to render
 * without. The forcing is at the render door, not in prose a successor retypes.
 *
 * `no-ask` is a swallow path by construction, and it is kept rather than closed because the alternative is
 * worse: a turn that said "brief me" would otherwise stay unwitnessed forever and teach the reader to
 * ignore the clause, which is exactly how `../handover/reconcile.ts`'s own history says a finding dies. It
 * is journalled with the marking session and a reason, and COUNTED separately in the finding, so a
 * supervisor that dismisses everything is visible as one.
 *
 * Pure: turns, rows and marks in, a finding out. No filesystem, no clock beyond the `nowIso` it is handed.
 */

import { isRecord } from "../lib/parsers.js";
import { chairWakeCallId } from "../talk/chairWake.js";
import { parseRelayAnchor, relaySlug } from "../talk/relayDraft.js";
import { relayLineSlug } from "../talk/relayLine.js";
import { parseCallPointer } from "../talk/unreadWords.js";
import type { HumanTurnSource } from "../transcripts/extract.js";
import { formatTurnPointer, parseTurnPointer } from "../transcripts/pointer.js";
import { batchWitness } from "./batchWitness.js";
import { type ChainCoverage, coverageClause } from "./chain.js";
import { type InboundFinding, inboundSentence } from "./inbound.js";
import { preferredMarks } from "./intakeWitness.js";
import type { TypedIntakeReport } from "./typedIntake.js";
import { typedIntakeSentence } from "./typedIntakeSentence.js";

/**
 * How long a turn may sit with no witness before it counts.
 *
 * Twenty minutes: one sweep tick, which is the cadence `skills/supervisor/reference/sweep-cycle.md` arms
 * (`grep -n 1200 skills/supervisor/reference/sweep-cycle.md`). A turn typed during the tick that is running
 * has had no tick in which to be registered; a turn older than one tick has, and the rule is "the same
 * tick", so anything past this is late by definition rather than by judgement.
 */
export const INTAKE_GRACE_MS = 20 * 60 * 1000;

/**
 * How far back the SWEEP's own intake check reads across the chain.
 *
 * Twenty-four hours, because that is already this role's memory window: the supervisor state doc is a
 * rolling 24 hours plus the current boot block, and anything older is the archive's business
 * (`skills/supervisor/SKILL.md` § 4). The audit verb takes any `--since` it is given; this is only the tick's
 * default, and it exists because an UNBOUNDED default is its own failure — the chain walk landed with 459
 * historical unwitnessed turns on this install, a number that can never go down and would teach the reader
 * to ignore the clause, which is exactly how a finding dies. Reproduce both readings with
 * `slopweaver supervisor intake` and `slopweaver supervisor intake --since <a week ago>`.
 */
export const INTAKE_SWEEP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** One turn the owner took in the supervisor, addressed so a row or a mark can point back at it. */
export interface OwnerTurn {
  /** `transcript:<sessionId>#<turnUuid>` — the anchor form a row or a mark carries. */
  readonly pointer: string;
  readonly sessionId: string;
  readonly turnUuid: string;
  /** The ISO instant the turn was recorded, or "" when the line carried none. */
  readonly timestamp: string;
  /** The owner's words, every wrapper stripped. */
  readonly text: string;
  readonly lineNumber: number;
  readonly source: HumanTurnSource;
  /** Present when an unclosed wrapper took the rest of the turn, so {@link text} is short of what the record holds. */
  readonly tailCut?: true;
  /** Present when a wrapper span was cut from between the owner's words, so {@link text} joins what the record kept apart. */
  readonly spliced?: true;
}

/** What an intake-ledger mark says a turn became, when it did not become a board row. */
export type IntakeMarkKind = "card" | "answered" | "no-ask";

/** The three mark kinds, in the order a usage line lists them. */
export const INTAKE_MARK_KINDS: readonly IntakeMarkKind[] = ["card", "answered", "no-ask"];

/** One line of the intake ledger: a turn, what it became, and who says so. */
export interface IntakeMark {
  /** The turn this mark witnesses, in pointer form. */
  readonly pointer: string;
  readonly kind: IntakeMarkKind;
  /** The checkable thing behind it: a card's question, the slug or permalink an answer went to, or the reason a turn asked for nothing. */
  readonly witness: string;
  readonly markedAtIso: string;
  /** The `CLAUDE_CODE_SESSION_ID` that wrote the mark — attributable, never authenticated. */
  readonly byClaudeSessionId: string;
}

/**
 * Where a turn's witness came from. `row` and `settlement` are read off the board — `row` either a row anchored at
 * the turn or the relay row a delivery line names — `wake` off the turn itself, and the rest off the ledger.
 */
export type WitnessKind = "row" | "settlement" | "wake" | IntakeMarkKind;

/** The witness one turn has. */
export interface TurnWitness {
  readonly kind: WitnessKind;
  /** The row slug, or the mark's own witness text. */
  readonly witness: string;
}

/** One owner turn with its verdict. */
export interface WitnessedTurn {
  readonly turn: OwnerTurn;
  /** Absent when nothing on the board or in the ledger points at this turn. */
  readonly witness: TurnWitness | undefined;
  /** True while the turn is younger than {@link INTAKE_GRACE_MS} and unwitnessed — the tick is not over. */
  readonly inGrace: boolean;
}

/** One supervisor session the check walked, and what it yielded. */
export interface IntakeLeg {
  readonly sessionId: string;
  /** The floor this leg's turns were read from, or `undefined` when its whole transcript was read. */
  readonly fromIso: string | undefined;
  /** How many owner turns the window kept from this session. */
  readonly turns: number;
}

/** What checking the supervisor chain's intake found. */
export interface IntakeFinding {
  /** Every supervisor session walked, in succession order — the chain, not one transcript. */
  readonly legs: readonly IntakeLeg[];
  /** What the read could and could not see. Carried in the finding so a short read cannot look complete. */
  readonly coverage: ChainCoverage;
  /** The floor the turns were read from, or `undefined` when the whole chain was read. */
  readonly sinceIso: string | undefined;
  /** Every turn read, in chain order, each with its verdict. */
  readonly turns: readonly WitnessedTurn[];
  /** Turns past the grace window that nothing witnesses — the finding. */
  readonly unwitnessed: readonly OwnerTurn[];
  /** Turns still inside the grace window with no witness yet. */
  readonly inGrace: number;
  /** Turns a session dismissed as asking for nothing — counted apart so a dismiss-everything supervisor shows. */
  readonly markedNoAsk: number;
  /** Turns with a row, settlement, card or answer behind them. */
  readonly witnessed: number;
}

/**
 * The intake half of a reconciliation: read, or not, with the reason.
 *
 * `unavailable` is a first-class outcome and it prints. A machine with no supervisor pin, a pin naming a
 * session that is no longer live, or a transcript that could not be walked must each read as "not checked"
 * rather than as "nothing to report" — the two are indistinguishable on the page otherwise, and the
 * second is the lie this whole check exists to stop.
 */
export type IntakeReport =
  // `typed` is the owner's typed console turns (`./typedIntake.ts`), kept apart because it carries no words; absent where
  // a reader never asks for it.
  | {
      readonly kind: "read";
      readonly finding: IntakeFinding;
      readonly inbound: InboundFinding;
      readonly typed?: TypedIntakeReport;
    }
  | { readonly kind: "unavailable"; readonly why: string };

/** The narrow view of a board row this check reads — a doc's slug and the two fields that can name a turn. */
export interface RowAnchors {
  readonly slug: string;
  readonly anchor: string | undefined;
  readonly settlementWitness: string | undefined;
}

/**
 * Read one ledger line, refusing anything that is not completely a mark.
 *
 * @param line one line of the journal
 * @returns the mark, or `undefined` for a blank, malformed or incomplete line
 */
export function parseIntakeMarkLine({ line }: { line: string }): IntakeMark | undefined {
  if (line.trim().length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const pointer = parsed["pointer"];
  const kind = parsed["kind"];
  const witness = parsed["witness"];
  const markedAtIso = parsed["markedAtIso"];
  const byClaudeSessionId = parsed["byClaudeSessionId"];
  const knownKind = INTAKE_MARK_KINDS.find((known) => known === kind);
  if (
    typeof pointer !== "string" ||
    knownKind === undefined ||
    typeof witness !== "string" ||
    typeof markedAtIso !== "string" ||
    typeof byClaudeSessionId !== "string"
  ) {
    return undefined;
  }
  // Read back in the form the writer stores, so a hand-written spelling of one turn is the same turn to every
  // reader (an upper-case relay anchor is a re-mark the reuse gate refuses). An unparseable pointer
  // stays as written — it matches nothing, as before.
  let stored = pointer;
  const normalised = normalisedTurnPointer({ pointer });
  if (normalised !== undefined) {
    stored = normalised;
  }
  return { byClaudeSessionId, kind: knownKind, markedAtIso, pointer: stored, witness: witness.trim() };
}

/** A turn pointer in the one form a mark stores, or `undefined` when it is not one of the three forms. */
function normalisedTurnPointer({ pointer }: { pointer: string }): string | undefined {
  const parsed = parseTurnPointer({ text: pointer });
  if (parsed !== undefined) {
    return formatTurnPointer({ pointer: parsed });
  }
  const relay = parseRelayAnchor({ text: pointer });
  if (relay !== undefined) {
    return relay;
  }
  return parseCallPointer({ text: pointer });
}

/**
 * Every decodable mark in a journal, in file order.
 *
 * @param text the whole journal
 * @returns the marks; a line that will not decode is skipped rather than failing the read
 */
export function parseIntakeMarkJournal({ text }: { text: string }): readonly IntakeMark[] {
  return text
    .split("\n")
    .map((line) => parseIntakeMarkLine({ line }))
    .filter((mark): mark is IntakeMark => mark !== undefined);
}

/**
 * Build one mark, refusing a pointer that is not a turn pointer or a witness that says nothing.
 *
 * Three pointer forms mark a turn: an owner turn in a supervisor transcript, a voice relay's `talk:<turnId>` —
 * the owner's word that reached the board without reaching the chat (`../talk/relayIntake.ts`) — and a stretch of
 * their speech on a call, `talk-call:<callId>#<segmentId>`, which `talk unread` prints whether or not it was relayed.
 *
 * @param pointer the turn being marked, in pointer form
 * @param kind what the turn became
 * @param witness the checkable thing behind the mark
 * @param markedAtIso when it is being written
 * @param byClaudeSessionId the session writing it
 * @returns the mark, or the one-line refusal
 */
export function buildIntakeMark({
  pointer,
  kind,
  witness,
  markedAtIso,
  byClaudeSessionId,
}: {
  pointer: string;
  kind: IntakeMarkKind;
  witness: string;
  markedAtIso: string;
  byClaudeSessionId: string;
}): { readonly mark: IntakeMark } | { readonly refusal: string } {
  const normalised = normalisedTurnPointer({ pointer });
  if (normalised === undefined) {
    return {
      refusal: `${pointer} is not a turn pointer — the form is transcript:<sessionId>#<turnUuid>, talk:<turnId> or talk-call:<callId>#<segmentId>`,
    };
  }
  if (witness.trim().length === 0) {
    return {
      refusal: "--witness is required — the card's question, where the answer went, or why the turn asked for nothing",
    };
  }
  return {
    mark: {
      byClaudeSessionId,
      kind,
      markedAtIso,
      pointer: normalised,
      witness: witness.trim(),
    },
  };
}

/**
 * Every turn pointer the board names, and what names it.
 *
 * A row's `anchor:` is where the owner said it, so a row anchored to a turn IS that turn's witness. A settled ask's
 * `settlementWitness:` may also be a turn — the one where the owner answered or declined it — and that witnesses
 * the answering turn. Anything that is not a turn pointer (a Slack permalink, a GitHub URL) is skipped
 * here, because it addresses something else.
 *
 * @param rows the board, narrowed to the fields that can carry a pointer
 * @returns pointer → witness, first row wins where two rows name one turn
 */
export function rowWitnesses({ rows }: { rows: readonly RowAnchors[] }): ReadonlyMap<string, TurnWitness> {
  const witnesses = new Map<string, TurnWitness>();
  for (const row of rows) {
    claimTurn({ field: row.anchor, kind: "row", slug: row.slug, witnesses });
    claimTurn({ field: row.settlementWitness, kind: "settlement", slug: row.slug, witnesses });
  }
  return witnesses;
}

/** Record `slug` as the `kind` witness of the turn `field` points at, when it points at one and nothing claimed it first. */
function claimTurn({
  field,
  kind,
  slug,
  witnesses,
}: {
  field: string | undefined;
  kind: "row" | "settlement";
  slug: string;
  witnesses: Map<string, TurnWitness>;
}): void {
  const pointer = field === undefined ? undefined : parseTurnPointer({ text: field });
  if (pointer === undefined) {
    return;
  }
  const key = formatTurnPointer({ pointer });
  if (!witnesses.has(key)) {
    witnesses.set(key, { kind, witness: slug });
  }
}

/**
 * Whether a turn is still inside the grace window at `nowIso`.
 *
 * A turn with no readable instant is NOT in grace: it cannot be shown to be young, and "unknown age" read as
 * "too young to count" would exempt exactly the records this check cannot see properly.
 */
function withinGrace({ turn, nowIso }: { turn: OwnerTurn; nowIso: string }): boolean {
  const at = Date.parse(turn.timestamp);
  const now = Date.parse(nowIso);
  if (Number.isNaN(at) || Number.isNaN(now)) {
    return false;
  }
  return now - at < INTAKE_GRACE_MS;
}

/** What `parseRelayAnchor` opens a normalised relay anchor with. */
const RELAY_ANCHOR_PREFIX = "talk:";

/**
 * The slugs of every relay row on the board whose own `talk:<turnId>` anchor mints that slug — the rows a delivery
 * line can be witnessed by. A row merely NAMED `talk-…` is not one: checking the anchor is what stops an unrelated
 * or malformed row from clearing a delivery it never recorded.
 */
function relayRowSlugs({ rows }: { rows: readonly RowAnchors[] }): ReadonlySet<string> {
  const slugs = new Set<string>();
  for (const row of rows) {
    const anchor = row.anchor === undefined ? undefined : parseRelayAnchor({ text: row.anchor });
    if (anchor !== undefined && relaySlug({ turnId: anchor.slice(RELAY_ANCHOR_PREFIX.length) }) === row.slug) {
      slugs.add(row.slug);
    }
  }
  return slugs;
}

/**
 * A turn's witness: a row whose anchor or settlement names it, else — for a relay's delivery line — the relay's own
 * row, else — for a chair wake (`../talk/chairWake.ts`) — the call file it points at, or for a quiet batch the anchors
 * it lists, else its ledger mark, else none.
 * A wake carries none of the owner's words, so there is nothing in it to register: their words are the call file's, and
 * `talk unread` and `tick-record` hold the chair to those. Only the EXACT line counts — one that opens like a wake and
 * goes on in anyone's words stays a turn of the owner's to witness.
 */
function witnessFor({
  fromRows,
  fromRelayRows,
  fromMarks,
  turn,
}: {
  fromRows: ReadonlyMap<string, TurnWitness>;
  fromRelayRows: ReadonlySet<string>;
  fromMarks: ReadonlyMap<string, TurnWitness>;
  turn: OwnerTurn;
}): TurnWitness | undefined {
  const fromRow = fromRows.get(turn.pointer);
  if (fromRow !== undefined) {
    return fromRow;
  }
  const relay = relayLineSlug({ text: turn.text });
  if (relay !== undefined && fromRelayRows.has(relay)) {
    return { kind: "row", witness: relay };
  }
  const woken = chairWakeCallId({ text: turn.text });
  if (woken !== undefined) {
    return { kind: "wake", witness: `talk-call:${woken}` };
  }
  const batch = batchWitness({ fromRelayRows, text: turn.text });
  if (batch !== undefined) {
    return batch;
  }
  return fromMarks.get(turn.pointer);
}

/**
 * Set every owner turn against the board and the ledger.
 *
 * A board row outranks a ledger mark for the same turn, because a row is the stronger witness — it is on the
 * one board, ranked, with a terminal state — and a reader following the witness should land there first. Among
 * a turn's marks, `./intakeWitness.ts`'s `preferredMark` picks the one that stands, so free text shared across
 * many turns never masks a specific carrier written earlier.
 *
 * A relay's DELIVERY line is witnessed by the relay's own row. `../talk/supervisorDelivery.ts` types
 * `[voice relay talk-<12 hex>] the owner said: "…"`, then the verify phrase, into the chair only once that row is on the board, so the line is the
 * same words arriving a second time, and before this join every relay counted twice — once as its row, once as an
 * unwitnessed owner turn. MEASURED: of 211 unwitnessed turns in a 24-hour window, 204 were
 * delivery lines and every sampled one had its row; reproduce with `slopweaver supervisor intake --since
 * <iso> --now <iso>` over any 24 hours. A line naming a slug with no such row stays unwitnessed: an
 * orphaned or forged delivery is exactly what this check should still surface. The row being on the board says the
 * words were recorded, not that the row was acted on — that is the row's own lifecycle, read on the board.
 *
 * @param legs the supervisor sessions the turns came from, in succession order
 * @param coverage what the chain read could and could not see
 * @param sinceIso the floor the turns were read from, for the report
 * @param turns every owner turn read, in chain order
 * @param rows the board, narrowed to its pointer-bearing fields
 * @param marks the intake ledger
 * @param nowIso the instant the grace window is judged at
 * @returns the finding
 */
export function witnessTurns({
  legs,
  coverage,
  sinceIso,
  turns,
  rows,
  marks,
  nowIso,
}: {
  legs: readonly IntakeLeg[];
  coverage: ChainCoverage;
  sinceIso: string | undefined;
  turns: readonly OwnerTurn[];
  rows: readonly RowAnchors[];
  marks: readonly IntakeMark[];
  nowIso: string;
}): IntakeFinding {
  const fromRows = rowWitnesses({ rows });
  const fromRelayRows = relayRowSlugs({ rows });
  const fromMarks = new Map<string, TurnWitness>();
  // A later mark corrects an earlier one, but never from a lower rank: `./intakeWitness.ts` says why.
  const standing = preferredMarks({ marks, slugs: new Set(rows.map((row) => row.slug)) });
  for (const [pointer, mark] of standing) {
    fromMarks.set(pointer, { kind: mark.kind, witness: mark.witness });
  }
  const judged: WitnessedTurn[] = turns.map((turn) => {
    const witness = witnessFor({ fromMarks, fromRelayRows, fromRows, turn });
    return { inGrace: witness === undefined && withinGrace({ nowIso, turn }), turn, witness };
  });
  return {
    coverage,
    inGrace: judged.filter((item) => item.inGrace).length,
    legs,
    markedNoAsk: judged.filter((item) => item.witness?.kind === "no-ask").length,
    sinceIso,
    turns: judged,
    unwitnessed: judged.filter((item) => item.witness === undefined && !item.inGrace).map((item) => item.turn),
    witnessed: judged.filter((item) => item.witness !== undefined && item.witness.kind !== "no-ask").length,
  };
}

/**
 * The intake finding as one short sentence, carried BESIDE the reconciliation's headline rather than inside
 * it — `../cli/commands/handover/reconcileRun.ts` emits it as its own `intakeClause` field and the fleet
 * briefing renders it in the alignment section's own fold (`../outbound/briefing/render.ts`).
 *
 * It used to be appended to the headline, and that is the defect this shape closes. MEASURED with
 * the maximal report of each half: the reconciliation's own sentence then ran to 50 words, this one to 44 across
 * two sentences when a coverage gap is disclosed, and the two joined ran to 94 words and 3 sentences — over
 * `../briefing/caps.ts`'s `ALIGNMENT_MAX_WORDS` of 55 and its `ALIGNMENT_MAX_SENTENCES` of 2 at once. So the
 * sweep contract's rule (the headline goes VERBATIM into the required alignment field) and the render's
 * refusal contradicted each other, and a sweep resolved it by rewriting a generated line. Reproduce both
 * measurements with `yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/handover/reconcile.test.ts
 * src/__tests__/unit/supervisor/intake.test.ts`.
 *
 * Being folded is what makes it uncapped: this sentence is bounded by nothing here, exactly like every other
 * fold on that page, because a reader chooses to open it.
 *
 * Counts, never quotes: the turns themselves go in the fold, or come out of `slopweaver supervisor intake`.
 *
 * The same walk reads the messages other sessions sent the chain (`./inbound.ts`), and a sentence about the
 * open ones follows the owner-turn sentence only when there are any, so a clean chain reads exactly as before.
 *
 * @param report the intake half
 * @returns one sentence, full stop included, plus an inbound sentence when messages are open and a coverage
 *   sentence when the read was short
 */
export function intakeClause({ report }: { report: IntakeReport }): string {
  if (report.kind === "unavailable") {
    return `Owner turns unread: ${report.why}.`;
  }
  const finding = report.finding;
  const floor = finding.sinceIso === undefined ? "" : ` since ${finding.sinceIso}`;
  const sessions = `across ${String(finding.legs.length)} supervisor session(s)${floor}`;
  const gap = coverageClause({ coverage: finding.coverage });
  const parts = [typedIntakeSentence({ report: report.typed }), inboundSentence({ finding: report.inbound }), gap];
  const tail = parts.flatMap((part) => (part === "" ? [] : [` ${part}`])).join("");
  if (finding.unwitnessed.length > 0) {
    return `${String(finding.unwitnessed.length)} owner turn(s) ${sessions} have no row or card.${tail}`;
  }
  const dismissed = finding.markedNoAsk > 0 ? `, ${String(finding.markedNoAsk)} marked no-ask` : "";
  return `Owner turns: ${String(finding.turns.length)} read ${sessions}, all witnessed${dismissed}.${tail}`;
}

/** How much of a turn's text the suggested `--ask` carries, in characters. */
const ASK_EXCERPT_CHARS = 120;

/**
 * The exact `handover register` line that would witness one turn, ready to paste.
 *
 * The excerpt is the owner's first line, cut at {@link ASK_EXCERPT_CHARS}, and it is a STARTING POINT: a turn that
 * carried two asks wants two rows, and the composer writes the second by hand with the same anchor. The
 * anchor is what matters — `handover register` derives the instant from it, so nothing here is typed by
 * hand that could be eighty minutes wrong.
 *
 * @param turn the unwitnessed turn
 * @returns the command line
 */
export function registerCommandFor({ turn }: { turn: OwnerTurn }): string {
  const firstLine = turn.text.split("\n").find((line) => line.trim().length > 0);
  if (firstLine === undefined) {
    return `slopweaver handover register --ask "" --anchor ${turn.pointer}`;
  }
  const excerpt =
    firstLine.length > ASK_EXCERPT_CHARS ? `${firstLine.slice(0, ASK_EXCERPT_CHARS).trimEnd()}…` : firstLine;
  return `slopweaver handover register --ask ${JSON.stringify(excerpt)} --anchor ${turn.pointer}`;
}
