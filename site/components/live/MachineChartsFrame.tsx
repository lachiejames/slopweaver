/**
 * The machine charts' shared frame: the drawn size, the two series hues and their swatches, the hover targets one per
 * sample, and the box every chart draws its marks in.
 */
import type { ReactElement, ReactNode } from "react";

import { type ChartFrame, type MachineSample, sampleWords, xOf } from "../../lib/machineSeries";

/** The drawn width and height of one chart. */
export const WIDTH = 320;
export const HEIGHT = 88;

/** The surface gap between the two stacked CPU bands. */
export const GAP = 2;

/** Each series' fill and stroke on the light and the dark console, and its legend swatch. */
export const FLEET_FILL = "fill-[#2a78d6]/70 dark:fill-[#3987e5]/70";
export const OTHER_FILL = "fill-[#eb6834]/70 dark:fill-[#d95926]/70";
export const LINE = "fill-none stroke-[#2a78d6] dark:stroke-[#3987e5]";
export const FLEET_SWATCH = "bg-[#2a78d6] dark:bg-[#3987e5]";
export const OTHER_SWATCH = "bg-[#eb6834] dark:bg-[#d95926]";

/** The small label row over and under each chart. */
const AXIS = "flex justify-between text-[10px] text-muted-foreground tabular-nums";

/**
 * The hit targets: one per sample, spanning halfway to each neighbour and the chart's whole height, lit while hovered.
 *
 * @returns the targets
 */
export function SampleSlots({
  samples,
  frame,
  timeZone,
}: {
  samples: readonly MachineSample[];
  frame: ChartFrame;
  timeZone: string;
}): ReactElement {
  const xs = samples.map((sample) => xOf({ frame, iso: sample.observedAtIso }));
  return (
    <>
      {samples.map((sample, index) => {
        const here = xs[index];
        let left = 0;
        if (index > 0) {
          left = (xs[index - 1] + here) / 2;
        }
        let right = frame.width;
        if (index < samples.length - 1) {
          right = (here + xs[index + 1]) / 2;
        }
        return (
          <rect
            key={sample.observedAtIso}
            x={left}
            y={0}
            width={Math.max(1, right - left)}
            height={frame.height}
            className="fill-transparent hover:fill-muted"
          >
            <title>{sampleWords({ sample, timeZone })}</title>
          </rect>
        );
      })}
    </>
  );
}

/** One chart's frame: its title, its ceiling label, the marks, the time axis and anything under it. */
export function ChartBox({
  title,
  ceiling,
  label,
  startWord,
  endWord,
  children,
  under,
}: {
  title: string;
  ceiling: string;
  label: string;
  startWord: string;
  endWord: string;
  children: ReactNode;
  under?: ReactNode;
}): ReactElement {
  return (
    <section aria-label={title} className="grid min-w-0 gap-[0.2rem]">
      <h4 className="m-0 text-[0.8rem] font-[650]">{title}</h4>
      <div className={AXIS}>
        <span>{ceiling}</span>
      </div>
      <svg viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`} className="block w-full" role="img" aria-label={label}>
        {children}
        <line x1={0} x2={WIDTH} y1={HEIGHT} y2={HEIGHT} className="stroke-border" strokeWidth={1} />
      </svg>
      <div className={AXIS}>
        <span>{startWord}</span>
        <span>{endWord}</span>
      </div>
      {under}
    </section>
  );
}
