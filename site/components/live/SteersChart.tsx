"use client";

/*
 * The Alignment page's steers chart:how many times the owner steered each week, a column per week, steers given for the first time
 * at its foot and steers the owner had to give again stacked on them — so the whole column is the number the owner wants coming
 * down, and the top segment is the part that says a steer did not carry forward. The arithmetic, and the owner's words
 * asking for it, are `../../lib/steersChart.ts`; this file only draws.
 *
 * Two hues, identity only and never a state: blue for first given, orange for said again, each stepped for the light
 * and the dark console. Both pairs pass the dataviz palette validator against its light and dark surfaces (adjacent
 * CVD ΔE 24.7 light / 26.8 dark, normal-vision 33.6 / 31.8): `node <dataviz skill>/scripts/validate_palette.js
 * "#2a78d6,#eb6834" --mode light` and `"#3987e5,#d95926" --mode dark`. Every value a column draws is also in its
 * hover title, its focus label and the table behind the fold, so nothing rests on colour or on hovering.
 *
 * The SVG draws marks only. Each column's total and first day are HTML rows on the same grid of columns, in the
 * console's own ink tokens, because an SVG text element paints with a fill the theme's contrast tests do not measure
 * (`site/__tests__/unit/theme/contrastOpacity.test.ts`); for the same reason a hovered or focused column is marked by a backdrop
 * behind its bars, never by fading it.
 */

import type { ReactElement } from "react";

import { type SteersChart as Chart, dayLabel, labelledColumns, type SteersWeek } from "../../lib/steersChart";

/** The drawn width, the bars' height and the headroom over the tallest column. */
const WIDTH = 640;
const BARS = 120;
const TOP = 4;

/** The surface gap between the two segments of one column. */
const GAP = 2;

/** The most printed totals and dates the width holds, a short day-and-month label at 10px being about a twelfth of a narrow console. */
const MOST_LABELS = 12;

/** A label centred on its column, spilling into unlabelled neighbours rather than truncating. */
const LABEL = "flex justify-center whitespace-nowrap";

/** Each series' fill on the light and the dark console, and its legend swatch. */
const FIRST_FILL = "fill-[#2a78d6] dark:fill-[#3987e5]";
const AGAIN_FILL = "fill-[#eb6834] dark:fill-[#d95926]";
const FIRST_SWATCH = "bg-[#2a78d6] dark:bg-[#3987e5]";
const AGAIN_SWATCH = "bg-[#eb6834] dark:bg-[#d95926]";

/** A column's days as the page prints them, a day-and-month range, or one day alone. */
function rangeOf({ week }: { week: SteersWeek }): string {
  if (week.fromDay === week.throughDay) {
    return dayLabel({ day: week.fromDay });
  }
  return `${dayLabel({ day: week.fromDay })} to ${dayLabel({ day: week.throughDay })}`;
}

/** What one column holds, said in full: its hover title and its focus label. */
function columnWords({ week, newest }: { week: SteersWeek; newest: boolean }): string {
  let days = `${String(week.dayCount)} days`;
  if (week.dayCount === 1) {
    days = "1 day";
  }
  let soFar = "";
  if (newest) {
    soFar = ", up to this reading";
  }
  const total = week.firstGiven + week.saidAgain;
  return `${rangeOf({ week })} (${days}${soFar}): ${String(total)} times you steered, ${String(week.firstGiven)} first given, ${String(week.saidAgain)} said again`;
}

/** One column: its two segments on the baseline, over a backdrop the size of its slot. */
function Column({
  week,
  at,
  slot,
  scale,
  newest,
}: {
  week: SteersWeek;
  at: number;
  slot: number;
  scale: number;
  newest: boolean;
}): ReactElement {
  const width = Math.min(56, slot * 0.6);
  const x = at * slot + (slot - width) / 2;
  const baseline = TOP + BARS;
  const firstTall = week.firstGiven * scale;
  let gap = 0;
  if (week.firstGiven > 0 && week.saidAgain > 0) {
    gap = GAP;
  }
  const againTall = Math.max(0, week.saidAgain * scale - gap);
  const words = columnWords({ newest, week });
  return (
    <g tabIndex={0} role="img" aria-label={words} className="group outline-none">
      <title>{words}</title>
      {/* The hit target is the column's whole slot, never only its painted pixels; it lights while hovered or focused. */}
      <rect
        x={at * slot}
        y={0}
        width={slot}
        height={TOP + BARS}
        className="fill-transparent group-hover:fill-muted group-focus-visible:fill-muted"
      />
      <rect x={x} y={baseline - firstTall} width={width} height={firstTall} className={FIRST_FILL} />
      <rect x={x} y={baseline - firstTall - gap - againTall} width={width} height={againTall} className={AGAIN_FILL} />
    </g>
  );
}

/** The table behind the fold: every column's numbers, readable without the chart. */
function WeekTable({ weeks }: { weeks: readonly SteersWeek[] }): ReactElement {
  return (
    <details className="text-[0.75rem]">
      <summary className="cursor-pointer text-muted-foreground">the numbers, week by week</summary>
      <table className="mt-[0.3rem] w-full border-collapse text-left tabular-nums">
        <thead className="text-muted-foreground">
          <tr>
            <th className="font-semibold">week</th>
            <th className="font-semibold">days</th>
            <th className="font-semibold">first given</th>
            <th className="font-semibold">said again</th>
            <th className="font-semibold">times you steered</th>
          </tr>
        </thead>
        <tbody>
          {weeks.toReversed().map((week) => (
            <tr key={week.fromDay}>
              <td>{rangeOf({ week })}</td>
              <td>{week.dayCount}</td>
              <td>{week.firstGiven}</td>
              <td>{week.saidAgain}</td>
              <td>{week.firstGiven + week.saidAgain}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** The sentence under the chart saying what the columns leave out, or nothing when they hold every time. */
function UnplacedLine({ chart }: { chart: Chart }): ReactElement | null {
  const unplaced = chart.firstGiven.unplaced + chart.saidAgain.unplaced;
  if (unplaced === 0) {
    return null;
  }
  return (
    <p className="m-0 text-[0.75rem] text-warning">
      {unplaced} {unplaced === 1 ? "time" : "times"} you steered ({chart.firstGiven.unplaced} first given,{" "}
      {chart.saidAgain.unplaced} said again) {unplaced === 1 ? "carries" : "carry"} no instant this chart can place, so
      no column holds {unplaced === 1 ? "it" : "them"}
    </p>
  );
}

/**
 * The chart, with its legend, its notes and its table.
 *
 * @param chart the columns and counts `steersChart` derived from the register
 * @returns the section
 */
export function SteersChart({ chart }: { chart: Chart }): ReactElement {
  const { weeks } = chart;
  if (weeks.length === 0) {
    return (
      <section aria-label="Times you steered, per week" className="grid gap-[0.4rem]">
        <p className="sw-tile-note">no time you steered carries an instant to chart</p>
        <UnplacedLine chart={chart} />
      </section>
    );
  }
  // A reduce, never a spread into Math.max, which throws once the argument list outgrows the call stack.
  const top = weeks.reduce((tallest, week) => Math.max(tallest, week.firstGiven + week.saidAgain), 1);
  const slot = WIDTH / weeks.length;
  // The label rows split the same width into the same number of equal columns, so each label sits under its column.
  const columns = { gridTemplateColumns: `repeat(${String(weeks.length)}, minmax(0, 1fr))` };
  const labelled = labelledColumns({ count: weeks.length, most: MOST_LABELS });
  const oldest = weeks.at(0);
  const shortOldest = oldest !== undefined && weeks.length > 1 && oldest.dayCount < 7;
  return (
    <section aria-label="Times you steered, per week" className="grid gap-[0.4rem]">
      <h4 className="m-0 text-[0.86rem] font-[650]">Times you steered, per week</h4>
      <div>
        <div aria-hidden className="grid text-[11px] tabular-nums" style={columns}>
          {weeks.map((week, at) => (
            <span key={week.fromDay} className={LABEL}>
              {labelled[at] === true && week.firstGiven + week.saidAgain}
            </span>
          ))}
        </div>
        <svg viewBox={`0 0 ${String(WIDTH)} ${String(TOP + BARS)}`} className="block w-full">
          {weeks.map((week, at) => (
            <Column
              key={week.fromDay}
              at={at}
              newest={at === weeks.length - 1}
              scale={BARS / top}
              slot={slot}
              week={week}
            />
          ))}
          <line x1={0} x2={WIDTH} y1={TOP + BARS} y2={TOP + BARS} className="stroke-border" strokeWidth={1} />
        </svg>
        <div aria-hidden className="grid text-[10px] text-muted-foreground" style={columns}>
          {weeks.map((week, at) => (
            <span key={week.fromDay} className={LABEL}>
              {labelled[at] === true && dayLabel({ day: week.fromDay })}
            </span>
          ))}
        </div>
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 pl-0 text-[0.78rem]">
        <li className="flex items-center gap-1">
          <span aria-hidden className={`inline-block h-[0.6rem] w-[0.6rem] rounded-[2px] ${FIRST_SWATCH}`} />
          first given <span className="text-muted-foreground tabular-nums">{chart.firstGiven.placed}</span>
        </li>
        <li className="flex items-center gap-1">
          <span aria-hidden className={`inline-block h-[0.6rem] w-[0.6rem] rounded-[2px] ${AGAIN_SWATCH}`} />
          said again <span className="text-muted-foreground tabular-nums">{chart.saidAgain.placed}</span>
        </li>
      </ul>
      <p className="m-0 text-[0.72rem] text-muted-foreground">
        Each column is a week of your days, dated by its first; the newest runs only up to this reading
        {shortOldest && `, and the oldest holds ${String(oldest.dayCount)} ${oldest.dayCount === 1 ? "day" : "days"}`}.
        Whether a steer was about capacity or about alignment is not split out: nothing has read your steers for that
        yet.
      </p>
      <UnplacedLine chart={chart} />
      <WeekTable weeks={weeks} />
    </section>
  );
}
