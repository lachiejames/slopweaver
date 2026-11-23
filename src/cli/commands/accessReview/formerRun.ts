/**
 * `slopweaver access-review former` — the three-bucket former-staff join over every carrying atlas.
 *
 * It gathers all four, which is what the join needs and what this verb exists for. The measured cost of that
 * gather is in `accessReview/report.ts`'s header; it is a report, never a tick.
 */
import { ok, type Result } from "#lib/result.js";

import { ACCESS_LEVEL_TABLE, ROSTER_SPINE } from "../../../accessReview/levels.js";
import { type AccessReviewReport, refusedPlatformsOf } from "../../../accessReview/report.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

import { formerStaffJson, renderFormerStaff } from "./formerCore.js";
import { type AccessReviewDeps, runAccessReviewVerb } from "./runShell.js";
import { ACCESS_REVIEW_FORMER_USAGE } from "./usage.js";

/** Where the flag tail starts: past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** Every carrying atlas plus the spine — the join needs all of them. */
function platformsFor(): Result<readonly string[]> {
  return ok([...ACCESS_LEVEL_TABLE.map((spec) => spec.platform), ROSTER_SPINE.platform]);
}

/**
 * What the built report earns as an exit code.
 *
 * Non-zero when anything is confirmed, so a scheduled ISO row can act without parsing prose. A spine that
 * would not read is also non-zero, and so is a refused access platform: a join that could not run, or could
 * not compute its clean bucket, must never look like a clean one.
 *
 * @param report the built report
 * @returns the process exit code
 */
export function formerExitCode({ report }: { report: AccessReviewReport }): number {
  if (report.join === null) {
    return EXIT_ERROR;
  }
  if (report.join.confirmed.length > 0) {
    return EXIT_ERROR;
  }
  // A refused platform leaves CLEAN uncomputed, so a scheduled row must not read the exit as all-clear.
  if (refusedPlatformsOf({ report }).length > 0) {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/**
 * Run the verb.
 *
 * @param argv the whole process argv, as the CLI received it
 * @param deps the injected edges; omitted takes the production ones
 * @returns the process exit code
 */
export async function runAccessReviewFormer({
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
      exitCodeFor: formerExitCode,
      json: ({ report }) => formerStaffJson({ report }),
      platformsFor,
      render: ({ report }) => renderFormerStaff({ report }),
      takesPlatform: false,
      usage: ACCESS_REVIEW_FORMER_USAGE,
    },
  });
}

export const accessReviewFormerCommand = defineCommand({
  run: (argv) => runAccessReviewFormer({ argv }),
});
