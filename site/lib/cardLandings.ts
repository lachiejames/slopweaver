/**
 * The queue's spoken-steer overlay — pure: rows and the `talk cards` reading in, the rows still the owner's to look at out.
 *
 * Every word the owner says while a card is open lands on that card, relayed or not: a card steered earlier
 * must not show up unchanged later. A card their words landed on needs a session acting on what they said, not
 * their attention again, so it is not drawn.
 * Words land only when the voice judged them an answer to the card
 * (`src/talk/cardUtterance.ts`), and a hand step is never held off by any ({@link landingVerdict}). The Queue walk
 * moving on from a card holds it off too, unless the owner said to come back to it
 * (`src/talk/cardMove.ts`).
 * The north star — productivity per unit of the owner's attention — is why the queue and the voice's
 * `action_items` both run through this one function: a card the owner already steered is not worth looking at on
 * either surface.
 *
 * ## An overlay that has not arrived hides nothing, and SAYS so
 *
 * Until `talk cards` reads, every card is drawn, which is the page without the overlay; the gap
 * is named rather than hidden, so a card the owner steered showing for a few seconds is explained. A reading with lines
 * the verb could not decode is used for what it did read, and named the same way.
 */

import type { CardLanding, CardLandings, CardMove, TriageMark } from "../components/live/readCardLandings";
import type { LiveState } from "../components/live/useLive";
import { CARD_KEY } from "./cardKey";
import type { SteerOverlay } from "./steeredCards";
import { parksTheCard } from "./triageWords";

/** What the overlay is called wherever the page names a source that has not fully arrived. */
export const SPOKEN_STEERS = "your spoken steers";

/** What a row carries that the overlay reads: its key, and the instant before which no landing holds it. */
export interface LandedRow {
  readonly key: string;
  /**
   * A landing decided before this instant does not hold the card: the card has news since the owner spoke — an ask asked
   * again, or a held post's hold or change of meaning recorded after their words (`./queueRows.ts`). Absent: every
   * landing holds it.
   */
  readonly landingFloorIso?: string;
  /** When the card's own subject last changed (`./queueRows.ts`), which frees it from an older move off it. */
  readonly currencyFloorIso?: string | undefined;
}

/**
 * What the overlay makes of one row: drawn, kept off the owner's list, drawn as the recut a seat is making of it, or drawn
 * parked below the rest because the owner's triage ruling parked it.
 */
export type LandingVerdict =
  | { readonly kind: "shown" }
  | { readonly kind: "hidden" }
  /**
   * `seat`: the in-flight board row the owner's steer's landing names as the work — a slug, never a session id. `triage`: the
   * owner's ruling, when the landing carried one, so the recut still says what they made of the card.
   */
  | { readonly kind: "recut"; readonly seat: string; readonly triage?: TriageMark }
  /** `sinceIso`: when the owner parked it, which orders it among the cards put off. */
  | { readonly kind: "parked"; readonly sinceIso: string; readonly triage: TriageMark };

/** What a row carries once the overlay has marked it: when it was put off, and the owner's triage ruling on it. */
export interface MarkedRow {
  readonly deferredIso?: string;
  /** The owner's triage ruling, from the landing it made; absent on a card they have not ruled. */
  readonly triage?: TriageMark;
}

/**
 * A row parked by the owner's triage ruling, drawn below the rest with the ruling on it. A card already put off keeps
 * its own earlier instant, so parking it again never moves it up.
 *
 * @param row the row the owner's ruling parked
 * @param sinceIso when the owner parked it
 * @param triage the owner's ruling
 * @returns the row, put off and marked
 */
export function parkedRow<Row extends MarkedRow>({
  row,
  sinceIso,
  triage,
}: {
  row: Row;
  sinceIso: string;
  triage: TriageMark;
}): Row {
  if (row.deferredIso !== undefined && row.deferredIso.localeCompare(sinceIso) <= 0) {
    return { ...row, triage };
  }
  return { ...row, deferredIso: sinceIso, triage };
}

/**
 * Every landing in the reading, by card, in the order the verb printed them.
 *
 * @param spoken the `talk cards` reading
 * @returns card key → its landings; empty until the reading is ready
 */
export function landingsByCard({
  spoken,
}: {
  spoken: LiveState<CardLandings>;
}): ReadonlyMap<string, readonly CardLanding[]> {
  const byCard = new Map<string, CardLanding[]>();
  if (spoken.phase !== "ready") {
    return byCard;
  }
  for (const landing of spoken.value.landings) {
    const list = byCard.get(landing.cardKey);
    if (list === undefined) {
      byCard.set(landing.cardKey, [landing]);
    } else {
      list.push(landing);
    }
  }
  return byCard;
}

/**
 * Whether one landing on a row's card holds it: decided at or after the row's floor, or the row has none. Against a
 * floor, an instant that does not parse holds nothing — the card is drawn rather than hidden on a clock nobody can
 * read (`talk cards` refuses one at write, so only a hand-edited line reaches here).
 *
 * @param landing a landing on its card
 * @returns whether that landing keeps the card off the owner's list
 */
export function landingHolds({ landing, row }: { landing: CardLanding; row: LandedRow }): boolean {
  if (row.landingFloorIso === undefined) {
    return true;
  }
  return Date.parse(landing.decidedIso) >= Date.parse(row.landingFloorIso);
}

/**
 * Every move of the Queue walk in the reading, by the card it moved on from.
 *
 * @param spoken the `talk cards` reading
 * @returns card key → the moves off it; empty until the reading is ready
 */
export function movesByCard({ spoken }: { spoken: LiveState<CardLandings> }): ReadonlyMap<string, readonly CardMove[]> {
  const byCard = new Map<string, CardMove[]>();
  if (spoken.phase !== "ready") {
    return byCard;
  }
  for (const move of spoken.value.moves) {
    const list = byCard.get(move.cardKey);
    if (list === undefined) {
      byCard.set(move.cardKey, [move]);
    } else {
      list.push(move);
    }
  }
  return byCard;
}

/**
 * Whether one move off a row's card holds it. A move is weaker than a landing — the owner walked past, they did not
 * answer — so ANY news since frees the card: the landing floor (an ask asked again), and for every card but an ask the
 * row's currency floor too, which is how a pull request, draft, post or review says it changed (a pull request moved
 * past must not stay hidden through a new review). An ask's currency floor is not news here, because a
 * supervisor's re-confirm moves it, and a sweep re-confirming would undo every move the owner made.
 *
 * @param move a move off the row's card
 * @param row the row, whose floors free it from an older move
 * @returns whether it keeps the card off the owner's list
 */
export function moveHolds({ move, row }: { move: CardMove; row: LandedRow }): boolean {
  const floors = [row.landingFloorIso];
  if (!row.key.startsWith("ask:")) {
    floors.push(row.currencyFloorIso);
  }
  const decided = Date.parse(move.decidedIso);
  return floors.every((floor) => floor === undefined || decided >= Date.parse(floor));
}

/**
 * The newest landing on a row's card decided at or after the row's floor.
 *
 * @param landings the card's landings; undefined when the owner has none on it
 * @returns that landing, or `undefined` when none holds the row
 */
function newestHolding({
  landings,
  row,
}: {
  landings: readonly CardLanding[] | undefined;
  row: LandedRow;
}): CardLanding | undefined {
  if (landings === undefined) {
    return undefined;
  }
  return landings
    .filter((landing) => landingHolds({ landing, row }))
    .reduce<CardLanding | undefined>(
      (latest, landing) =>
        latest === undefined || Date.parse(landing.decidedIso) >= Date.parse(latest.decidedIso) ? landing : latest,
      undefined,
    );
}

/**
 * What the overlay makes of one row. The owner's newest landing decided at or after the row's floor carrying their triage
 * park outranks everything: the card is still theirs, parked below the rest. Otherwise the page's own collapse decides: a
 * steer still waiting keeps the card out, a steer that came back puts it in. Then that newest landing: none, and the
 * card is the owner's to look at; one whose work is a row a session is running now, and the card is that recut; otherwise
 * the card waits on a session acting on what the owner said, so it is not drawn.
 *
 * A park is drawn rather than hidden because a parked card waits on the OWNER, at a working session or the slow triage
 * hour, not on a session — hidden, it would be a card gone until the chair ran `talk restore` and `queue defer` by hand.
 * It outranks a waiting steer because a steer is dated by when its relay reached the page, not when the owner spoke
 * it, so it cannot say whether it was spoken before the park or after. A steer spoken after the park moves the card
 * once its own landing, dated by when the owner spoke, is the newer one. A park older than the row's floor holds
 * nothing, as any landing does: the card came back since.
 *
 * MEASURED, 98 cards: 22 were drawn after the owner had steered on them, 21 of them held posts whose
 * hold drew them past every landing whatever its age (the audit: `slopweaver handover row --slug
 * queue-audit-22-stale-cards-14-oct`).
 *
 * A card the Queue walk moved on from is hidden after a park and the hand/import rule, and before every steer: the
 * owner moved past it, whatever a steer on it did.
 *
 * @param landings the row's card's landings, from {@link landingsByCard}; undefined when the owner has none on it
 * @param moves the walk's moves off the row's card, from {@link movesByCard}; undefined when there are none
 * @param steers the steers' overlay
 * @param inFlight the slugs of every board row a session is running now — empty where a surface reads no board
 * @returns the verdict
 */
export function landingVerdict({
  inFlight,
  landings,
  moves,
  row,
  steers,
}: {
  inFlight: ReadonlySet<string>;
  landings: readonly CardLanding[] | undefined;
  moves: readonly CardMove[] | undefined;
  row: LandedRow;
  steers: Pick<SteerOverlay, "hidden" | "revealed">;
}): LandingVerdict {
  const newest = newestHolding({ landings, row });
  // A park waits on the OWNER whichever session runs its row, so it outranks the recut and every steer the page holds:
  // every surface draws it parked.
  if (newest?.triage !== undefined && parksTheCard({ verdict: newest.triage.verdict })) {
    return { kind: "parked", sinceIso: newest.decidedIso, triage: newest.triage };
  }
  // A hand step settles when it is done, never on words said with it open, so no landing or steer holds it — the
  // ledger's older ones included, written before the voice judged what the owner's words answer (a greeting had taken
  // a Twilio step off the Queue, its paste fields dead).
  // A staged import question likewise settles only when `store import-resolve` answers it in the store, so no landing
  // or steer keeps it off the owner's list while the register still holds it.
  if (row.key.startsWith("hand:") || row.key.startsWith("import:")) {
    return { kind: "shown" };
  }
  // The Queue walk moved on from it: off the owner's list until a restore, unless the card has
  // news since — the floor that frees it from an older landing frees it from an older move too.
  if (moves?.some((move) => moveHolds({ move, row })) === true) {
    return { kind: "hidden" };
  }
  if (steers.hidden.has(row.key)) {
    return { kind: "hidden" };
  }
  if (steers.revealed.has(row.key)) {
    return { kind: "shown" };
  }
  if (newest === undefined) {
    return { kind: "shown" };
  }
  if (inFlight.has(newest.workSlug)) {
    return newest.triage === undefined
      ? { kind: "recut", seat: newest.workSlug }
      : { kind: "recut", seat: newest.workSlug, triage: newest.triage };
  }
  return { kind: "hidden" };
}

/**
 * The rows the owner's words have not landed on, with the steers this page collapsed laid over them: a card under a
 * steer still waiting is out before its landing has even been read, and a card a steer came back on is in although
 * its landing still holds it (`./steeredCards.ts`). A card whose recut is in flight is left out too — this is the
 * voice's list, and a recut is a session's to finish; the Queue draws it ({@link landingVerdict}). A card the owner parked
 * stays, put off and marked ({@link parkedRow}), exactly as the Queue draws it, so the voice reads it as parked.
 *
 * @param rows the rows a page would draw
 * @param spoken the `talk cards` reading
 * @param steers the steers' overlay — `NO_STEERS` where a surface has none
 * @returns the rows, less every card an active landing or a waiting steer holds, plus every card a steer gave back
 */
export function unlandedRows<Row extends LandedRow & MarkedRow>({
  rows,
  spoken,
  steers,
}: {
  rows: readonly Row[];
  spoken: LiveState<CardLandings>;
  steers: Pick<SteerOverlay, "hidden" | "revealed">;
}): readonly Row[] {
  const byCard = landingsByCard({ spoken });
  const moved = movesByCard({ spoken });
  if (byCard.size === 0 && moved.size === 0 && steers.hidden.size === 0) {
    return rows;
  }
  const inFlight: ReadonlySet<string> = new Set();
  return rows.flatMap((row) => {
    const verdict = landingVerdict({ inFlight, landings: byCard.get(row.key), moves: moved.get(row.key), row, steers });
    if (verdict.kind === "parked") {
      return [parkedRow({ row, sinceIso: verdict.sinceIso, triage: verdict.triage })];
    }
    return verdict.kind === "shown" ? [row] : [];
  });
}

/**
 * The ledger lines the verb could not read that may hold one of these cards: every line recording no card key, and
 * every line recording one of them. A recorded key that is no card key names no card any surface draws, so it holds
 * none of them — MEASURED, 15 of the 18 lines a one-off sanitiser broke were that shape, and the voice said "some recorded
 * steers were unreadable" over a card none of the 18 was about (`src/talk/cardLedgerFile.ts`).
 *
 * @param spoken the `talk cards` reading, ready
 * @param cardKeys the cards the surface draws or reads
 * @returns how many such lines there are
 */
function unreadLinesFor({ spoken, cardKeys }: { spoken: CardLandings; cardKeys: ReadonlySet<string> }): number {
  return spoken.unreadableLines.filter(
    (line) => line.cardKey === undefined || (CARD_KEY.test(line.cardKey) && cardKeys.has(line.cardKey)),
  ).length;
}

/**
 * Why the overlay is not the whole picture for a surface drawing or reading these cards, or `undefined` when it is. A
 * relay line that did not read carries no card, so it is a gap on every surface.
 *
 * @param spoken the `talk cards` reading
 * @param cardKeys the cards the surface draws or reads: a ledger line about any other card is no gap here
 * @returns `loading`, the reason it was not measured, or how many ledger lines that bear on these cards did not read
 */
export function spokenGap({
  spoken,
  cardKeys,
}: {
  spoken: LiveState<CardLandings>;
  cardKeys: ReadonlySet<string>;
}): string | undefined {
  if (spoken.phase === "loading") {
    return "still loading";
  }
  if (spoken.phase === "not-measured") {
    return spoken.why;
  }
  const gaps: string[] = [];
  const unread = unreadLinesFor({ cardKeys, spoken: spoken.value });
  if (unread > 0) {
    gaps.push(`${String(unread)} landing line(s) did not read, so a card you steered may still show`);
  }
  if (spoken.value.triageUnreadable > 0) {
    gaps.push(
      `${String(spoken.value.triageUnreadable)} relay line(s) did not read, so a card you parked may not show as parked`,
    );
  }
  return gaps.length === 0 ? undefined : gaps.join("; ");
}
