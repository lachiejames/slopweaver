/**
 * The card scenarios of `desktop e2e --call`, planned per card: for each card named — by `--call-card`, or every open
 * Queue and Alignment card when it says `all` — `card-read` asks the LIVE CALL about it and `card-read-typed` asks the
 * TYPED MESSENGER the same words, each then challenged with the same typed push-back. Pure.
 *
 * The requirement: the voice and the typed messenger are each asked about every card, and what fails is seen on both
 * surfaces, never assumed the same, since typing and talking to ChatGPT give different answers. So the two scenarios differ ONLY in transport: the words, the challenge and the judge (`./cardFidelity.ts`) are one.
 */
import { CARD_KEY } from "../talk/cardKey.js";
import { NEXT_CARD_PHRASE } from "./e2eCallCardNext.js";
import { READING_HOLD_PHRASE } from "./e2eCallCardReadingHold.js";
import { cardIdWords, type E2eCallStep, type E2eCallStepId, typedMarker } from "./e2eCallPlan.js";

/**
 * The card scenarios, spoken first. `card-reading-hold` is the third, spoken too: it opens the card and says the owner is
 * still reading it, and its witness is that nothing moves the owner off it (`./e2eCallCardReadingHold.ts`).
 * `card-next` is the fourth: it opens the card, then asks for the next one, and its witness is that the walk leaves it
 * (`./e2eCallCardNext.ts`).
 */
export const CARD_STEP_IDS = ["card-read", "card-read-typed", "card-reading-hold", "card-next"] as const;

/** One card scenario's id. */
export type E2eCardStepId = (typeof CARD_STEP_IDS)[number];

/** Which cards the leg reads: none, the named ones, or every open card the console draws when the leg starts. */
export type E2eCardTargets =
  | { readonly kind: "none" }
  | { readonly kind: "named"; readonly keys: readonly string[] }
  | { readonly kind: "inventory" };

/**
 * How long one card scenario may take, from its start to its challenged answer: going live (spoken), the card read
 * and a first answer, the typed challenge, the card read again and a second answer. A judgement value.
 */
export const CARD_READ_CAP_MS = 300_000;

/**
 * The silence after `card-read`'s one saying. Longer than {@link CARD_READ_CAP_MS} on purpose: Chromium loops the
 * whole fake-microphone file, and a request heard again while the scenario still runs would be a second turn the
 * witness never asked for. The relation is the rule; the figure is a judgement value.
 */
const CARD_READ_SILENCE_MS = 360_000;

/**
 * Whether a card scenario id is one.
 *
 * @param id any call scenario id
 * @returns whether it reads a card
 */
export function isCardStepId({ id }: { id: string }): boolean {
  return (CARD_STEP_IDS as readonly string[]).includes(id);
}

/**
 * The page a card is drawn on, said the way the owner would: an `act:` row or an `align:` question is on the owner's
 * Alignment page, every other card on the owner's Queue (`site/lib/alignment.ts`).
 *
 * @returns `Queue` or `Alignment`
 */
export function cardPageWord({ cardKey }: { cardKey: string }): "Queue" | "Alignment" {
  return cardKey.startsWith("act:") || cardKey.startsWith("align:") ? "Alignment" : "Queue";
}

/**
 * The request both surfaces are asked, word for word: open the named card and say, in the card's own terms, what
 * problem it describes and what it asks the owner to decide. It carries NO challenge, which is typed only once the first
 * answer is in (`src/cli/commands/desktop/e2eCardReadScenario.ts`), and does not tell the surface to quote, read the
 * briefing or name what it has not checked: those are what the console's own lines must make it do unasked
 * (`src/talk/cardFidelityLines.ts`), so asking would test the harness rather than them.
 *
 * @param cardKey the card key, `<kind>:<id>`, this install's own state
 * @returns the words
 */
export function cardReadRequest({ cardKey }: { cardKey: string }): string {
  const page = cardPageWord({ cardKey });
  return (
    `This is an automated end to end test. Please open my ${page} card ${cardIdWords({ cardKey })} and tell me, ` +
    "in the card's own terms, what problem it describes and what it asks me to decide."
  );
}

/**
 * What `card-reading-hold`'s microphone says: open the named card, then the owner's own words once they had
 * it, which neither ask a question nor rule the card. Nothing past them is the owner's word on it, so the witness is
 * silence.
 *
 * @param cardKey the card key, `<kind>:<id>`, this install's own state
 * @returns the words
 */
export function cardReadingHoldRequest({ cardKey }: { cardKey: string }): string {
  const page = cardPageWord({ cardKey });
  return (
    `This is an automated end to end test. Please open my ${page} card ${cardIdWords({ cardKey })}. ` +
    `I only just started reading it, ${READING_HOLD_PHRASE}.`
  );
}

/**
 * The pause between `card-next`'s two sayings, written into the words as `say`'s own silence command, so the card is
 * open before the owner asks for the next one: a healthy `open_card` lands 10 to 15s after its ask on their calls. A judgement
 * value; were the card later, the ask would come first and the witness would wait out its cap rather than pass. Under
 * `say`'s ~65s cap on one silence (`src/cli/commands/desktop/e2eCallAudio.ts`); repro, printing `estimated duration:
 * 23.23…` for a 20s pause: `say -o /tmp/p.wav --file-format=WAVE --data-format=LEI16@48000 --channels=1 "Open the card.
 * [[slnc 20000]] All right, next card please." && afinfo /tmp/p.wav`.
 */
const CARD_NEXT_PAUSE_MS = 30_000;

/**
 * What `card-next`'s microphone says: open the named card, a pause `say` renders as silence, then the owner's words, which
 * ask for the next card and nothing else. The voice is often still saying the card when they land, the real
 * failure's own shape.
 *
 * @param cardKey the card key, `<kind>:<id>`, this install's own state
 * @returns the words, `say`'s silence command included
 */
export function cardNextRequest({ cardKey }: { cardKey: string }): string {
  const page = cardPageWord({ cardKey });
  return (
    `This is an automated end to end test. Please open my ${page} card ${cardIdWords({ cardKey })}. ` +
    `[[slnc ${String(CARD_NEXT_PAUSE_MS)}]] All right, ${NEXT_CARD_PHRASE}.`
  );
}

/**
 * The words one card scenario says.
 *
 * @param id the card scenario
 * @returns its microphone's words
 */
function cardPromptOf({ id, cardKey }: { id: E2eCardStepId; cardKey: string }): string {
  if (id === "card-reading-hold") {
    return cardReadingHoldRequest({ cardKey });
  }
  if (id === "card-next") {
    return cardNextRequest({ cardKey });
  }
  return cardReadRequest({ cardKey });
}

/**
 * What the typed surface is sent: the run's marker, then the request word for word, so the typed turn is found by its
 * marker and the words compared across surfaces are the same.
 *
 * @param nonce the run's own token
 * @returns the message
 */
export function typedCardReadRequest({ cardKey, nonce }: { cardKey: string; nonce: string }): string {
  return `${typedMarker({ nonce })}: ${cardReadRequest({ cardKey })}`;
}

/**
 * The card scenarios for a list of cards: each card spoken then typed, in the list's order, keeping only the
 * surfaces asked for.
 *
 * @param cardKeys the cards, each already a valid key
 * @param surfaces which of the two scenarios to place
 * @returns the steps
 */
export function cardReadSteps({
  cardKeys,
  surfaces,
}: {
  cardKeys: readonly string[];
  surfaces: readonly E2eCardStepId[];
}): readonly E2eCallStep[] {
  return cardKeys.flatMap((cardKey) =>
    CARD_STEP_IDS.filter((id) => surfaces.includes(id)).map((id): E2eCallStep => ({
      capMs: CARD_READ_CAP_MS,
      cardKey,
      holdMs: 0,
      id,
      kind: "call",
      prompt: cardPromptOf({ cardKey, id }),
      silenceMs: CARD_READ_SILENCE_MS,
    })),
  );
}

/**
 * Place card steps among the leg's others, where `CALL_STEP_IDS` orders them: before the first scenario that comes
 * after them, else at the end.
 *
 * @param calls the leg's other scenarios, in order
 * @param cards the card scenarios
 * @param order every call scenario id in leg order
 * @returns the whole leg
 */
export function placeCardSteps({
  calls,
  cards,
  order,
}: {
  calls: readonly E2eCallStep[];
  cards: readonly E2eCallStep[];
  order: readonly E2eCallStepId[];
}): readonly E2eCallStep[] {
  const after = order.indexOf(CARD_STEP_IDS.at(-1)!);
  const at = calls.findIndex((step) => order.indexOf(step.id) > after);
  if (at === -1) {
    return [...calls, ...cards];
  }
  return [...calls.slice(0, at), ...cards, ...calls.slice(at)];
}

/** Why a `--call-card` value was refused. */
export interface CardTargetsRefusal {
  readonly invalid: readonly string[];
}

/**
 * Read `--call-card`'s value: `all`, or a comma-separated list of card keys, each exactly as the console names it and
 * of a kind a card tool can be asked about — a register's, or an Alignment question (`align:`). An Automations
 * recipe or a proposed workstream is no card either surface is asked about.
 *
 * @param text the flag's value
 * @returns the targets, or the keys refused
 */
export function cardTargetsOf({ text }: { text: string }): E2eCardTargets | CardTargetsRefusal {
  if (text === "all") {
    return { kind: "inventory" };
  }
  const keys = [...new Set(text.split(",").map((key) => key.trim()))].filter((key) => key !== "");
  const invalid = keys.filter(
    (key) => !CARD_KEY.test(key) || key.startsWith("recipe:") || key.startsWith("candidate:"),
  );
  if (keys.length === 0 || invalid.length > 0) {
    return { invalid: keys.length === 0 ? [text] : invalid };
  }
  return { keys, kind: "named" };
}
