/**
 * The briefing's three narrative sections, PROJECTED from the supervisor tick ledger instead of authored.
 *
 * `recent`, `earlierToday` and `history` are derived the way `./yourList.ts` and the pull-request cards are,
 * so a pass registers and derives rather than composes — the reason being the Fable draw of writing them by
 * hand every twenty minutes, and that deriving removes a point of failure. `../supervisor/tickStore.ts` is the
 * RECORDER; this is the projection.
 *
 * ## What each section is, and why it is not negotiable here
 *
 * **`recent` is LANDINGS.** `../outbound/briefing/render.ts`'s `renderRecent` prints
 * "N landing(s) since you last looked" and derives that N from the array's own length, so anything else in
 * this section makes the page's own sentence false. The section exists because the owner wants to know what
 * has actually landed over time.
 *
 * **`earlierToday` is ONE bounded rollup, not one note per pass.** `./caps.ts`'s `SECTION_MAX_NOTES` is
 * thirty and a Melbourne day holds up to seventy-two recorded passes, so a note per pass would refuse the
 * page outright most afternoons. The day becomes five categorical notes instead, each carrying every atom of
 * its category.
 *
 * **A day is a MELBOURNE day** (`./localDay.ts`). Never a UTC slice: a pass in the owner's morning on a UTC
 * machine is the previous evening by `Date`'s reckoning, which would file ten hours of the owner's morning under
 * history.
 *
 * ## A record is quoted, never re-worded — and that is a lane, not a promise
 *
 * Every note whose fold holds RECORDED text carries `lane: "quoted"` (`../outbound/briefing/types.ts`),
 * which is what takes that text out of the rules written for composed prose: the bare-key-link rule, the
 * packed-enumeration and truncated-ellipsis refusals, and the plain-wording gate. Each of those is an
 * instruction to a composer, and a projection has nobody to instruct — the only way to satisfy one over a
 * record is to edit the record.
 *
 * MEASURED: rendering the live ledger through this projection when the lane covered only owner turns gave
 * THIRTEEN refusals, and not one of them was a word chosen here. They were a handover titled "Finding row …",
 * a live session's own recorded clause, an owner ruling using `the tick` — strings some other verb or work
 * item had already written down. That is why the lane is the record rather than only the owner's turns.
 *
 * What stays gated is everything this file COMPOSES: every note's headline, every fold's own summary, every
 * day's section summary. So what the owner meets before opening anything is still held to the plain-wording
 * rule, and only the quotation behind it is exempt.
 *
 * Every reference of the owner's that RESOLVES still becomes a real link through `./yourList.ts`'s
 * `linkifyRowText`, and a recorded pull request renders as a link too (`./narrativeSources.ts`) — the same
 * promotion the owner's own list already does, which changes not one character of the text.
 *
 * ## Conservation: the projection proves it dropped nothing
 *
 * Four kinds of ATOM — an owner turn, a landing, an action, a judgement — are enumerated from every retained
 * row by STRUCTURAL key (`<tickId>/<field>/<index>`), never by a record id, because an action id is only
 * guaranteed unique inside its own row. Notes and their atom references are generated TOGETHER from one
 * traced representation, so the receipt is a by-product of rendering rather than a second count that can
 * agree with nothing. {@link checkNarrativeConservation} then refuses unless every expected atom appears
 * exactly once across what was rendered and what was explicitly omitted.
 *
 * Only a repeat may be omitted, and only with its representative named. A row records the turns it could see
 * in a trailing window, so consecutive passes re-observe the same turn — that is duplication in the LEDGER,
 * not a reason to show the owner one sentence nine times. An action or a judgement is never omitted at all.
 *
 * **Atom-level conservation cannot cover the whole ledger, and the page says so.** `SupervisorTickWindow`
 * keeps rows for the newest five local days and COUNTS the rest, so older days have no atoms to conserve.
 * `ticksOmitted` and `olderDaysOmitted` are disclosed rather than quietly not shown.
 *
 * Pure: a window in, sections out. No clock, no filesystem — the window is a value the caller read.
 */
import { err, ok, type Result } from "../lib/result.js";
import type { BriefingNote, BriefingSection } from "../outbound/briefing/types.js";
import type { SupervisorTickWindow } from "../supervisor/tickStore.js";
import type { FleetLanding, SupervisorOwnerTurn, SupervisorTickRow } from "../supervisor/tickTypes.js";
import { PAGE_UNFOLDED_BLOCKS_MAX } from "./caps.js";
import { localDayKey } from "./localDay.js";
import {
  count,
  landingContent,
  type PlacedAction,
  type PlacedJudgement,
  projectDay,
  type TracedNote,
} from "./narrativeDay.js";
import { type NarrativeError, NarrativeErrors } from "./narrativeErrors.js";

/**
 * Which kind of recorded thing one atom is.
 *
 * @internal — read by this module, `./narrativeDay.ts` and their own tests; nothing outside names it.
 */
export type NarrativeAtomKind = "owner-turn" | "landing" | "action" | "judgement";

/**
 * One atom, addressed by where it SITS rather than by what it calls itself.
 *
 * A structural key (`<tickId>/actions/2`) rather than `actionId`, because a record id is only guaranteed
 * unique within its own row — `../supervisor/tickSchema.ts` does not reject two rows reusing one — while a
 * row id plus a field plus an index is unique by construction across the whole window.
 *
 * @internal — read by this module, `./narrativeDay.ts` and their own tests; nothing outside names it.
 */
export interface NarrativeAtomRef {
  readonly key: string;
  readonly kind: NarrativeAtomKind;
}

/**
 * One atom deliberately not rendered, with the atom that stands for it.
 *
 * @internal — read by this module and its own tests; a caller reads the receipt, never this shape alone.
 */
export interface NarrativeOmission {
  readonly ref: NarrativeAtomRef;
  readonly reason: "repeat-owner-turn" | "repeat-landing";
  /** The key of the atom a reader meets instead. Always one of the rendered ones. */
  readonly representedBy: string;
}

/** What the projection can prove about what it did with the window it was given. */
export interface SupervisorNarrativeReceipt {
  readonly expected: readonly NarrativeAtomRef[];
  readonly rendered: readonly NarrativeAtomRef[];
  readonly omitted: readonly NarrativeOmission[];
  readonly ticksInLedger: number;
  readonly ticksProjected: number;
  readonly ticksOmitted: number;
  readonly olderDaysOmitted: number;
}

/** The three sections, the instant they were last finalised at, and the receipt behind them. */
export interface SupervisorNarrativeProjection {
  readonly recent: readonly BriefingNote[];
  readonly earlierToday: BriefingSection;
  readonly history: readonly BriefingSection[];
  /** The newest retained row's own finalisation instant, which is what the page's freshness is clamped to. */
  readonly newestFinalisedIso: string;
  readonly receipt: SupervisorNarrativeReceipt;
}

/** One atom's structural key. */
function atomKey({ tickId, field, index }: { tickId: string; field: string; index: number }): string {
  return `${tickId}/${field}/${String(index)}`;
}

/** Every atom one row carries, in the order a reader would meet them. */
function atomsOfRow({ row }: { row: SupervisorTickRow }): readonly NarrativeAtomRef[] {
  const turns = row.ownerTurns.turns.map((_turn, index): NarrativeAtomRef => ({
    key: atomKey({ field: "ownerTurns.turns", index, tickId: row.tickId }),
    kind: "owner-turn",
  }));
  const landings =
    row.sources.landings.status === "unavailable"
      ? []
      : row.sources.landings.facts.landings.map((_landing, index): NarrativeAtomRef => ({
          key: atomKey({ field: "sources.landings.facts.landings", index, tickId: row.tickId }),
          kind: "landing",
        }));
  const actions = row.actions.map((_action, index): NarrativeAtomRef => ({
    key: atomKey({ field: "actions", index, tickId: row.tickId }),
    kind: "action",
  }));
  const judgements = row.judgements.map((_judgement, index): NarrativeAtomRef => ({
    key: atomKey({ field: "judgements", index, tickId: row.tickId }),
    kind: "judgement",
  }));
  return [...turns, ...landings, ...actions, ...judgements];
}

/** Every retained row of the window, oldest first, with the newest row's own day last. */
function retainedRows({ window }: { window: SupervisorTickWindow }): readonly SupervisorTickRow[] {
  return [...window.priorDays.toReversed().flatMap((day) => day.ticks), ...window.currentDay];
}

/** One owner turn, paired with the atom it came from. Read by `./narrativeDay.ts` when it renders one. */
export interface PlacedTurn {
  readonly ref: NarrativeAtomRef;
  readonly turn: SupervisorOwnerTurn;
}

/** One landing, paired with the atom it came from. */
export interface PlacedLanding {
  readonly ref: NarrativeAtomRef;
  readonly landing: FleetLanding;
}

/**
 * What identifies one owner turn across two observations of it.
 *
 * `sessionId` plus `transcriptLineNumber`, never the pointer: a pointer is how a reader is sent to a turn
 * rather than what the turn IS, and two different turns can share one. A turn whose transcript position is
 * `null` has no identity this can trust, so it is never deduplicated — every occurrence renders, which is
 * the answer that cannot lose one of the owner's sentences.
 *
 * @param turn the recorded turn
 * @returns the identity, or `undefined` when this turn has none
 */
function turnIdentity({ turn }: { turn: SupervisorOwnerTurn }): string | undefined {
  if (turn.transcriptLineNumber === null) {
    return undefined;
  }
  return `${turn.sessionId}#${String(turn.transcriptLineNumber)}`;
}

/** One turn's whole payload, so two observations at one position can be compared rather than assumed equal. */
function turnPayload({ turn }: { turn: SupervisorOwnerTurn }): string {
  return JSON.stringify([turn.text, turn.instantIso, turn.source, turn.pointer, turn.turnUuid]);
}

/** One landing's whole payload, for the same reason {@link turnPayload} exists. */
function landingPayload({ landing }: { landing: FleetLanding }): string {
  if (landing.kind === "pull-request") {
    return JSON.stringify([
      landing.kind,
      landing.repo,
      landing.number,
      landing.title,
      landing.url,
      landing.landedAtIso,
      landing.mergeCommitSha,
    ]);
  }
  return JSON.stringify([landing.kind, landing.slug, landing.label, landing.landedAtIso, landing.witness]);
}

/** What deduplicating one category produced: what to render, and what was omitted for whom. */
interface Deduplicated<TPlaced> {
  readonly kept: readonly TPlaced[];
  readonly omitted: readonly NarrativeOmission[];
  /** Why the whole projection must refuse, when one identity carried two different payloads. */
  readonly defects: readonly string[];
}

/**
 * Keep ONE observation of each identity, and point every other one at it.
 *
 * Two observations of one identity carrying DIFFERENT payloads is a refusal rather than a choice — the ledger
 * would be disagreeing with itself about what was recorded, and picking either one would be this code
 * deciding.
 *
 * **Which occurrence is kept is not a preference, it is a constraint, and it differs by category.**
 *
 * A TURN keeps the EARLIEST: placement follows first sighting, so something the owner typed this morning belongs
 * where it was first seen rather than under the pass that happened to re-read it at four.
 *
 * A LANDING keeps the NEWEST, because `recent` is built from `window.newest` and must render an atom this
 * function KEPT. MEASURED by a review pass, on a window where two passes saw one landing: keeping
 * the earliest made `recent` render an atom the receipt had already called omitted, so the same atom was
 * accounted for twice and the conservation check refused the whole page — and had it not, the day's rollup
 * would have shown the landing a second time under the older pass.
 *
 * @param placed every occurrence, in reading order
 * @param identity how to name one occurrence, `undefined` when it has no identity to deduplicate on
 * @param payload the whole recorded value, compared byte for byte
 * @param reason which omission reason the other occurrences carry
 * @param what how a refusal names this category to a reader
 * @param keep which occurrence a reader meets — see above; neither choice is cosmetic
 * @returns what to render, what was omitted, and any refusal
 */
function dedupe<TPlaced extends { readonly ref: NarrativeAtomRef }>({
  placed,
  identity,
  payload,
  reason,
  what,
  keep,
}: {
  placed: readonly TPlaced[];
  identity: (args: { item: TPlaced }) => string | undefined;
  payload: (args: { item: TPlaced }) => string;
  reason: NarrativeOmission["reason"];
  what: string;
  keep: "earliest" | "newest";
}): Deduplicated<TPlaced> {
  const chosen = chooseWinners({ identity, keep, payload, placed, what });
  // Rebuilt from the original order rather than accumulated, so that keeping the NEWEST occurrence still
  // reports every other one as an omission rather than silently losing the ones seen before it.
  const kept: TPlaced[] = [...chosen.anonymous];
  const omitted: NarrativeOmission[] = [];
  for (const id of chosen.order) {
    const winner = chosen.winners.get(id)!;
    kept.push(winner);
    for (const item of placed) {
      if (identity({ item }) === id && item.ref.key !== winner.ref.key) {
        omitted.push({ reason, ref: item.ref, representedBy: winner.ref.key });
      }
    }
  }
  return { defects: chosen.defects, kept, omitted };
}

/** One identity's winner, the order identities were first seen in, and what could not be reconciled. */
interface Chosen<TPlaced> {
  readonly winners: ReadonlyMap<string, TPlaced>;
  /** First-sighting order, so the kept list reads the way the ledger does rather than the way a Map does. */
  readonly order: readonly string[];
  /** Every occurrence with no identity to deduplicate on; each is kept as its own. */
  readonly anonymous: readonly TPlaced[];
  readonly defects: readonly string[];
}

/**
 * One pass over the occurrences, picking which one of each identity a reader meets.
 *
 * Split from {@link dedupe} because the two halves are different questions — this one decides WHICH, and
 * that one turns the decision into kept-and-omitted — and together they scored past the branch-and-nesting
 * ceiling the `cognitive-complexity` gate keeps.
 *
 * @param placed every occurrence, in reading order
 * @param identity how to name one, `undefined` when it has none
 * @param payload the whole recorded value, compared byte for byte
 * @param what how a refusal names this category
 * @param keep which occurrence wins — see {@link dedupe}, where neither choice is cosmetic
 * @returns the winners, the order they were first seen in, the anonymous ones and any refusal
 */
function chooseWinners<TPlaced extends { readonly ref: NarrativeAtomRef }>({
  placed,
  identity,
  payload,
  what,
  keep,
}: {
  placed: readonly TPlaced[];
  identity: (args: { item: TPlaced }) => string | undefined;
  payload: (args: { item: TPlaced }) => string;
  what: string;
  keep: "earliest" | "newest";
}): Chosen<TPlaced> {
  const winners = new Map<string, TPlaced>();
  const payloads = new Map<string, string>();
  const anonymous: TPlaced[] = [];
  const order: string[] = [];
  const defects: string[] = [];
  for (const item of placed) {
    const id = identity({ item });
    if (id === undefined) {
      anonymous.push(item);
      continue;
    }
    const value = payload({ item });
    const seenPayload = payloads.get(id);
    if (seenPayload === undefined) {
      winners.set(id, item);
      payloads.set(id, value);
      order.push(id);
      continue;
    }
    if (seenPayload !== value) {
      defects.push(
        `${what} ${id} was recorded twice with different contents (${winners.get(id)!.ref.key} and ${item.ref.key}).`,
      );
      continue;
    }
    if (keep === "newest") {
      winners.set(id, item);
    }
  }
  return { anonymous, defects, order, winners };
}

/** Every owner turn of every retained row, in reading order, each carrying its own atom. */
function placedTurns({ rows }: { rows: readonly SupervisorTickRow[] }): readonly PlacedTurn[] {
  return rows.flatMap((row) =>
    row.ownerTurns.turns.map((turn, index): PlacedTurn => ({
      ref: { key: atomKey({ field: "ownerTurns.turns", index, tickId: row.tickId }), kind: "owner-turn" },
      turn,
    })),
  );
}

/** Every landing of every retained row, in reading order, each carrying its own atom. */
function placedLandings({ rows }: { rows: readonly SupervisorTickRow[] }): readonly PlacedLanding[] {
  return rows.flatMap((row) => {
    if (row.sources.landings.status === "unavailable") {
      return [];
    }
    return row.sources.landings.facts.landings.map((landing, index): PlacedLanding => ({
      landing,
      ref: {
        key: atomKey({ field: "sources.landings.facts.landings", index, tickId: row.tickId }),
        kind: "landing",
      },
    }));
  });
}

/**
 * `recent`: one note per landing the NEWEST pass saw, oldest landing first.
 *
 * The newest observation rather than every retained one, because the section's own sentence is about what
 * landed "since you last looked" and the newest reading is the current answer. Every earlier copy of a
 * landing is an omission pointing at the note here, so nothing is lost — see {@link dedupe}.
 *
 * @param window the ledger slice
 * @returns the notes and the atoms they rendered, or the refusal
 */
function projectRecent({ window }: { window: SupervisorTickWindow }): Result<readonly TracedNote[], NarrativeError> {
  const observation = window.newest.sources.landings;
  if (observation.status === "unavailable") {
    return ok([]);
  }
  const landings = placedLandings({ rows: [window.newest] });
  if (landings.length > PAGE_UNFOLDED_BLOCKS_MAX) {
    return err(NarrativeErrors.tooManyLandings({ cap: PAGE_UNFOLDED_BLOCKS_MAX, seen: landings.length }));
  }
  return ok(
    landings
      .toSorted((left, right) => {
        const byTime = left.landing.landedAtIso.localeCompare(right.landing.landedAtIso);
        return byTime === 0 ? left.landing.landingId.localeCompare(right.landing.landingId) : byTime;
      })
      .map((placed) => ({ note: { headline: landingContent({ landing: placed.landing }) }, rendered: [placed.ref] })),
  );
}

/** Every action of every row, in reading order, each carrying its own atom. */
function placedActions({ rows }: { rows: readonly SupervisorTickRow[] }): readonly PlacedAction[] {
  return rows.flatMap((row) =>
    row.actions.map((action, index): PlacedAction => ({
      action,
      ref: { key: atomKey({ field: "actions", index, tickId: row.tickId }), kind: "action" },
    })),
  );
}

/** Every judgement of every row, in reading order, each carrying its own atom. */
function placedJudgements({ rows }: { rows: readonly SupervisorTickRow[] }): readonly PlacedJudgement[] {
  return rows.flatMap((row) =>
    row.judgements.map((judgement, index): PlacedJudgement => ({
      judgement,
      ref: { key: atomKey({ field: "judgements", index, tickId: row.tickId }), kind: "judgement" },
    })),
  );
}

/** Which day one atom's row belongs to, so a deduplicated atom lands in the right rollup. */
function dayOfRow({ row }: { row: SupervisorTickRow }): string {
  return localDayKey({ iso: row.finalisedIso });
}

/**
 * Check that every atom of the window appears exactly once across what was rendered and what was omitted.
 *
 * Run by {@link projectSupervisorNarrative} before it returns success, so a projection that lost one of the owner's
 * sentences fails the render rather than publishing a page that quietly does not carry it.
 *
 * @param window the ledger slice the projection read
 * @param receipt what the projection says it did
 * @returns the receipt, or one line per way the accounting does not add up
 */
export function checkNarrativeConservation({
  window,
  receipt,
}: {
  window: SupervisorTickWindow;
  receipt: SupervisorNarrativeReceipt;
}): Result<SupervisorNarrativeReceipt, NarrativeError> {
  const expected = new Map(receipt.expected.map((ref) => [ref.key, ref]));
  const defects: string[] = [];
  const accounted = new Map<string, number>();
  const tally = ({ key }: { key: string }): void => {
    const seen = accounted.get(key);
    accounted.set(key, seen === undefined ? 1 : seen + 1);
  };
  for (const ref of receipt.rendered) {
    tally({ key: ref.key });
  }
  for (const omission of receipt.omitted) {
    tally({ key: omission.ref.key });
    if (omission.ref.kind === "action" || omission.ref.kind === "judgement") {
      defects.push(`${omission.ref.key} is an ${omission.ref.kind} and was omitted; those are never omitted.`);
    }
  }
  defects.push(...omissionDefects({ receipt }), ...countDefects({ accounted, expected }));
  if (defects.length > 0) {
    return err(NarrativeErrors.conservationFailed({ defects, ticksInLedger: window.ticksInLedger }));
  }
  return ok(receipt);
}

/**
 * Every omission that points at an atom nobody rendered.
 *
 * @param receipt what the projection says it did
 * @returns one line per omission whose representative is not on the page
 */
function omissionDefects({ receipt }: { receipt: SupervisorNarrativeReceipt }): readonly string[] {
  const rendered = new Set(receipt.rendered.map((ref) => ref.key));
  return receipt.omitted
    .filter((omission) => !rendered.has(omission.representedBy))
    .map(
      (omission) => `${omission.ref.key} says it is represented by ${omission.representedBy}, which was not rendered.`,
    );
}

/**
 * Every atom counted the wrong number of times, in either direction.
 *
 * Both directions matter and they are different failures: an atom accounted for that the window does not
 * hold is a projection inventing something, and one the window holds that nothing accounted for is a
 * recorded thing the page would silently not carry.
 *
 * @param accounted how many times each key was rendered or omitted
 * @param expected every atom the window actually holds
 * @returns one line per atom whose accounting does not come to exactly one
 */
function countDefects({
  accounted,
  expected,
}: {
  accounted: ReadonlyMap<string, number>;
  expected: ReadonlyMap<string, NarrativeAtomRef>;
}): readonly string[] {
  const defects: string[] = [];
  for (const [key, times] of accounted) {
    if (!expected.has(key)) {
      defects.push(`${key} was accounted for but is not in the window at all.`);
      continue;
    }
    if (times !== 1) {
      defects.push(`${key} was accounted for ${count({ value: times })} times; every atom is accounted for once.`);
    }
  }
  for (const key of expected.keys()) {
    if (!accounted.has(key)) {
      defects.push(`${key} is in the window and was neither rendered nor omitted — the page would not carry it.`);
    }
  }
  return defects;
}

/**
 * Project one ledger window into the briefing's three narrative sections.
 *
 * @param window the bounded ledger slice, as `../supervisor/tickStore.ts` read it
 * @returns the sections and the receipt behind them, or one line per reason the projection refused
 */
export function projectSupervisorNarrative({
  window,
}: {
  window: SupervisorTickWindow;
}): Result<SupervisorNarrativeProjection, NarrativeError> {
  const rows = retainedRows({ window });
  const turns = dedupe({
    identity: ({ item }) => turnIdentity({ turn: item.turn }),
    payload: ({ item }) => turnPayload({ turn: item.turn }),
    keep: "earliest",
    placed: placedTurns({ rows }),
    reason: "repeat-owner-turn",
    what: "the same thing you said at",
  });
  const landings = dedupe({
    identity: ({ item }) => item.landing.landingId,
    payload: ({ item }) => landingPayload({ landing: item.landing }),
    keep: "newest",
    placed: placedLandings({ rows }),
    reason: "repeat-landing",
    what: "the landing",
  });
  const conflicts = [...turns.defects, ...landings.defects];
  if (conflicts.length > 0) {
    return err(NarrativeErrors.conflictingRecords({ conflicts }));
  }
  const recent = projectRecent({ window });
  if (recent.isErr()) {
    return err(recent.error);
  }
  const inRecent = new Set(recent.value.flatMap((traced) => traced.rendered.map((ref) => ref.key)));
  const projected = projectEachDay({ inRecent, landings, rows, turns, window });
  const today = projected[0]!;
  const receipt: SupervisorNarrativeReceipt = {
    expected: rows.flatMap((row) => atomsOfRow({ row })),
    olderDaysOmitted: window.olderDaysOmitted,
    omitted: [...turns.omitted, ...landings.omitted],
    rendered: [...recent.value.flatMap((traced) => traced.rendered), ...projected.flatMap((one) => one.rendered)],
    ticksInLedger: window.ticksInLedger,
    ticksOmitted: window.ticksInLedger - rows.length,
    ticksProjected: rows.length,
  };
  const conserved = checkNarrativeConservation({ receipt, window });
  if (conserved.isErr()) {
    return err(conserved.error);
  }
  return ok({
    earlierToday: today.section,
    history: projected.slice(1).map((one) => one.section),
    newestFinalisedIso: window.newest.finalisedIso,
    recent: recent.value.map((traced) => traced.note),
    receipt: conserved.value,
  });
}

/**
 * Every local day of the window as its own rollup, today first.
 *
 * Split from {@link projectSupervisorNarrative} because it is one question — which day does each atom belong
 * to — and inlining it put that function past the length the `max-function-lines` gate keeps.
 *
 * An atom's day comes from the ROW it was recorded on rather than from the day list it was filtered into, so
 * a window whose rows do not fall on the day it files them under loses those atoms here and is refused by
 * the conservation check rather than quietly rendering short.
 *
 * @param window the ledger slice
 * @param rows every retained row, oldest first
 * @param turns the deduplicated owner turns
 * @param landings the deduplicated landings
 * @param inRecent the atom keys `recent` already rendered, so a day does not show one twice
 * @returns one section and its rendered atoms per day, today first
 */
function projectEachDay({
  window,
  rows,
  turns,
  landings,
  inRecent,
}: {
  window: SupervisorTickWindow;
  rows: readonly SupervisorTickRow[];
  turns: Deduplicated<PlacedTurn>;
  landings: Deduplicated<PlacedLanding>;
  inRecent: ReadonlySet<string>;
}): readonly { readonly section: BriefingSection; readonly rendered: readonly NarrativeAtomRef[] }[] {
  const rowDay = new Map(rows.map((row) => [row.tickId, dayOfRow({ row })]));
  const dayOfKey = ({ key }: { key: string }): string => rowDay.get(key.slice(0, key.indexOf("/")))!;
  const days: readonly { readonly dayKey: string; readonly ticks: readonly SupervisorTickRow[] }[] = [
    { dayKey: dayOfRow({ row: window.newest }), ticks: window.currentDay },
    ...window.priorDays,
  ];
  const oldest = days[days.length - 1]!;
  const tail =
    `showing ${count({ value: rows.length })} of ${count({ value: window.ticksInLedger })} recorded ` +
    `pass(es); ${count({ value: window.olderDaysOmitted })} older day(s) are not on this page`;
  return days.map((day) =>
    projectDay({
      input: {
        actions: placedActions({ rows: day.ticks }),
        dayKey: day.dayKey,
        inRecent,
        judgements: placedJudgements({ rows: day.ticks }),
        landings: landings.kept.filter((placed) => dayOfKey({ key: placed.ref.key }) === day.dayKey),
        tail: day.dayKey === oldest.dayKey ? tail : undefined,
        ticks: day.ticks,
        turns: turns.kept.filter((placed) => dayOfKey({ key: placed.ref.key }) === day.dayKey),
        turnsOmittedHere: turns.omitted.filter((omission) => dayOfKey({ key: omission.ref.key }) === day.dayKey).length,
      },
    }),
  );
}

/**
 * The receipt as the operator reads it after a successful render.
 *
 * Emitted rather than kept, because a projection that silently succeeded is indistinguishable from one that
 * quietly dropped half a day — the same reasoning `../cli/commands/briefing/renderDiagnostics.ts`'s
 * `renderSummaryLines` carries.
 *
 * @param receipt what the projection accounted for
 * @returns the lines to print as diagnostics
 */
export function narrativeReceiptLines({ receipt }: { receipt: SupervisorNarrativeReceipt }): readonly string[] {
  return [
    `briefing render --ticks: projected ${count({ value: receipt.ticksProjected })} of ` +
      `${count({ value: receipt.ticksInLedger })} recorded pass(es); ` +
      `${count({ value: receipt.ticksOmitted })} older row(s) and ` +
      `${count({ value: receipt.olderDaysOmitted })} older day(s) are outside the window`,
    `${count({ value: receipt.expected.length })} recorded thing(s) accounted for: ` +
      `${count({ value: receipt.rendered.length })} on the page, ` +
      `${count({ value: receipt.omitted.length })} repeat observation(s) pointing at one that is`,
  ];
}
