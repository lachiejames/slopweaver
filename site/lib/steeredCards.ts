/**
 * A card the owner has just steered on — pure: the steers this page collapsed and the `talk steers` reading in, what
 * the Queue hides, says of a card that left, and brings back out.
 *
 * The card the owner is steering on collapses and leaves the list the moment they speak, so it feels heard; but a
 * card that looks worked on when it is not erodes trust in the system. So the collapse is OPTIMISTIC and
 * ACCOUNTABLE: a card it took off says, opened, which relay holds it (`./cardDeparture.ts`), and a steer the chair
 * did not act on puts its card back in the list.
 *
 * ## Why one came back is the chair's to read, never the owner's page's
 *
 * A "Not recorded — the relay was refused" banner under the owner's last card costs them confidence. So a steer that
 * comes back draws nothing: its card is simply in the list again. The chair already holds
 * why — it reads every word of the owner's off the call file with the relay outcome beside it (`talk unread`), and a
 * tick is refused over a registered steer nothing acted on (`src/supervisor/unpickedSteerGate.ts`).
 *
 * ## A hiccup is not a re-ask
 *
 * An owner who has already given a steer is never asked the same thing twice, and a visual indicator that the thing
 * they asked for is being worked on but ran into a transient issue is useful to surface. So a record that cannot be READ — the verb erroring, a journal or tick
 * ledger that did not read — keeps the card collapsed while the poll retries, for as long as it lasts, and never
 * brings the card back to be asked again. Only a hard outcome re-opens it: the relay
 * refused, no relay row at all, no landing, or the chair passing it by — there nothing is being worked on.
 *
 * ## Which steers, and only those
 *
 * Only a steer THIS page sent over the card that was open as it sent, and that the relay named — never a relay that
 * names no card, and never an older relay landing replayed from the ledger. Over one measured window, 59 of
 * 124 card-landed relays had no evidence of action at all; bringing them all back retroactively would flood the Queue
 * with cards the owner steered days ago, so the revert covers only what the page itself collapsed.
 *
 * ## The clock restated here
 *
 * {@link REGISTER_GRACE_MS} restates `src/talk/steeredCards.ts`'s `LANDING_GRACE_MS`, which `site/` cannot import:
 * the verb judges a registered relay, this judges one the verb never saw.
 */

import type { CardLandings } from "../components/live/readCardLandings";
import type { ServerSteer, SteeredCardsReading } from "../components/live/readSteeredCards";
import type { LiveState } from "../components/live/useLive";
import { isBag } from "./bag";
import { CARD_KEY } from "./cardKey";
import { prCardKeyParts } from "./prCardKey";
import { parksTheCard, type TriageVerdict, triageVerdictOf } from "./triageWords";

/** How long a sent steer may go unseen by `talk steers` before it is read as never recorded. */
export const REGISTER_GRACE_MS = 2 * 60_000;

/** How much of what the owner said a steer keeps. */
const HEARD_CLIP = 140;

/** The card kinds no register holds — `src/talk/cardKey.ts`'s `UNHELD_KINDS`, restated. */
const UNHELD = ["recipe:", "align:", "candidate:"] as const;

/**
 * Whether a key names one card: a card key, and a pull request's only with its repository ({@link prCardKeyParts}) —
 * a bare `pr:<number>` is whichever repository's pull request shared the number.
 */
function namesOneCard({ key }: { key: string }): boolean {
  return CARD_KEY.test(key) && (!key.startsWith("pr:") || prCardKeyParts({ key }) !== undefined);
}

/** What the relay itself said came of the post, from the voice's own relay line. */
export type SteerSendOutcome = "sending" | "relayed" | "refused" | "unknown";

/** One steer this page collapsed a card on. */
export interface LocalSteer {
  readonly turnId: string;
  readonly cardKey: string;
  readonly heard: string;
  readonly sentAtIso: string;
  readonly outcome: SteerSendOutcome;
  /** The relay line's own detail — the refusal's reason when it was refused. */
  readonly detail: string;
  /**
   * The owner's triage verdict, when the relay carried one. A park never collapses its card: the card stays theirs, and the Queue
   * draws it parked once the landing reads (`./cardLandings.ts`). Absent on every other steer, and on one stored before
   * the field existed.
   */
  readonly triageVerdict?: TriageVerdict;
}

/** One steer still holding its card off the Queue. */
export interface SteerRow {
  readonly turnId: string;
  readonly cardKey: string;
  readonly heard: string;
  readonly sentAtIso: string;
  /** The relay's board row once the verb has seen it registered, else `undefined`. */
  readonly relaySlug: string | undefined;
}

/** What the steers do to the Queue. */
export interface SteerOverlay {
  /**
   * Steers still waiting — every one, including one whose card another steer that came back put in the list.
   */
  readonly collapsed: readonly SteerRow[];
  /** Card keys out of the list. */
  readonly hidden: ReadonlySet<string>;
  /** Card keys back in the list even though a landing still holds them — the landing is the steer that failed. */
  readonly revealed: ReadonlySet<string>;
  /** Card keys a steer came back on that another landing still keeps off the list. */
  readonly stillHeld: ReadonlySet<string>;
  /**
   * Every steer that came back, by card and turn: on that card, a landing carrying its `talk:<turnId>` anchor is the
   * steer that failed rather than what holds the card off the list now (`./cardDeparture.ts`). When the owner spoke it bounds
   * when a later collapse hid the card again (`./recentQueueDepartures.ts`).
   */
  readonly cameBack: readonly { readonly cardKey: string; readonly turnId: string; readonly sentAtIso: string }[];
  /**
   * Steers the store forgets: one something acted on, for good, and one that came back once no
   * landing still holds its card. Never a count or an age — a steer dropped while its landing still held the card
   * would leave that card hidden on nothing.
   */
  readonly forgotten: readonly string[];
}

/** The overlay with nothing collapsed. */
export const NO_STEERS: SteerOverlay = {
  cameBack: [],
  collapsed: [],
  hidden: new Set(),
  revealed: new Set(),
  forgotten: [],
  stillHeld: new Set(),
};

/** One relay line, as much of it as a steer needs. */
export interface SteerLine {
  readonly turnId: string | undefined;
  readonly heard: string;
  readonly about: string;
  readonly outcome: "sending" | "relayed" | "board-only" | "shut" | "refused" | "unknown";
  readonly detail: string;
  readonly triageVerdict?: TriageVerdict;
}

/**
 * Fold one relay line into the held steers. A new steer is taken only from the line that starts a relay, about the
 * card open as it was sent — so a check-in walked hands-free, a relay about nothing, or speech begun over another
 * card collapses nothing. A later line of the same turn updates the outcome and nothing else.
 *
 * @param held the steers held now
 * @param line the relay line the voice just recorded
 * @param openCard the card open on the page as the line was recorded, when one is
 * @param atIso when the line was recorded
 * @returns the steers, unchanged when the line is not one
 */
export function steersWithLine({
  held,
  line,
  openCard,
  atIso,
}: {
  held: readonly LocalSteer[];
  line: SteerLine;
  openCard: string | undefined;
  atIso: string;
}): readonly LocalSteer[] {
  const { turnId } = line;
  if (turnId === undefined || line.outcome === "shut") {
    return held;
  }
  const outcome: SteerSendOutcome = line.outcome === "board-only" ? "relayed" : line.outcome;
  const known = held.find((steer) => steer.turnId === turnId);
  if (known !== undefined) {
    return held.map((steer) => (steer.turnId === turnId ? { ...steer, detail: line.detail, outcome } : steer));
  }
  // An Automations `recipe:` card, an Alignment `align:` question and a Workstreams `candidate:` are held by no
  // register, so nothing collapses.
  const queueCard = namesOneCard({ key: line.about }) && !UNHELD.some((kind) => line.about.startsWith(kind));
  if (line.outcome !== "sending" || !queueCard || line.about !== openCard) {
    return held;
  }
  const steer: LocalSteer = {
    cardKey: line.about,
    detail: line.detail,
    heard: line.heard.slice(0, HEARD_CLIP),
    outcome,
    sentAtIso: atIso,
    turnId,
  };
  return [...held, line.triageVerdict === undefined ? steer : { ...steer, triageVerdict: line.triageVerdict }];
}

/**
 * The steers still worth holding: every one the overlay has not forgotten.
 *
 * @param held the steers held now
 * @param forgotten turn ids the overlay forgot
 * @returns the steers kept
 */
export function keptSteers({
  held,
  forgotten,
}: {
  held: readonly LocalSteer[];
  forgotten: readonly string[];
}): readonly LocalSteer[] {
  const gone = new Set(forgotten);
  return held.filter((steer) => !gone.has(steer.turnId));
}

/**
 * What a window whose storage refused a write holds once another window's write arrives: every steer either
 * holds, this window's own copy winning, so a steer only this window knows of is never dropped by a write that
 * never saw it.
 *
 * @param mine the steers this window holds
 * @param stored what storage holds now
 * @returns the union, in the order first seen
 */
export function mergedSteers({
  mine,
  stored,
}: {
  mine: readonly LocalSteer[];
  stored: readonly LocalSteer[];
}): readonly LocalSteer[] {
  const known = new Set(mine.map((steer) => steer.turnId));
  return [...mine, ...stored.filter((steer) => !known.has(steer.turnId))];
}

/**
 * What a change to the held steers starts from: what storage holds now, so the other window's write a moment ago is
 * not overwritten by this window's older copy. A window whose last write was refused merges rather than adopts, since
 * the other window's storage event may not have reached it yet and its own copy holds steers storage never saw;
 * storage that does not read leaves this window's copy.
 *
 * @param keeping whether this window's last write reached storage
 * @param mine the steers this window holds
 * @param stored what storage holds now, `undefined` when it does not read
 * @returns the steers to apply the change to
 */
export function mutationBase({
  keeping,
  mine,
  stored,
}: {
  keeping: "shared" | "this-window";
  mine: readonly LocalSteer[];
  stored: readonly LocalSteer[] | undefined;
}): readonly LocalSteer[] {
  if (stored === undefined) {
    return mine;
  }
  return keeping === "shared" ? stored : mergedSteers({ mine, stored });
}

/**
 * Read the held steers back from storage. Strict: one entry off shape refuses the whole list, because a guessed
 * steer is a card hidden on nothing.
 *
 * @param raw the stored text, `null` when nothing was stored
 * @returns the steers, `[]` for nothing stored, or `undefined` when the text does not read
 */
export function parseStoredSteers({ raw }: { raw: string | null }): readonly LocalSteer[] | undefined {
  if (raw === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    return undefined;
  }
  const steers: LocalSteer[] = [];
  // A page holds one steer per turn, and forgets and merges by turn, so a list repeating one is off
  // shape: forgetting one would drop the other with it.
  const turns = new Set<string>();
  for (const entry of parsed) {
    const steer = storedSteerOf({ entry });
    if (steer === undefined || turns.has(steer.turnId)) {
      return undefined;
    }
    turns.add(steer.turnId);
    steers.push(steer);
  }
  return steers;
}

const SEND_OUTCOMES: ReadonlySet<string> = new Set<SteerSendOutcome>(["sending", "relayed", "refused", "unknown"]);

/** Whether a value is one of the relay outcomes a steer holds. */
function isSendOutcome(value: unknown): value is SteerSendOutcome {
  return typeof value === "string" && SEND_OUTCOMES.has(value);
}

/**
 * One stored steer.
 *
 * @param entry one element of the stored array
 * @returns the steer, or `undefined` when any field is off shape
 */
function storedSteerOf({ entry }: { entry: unknown }): LocalSteer | undefined {
  if (!isBag(entry)) {
    return undefined;
  }
  const { turnId, cardKey, heard, sentAtIso, outcome, detail } = entry;
  if (
    typeof turnId !== "string" ||
    typeof cardKey !== "string" ||
    !namesOneCard({ key: cardKey }) ||
    typeof heard !== "string" ||
    typeof sentAtIso !== "string" ||
    Number.isNaN(Date.parse(sentAtIso)) ||
    !isSendOutcome(outcome) ||
    typeof detail !== "string"
  ) {
    return undefined;
  }
  const steer: LocalSteer = { cardKey, detail, heard, outcome, sentAtIso, turnId };
  if (!("triageVerdict" in entry)) {
    return steer;
  }
  const triageVerdict = triageVerdictOf({ value: entry["triageVerdict"] });
  return triageVerdict === undefined ? undefined : { ...steer, triageVerdict };
}

/** What became of one held steer. */
type Judged =
  | { readonly kind: "settled" }
  | { readonly kind: "collapsed"; readonly server?: ServerSteer }
  | { readonly kind: "reverted" };

/**
 * What a steer the verb has judged comes to: still collapsed, settled, or back.
 *
 * @param server the verb's steer
 * @returns the judgement
 */
function judgedByServer({ server }: { server: ServerSteer }): Judged {
  const { verdict } = server;
  if (verdict.kind === "settled") {
    return { kind: "settled" };
  }
  // A hiccup, never a re-ask: the card stays collapsed for as long as the verdict cannot be read.
  if (verdict.kind === "awaiting" || verdict.kind === "unread") {
    return { kind: "collapsed", server };
  }
  // Kept, restored, never landed or passed by: the card is back, and why is the chair's to read.
  return { kind: "reverted" };
}

/**
 * Judge one held steer against the reading.
 *
 * @param steer the steer this page collapsed
 * @param reading the `talk steers` channel
 * @returns settled, still collapsed, or back
 */
function judgeSteer({ steer, reading }: { steer: LocalSteer; reading: LiveState<SteeredCardsReading> }): Judged {
  const sentMs = Date.parse(steer.sentAtIso);
  // Older than the window the verb judges: it ended long ago, and the landing alone decides the card, as on main. A
  // refused one too, so one whose card another landing holds is never kept in storage past the window.
  if (reading.phase === "ready" && sentMs < Date.parse(reading.value.sinceIso)) {
    return { kind: "settled" };
  }
  if (steer.outcome === "refused") {
    return { kind: "reverted" };
  }
  // Loading, or a reading that failed: a hiccup, so the card stays collapsed while the poll retries.
  if (reading.phase !== "ready") {
    return { kind: "collapsed" };
  }
  // Joined on the turn AND the card: a same-turn row naming another card is never this steer's evidence.
  const server = reading.value.steers.find((one) => one.turnId === steer.turnId && one.cardKey === steer.cardKey);
  if (server !== undefined) {
    return judgedByServer({ server });
  }
  const pastGrace = Date.parse(reading.observedAtIso) - sentMs >= REGISTER_GRACE_MS;
  // Absent from a reading taken after the grace, with every relay line read: the relay never registered a row. While
  // a relay line did not decode, its row may be that line — a hiccup rather than a refusal.
  if (pastGrace && reading.value.undecodedRelays === 0) {
    return { kind: "reverted" };
  }
  return { kind: "collapsed" };
}

/**
 * Whether a card a steer came back on may be drawn although a landing holds it: only when every active landing on
 * it carries THIS relay's `talk:<turnId>` anchor, as the first segment or a later one. Never by its work row, which
 * another relay landing on the same ask shares. A card another steer also landed on stays held.
 *
 * @param cardKey the card
 * @param turnId the steer's turn
 * @param spoken the `talk cards` reading
 * @returns whether to draw it
 */
function revealable({
  cardKey,
  turnId,
  spoken,
}: {
  cardKey: string;
  turnId: string;
  spoken: LiveState<CardLandings>;
}): boolean {
  if (spoken.phase !== "ready") {
    return true;
  }
  const anchor = `talk:${turnId}`;
  return spoken.value.landings
    .filter((landing) => landing.cardKey === cardKey)
    .every((landing) => landing.anchor === anchor || landing.laterAnchors?.includes(anchor) === true);
}

/**
 * What the held steers do to the Queue: a card under a waiting steer is out; a card a steer came back on is in,
 * saying nothing; a settled steer is forgotten, and so is one that came back once no landing holds its card. When two
 * steers name one card, the one the owner spoke last decides whether it shows, whatever order they are held in.
 *
 * @param held the steers this page collapsed
 * @param reading the `talk steers` channel
 * @param spoken the `talk cards` channel
 * @returns the overlay
 */
export function steerOverlay({
  held,
  reading,
  spoken,
}: {
  held: readonly LocalSteer[];
  reading: LiveState<SteeredCardsReading>;
  spoken: LiveState<CardLandings>;
}): SteerOverlay {
  const collapsed: SteerRow[] = [];
  const forgotten: string[] = [];
  const back = new Set<string>();
  const cameBack: { cardKey: string; turnId: string; sentAtIso: string }[] = [];
  const revealed = new Set<string>();
  // The owner's newest unsettled steer on a card, by when they spoke rather than where storage or a merge put it,
  // decides whether it shows: a card they steered again stays collapsed under the new steer, whatever an older one did.
  const newest = new Map<string, { sentMs: number; isCollapsed: boolean }>();
  for (const steer of held) {
    const judged = judgeSteer({ reading, steer });
    if (judged.kind === "settled") {
      forgotten.push(steer.turnId);
      continue;
    }
    // On a tie the one that came back wins, so neither order of two steers spoken in one instant hides the card. A
    // park waiting on its landing hides nothing: the card is still the owner's, and is drawn parked once the landing reads.
    // A card whose newest landing is a park is drawn parked whatever steer waits on it (`landingVerdict`).
    const sentMs = Date.parse(steer.sentAtIso);
    const parks = parksTheCard({ verdict: steer.triageVerdict });
    const isCollapsed = judged.kind === "collapsed" && !parks;
    const before = newest.get(steer.cardKey);
    const tiedBack = before?.sentMs === sentMs && !isCollapsed;
    if (before === undefined || sentMs > before.sentMs || tiedBack) {
      newest.set(steer.cardKey, { isCollapsed, sentMs });
    }
    if (judged.kind === "collapsed") {
      collapsed.push({
        cardKey: steer.cardKey,
        heard: steer.heard,
        relaySlug: judged.server?.relaySlug,
        sentAtIso: steer.sentAtIso,
        turnId: steer.turnId,
      });
      continue;
    }
    back.add(steer.cardKey);
    cameBack.push({ cardKey: steer.cardKey, sentAtIso: steer.sentAtIso, turnId: steer.turnId });
    if (revealable({ cardKey: steer.cardKey, spoken, turnId: steer.turnId })) {
      revealed.add(steer.cardKey);
    }
    if (spoken.phase === "ready" && !spoken.value.landings.some((landing) => landing.cardKey === steer.cardKey)) {
      forgotten.push(steer.turnId);
    }
  }
  const hidden = new Set([...newest].filter(([, one]) => one.isCollapsed).map(([cardKey]) => cardKey));
  const shown = new Set([...revealed].filter((cardKey) => !hidden.has(cardKey)));
  return {
    cameBack,
    collapsed,
    hidden,
    revealed: shown,
    forgotten,
    stillHeld: new Set([...back].filter((cardKey) => !shown.has(cardKey))),
  };
}

/**
 * Whether a steer this page sent still holds its card off the list on a guess: its relay has not answered and the
 * verb has not yet seen it registered, so a refusal would put the card back. Bounded by the overlay itself, since a
 * steer unseen past {@link REGISTER_GRACE_MS} is no longer collapsed, so a relay line that never answers cannot keep a
 * count waiting for ever.
 *
 * @param held the steers this page collapsed a card on
 * @param overlay what those steers do to the list now
 * @returns whether any such relay is in flight
 */
export function relayInFlightOf({
  held,
  overlay,
}: {
  held: readonly Pick<LocalSteer, "outcome" | "turnId">[];
  overlay: Pick<SteerOverlay, "collapsed">;
}): boolean {
  const sending = new Set(held.filter((steer) => steer.outcome === "sending").map((steer) => steer.turnId));
  return overlay.collapsed.some((row) => row.relaySlug === undefined && sending.has(row.turnId));
}
