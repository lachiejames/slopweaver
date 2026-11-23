/**
 * What one `card-move` line of a call file may say: the page moved the walk from one Queue card to the next
 * (`./cardMove.ts` folds the lines into moves). Its own file so `./callRecord.ts` reads the shape without importing
 * the fold, which reads `callRecord.ts` back. Pure.
 */
import { z } from "zod";

import { CARD_KEY } from "./cardKey.js";

/** What the walk did with the card it left: took it off the owner's Queue, or put it aside to come back to. */
export type CardMoveDisposition = "moved-on" | "come-back";

const iso = z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: "not an ISO instant" });

/**
 * A `card-move` line's own fields; `./callRecord.ts` adds the instant and write id every line carries. A key that
 * fails the shape fails the LINE: a move is only ever acted on whole.
 */
export const CARD_MOVE_FIELDS = {
  disposition: z.enum(["moved-on", "come-back"]),
  fromCardKey: z.string().regex(CARD_KEY),
  // When the card the owner left became the walk's card: their words over it are read from here to the move.
  fromSinceIso: iso,
  kind: z.literal("card-move"),
  // The `open_card` call's own token, which names the move: a batch posted twice is still one move.
  requestId: z.string().min(1).max(200),
  toCardKey: z.string().regex(CARD_KEY),
};
