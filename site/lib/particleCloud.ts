/**
 * The particles look's cloud: the shape the swarm takes while it listens and speaks, as crisp dots that a moving sky
 * of cloud lights up and gathers. Its place in the swarm is `site/lib/particleField.ts`; this is the field alone.
 *
 * A scattered swarm is visually unappealing. The reference is ChatGPT's orb, whose inside reads as cloudy skies with
 * the clouds moving around, wheels of bubbles or paint blobs turning in opposite directions; the dots themselves are
 * crisp little dots, and they read best when they overlap into a solid-looking shape.
 *
 * So the dots sit almost still, evenly spread on one sunflower lattice, and the clouds move THROUGH them: two layers
 * of a smooth field, one per band, turning opposite ways at different paces and twisted back and forth round a few
 * slowly orbiting centres. Where a cloud is, its dots light up and are pulled up the field's slope into its core, so a
 * cloud is a dense, bright, near-solid mass with even dim sky between. {@link CloudInput.flow} drifts the clouds in
 * toward the centre while the owner speaks and out from it while the voice does, so who is talking reads in the motion as
 * well as the colour. {@link CloudInput.order} is the rare flourish: the clouds let go and the bare lattice shows,
 * one crisp sunflower, before it fizzles back.
 */

/** The golden angle, radians: each dot this far round from the one before, so the lattice is even with no rings. */
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** How fast each band's cloud layer turns, radians a second of the swarm's clock: opposite ways, at different paces. */
export const BAND_TURN: Readonly<Record<0 | 1, number>> = { 0: 0.24, 1: -0.39 };

/** The lattice's own slow turn, shared by every dot so the sunflower never shears. */
const LATTICE_TURN = 0.05;

/** The furthest a cloud pulls a dot toward its core, as a multiple of the lattice's spacing. */
const PULL = 2;

/** The field's value where a cloud starts, and where it is whole: below the first is clear sky. */
const CLOUD_EDGE: readonly [number, number] = [0.45, 0.7];

/** How far out the lattice starts fading toward its rim. */
const RIM_FADE = 0.68;

/** One wave of a layer: its share, how many crests cross the disc, its direction and its drift. */
interface Wave {
  readonly a: number;
  readonly f: number;
  readonly ux: number;
  readonly uy: number;
  readonly w: number;
}

/** A wave pointing `degrees` round. */
function wave({ a, f, degrees, w }: { a: number; f: number; degrees: number; w: number }): Wave {
  const angle = (degrees * Math.PI) / 180;
  return { a, f, ux: Math.cos(angle), uy: Math.sin(angle), w };
}

/** Each layer's three waves, 60° apart so the masses are blobs rather than stripes, two to three across the disc. */
const LAYERS: Readonly<Record<0 | 1, readonly Wave[]>> = {
  0: [
    wave({ a: 0.5, degrees: 0, f: 4.6, w: 0.35 }),
    wave({ a: 0.3, degrees: 60, f: 5.3, w: -0.5 }),
    wave({ a: 0.2, degrees: 120, f: 3.9, w: 0.42 }),
  ],
  1: [
    wave({ a: 0.5, degrees: 30, f: 4.2, w: -0.38 }),
    wave({ a: 0.3, degrees: 90, f: 5.6, w: 0.46 }),
    wave({ a: 0.2, degrees: 150, f: 4.9, w: -0.31 }),
  ],
};

/** What the cloud needs of a dot: its seat on the lattice, its band and the lattice's spacing. */
export interface CloudSeat {
  /** Its angle on the lattice, radians. */
  readonly angle: number;
  /** Its distance out on the lattice, 0 to just under 1. */
  readonly reach: number;
  /** Which of the two counter-turning layers lights it. */
  readonly band: 0 | 1;
  /** The lattice's spacing between neighbours, in the normalised box. */
  readonly spacing: number;
}

/** One instant of the cloud. */
export interface CloudInput {
  readonly seat: CloudSeat;
  /** The swarm's clock, seconds. */
  readonly timeS: number;
  /** Who is talking: −1 draws the clouds inward (the owner), 1 drifts them outward (the voice), 0 neither. */
  readonly flow: number;
  /** The flourish, 0 to 1: at 1 the clouds have let go and only the even lattice shows. */
  readonly order: number;
}

/** A dot's place in the cloud and its brightness, 0 to 1. */
export interface CloudPlace {
  readonly x: number;
  readonly y: number;
  readonly glow: number;
}

/**
 * How fine a layer's waves are for a lattice this coarse: a small swarm with the stage's two or three clouds across
 * it is mush, so the corner's has one or two.
 */
function fineness({ spacing }: { spacing: number }): number {
  const coarse = (spacing - 0.065) / (0.16 - 0.065);
  return Math.min(1, Math.max(0.65, 1 - 0.35 * coarse));
}

/** Turn a point round a centre by an angle. */
function turned({ x, y, cx, cy, by }: { x: number; y: number; cx: number; cy: number; by: number }): [number, number] {
  const cos = Math.cos(by);
  const sin = Math.sin(by);
  return [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
}

/**
 * The layer's frame at a point: the layer's own turn, then a twist round three slowly orbiting centres, alternate
 * ones the other way. The twist swings back and forth rather than winding on, so the field never shears to stripes.
 */
function layerFrame({ x, y, band, timeS }: { x: number; y: number; band: 0 | 1; timeS: number }): [number, number] {
  let point = turned({ by: -BAND_TURN[band] * timeS, cx: 0, cy: 0, x, y });
  for (let k = 0; k < 3; k += 1) {
    const orbit = 0.11 * timeS + (2 * Math.PI * k) / 3 + band;
    const cx = 0.45 * Math.cos(orbit);
    const cy = 0.45 * Math.sin(orbit);
    const near = (point[0] - cx) ** 2 + (point[1] - cy) ** 2;
    const way = k % 2 === 0 ? 1 : -1;
    const by = way * 0.6 * Math.sin(0.3 * timeS + k) * Math.exp(-near / 0.12);
    point = turned({ by, cx, cy, x: point[0], y: point[1] });
  }
  return point;
}

/**
 * The raw field of one layer at a point, about 0 to 1: its three waves in the layer's frame, plus a ring wave running
 * outward or inward with whoever is talking.
 *
 * @param x the point, normalised box
 * @param y the point, normalised box
 * @param band which layer
 * @param timeS the swarm's clock
 * @param flow who is talking, −1 to 1
 * @param fine how fine the waves are, 0.65 to 1
 * @returns the field's value there
 */
export function cloudField({
  x,
  y,
  band,
  timeS,
  flow,
  fine,
}: {
  x: number;
  y: number;
  band: 0 | 1;
  timeS: number;
  flow: number;
  fine: number;
}): number {
  const [px, py] = layerFrame({ band, timeS, x, y });
  let sum = 0;
  for (const { a, f, ux, uy, w } of LAYERS[band]) {
    sum += a * Math.sin(f * fine * (px * ux + py * uy) + w * timeS);
  }
  const radius = Math.hypot(x, y);
  const outward = Math.max(0, flow);
  const inward = Math.max(0, -flow);
  sum += 0.35 * outward * Math.sin(7 * radius - 5 * timeS) + 0.35 * inward * Math.sin(7 * radius + 5 * timeS);
  return 0.5 + 0.5 * sum;
}

/**
 * How much cloud a field value is, 0 to 1: a soft edge between clear sky and a whole cloud.
 *
 * @returns 0 in clear sky, 1 inside a cloud
 */
export function cloudStrength({ value }: { value: number }): number {
  const [low, high] = CLOUD_EDGE;
  return eased({ share: (value - low) / (high - low) });
}

/** A share held to 0…1 and eased at both ends. */
function eased({ share }: { share: number }): number {
  const t = Math.min(1, Math.max(0, share));
  return t * t * (3 - 2 * t);
}

/**
 * Where a dot sits in the cloud, and how bright. It keeps its lattice seat, lit by its layer's cloud and pulled up
 * the raw field's slope — weighted by how much cloud it is in — so a cloud's dots crowd into its core. A pull outward
 * fades toward the rim, so no dot is pressed against an edge into a hard outline, which the look avoids.
 *
 * @returns its place and glow
 */
export function cloudPlace({ seat, timeS, flow, order }: CloudInput): CloudPlace {
  const angle = seat.angle + LATTICE_TURN * timeS;
  const x = Math.cos(angle) * seat.reach;
  const y = Math.sin(angle) * seat.reach;
  const fine = fineness({ spacing: seat.spacing });
  const field = ({ dx, dy }: { dx: number; dy: number }): number =>
    cloudField({ band: seat.band, fine, flow, timeS, x: x + dx, y: y + dy });
  const here = field({ dx: 0, dy: 0 });
  const eps = 0.02;
  const gx = (field({ dx: eps, dy: 0 }) - field({ dx: -eps, dy: 0 })) / (2 * eps);
  const gy = (field({ dx: 0, dy: eps }) - field({ dx: 0, dy: -eps })) / (2 * eps);
  const slope = Math.hypot(gx, gy);
  const strength = cloudStrength({ value: here });
  const loose = 1 - Math.min(1, Math.max(0, order));
  let pull = 0;
  if (slope > 1e-9) {
    pull = (PULL * seat.spacing * Math.min(1, slope / 2) * (0.25 + 0.75 * strength) * loose) / slope;
  }
  let mx = gx * pull;
  let my = gy * pull;
  const out = (mx * x + my * y) / Math.max(1e-9, seat.reach);
  if (out > 0) {
    const ease = 1 - seat.reach * seat.reach;
    mx -= (out * (1 - ease) * x) / Math.max(1e-9, seat.reach);
    my -= (out * (1 - ease) * y) / Math.max(1e-9, seat.reach);
  }
  // The lattice is even to its last ring, so its rim fades: at full brightness it would draw a hard-edged disc, which the look avoids.
  const rim = eased({ share: (seat.reach - RIM_FADE) / (1 - RIM_FADE) });
  const glow = ((0.12 + 0.88 * strength) * loose + 0.78 * (1 - loose)) * (1 - 0.8 * rim);
  // A sideways pull on the last ring can still carry a dot a hair past it; that dot is all but dark, so hold it there.
  const past = Math.max(1, Math.hypot(x + mx, y + my));
  return { glow, x: (x + mx) / past, y: (y + my) / past };
}
