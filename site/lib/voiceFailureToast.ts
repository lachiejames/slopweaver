/**
 * When the console voice fails at something it tried for the owner, the console window says so itself — a toast at
 * the top middle of the app's own window, never over other apps and never beside the orb. A failure the owner cannot
 * see is one they cannot know about: when every `open_card` comes back `card refused` (five of five on one call), only
 * the voice could have told them, and a toast sitting over the top of other application windows is not wanted.
 *
 * Top middle, not bottom left: the bottom left of the console is the sidebar's foot (the build status and Docs), and
 * the top middle is where the shell already draws its one badge, the sharing edge's, at the screen's. Not beside the orb:
 * the orb floats over every app, and a failure drawn there would be the over-the-top surface the owner ruled out.
 *
 * Every failure is its own toast, five refused openings five toasts, because a count folded into one the owner never
 * saw reads as no toast at all. A card that did not open carries its key, so its toast can open that card as a new
 * desktop-app tab, never the owner's browser, with one CTA per error that deep-links to the queue card that failed to
 * open — on the owner's click, never by itself.
 *
 * A relay is never one. The owner does not want relay failures reported: the chair is woken off the call file itself
 * (`src/talk/chairWake.ts`), so a relay that did not reach its chat loses no word of the owner's, and saying it did
 * would be false. Its outcome is journalled on the relay's line and in `talk log`.
 *
 * Nor is a typed turn's look the owner did not ask for. The gate (`typedLookGate.ts`) refusing a `read_screen` the
 * owner's message gave no authority for is the design working: the voice says it took no look and asks what the owner
 * means, and a toast on top of that would present the design as an error. Only that exact refusal is quiet; a look
 * refused for any other reason still toasts.
 *
 * This module is the pure half: which final outcome is a failure worth a toast ({@link voiceFailureNoticeOf}), and
 * the stack the console draws ({@link receiveNotice}, {@link dismissToast}, {@link expireToasts}). Pure.
 */

import { TYPED_LOOK_NOT_ASKED_DETAIL } from "./typedLookGate";

/** One opening inside a tool call that came back refused, though the call itself answered — `open_card`'s page, say. */
export interface VoicePartialFailure {
  /** Which opening: `card`, `page` or `thread`. */
  readonly part: string;
  readonly why: string;
  /** The resolved card's own key, `ask:<slug>` and its kin — never the model's argument, which may be an alias. */
  readonly cardKey: string;
}

/** A voice tool call's FINAL outcome — after a retry, after the answer was delivered. */
export interface VoiceFailureOutcome {
  readonly kind: "tool";
  readonly tool: string;
  /** The activity line's detail, which names why on a refusal. */
  readonly detail: string;
  readonly refused: boolean;
  readonly partialFailures: readonly VoicePartialFailure[];
}

/** The one tool whose refusal is journalled and never toasted: the relay (see the file header). */
const RELAY_TOOL = "relay_steer";

/** One failure as the console window is told it: the line it shows, the reason behind the disclosure, its card. */
export interface VoiceFailureNotice {
  /** One plain line saying what did not happen. */
  readonly summary: string;
  /** Why, as the tool or the post said it. */
  readonly detail: string;
  /** The card that did not open, which the toast offers to open in a new tab; absent for every other failure. */
  readonly cardKey?: string;
}

/**
 * The most characters of a reason a notice carries: the wire's own bound (`desktopShell.ts`'s `NOTICE_WIRE_DETAIL_MAX`,
 * `desktop/src/desktopBridge.ts`'s `MAX_NOTICE_DETAIL`), restated so this pure module imports neither. The toast says
 * the reason plainly and folds this under it, scrollable, so a verb's stderr cannot fill the window either way.
 */
export const NOTICE_DETAIL_MAX = 2000;

/**
 * The line a refused tool shows, for the tools that act on the owner's screen or for them; any other tool is named. A
 * `Map`, never an object: the model names the tool, and `constructor` would read `Object.prototype`.
 */
const TOOL_SUMMARIES: ReadonlyMap<string, string> = new Map([
  ["browser_open", "The voice couldn't open that page"],
  ["focus_screen", "The voice couldn't highlight that on your screen"],
  ["meeting_skip", "The voice couldn't stop the join reminder for that meeting"],
  ["offer_copy", "The voice couldn't put that on your running list"],
  ["open_card", "The voice couldn't open the card"],
  ["read_card", "The voice couldn't read the card"],
  ["read_screen", "The voice couldn't look at your screen"],
  ["set_stage_setting", "The voice couldn't change that setting"],
]);

/** What a refused opening inside `open_card` was, for the summary. */
const OPENING_NAMES: ReadonlyMap<string, string> = new Map([
  ["briefing", "all of the card's briefing"],
  ["card", "the card's panel"],
  ["page", "the card's page"],
  ["thread", "the card's Slack thread"],
]);

/**
 * A reason exactly as given, its lines and spacing kept, cut only when it would not cross the wire: the toast folds it
 * under its plain line as the full message, so it is never flattened or shortened below the wire's own bound. Past the
 * bound its head is kept, where a refusal says what caught it.
 *
 * @param detail the reason as given
 * @returns the reason, bounded
 */
function boundedDetail({ detail }: { detail: string }): string {
  if (detail.length <= NOTICE_DETAIL_MAX) {
    return detail;
  }
  return `${detail.slice(0, NOTICE_DETAIL_MAX - 1)}…`;
}

/** The most characters of a tool's name a notice carries: the model names the tool, so an unknown one is unbounded. */
export const NOTICE_TOOL_MAX = 60;

/**
 * A tool's name cut to {@link NOTICE_TOOL_MAX}, so its line stays on one line inside the wire's bounds and is never
 * dropped there (an unknown name is the model's, so its length is unbounded).
 *
 * @param tool the name the model called
 * @returns the name, on one line and bounded
 */
function boundedTool({ tool }: { tool: string }): string {
  const flat = tool.replace(/\s+/gu, " ").trim();
  if (flat.length <= NOTICE_TOOL_MAX) {
    return flat;
  }
  return `${flat.slice(0, NOTICE_TOOL_MAX - 1)}…`;
}

/**
 * The line a refused tool shows: its own for a tool that acts for the owner, else the tool named.
 *
 * @param tool the name the model called, which the known lines are keyed by
 * @param bounded that name cut to fit the line
 * @returns the line
 */
function refusedSummary({ tool, bounded }: { tool: string; bounded: string }): string {
  const known = TOOL_SUMMARIES.get(tool);
  if (known !== undefined) {
    return known;
  }
  return `The voice's ${bounded} failed`;
}

/**
 * Whether an outcome is a typed turn's `read_screen` refused because the owner's message did not ask for a look: the
 * gate working as designed, which the voice answers in words, so no toast. Exactly that detail on exactly that tool;
 * a look refused for any other reason (no screen shared, a capture that failed) still toasts.
 *
 * @param outcome the final outcome
 * @returns whether it is the not-asked refusal
 */
function isNotAskedLook({ outcome }: { outcome: VoiceFailureOutcome }): boolean {
  return outcome.tool === "read_screen" && outcome.refused && outcome.detail === TYPED_LOOK_NOT_ASKED_DETAIL;
}

/**
 * The toast one final outcome earns, or none. Every refused tool call earns one — a malformed call included, since
 * the voice still tried something and did not do it, and guessing which refusals matter is how this went unseen — and
 * so does an `open_card` that answered but whose openings were refused. A success earns none, and so does every
 * outcome of `relay_steer`, which is journalled instead (see the file header), and a typed turn's look refused because
 * the owner did not ask for one, which is the gate doing its job rather than a failure.
 *
 * @param outcome the final outcome
 * @returns the notice, or `undefined` when nothing failed, the call was the relay, or the look was not asked for
 */
export function voiceFailureNoticeOf({ outcome }: { outcome: VoiceFailureOutcome }): VoiceFailureNotice | undefined {
  if (outcome.tool === RELAY_TOOL || isNotAskedLook({ outcome })) {
    return undefined;
  }
  const tool = boundedTool({ tool: outcome.tool });
  if (outcome.refused) {
    return {
      detail: boundedDetail({ detail: outcome.detail }),
      summary: refusedSummary({ bounded: tool, tool: outcome.tool }),
    };
  }
  // `.at` answers `undefined` for an empty list under every tsconfig, the site's included.
  const first = outcome.partialFailures.at(0);
  if (first === undefined) {
    return undefined;
  }
  const more = outcome.partialFailures.length - 1;
  const what = OPENING_NAMES.get(first.part) ?? first.part;
  const also = more === 0 ? "" : ` (and ${String(more)} more)`;
  // The reasons alone, never the call's own activity line before them: the toast reads its detail as a failure's raw
  // message, and the summary already says what did not open. One refusal is its reason exactly;
  // several are one line each, named by the opening.
  let reasons = first.why;
  if (more > 0) {
    reasons = outcome.partialFailures.map((one) => `${one.part}: ${one.why}`).join("\n");
  }
  const notice = {
    detail: boundedDetail({ detail: reasons }),
    summary: `The voice couldn't open ${what}${also}`,
  };
  // Only `open_card` resolves a card before opening it, so only its openings name one to open.
  if (outcome.tool !== "open_card") {
    return notice;
  }
  return { ...notice, cardKey: first.cardKey };
}

/** One toast on the stack: one notice, and when it goes. */
export interface VoiceFailureToast extends VoiceFailureNotice {
  readonly id: number;
  /** When it leaves the screen, once it is on it; `undefined` while it waits behind {@link TOASTS_SHOWN}. */
  readonly expiresAtMs: number | undefined;
}

/** The console's stack of failure toasts. */
export interface VoiceFailureToastState {
  readonly nextId: number;
  readonly entries: readonly VoiceFailureToast[];
}

/** No toast yet. */
export const NO_TOASTS: VoiceFailureToastState = { entries: [], nextId: 1 };

/**
 * How long a toast stays on screen untouched, counted from when it reaches the screen. A repeat is a fresh toast with
 * its own life, so a failure the owner missed while away is said again the next time it happens.
 */
export const TOAST_LIFE_MS = 8000;

/** The most toasts on screen at once; the rest wait and move up as one leaves. */
export const TOASTS_SHOWN = 3;

/**
 * The stack with every toast now on screen given its clock: one that just moved up starts its life now.
 *
 * @param entries the stack
 * @param nowMs the instant
 * @returns the stack, every shown toast with an expiry
 */
function stamped({
  entries,
  nowMs,
}: {
  entries: readonly VoiceFailureToast[];
  nowMs: number;
}): readonly VoiceFailureToast[] {
  return entries.map((entry, at) => {
    if (at >= TOASTS_SHOWN || entry.expiresAtMs !== undefined) {
      return entry;
    }
    return { ...entry, expiresAtMs: nowMs + TOAST_LIFE_MS };
  });
}

/**
 * The stack after one notice arrives: always a new toast on the end, never counted into one already there — the same
 * failure twice is two toasts.
 *
 * @param state the stack
 * @param notice what failed
 * @param nowMs the instant it arrived
 * @returns the stack after it
 */
export function receiveNotice({
  state,
  notice,
  nowMs,
}: {
  state: VoiceFailureToastState;
  notice: VoiceFailureNotice;
  nowMs: number;
}): VoiceFailureToastState {
  const fresh: VoiceFailureToast = { ...notice, expiresAtMs: undefined, id: state.nextId };
  return { entries: stamped({ entries: [...state.entries, fresh], nowMs }), nextId: state.nextId + 1 };
}

/**
 * The stack after the owner closes one toast; the next waiting one moves up and starts its life.
 *
 * @param state the stack
 * @param id the toast the owner closed
 * @param nowMs the instant
 * @returns the stack after it
 */
export function dismissToast({
  state,
  id,
  nowMs,
}: {
  state: VoiceFailureToastState;
  id: number;
  nowMs: number;
}): VoiceFailureToastState {
  return { ...state, entries: stamped({ entries: state.entries.filter((entry) => entry.id !== id), nowMs }) };
}

/**
 * The stack after time passes: every shown toast whose life has run out leaves, except one the owner is holding —
 * hovered, focused or opened — which stays until they let go.
 *
 * @param state the stack
 * @param nowMs the instant
 * @param held the toasts the owner is holding
 * @returns the stack after it — `state` itself when nothing left
 */
export function expireToasts({
  state,
  nowMs,
  held,
}: {
  state: VoiceFailureToastState;
  nowMs: number;
  held: ReadonlySet<number>;
}): VoiceFailureToastState {
  const kept = state.entries.filter(
    (entry) => held.has(entry.id) || entry.expiresAtMs === undefined || entry.expiresAtMs > nowMs,
  );
  if (kept.length === state.entries.length) {
    return state;
  }
  return { ...state, entries: stamped({ entries: kept, nowMs }) };
}

/**
 * The toasts on screen now.
 *
 * @param state the stack
 * @returns at most {@link TOASTS_SHOWN}, oldest first
 */
export function shownToasts({ state }: { state: VoiceFailureToastState }): readonly VoiceFailureToast[] {
  return state.entries.slice(0, TOASTS_SHOWN);
}

/**
 * The earliest instant a shown toast the owner is not holding leaves, for the one timer the console arms.
 *
 * @param state the stack
 * @param held the toasts the owner is holding
 * @returns the instant, or `undefined` when nothing is due to leave
 */
export function nextExpiryMs({
  state,
  held,
}: {
  state: VoiceFailureToastState;
  held: ReadonlySet<number>;
}): number | undefined {
  const due = shownToasts({ state })
    .filter((entry) => !held.has(entry.id))
    .map((entry) => entry.expiresAtMs)
    .filter((at): at is number => at !== undefined);
  if (due.length === 0) {
    return undefined;
  }
  return Math.min(...due);
}
