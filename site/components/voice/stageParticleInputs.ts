/**
 * What the page says to the orb's canvas each frame: the nearest mood, presence and detail, the three numbers every
 * presence reads (`--pace`, `--lvl`, `--move-lvl`), the ground it is over and the theme's ramp. Read off the DOM, so
 * `StageParticles.tsx`'s loop holds only the clock, the easing and the painting.
 */
import { ORB_MOODS, type OrbMood } from "../../lib/orbMood";
import { DEFAULT_PRESENCE, isPresenceId, type PresenceId } from "../../lib/orbPresence";
import {
  ORB_RAMP_DARK_PROPERTY,
  ORB_RAMP_LIGHT_PROPERTY,
  type OrbGround,
  type OrbRamp,
  orbGroundOf,
  orbRampFromCss,
} from "../../lib/orbRamp";
import { isSwarmDetail, type SwarmDetail } from "../../lib/swarmDetail";

/** A frame as the loop reads one off the page. */
export interface FrameInputs {
  readonly mood: OrbMood;
  readonly pace: number;
  readonly lvl: number;
  readonly moveLvl: number;
  readonly sim: boolean;
  /** The presence the nearest `data-presence` names; the default presence when none does. */
  readonly presence: PresenceId;
  /** How much work the presence may do (`data-detail`): refined on the stage, plain in the corner. */
  readonly detail: SwarmDetail;
  /** What it is drawn over (`orbGroundOf`). */
  readonly ground: OrbGround;
  /** The theme's two ramp colours, off the inherited custom properties. */
  readonly ramp: OrbRamp;
}

/**
 * What the page says this frame: the nearest mood, presence and detail, the three numbers, the ground and the ramp.
 *
 * @returns the frame's inputs
 */
export function inputsOf({ canvas, style }: { canvas: HTMLElement; style: CSSStyleDeclaration }): FrameInputs {
  let pace = cssNumber({ name: "--pace", style });
  if (pace === undefined || pace <= 0) {
    // An orb placed without a pace — none is today — moves at the resting pace.
    pace = 1;
  }
  const named = canvas.closest("[data-presence]")?.getAttribute("data-presence");
  let presence = DEFAULT_PRESENCE;
  if (isPresenceId(named)) {
    presence = named;
  }
  // An orb placed without a detail draws plain, as the corner does.
  const namedDetail = canvas.closest("[data-detail]")?.getAttribute("data-detail");
  let detail: SwarmDetail = "plain";
  if (isSwarmDetail(namedDetail)) {
    detail = namedDetail;
  }
  return {
    detail,
    ground: orbGroundOf({
      ancestor: canvas.closest("[data-ground]")?.getAttribute("data-ground"),
      mode: canvas.ownerDocument.documentElement.getAttribute("data-sw-mode"),
    }),
    lvl: unit({ value: cssNumber({ name: "--lvl", style }) }),
    mood: moodOf({ canvas }),
    moveLvl: unit({ value: cssNumber({ name: "--move-lvl", style }) }),
    pace,
    presence,
    ramp: orbRampFromCss({
      dark: style.getPropertyValue(ORB_RAMP_DARK_PROPERTY),
      light: style.getPropertyValue(ORB_RAMP_LIGHT_PROPERTY),
    }),
    sim: canvas.closest("[data-sim]") !== null,
  };
}

/** A custom property's number, or `undefined` when it is unset or not a number. */
function cssNumber({ style, name }: { style: CSSStyleDeclaration; name: string }): number | undefined {
  const text = style.getPropertyValue(name).trim();
  if (text === "") {
    return undefined;
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

/** A level held to 0…1; an unset one is silence. */
function unit({ value }: { value: number | undefined }): number {
  if (value === undefined) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * The mood the nearest `data-mood` names; the listening cloud when none does.
 *
 * @returns the canvas's mood
 */
export function moodOf({ canvas }: { canvas: HTMLElement }): OrbMood {
  const named = canvas.closest("[data-mood]")?.getAttribute("data-mood");
  const mood = ORB_MOODS.find((known) => known === named);
  if (mood === undefined) {
    return "idle";
  }
  return mood;
}
