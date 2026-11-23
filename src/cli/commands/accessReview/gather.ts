/**
 * The one effectful edge of the access-review verbs: reading the atlases this report stands on.
 *
 * Thin by design. Everything it returns is a `PlatformSource`, which is what `accessReview/report.ts`'s pure
 * assembler consumes — so the whole report can be tested against hand-built snapshots and this file is the
 * only thing that has ever touched a disk.
 *
 * ## A refusal becomes a SOURCE, not a throw
 *
 * `readSnapshot` refuses honestly when nothing has been published or the store will not open. Turning that
 * into an exception would make one dark atlas stop the report for the other three, so the refusal's own
 * message is carried into the section that could not be built and the gather always succeeds.
 *
 * ## Only the platforms a verb needs
 *
 * `atlas/kit/store.ts`'s `readAtlas` takes no kind filter, so reading one kind reads the platform — measured
 * in seconds for a large JumpCloud platform (`/usr/bin/time -p slopweaver atlas jumpcloud read --kind
 * systemusers --limit 1`). A verb therefore names the platforms it needs and pays for those alone:
 * `privileged` takes JumpCloud and the spine, never Cloudflare's Access users.
 */
import type { PlatformSource } from "../../../accessReview/report.js";
import { findAtlasPlatform } from "../../../atlas/registry.js";

/** The injected edge, so the gather is testable with a plain fake rather than a mock. */
export interface AccessReviewGatherDeps {
  readonly find: typeof findAtlasPlatform;
}

/**
 * The real edge.
 *
 * @returns the production dependency, resolving through the guarded registry
 */
export function productionAccessReviewGatherDeps(): AccessReviewGatherDeps {
  return { find: findAtlasPlatform };
}

/**
 * Read one platform's snapshot, carrying a refusal rather than throwing one.
 *
 * @param deps the injected edge
 * @param platform the atlas to read
 * @param home the state home to read from, when the caller passed one
 * @returns the source, whose `snapshot` is `null` exactly when `refusal` is not
 */
export async function gatherPlatform({
  deps,
  platform,
  home,
}: {
  deps: AccessReviewGatherDeps;
  platform: string;
  home: string | undefined;
}): Promise<PlatformSource> {
  const registration = deps.find({ platform });
  if (registration === null) {
    return { platform, refusal: `this build has no ${platform} atlas`, snapshot: null };
  }
  const snapshot = await registration.readSnapshot(home === undefined ? {} : { home });
  if (snapshot.isErr()) {
    return { platform, refusal: snapshot.error.message, snapshot: null };
  }
  return { platform, refusal: null, snapshot: snapshot.value };
}

/**
 * Read every platform a verb named, in order.
 *
 * @param deps the injected edge
 * @param platforms the atlases to read
 * @param home the state home to read from, when the caller passed one
 * @returns one source per platform, in the order asked for
 */
export async function gatherSources({
  deps,
  platforms,
  home,
}: {
  deps: AccessReviewGatherDeps;
  platforms: readonly string[];
  home: string | undefined;
}): Promise<readonly PlatformSource[]> {
  const sources: PlatformSource[] = [];
  for (const platform of platforms) {
    sources.push(await gatherPlatform({ deps, home, platform }));
  }
  return sources;
}
