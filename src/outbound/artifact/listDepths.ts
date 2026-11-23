/**
 * A one-list's nested dot points: the `depths` field's schema and the rules that hold it to `bullets`.
 *
 * Split out of `./schema.ts` along the one seam nesting has: everything here is about which dot point sits under
 * which, and nothing in the rest of the one-list schema needs to know.
 */
import { z } from "zod";

import { listHeadlineCount } from "./runs.js";
import type { OneListArtifact } from "./types.js";

/** One depth per dot point: `0` a headline, `1` a sub-point under the nearest headline above it. */
export const listDepthsSchema = z.array(z.union([z.literal(0), z.literal(1)])).optional();

/**
 * The nesting rules of a one-list's dot points, and the headline bound.
 *
 * `maxBullets` counts HEADLINES: a sub-point is part of the dot point it sits under, so four headlines with
 * two sub-points each is a four-point roster, and the whole message's `cardVisibleMax` is what bounds the
 * sub-points. `depths`, when present, is index for index with `bullets` and opens on a headline, because a
 * sub-point with nothing above it has no parent to sit under.
 *
 * @param artifact the parsed one-list
 * @param ctx the refinement context each issue is added to
 * @param maxBullets how many headline dot points one list may carry
 */
export function checkListDepths({
  artifact,
  ctx,
  maxBullets,
}: {
  artifact: OneListArtifact;
  ctx: z.RefinementCtx;
  maxBullets: number;
}): void {
  const depths = artifact.depths;
  if (depths !== undefined && depths.length !== artifact.bullets.length) {
    ctx.addIssue({
      code: "custom",
      message:
        `depths carries ${String(depths.length)} entries for ${String(artifact.bullets.length)} dot points; ` +
        "give each dot point its depth, 0 for a headline and 1 for a sub-point under it",
      path: ["depths"],
    });
  }
  if (depths?.[0] === 1) {
    ctx.addIssue({
      code: "custom",
      message: "the first dot point is a sub-point with no headline above it; make it depth 0",
      path: ["depths", 0],
    });
  }
  if (listHeadlineCount({ artifact }) > maxBullets) {
    ctx.addIssue({
      code: "custom",
      message:
        `a list holds ${String(maxBullets)} dot points, sized on the operator's own roster; a longer one ` +
        "is a slackMe.drip.maxBullets change in profile.json, never a voice-rules grant",
      path: ["bullets"],
    });
  }
}
