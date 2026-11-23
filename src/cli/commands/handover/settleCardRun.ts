/**
 * The effectful half of `../../../handover/settleCard.ts`: find the relay behind a row, read its hand card's fate,
 * and — once every gate has passed — perform the disposition under the hand register's own lock.
 *
 * ## Finding the relay
 *
 * Only by the row's exact `talk:<turnId>` anchor, read straight off that turn's file. A relay's slug can collide,
 * so no scan by slug, and a `talk:` anchor whose turn is unreadable or contradicts the row FAILS: treating damaged
 * provenance as "no card" would be the bypass. A `talk:` anchor over a CALL id is not one — it names no relay, and
 * settles as the call anchor it is (`./settleCallAnchor.ts`). A turn file that was never written, and a turn whose
 * `about` is empty (one from before `about` existed decodes so), name no card, so the hand register is asked by the
 * row itself and refuses only while an open card names it (`./settleRowCard.ts`). A row of any other anchor settles
 * as it always did. A doc filed FROM the relay carries its anchor too, and
 * the turn names the relay row rather than it, so the relay row settled `filed` into the doc is what vouches for it,
 * and the card's fate still decides what the doc owes.
 *
 * ## Order, and why a retry converges
 *
 * The card effect lands BEFORE the row settlement (`./settleRowRun.ts`): written the other way round, a failed
 * card write would leave a settled row whose retry is refused as already settled, and the open card stranded.
 * The effect re-reads the register under its lock, so a card closed by anything else since the plan is refused
 * rather than relabelled, and a `done` this same settle already wrote is recognised by its exact account.
 */
import { type HandCardFate, handCardFate } from "../../../hand/cardFate.js";
import { dismissHandNote } from "../../../hand/note/markers.js";
import { buildSettledRow } from "../../../hand/row.js";
import { appendText, readBackOf, serialised, underLock } from "../../../hand/store.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import {
  type CardDisposition,
  type CardPlan,
  cardPlanOf,
  handCardIdOf,
  lockedCardVerdict,
  settleCardDid,
} from "../../../handover/settleCard.js";
import { type SettleCardError, SettleCardErrors } from "../../../handover/settleCardErrors.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { fsyncFile } from "../../../lib/writeAtomic.js";
import { keepCardForRelay } from "../../../talk/cardKeep.js";
import { parseRelayAnchor } from "../../../talk/relayDraft.js";
import { readTurn, type TurnRecord } from "../../../talk/relayStore.js";
import { unreadTurnReceipt } from "./settleCallAnchor.js";
import { lockedWholeHandRows, rowCardReceiptOrRefusal, wholeHandRows } from "./settleRowCard.js";

/** An ask row settled `filed` into the row being settled: the relay a doc was cut from, by slug AND anchor. */
export interface FiledRow {
  readonly slug: string;
  readonly anchor: string | undefined;
}

/**
 * The ask rows settled `filed` into this one: a relay its doc was cut from. Each carries its own anchor, because a
 * slug alone can collide and the relay must be the row the turn's anchor names.
 *
 * @param docs the whole board
 * @param slug the row being settled, which a filed row names as its witness
 * @returns their slugs and anchors
 */
export function filedInto({ docs, slug }: { docs: readonly HandoverDoc[]; slug: string }): readonly FiledRow[] {
  return docs
    .filter((doc) => doc.kind === "ask" && doc.settlement === "filed" && doc.settlementWitness === slug)
    .map((doc) => ({ anchor: doc.anchor, slug: doc.slug }));
}

/** What the effect came to: written now, found already written by a retry, or verified with nothing to write. */
export type CardEffect = "none" | "applied" | "already-applied" | "verified";

/** What the relay behind a row comes to: the card it was spoken over, and how the row's anchor was read. */
interface RelayAbout {
  readonly about: string;
  readonly fate: HandCardFate | undefined;
  readonly relayAnchor: string;
  /** Lines saying the anchor was read as a call, or by the row with no turn naming a card; empty otherwise. */
  readonly receiptLines: readonly string[];
}

/** A relay that names no card: nothing to answer for, with the lines saying how the anchor was read. */
const noRelayCard = ({ receiptLines }: { receiptLines: readonly string[] }): RelayAbout => ({
  about: "",
  fate: undefined,
  receiptLines,
  relayAnchor: "",
});

/** A settle's card plan, and the receipt lines that say how the row's anchor was read — never part of the plan. */
export interface PlannedSettleCard {
  readonly card: CardPlan;
  readonly receiptLines: readonly string[];
}

/**
 * The card a row's relay was spoken over: its `about`, or empty when the row is no relay's.
 *
 * A doc cut FROM a relay carries the relay's anchor while the turn names the relay row, so a turn naming a row
 * settled `filed` into this one — that slug AND this anchor, since a slug alone can collide — is this row's
 * lineage. The card's fate NOW decides what it owes, exactly as for the relay row: a card the relay settled `done`
 * owes nothing, while one it `kept` is still open and this row must say what becomes of it.
 *
 * @param anchor the row's `anchor:`
 * @param slug the row's slug, which the turn must name
 * @param filedFrom ask rows settled `filed` with this slug as their witness, whose turns this row may carry
 * @param nowIso the instant the hand register's lock is taken at, for every read of it
 * @returns `about` and the relay anchor (both empty for no relay), or why the relay cannot be trusted
 */
function relayAboutOf({
  home,
  anchor,
  slug,
  filedFrom,
  nowIso,
}: {
  home: string;
  anchor: string | undefined;
  slug: string;
  filedFrom: readonly FiledRow[];
  nowIso: string;
}): Result<RelayAbout, SettleCardError> {
  const parsed = anchor === undefined ? undefined : parseRelayAnchor({ text: anchor });
  if (anchor === undefined || parsed === undefined) {
    return ok(noRelayCard({ receiptLines: [] }));
  }
  const turn = readTurn({ home, turnId: parsed.slice("talk:".length) });
  if (turn.isErr()) {
    return unreadTurnReceipt({ anchor, home, nowIso, slug, turnError: turn.error }).map((receiptLines) =>
      noRelayCard({ receiptLines }),
    );
  }
  // A turn's `about` is fixed when it is claimed, so an empty one names no card in any state: the row checks below
  // tie a CARD to this row, and with none named only an open card naming the row itself can refuse.
  if (turn.value.about === "") {
    return rowCardReceiptOrRefusal({ anchor, home, nowIso, reason: "about-empty", slug }).map((receiptLines) =>
      noRelayCard({ receiptLines }),
    );
  }
  const fate = handCardFateOf({ about: turn.value.about, home, nowIso });
  if (fate.isErr()) {
    return err(fate.error);
  }
  // A turn naming a card that is not a hand card names no HAND card either, so it is decided by the row alone exactly
  // as an empty `about` is, whatever the turn's state: the checks below tie a hand card to this row, and there is
  // none to tie.
  if (fate.value === undefined) {
    const about = turn.value.about;
    return rowCardReceiptOrRefusal({ anchor, home, nowIso, reason: "about-not-hand", slug }).map((receiptLines) => ({
      about,
      fate: undefined,
      receiptLines,
      relayAnchor: anchor,
    }));
  }
  // The parsed anchor, not the row's raw text: register files a relay into a row by the normalised anchor, so a
  // row written `TALK:<UUID>` must not then be refused on a spelling the cut detection already ignored (r2 review).
  const field = relayRowMismatchOf({
    anchor: parsed,
    cardOwed: cardOwedOf({ fate: fate.value }),
    filedFrom,
    slug,
    turn: turn.value,
  });
  if (field !== undefined) {
    return err(SettleCardErrors.relayRowMismatch({ anchor, field }));
  }
  return ok({ about: turn.value.about, fate: fate.value, receiptLines: [], relayAnchor: anchor });
}

/**
 * The fate of the hand card a relay's `about` names, read whole off the hand register, or undefined for no hand card.
 *
 * @param about the relay turn's `about`
 * @param nowIso the instant the register's lock is taken at
 * @returns the card's fate, or why the register cannot be trusted
 */
function handCardFateOf({
  home,
  about,
  nowIso,
}: {
  home: string;
  about: string;
  nowIso: string;
}): Result<HandCardFate | undefined, SettleCardError> {
  const id = handCardIdOf({ about });
  if (id === undefined) {
    return ok(undefined);
  }
  const rows = lockedWholeHandRows({ home, nowIso });
  if (rows.isErr()) {
    return err(rows.error);
  }
  return ok(handCardFate({ id, rows: rows.value }));
}

/**
 * Whether the relay's card is still on the owner's queue, so only the row that owes it may say what becomes of it.
 *
 * A re-cut card is NOT owed here: the hand register is append-only, so it stays superseded after a row named the
 * re-cut, and a `recut` disposition only verifies the re-cut's own edge and writes nothing — counting it owed
 * stranded a row cut after its relay was settled `--card recut` (r2 review).
 *
 * @param fate the card's fate, undefined when the relay named no hand card
 * @returns true while the card is open
 */
export function cardOwedOf({ fate }: { fate: HandCardFate | undefined }): boolean {
  return fate?.kind === "open";
}

/**
 * Which field of a relay turn disagrees with the row being settled, or undefined when the turn is this row's.
 *
 * The slug check exists to tie a card to the row that owes it, so it is waived while NO card is owed — the relay
 * named no hand card, or its card is already settled, re-cut or was never posted: a row cut from such a relay owes no card
 * whatever became of the relay's own row. Without the waiver a cut row was stranded for good whenever its relay was
 * settled `answered` rather than `filed` — settlement is write-once and the refusal has no hatch (finding
 * `a-row-anchored-to-a-cardless-voice-relay-settled-answered-cannot-be-settled`), and an intake mark answers a relay
 * before any row is cut from it. The anchor and the state are still checked.
 *
 * @param turn the relay turn the row's anchor names
 * @param anchor the row's own anchor
 * @param slug the row being settled
 * @param filedFrom ask rows settled `filed` with this slug as their witness
 * @param cardOwed whether the relay's card still needs a row's disposition ({@link cardOwedOf})
 * @returns the disagreeing field, or undefined
 */
export function relayRowMismatchOf({
  turn,
  anchor,
  slug,
  filedFrom,
  cardOwed,
}: {
  turn: Pick<TurnRecord, "anchor" | "slug" | "state">;
  anchor: string;
  slug: string;
  filedFrom: readonly FiledRow[];
  cardOwed: boolean;
}): "anchor" | "slug" | "state" | undefined {
  const lineage = turn.slug !== slug && filedFrom.some((row) => row.slug === turn.slug && row.anchor === anchor);
  const mismatch = [
    { field: "anchor" as const, same: turn.anchor === anchor },
    { field: "slug" as const, same: turn.slug === slug || lineage || !cardOwed },
    { field: "state" as const, same: turn.state === "registered" },
  ].find((check) => !check.same);
  return mismatch?.field;
}

/**
 * Plan what the settle does about the row's card, reading only: the relay, then the hand register.
 *
 * @param anchor the row's `anchor:`
 * @param slug the row being settled
 * @param settlement how the row ends
 * @param witness what `--witness` carried
 * @param disposition what `--card` said
 * @param bySession who the card's settling names
 * @param nowIso the clock a `done` would be written at, checked now so it cannot fail later
 * @param filedFrom ask rows settled `filed` with this slug as their witness, whose relay turns this row may carry
 * @returns the plan with the receipt lines saying how the anchor was read, or the first reason the settle cannot go
 *   ahead
 */
export function planSettleCard({
  home,
  anchor,
  slug,
  filedFrom,
  settlement,
  witness,
  disposition,
  bySession,
  nowIso,
}: {
  home: string;
  anchor: string | undefined;
  slug: string;
  filedFrom: readonly FiledRow[];
  settlement: string;
  witness: string;
  disposition: CardDisposition | undefined;
  bySession: string;
  nowIso: string;
}): Result<PlannedSettleCard, SettleCardError> {
  const relay = relayAboutOf({ anchor, filedFrom, home, nowIso, slug });
  if (relay.isErr()) {
    return err(relay.error);
  }
  const { fate } = relay.value;
  const did = settleCardDid({ settlement, slug, witness });
  const plan = cardPlanOf({ about: relay.value.about, did, disposition, fate, relayAnchor: relay.value.relayAnchor });
  // Only a done that still owes its did is checked against one: a retry over this row's own settling writes none.
  if (plan.isOk() && plan.value.kind === "done" && fate?.kind === "open") {
    const built = buildSettledRow({ draft: { bySession, did, id: plan.value.id, settledIso: nowIso } });
    if (built.isErr()) {
      return err(
        SettleCardErrors.registerFailed({ why: `the card's account cannot be written: ${built.error.message}` }),
      );
    }
  }
  return plan.map((card) => ({ card, receiptLines: relay.value.receiptLines }));
}

/**
 * Perform the plan under the hand register's lock, re-reading the card's fate there first.
 *
 * @param plan what {@link planSettleCard} decided
 * @param slug the row being settled, which a kept card's landing is scoped to
 * @param bySession who the card's settling names
 * @param nowIso the write clock
 * @returns what the effect came to, or why it did not land
 */
export function performSettleCard({
  home,
  plan,
  slug,
  bySession,
  nowIso,
}: {
  home: string;
  plan: CardPlan;
  slug: string;
  bySession: string;
  nowIso: string;
}): Result<CardEffect, SettleCardError> {
  if (plan.kind === "none") {
    return ok("none");
  }
  const locked = underLock({
    home,
    nowIso,
    section: (path) => ok(effectUnderLock({ bySession, home, nowIso, path, plan, slug })),
  });
  if (locked.isErr()) {
    return err(SettleCardErrors.registerFailed({ why: locked.error.message }));
  }
  if (locked.value.isOk() && locked.value.value === "applied" && plan.kind === "done") {
    // Best effort and unreported, as `hand done` does: the register is already right.
    dismissHandNote({ home, id: plan.id, nowIso });
  }
  return locked.value;
}

/** {@link performSettleCard}'s critical section: the fate re-read, then the one write the plan allows. */
function effectUnderLock({
  home,
  path,
  plan,
  slug,
  bySession,
  nowIso,
}: {
  home: string;
  path: string;
  plan: Exclude<CardPlan, { kind: "none" }>;
  slug: string;
  bySession: string;
  nowIso: string;
}): Result<CardEffect, SettleCardError> {
  const rows = wholeHandRows({ path });
  if (rows.isErr()) {
    return err(rows.error);
  }
  const verdict = lockedCardVerdict({ fate: handCardFate({ id: plan.id, rows: rows.value }), plan });
  if (verdict.isErr()) {
    return err(verdict.error);
  }
  // A re-cut never owes a write, so `write` does not arise for one: the second test only narrows `plan`.
  if (verdict.value === "already-applied") {
    return flushedRegister({ path });
  }
  if (verdict.value !== "write" || plan.kind === "recut") {
    return ok("verified");
  }
  if (plan.kind === "kept") {
    const kept = keepCardForRelay({
      cardKey: plan.cardKey,
      home,
      nowIso,
      relayAnchor: plan.relayAnchor,
      why: plan.why,
      workSlug: slug,
    });
    if (kept.isErr()) {
      return err(SettleCardErrors.registerFailed({ why: kept.error.message }));
    }
    return ok(kept.value === "kept" ? "applied" : "already-applied");
  }
  return appendDone({ bySession, did: plan.did, id: plan.id, nowIso, path });
}

/** A `done` a retry found already written, flushed before the row is built on it: visible is not durable. */
function flushedRegister({ path }: { path: string }): Result<CardEffect, SettleCardError> {
  try {
    fsyncFile({ path });
  } catch (cause: unknown) {
    return err(SettleCardErrors.registerFailed({ why: `could not flush ${path}: ${String(cause)}` }));
  }
  return ok("already-applied");
}

/** Append the `done` settling, read back exactly as the register will read it. */
function appendDone({
  path,
  id,
  did,
  bySession,
  nowIso,
}: {
  path: string;
  id: string;
  did: string;
  bySession: string;
  nowIso: string;
}): Result<CardEffect, SettleCardError> {
  const built = buildSettledRow({ draft: { bySession, did, id, settledIso: nowIso } });
  if (built.isErr()) {
    return err(SettleCardErrors.registerFailed({ why: built.error.message }));
  }
  const line = serialised({ row: built.value });
  const readBack = readBackOf({ line });
  if (readBack.isErr()) {
    return err(SettleCardErrors.registerFailed({ why: readBack.error.message }));
  }
  const appended = appendText({ path, text: `${line}\n` });
  if (appended.isErr()) {
    return err(SettleCardErrors.registerFailed({ why: appended.error.message }));
  }
  return ok("applied");
}
