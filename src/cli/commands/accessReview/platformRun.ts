/**
 * `slopweaver access-review platform <name>` — one platform's roster report.
 *
 * It gathers the named platform ALONE. The section is that platform's own snapshot, printed verbatim, and
 * nothing in it reads the roster — gathering the spine anyway would make its refusal a dependency the
 * output never reports. The join against the roster is `access-review former`'s.
 */
import { err, ok, type Result } from "#lib/result.js";

import { ACCESS_LEVEL_TABLE } from "../../../accessReview/levels.js";
import type { PlatformSection } from "../../../accessReview/report.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK } from "../../exitCodes.js";

import type { AccessReviewOptions } from "./options.js";
import { platformSectionJson, renderPlatformSection } from "./platformCore.js";
import { type AccessReviewDeps, runAccessReviewVerb } from "./runShell.js";
import { ACCESS_REVIEW_PLATFORM_USAGE } from "./usage.js";

/** Where the flag tail starts: past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** Which platforms this invocation needs read. */
function platformsFor({ options }: { options: AccessReviewOptions }): Result<readonly string[]> {
  const known = ACCESS_LEVEL_TABLE.map((spec) => spec.platform);
  const named = options.platform;
  if (named === undefined) {
    return err([`name the platform to report on — one of: ${known.join(", ")}`]);
  }
  if (!known.includes(named)) {
    return err([`no per-user access level is declared for ${named} — this report covers: ${known.join(", ")}`]);
  }
  return ok([named]);
}

/** The section the caller asked for, which is always present because `platformsFor` validated the name. */
function sectionFor({
  sections,
  platform,
}: {
  sections: readonly PlatformSection[];
  platform: string | undefined;
}): PlatformSection | null {
  const found = sections.find((section) => section.platform === platform);
  if (found === undefined) {
    return null;
  }
  return found;
}

/**
 * Run the verb.
 *
 * @param argv the whole process argv, as the CLI received it
 * @param deps the injected edges; omitted takes the production ones
 * @returns the process exit code
 */
export async function runAccessReviewPlatform({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps?: AccessReviewDeps;
}): Promise<number> {
  return runAccessReviewVerb({
    argv,
    ...(deps === undefined ? {} : { deps }),
    offset: VERB_ARG_OFFSET,
    verb: {
      exitCodeFor: () => EXIT_OK,
      json: ({ report, options }) => {
        const section = sectionFor({ platform: options.platform, sections: report.sections });
        if (section === null) {
          return { refusal: "no section was built for that platform" };
        }
        return platformSectionJson({ section });
      },
      platformsFor,
      render: ({ report, options }) => {
        const section = sectionFor({ platform: options.platform, sections: report.sections });
        if (section === null) {
          return ["access-review platform · no section was built for that platform"];
        }
        return renderPlatformSection({ section });
      },
      takesPlatform: true,
      usage: ACCESS_REVIEW_PLATFORM_USAGE,
    },
  });
}

export const accessReviewPlatformCommand = defineCommand({
  run: (argv) => runAccessReviewPlatform({ argv }),
});
