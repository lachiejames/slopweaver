/** Pure parser and door request for `slopweaver github pr request-review`. */

import type { DoorRequest } from "../../../admit/types.js";
import type { RequestedReviewers, WrittenPr } from "../../../corpus/github/write.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import type { Freshness } from "./updateCore.js";

const GITHUB_PR_REQUEST_REVIEW_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["repo", "number", "reviewer", "team", "home"],
};

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_PR_REQUEST_REVIEW_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_PR_REQUEST_REVIEW_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_PR_REQUEST_REVIEW_FLAGS }),
].map((name) => `--${name}`);

/** The resolved review-request. */
export interface GithubPrRequestReviewArgs {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  /** As the caller typed them — resolution against the directory happens in the effectful shell. */
  readonly reviewers: readonly string[];
  readonly teams: readonly string[];
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** Split a comma-separated flag value, dropping the empty fragments a trailing or doubled comma leaves. */
function commaListOf({ value }: { value: string | undefined }): readonly string[] {
  if (value === undefined) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Parse the review-request before resolving a credential.
 *
 * @param rest argv after `github pr request-review`
 * @returns the resolved address and requested reviewers, or every usage problem
 */
export function parseGithubPrRequestReviewArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GithubPrRequestReviewArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_PR_REQUEST_REVIEW_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const errors: string[] = [];
  const repoValue = parsed.value.values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  if (repo === undefined) {
    errors.push("--repo owner/name is required");
  }
  const numberValue = parsed.value.values["number"];
  const number = typeof numberValue === "string" ? Number(numberValue) : Number.NaN;
  if (!Number.isInteger(number) || number <= 0) {
    errors.push("--number must be a positive whole number");
  }
  const reviewerValue = parsed.value.values["reviewer"];
  const reviewers = commaListOf({ value: typeof reviewerValue === "string" ? reviewerValue : undefined });
  const teamValue = parsed.value.values["team"];
  const teams = commaListOf({ value: typeof teamValue === "string" ? teamValue : undefined });
  if (reviewers.length === 0 && teams.length === 0) {
    errors.push("give at least one of --reviewer <login,...> or --team <slug,...>");
  }
  if (errors.length > 0 || repo === undefined) {
    return err(errors);
  }
  const home = parsed.value.values["home"];
  return ok({
    dryRun: parsed.value.values["dry-run"] === true,
    home: typeof home === "string" ? home : undefined,
    json: parsed.value.values["json"] === true,
    number,
    owner: repo.owner,
    repo: repo.repo,
    reviewers,
    teams,
  });
}

/**
 * Re-check, inside the door, that nothing this write's decisions depended on has moved.
 *
 * Narrower than `./updateCore.ts`'s `updateFreshnessFor` — this write never touches the body or title, so
 * only what could invalidate the FOREIGN-AUTHOR check and the address itself is compared: the number, the
 * author, and whether the pull request is still open. A closed pull request can still legally receive a
 * review request from GitHub's own API, but requesting one on a pull request that closed between the read
 * and the write is almost certainly not what the caller meant, so it is refused rather than sent quietly.
 *
 * @param previewed the pull request as read when authorisation was decided
 * @param current the pull request as read again inside the door
 * @returns whether the write may proceed, with the field that moved when it may not
 */
export function reviewRequestFreshnessFor({
  previewed,
  current,
}: {
  previewed: WrittenPr;
  current: WrittenPr;
}): Freshness {
  const moved: readonly { readonly what: string; readonly same: boolean }[] = [
    { same: previewed.number === current.number, what: "the pull-request number" },
    { same: previewed.authorId === current.authorId, what: "the author" },
    { same: previewed.state.toLowerCase() === current.state.toLowerCase(), what: "the open/closed state" },
  ];
  const changed = moved.find((entry) => !entry.same);
  if (changed === undefined) {
    return { fresh: true };
  }
  return {
    fresh: false,
    reason: `${changed.what} changed between reading this pull request and writing to it, so nothing was sent. Re-run to work from the current state`,
  };
}

/**
 * The external-write door request for one exact pull-request number.
 *
 * @param args the parsed repository, number and requested reviewers
 * @param home the Slopweaver state home whose door records the write
 * @returns the exact external-write request admitted by the door
 */
export function requestReviewDoorRequest({
  args,
  home,
}: {
  args: GithubPrRequestReviewArgs;
  home: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "pr request-review" },
    artifact: { id: `${args.owner}/${args.repo}#${String(args.number)}` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}

/** One reviewer list as the report prints it: comma-joined, or `(none)` when the joined list is empty. */
function reviewerNames({ names }: { names: readonly string[] }): string {
  const joined = names.join(", ");
  if (joined === "") {
    return "(none)";
  }
  return joined;
}

/**
 * The human report line for one request-review outcome: the users and the teams GitHub reports as requested.
 *
 * @param outcome what happened, in words — `requested`, `would request`, `already requested`
 * @param number the pull request the reviewers were requested on
 * @param requested the reviewers GitHub reports as requested
 * @returns the line
 */
export function requestedReviewersLine({
  outcome,
  number,
  requested,
}: {
  outcome: string;
  number: number;
  requested: RequestedReviewers;
}): string {
  return (
    `${outcome} #${String(number)}  users: ${reviewerNames({ names: requested.users })}` +
    `  teams: ${reviewerNames({ names: requested.teams })}`
  );
}
