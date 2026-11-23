/**
 * The `page` kind's half of one console walk: its rows on the BROWSER channel, its gaps, its coverage cell, and
 * its file.
 *
 * Pure, like the rest of the walk's projection: `walkPublish.ts` reads the generation, merges these rows onto
 * it and publishes, and this module only turns what the walk observed into the values that publish writes.
 */
import { foreignGaps, projectWalkedPages } from "../kit/frontierWalk.js";

import { TWILIO_BROWSER_PAGES } from "./browserPages.js";
import { succeededTwilioCoverageCell } from "./coverage.js";
import { openTwilioGap } from "./gaps.js";
import { twilioEntityId } from "./identity.js";
import type { TwilioAtlasEntity, TwilioAtlasGap, TwilioAtlasKindFile } from "./model.js";
import { TWILIO_BROWSER_UNBLOCKED_BY, TWILIO_CONSOLE_SURFACE } from "./sync.js";
import type { ObservedConsoleCall, TwilioWalkResult } from "./walk.js";

/**
 * Project every visited page into a `page` entity on the browser channel.
 *
 * @param walk what the walk observed
 * @param at this run's ISO timestamp
 * @returns one entity per visited route
 */
export function projectTwilioPages({ walk, at }: { walk: TwilioWalkResult; at: string }): readonly TwilioAtlasEntity[] {
  return projectWalkedPages<ObservedConsoleCall, TwilioAtlasEntity>({
    assemble: ({ id, providerId, view }) => ({
      channels: { api: null, browser: view },
      id,
      kind: "page" as const,
      providerId,
    }),
    at,
    entityIdFor: ({ providerId }) => twilioEntityId({ kind: "page", providerId }),
    explain: outcomeExplanation,
    onPage: ({ call }) => call.onPage,
    walk,
  });
}

/**
 * Why a page is not held, in the words its row carries.
 *
 * @param outcome the grade the walk gave it
 * @returns the explanation, or `null` when the page landed and was photographed
 */
export function outcomeExplanation({ outcome }: { outcome: string }): string | null {
  if (outcome === "landed") {
    return null;
  }
  if (outcome === "signed-out") {
    return "the console sent this route to Twilio's sign-in wall — nobody is signed in to console.twilio.com in this browser";
  }
  if (outcome === "redirected") {
    return "the console settled somewhere other than the route that was asked for";
  }
  if (outcome === "unavailable") {
    return "the console answered an error status for this route";
  }
  if (outcome === "unphotographed") {
    return "the page rendered and no screenshot was written, so the atlas holds no picture to back the row";
  }
  if (outcome === "not-attempted") {
    return "the browser session was lost before this route was reached";
  }
  return "the visit failed before the page rendered";
}

/**
 * The gaps one walk earns: the sign-in wall once when it is universal, otherwise one per page not held.
 *
 * A signed-out walk raises ONE gap rather than eighty, because eighty rows saying "redirected" is a reader
 * having to work out for themselves that they are one sign-in. When only some pages fail, each is its own
 * gap, because then the reasons genuinely differ.
 *
 * @param walk what the walk observed
 * @param at this run's ISO timestamp
 * @returns the gaps to store against the page kind
 */
export function walkGaps({ walk, at }: { walk: TwilioWalkResult; at: string }): readonly TwilioAtlasGap[] {
  if (walk.signedOut) {
    return [
      openTwilioGap({
        at,
        condition: "console-signed-out",
        fields: [],
        kind: "page",
        reason:
          `the console settled on Twilio's sign-in wall, so it holds nothing at all — ` +
          `${String(walk.notAttempted.length)} further declared route(s) were not attempted, because a wall ` +
          `is a property of the session rather than of a route. ${TWILIO_BROWSER_UNBLOCKED_BY}`,
        scope: "declared-console-pages",
        surfaces: ["browser"],
      }),
    ];
  }
  return walk.pages
    .filter((page) => page.outcome !== "landed")
    .map((page) =>
      openTwilioGap({
        at,
        condition: page.outcome === "unphotographed" ? "page-unphotographed" : "page-unreachable",
        fields: [],
        kind: "page",
        // Only `landed` explains as `null`, and every landed page was filtered out above.
        reason: `${page.route}: ${outcomeExplanation({ outcome: page.outcome })!}`,
        scope: page.route,
        surfaces: ["browser"],
      }),
    );
}

/** The coverage reason and state one walk earned, stated as a fraction rather than as a total. */
function walkCell({ walk }: { walk: TwilioWalkResult }): { reason: string; state: "synced" | "unreadable" } {
  const landed = walk.pages.filter((page) => page.outcome === "landed").length;
  if (walk.signedOut) {
    return {
      reason:
        `0 of ${String(TWILIO_BROWSER_PAGES.length)} declared routes reached — the first settled on ` +
        `Twilio's sign-in wall and the walk stopped there, leaving ${String(walk.notAttempted.length)} ` +
        "unattempted. The console holds this account's phone numbers, services and delivery logs and this " +
        "atlas has seen none of them",
      state: "unreadable",
    };
  }
  return {
    reason:
      `${String(landed)} of ${String(walk.pages.length)} visited routes landed and were photographed, from ` +
      `${String(TWILIO_BROWSER_PAGES.length)} declared and ` +
      `${String(walk.pages.length - TWILIO_BROWSER_PAGES.length)} discovered from rendered navigation over ` +
      `${String(walk.roundsRun)} round(s)`,
    state: "synced",
  };
}

/**
 * The page kind's file after one walk: this run's rows, its own coverage cell, and its own gaps.
 *
 * Only the console surface's cell and this walk's own gap conditions are replaced. Anything another writer
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
  stored: TwilioAtlasKindFile;
  entities: readonly TwilioAtlasEntity[];
  walk: TwilioWalkResult;
  at: string;
}): TwilioAtlasKindFile {
  const cell = walkCell({ walk });
  return {
    ...stored,
    coverage: [
      ...stored.coverage.filter((held) => held.surface !== TWILIO_CONSOLE_SURFACE),
      succeededTwilioCoverageCell({
        artifacts: [],
        at,
        channel: "browser",
        reason: cell.reason,
        role: "authoritative",
        scope: "declared-console-pages",
        state: cell.state,
        surface: TWILIO_CONSOLE_SURFACE,
      }),
    ],
    entities: [...entities],
    gaps: [
      ...foreignGaps({
        gaps: stored.gaps,
        ownConditions: ["console-signed-out", "page-unreachable", "page-unphotographed"],
      }),
      ...walkGaps({ at, walk }),
    ],
    updatedAt: at,
  };
}
