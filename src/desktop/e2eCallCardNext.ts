/**
 * Whether one call file holds `card-next`'s witness: the named card opened, a later final line of the owner's ending on
 * "next card please", and the walk then LEAVING that card — a `card-move` off it, or an `open_card` of another key —
 * inside a window counted from the owner's words. Pure; the drive is `src/cli/commands/desktop/e2eCallCardNextScenario.ts`.
 *
 * The requirement: when the owner asks for the next card, the current card comes down and leaves the queue. Measured
 * on a call that broke it: after the owner's final line the voice said "Pulling it up now. Okay, got it here." and
 * handed nothing over, and the `card-move` landed about 40 s later, only after the owner's own nudge. Repro: the
 * segment and tool lines in `$SLOPWEAVER_HOME/talk/calls/<call-id>.jsonl`.
 *
 * Structure only, never prose. It also says which path moved the owner, the voice's own hand-off or the console's walk start
 * (an `owed-start` line between the owner's words and the move), because the fix is the second and a pass by the first proves
 * the walk moves without proving the fallback fired.
 */
import type { CallEntry } from "../talk/callRecord.js";
import { CARD_KEY } from "../talk/cardKey.js";
import { isCardOpened } from "./e2eCallCardRead.js";
import { OWNER_SPEAKER } from "./e2eCallCardReadingHold.js";

/** The words the owner's microphone ends on, the owner's own phrasing bar the opening "All right". */
export const NEXT_CARD_PHRASE = "next card please";

/** The owner's line ENDS on the ask, a comma before "please" allowed, only marks after it. */
const ENDS_ON_NEXT_CARD = /next card,?\s+please[^\p{L}\p{M}\p{N}_]*$/u;

/**
 * How long the walk may take to leave the card once the owner has asked: the owed start's 2.5s window
 * (`PLAN_CALL_LIMITS.owedTurnStartMs`), then a thinking-model turn running `action_items` and `open_card`, with room.
 * A judgement value: over 25 of the owner's "next card" asks across the call files a healthy one moved in 1 to 14s,
 * and the stalled ones in 40s and 55s.
 */
export const CARD_NEXT_WINDOW_MS = 25_000;

/** The `owed-start` ending `owedStartLine` (`site/components/voice/planWiringLines.ts`) writes for the owner's next-card ask. */
const WALK_OWED_START = "they asked for the next card and no turn started during the owner's words";

/** Where one call stands against the witness. */
export type CardNextMove =
  | { readonly kind: "waiting"; readonly reason: string }
  | { readonly kind: "moved"; readonly reason: string }
  | { readonly kind: "stuck"; readonly reason: string };

/**
 * The token an `open_card` that ran AND OPENED its card names first: its detail opens `<key>, card opened`, as
 * `openCardRun` (`site/components/voice/openCardRun.ts`) joins it. A `card refused` or `card skipped` outcome left the
 * old card in front of the owner, so it never matches. Whether the token is a card key is
 * {@link CARD_KEY}'s call.
 */
const OPENED_KEY = /^([^\s,]+), card opened(?:,|$)/u;

/**
 * Whether a line is the walk leaving the card: a `card-move` off it, or an `open_card` that ran and OPENED another key.
 * A detail naming no valid card key, or one whose card did not open, is never a move, so neither can pass the scenario.
 *
 * @param cardKey the card the owner asked to leave
 * @returns whether it is
 */
function leaves({ entry, cardKey }: { entry: CallEntry; cardKey: string }): boolean {
  if (entry.kind === "card-move") {
    // Onto another card: the schema does not forbid a move from a card to itself.
    return entry.fromCardKey === cardKey && entry.toCardKey !== cardKey;
  }
  if (entry.kind !== "tool" || entry.refused || entry.name !== "open_card") {
    return false;
  }
  const opened = OPENED_KEY.exec(entry.detail)?.[1];
  return opened !== undefined && CARD_KEY.test(opened) && opened !== cardKey;
}

/**
 * Whether a line is the owner's ask: a final line of theirs ending on "next card please".
 *
 * @returns whether it is
 */
function isAsk({ entry }: { entry: CallEntry }): boolean {
  return (
    entry.kind === "segment" &&
    entry.who === OWNER_SPEAKER &&
    entry.final &&
    ENDS_ON_NEXT_CARD.test(entry.text.toLowerCase())
  );
}

/**
 * One line, said in the reason a verdict carries.
 *
 * @returns the line's kind, instant and what it names
 */
function said({ entry }: { entry: CallEntry }): string {
  if (entry.kind === "card-move") {
    return `card-move at ${entry.atIso}: ${entry.fromCardKey} to ${entry.toCardKey}`;
  }
  if (entry.kind === "tool") {
    return `${entry.name} at ${entry.atIso}: ${entry.detail}`;
  }
  return `${entry.kind} at ${entry.atIso}`;
}

/**
 * Judge one call's lines against the witness at an instant.
 *
 * @param entries the call's lines, in file order
 * @param cardKey the Queue card key `--call-card` named
 * @param nowMs the instant judged at, which the window must have passed for a stall to count
 * @returns waiting while the card or their ask has not landed and the window is still open, moved on the first line
 *   leaving the card inside it, else stuck
 */
export function cardNextMove({
  entries,
  cardKey,
  nowMs,
}: {
  entries: readonly CallEntry[];
  cardKey: string;
  nowMs: number;
}): CardNextMove {
  // Instants give the order things happened in; the sort is stable, so a tie keeps file order (`./e2eCallCardRead.ts`).
  const ordered = entries.toSorted((a, b) => Date.parse(a.atIso) - Date.parse(b.atIso));
  // OPENED, never only read: a card read aloud was never put in front of the owner, so nothing after it takes it down. The scenario's own words ask the voice to open it.
  const witnessIndex = ordered.findIndex((entry) => isCardOpened({ cardKey, entry }));
  if (witnessIndex === -1) {
    return { kind: "waiting", reason: `${cardKey} has not been opened` };
  }
  const askOffset = ordered.slice(witnessIndex + 1).findIndex((entry) => isAsk({ entry }));
  if (askOffset === -1) {
    return { kind: "waiting", reason: `no final line of theirs after the card ends on "${NEXT_CARD_PHRASE}"` };
  }
  // Their FIRST ask only: a card that moves once they ask again is the stall itself, so a repeat ask closes the window.
  const askIndex = witnessIndex + 1 + askOffset;
  // Still UP when they asked: its latest opening before their words, with nothing taking it down since. A card the walk
  // already left is not their complaint, and a later move would take down some other card.
  const lastOpen = ordered.slice(0, askIndex).findLastIndex((entry) => isCardOpened({ cardKey, entry }));
  if (ordered.slice(lastOpen + 1, askIndex).some((entry) => leaves({ cardKey, entry }))) {
    return { kind: "waiting", reason: `${cardKey} was taken down before their ask, so it was not up when they asked` };
  }
  const askMs = Date.parse(ordered[askIndex]!.atIso);
  // After their line by sorted POSITION, so a move sharing that line's instant but written after it counts: a strict
  // "later instant" test would drop exactly that move, as `./e2eCallCardReadingHold.ts` also holds.
  const after = ordered.slice(askIndex + 1);
  const repeat = after.findIndex((entry) => isAsk({ entry }));
  const beforeRepeat = repeat === -1 ? after : after.slice(0, repeat);
  const inWindow = beforeRepeat.filter((entry) => Date.parse(entry.atIso) < askMs + CARD_NEXT_WINDOW_MS);
  const moveOffset = inWindow.findIndex((entry) => leaves({ cardKey, entry }));
  if (moveOffset !== -1) {
    const move = inWindow[moveOffset]!;
    const walkStarted = inWindow
      .slice(0, moveOffset)
      .some((entry) => entry.kind === "tool" && entry.name === "owed-start" && entry.detail.endsWith(WALK_OWED_START));
    const by = walkStarted ? "the console's walk start" : "the voice's own hand-off";
    const afterS = ((Date.parse(move.atIso) - askMs) / 1000).toFixed(1);
    return { kind: "moved", reason: `${said({ entry: move })}, ${afterS}s after their ask, by ${by}` };
  }
  if (nowMs < askMs + CARD_NEXT_WINDOW_MS) {
    return { kind: "waiting", reason: "the window after their ask is still open" };
  }
  const window = String(CARD_NEXT_WINDOW_MS / 1000);
  return { kind: "stuck", reason: `${cardKey} still up ${window}s after their ask at ${ordered[askIndex]!.atIso}` };
}
