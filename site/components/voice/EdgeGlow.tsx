"use client";

/**
 * The glow round the window's edge, drawn over everything in both views: steady in the looking colour while the owner's
 * screen is shared, one flash per frame the voice takes — with or without a share — and a soft glow breathing with
 * the voice while it speaks.
 * The states and the owner's words are in `site/lib/edgeGlow.ts`.
 *
 * Portalled to the body above the stage (z-60), because the widget's own `fixed` box is a stacking context that would
 * cap it under the stage; it never takes the pointer. Reduce-motion keeps the steady border and drops the flash —
 * except with no steady border (the desktop app's own look), where the flash is the only mark a picture was taken, so
 * it stays; it is an opacity fade, with nothing moving.
 *
 * In the desktop app it draws nothing: it reports the glow to the shell, whose four screen-edge strip windows draw it
 * (`desktop/src/edgeGlowShell.ts`), so the voice's window keeps to its corner through a call. It still decides each
 * flash — spent as it is reported, ended by a timer the flash's length — so a flash plays once whichever draws it.
 */
import { Portal } from "radix-ui";
import { type CSSProperties, type ReactElement, useEffect, useState } from "react";

import { type OverlayGlowLink, overlayGlowReport } from "../../lib/desktopShellGlow";
import { type EdgeGlowState, pulseMove } from "../../lib/edgeGlow";
import { MOOD_RING } from "./orbParts";

/** The looking mood's colour (`MOOD_RING`, `orbParts.tsx`): the share reads as the voice's eyes. */
const LOOKING = "oklch(0.86 0.16 95)";

/**
 * The edge layer: the whole window, never the pointer. It wears the speaking mood's ring (`MOOD_RING`, and the
 * `data-mood` on the layer), so the voice's glow is the speaking orb's colour with no second copy of it.
 */
const LAYER = `pointer-events-none fixed inset-0 z-70 ${MOOD_RING}`;

/** The steady border while the share is open. */
const SHARED: CSSProperties = {
  boxShadow: `inset 0 0 0 2px ${LOOKING}, inset 0 0 22px 2px color-mix(in oklch, ${LOOKING} 45%, transparent)`,
};

/** How long one flash plays. */
const PULSE_MS = 900;

/** The flash for one frame: the border thrown wide and bright, once. */
const PULSE: CSSProperties = {
  animation: `sw-edge-pulse ${PULSE_MS}ms ease-out 1 both`,
  boxShadow: `inset 0 0 0 4px ${LOOKING}, inset 0 0 70px 14px color-mix(in oklch, ${LOOKING} 70%, transparent)`,
};

/** The speaking glow, breathing with the voice's own level. */
const SPOKEN: CSSProperties = {
  boxShadow: "inset 0 0 48px 6px color-mix(in oklch, var(--v-ring) 55%, transparent)",
  opacity: "calc(0.25 + var(--edge-lvl) * 0.75)",
  transition: "opacity 140ms ease-out",
};

/**
 * The edge glow.
 *
 * @param state what the edge shows (`edgeGlowOf`)
 * @param pulses whether a frame may flash the edge now (`framePulsesOn`) — in the desktop app with no steady border
 * @param pulse the frame just taken, whose key flashes the edge once, or `undefined`
 * @param level the voice's own level, 0 to 1, which the speaking glow breathes with
 * @param ready the window covers the whole display, menu bar and Dock included, so the edge is the screen's — false
 * while the desktop overlay sits in its corner, when nothing is drawn and a pending flash waits rather than being spent
 * round the corner
 * @param onLit told whether the edge has anything to show, a pending flash included, so the desktop overlay can grow
 * its window for it and shrink it again once the flash has played
 * @param link the desktop shell that draws the edge in its own screen-edge windows (`desktop/src/edgeGlowShell.ts`):
 * the glow is reported to it and nothing is drawn here; absent in a browser and under an older shell
 * @returns the glow, or nothing while the edge is dark
 */
export function EdgeGlow({
  state,
  pulses,
  pulse,
  level,
  ready,
  onLit,
  link,
}: {
  state: EdgeGlowState;
  pulses: boolean;
  pulse: string | undefined;
  level: number;
  ready: boolean;
  onLit: (lit: boolean) => void;
  link?: OverlayGlowLink | undefined;
}): ReactElement | null {
  // The last pulse spent and the flash in flight. Held by the instance the widget keeps mounted through every state, so
  // neither a toggle flipped back on nor a share reopened shows a frame late or twice (`pulseMove`).
  const [spent, setSpent] = useState<string | undefined>(undefined);
  const [flashing, setFlashing] = useState<string | undefined>(undefined);
  const shared = state === "shared" || state === "shared-speaking";
  const move = pulseMove({ flashing, pulse, pulses, spent });
  // Adjusting state from props during render: React re-renders at once, before anything is painted.
  if (move.spendUnseen) {
    setSpent(pulse);
  }
  if (move.dropFlashing) {
    setFlashing(undefined);
  }
  // Under a shell that draws the edge itself, the flash starts the moment it is reported, and a timer the length of
  // its animation ends it, since no animation here says so.
  if (link !== undefined && move.draw && pulse !== flashing) {
    setSpent(pulse);
    setFlashing(pulse);
  }
  const lit = state !== "off" || move.draw;
  useEffect(() => {
    onLit(lit);
  }, [onLit, lit]);
  useEffect(() => {
    if (link === undefined || flashing === undefined) {
      return;
    }
    const ends = setTimeout(() => {
      setFlashing(undefined);
    }, PULSE_MS);
    return () => {
      clearTimeout(ends);
    };
  }, [link, flashing]);
  let flash: string | undefined;
  if (move.draw) {
    flash = pulse;
  }
  useEffect(() => {
    link?.report({ report: overlayGlowReport({ flash, level, state }) });
  }, [link, flash, level, state]);
  // A widget taken down leaves no edge lit behind it.
  useEffect(
    () => () => {
      link?.report({ report: overlayGlowReport({ flash: undefined, level: 0, state: "off" }) });
    },
    [link],
  );
  // Nothing mounted while the window is not the screen: a flash that never starts is never spent, so it plays once
  // the window has grown. Nothing mounted at all while the shell draws the edge.
  if (link !== undefined || !lit || !ready) {
    return null;
  }
  const speaking = state === "speaking" || state === "shared-speaking";
  const tuning: CSSProperties & Record<"--edge-lvl", string> = { "--edge-lvl": level.toFixed(3) };
  return (
    <Portal.Root aria-hidden="true" data-edge={state} data-mood="speaking" className={LAYER} style={tuning}>
      {speaking ? <span className="absolute inset-0" style={SPOKEN} /> : null}
      {shared ? <span className="absolute inset-0" style={SHARED} /> : null}
      {move.draw ? (
        <span
          key={pulse}
          className={shared ? "absolute inset-0 motion-reduce:hidden" : "absolute inset-0"}
          style={PULSE}
          onAnimationStart={() => {
            setSpent(pulse);
            setFlashing(pulse);
          }}
          onAnimationEnd={() => {
            setFlashing(undefined);
          }}
        />
      ) : null}
    </Portal.Root>
  );
}
