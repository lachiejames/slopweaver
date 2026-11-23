/**
 * The evidence half of `./steeredCardsRead.ts`: for one relay's receipt, where its own landing on its card stands
 * and the first action anyone took on it — an intake mark, a check-in ruling, its row, or the row its landing names.
 *
 * Split out of that module (the file-size ratchet) along the seam between joining sources and reading them: the
 * reading decides WHICH ledgers to open and in what order, and this decides what one receipt's rows witness. Every
 * join is exact — a receipt's `talk:<turnId>` anchor on the card it named, never a transcript landing of the same
 * words on another card.
 */
import type { AutonomyRecord } from "../autonomy/types.js";
import { readRunJournal } from "../handover/runStore.js";
import { readExactDoc } from "../handover/store.js";
import type { IntakeMark } from "../supervisor/intake.js";
import { standingMarkFor } from "../supervisor/intakeStore.js";
import type { CardLandingRow, CardRestoredRow } from "./cardLanding.js";
import { type RelayRowAction, relayRowAction } from "./relayIntake.js";
import type { TurnRecord } from "./relayStore.js";
import type { SteerEvidence, SteerLanding } from "./steeredCards.js";

/**
 * The check-in ruling a relay wrote on THE act card it named: a steer row recorded under its `talk:<turnId>` anchor
 * for that card's act — never one the same turn wrote on another act.
 *
 * @param checkIns the autonomy register's rows
 * @param receipt the relay's receipt
 * @returns the ruling as action, or `undefined` when it wrote none on that card
 */
export function checkInRuling({
  checkIns,
  receipt,
}: {
  checkIns: readonly AutonomyRecord[];
  receipt: Pick<TurnRecord, "about" | "anchor">;
}): { readonly atIso: string; readonly kind: "check-in-ruling" } | undefined {
  for (const record of checkIns) {
    if ("steeredIso" in record && record.bySession === receipt.anchor && `act:${record.actionId}` === receipt.about) {
      return { atIso: record.steeredIso, kind: "check-in-ruling" };
    }
  }
  return undefined;
}

/**
 * Where one relay's own landing on its card stands: active, lifted by a restore (with the latest restore's reason
 * on that card), or never written.
 *
 * @param rows the card-landing ledger, in file order
 * @param active the landings still holding a card off the Queue
 * @param anchor the relay's `talk:<turnId>`
 * @param cardKey the card the relay named
 * @returns the landing's standing
 */
export function relayLanding({
  rows,
  active,
  anchor,
  cardKey,
}: {
  rows: readonly CardLandingRow[];
  active: readonly CardLandingRow[];
  anchor: string;
  cardKey: string;
}): SteerLanding {
  const isOwn = (row: CardLandingRow): boolean =>
    row.kind === "landed" &&
    row.cardKey === cardKey &&
    (row.anchor === anchor || row.laterAnchors?.includes(anchor) === true);
  const standing = active.find(isOwn);
  if (standing?.kind === "landed") {
    return { kind: "active", workSlug: standing.workSlug };
  }
  if (!rows.some(isOwn)) {
    return { kind: "never" };
  }
  // The restore that lifted THIS relay's landing: a kept one scoped to it, wherever it sits (`./cardLanding.ts`), else
  // the first card-wide one after its own FIRST landing — never a later one that lifted another relay's, and never
  // skipped past by a late repeat of its own landing, which a restore keeps lifted (`./cardLanding.ts`).
  const kept = rows.findLast(
    (row): row is CardRestoredRow =>
      row.kind === "restored" && row.cardKey === cardKey && row.disposition === "kept" && row.anchor === anchor,
  );
  if (kept !== undefined) {
    return { kept: true, kind: "lifted", why: kept.why };
  }
  const firstOwn = rows.findIndex(isOwn);
  const cardWide = rows.find(
    (row, index): row is CardRestoredRow =>
      index > firstOwn && row.kind === "restored" && row.cardKey === cardKey && row.disposition !== "kept",
  );
  if (cardWide === undefined) {
    return { kept: false, kind: "lifted", why: "a restore lifted it" };
  }
  return { kept: false, kind: "lifted", why: cardWide.why };
}

/**
 * The first action evidence on one board row since a relay registered, or why the row could not be read. Read by
 * `talk steers` and by the relay settle that files an answer relay into its ask (`../handover/relayLandingRead.ts`),
 * so the two cannot disagree about whether a row was acted on.
 *
 * @param handoverDir the board directory
 * @param runsDir the run journals' directory
 * @param slug the row
 * @param anchor the anchor the row must carry to witness this relay, or `undefined` when a landing named the row
 * @param registeredAtIso when the relay registered
 * @param datedSettlementOnly count another row's settlement only by its own `settledIso`, never by when the row was
 *   asked — the relay settle passes it, because filing a relay writes a terminal state, while `talk steers` only reads
 * @returns the row's action, none, or unread
 */
export function rowActionSince({
  handoverDir,
  runsDir,
  slug,
  anchor,
  registeredAtIso,
  datedSettlementOnly,
}: {
  handoverDir: string;
  runsDir: string;
  slug: string;
  anchor: string | undefined;
  registeredAtIso: string;
  datedSettlementOnly: boolean;
}): RelayRowAction | undefined | { readonly kind: "unread"; readonly why: string } {
  const found = readExactDoc({ handoverDir, slug });
  if (found.isErr()) {
    return { kind: "unread", why: found.error.message };
  }
  if (found.value === undefined) {
    return undefined;
  }
  const { doc, archived } = found.value;
  if (anchor !== undefined && doc.anchor?.toLowerCase() !== anchor) {
    return undefined;
  }
  // A settlement witnesses this relay only when it cannot predate it: on the relay's own row, or one whose `settledIso`
  // is at or after it registered. A row settled before that field existed carries no instant, so `talk steers` reads it
  // by when the row was asked; the relay settle does not, since a rewritten `askedIso` would date it wrongly.
  // A landing on an ask settled before the owner spoke is not action.
  const floor = Date.parse(registeredAtIso);
  const settledAfter = doc.settledIso !== undefined && Date.parse(doc.settledIso) >= floor;
  const undatedAskedAfter =
    !datedSettlementOnly &&
    doc.settledIso === undefined &&
    doc.askedIso !== undefined &&
    Date.parse(doc.askedIso) >= floor;
  const settled = doc.settlement !== undefined && (anchor !== undefined || settledAfter || undatedAskedAfter);
  // An archived doc's journal is not this cycle's; only its settlement witnesses (`./relayIntakeRead.ts`).
  if (archived) {
    return relayRowAction({ registeredAtIso, row: { anchor: doc.anchor, events: [], settled, slug } });
  }
  const journal = readRunJournal({ runsDir, slug });
  if (journal.isErr()) {
    return { kind: "unread", why: journal.error.message };
  }
  const action = relayRowAction({
    registeredAtIso,
    row: { anchor: doc.anchor, events: journal.value.events, settled, slug },
  });
  // A journal with lines it could not read is not one with no action: the action may be on one of them,
  // and an event whose instant does not parse can be dated against nothing, so it did not read either.
  const undated = journal.value.events.filter((one) => Number.isNaN(Date.parse(one.atIso))).length;
  const unread = journal.value.unreadable.length + undated;
  if (action === undefined && unread > 0) {
    return { kind: "unread", why: `${String(unread)} line(s) of the run journal of ${slug} did not read` };
  }
  return action;
}

/**
 * The first action evidence for a relay: its standing intake mark, the check-in word it wrote, its own row, then the
 * row its landing names when that is another.
 *
 * The standing mark is `../supervisor/intakeWitness.ts`'s `preferredMark`, the rule `supervisor intake` reads.
 *
 * @returns the action, none, or why a row could not be read
 */
export function relayAction({
  receipt,
  landing,
  marks,
  checkIns,
  handoverDir,
  runsDir,
}: {
  receipt: TurnRecord;
  landing: SteerLanding;
  marks: readonly IntakeMark[];
  checkIns: readonly AutonomyRecord[];
  handoverDir: string;
  runsDir: string;
}): SteerEvidence["action"] {
  const mark = standingMarkFor({ handoverDir, marks, pointer: receipt.anchor });
  if (mark !== undefined) {
    return { atIso: mark.markedAtIso, kind: "intake-mark", markKind: mark.kind, witness: mark.witness };
  }
  const ruling = checkInRuling({ checkIns, receipt });
  if (ruling !== undefined) {
    return ruling;
  }
  const registeredAtIso = receipt.registeredAtIso!;
  const own = rowActionSince({
    datedSettlementOnly: false,
    anchor: receipt.anchor,
    handoverDir,
    registeredAtIso,
    runsDir,
    slug: receipt.slug,
  });
  const ownActed = own !== undefined && own.kind !== "unread";
  if (ownActed || landing.kind !== "active" || landing.workSlug === receipt.slug) {
    return own;
  }
  // An unreadable own row yields to readable action on the landing's row; only absent both does it stay a hiccup.
  const worked = rowActionSince({
    datedSettlementOnly: false,
    anchor: undefined,
    handoverDir,
    registeredAtIso,
    runsDir,
    slug: landing.workSlug,
  });
  if (worked === undefined) {
    return own;
  }
  if (worked.kind === "unread" && own !== undefined) {
    return own;
  }
  return worked;
}
