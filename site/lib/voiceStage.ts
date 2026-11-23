/**
 * The voice's two views — the fullscreen STAGE and the corner orb — and how the orb is placed in each.
 *
 * A voice conversation can take a fullscreen view with an expressive orb, for a one-on-one feel, and must also get out
 * of the way on demand, easily. Nothing about the stage's look is a hard ruling yet: it is an experiment, kept open
 * to change toward whatever the owner gravitates to in practice.
 *
 * So both views ship and the owner switches: one gesture collapses the stage and one expands it back, and neither
 * touches the call — the call lives in `components/voice/VoiceProvider.tsx` and both views read the same
 * `useVoice()`. Which view is up is the owner's sticky window state (`./voiceWindow.ts`), never the call's. This
 * module is the pure half of how each view looks. The React half is `components/voice/VoiceStage.tsx` and
 * `StageOrb.tsx`.
 *
 * And on the orb itself, two choices apart: what fills it is the Settings modal's Presence tab
 * (`./orbPresence.ts`), and the colours it is lit in come with the theme worn (`./themePresets.ts`). Both are kept for
 * the next launch.
 */
import type { OrbMood } from "./orbMood";
import { isPresenceId, type PresenceId } from "./orbPresence";
import type { VoicePhase } from "./voiceActivity";

/**
 * What the corner orb sits on. A grey disc reads as plastic, so the backing is dark and crisp, the swarm spilling
 * past it only a little. So `disc` is near-black with a hairline edge and is the
 * default; `ring` keeps the edge alone, `glow` keeps only light, `none` is the orb alone.
 */
export const ORB_BACKINGS = ["disc", "ring", "glow", "none"] as const;

/** One of {@link ORB_BACKINGS}. */
export type OrbBacking = (typeof ORB_BACKINGS)[number];

/** The corner's backing until the owner picks one: the disc it has always worn. */
export const DEFAULT_ORB_BACKING: OrbBacking = "disc";

/** Where the owner's pick of backing is kept, in this browser. */
export const ORB_BACKING_STORAGE_KEY = "slopweaver.talk.orbBacking";

/**
 * Whether a value is a backing.
 *
 * @returns true for a name in {@link ORB_BACKINGS}
 */
export function isOrbBacking(value: unknown): value is OrbBacking {
  return ORB_BACKINGS.some((backing) => backing === value);
}

/**
 * How strongly the corner's backing is drawn, in steps of ten percent, so the owner can dial the
 * ring or disc down without changing it for good. Full
 * strength is the backing exactly as it was, and every theme in the Settings modal wears it (`./themePresets.ts`); any
 * other kept strength still reads back here.
 */
export const ORB_BACKING_OPACITIES = ["0", "10", "20", "30", "40", "50", "60", "70", "80", "90", "100"] as const;

/** One of {@link ORB_BACKING_OPACITIES}: a percentage, as the stored string. */
export type OrbBackingOpacity = (typeof ORB_BACKING_OPACITIES)[number];

/** The backing's strength until a theme is worn: full, the backing as it has always been drawn. */
export const DEFAULT_ORB_BACKING_OPACITY: OrbBackingOpacity = "100";

/** Where the backing's strength is kept, in this browser, beside {@link ORB_BACKING_STORAGE_KEY}. */
export const ORB_BACKING_OPACITY_STORAGE_KEY = "slopweaver.talk.orbBackingOpacity";

/**
 * Whether a value is a backing strength.
 *
 * @returns true for a percentage in {@link ORB_BACKING_OPACITIES}
 */
export function isOrbBackingOpacity(value: unknown): value is OrbBackingOpacity {
  return ORB_BACKING_OPACITIES.some((opacity) => opacity === value);
}

/**
 * Whether a backing takes the pointer where it stands. A click just past the orb must not land on
 * an invisible ring in the way of the owner's app — so a backing the owner cannot see takes nothing, and the orb's
 * own button is the whole target. One dialled all the way down is one the owner cannot see.
 *
 * @param opacity how strongly it is drawn; full when not given
 * @returns true for every backing with something drawn
 */
export function backingIsPressable({
  backing,
  opacity = DEFAULT_ORB_BACKING_OPACITY,
}: {
  backing: OrbBacking;
  opacity?: OrbBackingOpacity;
}): boolean {
  return backing !== "none" && opacity !== "0";
}

/** The owner's microphone's level and the voice's own, each 0 to 1, read apart (`useVoiceActivity.ts`). */
export interface VoiceLevels {
  readonly mic: number;
  readonly output: number;
}

/**
 * How much a raw analyser level is lifted before an orb draws it: speech sits around 0.05–0.3 of the meter's
 * mean, so unlifted the orb barely moves while the owner talks and it feels like nothing is actively listening.
 */
export const STAGE_LEVEL_GAIN = 3.2;

/**
 * The level the stage orb moves with: THE OWNER'S voice while it is listening to them, the voice's own while it speaks, and
 * stillness while neither is making sound. Reading whichever meter was louder would swell the orb with the owner's
 * voice only when the voice was quiet and only through one muted channel.
 *
 * @param phase what the session is doing
 * @param levels the owner's and the voice's raw levels
 * @returns the level to draw, 0 to 1
 */
export function stageOrbLevel({ phase, levels }: { phase: VoicePhase; levels: VoiceLevels }): number {
  let raw = 0;
  if (phase === "listening" || phase === "hearing" || phase === "yielded") {
    raw = levels.mic;
  } else if (phase === "speaking") {
    raw = levels.output;
  } else if (phase === "working" || phase === "stalled") {
    // The owner may speak over a turn in flight; the orb still shows it heard the owner.
    raw = levels.mic;
  }
  return Math.min(1, Math.max(0, raw * STAGE_LEVEL_GAIN));
}

/** A stage behaviour the owner can switch off, kept in this browser. Every one applies live, mid-call. */
export type StageToggle = "activity" | "previews" | "openCards";

/** One toggle's state. */
export type StageSwitch = "on" | "off";

/** Each toggle's key in this browser, its label, and what it switches. */
export const STAGE_TOGGLES: Readonly<
  Record<StageToggle, { readonly key: string; readonly label: string; readonly title: string }>
> = {
  activity: {
    key: "slopweaver.talk.stage.activity",
    label: "what it is reading",
    title: "a line by the orb naming what the voice is reading, looking at or relaying, while it does",
  },
  // The voice opens the card it is about to talk about, unless the owner already has it open, and any card the owner
  // asks for (`./openCard.ts`). This switch is the owner's opt-out: off, neither opens one.
  openCards: {
    key: "slopweaver.talk.stage.openCards",
    label: "open cards and links",
    title:
      "the voice opens the Queue card it is about to talk about, and any card you ask for: the console opens it, its page opens as a new tab in the desktop app and its Slack thread in your Slack app",
  },
  previews: {
    key: "slopweaver.talk.stage.previews",
    label: "picture previews",
    title: "a small thumbnail of the screen frame or picture the voice is looking at",
  },
};

/** The toggles in the order the settings list them. */
export const STAGE_TOGGLE_ORDER: readonly StageToggle[] = ["activity", "previews", "openCards"];

/**
 * Whether a value is a toggle's state.
 *
 * @returns true for `on` or `off`
 */
export function isStageSwitch(value: unknown): value is StageSwitch {
  return value === "on" || value === "off";
}

/** The query parameter that draws the stage with no call up: `?stage=star-cluster`, beside `?orb=speaking,slack`. */
export const STAGE_PREVIEW_PARAM = "stage";

/**
 * The presence a `?stage=` preview asks for, so each can be seen — and photographed — with no call up. One exact name
 * or nothing: an unknown, empty or repeated value draws no stage, so a typo shows the console rather than a guess.
 *
 * @param search the page's `location.search`
 * @returns the presence to preview, or `undefined` when the address asks for none
 */
export function stagePreviewOf({ search }: { search: string }): PresenceId | undefined {
  const asked = new URLSearchParams(search).getAll(STAGE_PREVIEW_PARAM);
  if (asked.length !== 1) {
    return undefined;
  }
  const [name] = asked;
  if (isPresenceId(name)) {
    return name;
  }
  return undefined;
}

/**
 * The presence a window wears: a `?stage=` preview pin when the address holds a valid one — read by `stagePreviewOf`,
 * so a repeated or unknown `stage` is no pin and the stored choice applies live — else the stored choice.
 *
 * @param search the page's `location.search`
 * @param stored the presence the Presence tab stored
 * @returns the presence the orb wears in this window
 */
export function presenceWorn({ search, stored }: { search: string; stored: PresenceId }): PresenceId {
  const pinned = stagePreviewOf({ search });
  if (pinned === undefined) {
    return stored;
  }
  return pinned;
}

/** The query parameter that plays a made-up voice into a preview: `?stage=star-cluster&orb=speaking&voice=sim`. */
export const VOICE_SIM_PARAM = "voice";

/**
 * Whether a preview asks for a made-up voice, so the orb's swell with a voice can be seen — and recorded — with no
 * call up. Only beside a `?stage=` preview, and only as the exact word `sim`; the caller holds it off a live call.
 *
 * @param search the page's `location.search`
 * @returns true for `?stage=<presence>&voice=sim`
 */
export function voiceSimOf({ search }: { search: string }): boolean {
  const asked = new URLSearchParams(search).getAll(VOICE_SIM_PARAM);
  return stagePreviewOf({ search }) !== undefined && asked.length === 1 && asked[0] === "sim";
}

/**
 * The made-up voice's level at an instant, 0 to 1, already lifted the way {@link stageOrbLevel} lifts a real one:
 * syllables at four to five a second under phrases with pauses between, the owner's a little slower and softer than the
 * voice's own. Silent for every mood but hearing the owner and speaking, as a real call is.
 *
 * @param mood the preview's mood
 * @param timeS seconds since the preview started
 * @returns the level
 */
export function simulatedVoiceLevel({ mood, timeS }: { mood: OrbMood; timeS: number }): number {
  let pace = 1;
  let loudness = 1;
  if (mood === "hearing") {
    pace = 0.85;
    loudness = 0.85;
  } else if (mood !== "speaking") {
    return 0;
  }
  const t = Math.max(0, timeS) * pace;
  const phrase = Math.sqrt(Math.max(0, Math.sin(t * 0.9)));
  const syllable = Math.abs(Math.sin(t * 13.5 + Math.sin(t * 3.1) * 2));
  return Math.min(1, phrase * (0.25 + 0.75 * syllable) * loudness);
}

/**
 * How fast the stage orb moves in each mood, as a multiple of its resting pace: below 1 is quicker. It quickens
 * while it works, settles while it listens, and slows almost to a stop when a turn has stalled.
 */
export const STAGE_PACE: Readonly<Record<OrbMood, number>> = {
  browsing: 0.45,
  code: 0.45,
  connecting: 0.6,
  error: 1.6,
  hearing: 0.8,
  idle: 1,
  looking: 0.45,
  off: 1.4,
  recalling: 0.45,
  reconnecting: 0.75,
  relaying: 0.45,
  slack: 0.45,
  speaking: 0.7,
  stalled: 2.4,
  thinking: 0.35,
  working: 0.5,
  writing: 0.5,
  // Hearing's pace: the stop itself is the star cluster's own beat (`yieldBeat`, `./particleMotion.ts`).
  yielded: 0.8,
};

/** How calm the corner's orb is beside the stage's: its pace this much slower, its movement this much of the stage's. */
export const CORNER_CALM = 0.6;

/**
 * The custom properties an orb is placed with. Collapsed, it is the same orb moving in similar
 * ways with animations a little less pronounced, so it does not distract while the owner looks at other things, and
 * the owner still feels the presence. So `calm` slows every presence's pace and scales down how far the level MOVES it (`--move-lvl`),
 * while the level that LIGHTS it (`--lvl`) stays whole — the glow while it speaks is the part the owner likes.
 *
 * @param calm 1 on the stage, {@link CORNER_CALM} in the corner; above 0
 * @param level the voice's level, 0 to 1
 * @param mood the mood, which picks the pace
 * @returns the three properties, ready for an inline style
 */
export function orbTuning({
  calm,
  level,
  mood,
}: {
  calm: number;
  level: number;
  mood: OrbMood;
}): Readonly<Record<"--lvl" | "--move-lvl" | "--pace", string>> {
  return {
    "--lvl": level.toFixed(3),
    "--move-lvl": (level * calm).toFixed(3),
    "--pace": String(STAGE_PACE[mood] / calm),
  };
}

/** Which view the voice is drawn in: the stage, or the corner — the orb alone or the call card over it. */
export type VoiceView = "stage" | "corner";

/** How far a touch must travel up or down the stage before it counts as the collapse gesture, in CSS pixels. */
export const STAGE_SWIPE_PX = 24;

/** How hard a wheel must turn before it counts — a resting trackpad sends a trickle of tiny deltas. */
export const STAGE_WHEEL_DELTA = 4;

/** What a key press on the console means for the stage. */
export type StageKey = "toggle" | "collapse" | "none";

/**
 * Whether a key press is one of the stage's gestures: Alt+V toggles stage and corner from anywhere in the console,
 * Escape collapses the stage. Neither fires while the owner is typing into a field, so a word with a `v` in it, or an
 * Escape that closes a picker, never moves the view.
 *
 * @param code the `KeyboardEvent.code` — the physical key, since Option+V types `√` on a Mac
 * @param altKey whether Alt (Option) was held
 * @param modified whether Ctrl, Meta or Shift was held as well
 * @param typing whether the press landed in a text field, a select or editable content
 * @param stageOpen whether the stage is showing, which is the only time Escape is the stage's
 * @returns which gesture, or none
 */
export function stageKeyOf({
  code,
  altKey,
  modified,
  typing,
  stageOpen,
}: {
  code: string;
  altKey: boolean;
  modified: boolean;
  typing: boolean;
  stageOpen: boolean;
}): StageKey {
  if (typing || modified) {
    return "none";
  }
  if (altKey && code === "KeyV") {
    return "toggle";
  }
  if (!altKey && code === "Escape" && stageOpen) {
    return "collapse";
  }
  return "none";
}
