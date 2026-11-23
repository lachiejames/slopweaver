/**
 * What a presence is handed about the voice each frame, and how much work it may do to draw it.
 *
 * Every presence reads the OWNER's voice (`mic`) and the voice's own (`output`) apart and shows them differently — by
 * direction, density, speed and spread, never by hue, since the theme alone colours the orb (`./orbRamp.ts`). The
 * orb's level (`--lvl`) is already one number, picked by `stageOrbLevel` (`./voiceStage.ts`): the owner's voice while it
 * listens, its own while it speaks. So who is talking is read back off the orb's mood, which is the same decision
 * the page made.
 *
 * The budgets exist because the Settings theme tab draws twelve live orbs at once — a full-screen and a corner preview
 * for each of six themes — so a corner's presence does about half a stage's work, and every presence's state is
 * capped.
 *
 * Pure: the painters are `components/voice/presencePainters.ts`.
 */
import type { OrbMood } from "./orbMood";
import type { SwarmDetail } from "./swarmDetail";

/** Who the orb is answering this frame: nobody, the owner, the voice, or work in flight with nobody talking. */
export type PresenceTurn = "quiet" | "owner" | "bot" | "thinking";

/** The voice, as a presence reads it. */
export interface PresenceVoiceInput {
  /** The owner's voice, 0 to 1. */
  readonly mic: number;
  /** The voice's own, 0 to 1. */
  readonly output: number;
  /** Ten bands, low to high, each 0 to 1: the active voice's level shaped by {@link PRESENCE_BAND_PROFILE}. */
  readonly bands: readonly number[];
  readonly turn: PresenceTurn;
}

/**
 * The ten bands' share of the active level, low to high: low notes carry speech's weight, high ones a fraction of it.
 * Fixed rather than read off an analyser, so a presence's response is the same every time and exactly testable.
 */
export const PRESENCE_BAND_PROFILE: readonly number[] = [1, 0.92, 0.84, 0.74, 0.64, 0.54, 0.44, 0.34, 0.26, 0.18];

/** The moods that are work in flight, over which the owner may still be speaking (`stageOrbLevel`). */
const WORK_MOODS: ReadonlySet<OrbMood> = new Set<OrbMood>([
  "thinking",
  "writing",
  "looking",
  "slack",
  "code",
  "recalling",
  "browsing",
  "relaying",
  "working",
  "stalled",
]);

/** The input with nobody talking. */
function silent({ turn }: { turn: PresenceTurn }): PresenceVoiceInput {
  return { bands: PRESENCE_BAND_PROFILE.map(() => 0), mic: 0, output: 0, turn };
}

/** The bands for one active level. */
function bandsOf({ level }: { level: number }): readonly number[] {
  return PRESENCE_BAND_PROFILE.map((share) => share * level);
}

/**
 * The voice as a presence reads it: the voice speaking is `output`; the owner heard, or cutting in, is `mic`; work in
 * flight is `thinking` until the owner speaks over it, which is `mic` again, since `stageOrbLevel` carries their voice over a
 * turn in flight. Every other mood is quiet.
 *
 * @param mood the orb's mood
 * @param level the orb's level, held to 0 to 1
 * @returns the voice, each level 0 to 1
 */
export function presenceVoiceInputOf({ mood, level }: { mood: OrbMood; level: number }): PresenceVoiceInput {
  const held = Math.min(1, Math.max(0, level));
  if (mood === "speaking") {
    return { bands: bandsOf({ level: held }), mic: 0, output: held, turn: "bot" };
  }
  if (mood === "hearing" || mood === "yielded") {
    return { bands: bandsOf({ level: held }), mic: held, output: 0, turn: "owner" };
  }
  if (WORK_MOODS.has(mood)) {
    if (held > 0) {
      return { bands: bandsOf({ level: held }), mic: held, output: 0, turn: "owner" };
    }
    return silent({ turn: "thinking" });
  }
  return silent({ turn: "quiet" });
}

/** How much one presence may hold and draw at one detail. */
export interface PresenceBudget {
  /** Ink's live blooms. */
  readonly inkBlooms: number;
  /** Embers' live sparks, the owner's and the voice's together. */
  readonly emberSparks: number;
  /** The dot matrix's points across, and down. */
  readonly dotGrid: number;
  /** Aurora's curtains. */
  readonly auroraColumns: number;
}

/** Each detail's budget: the corner's `plain` about half the stage's and the tiles' `refined`. */
export const PRESENCE_BUDGETS: Readonly<Record<SwarmDetail, PresenceBudget>> = {
  plain: { auroraColumns: 10, dotGrid: 9, emberSparks: 24, inkBlooms: 14 },
  refined: { auroraColumns: 20, dotGrid: 17, emberSparks: 48, inkBlooms: 28 },
};

/** The densest pixel ratio an orb's canvas is drawn at: a Retina display's own, never past it. */
export const MAX_PRESENCE_PIXEL_RATIO = 2;

/**
 * The pixel ratio an orb's canvas is drawn at.
 *
 * @param device the display's `devicePixelRatio`
 * @returns the device's ratio, held to {@link MAX_PRESENCE_PIXEL_RATIO}
 */
export function presencePixelRatio({ device }: { device: number }): number {
  return Math.min(MAX_PRESENCE_PIXEL_RATIO, device);
}

/**
 * A list with one more item at its end, its oldest dropped first to stay within a cap.
 *
 * @param items the list as it was
 * @param item the item to add
 * @param cap how many it may hold, at least one
 * @returns a new list, at most `cap` long, ending in `item`
 */
export function withNewest<T>({ items, item, cap }: { items: readonly T[]; item: T; cap: number }): T[] {
  const kept = Math.max(0, Math.max(1, cap) - 1);
  return [...items.slice(Math.max(0, items.length - kept)), item];
}
