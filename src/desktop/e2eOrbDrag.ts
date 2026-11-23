/**
 * The `orb-drag` step of `slopweaver desktop e2e`, its pure half: what a drag of the voice's orb on the real test
 * instance must show, judged from what the effectful half (`../cli/commands/desktop/e2eOrbDrag.ts`) measured. It holds
 * down four defects a real drag on the installed app showed: a drag of about five frames a second, the widget flickering while it moved, the card drawn cut off past the window's top and left edges while held in
 * the top left, and an orb that, once dragged up, would not come back down to where it rested. Each is one break here,
 * so a regression reads as the thing the owner saw.
 */

/** A point on the screen, in screen points. */
export interface E2eScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** What the driver measured over the drag. */
export interface E2eOrbDragSeen {
  /** Every animation frame's start, milliseconds, from the first move past the drag threshold to the release. */
  readonly frameTimes: readonly number[];
  /** The widget's drawn size at every one of those frames, CSS pixels, as `<width>x<height>`. */
  readonly widgetSizes: readonly string[];
  /** The window's bounds read at every move of the drag, as `<x>,<y>,<width>,<height>`. */
  readonly windowBounds: readonly string[];
  /** How many of the widget's parts other than the orb were visible while held in the top left. */
  readonly visibleWhileHeld: number;
  /** Where the orb's centre was drawn the instant before the release, and once the release had settled. */
  readonly heldAt: E2eScreenPoint;
  readonly releasedAt: E2eScreenPoint;
  /** Where the orb rested before the walk dragged it, and where it rested after being dragged back into the corner. */
  readonly restAt: E2eScreenPoint;
  readonly backAt: E2eScreenPoint;
  /** What the page kept as the orb's place once dragged back into the corner (`slopweaver.messenger-place`). */
  readonly keptBack: string | null;
}

/** The slowest the median frame of a drag may take, milliseconds: thirty frames a second. */
const DRAG_MEDIAN_FRAME_MS = 34;

/** The slowest any one frame of a drag may take, milliseconds — a hitch the owner would see as the orb stopping. */
const DRAG_WORST_FRAME_MS = 150;

/** How far the orb may be drawn from where it should be, screen points: a rounding of the place to whole pixels. */
const PLACE_TOLERANCE = 1.5;

/** The fewest frames a drag must draw for its speed to be judged at all. */
const FEWEST_FRAMES = 10;

/**
 * The gaps between consecutive frames, sorted, milliseconds.
 *
 * @param frameTimes each frame's start
 * @returns the gaps, shortest first
 */
function sortedGaps({ frameTimes }: { frameTimes: readonly number[] }): readonly number[] {
  const gaps: number[] = [];
  for (let index = 1; index < frameTimes.length; index += 1) {
    gaps.push(frameTimes[index]! - frameTimes[index - 1]!);
  }
  return gaps.toSorted((left, right) => left - right);
}

/**
 * How far apart two screen points are.
 *
 * @param from one point
 * @param to the other
 * @returns the distance, screen points
 */
function distance({ from, to }: { from: E2eScreenPoint; to: E2eScreenPoint }): number {
  return Math.hypot(from.x - to.x, from.y - to.y);
}

/**
 * Every way the drag broke, each in words naming what a person dragging it would have seen.
 *
 * @param seen what the driver measured
 * @returns the breaks, none when the drag was smooth, steady, uncut and came home
 */
export function orbDragBreaks({ seen }: { seen: E2eOrbDragSeen }): readonly string[] {
  const breaks: string[] = [];
  const gaps = sortedGaps({ frameTimes: seen.frameTimes });
  if (seen.frameTimes.length < FEWEST_FRAMES) {
    breaks.push(`the drag drew ${String(seen.frameTimes.length)} frame(s), too few to judge it smooth`);
  } else {
    const median = gaps[Math.floor(gaps.length / 2)]!;
    const worst = gaps.at(-1)!;
    if (median > DRAG_MEDIAN_FRAME_MS) {
      breaks.push(
        `the drag drew about ${String(Math.round(1000 / median))} frames a second (median frame ${median.toFixed(0)}ms, ` +
          `over ${String(DRAG_MEDIAN_FRAME_MS)}ms)`,
      );
    }
    if (worst > DRAG_WORST_FRAME_MS) {
      breaks.push(`one frame of the drag took ${worst.toFixed(0)}ms, over ${String(DRAG_WORST_FRAME_MS)}ms`);
    }
  }
  const sizes = new Set(seen.widgetSizes);
  if (sizes.size > 1) {
    breaks.push(
      `the widget changed size ${String(sizes.size - 1)} time(s) mid-drag (${[...sizes].join(" → ")}), a flicker`,
    );
  }
  // The window crops round the widget at rest and takes the work area for the drag: two bounds, one move between them.
  const bounds = new Set(seen.windowBounds);
  if (bounds.size > 2) {
    breaks.push(`the window re-fit ${String(bounds.size - 1)} times mid-drag, where once at its start is all it needs`);
  }
  if (seen.visibleWhileHeld > 0) {
    breaks.push(
      `${String(seen.visibleWhileHeld)} part(s) of the widget besides the orb stayed drawn while held in the top left, ` +
        "where the card is cut off past the window's edges",
    );
  }
  const jump = distance({ from: seen.heldAt, to: seen.releasedAt });
  if (jump > PLACE_TOLERANCE) {
    breaks.push(`letting go moved the orb ${jump.toFixed(1)} points from where the drag showed it`);
  }
  const home = distance({ from: seen.restAt, to: seen.backAt });
  if (home > PLACE_TOLERANCE) {
    breaks.push(
      `dragged back into the corner the orb rested ${home.toFixed(1)} points from where it had always rested`,
    );
  }
  if (seen.keptBack !== "default") {
    breaks.push(`dragged back into the corner the page kept ${JSON.stringify(seen.keptBack)}, not its default place`);
  }
  return breaks;
}
