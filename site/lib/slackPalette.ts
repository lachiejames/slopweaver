/*
 * Slack's own dark desktop colours, which every Slack message surface in the console draws in whatever the theme
 * (`./theme.ts` `slackSurfaceBlock`). Pure data and one formatter, so the unit test can measure each word against
 * the ground.
 */

/** A colour laid at an opacity over Slack's ground: a hairline, or the tint under a chip, a code span or a badge. */
export interface SlackTint {
  /** The colour, `#rrggbb`. */
  readonly colour: string;
  /** Its opacity, 0 through 1. */
  readonly alpha: number;
}

/** Slack's own dark desktop colours, each `#rrggbb` or a tint of one. */
export interface SlackPalette {
  /** The message pane's ground. */
  readonly ground: string;
  /** A message's words. */
  readonly text: string;
  /** A timestamp, a bullet, an emoji code: Slack's secondary grey. */
  readonly muted: string;
  /** A link. */
  readonly link: string;
  /** A mention chip's words. */
  readonly chipText: string;
  /** Inline code's words, Slack's orange. */
  readonly codeText: string;
  /** Every hairline: the surface's edge, a header's rule, a code box. */
  readonly border: SlackTint;
  /** Under a mention chip. */
  readonly chipFill: SlackTint;
  /** Under inline code and a code block. */
  readonly codeFill: SlackTint;
  /** Slack's quiet fill — an `APP` badge, a face still loading — which `bg-muted` draws inside the surface. */
  readonly quietFill: SlackTint;
}

/**
 * A Slack message surface — a draft, a stored thread, a drafted reply — is drawn in Slack's DARK desktop palette in
 * every look, Daylight included, because the Slack the owner reads is dark, and the surface should look like Slack's native UI.
 * Written here rather than in `console-tw.css` for the reason the palettes are: the unit test measures every word the
 * surface draws against this ground, so a colour that sinks on it cannot ship.
 */
export const SLACK_PALETTE: SlackPalette = {
  border: { alpha: 0.13, colour: "#d1d2d3" },
  chipFill: { alpha: 0.1, colour: "#1d9bd1" },
  chipText: "#1d9bd1",
  codeFill: { alpha: 0.04, colour: "#e8e8e8" },
  codeText: "#e8912d",
  ground: "#1a1d21",
  link: "#1d9bd1",
  muted: "#ababad",
  quietFill: { alpha: 0.13, colour: "#e8e8e8" },
  text: "#d1d2d3",
};

/**
 * A tint as CSS writes it.
 *
 * @returns the colour at its opacity, such as `rgb(209 210 211 / 13%)`
 */
export function slackTintCss({ tint }: { tint: SlackTint }): string {
  const channels = [1, 3, 5].map((at) => String(Number.parseInt(tint.colour.slice(at, at + 2), 16)));
  return `rgb(${channels.join(" ")} / ${String(Math.round(tint.alpha * 100))}%)`;
}
