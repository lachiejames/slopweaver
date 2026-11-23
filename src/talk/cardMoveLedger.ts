/**
 * The moved-on ledger's rows and the fold that says which cards the walk is holding off the owner's Queue — pure. The file is
 * `./cardMoveStore.ts`'s; the move a row records is `./cardMove.ts`'s.
 *
 * ## Its own ledger, beside the card-landing one
 *
 * A landing carries the owner's words as an ANSWER and names the work a session does on them; a move carries neither — the
 * owner may have said nothing — so it is not a fake `landed` row (`./cardLanding.ts`). And every console, CLI and desktop
 * build reading `talk/card-landings.jsonl` refuses a row kind it does not know, so a third kind there would make an
 * older reader on the same home report the whole overlay partial. Moves therefore have their own file, and a
 * `talk restore` row in the landing ledger lifts them exactly as it lifts a landing: by its card, at or after the
 * instant the move took the card off.
 *
 * ## Identity, growth and restore
 *
 * A move's identity is its anchor and its card. A later batch can carry more of the owner's words over the card the owner left, so
 * the same identity is written again with them, and the queue reads the latest row dated by the first. Once a
 * restore lifts it, the restore wins for good: the same move replayed by a later batch never takes the card off again,
 * while a genuinely later move — a new anchor — does.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { CARD_KEY } from "./cardKey.js";
import type { CardLandingRow } from "./cardLanding.js";
import { type CardWalkMove, MOVE_WORDS_MAX, removedByMove } from "./cardMove.js";

/** One card the walk moved on from, off the owner's Queue until a restore. */
export interface CardMovedOnRow {
  readonly kind: "moved-on";
  /** When the row was written — for the first row of a move, the instant the card left the owner's Queue. */
  readonly atIso: string;
  /** `call:<callId>#move:<requestId>`. */
  readonly anchor: string;
  readonly cardKey: string;
  /** The card the walk moved to. */
  readonly toCardKey: string;
  /** When the walk moved. */
  readonly decidedIso: string;
  /** The owner's words over the card, exactly as the call file holds them; absent when they said nothing over it. */
  readonly words?: string;
}

const iso = z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: "not an ISO instant" });

const rowSchema = z
  .object({
    anchor: z.string().min(1).max(300),
    atIso: iso,
    cardKey: z.string().regex(CARD_KEY),
    decidedIso: iso,
    kind: z.literal("moved-on"),
    toCardKey: z.string().regex(CARD_KEY),
    words: z.string().min(1).max(MOVE_WORDS_MAX).exactOptional(),
  })
  .strict();

/**
 * Parse one decoded ledger line.
 *
 * @param value the line's decoded JSON
 * @returns the row, or `undefined` when it is not one
 */
export function cardMovedOnRowOf({ value }: { value: unknown }): CardMovedOnRow | undefined {
  const parsed = rowSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * A move's identity: its anchor and its card together.
 *
 * @returns sixteen hex characters of sha256 over the pair
 */
function moveId({ anchor, cardKey }: { anchor: string; cardKey: string }): string {
  return createHash("sha256").update(`${anchor}\0${cardKey}`).digest("hex").slice(0, 16);
}

/**
 * Whether a card-wide restore of a card was written at or after an instant.
 *
 * @param landings the card-landing ledger, whose `restored` rows lift moves too
 * @param cardKey the card
 * @param sinceIso the instant the move took it off
 * @returns whether a restore lifted it
 */
function restoredSince({
  landings,
  cardKey,
  sinceIso,
}: {
  landings: readonly CardLandingRow[];
  cardKey: string;
  sinceIso: string;
}): boolean {
  const since = Date.parse(sinceIso);
  return landings.some(
    (row) =>
      row.kind === "restored" &&
      row.cardKey === cardKey &&
      row.disposition === undefined &&
      Date.parse(row.atIso) >= since,
  );
}

/**
 * Every move per identity: the latest row written, dated by the first.
 *
 * @param moves the moved-on ledger, in file order
 * @returns one row per identity, in the order the identities were first written
 */
function latestPerMove({ moves }: { moves: readonly CardMovedOnRow[] }): readonly CardMovedOnRow[] {
  const byId = new Map<string, CardMovedOnRow>();
  for (const row of moves) {
    const id = moveId({ anchor: row.anchor, cardKey: row.cardKey });
    const first = byId.get(id);
    byId.set(id, first === undefined ? row : { ...row, atIso: first.atIso });
  }
  return [...byId.values()];
}

/**
 * The moves still holding a card off the owner's Queue: one per identity, the latest written dated by the first, unless a
 * card-wide restore of that card was written at or after it.
 *
 * @param moves the moved-on ledger, in file order
 * @param landings the card-landing ledger, whose `restored` rows lift a move
 * @returns the active moves
 */
export function activeCardMoves({
  moves,
  landings,
}: {
  moves: readonly CardMovedOnRow[];
  landings: readonly CardLandingRow[];
}): readonly CardMovedOnRow[] {
  return latestPerMove({ moves }).filter(
    (row) => !restoredSince({ cardKey: row.cardKey, landings, sinceIso: row.atIso }),
  );
}

/**
 * The row a walk's move writes, or `undefined` when there is nothing to write: a come-back (a deferral, not a
 * removal), a card movement never removes, a move already written with these words, or one a restore has lifted.
 *
 * @param move the move, folded from the call
 * @param moves the moved-on ledger, in file order
 * @param landings the card-landing ledger
 * @param nowIso when the row would be written
 * @returns the row to append, or `undefined`
 */
export function movedOnRowToWrite({
  move,
  moves,
  landings,
  nowIso,
}: {
  move: CardWalkMove;
  moves: readonly CardMovedOnRow[];
  landings: readonly CardLandingRow[];
  nowIso: string;
}): CardMovedOnRow | undefined {
  if (move.disposition !== "moved-on" || !removedByMove({ cardKey: move.fromCardKey })) {
    return undefined;
  }
  const row: CardMovedOnRow = {
    anchor: move.anchor,
    atIso: nowIso,
    cardKey: move.fromCardKey,
    decidedIso: move.decidedIso,
    kind: "moved-on",
    toCardKey: move.toCardKey,
    ...(move.words === undefined ? {} : { words: move.words }),
  };
  // A restore made at or after the owner moved on beats the move however late its row is written: a first write that failed
  // and is retried by the owed sweep after the owner's restore would otherwise be dated after it and hide the card again.
  if (restoredSince({ cardKey: row.cardKey, landings, sinceIso: row.decidedIso })) {
    return undefined;
  }
  const id = moveId({ anchor: row.anchor, cardKey: row.cardKey });
  const written = latestPerMove({ moves }).find((one) => moveId({ anchor: one.anchor, cardKey: one.cardKey }) === id);
  if (written === undefined) {
    return row;
  }
  // A restore wins for good; the same words again are already on file, and a read carrying none adds nothing.
  const lifted = restoredSince({ cardKey: written.cardKey, landings, sinceIso: written.atIso });
  if (lifted || move.words === undefined || written.words === move.words) {
    return undefined;
  }
  return row;
}
