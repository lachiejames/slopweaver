"use client";

/**
 * The messenger's band: what the owner is looking at, and what the voice has actually read of it, in the application's colour.
 * The words are `site/lib/messengerBand.ts`'s, so everything the band claims comes off a settled tool call. One fixed height:
 * the eyebrow and the sight share the first line and the title takes one truncated line under them, its whole text
 * on hover, so a long pull request title never grows the band.
 */
import type { ReactElement } from "react";

import {
  type FrontAppBandSample,
  type MessengerBandTone,
  type MessengerSightFill,
  messengerBand,
  messengerReadsOf,
} from "../../lib/messengerBand";
import { desktopBridge } from "./useDesktopShell";
import type { VoiceState } from "./voiceContext";

/** Each tone's colour, the mockup's, as the class that sets the band's `--band`. */
const TONES: Readonly<Record<MessengerBandTone, string>> = {
  chrome: "[--band:oklch(0.72_0.13_255)]",
  cmux: "[--band:oklch(0.76_0.06_230)]",
  other: "[--band:oklch(0.7_0.012_250)]",
  slack: "[--band:oklch(0.68_0.15_330)]",
  slopweaver: "[--band:oklch(0.72_0.14_185)]",
};

/** How the sight glyph fills. */
const FILLS: Readonly<Record<MessengerSightFill, string>> = {
  full: "bg-current",
  half: "bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)]",
  none: "",
};

/**
 * The band.
 *
 * @param voice the console voice's state
 * @param front the application in front of the owner, `undefined` when Slopweaver is
 * @param nowMs the instant the ages are read from
 * @returns the band
 */
export function MessengerBand({
  voice,
  front,
  nowMs,
}: {
  voice: VoiceState;
  front: FrontAppBandSample | undefined;
  nowMs: number;
}): ReactElement {
  const canLook =
    desktopBridge()?.supportsTypedScreenLook === true ||
    (voice.callActive && (voice.screenSight === "native" || voice.sharing !== undefined));
  const openTitle = voice.bandPlace.openTitle;
  const band = messengerBand({
    canLook,
    front,
    nowMs,
    openCard: voice.openCard === undefined ? undefined : { key: voice.openCard, title: openTitle },
    page: { path: voice.bandPlace.path, title: voice.pageTitle === "" ? "This page" : voice.pageTitle },
    reads: messengerReadsOf({ lines: voice.tools }),
  });
  return (
    <section
      aria-label="what the voice can see"
      data-band={band.kind}
      data-card-row="band"
      className={`grid h-[3.1rem] shrink-0 grid-rows-[1rem_1.3rem] content-center overflow-hidden border-0 border-y border-l-4 border-solid border-y-border border-l-(--band) bg-[color-mix(in_oklch,var(--band)_15%,var(--c-panel))] pr-[0.8rem] pl-[0.8rem] ${TONES[band.tone]}`}
    >
      <span className="flex min-w-0 items-center gap-[0.5rem]">
        <span className="max-w-[60%] shrink-0 truncate text-[10.5px] font-[650] tracking-[0.07em] text-(--band) uppercase">
          {band.eyebrow}
        </span>
        <span className="flex min-w-0 items-center gap-[0.35rem] text-[11px] text-muted-foreground">
          <span
            aria-hidden="true"
            data-sight={band.sight.fill}
            className={`size-[9px] shrink-0 rounded-full border-[1.5px] border-solid border-current ${FILLS[band.sight.fill]}`}
          />
          <span className="min-w-0 truncate">{band.sight.words}</span>
        </span>
      </span>
      <span className="truncate text-[13.6px] leading-[1.3rem] font-[620] text-foreground" title={band.title}>
        {band.title}
      </span>
    </section>
  );
}
