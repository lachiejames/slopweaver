/**
 * The orb's flight between the corner and the stage. The two sizes flow smoothly into each other, with an animated
 * transition from the small presence in the corner to the large one on the screen, and back from large to small.
 *
 * So whichever orb arrives starts drawn over the one it replaces and moves into its own place: the stage's orb grows
 * out of the corner's, and the corner's shrinks out of the stage's. This is the pure half — the transform that puts
 * one box over another; `components/voice/useOrbFlight.ts` plays it.
 */

/** A box on the screen, CSS pixels, as `getBoundingClientRect` gives it. */
export interface FlightRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** How long a flight takes: long enough to read as one presence moving, short enough never to keep the owner waiting. */
export const ORB_FLIGHT_MS = 560;

/** The flight's easing: quick out of the start, settling softly into place. */
export const ORB_FLIGHT_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * The two transforms of a flight: the first draws the arriving orb's box exactly over `from`, the second is its own
 * place. Undefined when either box has no size — there is nothing to fly from, or nowhere to fly to — so the orb
 * simply appears.
 *
 * @param from where the orb is leaving
 * @param to where the arriving orb is laid out
 * @returns the start and end transforms, or `undefined` for no flight
 */
export function flightKeyframes({
  from,
  to,
}: {
  from: FlightRect;
  to: FlightRect;
}): readonly [string, string] | undefined {
  if (from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0) {
    return undefined;
  }
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const scale = from.width / to.width;
  return [`translate(${px({ value: dx })}, ${px({ value: dy })}) scale(${round({ value: scale })})`, "none"];
}

/** Which orb a flight brings in: the corner's landing from the stage, or the stage's growing out of the corner. */
export type FlightArrival = "corner" | "stage";

/**
 * The orb's soft disc over a flight (`OrbBackdrop`, `components/voice/orbParts.tsx`), as its opacity at the start and
 * the end. The disc is the corner's, so it is there wherever the orb is small: the landing orb's gathers in as it
 * shrinks into the corner rather than popping in at the stage's size, and the stage orb's starts as the corner's
 * disc it replaces and fades as it grows, ending where the enlarged view keeps it — at nothing. Where the owner has the disc
 * dialled down (`ORB_BACKING_OPACITIES`, `voiceStage.ts`), its shown end is that strength, so a landing never flashes
 * it to full and snaps back.
 *
 * @param arriving which orb the flight brings in
 * @param strength how strongly the disc is drawn where it stands, 0 to 1; full when not given
 * @returns the disc's opacity at the start and at the end of the flight
 */
export function backdropFadeOf({
  arriving,
  strength = 1,
}: {
  arriving: FlightArrival;
  strength?: number;
}): readonly [number, number] {
  if (arriving === "corner") {
    return [0, strength];
  }
  return [strength, 0];
}

/** A length in CSS pixels. */
function px({ value }: { value: number }): string {
  return `${round({ value })}px`;
}

/** A number to four decimals at most, with no trailing zeros, so a transform reads as written. */
function round({ value }: { value: number }): string {
  return String(Math.round(value * 10_000) / 10_000);
}
