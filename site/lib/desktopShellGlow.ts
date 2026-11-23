/**
 * The edge-glow half of the desktop shell's bridge (`desktopShell.ts`): the voice's window reports what its screen-edge
 * glow shows, and the shell draws it in four thin windows along the display's edges (`desktop/src/edgeGlowShell.ts`)
 * rather than the voice's window covering the owner's whole desktop for it. That whole-display window is what macOS's
 * window picker selects wherever the owner points, and what draws over ⌘⇧5. The
 * shell's half of this shape is `desktop/src/edgeGlow.ts` — a separate project, so each side states it and the shell
 * parses it strictly. Pure.
 */
import type { EdgeGlowState } from "./edgeGlow";

/** What the voice's page reports of its edge glow. */
export interface OverlayGlowReport {
  readonly state: EdgeGlowState;
  /** The frame whose flash is drawing now, held for the flash's length, or `null` for none. */
  readonly pulse: string | null;
  /** The voice's own level, 0 to 1, which the speaking glow breathes with. */
  readonly level: number;
}

/** The bridge's glow method, optional: under an older shell the page draws its own glow and holds the display for it. */
export interface GlowBridge {
  /** The voice's window only: what its edge glow shows now. Main refuses it from the console window. */
  readonly reportOverlayGlow?: (input: { readonly report: OverlayGlowReport }) => void;
}

/** The {@link GlowBridge} methods, for the bridge's check that each is absent or a function. */
export const GLOW_OPTIONAL_METHODS = ["reportOverlayGlow"] as const;

/** How the voice's widget hands its glow to the shell (`VoiceShellControl.glow`). */
export interface OverlayGlowLink {
  readonly report: (input: { readonly report: OverlayGlowReport }) => void;
}

/** The steps the level is reported in: the three decimals the speaking glow's opacity is drawn to. */
const LEVEL_STEPS = 1000;

/**
 * The report for one moment of the glow, with no flash as the wire's `null`. The level counts only while the voice
 * speaks, the one state that draws it, and to the precision the glow draws it, so a quiet edge sends nothing new twelve
 * times a second off the output meter's noise.
 *
 * @param state what the edge shows (`edgeGlowOf`)
 * @param flash the frame whose flash is drawing now, or `undefined` for none
 * @param level the voice's own level, 0 to 1 (`stageOrbLevel`)
 * @returns the report the shell parses
 */
export function overlayGlowReport({
  state,
  flash,
  level,
}: {
  state: EdgeGlowState;
  flash: string | undefined;
  level: number;
}): OverlayGlowReport {
  let drawn = 0;
  if (state === "speaking" || state === "shared-speaking") {
    drawn = Math.round(level * LEVEL_STEPS) / LEVEL_STEPS;
  }
  if (flash === undefined) {
    return { level: drawn, pulse: null, state };
  }
  return { level: drawn, pulse: flash, state };
}
