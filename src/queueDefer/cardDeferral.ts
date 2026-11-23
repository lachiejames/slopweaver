/**
 * A Queue card the owner put off: the row one "Come back to it" press writes, and the fold the Queue page orders by.
 *
 * A card at the top of the Queue may be one the owner cannot look at right now. So one press records that the owner
 * deferred it, and the page draws every deferred card below the ones not deferred. Nothing else changes: no
 * deadline, no reminder, the card stays on the Queue in its own tier, and the answered-or-not accounting counts it
 * exactly as before. The order is DERIVED from these rows on every read, never a rank somebody set.
 *
 * Append-only, newest row per card wins: a `restore` puts the card back in its place, and a later `defer` steps it
 * aside again, oldest deferral first so the card put off longest is the first the owner meets on coming back.
 */
import { z } from "zod";

import { CARD_KEY } from "../talk/cardKey.js";
import type { CardWalkMove } from "../talk/cardMove.js";
import { prCardKeyParts } from "../talk/prCardKey.js";

/**
 * The registers a Queue card can come from. `act:` is the Alignment page's and `recipe:`/`align:` are held by no
 * register, so none of them is on the owner's Queue to be put off. `QUEUE_KINDS` (`../hand/consoleLinkNames.ts`) names the
 * same seven beside `act`; `unit/queueDefer/cardDeferral.test.ts` holds the two together.
 */
export const DEFERRABLE_KINDS = ["hand", "ask", "draft", "post", "review", "import", "pr"] as const;

/** One register a deferrable card comes from. */
type DeferrableKind = (typeof DEFERRABLE_KINDS)[number];

/** What one press did: stepped the card aside, or put it back. */
type DeferralAction = "defer" | "restore";

/** One press, as the ledger holds it. */
export interface CardDeferralRow {
  /** `<kind>:<id>`, the key the Queue's `?open=` names. */
  readonly cardKey: string;
  readonly action: DeferralAction;
  readonly pressedIso: string;
  /** Who pressed: `work-console` for the page, else the session that ran the verb. */
  readonly bySession: string;
}

/** A card the owner has deferred and not since put back. */
export interface StandingDeferral {
  readonly cardKey: string;
  /** When the press that deferred it was made — the newest one, if it was deferred again after a restore. */
  readonly deferredIso: string;
}

const rowSchema = z
  .object({
    action: z.enum(["defer", "restore"]),
    bySession: z.string().min(1),
    cardKey: z.string().regex(CARD_KEY),
    pressedIso: z.iso.datetime(),
  })
  .strict();

/**
 * Whether a register's kind is one the owner's Queue draws and so one the owner can put off.
 *
 * @param kind the register named
 * @returns whether it is deferrable
 */
function isDeferrableKind(kind: string): kind is DeferrableKind {
  return (DEFERRABLE_KINDS as readonly string[]).includes(kind);
}

/**
 * The key one card is deferred under, or `undefined` when the kind is not a Queue register or the id would not make
 * a card key.
 *
 * @param kind the register the card comes from
 * @param id the card's id within that register
 * @returns the `<kind>:<id>` key, or `undefined`
 */
export function deferrableCardKey({ kind, id }: { kind: string; id: string }): string | undefined {
  if (!isDeferrableKind(kind)) {
    return undefined;
  }
  const key = `${kind}:${id}`;
  if (!CARD_KEY.test(key)) {
    return undefined;
  }
  // A pull request's card is keyed by repository and number; a deferral under a bare number would hide no card.
  if (kind === "pr" && prCardKeyParts({ key }) === undefined) {
    return undefined;
  }
  return key;
}

/**
 * Read one ledger line's value as a row.
 *
 * @param value one parsed JSON line
 * @returns the row, or `undefined` when it is not one — including a key naming no Queue register
 */
export function cardDeferralRowOf({ value }: { value: unknown }): CardDeferralRow | undefined {
  const parsed = rowSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  const colon = parsed.data.cardKey.indexOf(":");
  if (!isDeferrableKind(parsed.data.cardKey.slice(0, colon))) {
    return undefined;
  }
  return parsed.data;
}

/**
 * The deferral a "come back to it" said on a call writes for the card the walk left — the same row a press writes,
 * by the move's anchor rather than a session — or `undefined` when there is nothing to write: an ordinary move, a
 * card no Queue register holds, this move's deferral already on file, so a batch posted again never defers twice, or
 * a press on that card since the owner said it. The row is dated when the owner SAID it, never when it is written, so a
 * press after that instant outranks it in {@link standingDeferrals} even when a late retry appends it after the press.
 *
 * @param move the walk's move, folded from the call
 * @param rows every deferral row on file
 * @returns the row to append, or `undefined`
 */
export function voiceDeferralRow({
  move,
  rows,
}: {
  move: CardWalkMove;
  rows: readonly CardDeferralRow[];
}): CardDeferralRow | undefined {
  if (move.disposition !== "come-back") {
    return undefined;
  }
  const row = cardDeferralRowOf({
    value: { action: "defer", bySession: move.anchor, cardKey: move.fromCardKey, pressedIso: move.decidedIso },
  });
  if (row === undefined) {
    return undefined;
  }
  const written = rows.some((one) => one.bySession === move.anchor && one.cardKey === move.fromCardKey);
  // A press on that card at or after the owner said it — a restore above all — beats the come-back however late its
  // row is written: a first write that failed and is retried by the owed sweep would otherwise re-defer what the
  // owner put back.
  const decided = Date.parse(move.decidedIso);
  const pressedSince = rows.some((one) => one.cardKey === move.fromCardKey && Date.parse(one.pressedIso) >= decided);
  return written || pressedSince ? undefined : row;
}

/**
 * The cards the owner has deferred and not put back: per card the row with the latest `pressedIso` wins, so a come-back a
 * late retry appends after a newer press still loses to it. On a tie a restore beats a defer whichever was appended
 * first, and two rows of one action keep the later in file order. The standing ones are returned
 * oldest deferral first.
 *
 * @param rows every row the ledger holds, in file order
 * @returns the standing deferrals
 */
export function standingDeferrals({ rows }: { rows: readonly CardDeferralRow[] }): readonly StandingDeferral[] {
  const newest = new Map<string, CardDeferralRow>();
  for (const row of rows) {
    const held = newest.get(row.cardKey);
    if (held === undefined || outranks({ held, row })) {
      newest.set(row.cardKey, row);
    }
  }
  return [...newest.values()]
    .filter((row) => row.action === "defer")
    .map((row) => ({ cardKey: row.cardKey, deferredIso: row.pressedIso }))
    .toSorted((left, right) => left.deferredIso.localeCompare(right.deferredIso));
}

/**
 * Whether a row read later in the file replaces the one held for its card: a later press always, an earlier one never,
 * and at the same instant unless it is a defer over a restore.
 *
 * @param held the row standing so far
 * @param row the row read after it
 * @returns whether `row` stands instead
 */
function outranks({ held, row }: { held: CardDeferralRow; row: CardDeferralRow }): boolean {
  const heldMs = Date.parse(held.pressedIso);
  const rowMs = Date.parse(row.pressedIso);
  if (rowMs !== heldMs) {
    return rowMs > heldMs;
  }
  return !(held.action === "restore" && row.action === "defer");
}
