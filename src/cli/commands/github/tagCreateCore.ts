/**
 * Pure parser, decision and door request for `slopweaver github tag create`.
 *
 * The owner never clicks in a provider UI, and a local tag reached origin only by a raw
 * `git push`, outside rule 3. This verb writes the tag REF through the door instead. It pushes no objects, so
 * it can only tag a commit origin already holds — which is exactly the recovery-point case: a commit that is
 * on a branch about to be deleted.
 */
import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import { type GithubVerbError, GithubVerbErrors } from "./errors.js";

const TAG_BOOLEAN_FLAGS = ["dry-run", "json"] as const;
const TAG_STRING_FLAGS = ["repo", "tag", "sha", "message", "home"] as const;
const GITHUB_TAG_FLAGS: FlagSpec = { boolean: [...TAG_BOOLEAN_FLAGS], string: [...TAG_STRING_FLAGS] };

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_TAG_FLAG_NAMES: readonly string[] = [...TAG_STRING_FLAGS, ...TAG_BOOLEAN_FLAGS].map(
  (name) => `--${name}`,
);

/** A full 40-hex commit sha — an abbreviation could resolve differently tomorrow. */
const FULL_SHA = /^[0-9a-f]{40}$/u;

/** The resolved tag request. */
export interface GithubTagArgs {
  readonly owner: string;
  readonly repo: string;
  readonly tag: string;
  readonly sha: string;
  readonly message: string | undefined;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Parse the tag request before resolving a credential.
 *
 * @param argv the verb's own argument tail, after `github tag`
 * @returns the resolved address, target and modes, or every usage problem
 */
export function parseGithubTagArgs({ argv }: { argv: readonly string[] }): Result<GithubTagArgs, GithubVerbError> {
  if (argv[0] !== "create") {
    return err(GithubVerbErrors.usage({ command: "tag", shape: "create" }));
  }
  const parsed = parseFlags({ allowPositionals: false, args: argv.slice(1), spec: GITHUB_TAG_FLAGS });
  if (parsed.isErr()) {
    return err(GithubVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const errors: string[] = [];
  const repoValue = values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  if (repo === undefined) {
    errors.push("--repo owner/name is required");
  }
  const tag = values["tag"];
  if (typeof tag !== "string" || tag.trim().length === 0) {
    errors.push("--tag is required");
  }
  const sha = values["sha"];
  if (typeof sha !== "string" || !FULL_SHA.test(sha)) {
    errors.push("--sha must be a full 40-character lowercase commit sha");
  }
  const message = values["message"];
  if (typeof message === "string" && message.trim().length === 0) {
    errors.push("--message must not be blank");
  }
  if (errors.length > 0 || repo === undefined || typeof tag !== "string" || typeof sha !== "string") {
    return err(GithubVerbErrors.argumentsRefused({ reasons: errors }));
  }
  const home = values["home"];
  return ok({
    dryRun: values["dry-run"] === true,
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    message: typeof message === "string" ? message : undefined,
    owner: repo.owner,
    repo: repo.repo,
    sha,
    tag,
  });
}

/** What a tag create does, decided from the live remote before the door is asked. */
export type TagPlan =
  { readonly kind: "create" } | { readonly kind: "present" } | { readonly kind: "refuse"; readonly reason: string };

/**
 * Decide the tag create from what the remote holds now.
 *
 * @param tag the tag name, for the message
 * @param sha the commit the tag should point at
 * @param existingCommit the commit the tag already points at on the remote, peeled, or undefined
 * @param commitOnRemote whether the remote holds the commit at all
 * @returns create, already present at that commit, or a refusal naming the live state
 */
export function planTagCreate({
  tag,
  sha,
  existingCommit,
  commitOnRemote,
}: {
  tag: string;
  sha: string;
  existingCommit: string | undefined;
  commitOnRemote: boolean;
}): TagPlan {
  if (existingCommit === sha) {
    return { kind: "present" };
  }
  if (existingCommit !== undefined) {
    return { kind: "refuse", reason: `tag ${tag} already points at ${existingCommit}, not ${sha}` };
  }
  if (!commitOnRemote) {
    return {
      kind: "refuse",
      reason: `the remote does not hold commit ${sha} — this verb writes a ref and pushes no objects`,
    };
  }
  return { kind: "create" };
}

/**
 * The external-write door request for one tag ref.
 *
 * @param args the parsed repository and tag
 * @param home the Slopweaver state home whose door records the transition
 * @returns the exact external-write request admitted by the door
 */
export function tagCreateDoorRequest({ args, home }: { args: GithubTagArgs; home: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "tag" },
    artifact: { id: `${args.owner}/${args.repo}:refs/tags/${args.tag}` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}
