/**
 * The Slack atlas's reset: archive the generation `atlas slack-drive` published, install an empty one this
 * build can write.
 *
 * Every other atlas binds `kit/reset.ts`'s `atlasResetFor` to four exports it already had and nothing more.
 * Slack needs one decision on top, which is why this is a module rather than four names in its registration:
 * the empty manifest carries an `@slack/web-api` version, and WHICH version is the whole point of the reset.
 *
 * The reset exists to clear the SDK-major refusal (`atlasStore.ts`'s `guardSdkMajor`). The next
 * `slack-drive sync` or `refresh` publishes with this empty manifest as its `derivedFrom`, so the guard
 * compares against whatever version the reset stamped. Stamp the PRIOR generation's version and the guard
 * refuses again on the very next run, naming this reset as the remedy — a loop with no exit. Stamp the
 * INSTALLED version, read by the same reader those two verbs use, and the next publish is a same-major one.
 *
 * A version that cannot be read archives nothing: the reset refuses before the kit renames a single
 * directory, so a failed read never leaves the atlas emptier than it found it.
 */
import { err, type Result } from "../../lib/result.js";
import { type AtlasPlatformReset, atlasResetFor } from "../kit/reset.js";

import { emptySlackAtlasKindFile, initialSlackAtlasManifest } from "./atlasModel.js";
import { SLACK_ATLAS_STORE_SPEC, slackAtlasPaths } from "./atlasStore.js";

/**
 * Bind the Slack atlas's reset to a reader of the installed SDK version.
 *
 * @param readSdkVersion reads the `@slack/web-api` version this build has installed, the one the next
 *   publish will compare against; called once per reset, before anything is archived
 * @returns the reset the Slack registration's `readReset` hands back
 */
export function slackAtlasResetFor({ readSdkVersion }: { readSdkVersion: () => Result<string> }): AtlasPlatformReset {
  return ({ home, at }) => {
    const sdkVersion = readSdkVersion();
    if (sdkVersion.isErr()) {
      return err([...sdkVersion.error, "nothing was archived — the Slack atlas generation is unchanged"]);
    }
    return atlasResetFor({
      emptyFiles: ({ at: stamped }) => ({
        method: emptySlackAtlasKindFile({ kind: "method", updatedAt: stamped }),
        page: emptySlackAtlasKindFile({ kind: "page", updatedAt: stamped }),
      }),
      emptyManifest: ({ updatedAt }) => initialSlackAtlasManifest({ sdkVersion: sdkVersion.value, updatedAt }),
      paths: slackAtlasPaths,
      spec: SLACK_ATLAS_STORE_SPEC,
    })({ at, home });
  };
}
