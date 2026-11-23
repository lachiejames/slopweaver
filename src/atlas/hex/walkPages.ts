/**
 * The `page` kind's half of one app walk: its rows on the BROWSER channel, its coverage cell, and its file.
 *
 * Pure, like the rest of the walk's projection: `walkPublish.ts` reads the generation, merges these rows onto
 * it and publishes, and this module only turns what the walk observed into the values that publish writes.
 */
import { foreignGaps, projectWalkedPages } from "../kit/frontierWalk.js";

import { hexDeclaredPages } from "./browserPages.js";
import { succeededHexCoverageCell } from "./coverage.js";
import { hexEntityId } from "./identity.js";
import type { HexAtlasEntity, HexAtlasKindFile } from "./model.js";
import { HEX_WEB_APP_SURFACE } from "./sync.js";
import type { HexWalkResult, ObservedHexCall } from "./walk.js";
import { outcomeExplanation, walkGaps } from "./walkGaps.js";

/**
 * Project every visited page into a `page` entity on the browser channel.
 *
 * @param walk what the walk observed
 * @param at this run's ISO timestamp
 * @returns one entity per visited route
 */
export function projectHexPages({ walk, at }: { walk: HexWalkResult; at: string }): readonly HexAtlasEntity[] {
  return projectWalkedPages<ObservedHexCall, HexAtlasEntity>({
    assemble: ({ id, providerId, view }) => ({
      channels: { api: null, browser: view },
      id,
      kind: "page" as const,
      providerId,
    }),
    at,
    entityIdFor: ({ providerId }) => hexEntityId({ kind: "page", providerId }),
    explain: outcomeExplanation,
    onPage: ({ call }) => call.onPage,
    walk,
  });
}

/** The coverage reason and state one walk earned, stated as a fraction rather than as a total. */
function walkCell({ walk }: { walk: HexWalkResult }): { reason: string; state: "synced" | "unreadable" } {
  const declared = hexDeclaredPages().length;
  const landed = walk.pages.filter((page) => page.outcome === "landed").length;
  if (walk.signedOut) {
    return {
      reason:
        `0 of ${String(declared)} declared routes reached — the first settled on the app's own sign-in wall ` +
        `and the walk stopped there, leaving ${String(walk.notAttempted.length)} unattempted. The app is ` +
        "where this workspace's projects, collections and data connections are visible, and this atlas has " +
        "seen none of them",
      state: "unreadable",
    };
  }
  return {
    reason:
      `${String(landed)} of ${String(walk.pages.length)} visited routes landed and were photographed, from ` +
      `${String(declared)} compiled static routes and ` +
      `${String(walk.pages.filter((page) => page.discoveredFrom !== null).length)} discovered from rendered ` +
      `navigation over ${String(walk.roundsRun)} round(s)`,
    state: "synced",
  };
}

/**
 * The page kind's file after one walk: this run's rows, its own coverage cell, and its own gaps.
 *
 * Only the web-app surface's cell and this walk's own gap conditions are replaced. Anything another writer
 * put there stays, which is the same property the channel-scoped merge gives the entities.
 *
 * @param stored the page kind as the store already holds it
 * @param entities the merged page entities
 * @param walk what the walk observed
 * @param at this run's ISO timestamp
 * @returns the file to publish
 */
export function walkedPageFile({
  stored,
  entities,
  walk,
  at,
}: {
  stored: HexAtlasKindFile;
  entities: readonly HexAtlasEntity[];
  walk: HexWalkResult;
  at: string;
}): HexAtlasKindFile {
  const cell = walkCell({ walk });
  return {
    ...stored,
    coverage: [
      ...stored.coverage.filter((held) => held.surface !== HEX_WEB_APP_SURFACE),
      succeededHexCoverageCell({
        artifacts: [],
        at,
        channel: "browser",
        reason: cell.reason,
        role: "authoritative",
        scope: "declared-app-pages",
        state: cell.state,
        surface: HEX_WEB_APP_SURFACE,
      }),
    ],
    entities: [...entities],
    gaps: [
      ...foreignGaps({
        gaps: stored.gaps,
        ownConditions: ["signed-out", "session-ended-by-page", "page-unreachable", "page-unphotographed"],
      }),
      ...walkGaps({ at, walk }),
    ],
    updatedAt: at,
  };
}
