"use client";

/**
 * The voice's orb: the presence the owner picked filling it (`site/lib/orbPresence.ts`), lit in the colours of the theme worn
 * (`site/lib/orbRamp.ts`), drawn on one canvas (`StageParticles.tsx`). It carries magic and wonder without turning
 * cringe or cliché; the presence, which dictates what happens inside the orb, is apart from the theme.
 *
 * **No presence marks work with a light running round it.** A white line going round in circles
 * reads as a spinning wheel — a loading indicator — so what it is reading is the badge's and
 * the words', and the orb only lives.
 *
 * The same orb is the stage's, the corner's when the stage collapses (`VoiceWidget.tsx`), calmer, and both of each
 * Settings theme's and presence's previews (`components/console/ThemePresets.tsx`, `PresencePresets.tsx`): its pace
 * from `--pace`, its light from `--lvl` (the voice's level, 0 to 1) and its movement from `--move-lvl`, all set once by
 * whoever places it (`orbTuning`, `site/lib/voiceStage.ts`). The frame loop is outside React, so the session's twelve
 * renders a second only rewrite a number; nothing here is keyed by mood, level or presence, so nothing remounts. Under
 * reduce-motion only the level's swell and light move. While the call reconnects, the whole orb squashes and dents for
 * a moment (`sw-stage-orb` in `console-tw.css`, keyed by the nearest `data-mood`); under reduce-motion it takes that
 * shape at once, with neither the dents nor the ease into it.
 */
import type { ReactElement } from "react";

import type { PresenceId } from "../../lib/orbPresence";
import type { SwarmDetail } from "../../lib/swarmDetail";
import { StageParticles } from "./StageParticles";

/**
 * The orb filled with one presence, inside the one box a reconnect squashes. The canvas reads the presence off
 * `data-presence` each frame, so a change of presence swaps what is drawn in place rather than remounting the canvas.
 *
 * @param presence what fills it
 * @param detail how much work the presence may do (`swarmDetail.ts`): refined for the stage and the full-screen
 *   previews; plain for the corner and its previews
 * @returns the orb, filling the square it is placed in
 */
export function StageOrb({ presence, detail }: { presence: PresenceId; detail: SwarmDetail }): ReactElement {
  return (
    <span
      aria-hidden="true"
      data-presence={presence}
      data-detail={detail}
      className="sw-stage-orb @container pointer-events-none absolute inset-0 motion-reduce:animate-none! motion-reduce:transition-none!"
    >
      <StageParticles />
    </span>
  );
}
