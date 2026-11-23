/**
 * Which held Slack drafts the owner's words on a card bind to: the exact `sd-*` ids the card names, each followed through its
 * drop notes to the cut that stands.
 *
 * The owner must never approve a send and then find, the next day, that it was not sent. An approval landed on an
 * ask whose option named one draft; that draft was re-cut twice without the owner's approval and the live cut sat
 * parked waiting on a yes already given. The landing was on the card, the id was on the card, and nothing joined
 * the two.
 *
 * This joins them, and judges nothing. Whether the owner's words MEAN yes is the session's call (`slack draft approve` or
 * `slack draft hold`), never computed here: no keyword, no similarity, no reading of the words. The binding is exact —
 * a `post:<id>` card names its own id, an ask or hand card names the ids its drawn texts carry (`draftIdsNamed`, the
 * reader every card-writing verb is already held to) — and a card whose texts could not be read is reported, never
 * passed as one that named no draft.
 *
 * Pure: the reads are the shell's (`../cli/commands/supervisor/tickRecordApprovedDrafts.ts`).
 */
import { draftIdsNamed } from "../handover/namedDraftGate.js";
import { dropNoteIds, liveCutOf } from "../outbound/slack/draftLiveCut.js";
import type { SlackDraftItem } from "../outbound/slack/draftRegister.js";
import { noteRecordsSend } from "../outbound/slack/draftSentNote.js";
import { activeCardLandings, type CardLandedRow, type CardLandingRow, keptDraftIds } from "../talk/cardLanding.js";

/**
 * What the shell read of one landed ask or hand card: the texts the card draws, or why they could not be read. A card
 * whose record is gone — a swept row, a hand step no register line holds — reads as no texts: there is no card left
 * for a draft id to sit on.
 */
export type DraftLandingCardRead =
  | { readonly kind: "read"; readonly cardKey: string; readonly texts: readonly (string | undefined)[] }
  | { readonly kind: "unreadable"; readonly cardKey: string; readonly why: string };

/** One landing bound to one draft: the cut that stands, and the id the card named on the way to it. */
export interface BoundDraftLanding {
  /** Held — or DROPPED, when the landing was written after the drop that ended its chain and so outran it. */
  readonly item: SlackDraftItem;
  readonly landing: CardLandedRow;
  /** The id the card names — the live cut's own id when the card named the cut that stands. */
  readonly namedId: string;
  /**
   * The landing ledger row its words were written at, which a counted judgement is ordered against. Every binding read off the ledger carries it.
   */
  readonly ledgerRow?: number | undefined;
}

/** A landing on a card whose texts could not be read, so which drafts it names is unknown. */
export interface UnreadableDraftLanding {
  readonly landing: CardLandedRow;
  readonly why: string;
  /** The landing ledger row its words were written at, which only a judgement that counted past it has weighed. */
  readonly ledgerRow: number;
}

/** A landing on a card whose record is gone, at the ledger row its words were written at. */
export interface VanishedDraftLanding {
  readonly landing: CardLandedRow;
  readonly ledgerRow: number;
}

/** Every binding the active landings make, and every landing that could not be bound. */
export interface DraftLandingBindings {
  readonly bound: readonly BoundDraftLanding[];
  readonly unreadable: readonly UnreadableDraftLanding[];
}

/** The card kinds whose drawn texts can name a draft by id. */
const TEXT_CARD_KINDS = ["ask:", "hand:"] as const;

/**
 * Whether a card key names a card whose drawn texts the shell must read for draft ids.
 *
 * @returns true for an `ask:` or `hand:` card
 */
export function namesDraftsInTexts({ cardKey }: { cardKey: string }): boolean {
  return TEXT_CARD_KINDS.some((kind) => cardKey.startsWith(kind));
}

/**
 * Bind every active landing to the held drafts its card names.
 *
 * A restored landing binds nothing: the card is back on the owner's queue and their words no longer stand on it. A named id the
 * register does not hold, or whose chain ends released or dropped, binds nothing either — a draft already sent or
 * spent owes no judgement — save a `post:` landing written after the drop ending its chain, which binds that dropped
 * cut, because the drop never weighed it. Two named ids converging on one live cut bind it once. But a register line this build passed
 * over may be the very row such an id names — its park, or the event that would show it held — so a named id that does
 * not read held while a skipped line names it, or names no row at all, makes the landing unreadable rather than
 * binding nothing.
 *
 * @param cards what the shell read of each landed ask and hand card
 * @param items every folded register row
 * @param landingRows the card-landing ledger, in file order
 * @param skipped the draft-register lines the parse passed over, by the row each names
 * @returns the bindings and the landings whose card could not be read
 */
export function draftLandingBindings({
  cards,
  items,
  landingRows,
  skipped,
}: {
  cards: readonly DraftLandingCardRead[];
  items: readonly SlackDraftItem[];
  landingRows: readonly CardLandingRow[];
  skipped: readonly { readonly id: string | undefined }[];
}): DraftLandingBindings {
  const bound: BoundDraftLanding[] = [];
  const unreadable: UnreadableDraftLanding[] = [];
  for (const landing of activeCardLandings({ rows: landingRows })) {
    const row = landingLedgerRow({ landing, landingRows });
    const named = namedIds({ cards, landing });
    if (named.kind === "unreadable") {
      unreadable.push({ landing, ledgerRow: row, why: named.why });
      continue;
    }
    const why = bindNamed({ bound, ids: named.ids, items, landing: { at: landing, row }, skipped });
    if (why !== undefined) {
      unreadable.push({ landing, ledgerRow: row, why });
    }
  }
  return { bound, unreadable };
}

/**
 * The ledger row an active landing's words were written at: an utterance that grew is a later row than the one it
 * first took.
 *
 * @param landing an active landing read off these rows
 * @param landingRows the card-landing ledger, in file order
 * @returns the row's index in the ledger
 */
export function landingLedgerRow({
  landing,
  landingRows,
}: {
  landing: CardLandedRow;
  landingRows: readonly CardLandingRow[];
}): number {
  return landingRows.findLastIndex(
    (one) =>
      one.kind === "landed" &&
      one.anchor === landing.anchor &&
      one.cardKey === landing.cardKey &&
      one.words === landing.words,
  );
}

/**
 * Bind one landing's named ids onto `bound`, answering why it cannot be bound when a skipped line may hide one. A held
 * live cut is checked too: a passed-over line under its id may be a fresh, unjudged park the readable one stands in
 * for.
 */
function bindNamed({
  bound,
  ids,
  items,
  landing,
  skipped,
}: {
  bound: BoundDraftLanding[];
  ids: readonly string[];
  items: readonly SlackDraftItem[];
  /** The landing, and the ledger row its words were written at — the latest, for an utterance that grew. */
  landing: { readonly at: CardLandedRow; readonly row: number };
  skipped: readonly { readonly id: string | undefined }[];
}): string | undefined {
  let why: string | undefined;
  const { at } = landing;
  for (const namedId of ids) {
    const { chain, live } = chainOf({ items, namedId });
    if (skipped.some((line) => mayHide({ chain, line }))) {
      why = `a draft-register line this build passed over may be ${namedId}'s, so whether the owner's yes on it is owed is unknown`;
      continue;
    }
    if (live === undefined || bound.some((one) => one.landing === at && one.item.id === live.id)) {
      continue;
    }
    if (live.state === "held" || outranDrop({ landing, live })) {
      bound.push({ item: live, landing: at, ledgerRow: landing.row, namedId });
    }
  }
  return why;
}

/** The cut a named id's chain ends on, and every id on the way — the end cut's drop-note ids included. */
function chainOf({ items, namedId }: { items: readonly SlackDraftItem[]; namedId: string }): {
  readonly chain: ReadonlySet<string>;
  readonly live: SlackDraftItem | undefined;
} {
  const cut = liveCutOf({ id: namedId, items });
  if (cut === undefined) {
    return { chain: new Set([namedId]), live: undefined };
  }
  const walked = [...cut.superseded, cut.live].map((row) => row.id);
  // A chain ending on a dropped cut may end there only because the successor its note names did not read.
  return { chain: new Set([namedId, ...walked, ...dropNoteIds({ row: cut.live })]), live: cut.live };
}

/**
 * Whether a landing was written after the drop that ended its draft's chain judged the landings, so that drop never
 * weighed the owner's words: `talk land` takes the landings lock, not the register's, and a transcript lands what they said
 * whenever its batch runs. Ordered by the ledger, never the clock, where the drop recorded how
 * many rows it judged: a writer stamps its instant before it appends, so one landing in the gap between the drop's
 * read and its append carries an instant BEFORE the drop. A drop no verb checked falls back on the instants,
 * and one that does not parse is owed. A drop recording the send owes nothing. An ask or hand card naming the draft
 * binds exactly as a `post:` card does, as it already does a held cut: its own work row says nothing of the yes the
 * drop never weighed.
 */
function outranDrop({
  landing,
  live,
}: {
  landing: { readonly at: CardLandedRow; readonly row: number };
  live: SlackDraftItem;
}): boolean {
  if (live.state !== "dropped") {
    return false;
  }
  if (live.outcome !== undefined && noteRecordsSend({ note: live.outcome, row: live })) {
    return false;
  }
  if (live.landingsRead !== undefined) {
    return landing.row >= live.landingsRead;
  }
  const written = Date.parse(landing.at.atIso);
  const dropped = live.resolvedIso === undefined ? Number.NaN : Date.parse(live.resolvedIso);
  return Number.isNaN(written) || Number.isNaN(dropped) || written >= dropped;
}

/**
 * Whether one passed-over line may be the row a named id stands on: it names any cut on the chain from that id to the
 * one it reached — a fresh park under an intermediate cut redirects the chain — or a successor the
 * dropped end cut's note names, or no row at all, which, as the release and the gate's own walk already read it, could
 * be anything.
 */
function mayHide({ chain, line }: { chain: ReadonlySet<string>; line: { readonly id: string | undefined } }): boolean {
  return line.id === undefined || chain.has(line.id);
}

/** The draft ids one landing's card names, or why they cannot be known. */
function namedIds({
  cards,
  landing,
}: {
  cards: readonly DraftLandingCardRead[];
  landing: CardLandedRow;
}): { readonly kind: "ids"; readonly ids: readonly string[] } | { readonly kind: "unreadable"; readonly why: string } {
  if (landing.cardKey.startsWith("post:")) {
    return { ids: [landing.cardKey.slice("post:".length)], kind: "ids" };
  }
  if (!namesDraftsInTexts({ cardKey: landing.cardKey })) {
    return { ids: [], kind: "ids" };
  }
  // A card that would not read as the owner's words landed may have been rewritten since: what reads now cannot say what it
  // named then.
  if (landing.draftIdsUnread !== undefined) {
    return {
      kind: "unreadable",
      why: `${landing.cardKey} did not read as the owner's words landed (${landing.draftIdsUnread}), so which drafts it named then is unknown`,
    };
  }
  const card = cards.find((one) => one.cardKey === landing.cardKey);
  if (card === undefined) {
    return { kind: "unreadable", why: `no read of ${landing.cardKey} reached the gate` };
  }
  if (card.kind === "unreadable") {
    return card;
  }
  // The ids the card named as the owner's words landed stand beside what it names now: settling an ask rewrites its doc, and a
  // rewrite that drops the id must not unbind the owner's yes.
  return {
    ids: [...new Set([...keptDraftIds({ row: landing }), ...draftIdsNamed({ texts: card.texts })])],
    kind: "ids",
  };
}
