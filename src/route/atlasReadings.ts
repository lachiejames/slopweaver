/**
 * Grade the atlases a capability table names, so `src/route/`'s pure planners can be handed data.
 *
 * The split is deliberate and is the whole reason for a second small module: `./atlasReading.ts` decides
 * what a row should advertise and touches no disk, while this one performs the reads. A planner that
 * imported the atlas registry would make `route plan` load every platform's Zod model to answer a question
 * about one of them, which is the cost `atlas/registry.ts` already exists to avoid.
 *
 * Only the platforms a row actually names are read. A table with three atlas rows opens three generations,
 * never the thirty-odd this build registers.
 */
import { gradeAtlasAnswerability } from "../atlas/kit/answerable.js";
import { findAtlasPlatform } from "../atlas/registry.js";

import { type AtlasRouteReading, atlasPlatformOf } from "./atlasReading.js";
import type { SourceCapability } from "./profile.js";

/** How a named platform's registration is found — the build's registry in production, a fake in a test. */
export type AtlasRegistrationLookup = typeof findAtlasPlatform;

/**
 * Read and grade every registered atlas the given capability rows name.
 *
 * A platform whose read REFUSES is graded `dark` rather than dropped: a refusal is the strongest possible
 * evidence that the row should not be advertised as available, and silently omitting it would leave the row
 * exactly as declared — the failure this whole path was opened for. A platform this build does NOT register
 * is the one omission: no reading is produced for it, so its row reaches the planner exactly as declared.
 *
 * @param capabilities the merged capability table, whose atlas rows name the platforms to read
 * @param home the state home to read from, when the caller has one to pass
 * @param findPlatform how a platform's registration is found; omitted, the build's own registry
 * @returns one grading per registered platform, keyed by platform name
 */
export async function atlasRouteReadings({
  capabilities,
  home,
  findPlatform = findAtlasPlatform,
}: {
  capabilities: readonly SourceCapability[];
  home?: string | undefined;
  findPlatform?: AtlasRegistrationLookup;
}): Promise<ReadonlyMap<string, AtlasRouteReading>> {
  const platforms = [
    ...new Set(capabilities.flatMap((capability) => [atlasPlatformOf({ capability })].filter((p) => p !== null))),
  ];
  const readings = new Map<string, AtlasRouteReading>();
  for (const platform of platforms) {
    const registration = findPlatform({ platform });
    if (registration === null) {
      continue;
    }
    const snapshot = await registration.readSnapshot(home === undefined ? {} : { home });
    if (snapshot.isErr()) {
      readings.set(platform, {
        because: snapshot.error.message,
        gapKinds: [],
        grade: "dark",
        notAttemptedKinds: [],
        permissionBlockedKinds: [],
        platform,
        productAbsentKinds: [],
      });
      continue;
    }
    const graded = gradeAtlasAnswerability({ snapshot: snapshot.value });
    readings.set(platform, {
      because: graded.because,
      gapKinds: graded.gapKinds,
      grade: graded.grade,
      notAttemptedKinds: graded.notAttemptedKinds,
      permissionBlockedKinds: graded.permissionBlockedKinds,
      platform,
      productAbsentKinds: graded.productAbsentKinds,
    });
  }
  return readings;
}
