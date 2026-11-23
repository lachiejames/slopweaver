"use client";

/**
 * What hangs off the corner orb's shoulders (`VoiceWidget.tsx`): the X that hides the overlay, and the badge for the
 * work in flight. Each sits inside the slack the shell's window keeps round the widget (`CORNER_SLACK`), so the window
 * cropped round an orb the owner dragged never clips either.
 */
import { X } from "lucide-react";
import type { ReactElement } from "react";

import { MOOD_WORDS, type OrbBadge } from "../../lib/orbMood";
import { BadgeGlyph } from "./orbParts";

/** What the X says about itself, on hover and to a screen reader. */
const HIDE_LABEL = "Hide the voice. Show voice in the menu bar brings it back";

/**
 * The X on the orb's other shoulder from the badge, invisible until the owner hovers the orb or tabs to it, giving something to mouse onto and
 * close. A press takes the whole overlay off the screen and the call runs on; it never ends the call. The orb itself
 * is what drags, never this X. It takes the pointer only while it can be seen: it appears at once on hover or focus and
 * fades only as it goes, so no press lands on an X still invisible.
 *
 * @param onHide takes the overlay off the screen
 * @returns the X
 */
export function HideOverlay({ onHide }: { onHide: () => void }): ReactElement {
  return (
    <button
      type="button"
      aria-label={HIDE_LABEL}
      title={HIDE_LABEL}
      onClick={onHide}
      className="absolute -top-1.5 -right-1.5 z-1 grid size-[1.4rem] cursor-pointer place-items-center rounded-full border-[1.5px] border-solid border-(--v-ring) bg-card p-0 text-muted-foreground opacity-0 pointer-events-none shadow-[0_3px_10px_oklch(0_0_0/45%)] transition-opacity duration-150 group-hover/orb:pointer-events-auto group-hover/orb:opacity-100 group-hover/orb:duration-0 hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:duration-0 focus-visible:outline-2 focus-visible:outline-primary motion-reduce:transition-none"
    >
      <X aria-hidden="true" className="size-3" />
    </button>
  );
}

/**
 * The work in flight, as a bubble on the orb's shoulder. Keyed by badge where it is drawn, so a change of work pops
 * the new one on rather than swapping it silently; the glyph itself sits still, since a turning one is a spinner.
 *
 * @param badge the work in flight
 * @returns the bubble
 */
export function Badge({ badge }: { badge: OrbBadge }): ReactElement {
  return (
    <span
      aria-hidden="true"
      title={MOOD_WORDS[badge]}
      className="pointer-events-none absolute -top-2 -left-2 grid size-[1.65rem] animate-orb-pop place-items-center rounded-full border-[1.5px] border-solid border-(--v-ring) bg-card text-[0.85rem] leading-none shadow-[0_3px_10px_oklch(0_0_0/45%)] motion-reduce:animate-none!"
    >
      <BadgeGlyph badge={badge} size="size-[0.95rem]" />
    </span>
  );
}
