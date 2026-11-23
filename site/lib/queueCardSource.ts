/**
 * Where a queue card came from — the owner's own words, or the fleet — composed once per row for the block the
 * expanded card leads with (`../components/console/SourceBlock.tsx`).
 *
 * A direct quote of the owner's exact words, prominent on the expanded queue card, is what the owner finds most
 * helpful. So every card says one of three things above its WHAT: what the owner said, that no words of the owner's
 * are behind it and where it came from instead, or that where it came from is not recorded. The words are stored on
 * the board row by `handover register` and `handover quote` (`src/handover/hisWords.ts`); nothing here reads a
 * transcript.
 *
 * **The one refusal.** A card whose anchor names the owner's words but carries none refuses ({@link sourceForm}): the
 * promise is that the owner's words lead it, and a card that silently drops them reads exactly like one that had none.
 * An anchor whose record would not read is NOT that — the backfill stored why, and the card says so.
 *
 * Pure: rows in, a value out.
 */
import type { BoardRow, HandStep } from "../components/live/read";
import type { AutonomyRow } from "../components/live/readAutonomy";
import type { BoardRowPrSteer, BoardRowQuote, BoardRowSteer } from "../components/live/readHisWords";
import { anchorInWords } from "./anchorInWords";
import type { QueueCardForm } from "./briefingCardForm";
import { carriesMachineId } from "./machineIds";
import { queueLinkTarget } from "./queueLink";
import { type QuotedReason, type ReasonWords, withLeadsMapped } from "./quotedReason";

/**
 * What a card says about where it came from, and every further steer of the owner's that bears on it, since the
 * owner may have given several on the matter. The steers are orthogonal to the
 * origin: a card a fleet finding raised can still carry words the owner said about it since.
 *
 * `subject` is what the card's row is ABOUT — its summary, question and slug in words — which picks the line of the
 * owner's words a long quote folds under (`./quoteLead.ts`). Absent where no row names it.
 *
 * `prSteers` is the owner's words stored on OTHER board rows naming a pull request the card's row names — so a card
 * about a pull request carries every row of the owner's on it, not only its own. Absent where there are none.
 */
export type CardSource = CardOrigin & {
  readonly steers: readonly BoardRowSteer[];
  readonly subject?: string;
  readonly prSteers?: readonly BoardRowPrSteer[];
};

/**
 * Where a card came from when no particular steer of the owner's is recorded behind it — what a standing ask of the owner's can stand
 * behind (`./standingAskSource.ts`).
 */
export type UnsteeredOrigin =
  /**
   * Proven not the owner's: a fleet finding, a bot's reply to someone else. `hover` carries a machine id the origin names in
   * words instead — the session that observed a finding.
   */
  | { readonly kind: "none"; readonly origin: string; readonly hover?: string }
  /** No anchor, but the session that registered the row — and the run it held, when established — is on it. */
  | { readonly kind: "registered"; readonly session: string; readonly run: string | undefined }
  /**
   * Nothing records where it came from. `hover` carries a machine id the origin names in words instead — the session
   * that posted a hand step.
   */
  | { readonly kind: "unrecorded"; readonly origin: string; readonly hover?: string };

/** Where a card came from. */
export type CardOrigin =
  /**
   * The owner's words, verbatim as the record captured them — and, on the ask's own card, the registering session's one line
   * saying how they bear on its question, which the block draws above them while it folds them.
   */
  | { readonly kind: "words"; readonly quote: BoardRowQuote; readonly bearsOn: string | undefined }
  /**
   * The owner's words should be here and are not — the card refuses. A stored quote that does not read keeps the read's own
   * reason apart from the console's lead.
   */
  | { readonly kind: "unquoted"; readonly anchor: string | undefined; readonly why: ReasonWords }
  /**
   * The anchor names the owner's words, and its record would not read when last tried. That reason is always the read's own,
   * so it is only ever quoted apart from the console's lead, never a plain string a line could carry.
   */
  | { readonly kind: "unreadable"; readonly anchor: string; readonly why: readonly QuotedReason[] }
  /** The row points at a place the owner's words may be — a Slack thread, a pull request — not a record of them. */
  | { readonly kind: "elsewhere"; readonly anchor: string }
  | UnsteeredOrigin
  /** The record that would say has not been read. */
  | { readonly kind: "unread"; readonly why: ReasonWords }
  /**
   * The board holding the row it belongs to has no reading in hand yet — still being read, or its read failed. The
   * block draws the board read's spinner or staleness mark, never a sentence, because a progress
   * indicator says it better than text.
   */
  | { readonly kind: "board-pending" }
  /**
   * No particular steer of the owner's is recorded behind it, so the standing ask of the owner's covering cards like
   * it is quoted instead, beside where the card did come from, which clarifies that it rests on no other particular
   * steer.
   */
  | {
      readonly kind: "standing";
      readonly askId: string;
      readonly quote: BoardRowQuote;
      readonly immediate: UnsteeredOrigin;
    }
  /** No particular steer is recorded behind it, and no standing ask of the owner's can be quoted — `why` says which. */
  | {
      readonly kind: "standing-missing";
      readonly immediate: UnsteeredOrigin;
      readonly why: ReasonWords;
      /**
       * The coverage no active ask covers, set only when the register read and nothing covered the card: the source
       * block draws the command recording one as a folded session step, never inside `why`'s words.
       */
      readonly uncoveredCoverage?: string;
    }
  /**
   * No particular steer is recorded behind it, and the owner's standing asks have no reading in hand yet — still being read,
   * or the read failed — so the block draws that read's spinner or staleness mark beside where the card came from.
   */
  | { readonly kind: "standing-pending"; readonly immediate: UnsteeredOrigin; readonly read: PendingRead };

/** A read with no reading in hand: still in flight, or failed with why. */
export type PendingRead = { readonly phase: "loading" } | { readonly phase: "not-measured"; readonly why: string };

/** A board row slug as the autonomy ledger accepts one for a subject — `src/autonomy/types.ts`'s pattern of the name. */
const AUTONOMY_BOARD_SLUG_PATTERN = /^[A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)*$/;

/** The anchor prefixes whose record holds the owner's own words — the same four `src/handover/hisWords.ts` names. */
const HIS_WORDS_PREFIXES: readonly string[] = ["talk:", "call:", "talk-call:", "transcript:"];

/**
 * Whether an anchor names a record of the owner's own words.
 *
 * @param anchor the row's `anchor:`
 * @returns true for a talk, call, talk-call or transcript anchor
 */
export function namesHisWords({ anchor }: { anchor: string | undefined }): boolean {
  if (anchor === undefined) {
    return false;
  }
  // Exactly as spelled, as the CLI's classifier and resolver read it.
  return HIS_WORDS_PREFIXES.some((prefix) => anchor.startsWith(prefix));
}

/**
 * The source of a board row — an ask's own, and the one a hand step or an act inherits from the row it names, the owner's
 * further steers on it included.
 *
 * @param row the board row
 * @returns the source
 */
export function boardRowSource({ row }: { row: BoardRow }): CardSource {
  return {
    ...boardRowOrigin({ row }),
    ...prSteersOf({ source: row }),
    steers: row.hisWordsSteers,
    subject: rowSubject({ row }),
  };
}

/**
 * A row's or source's pull-request words as a spread, so a source rebuilt from another keeps them without writing an
 * empty or undefined key.
 *
 * @param source what carries them
 * @returns the spread
 */
function prSteersOf({ source }: { source: { readonly prSteers?: readonly BoardRowPrSteer[] } }): {
  readonly prSteers?: readonly BoardRowPrSteer[];
} {
  if (source.prSteers === undefined || source.prSteers.length === 0) {
    return {};
  }
  return { prSteers: source.prSteers };
}

/**
 * What a board row is about, as the words its quote's lead is picked against: its summary, its question and its slug
 * read as words. Never drawn — a summary carries ids the page keeps off a card.
 */
function rowSubject({ row }: { row: BoardRow }): string {
  const parts = [row.summary, row.question, row.slug.replaceAll("-", " ")];
  return parts.filter((part): part is string => part !== undefined).join(" ");
}

/** Where a board row came from. */
function boardRowOrigin({ row }: { row: BoardRow }): CardOrigin {
  const said = row.hisWords;
  if (said.kind === "defect") {
    return {
      anchor: row.anchor,
      kind: "unquoted",
      why: [{ lead: "the quote stored on its board row does not read", why: said.why }],
    };
  }
  if (said.kind === "held") {
    return { bearsOn: row.bearsOn, kind: "words", quote: said.quote };
  }
  if (namesHisWords({ anchor: row.anchor })) {
    const anchor = row.anchor!;
    if (said.kind === "unread") {
      return { anchor, kind: "unreadable", why: [{ lead: "its record would not read", why: said.why }] };
    }
    return { anchor, kind: "unquoted", why: "no quote is stored on its board row yet" };
  }
  if (row.origin === "finding") {
    // The observing session rides the hover, never the line, because IDs do not read well on a card.
    if (row.observedBy !== undefined) {
      return { hover: `session ${row.observedBy}`, kind: "none", origin: "a fleet finding a session observed" };
    }
    return { kind: "none", origin: "a fleet finding a session observed" };
  }
  if (row.anchor !== undefined) {
    return { anchor: row.anchor, kind: "elsewhere" };
  }
  // The session that registered the row is on it, because `handover register` writes it down; a card must not say
  // nothing records whose words are behind it when that session is known.
  if (row.registeredBy !== undefined) {
    return { kind: "registered", run: row.registeredRun, session: row.registeredBy };
  }
  return { kind: "unrecorded", origin: "its board row records no anchor for where it came from" };
}

/**
 * The source of the one live row named `slug`. The live board never holds an archived row, so a slug it does not
 * hold names a row whose words are unknown here, never proof there were none; and a slug two live rows share names
 * neither for certain.
 *
 * @param slug the row slug a card names
 * @returns the row's source, or `unread` saying why it is not read
 */
function namedRowSource({ slug, rows }: { slug: string; rows: readonly BoardRow[] }): CardSource {
  const named = rows.filter((one) => one.slug === slug);
  const row = named.find((one) => one.slug === slug);
  if (row === undefined) {
    return {
      kind: "unread",
      steers: [],
      why: "the live board no longer holds the row this card names, most likely settled and archived, so the words behind it are not read here",
    };
  }
  if (named.length > 1) {
    return {
      kind: "unread",
      steers: [],
      why: `the live board holds ${String(named.length)} rows by the name this card gives, so whose words are behind it is not read here`,
    };
  }
  const source = boardRowSource({ row });
  // The row's bears-on line says how the owner's words bear on THAT row's question; a hand step or an act asks another.
  if (source.kind === "words") {
    return { ...source, bearsOn: undefined };
  }
  return source;
}

/**
 * The source of a card that BELONGS to a board row without being its ask — a parked post naming the row it was
 * drafted for, the owner's pull request's landing row — joined at render time, so every card already queued reads the
 * words behind its row too (a quote of the owner's on every card).
 *
 * A card naming no row, or whose row records nothing more than it does, keeps what it says of itself. A row that
 * should carry the owner's words and does not is said aloud, never a refusal: a refused card draws no draft, and the
 * draft is the thing the owner is approving.
 *
 * @param slug the row the card names, when it names one
 * @param rows the board's rows, or `undefined` while the board has not been read
 * @param otherwise what the card says of itself when its row adds nothing
 * @returns the source
 */
export function belongingRowSource({
  slug,
  rows,
  otherwise,
}: {
  slug: string | undefined;
  rows: readonly BoardRow[] | undefined;
  // Only `unrecorded`, so a fallback can never be the one kind that refuses.
  otherwise: Extract<CardSource, { kind: "unrecorded" }>;
}): CardSource {
  if (slug === undefined) {
    return otherwise;
  }
  if (rows === undefined) {
    return { kind: "board-pending", steers: [] };
  }
  const source = namedRowSource({ rows, slug });
  // The row records no more of where it came from than the card does, but any steer of the owner's on it still travels.
  if (source.kind === "unrecorded") {
    return { ...otherwise, steers: source.steers, ...subjectOf({ source }), ...prSteersOf({ source }) };
  }
  if (source.kind === "unquoted") {
    return {
      kind: "unread",
      steers: source.steers,
      why: withLeadsMapped({
        lead: (words) => `${words}, so your words behind it are not on this card`,
        reason: source.why,
      }),
      ...subjectOf({ source }),
      ...prSteersOf({ source }),
    };
  }
  return source;
}

/** A source's subject as a spread, so a source rebuilt from another keeps it without writing an undefined key. */
function subjectOf({ source }: { source: CardSource }): { readonly subject?: string } {
  if (source.subject === undefined) {
    return {};
  }
  return { subject: source.subject };
}

/**
 * The source of a hand step: the board row its link opens, else whoever posted it.
 *
 * @param step the hand step
 * @param rows the board's rows, or `undefined` while the board has not been read
 * @returns the source
 */
export function handSource({ step, rows }: { step: HandStep; rows: readonly BoardRow[] | undefined }): CardSource {
  const target = queueLinkTarget({ url: step.url });
  if (target?.kind === "ask") {
    if (rows === undefined) {
      return { kind: "board-pending", steers: [] };
    }
    return namedRowSource({ rows, slug: target.id });
  }
  // A session posting the step says who wrote it down, not whose idea it was. A
  // poster that is a session id rides the hover, never the line, because IDs do not read well on a card — the chair posts by its session id, and naming it in the line withheld every note it posted.
  if (step.postedBy !== undefined) {
    if (carriesMachineId({ text: step.postedBy })) {
      return {
        hover: `session ${step.postedBy}`,
        kind: "unrecorded",
        origin: "posted by a Claude session, opening no ask",
        steers: [],
      };
    }
    return { kind: "unrecorded", origin: `posted by ${step.postedBy}, opening no ask`, steers: [] };
  }
  return { kind: "unrecorded", origin: "the step records no poster and opens no ask", steers: [] };
}

/**
 * The source of an act: the board row its run names, or, when it names no run, the row its subject names.
 *
 * A run is always a row slug, and a subject shaped like one may be; either one the live board does not hold is NOT
 * read — the row was most likely settled and archived, and the words behind it are unknown here, never proof that
 * there were none. An act naming no row at all — its subject a pull
 * request, a thread, a state file — still may have been the owner's steer, and its own `why` often says so; nothing
 * here reads that, so the card says nothing records whose words are behind it.
 *
 * @param act the autonomy ledger row
 * @param rows the board's rows, or `undefined` while the board has not been read
 * @returns the source
 */
export function actSource({ act, rows }: { act: AutonomyRow; rows: readonly BoardRow[] | undefined }): CardSource {
  if (rows === undefined) {
    return { kind: "board-pending", steers: [] };
  }
  // A run decides alone: its subject may be another live row's slug, whose words are not this act's.
  if (act.run !== undefined) {
    return namedRowSource({ rows, slug: act.run });
  }
  if (AUTONOMY_BOARD_SLUG_PATTERN.test(act.subject)) {
    return namedRowSource({ rows, slug: act.subject });
  }
  return {
    kind: "unrecorded",
    origin: `the fleet acted on ${act.subject} and names no board row (${act.kind})`,
    steers: [],
  };
}

/** What an act names for {@link actSource}: its run, else a slug-shaped subject, else the subject itself. */
function actNames({ act }: { act: AutonomyRow }): string {
  if (act.run !== undefined) {
    return `row:${act.run}`;
  }
  if (AUTONOMY_BOARD_SLUG_PATTERN.test(act.subject)) {
    return `row:${act.subject}`;
  }
  return `subject:${act.subject}`;
}

/**
 * The source of a card standing for several acts of one pattern: the newest act's, when every act in it names the
 * same row or subject, else nothing records whose words are behind it — one row's words never stand for another's.
 *
 * @param act the newest act, which the card draws
 * @param earlier the acts folded beneath it
 * @param rows the board's rows, or `undefined` while the board has not been read
 * @returns the source
 */
export function actGroupSource({
  act,
  earlier,
  rows,
}: {
  act: AutonomyRow;
  earlier: readonly AutonomyRow[];
  rows: readonly BoardRow[] | undefined;
}): CardSource {
  const named = new Set([act, ...earlier].map((one) => actNames({ act: one })));
  if (named.size > 1) {
    const count = String(earlier.length + 1);
    return {
      kind: "unrecorded",
      origin: `${count} ${act.kind} acts of one pattern, naming ${String(named.size)} rows or subjects`,
      steers: [],
    };
  }
  return actSource({ act, rows });
}

/**
 * The form a source puts on its card: refused only when the owner's words should lead it and do not.
 *
 * @param source the card's source
 * @returns `refused` with the sentence the card draws, else `drawn`
 */
export function sourceForm({ source }: { source: CardSource }): QueueCardForm {
  if (source.kind !== "unquoted") {
    return { kind: "drawn" };
  }
  let where = "a record of your words";
  if (source.anchor !== undefined) {
    where = `your words ${anchorInWords({ anchor: source.anchor })}`;
  }
  if (typeof source.why === "string") {
    return {
      kind: "refused",
      why: `This card came from ${where}, but they are not on it: ${source.why}. \`slopweaver handover quote --apply\` writes them.`,
    };
  }
  // A quoted reason is joined after its lead (`lead: why`, spoken and reported), so the remedy sits inside the lead
  // and the lead ends on what did not read — never on a sentence of its own the reason would trail.
  return {
    kind: "refused",
    why: withLeadsMapped({
      lead: (words) =>
        `This card came from ${where}, but they are not on it until \`slopweaver handover quote --apply\` writes them, because ${words}`,
      reason: source.why,
    }),
  };
}
