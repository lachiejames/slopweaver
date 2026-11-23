"use client";

/**
 * The Settings modal's call section: what the stage shows, and which sound the orb's badge makes. A second place for
 * preferences, such as the stage's gear mid-call, clutters the call and may conflict with what is
 * being said on it, so every one of these is chosen here and the stage, which has no settings of its own, only honours
 * it (`VoiceStage.tsx`). Each control writes the very preference the stage reads (`usePreference`), which reaches the
 * voice's own window live with nothing to restart, mid-call included. The voice flipping a switch when the owner asks it to
 * writes the same value (`useStageSwitchSetter`). Where the voice is drawn is no setting: it stays where the owner last left
 * it (`site/lib/voiceWindow.ts`). Nor is the edge glow: it is constant through every call, with no configurability option.
 */
import type { ReactElement } from "react";

import { STAGE_TOGGLE_ORDER, STAGE_TOGGLES } from "../../lib/voiceStage";
import { useHydrated } from "../console/preference";
import { CueSoundPick } from "./OrbCues";
import { useStageToggles } from "./useStageToggles";

/** One switch's row. */
const SWITCH = "flex w-fit cursor-pointer items-center gap-[0.5rem] text-[0.85rem]";

/** The sounds row: a switch's row, its picker drawn as the console's quiet fields are. */
const SOUNDS = `${SWITCH} [&_select]:rounded-[6px] [&_select]:border [&_select]:border-solid [&_select]:border-border [&_select]:bg-(--c-panel) [&_select]:px-[0.3rem] [&_select]:py-[0.1rem] [&_select]:text-foreground`;

/**
 * The call's settings. Hidden until hydration, as the themes and presences are, since the first render reads each default rather
 * than what the owner chose.
 *
 * @returns the section
 */
export function CallSettings(): ReactElement {
  const hydrated = useHydrated();
  const toggles = useStageToggles();
  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0 data-[hydrated=false]:invisible" data-hydrated={hydrated}>
      <legend className="mb-1 p-0 text-[0.95rem] font-semibold">The call</legend>
      <p className="m-0 text-[0.85rem] text-muted-foreground">
        What a voice call shows and does, reaching a call already up.
      </p>
      {STAGE_TOGGLE_ORDER.map((toggle) => (
        <label key={toggle} className={SWITCH} title={STAGE_TOGGLES[toggle].title}>
          <input
            type="checkbox"
            checked={toggles[toggle].on}
            onChange={(event) => {
              toggles[toggle].set(event.target.checked);
            }}
          />
          {STAGE_TOGGLES[toggle].label}
        </label>
      ))}
      <CueSoundPick className={SOUNDS} />
    </fieldset>
  );
}
