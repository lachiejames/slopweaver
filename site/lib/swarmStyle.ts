/**
 * The star cluster's shape: one particle field drawn in grey, its colour the theme's ramp (`./orbRamp.ts`).
 *
 * The star cluster is the presence the owner prefers on black, and
 * the one a first call wears (`./orbPresence.ts`). It is a swarm — the same formations for what the voice is doing
 * (`particleField.ts`), the same swell, the same yield beat — drawn in one shape ({@link STAR_CLUSTER_STYLE}: sparse
 * haloed points twinkling, the cloud only where they gather) as additive grey light.
 *
 * Pure, and imports nothing at run time.
 */

/** How the star cluster draws its points. Its colour is the theme's ramp, never this. */
export interface SwarmStyle {
  /** The resting point's radius, as a multiple of the lattice's. */
  readonly size: number;
  /** How far a lit point grows toward its neighbours: 0 keeps every point apart. */
  readonly overlap: number;
  /** A soft halo drawn under each point, as a multiple of its radius: 0 draws none. Never a canvas blur, which is slow. */
  readonly halo: number;
  /** How many points, as a multiple of the count for the orb's size. */
  readonly density: number;
  /** How deeply each point flickers on its own beat, 0 to 1. */
  readonly twinkle: number;
}

/** Sparse haloed points twinkling, the cloud only where they gather. */
export const STAR_CLUSTER_STYLE: SwarmStyle = {
  density: 0.45,
  halo: 2.4,
  overlap: 0.2,
  size: 0.8,
  twinkle: 0.9,
};

/**
 * The four greys the points are drawn in, one per particle hue (`PARTICLE_HUES`), close enough that a lone point sits
 * mid-ramp and only where points pile up does the light reach white.
 */
export const SWARM_GREYS = ["rgb(50% 50% 50%)", "rgb(56% 56% 56%)", "rgb(46% 46% 46%)", "rgb(53% 53% 53%)"] as const;

/**
 * How many points the swarm draws: the count for the orb's size, scaled by its density. A Settings tile draws exactly
 * what the corner draws, so a tile is never a cheaper preview of the orb the owner picks.
 *
 * @param areaCount the count the orb's size calls for (`particleCountFor`)
 * @param density the style's density
 * @returns the count, at least one
 */
export function swarmCount({ areaCount, density }: { areaCount: number; density: number }): number {
  if (density === 1) {
    return areaCount;
  }
  return Math.max(1, Math.round(areaCount * density));
}

/**
 * A point's brightness after its own flicker: each point on its own beat, never all at once.
 *
 * @param glow its brightness before, 0 to 1
 * @param depth how deep the flicker goes, 0 to 1; 0 leaves it alone
 * @param phase the point's own offset
 * @param timeS the swarm's clock
 * @returns its brightness, 0 to 1
 */
export function twinkled({
  glow,
  depth,
  phase,
  timeS,
}: {
  glow: number;
  depth: number;
  phase: number;
  timeS: number;
}): number {
  if (depth <= 0) {
    return glow;
  }
  const beat = 0.5 + 0.5 * Math.sin(timeS * 5.3 + phase * 7);
  return Math.min(1, Math.max(0, glow * (1 - depth * beat)));
}
