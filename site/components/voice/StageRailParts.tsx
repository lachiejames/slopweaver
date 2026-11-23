"use client";

/**
 * The parts the call card's controls and the stage's corner control are drawn from: one round icon button of one size,
 * an icon of one size and weight, and the tooltip that carries its word. The stage's bottom bar draws larger controls
 * of its own (`StageControls.tsx`) and reuses only the tooltip. Icons, never text, face the controls — so the word is the control's accessible name and its tooltip, never
 * its face. Which controls show, and each one's word, is `../../lib/stageRail.ts`.
 */
import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

/** A rail control's face, without its shape: the corner's border and fill, ringed in the mood's colour when pressed. */
const CONTROL_FACE =
  "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center border border-solid border-border bg-card p-0 text-foreground transition-[background-color,border-color,color] duration-160 hover:bg-(--c-panel) disabled:cursor-default disabled:opacity-50 aria-pressed:border-(--v-ring) aria-pressed:bg-[color-mix(in_oklch,var(--v-ring)_16%,var(--c-card))] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-primary";

/**
 * One rail control: a round icon button.
 */
export const ICON_CONTROL = `${CONTROL_FACE} w-8 rounded-[999px]`;

/**
 * The microphone and speaker chevron, Google Meet's: the narrow left half of one pill whose right half is the
 * microphone control beside it (`JOINED_MIC`). The call's audio pickers take
 * inspiration from Meet's icon buttons and where they are positioned. Alone — before the call has a mute — it
 * is a round control of its own.
 */
export const AUDIO_CHEVRON = `${CONTROL_FACE} w-6 rounded-l-[999px] border-r-0 [&:last-child]:w-8 [&:last-child]:rounded-r-[999px] [&:last-child]:border-r`;

/** The microphone control as the right half of the chevron's pill. */
export const JOINED_MIC = `${CONTROL_FACE} w-8 rounded-r-[999px]`;

/**
 * A rail icon, the same size and stroke on every control.
 *
 * @param icon the glyph
 * @returns the icon, hidden from a screen reader: the control carries the word
 */
export function RailIcon({ icon: Icon }: { icon: LucideIcon }): ReactElement {
  return <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />;
}

/**
 * The tooltip that names a rail control on hover or focus. It sits above the stage, which is itself over the
 * console at `z-60`; the primitive's own `z-50` would draw it under the stage.
 *
 * @param word what the control does, as its tooltip
 * @param side where it opens: below, unless the control sits at the bottom of its card
 * @param children the control, which takes the trigger's props
 * @returns the control with its tooltip
 */
export function RailTip({
  word,
  side = "bottom",
  children,
}: {
  word: string;
  side?: "top" | "bottom";
  children: ReactElement;
}): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="z-70" side={side} sideOffset={6}>
        {word}
      </TooltipContent>
    </Tooltip>
  );
}
