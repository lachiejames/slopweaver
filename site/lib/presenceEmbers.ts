/**
 * Embers, the sixth presence, as arithmetic: how many sparks a voice strikes this frame, and where one spark is a frame
 * later. The painter (`components/voice/presenceSoftPainters.ts`) draws what this returns.
 *
 * The design is the gallery's own embers, the owner's pick for the sixth presence — the owner's
 * sparks and the voice's struck apart, each at `0.4 + level × 40` a second, rising from below and going out over
 * `1 / 0.45` seconds — re-expressed in shares of the orb so it draws the same at every size.
 *
 * Under reduce-motion nothing is struck, aged or moved: both functions hand back what they were given.
 *
 * Pure.
 */

/** How long an ember glows before it goes out, seconds: the gallery's life fell by 0.45 a second. */
export const EMBER_LIFE_S = 1 / 0.45;

/** One ember, every length a share of the orb's box measured from its middle, every speed a share a second. */
export interface EmberSpark {
  readonly ageS: number;
  /** The grey it is drawn in: the owner's darker, the voice's brighter (`presencePainter.ts`). */
  readonly grey: number;
  readonly radiusShare: number;
  /** Where in its sway it started, so two sparks struck together never sway together. */
  readonly swayPhase: number;
  readonly vxShareS: number;
  readonly vyShareS: number;
  readonly xShare: number;
  readonly yShare: number;
}

/**
 * How many sparks one voice strikes this frame, and the fraction it still owes the next.
 *
 * @param carry the fraction of a spark owed from earlier frames
 * @param level that voice's level, 0 to 1
 * @param moving false under reduce-motion, when nothing is struck and the carry is kept as it is
 * @returns the whole sparks to strike, and the carry left
 */
export function emberEmissionOf({
  carry,
  dtS,
  level,
  moving,
}: {
  carry: number;
  dtS: number;
  level: number;
  moving: boolean;
}): { readonly carry: number; readonly count: number } {
  if (!moving) {
    return { carry, count: 0 };
  }
  const owed = carry + (0.4 + level * 40) * dtS;
  const count = Math.floor(owed);
  return { carry: owed - count, count };
}

/**
 * One spark a frame later: older, and moved by its own speed.
 *
 * @param moving false under reduce-motion, when the spark is handed back unchanged
 * @returns the spark after `dtS`
 */
export function emberAfter({ dtS, moving, spark }: { dtS: number; moving: boolean; spark: EmberSpark }): EmberSpark {
  if (!moving) {
    return spark;
  }
  return {
    ...spark,
    ageS: spark.ageS + dtS,
    xShare: spark.xShare + spark.vxShareS * dtS,
    yShare: spark.yShare + spark.vyShareS * dtS,
  };
}
