/** Pure parsing for `slopweaver github self-review release`. */
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";

const GITHUB_SELF_REVIEW_RELEASE_FLAGS: FlagSpec = {
  boolean: [],
  string: ["repo", "pr", "head", "home"],
};

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_SELF_REVIEW_RELEASE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_SELF_REVIEW_RELEASE_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_SELF_REVIEW_RELEASE_FLAGS }),
].map((name) => `--${name}`);

/** The resolved release request. */
export interface GithubSelfReviewReleaseArgs {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly head: string | undefined;
  readonly home: string | undefined;
}

/**
 * Parse the release request before touching the ledger.
 *
 * @param rest argv after `github self-review release`
 * @returns the resolved address, or every usage problem
 */
export function parseGithubSelfReviewReleaseArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GithubSelfReviewReleaseArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_SELF_REVIEW_RELEASE_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const errors: string[] = [];
  const repoValue = parsed.value.values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  if (repo === undefined) {
    errors.push("--repo owner/name is required");
  }
  const prValue = parsed.value.values["pr"];
  const number = typeof prValue === "string" ? Number(prValue) : Number.NaN;
  if (!Number.isInteger(number) || number <= 0) {
    errors.push("--pr must be a positive whole number");
  }
  if (errors.length > 0 || repo === undefined) {
    return err(errors);
  }
  const head = parsed.value.values["head"];
  const home = parsed.value.values["home"];
  return ok({
    head: typeof head === "string" ? head : undefined,
    home: typeof home === "string" ? home : undefined,
    number,
    owner: repo.owner,
    repo: repo.repo,
  });
}
