/**
 * `slopweaver access-review privileged` — the ISO A.8.2 evidence pack.
 *
 * It gathers only the platforms that declare a console role, plus the spine for employment — never
 * Cloudflare's Access users, which name no role and would cost a whole-platform read to contribute nothing.
 */
import { ok, type Result } from "#lib/result.js";

import { ACCESS_LEVEL_TABLE, ROSTER_SPINE } from "../../../accessReview/levels.js";
import { CONSOLE_ROLE_LABEL } from "../../../accessReview/privileged.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK } from "../../exitCodes.js";

import { privilegedJson, renderPrivileged } from "./privilegedCore.js";
import { type AccessReviewDeps, runAccessReviewVerb } from "./runShell.js";
import { ACCESS_REVIEW_PRIVILEGED_USAGE } from "./usage.js";

/** Where the flag tail starts: past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** Only the platforms declaring a console role, plus the spine. */
function platformsFor(): Result<readonly string[]> {
  const naming = ACCESS_LEVEL_TABLE.filter((spec) =>
    spec.levels.some((level) => level.label === CONSOLE_ROLE_LABEL),
  ).map((spec) => spec.platform);
  return ok([...naming, ROSTER_SPINE.platform]);
}

/**
 * Run the verb.
 *
 * @param argv the whole process argv, as the CLI received it
 * @param deps the injected edges; omitted takes the production ones
 * @returns the process exit code
 */
export async function runAccessReviewPrivileged({
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
      json: ({ report }) => privilegedJson({ report }),
      platformsFor,
      render: ({ report }) => renderPrivileged({ report }),
      takesPlatform: false,
      usage: ACCESS_REVIEW_PRIVILEGED_USAGE,
    },
  });
}

export const accessReviewPrivilegedCommand = defineCommand({
  run: (argv) => runAccessReviewPrivileged({ argv }),
});
