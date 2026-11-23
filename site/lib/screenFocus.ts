/**
 * Whether the voice may lift one region of the owner's screen now (`focus_screen`), and which. A lift blurs out
 * everything else and focuses on one thing, and only when the owner asks to be shown, since an unasked lift is
 * annoying.
 *
 * So the page decides from the session's own record, never from the model's say-so, the way `relayGate.ts` does:
 *
 * - **the owner asked to be shown**: their latest words, a few turns of them across the voice's backchannels, ask where or which;
 * - **once per ask**: one lift per turn of theirs, and their next word drops it;
 * - **on the picture of this ask**: the box points into the desktop app's own still taken AFTER their latest turn began,
 *   so it is never drawn on a page they did not ask about.
 *
 * A spoken question can run over several of the owner's turns with "Yeah? Go on." between them, and the tool call can land
 * before the turn is done, so "this ask" is the id of the owner's latest turn — never whether it is final. Pure.
 */
import type { FrameSize, ScreenSight } from "./screenFrame";
import type { HeardSegment } from "./voiceTranscript";

/** A box in the picture the voice was sent, in its pixels at the size it was told. */
export interface FocusBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A box as fractions (0 to 1) of that picture, which is the whole display the shell looked at. */
export interface FocusFractions {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Where to draw the lifted region, in CSS pixels of the voice's whole-work-area window. */
export interface FocusRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The last look the voice took, pinned to the owner's turn it was taken on. */
export interface ScreenLook {
  readonly ownerTurnId: string;
  readonly sight: ScreenSight;
  readonly size: FrameSize;
}

/** What a look that took a frame reports: how it saw, and the size the model was told. */
export interface LookTaken {
  readonly sight: ScreenSight;
  readonly size: FrameSize;
}

/**
 * The owner's latest stretch of asking: the id of their latest turn, their words across the window, and the turn in it that asked
 * to be shown — `undefined` when none did.
 */
export interface AskWindow {
  readonly ownerTurnId: string;
  readonly askTurnId: string | undefined;
  readonly text: string;
}

/** The gate's word: lift this region for this ask, or why not, in a line the voice can say. */
export type FocusVerdict =
  | {
      readonly kind: "focus";
      readonly region: FocusFractions;
      readonly ownerTurnId: string;
      readonly askTurnId: string;
    }
  | { readonly kind: "refused"; readonly why: string };

/** The most words a voice turn may have and still be a backchannel the owner's ask runs across ("Yeah? Go on."). */
export const BACKCHANNEL_WORDS = 4;

/** The most turns of the owner's read as one ask. */
export const ASK_WINDOW_TURNS = 4;

/** The smallest side a box may have, in the picture's pixels: smaller is a speck, not a thing. */
export const MIN_FOCUS_EDGE = 12;

/** The largest share of the picture a box may cover: bigger is not pointing at anything. */
export const MAX_FOCUS_AREA = 0.6;

/** How long a lift stays up with nothing else dropping it — a click inside the region is one the voice never sees. */
export const FOCUS_HOLD_MS = 20_000;

/**
 * The owner's words asking to be shown where or which. A backstop, not the decider — the prompt is — so it reads asking
 * phrases rather than bare words: "where are we on the migration" and "the point of this card" ask nothing to be shown.
 */
export const SHOW_ASK =
  /\bshow (?:me|where|which)\b|\bhighlight\b|\bcircle (?:it|that|the|where)\b|\bpoint (?:to|at|out|me)\b|\bwhere(?:['’]s| is| are(?! we\b)| do i| should i| can i| would i| i (?:click|press|tap|go))\b|\bwhat (?:do|should) i (?:click|press|tap|pick|choose)\b|\bwhich (?:one|button|link|field|box|tab|option)\b/iu;

/**
 * The owner's latest stretch of asking: their latest turn, and the turns of theirs before it back across the voice's short
 * backchannels, stopping at anything longer the voice said or after {@link ASK_WINDOW_TURNS} of theirs. The turn that
 * asked is the one the owner's last asking phrase in the window ends in — so a "This one here." after a lift never carries an
 * ask that was already answered into their next words, split over two turns or not.
 *
 * @param segments the conversation, oldest first
 * @returns the window, or `undefined` before the owner has said anything
 */
export function askWindowOf({ segments }: { segments: readonly HeardSegment[] }): AskWindow | undefined {
  const latest = segments.findLastIndex((segment) => segment.who === "owner");
  if (latest === -1) {
    return undefined;
  }
  const ownerTurnId = segments[latest].id;
  const said: HeardSegment[] = [];
  for (let at = latest; at >= 0 && said.length < ASK_WINDOW_TURNS; at -= 1) {
    const segment = segments[at];
    if (segment.who === "owner") {
      said.unshift(segment);
    } else if (wordsIn({ text: segment.text }) > BACKCHANNEL_WORDS) {
      break;
    }
  }
  const words = said.map((segment) => segment.text.trim());
  const text = words.join(" ");
  const lastAsk = [...text.matchAll(new RegExp(SHOW_ASK.source, "giu"))].at(-1);
  if (lastAsk === undefined) {
    return { askTurnId: undefined, ownerTurnId, text };
  }
  // The turn the owner's last asking phrase ends in, even one split over two turns: words after it ask nothing new.
  const askEnd = lastAsk.index + lastAsk[0].length;
  let start = 0;
  let askTurnId = ownerTurnId;
  for (const [at, segment] of said.entries()) {
    const end = start + words[at].length;
    if (askEnd <= end) {
      askTurnId = segment.id;
      break;
    }
    start = end + 1;
  }
  return { askTurnId, ownerTurnId, text };
}

/**
 * The owner's latest turn's id.
 *
 * @param segments the conversation, oldest first
 * @returns the id, or `undefined` before the owner has spoken
 */
export function latestOwnerTurnOf({ segments }: { segments: readonly HeardSegment[] }): string | undefined {
  return segments.findLast((segment) => segment.who === "owner")?.id;
}

/**
 * The look to remember after a `read_screen`: pinned to the owner's turn that was latest when the look STARTED, or nothing when
 * the look took no frame, so an older picture can never be pointed into after a newer look failed, and a turn of theirs
 * that began while the frame was taken is one the picture predates.
 *
 * @param ownerTurnId the owner's latest turn as the look started, `undefined` before they had spoken
 * @param looked what the look took, `undefined` when it took no frame
 * @returns the look, or `undefined`
 */
export function lookOf({
  ownerTurnId,
  looked,
}: {
  ownerTurnId: string | undefined;
  looked: LookTaken | undefined;
}): ScreenLook | undefined {
  if (looked === undefined || ownerTurnId === undefined) {
    return undefined;
  }
  return { ownerTurnId, sight: looked.sight, size: looked.size };
}

/**
 * The box the model asked for, checked against the picture it was sent: whole pixels, inside the picture, at least
 * {@link MIN_FOCUS_EDGE} a side and at most {@link MAX_FOCUS_AREA} of it — refused rather than clamped, naming the size.
 *
 * @param args the tool call's arguments
 * @param size the picture's size as the model was told it
 * @returns the box, or why it is not one
 */
export function focusBoxOf({
  args,
  size,
}: {
  args: Record<string, unknown>;
  size: FrameSize;
}): FocusBox | { readonly why: string } {
  const { height, width, x, y } = args;
  if (!isPixel(x) || !isPixel(y) || !isPixel(width) || !isPixel(height)) {
    return { why: "x, y, width and height must be whole pixels of the picture read_screen sent" };
  }
  if (width < MIN_FOCUS_EDGE || height < MIN_FOCUS_EDGE) {
    return { why: `the box must be at least ${MIN_FOCUS_EDGE} pixels a side; box the whole thing` };
  }
  if (x + width > size.width || y + height > size.height) {
    return { why: `the box runs off the picture, which was sent at ${size.width}×${size.height}` };
  }
  if (width * height > MAX_FOCUS_AREA * size.width * size.height) {
    return {
      why: "the box covers most of the owner's screen, which points at nothing; box the one thing they asked about",
    };
  }
  return { height, width, x, y };
}

/**
 * Whether the voice may lift a region now, and which, in order: the owner asked to be shown, nothing is lifted for this ask
 * yet, the last look is the desktop app's own and was taken on this ask, and the box is one.
 *
 * @param args the `focus_screen` call's arguments
 * @param look the last look, `undefined` before any this call or after one that took no frame
 * @param segments the conversation now
 * @param focusedFor the owner's latest turn when a region was last lifted, `undefined` before any; only words after it ask
 * @returns the region to lift, the owner's latest turn it shows for and the turn that asked, or why not
 */
export function screenFocusVerdict({
  args,
  look,
  segments,
  focusedFor,
}: {
  args: Record<string, unknown>;
  look: ScreenLook | undefined;
  segments: readonly HeardSegment[];
  focusedFor: string | undefined;
}): FocusVerdict {
  // Only words after the lifted turn can ask again: read across it, a turn falling out of the window or a word left
  // over from the answered ask could form an asking phrase the owner never said anew.
  const shownAt = segments.findIndex((segment) => segment.id === focusedFor);
  const ask = askWindowOf({ segments: segments.slice(shownAt + 1) });
  if (ask?.askTurnId === undefined) {
    if (shownAt !== -1) {
      return refused({ why: "already shown for this ask; wait until the owner asks again" });
    }
    return refused({
      why: "the owner has not asked to be shown; say it in words, and point only when they ask you to show them",
    });
  }
  if (look === undefined) {
    return refused({ why: "call read_screen first, on this ask" });
  }
  if (look.ownerTurnId !== ask.ownerTurnId) {
    return refused({ why: "the last picture is from before the owner's latest words; call read_screen again" });
  }
  if (look.sight !== "native") {
    return refused({
      why: "only the desktop app's own look at the owner's screen can be pointed at; say where in words",
    });
  }
  const box = focusBoxOf({ args, size: look.size });
  if ("why" in box) {
    return refused({ why: box.why });
  }
  return {
    askTurnId: ask.askTurnId,
    ownerTurnId: ask.ownerTurnId,
    kind: "focus",
    region: {
      height: box.height / look.size.height,
      left: box.x / look.size.width,
      top: box.y / look.size.height,
      width: box.width / look.size.width,
    },
  };
}

/**
 * A refusal.
 *
 * @returns the verdict saying why
 */
function refused({ why }: { why: string }): FocusVerdict {
  return { kind: "refused", why };
}

/**
 * Whether a value is a whole, non-negative number of pixels.
 *
 * @returns true for one
 */
function isPixel(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * How many words a line holds.
 *
 * @returns the count
 */
function wordsIn({ text }: { text: string }): number {
  return text.split(/\s+/u).filter((word) => word !== "").length;
}
