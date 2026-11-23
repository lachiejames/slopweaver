"use client";

import type { CSSProperties, ReactElement } from "react";

import { ORB_PRESENCES, type OrbPresence, type PresenceId } from "../../lib/orbPresence";
import { orbTuning } from "../../lib/voiceStage";
import { MOOD_RING } from "../voice/orbParts";
import { StageOrb } from "../voice/StageOrb";
import { useHydrated } from "./preference";
import { usePresenceChoice } from "./presenceChoice";

/** How lit each preview's orb is: the resting presence, a little brighter than silence so its colours show. */
const PREVIEW_LEVEL = 0.6;

/** Each preview's orb: the stage's calm. */
const STAGE_TUNING: CSSProperties & ReturnType<typeof orbTuning> = orbTuning({
  calm: 1,
  level: PREVIEW_LEVEL,
  mood: "idle",
});

/**
 * One presence's tile: the orb filled with it, live, on the page's own ground and lit in the theme worn now, its name,
 * and the radio that wears it. It carries no colours of its own, so all six show under whichever theme the owner wears.
 *
 * @param presence the presence
 * @param worn whether it is the one the orb wears now
 * @param onWear wears it
 * @returns the tile
 */
function PresenceTile({
  presence,
  worn,
  onWear,
}: {
  presence: OrbPresence;
  worn: boolean;
  onWear: (presence: PresenceId) => void;
}): ReactElement {
  return (
    <label
      className="grid cursor-pointer gap-0 overflow-hidden rounded-[12px] border-2 border-solid border-transparent bg-card text-foreground shadow-sm hover:border-border has-checked:border-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
      data-presence-tile={presence.id}
    >
      <input
        type="radio"
        name="sw-presence"
        value={presence.id}
        checked={worn}
        className="sr-only"
        // Only a presence not worn is a change; pressing the worn one again stores it, so a first visit wearing the
        // star cluster only by default keeps it once pressed, whatever the default later becomes.
        onChange={() => {
          if (!worn) {
            onWear(presence.id);
          }
        }}
        onClick={() => {
          if (worn) {
            onWear(presence.id);
          }
        }}
      />
      <span aria-hidden="true" data-mood="idle" className={`${MOOD_RING} relative block aspect-[16/10] bg-background`}>
        {/* Centred: a square 76% of a 16:10 tile's height is 47.5% of its width. */}
        <span className="absolute top-[12%] left-[26.25%] aspect-square h-[76%]" style={STAGE_TUNING}>
          <StageOrb presence={presence.id} detail="refined" />
        </span>
      </span>
      <span className="flex items-center justify-between gap-2 px-3 py-2 text-[0.85rem] font-medium">
        {presence.name}
        {worn ? <span className="text-[0.72rem] font-normal text-muted-foreground">worn now</span> : null}
      </span>
    </label>
  );
}

/**
 * The Settings modal's Presence tab: what fills the orb (`lib/orbPresence.ts`), apart from the theme that colours it
 * (the presence choice sticks and the theme supplies its colours). One press wears it on the stage and the corner at once, live, with no
 * apply and no undo, and keeps it for the next launch (`usePresenceChoice`). Until hydration the tiles are hidden,
 * since the first render reads the default rather than what the orb wears.
 *
 * @returns the radio group of presences
 */
export function PresencePresets(): ReactElement {
  const presence = usePresenceChoice();
  const hydrated = useHydrated();
  return (
    <fieldset className="m-0 grid gap-3 border-0 p-0 data-[hydrated=false]:invisible" data-hydrated={hydrated}>
      <legend className="mb-1 p-0 text-[0.95rem] font-semibold">Presence</legend>
      <p className="m-0 text-[0.85rem] text-muted-foreground">
        What moves inside the orb, on the stage and in the corner. Your theme supplies its colours, so changing one
        never changes the other.
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
        {ORB_PRESENCES.map((entry) => (
          <PresenceTile key={entry.id} presence={entry} worn={entry.id === presence.value} onWear={presence.set} />
        ))}
      </div>
    </fieldset>
  );
}
