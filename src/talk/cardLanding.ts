/**
 * The card-landing ledger's rows and the fold that says which cards the owner's words are holding off the queue — pure.
 *
 * Words the owner says while a card is open land on that card, relayed or not, but only words the voice judged the
 * card's answer, never on a hand step (`./cardAnswer.ts`, `./cardUtterance.ts`). A card is drawn from one of six
 * registers (`site/lib/queueRows.ts`), and five of them have no place for the owner's
 * words: a hand step is posted or settled, a held draft is held. So a landing is recorded HERE, once, for every
 * kind, and the queue reads it as an overlay — a card with an active landing is not drawn, because the next
 * thing that card needs is a session acting on what the owner said, not their attention again. An ask additionally
 * carries the landing as a native `ruling` event, which `src/handover/ownerWait.ts` already reads as
 * "waiting on a session".
 *
 * ## Two rows, and why a restore is per CARD
 *
 * `landed` records one utterance on one card. `restored` puts a card back: the owner made a general remark with a card
 * open and the card was pulled by it — the trade accepted with landing on every word. A restore deactivates EVERY landing on that card written before it, because a relay and the
 * transcript can both have landed the same words under two anchors, and "put this card back" means all of it.
 * A later word re-lands the card, as it should.
 *
 * ## A KEPT restore is scoped to one relay, and holds
 *
 * `handover settle --card kept` (answering is not always finishing) writes a `restored` row carrying
 * `disposition: "kept"`, the relay's `talk:<turnId>` as its anchor and the settled row as its `workSlug`. It lifts
 * only the landings that are THAT relay's — its own anchor, or a landing whose work is that same row, which is what
 * the transcript's landing of the relay's words points at — so another steer still waiting on a session keeps the
 * card off the owner's queue. And it holds wherever it sits in the ledger: a landing of that relay written after it, late,
 * never hides the card again. A reader older than this field reads the row as the card-wide restore it always was.
 *
 * ## Identity survives a restore
 *
 * A landing's identity is its utterance anchor and its card together, so one sentence answering two cards is
 * two landings (a "close BOTH"). And "already landed" ({@link repeatLanding}) asks whether that identity was EVER
 * written, not whether it is active: `talk transcript` re-derives every finished utterance of a call on each batch, and a
 * restored landing re-landing on the next batch would undo the restore within seconds.
 *
 * ## The same utterance, grown
 *
 * A batch overtaken by a later one can make `talk transcript` land an utterance before all its words are on disk. The same identity re-derived with MORE words is written again, on the first row's work, and the
 * latest row per identity is the one the queue reads, dated by the first, when the card left — while that identity
 * is still active. Once restored, the restore wins; the words stay in the call file.
 *
 * A call that closed or dropped also lands a stretch the owner never finished, and the call file caps a long one, so a
 * row says whether its words were cut (`wordsCut`). A reader binding their yes (`slack draft approve`) refuses a cut
 * row and one written before rows said, exactly as it refuses a cut `talk-call:` stretch — and asks the call file too,
 * since a restored card takes no later row for a cut found after it (`./landingCut.ts`). The residue, stated: words not
 * on disk at all when the row is read — a whole segment still in an overtaken batch — are invisible to every reader.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { CARD_KEY, isRegisterCardKey } from "./cardKey.js";
import { prCardKeyParts } from "./prCardKey.js";
import { relayAnchor } from "./relayDraft.js";

/**
 * Who landed the words: the transcript at write time, a relay the voice made, a session closing a second card, or —
 * never written here, only derived by `talk cards` — the chair's intake mark on a voice-opened card
 * (`./intakeCardLandings.ts`).
 */
export type CardLandingSource = "transcript" | "relay" | "session" | "intake";

/** One utterance, landed on one card. */
export interface CardLandedRow {
  readonly kind: "landed";
  /** When the landing was written. */
  readonly atIso: string;
  /** The owner utterance: `call:<callId>#<segment>` for speech, `talk:<turnId>` for a relay. */
  readonly anchor: string;
  /**
   * The anchors of the later segments these words carried, when there were any. A later batch can split the
   * utterance — the voice's line arriving late, between two of the owner's segments — and a segment split off then finds
   * its words already on this row rather than registering a second one.
   */
  readonly laterAnchors?: readonly string[];
  readonly cardKey: string;
  /** The owner's words, exactly as the card now carries them. */
  readonly words: string;
  /**
   * Whether `words` may be fewer than the owner said — a stretch the call never finished, or one it capped
   * (`./cardUtterance.ts` `wordsCut`). Absent on a landing that predates storing it, or one whose anchor is a relay's
   * (its turn file says): either is never read as whole by a reader binding a yes (`../handover/hisWordsResolve.ts`).
   */
  readonly wordsCut?: boolean;
  /** When the owner said them. */
  readonly decidedIso: string;
  readonly source: CardLandingSource;
  /** The board row a session acts on: the ask itself, the relay's row, or the dispatch row the landing registered. */
  readonly workSlug: string;
  /**
   * The Slack draft ids an ask or hand card named when these words landed. An ask's doc keeps no history and settling
   * the ask rewrites it, so the binding reads these beside what the card names now.
   */
  readonly draftIds?: readonly string[];
  /**
   * Why the card would not read as these words landed, so which drafts it named then is unknown. The binding reads the
   * landing as unreadable for good — a card that reads again later may already have been rewritten.
   */
  readonly draftIdsUnread?: string;
}

/** A card put back on the owner's queue, with why and where that was decided. */
export interface CardRestoredRow {
  readonly kind: "restored";
  readonly atIso: string;
  readonly cardKey: string;
  /** Where the restore was decided — a run, a transcript line, the owner's word. */
  readonly anchor: string;
  readonly why: string;
  /** `kept`: a settle left the card up on purpose, and this restore lifts only one relay's landings. */
  readonly disposition?: "kept";
  /** On a kept restore, the settled row — the work every landing this restore resolves points at. */
  readonly workSlug?: string;
}

/** One line of the ledger. */
export type CardLandingRow = CardLandedRow | CardRestoredRow;

const iso = z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: "not an ISO instant" });
const cardKeySchema = z.string().regex(CARD_KEY);

const rowSchema = z.discriminatedUnion("kind", [
  z.object({
    anchor: z.string().min(1).max(300),
    atIso: iso,
    cardKey: cardKeySchema,
    decidedIso: iso,
    draftIds: z.array(z.string().min(1).max(64)).min(1).exactOptional(),
    draftIdsUnread: z.string().min(1).max(2000).exactOptional(),
    kind: z.literal("landed"),
    laterAnchors: z.array(z.string().min(1).max(300)).min(1).exactOptional(),
    source: z.enum(["transcript", "relay", "session"]),
    words: z.string().min(1),
    wordsCut: z.boolean().exactOptional(),
    workSlug: z.string().min(1).max(200),
  }),
  z.object({
    anchor: z.string().min(1).max(300),
    atIso: iso,
    cardKey: cardKeySchema,
    disposition: z.literal("kept").exactOptional(),
    kind: z.literal("restored"),
    why: z.string().min(1),
    workSlug: z.string().min(1).max(200).exactOptional(),
  }),
]);

/**
 * Parse one decoded ledger line.
 *
 * @param value the line's decoded JSON
 * @returns the row, or `undefined` when it is not one
 */
export function cardLandingRowOf({ value }: { value: unknown }): CardLandingRow | undefined {
  const parsed = rowSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * A landing's identity: its utterance and its card together.
 *
 * @param anchor the owner utterance
 * @param cardKey the card it landed on
 * @returns sixteen hex characters of sha256 over the pair
 */
function cardLandingId({ anchor, cardKey }: { anchor: string; cardKey: string }): string {
  return createHash("sha256").update(`${anchor}\0${cardKey}`).digest("hex").slice(0, 16);
}

/**
 * Every landing of one utterance on one card: under its own anchor, or under a later segment's anchor when that
 * segment landed first, restored since or not.
 *
 * @param rows the ledger, in file order
 * @param anchor the owner utterance
 * @param laterAnchors the anchors of the utterance's later segments
 * @returns those landings in file order — the first is the one whose work every later row of it reuses
 */
export function utteranceLandings({
  anchor,
  cardKey,
  laterAnchors,
  rows,
}: {
  anchor: string;
  cardKey: string;
  laterAnchors: readonly string[];
  rows: readonly CardLandingRow[];
}): readonly CardLandedRow[] {
  const anchors = new Set([anchor, ...laterAnchors]);
  return rows.filter(
    (row): row is CardLandedRow =>
      row.kind === "landed" && row.cardKey === cardKey && landedAnchors({ row }).some((one) => anchors.has(one)),
  );
}

/**
 * Every segment anchor a landing's words carried: its own, then its later segments'.
 *
 * @param row the landing
 * @returns the anchors, its own first
 */
export function landedAnchors({ row }: { row: CardLandedRow }): readonly string[] {
  if (row.laterAnchors === undefined) {
    return [row.anchor];
  }
  return [row.anchor, ...row.laterAnchors];
}

/**
 * The Slack draft ids a landing kept as its card named them when the owner's words landed.
 *
 * @param row the landing
 * @returns the kept ids, none for a landing that kept none
 */
export function keptDraftIds({ row }: { row: CardLandedRow }): readonly string[] {
  if (row.draftIds === undefined) {
    return [];
  }
  return row.draftIds;
}

/**
 * Whether `words` stand, whole words, inside what a landing already carried.
 *
 * @param landed the words already landed, or on file
 * @returns whether `words` is a whole-word run of them
 */
export function carries({ landed, words }: { landed: string; words: string }): boolean {
  return ` ${landed} `.includes(` ${words} `);
}

/**
 * The landing that makes landing these words again a repeat: these exact words already written under this anchor
 * on this card, or the utterance — under this anchor or a later segment's — restored since it was
 * last written, when the restore wins over any words still arriving. `undefined` means the words are new: never
 * landed, or grown past what landed and still active.
 *
 * @param rows the ledger, in file order
 * @param anchor the owner utterance
 * @param laterAnchors the anchors of the utterance's later segments
 * @param relayTurns the relays that heard these words, whose own landing restored since makes this one a repeat too
 * @param words the owner's words as they stand now
 * @param wordsCut whether the call now shows those words cut; a cut no matching row recorded is landed again while the
 *   identity is active, so the latest row says it — a cut only ever ratchets on, never off
 * @returns the row a landing reports as `already`, or `undefined` when these words should land
 */
export function repeatLanding({
  anchor,
  cardKey,
  laterAnchors,
  relayTurns,
  rows,
  words,
  wordsCut,
}: {
  anchor: string;
  cardKey: string;
  laterAnchors: readonly string[];
  relayTurns: readonly string[];
  rows: readonly CardLandingRow[];
  words: string;
  wordsCut: boolean | undefined;
}): CardLandedRow | undefined {
  const mine = utteranceLandings({ anchor, cardKey, laterAnchors, rows });
  const latest = mine.at(-1);
  const anchors = new Set([anchor, ...laterAnchors]);
  // Folded only on the paths that ask: the whole ledger is folded per utterance per batch.
  const stillActive = (): boolean =>
    activeCardLandings({ rows }).some(
      (row) => row.cardKey === cardKey && landedAnchors({ row }).some((one) => anchors.has(one)),
    );
  // Already on the card: these words under this anchor, or carried whole by a landing whose words held this
  // segment, before a late line split the utterance they were landed as.
  const matching = mine.filter(
    (row) =>
      (row.anchor === anchor && row.words === words) ||
      (landedAnchors({ row }).includes(anchor) && carries({ landed: row.words, words })),
  );
  const exact = matching[0];
  if (exact !== undefined) {
    // The same words, now cut — an empty unfinished stretch normalises away — where no matching row said so: a row
    // that read whole would otherwise stand as the owner's whole yes. A restored card keeps its restore.
    const cutUnrecorded = wordsCut === true && !matching.some((row) => row.wordsCut === true);
    return cutUnrecorded && stillActive() ? undefined : exact;
  }
  // A relay that heard these words landed them under its own anchor, and a restore since lifted it: the transcript
  // landing the same words under their call anchor afterwards must not pull the card back off.
  const relayed = restoredRelayLanding({ cardKey, relayTurns, rows });
  if (relayed !== undefined || latest === undefined) {
    return relayed;
  }
  return stillActive() ? undefined : latest;
}

/**
 * The latest landing on a card under one of these relays' anchors, when a restore of that card follows it.
 *
 * @param relayTurns the relays' turn ids
 * @param rows the ledger, in file order
 * @returns that landing, or `undefined` when no such relay landed there or its landing still stands
 */
function restoredRelayLanding({
  cardKey,
  relayTurns,
  rows,
}: {
  cardKey: string;
  relayTurns: readonly string[];
  rows: readonly CardLandingRow[];
}): CardLandedRow | undefined {
  const anchors = new Set(relayTurns.map((turnId) => relayAnchor({ turnId })));
  const at = rows.findLastIndex((row) => row.kind === "landed" && row.cardKey === cardKey && anchors.has(row.anchor));
  const landed = rows[at];
  if (landed?.kind !== "landed") {
    return undefined;
  }
  const lifted =
    rows
      .slice(at + 1)
      .some((row) => row.kind === "restored" && row.cardKey === cardKey && row.disposition === undefined) ||
    keptRows({ rows }).some((kept) => keptResolves({ kept, landed }));
  return lifted ? landed : undefined;
}

/**
 * Every kept restore in the ledger, in file order.
 *
 * @param rows the ledger, in file order
 * @returns the `restored` rows carrying `disposition: "kept"`
 */
function keptRows({ rows }: { rows: readonly CardLandingRow[] }): readonly CardRestoredRow[] {
  return rows.filter((row): row is CardRestoredRow => row.kind === "restored" && row.disposition === "kept");
}

/**
 * Whether a kept restore resolves a landing: the same card, and the kept relay's own words — its anchor, or work
 * pointing at the row the settle ended. Work pointing there is not enough from ANOTHER relay: two turns sharing
 * their first twelve hex digits share a row slug, and a later steer of the second would otherwise be lifted by the
 * first one's keep.
 *
 * @param kept the kept restore
 * @param landed the landing
 * @returns whether that landing no longer holds the card off the owner's queue
 */
function keptResolves({ kept, landed }: { kept: CardRestoredRow; landed: CardLandedRow }): boolean {
  if (kept.cardKey !== landed.cardKey) {
    return false;
  }
  const anchors = landedAnchors({ row: landed });
  if (anchors.includes(kept.anchor)) {
    return true;
  }
  const otherRelay = anchors.some((anchor) => anchor.startsWith("talk:"));
  return !otherRelay && landed.workSlug === kept.workSlug;
}

/**
 * Why each card a settle kept is still up: the latest kept restore's reason, per card.
 *
 * @param rows the ledger, in file order
 * @returns card key → reason
 */
export function keptReasons({ rows }: { rows: readonly CardLandingRow[] }): ReadonlyMap<string, string> {
  return new Map(keptRows({ rows }).map((row) => [row.cardKey, row.why]));
}

/**
 * The landings still holding a card off the owner's queue: every `landed` row not followed, in the ledger, by a
 * card-wide `restored` row for its card, and not resolved by a kept restore anywhere in it. One per identity: the
 * latest written, which carries the most of the owner's words, in the place the identity first took and at the instant it
 * first landed, since that is when the card left the owner's queue. An identity restored once stays out.
 *
 * @param rows the ledger, in file order
 * @returns the active landings, in the order their identities were first written
 */
export function activeCardLandings({ rows }: { rows: readonly CardLandingRow[] }): readonly CardLandedRow[] {
  const active = new Map<string, CardLandedRow>();
  const seen = new Set<string>();
  const kept = keptRows({ rows });
  for (const row of rows) {
    if (row.kind === "restored") {
      liftCard({ active, row });
      continue;
    }
    if (kept.some((one) => keptResolves({ kept: one, landed: row }))) {
      continue;
    }
    const id = cardLandingId({ anchor: row.anchor, cardKey: row.cardKey });
    const first = active.get(id);
    if (first !== undefined) {
      // Grown, it keeps the instant it first landed: the card left then, not at the rewrite.
      active.set(id, { ...row, atIso: first.atIso });
    } else if (!seen.has(id)) {
      seen.add(id);
      active.set(id, row);
    }
  }
  return [...active.values()];
}

/**
 * A card-wide restore lifts every landing on its card so far; a KEPT restore lifts nothing here, because the
 * landings it resolves are skipped wherever they sit in the ledger.
 *
 * @param active the landings standing so far, by identity, which this edits
 * @param row the restore
 */
function liftCard({ active, row }: { active: Map<string, CardLandedRow>; row: CardRestoredRow }): void {
  if (row.disposition === "kept") {
    return;
  }
  for (const [id, landed] of active) {
    if (landed.cardKey === row.cardKey) {
      active.delete(id);
    }
  }
}

/**
 * Whether a landing kept OUT of the ledger still holds its card: no card-wide restore of that card at or after the
 * instant it landed, and no kept restore resolving it. A derived row has no place in the file's order, so its instant
 * stands in for one — the same "a restore lifts what came before it" the ledger's own fold applies.
 *
 * @param landed the landing, never itself a ledger row
 * @param rows the ledger, in file order
 * @returns whether it still holds the card off the owner's queue
 */
export function landingStillHolds({
  landed,
  rows,
}: {
  landed: CardLandedRow;
  rows: readonly CardLandingRow[];
}): boolean {
  const at = Date.parse(landed.atIso);
  const lifted = rows.some(
    (row) =>
      row.kind === "restored" &&
      row.cardKey === landed.cardKey &&
      row.disposition === undefined &&
      Date.parse(row.atIso) >= at,
  );
  return !lifted && !keptRows({ rows }).some((kept) => keptResolves({ kept, landed }));
}

/**
 * The board slug of the dispatch row one utterance registers, derived from the utterance so a second landing of
 * the same words — the same batch re-posted, or a second card it answers — finds the same row.
 *
 * @param anchor the owner utterance
 * @returns a slug in the `talk-card-<12 hex>` shape
 */
export function cardDispatchSlug({ anchor }: { anchor: string }): string {
  return `talk-card-${createHash("sha256").update(anchor).digest("hex").slice(0, 12)}`;
}

/**
 * The ask text of the dispatch row a landing registers: the owner's words FIRST, exactly, then which card they were
 * said over and where to hear them — so the session that picks the row up reads what the owner said before anything
 * about it, the order `./relayDraft.ts` keeps for a relay.
 *
 * @param words the owner's words
 * @param cardKey the card that was open
 * @param anchor the owner utterance
 * @returns the row's ask text
 */
export function cardDispatchAsk({
  words,
  cardKey,
  anchor,
}: {
  words: string;
  cardKey: string;
  anchor: string;
}): string {
  return (
    `"${words}"\n\n` +
    `The owner said this with ${cardKey} open on the console, so it landed on that card and took it off the owner's queue ` +
    `until this row is acted on. Act on it against that card; if it was not about that card, put the card back ` +
    `with \`slopweaver talk restore --card ${cardKey} --anchor <where you decided> --why "<why>"\`. ` +
    `Heard at ${anchor}.`
  );
}

/**
 * Split a register card key into its register and its id. A `recipe:` or `align:` key is a card key that no
 * register holds, so nothing can be landed on it or restored to it.
 *
 * @param cardKey the candidate key
 * @returns the kind and the id, or `undefined` when it is not a Queue card key
 */
export function cardKeyParts({
  cardKey,
}: {
  cardKey: string;
}): { readonly kind: string; readonly id: string } | undefined {
  if (!CARD_KEY.test(cardKey) || !isRegisterCardKey({ key: cardKey })) {
    return undefined;
  }
  // A bare `pr:<n>` passes CARD_KEY so old journal lines stay readable, but names no card a word could land on.
  if (cardKey.startsWith("pr:") && prCardKeyParts({ key: cardKey }) === undefined) {
    return undefined;
  }
  const colon = cardKey.indexOf(":");
  return { id: cardKey.slice(colon + 1), kind: cardKey.slice(0, colon) };
}
