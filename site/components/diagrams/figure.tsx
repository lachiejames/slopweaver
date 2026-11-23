import type { ReactElement, ReactNode } from "react";

import { Arrowhead } from "./Arrowhead";

/**
 * The frame every figure on this site draws inside.
 *
 * It exists because the two defects a figure can have were both frame properties rather than
 * drawing ones — pale fills carrying pale text, and a figure inheriting the page's dark ground and losing
 * its contrast. Holding the frame in one component means a new diagram cannot reintroduce either by
 * forgetting: the card is light in both themes (`app/diagram.css`), the arrowhead is defined once, and
 * the accessible description is a required parameter rather than an optional one.
 *
 * @param label the sentence a screen reader is given INSTEAD of the drawing, so it states the claim
 * @param caption what the figure is evidence FOR, printed under it
 * @param viewBox the drawing's own coordinate space
 * @param arrow the id this figure's arrowhead marker takes, unique per figure
 * @returns the framed figure
 */
export function Figure({
  label,
  caption,
  viewBox,
  arrow,
  children,
}: {
  label: string;
  caption: ReactNode;
  viewBox: string;
  arrow: string;
  children: ReactNode;
}): ReactElement {
  return (
    <figure className="sw-figure">
      <svg viewBox={viewBox} role="img" aria-label={label}>
        <Arrowhead id={arrow} />
        {children}
      </svg>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

/** The gap between two stacked lines in a panel slot, at the 11‑11.5px both slots draw at. */
const LINE_HEIGHT = 16;

/** The three stage hues, and the only ones any figure fills a solid box with. */
export const STAGE = {
  in: "var(--sw-stage-in)",
  mid: "var(--sw-stage-mid)",
  out: "var(--sw-stage-out)",
} as const;

/** A solid, saturated box carrying white text — the shape used for a thing that ACTS. */
export function Solid({
  x,
  y,
  w,
  h,
  fill,
  title,
  detail,
  foot,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  title: string;
  detail?: string;
  foot?: string;
}): ReactElement {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="10" fill={fill} />
      <text
        x={x + w / 2}
        y={y + (detail === undefined ? h / 2 + 5 : 28)}
        textAnchor="middle"
        fontSize="14"
        fontWeight="600"
        fill="#ffffff"
      >
        {title}
      </text>
      {detail === undefined ? null : (
        <text x={x + w / 2} y={y + 48} textAnchor="middle" fontSize="12" fill="#ffffff" opacity="0.88">
          {detail}
        </text>
      )}
      {foot === undefined ? null : (
        <text x={x + w / 2} y={y + h - 12} textAnchor="middle" fontSize="10.5" fill="#ffffff" opacity="0.75">
          {foot}
        </text>
      )}
    </g>
  );
}

/** A pale panel carrying dark text — the shape used for a thing that is READ or STORED. */
/**
 * One line of a panel slot, or several — a caller passes a string when it fits and an array when it does not.
 *
 * SVG text neither wraps nor reports being too wide: a string longer than its panel is drawn straight past
 * the card and cropped by the viewBox, which reads as a SHORTER sentence rather than as a defect. Nine of
 * them shipped that way. So breaking a line is the caller's job, and this is the shape that lets the caller
 * do it without hand-placing a second `<text>` at a y it then has to keep in step with the panel.
 */
type PanelLines = string | readonly string[];

/**
 * The lines of one slot, as an array, whichever shape the caller passed.
 *
 * @param lines one line, or several
 * @returns the lines
 */
function linesOf({ lines }: { lines: PanelLines }): readonly string[] {
  if (typeof lines === "string") {
    return [lines];
  }
  return lines;
}

export function Panel({
  x,
  y,
  w,
  h,
  title,
  detail,
  foot,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  detail?: PanelLines;
  foot?: PanelLines;
}): ReactElement {
  /* `detail` flows DOWN from under the title and `foot` flows UP from the bottom edge. That is why adding a
     line to either slot never moves the other one and never pushes anything outside the card. */
  const detailLines = detail === undefined ? [] : linesOf({ lines: detail });
  const footLines = foot === undefined ? [] : linesOf({ lines: foot });
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="9" fill="var(--sw-figure-panel)" stroke="var(--sw-figure-line)" />
      <text x={x + 14} y={y + 24} fontSize="13" fontWeight="600" fill="var(--sw-figure-ink)">
        {title}
      </text>
      {detailLines.map((line, index) => (
        <text key={line} x={x + 14} y={y + 43 + index * LINE_HEIGHT} fontSize="11.5" fill="var(--sw-figure-muted)">
          {line}
        </text>
      ))}
      {footLines.map((line, index) => (
        <text
          key={line}
          x={x + 14}
          y={y + h - 11 - (footLines.length - 1 - index) * LINE_HEIGHT}
          fontSize="11"
          fill="var(--sw-figure-muted)"
          opacity="0.85"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

/** A small caps label, used for a lane or a stage heading. */
export function Kicker({
  x,
  y,
  text,
  anchor = "middle",
}: {
  x: number;
  y: number;
  text: string;
  anchor?: "start" | "middle";
}): ReactElement {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize="11" letterSpacing="1.6" fill="var(--sw-figure-muted)">
      {text}
    </text>
  );
}

/** One straight arrow, optionally labelled above its midpoint. */
export function Arrow({
  from,
  to,
  y,
  arrow,
  label,
}: {
  from: number;
  to: number;
  y: number;
  arrow: string;
  label?: string;
}): ReactElement {
  return (
    <g>
      <line x1={from} y1={y} x2={to} y2={y} stroke="currentColor" strokeWidth="1.6" markerEnd={`url(#${arrow})`} />
      {label === undefined ? null : (
        <text x={(from + to) / 2} y={y - 9} textAnchor="middle" fontSize="11" fill="var(--sw-figure-muted)">
          {label}
        </text>
      )}
    </g>
  );
}

/** A dashed line — something that CONSTRAINS rather than something that flows. */
export function Rail({ d, arrow }: { d: string; arrow?: string }): ReactElement {
  return (
    <path
      d={d}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeDasharray="5 4"
      markerEnd={arrow === undefined ? undefined : `url(#${arrow})`}
    />
  );
}
