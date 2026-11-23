/**
 * The Alignment page's one chart shape: a line per series, one point per week, over faint bars for a baseline when
 * there is one. The Slack-steers chart (`./SlackSteers.tsx`) and the cut-ins chart (`./ScriptedCutIns.tsx`) both draw
 * it, so the two read the same way on one page.
 */

import type { ReactElement } from "react";

import { linePoints } from "../../lib/slackSteers";

/** One line on the chart. */
export interface WeeklySeries {
  readonly key: string;
  /** Identity only, never a state: no pass or fail colour on this page. */
  readonly colour: string;
  /** One count per week, oldest first. */
  readonly counts: readonly number[];
}

/**
 * The chart. Hidden from assistive tech: the title, the legend's counts and the state line beside every chart carry
 * what it draws in words.
 *
 * @param series the lines, each with its own colour
 * @param reviewed one baseline count per week drawn as faint bars, or `undefined` for none
 * @param width the drawn width
 * @param height the drawn height
 * @returns the SVG
 */
export function WeeklyChart({
  series,
  reviewed,
  width,
  height,
}: {
  series: readonly WeeklySeries[];
  reviewed: readonly number[] | undefined;
  width: number;
  height: number;
}): ReactElement {
  const top = Math.max(1, ...series.flatMap((one) => one.counts));
  let reviewTop = 1;
  let slot = 0;
  if (reviewed !== undefined && reviewed.length > 0) {
    reviewTop = Math.max(1, ...reviewed);
    slot = width / reviewed.length;
  }
  return (
    // Stretched to the card's width at its own height: a viewBox scaled whole grew a 640×120 chart to a third of the
    // page on a wide window, a flat line under an empty block. The strokes keep their width while the x axis stretches.
    <svg
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height: `${String(height)}px` }}
      aria-hidden="true"
    >
      {reviewed?.map((count, at) => {
        const tall = (count / reviewTop) * height;
        return (
          <rect
            key={`r${String(at)}`}
            x={at * slot}
            y={height - tall}
            width={Math.max(1, slot - 1)}
            height={tall}
            className="fill-muted-foreground opacity-15"
          />
        );
      })}
      {series.map((one) => (
        <polyline
          key={one.key}
          points={linePoints({ counts: one.counts, height: height - 2, top, width })}
          fill="none"
          stroke={one.colour}
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
