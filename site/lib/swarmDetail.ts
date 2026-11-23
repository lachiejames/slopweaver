/**
 * How the full-screen swarm draws each dot: the geometry `swarmPainter.ts` reads, kept pure so it can be pinned.
 *
 * The owner likes looking at the corner orb, but the full-screen view drew a field of discs with holes in them,
 * which reads as trypophobic, or as germs and mold under a microscope, where it should read as high-tech and
 * futuristic. The fix dials the ickiness from fifty percent to thirty percent rather than discarding half the looks,
 * since some of them are what the owner wants.
 *
 * The cause is one of scale. A lit dot grows toward its lattice neighbours by a share of the spacing between them, and
 * the swarm's count stops growing at `MAX_PARTICLES` (`particleField.ts`) well before the stage's box does — so on the
 * 56px corner a bright dot is about 3px across its radius, and on the 480px stage it is a crisp disc near 10px, packed
 * on a sunflower lattice with dark gaps between: the lotus-seed pattern, which only the big view draws. So `refined`
 * caps that growth in CSS pixels at what the corner draws, gives every look a glow feathered into a falloff rather
 * than a second disc — so a bright cloud still reads as one shape, as light rather than touching discs — nudges each
 * dot off the sunflower by a little of the spacing. The full-screen stage always draws `refined`. The corner, whose
 * 56px box never grows a dot to a disc, and the Settings modal's corner previews draw `plain`: the lattice's own
 * geometry, uncapped and unnudged.
 */

/** The two ways a swarm draws: refined, for a box big enough to grow a dot into a disc, and plain, for the corner. */
export const SWARM_DETAILS = ["refined", "plain"] as const;

/** One of {@link SWARM_DETAILS}. */
export type SwarmDetail = (typeof SWARM_DETAILS)[number];

/**
 * Whether a value is a swarm detail.
 *
 * @returns true for a name in {@link SWARM_DETAILS}
 */
export function isSwarmDetail(value: unknown): value is SwarmDetail {
  return SWARM_DETAILS.some((detail) => detail === value);
}

/** How far a fully lit dot's radius reaches toward its lattice neighbours, as a share of the spacing between them. */
export const CORE_OVERLAP = 0.42;

/**
 * The most a lit dot grows, in CSS pixels, before a look's own overlap multiplies it: what the brightest dot grows by
 * in the corner's 56px box, the orb the owner likes looking at, so full screen a dot is never bigger than it is there.
 * Repro, at the loudest swell (1): `0.42 * Math.sqrt(Math.PI / 120) * (56 / 2) * 1.25` ≈ 2.38 for the corner (120
 * dots, `particleCountFor`), against `0.42 * Math.sqrt(Math.PI / 800) * (480 / 2) * 1.25` ≈ 7.90 for the stage's
 * largest. A 5.1px cap, what a 150px box draws, was tried first and rendered indistinguishable from the plain drawing
 * at 434px — still a field of discs.
 */
export const REFINED_GROWTH_CAP_PX = 2.4;

/**
 * The least halo a refined dot carries, as a multiple of its radius: with the discs capped, it is this glow that lets
 * a bright cloud read as one solid-looking shape — light merging, rather than discs touching.
 */
export const REFINED_MIN_HALO = 2.6;

/**
 * A dot's radius this frame: its resting size, plus how far its brightness grows it toward its neighbours.
 *
 * @param glow its brightness, 0 to 1
 * @param overlap the look's own multiple of that growth
 * @param reach one lattice spacing, in CSS pixels
 * @param rest its radius unlit, in CSS pixels
 * @returns the radius, in CSS pixels
 */
export function swarmRadius({
  detail,
  glow,
  overlap,
  reach,
  rest,
}: {
  detail: SwarmDetail;
  glow: number;
  overlap: number;
  reach: number;
  rest: number;
}): number {
  if (detail === "plain") {
    return rest + glow * glow * CORE_OVERLAP * overlap * reach;
  }
  return rest + Math.min(glow * glow * CORE_OVERLAP * reach, REFINED_GROWTH_CAP_PX) * overlap;
}

/** How far a refined dot is nudged off its sunflower seat at most, as a share of the lattice spacing. */
export const REFINED_JITTER_SHARE = 0.12;

/**
 * Where a dot is drawn: its place, nudged a little off the sunflower lattice when refined so the field never reads as
 * a seed head. The nudge is the dot's own and never changes, read off its seeded phase, so nothing is reseeded and no
 * random number is drawn.
 *
 * @param phase the dot's seeded phase, 0 to 2π
 * @param spacing the lattice spacing, in the field's −1…1 square
 * @returns the point to draw at, in the field's −1…1 square
 */
export function detailedPoint({
  detail,
  phase,
  spacing,
  x,
  y,
}: {
  detail: SwarmDetail;
  phase: number;
  spacing: number;
  x: number;
  y: number;
}): { readonly x: number; readonly y: number } {
  if (detail === "plain") {
    return { x, y };
  }
  const turn = phase * 7;
  const share = (((phase / (Math.PI * 2)) * 13) % 1) * REFINED_JITTER_SHARE * spacing;
  return { x: x + Math.cos(turn) * share, y: y + Math.sin(turn) * share };
}

/** How bright a halo is against its dot's core, in all. */
export const HALO_ALPHA = 0.14;

/** One pass of a halo: a disc at this radius, at this share of the core's brightness. */
export interface HaloPass {
  readonly alpha: number;
  readonly radius: number;
}

/**
 * A dot's halo as the discs drawn under it, outermost first. Plain, one disc at the halo's reach; refined, three
 * concentric ones whose brightness adds to the same total, faintest outermost, so the light falls off rather than
 * ending on an edge — a nucleus in a cell is exactly a second disc with an edge — reaching at least
 * {@link REFINED_MIN_HALO}, so every refined look glows. Never a canvas gradient or blur, which twenty canvases cannot
 * afford.
 *
 * @param halo the look's halo reach, as a multiple of the dot's radius: 0 draws none when plain
 * @param radius the dot's radius, in CSS pixels
 * @returns the passes, outermost first; none for a plain look with no halo
 */
export function haloPasses({
  detail,
  halo,
  radius,
}: {
  detail: SwarmDetail;
  halo: number;
  radius: number;
}): readonly HaloPass[] {
  if (detail === "plain") {
    if (halo <= 0) {
      return [];
    }
    return [{ alpha: HALO_ALPHA, radius: radius * halo }];
  }
  const reach = Math.max(halo, REFINED_MIN_HALO);
  return REFINED_HALO.map((pass) => ({ alpha: HALO_ALPHA * pass.share, radius: radius * reach * pass.reach }));
}

/** The refined halo's three passes: how far each reaches of the halo, and its share of the halo's brightness. */
const REFINED_HALO: readonly { readonly reach: number; readonly share: number }[] = [
  { reach: 1.15, share: 0.2 },
  { reach: 0.8, share: 0.3 },
  { reach: 0.5, share: 0.5 },
];
