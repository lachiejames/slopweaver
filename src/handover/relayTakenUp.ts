/**
 * What the register already says became of a voice relay row — the settlement nobody wrote.
 *
 * `talk relay` registers one ready `--dispatch` ask per relayed turn (`talk-<12 hex>`, anchored `talk:<turnId>`),
 * and until this module no act of the chair's ever ended one. MEASURED over the live board: 870 of
 * 1112 relay rows open, ranked READY p1 beside real work, with `handover prune` keeping every one. Of those 870,
 * 36 had a row cut from them (the same anchor on another row), 216 carried an intake mark on their
 * `talk:<turnId>` pointer, and 618 carried nothing at all. The chair HAD acted on the first two groups; it had
 * recorded the act somewhere other than the row.
 *
 * So this is a READER of two registers the chair already writes, never a judgement: a cut row is lineage (the
 * relay is `filed` into it, which is also the one settlement that lets the cut row settle later — settle refuses
 * a cut row whose relay was answered instead, `../cli/commands/handover/settleCardRun.ts`), and an intake mark
 * is the chair's own recorded disposition of that turn. A relay with neither is left alone: closing the owner's words on
 * no evidence is not a reader's call.
 *
 * ## A mark is not proof the owner's words over a card reached anything
 *
 * MEASURED: the owner rejected an `ask:` card by voice. The relay named no card, so no ruling reached the card's
 * row; the chair marked the turn `card` with the free text "the owning seat reworks the pull request
 * on that relay", this module answered the relay row on that mark, and no seat was ever dispatched. The rejection
 * reached nothing and the card stayed first on the owner's Queue. So a relay whose turn names a register card (its
 * card of record) is ANSWERED only when the owner's words are on that card's own journal — a `ruling` anchored at the relay, which
 * `talk relay` writes on an ask — or a seat was dispatched on the relay row (`dispatched` or `started` on its
 * journal). Otherwise a mark decides nothing and the relay stays open for `handover prune` to report. Both `filed`
 * paths are untouched: they name the row that carries the work. A relay naming no card answers on a mark as before.
 *
 * ## An answer relay is filed into the ask its words landed on
 *
 * MEASURED: of 58 relay rows in RUN NOW, seven were the owner's words over an `ask:` card. Each had landed on
 * that card (`../talk/cardLanding.ts`, `workSlug` the ask's slug), the ask's own run had taken the work up, and the
 * relay row stayed ready because neither register above names it. So between the cut row and the mark sits a third
 * source: the relay's ACTIVE landing on its `ask:` card names that ask as its work, and the ask's row shows action
 * since the relay registered. The relay is `filed` into the ask, which is the lineage it already has.
 *
 * Pure: rows, marks and readers of the relay's landing and work evidence in, a settlement out.
 */
import type { IntakeMark } from "../supervisor/intake.js";
import { preferredMark, witnessShares } from "../supervisor/intakeWitness.js";
import { parseRelayAnchor, relaySlug } from "../talk/relayDraft.js";
import type { RelayRowAction } from "../talk/relayIntake.js";
import type { AskSettlement } from "./rowKind.js";

/** The part of a board row this read needs. */
export interface RelayBoardRow {
  readonly slug: string;
  readonly anchor: string | undefined;
  /** Whether the row already carries a settlement. */
  readonly settled: boolean;
}

/**
 * What became of the words a relay carried, read off its turn and two journals (`./relayTakenUpRead.ts`).
 * `unreadable` is its own arm: a register that would not read never stands in for a relay over no card.
 */
export type RelayWorkEvidence =
  | {
      readonly kind: "read";
      /** The register card the relay's turn names, or `undefined` when it names none. */
      readonly cardKey: string | undefined;
      /** The card is an ask whose journal carries a `ruling` anchored at this relay. */
      readonly rulingOnCard: boolean;
      /** The relay row's own journal carries `dispatched` or `started`. */
      readonly seatDispatched: boolean;
    }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * Where the relay's own landing on its `ask:` card stands, read by `./relayTakenUpRead.ts`. `inactive` covers a
 * relay over no ask, a landing never written, and one a restore lifted. `unreadable` is its own arm: a landing that
 * would not read may be the one naming the ask, so it never lets a lower source answer the relay instead.
 */
export type RelayLandingEvidence =
  | { readonly kind: "inactive" }
  | {
      readonly kind: "active";
      /** The row the landing names as carrying the work. */
      readonly workSlug: string;
      /** What that row shows was done since the relay registered, or `undefined` when nothing yet. */
      readonly action: RelayRowAction | undefined;
    }
  | { readonly kind: "unreadable"; readonly why: string };

/** The settlement the register already decided for one relay row, and the evidence it came from. */
export interface RelayTakenUp {
  readonly settlement: Extract<AskSettlement, "answered" | "filed">;
  /** The `--witness` a settle carries: the cut row's slug when filed, the mark's own words when answered. */
  readonly witness: string;
  /** One line saying which register decided it, for a reader who has not opened either. */
  readonly because: string;
}

/**
 * The relay anchor a row carries when the row IS that relay's own row, or undefined.
 *
 * Both halves are required: the anchor alone also sits on every row cut FROM a relay, and the slug alone could be
 * a row that merely took the name. `relaySlug` derives the slug from the turn id, so the pair is the proof.
 *
 * @param row a board row
 * @returns the normalised `talk:<turnId>` anchor, or undefined when the row is not a relay's own
 */
export function relayAnchorOfRow({ row }: { row: RelayBoardRow }): string | undefined {
  if (row.anchor === undefined) {
    return undefined;
  }
  const anchor = parseRelayAnchor({ text: row.anchor });
  if (anchor === undefined) {
    return undefined;
  }
  const turnId = anchor.slice(anchor.indexOf(":") + 1);
  if (relaySlug({ turnId }) !== row.slug) {
    return undefined;
  }
  return anchor;
}

/**
 * The first OTHER live row carrying the relay's anchor, by slug — the row a session cut from the relay.
 *
 * @param anchor the relay's normalised anchor
 * @param relay the relay row's slug, never its own lineage
 * @param rows every row on the live board
 * @returns the cut row's slug, or undefined
 */
function cutRowOf({
  anchor,
  relay,
  rows,
}: {
  anchor: string;
  relay: string;
  rows: readonly RelayBoardRow[];
}): string | undefined {
  const cut = rows
    .filter(
      (row) => row.slug !== relay && row.anchor !== undefined && parseRelayAnchor({ text: row.anchor }) === anchor,
    )
    .map((row) => row.slug)
    .toSorted();
  return cut[0];
}

/**
 * The intake mark that stands on the relay's pointer, or undefined.
 *
 * @param anchor the relay's normalised anchor
 * @param marks the intake ledger, in file order
 * @param rows every row on the live board, whose slugs make a witness checkable
 * @returns the latest mark by `markedAtIso` (file order breaking a tie) that no earlier, higher-ranked mark
 *   outranks — `../supervisor/intakeWitness.ts`'s `preferredMark`
 */
function standingMarkOf({
  anchor,
  marks,
  rows,
}: {
  anchor: string;
  marks: readonly IntakeMark[];
  rows: readonly RelayBoardRow[];
}): IntakeMark | undefined {
  const candidates = marks
    .filter((mark) => parseRelayAnchor({ text: mark.pointer }) === anchor)
    .toSorted((a, b) => a.markedAtIso.localeCompare(b.markedAtIso));
  if (candidates.length <= 1) {
    return candidates[0];
  }
  return preferredMark({
    candidates,
    shares: witnessShares({ marks }),
    slugs: new Set(rows.map((row) => row.slug)),
  });
}

/**
 * What the register already decided about one relay row, or undefined when it decided nothing.
 *
 * A cut row outranks everything: it is the lineage another settle depends on. Then the relay's active landing on
 * its `ask:` card, when the ask it names shows action since the relay registered: filed into that ask. A landing
 * that would not read decides nothing and lets no mark answer either. Then the standing mark: a `card` whose
 * witness is exactly a live row's slug (other than the relay) is filed into that row, and every other mark —
 * `answered`, `no-ask`, or a card named by its question — answers the relay, witnessed by the mark itself, unless
 * {@link wordsReachedWork} says the relay was spoken over a card the owner's words never reached.
 *
 * @param relay the row being judged
 * @param rows every row on the live board, the relay included
 * @param marks the intake ledger
 * @param landing reads the relay's landing on its ask — called only past the cut-row check, so a caller judging the
 *   whole board reads a turn file for an uncut relay alone
 * @param work reads what became of the relay's words — called only on the answering path
 * @returns the settlement and its witness, or undefined for a row that is not an open relay or has no evidence
 */
export function relayTakenUpOf({
  relay,
  rows,
  marks,
  landing,
  work,
}: {
  relay: RelayBoardRow;
  rows: readonly RelayBoardRow[];
  marks: readonly IntakeMark[];
  landing: () => RelayLandingEvidence;
  work: () => RelayWorkEvidence;
}): RelayTakenUp | undefined {
  if (relay.settled) {
    return undefined;
  }
  const anchor = relayAnchorOfRow({ row: relay });
  if (anchor === undefined) {
    return undefined;
  }
  const cut = cutRowOf({ anchor, relay: relay.slug, rows });
  if (cut !== undefined) {
    return { because: `row ${cut} was cut from this relay (same ${anchor})`, settlement: "filed", witness: cut };
  }
  const landed = landing();
  if (landed.kind === "unreadable") {
    return undefined;
  }
  if (landed.kind === "active" && landed.workSlug !== relay.slug && landed.action !== undefined) {
    const because = `the owner's words landed on ask:${landed.workSlug}, whose row ${actionPhrase({ action: landed.action })}`;
    return { because, settlement: "filed", witness: landed.workSlug };
  }
  const mark = standingMarkOf({ anchor, marks, rows });
  if (mark === undefined) {
    return undefined;
  }
  const because = `the chair marked ${anchor} ${mark.kind} at ${mark.markedAtIso}`;
  const into = mark.witness.trim();
  if (mark.kind === "card" && into !== relay.slug && rows.some((row) => row.slug === into)) {
    return { because, settlement: "filed", witness: into };
  }
  if (!wordsReachedWork({ work: work() })) {
    return undefined;
  }
  // One line: a settle refuses a witness holding a line break, and a mark's witness is free text.
  const words = mark.witness.replace(/\s+/gu, " ").trim();
  return { because, settlement: "answered", witness: `intake-mark ${mark.kind} ${mark.markedAtIso}: ${words}` };
}

/** What a row's action reads as in one `because` line: its settlement, or the run event and when. */
function actionPhrase({ action }: { action: RelayRowAction }): string {
  if (action.kind === "settlement") {
    return "was settled since the relay registered";
  }
  return `journalled ${action.eventKind} at ${action.atIso}`;
}

/**
 * Whether a mark may answer the relay: it names no card, or the owner's words over the card it names reached work — a
 * ruling on that card's own journal, or a seat dispatched on the relay row. An unreadable register answers nothing.
 *
 * @param work what became of the relay's words
 * @returns whether answering the relay leaves the owner's words somewhere a session acts on them
 */
export function wordsReachedWork({ work }: { work: RelayWorkEvidence }): boolean {
  if (work.kind === "unreadable") {
    return false;
  }
  if (work.cardKey === undefined) {
    return true;
  }
  return work.rulingOnCard || work.seatDispatched;
}
