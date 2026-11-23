/**
 * Whether the voice may turn the owner's `openCards` switch off: only when the owner's own newest words, as the page
 * heard them, ask for cards in general to stop opening. A complaint about the one card, page or thread in hand is a
 * skip of that card and never reaches the switch, which persists across calls.
 *
 * Twice the model read a per-card complaint as the global off, though the prompt already drew that line:
 * - flipped for a complaint about `browser` reads and still off about an hour and a half later on another call
 *   (`../components/voice/openCardsSettingNote.ts`);
 * - mid-demo, the owner said they already had the Slack thread in front of them and to stop trying to open it; the
 *   switch flipped off eight seconds later and was still off on the next call, where the owner said they had never
 *   made a steer around turning it off. Repro: `grep -n "set_stage_setting\|stop trying to open"
 *   $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`.
 *
 * So the page judges the owner's words, never the model's account of them, and refuses when unsure: a refused off
 * leaves the switch on, which is the owner's stated default, and they can still click it off in Settings.
 */
import type { GateEntry } from "./relayGate";

/**
 * How far back, in characters of the owner's heard words, an ask to stop opening cards still counts: about two spoken
 * sentences, so the ask is the one just made rather than one from earlier in the call. The measured complaint was
 * 77 characters.
 */
export const OPEN_CARDS_OFF_WINDOW = 240;

/** What the page tells the model when it refuses the off, so it skips the card in hand instead. */
export const OPEN_CARDS_OFF_REFUSAL =
  "The owner's words were about the card, page or thread in hand, not cards in general, so the openCards switch stays on. " +
  "Skip just that card: do not open its page or thread again, and use read_card if you still need what it says.";

/**
 * A spoken ask to stop opening cards in general. Each needs the plural "cards" or automatic opening named outright;
 * "it", "that one" and "the thread" never match.
 */
const GLOBAL_OFF: readonly RegExp[] = [
  /\b(?:stop|quit|don't|do not|no more|never)\b[^.?!]{0,20}?\bopen(?:ing)?\b[^.?!]{0,12}?\bcards\b/u,
  /\b(?:turn|switch|shut)\b[^.?!]{0,12}?\boff\b[^.?!]{0,12}?\b(?:auto[- ]?open(?:ing)?|automatic(?:ally)? (?:card )?opening|(?:card|cards) opening|opening cards)\b/u,
  /\b(?:turn|switch|shut)\b[^.?!]{0,12}?\b(?:auto[- ]?open(?:ing)?|automatic(?:ally)? (?:card )?opening|(?:card|cards) opening|opening cards)\b[^.?!]{0,12}?\boff\b/u,
  /\b(?:disable|stop)\b[^.?!]{0,12}?\b(?:auto[- ]?open(?:ing)?|automatic(?:ally)? (?:card )?opening)\b/u,
];

/**
 * A one-thing referent near the ask ("stop opening cards for this PR", "for that one, stop opening cards", "this PR
 * is already open, stop opening cards", "the Slack thread" with up to two words between, and any "this X" or "that
 * X" at all, since what the owner points at is not a closed list) makes it per-card. The bound, stated rather than
 * discovered: a one-thing phrasing this does not name ("the Vanta control is up, stop opening cards") still passes,
 * the same as a misheard ask. Each was a counterexample before it was a pattern; add the next one the same way. "stop opening cards, that's annoying" stays general.
 */
const ONE_THING =
  /\b(?:this|that)\s+\w|\b(?:the|its|my)\s+(?:[\w'-]+\s+){0,2}?(?:one|card|thread|pr|pull request|page|tab|link|ticket|issue|doc|document|message|row)\b|\b(?:for|on|in|with|from) (?:this|that)\b/u;

/**
 * Everything the owner was heard saying this call, joined in the order it arrived, lowercased with curly apostrophes
 * straightened.
 *
 * @param log the call's relay-gate record, which every fragment the owner was heard saying joins
 * @returns the owner's words, `""` when the owner has said nothing this call
 */
function allHeard({ log }: { log: readonly GateEntry[] }): string {
  let text = "";
  for (const entry of log) {
    if (entry.kind === "heard") {
      text += entry.text;
    }
  }
  return text.replace(/\s+/gu, " ").trim().toLowerCase().replace(/[’‘]/gu, "'");
}

/**
 * Whether the owner's newest words ask for cards in general to stop opening: the ask reaches into the last
 * {@link OPEN_CARDS_OFF_WINDOW} characters, and no one-thing referent sits anywhere in the last twice that. No
 * sentence is parsed — punctuation in a transcript is the recogniser's guess, and every split tried let a referent
 * fall outside it — so a card the owner named just before a general ask refuses it too. That fails closed: the switch
 * stays on, and the owner can say it again or click it off in Settings.
 *
 * @param log the call's relay-gate record, read for what the owner was actually heard saying
 * @returns true only for a general ask within the window with no one-thing referent near it
 */
export function heardOpenCardsOff({ log }: { log: readonly GateEntry[] }): boolean {
  const heard = allHeard({ log });
  // Matched on the whole text and judged by position: a slice would invent a word boundary at its cut.
  const asked = GLOBAL_OFF.some((pattern) =>
    matchesFrom({ from: heard.length - OPEN_CARDS_OFF_WINDOW, heard, pattern }),
  );
  return asked && !matchesFrom({ from: heard.length - 2 * OPEN_CARDS_OFF_WINDOW, heard, pattern: ONE_THING });
}

/**
 * Whether a pattern matches the owner's words anywhere that ends after a position. Every start is tried with a sticky
 * pattern, so `\b` still sees the character before it and an overlapping match is never skipped, as `matchAll`'s
 * would be.
 *
 * @param from the position a match must end after
 * @param heard all the owner's words this call
 * @returns true for any such match
 */
function matchesFrom({ from, heard, pattern }: { from: number; heard: string; pattern: RegExp }): boolean {
  const sticky = new RegExp(pattern.source, "uy");
  for (let start = 0; start < heard.length; start += 1) {
    sticky.lastIndex = start;
    const match = sticky.exec(heard);
    if (match !== null && start + match[0].length > from) {
      return true;
    }
  }
  return false;
}
