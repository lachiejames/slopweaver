/** Pure parser for `slopweaver github exposure`: its two sub-verbs, the repository, and the output form. */

import { err, ok, type Result } from "../../../lib/result.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import { EXPOSURE_BOOLEAN_FLAGS, EXPOSURE_STRING_FLAGS } from "./exposureUsage.js";

const GITHUB_EXPOSURE_FLAGS: FlagSpec = { boolean: [...EXPOSURE_BOOLEAN_FLAGS], string: [...EXPOSURE_STRING_FLAGS] };

/** The parsed `github exposure inventory|sweep`. */
export interface GithubExposureArgs {
  readonly subVerb: "inventory" | "sweep";
  readonly owner: string;
  readonly repo: string;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** Why `github exposure`'s arguments were refused, before any credential or network is touched. */
export type GithubExposureArgsError =
  | { readonly code: "MISSING_SUB_VERB"; readonly message: string; readonly got: string | undefined }
  | { readonly code: "BAD_FLAGS"; readonly message: string; readonly problems: readonly string[] }
  | { readonly code: "MISSING_REPO"; readonly message: string };

/** Every argument refusal, built where its wording lives. */
export const GithubExposureArgsErrors = {
  badFlags: ({ problems }: { problems: readonly string[] }): GithubExposureArgsError => ({
    code: "BAD_FLAGS",
    message: problems.join("; "),
    problems,
  }),
  missingRepo: (): GithubExposureArgsError => ({ code: "MISSING_REPO", message: "--repo owner/name is required" }),
  missingSubVerb: ({ got }: { got: string | undefined }): GithubExposureArgsError => ({
    code: "MISSING_SUB_VERB",
    got,
    message: `github exposure needs a sub-verb: inventory or sweep (got ${got === undefined ? "none" : `"${got}"`})`,
  }),
} as const;

/**
 * Parse the arguments before any credential or network is touched.
 *
 * @param argv argv after `github exposure`
 * @returns the resolved operation, or the one refusal
 */
export function parseGithubExposureArgs({
  argv,
}: {
  argv: readonly string[];
}): Result<GithubExposureArgs, GithubExposureArgsError> {
  const subVerb = argv[0];
  if (subVerb !== "inventory" && subVerb !== "sweep") {
    return err(GithubExposureArgsErrors.missingSubVerb({ got: subVerb }));
  }
  const parsed = parseFlags({ allowPositionals: false, args: argv.slice(1), spec: GITHUB_EXPOSURE_FLAGS });
  if (parsed.isErr()) {
    return err(GithubExposureArgsErrors.badFlags({ problems: parsed.error }));
  }
  const values = parsed.value.values;
  const repoValue = values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  if (repo === undefined) {
    return err(GithubExposureArgsErrors.missingRepo());
  }
  const homeValue = values["home"];
  return ok({
    home: typeof homeValue === "string" ? homeValue : undefined,
    json: values["json"] === true,
    owner: repo.owner,
    repo: repo.repo,
    subVerb,
  });
}
