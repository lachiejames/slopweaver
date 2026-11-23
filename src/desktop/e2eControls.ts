/**
 * The voice step's check on what the overlay's page tells main its controls are (`desktop/src/preload.ts`
 * `reportControls`), judged on the report the built preload really sent. Main's cursor watch takes the pointer over any
 * box in it, so a box over something the page does not draw takes the owner's clicks there: rows scrolled up out of the
 * messenger's history were reported where they sit in layout, a column up to the top of the owner's screen, and Chrome's
 * extension icons under it stopped answering. The driver draws a fixture
 * (`e2eControlsCheck.ts` `checkControlsClipped`) and this module says whether the report clipped it as drawn.
 */

/** A point in the voice page's CSS pixels. */
interface E2eControlsPoint {
  readonly x: number;
  readonly y: number;
}

/** One box of a controls report, CSS pixels, as the preload sends it. */
export interface E2eControlsBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Where the fixture is drawn and where it is not. */
export interface E2eControlsProbes {
  /** Over the rows the fixture's scroller clips away: no box may cover it. */
  readonly clipped: E2eControlsPoint;
  /** On what the fixture really draws — its scroller, a child drawn over a control's shoulder: each must be covered. */
  readonly drawn: readonly E2eControlsPoint[];
}

/** What one report says about the fixture. */
export type E2eControlsVerdict =
  | { readonly kind: "clipped" }
  | { readonly kind: "unclipped"; readonly point: E2eControlsPoint }
  | { readonly kind: "undrawn"; readonly point: E2eControlsPoint };

/**
 * Whether a point is inside a box: its left and top edges in, its right and bottom out, as main's own
 * `overlayWindow.ts` `pointOnControl` tests one.
 *
 * @param box the box
 * @param point the point
 * @returns true when the box covers it
 */
function covers({ box, point }: { box: E2eControlsBox; point: E2eControlsPoint }): boolean {
  return point.x >= box.left && point.x < box.left + box.width && point.y >= box.top && point.y < box.top + box.height;
}

/**
 * Judge one controls report against the fixture. A drawn point left uncovered comes first: the report has not caught
 * up with the fixture yet, or the preload dropped something it draws, and a clipped point judged on such a report
 * proves nothing.
 *
 * @param boxes the report's boxes
 * @param probes the fixture's points
 * @returns "clipped" when every drawn point is covered and the clipped one is not, else the first point that is wrong
 */
export function controlsVerdict({
  boxes,
  probes,
}: {
  boxes: readonly E2eControlsBox[];
  probes: E2eControlsProbes;
}): E2eControlsVerdict {
  const undrawn = probes.drawn.find((point) => !boxes.some((box) => covers({ box, point })));
  if (undrawn !== undefined) {
    return { kind: "undrawn", point: undrawn };
  }
  if (boxes.some((box) => covers({ box, point: probes.clipped }))) {
    return { kind: "unclipped", point: probes.clipped };
  }
  return { kind: "clipped" };
}
