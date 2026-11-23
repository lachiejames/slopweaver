"use client";

/**
 * The stage's switches, each kept in this browser and read live: a flip applies on the next render, mid-call, with
 * nothing to restart. Every behaviour this entry adds gets a toggle — bar
 * the edge glow, which is constant.
 */
import { useCallback } from "react";

import { isStageSwitch, STAGE_TOGGLES, type StageSwitch, type StageToggle } from "../../lib/voiceStage";
import { usePreference } from "../console/preference";

/** One switch: whether it is on, and its setter. */
export interface StageSwitchState {
  readonly on: boolean;
  readonly set: (on: boolean) => void;
}

/** Every switch, by toggle. */
export type StageToggles = Readonly<Record<StageToggle, StageSwitchState>>;

/** One switch, on until the owner turns it off. Its setter is stable across renders, so a callback may hold it. */
function useSwitch({ toggle }: { toggle: StageToggle }): StageSwitchState {
  const stored = usePreference({ accept: isStageSwitch, fallback: "on", key: STAGE_TOGGLES[toggle].key });
  const write = stored.set;
  const set = useCallback(
    (on: boolean): void => {
      write(on ? "on" : "off");
    },
    [write],
  );
  return { on: stored.value === "on", set };
}

/**
 * The stage's switches. Every caller shares one value per switch (`usePreference` reads one store), so the Settings
 * modal and the stage agree.
 *
 * @returns each switch's state and setter
 */
export function useStageToggles(): StageToggles {
  const activity = useSwitch({ toggle: "activity" });
  const openCards = useSwitch({ toggle: "openCards" });
  const previews = useSwitch({ toggle: "previews" });
  return { activity, openCards, previews };
}

/**
 * Set one switch by name — the voice's route to the very switches the Settings modal clicks, so telling it and
 * clicking flip the same stored value.
 *
 * @returns a stable setter taking the switch and which way to set it
 */
export function useStageSwitchSetter(): (change: { setting: StageToggle; state: StageSwitch }) => void {
  const { activity, openCards, previews } = useStageToggles();
  const setActivity = activity.set;
  const setOpenCards = openCards.set;
  const setPreviews = previews.set;
  return useCallback(
    ({ setting, state }: { setting: StageToggle; state: StageSwitch }): void => {
      const setters: Record<StageToggle, (on: boolean) => void> = {
        activity: setActivity,
        openCards: setOpenCards,
        previews: setPreviews,
      };
      setters[setting](state === "on");
    },
    [setActivity, setOpenCards, setPreviews],
  );
}
