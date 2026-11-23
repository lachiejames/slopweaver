/**
 * Pure parser and door request for `slopweaver github push-restriction`.
 *
 * The verb exists because nobody but the owner may land on `main` once a
 * colleague's own install can raise pull requests against this repository — and the only way to change who
 * may push to a branch was GitHub's settings page, which rule 3 puts outside the door. Why a push restriction
 * and not a required review: `../../../outbound/github/pushRestrictionWrite.ts`.
 */

import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { PushRestrictionTarget } from "../../../outbound/github/pushRestrictionWrite.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";

/* Named rather than inline so the help-truth ratchet reads the same arrays the parser does. */
const STRING_FLAGS = ["repo", "branch", "allow", "home"] as const;
const BOOLEAN_FLAGS = ["unrestrict", "dry-run", "json"] as const;

const GITHUB_PUSH_RESTRICTION_FLAGS: FlagSpec = {
  boolean: [...BOOLEAN_FLAGS],
  string: [...STRING_FLAGS],
};

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_PUSH_RESTRICTION_FLAG_NAMES: readonly string[] = [...STRING_FLAGS, ...BOOLEAN_FLAGS].map(
  (name) => `--${name}`,
);

/** The parsed, side-effect-free invocation; a null `target` means a read. */
export interface GithubPushRestrictionArgs {
  readonly repo: string | undefined;
  readonly branch: string;
  readonly target: PushRestrictionTarget | null;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

const DEFAULT_BRANCH = "main";

/**
 * The `--allow` value as a login list — GitHub logins are case-insensitive, so `a,A` is one user, sent once.
 *
 * @param allow the comma-separated `--allow` value
 * @returns each distinct, non-empty login, first spelling kept
 */
function allowedLogins({ allow }: { allow: string }): string[] {
  const logins: string[] = [];
  for (const part of allow.split(",").map((value) => value.trim())) {
    if (part.length > 0 && !logins.some((login) => login.toLowerCase() === part.toLowerCase())) {
      logins.push(part);
    }
  }
  return logins;
}

/**
 * Turn `--allow` and `--unrestrict` into the change asked for, or every reason they cannot be one.
 *
 * @param allow the `--allow` value, when given
 * @param unrestrict whether `--unrestrict` was given
 * @returns the change, null for a read, or the usage problems
 */
function targetOf({
  allow,
  unrestrict,
}: {
  allow: string | undefined;
  unrestrict: boolean;
}): Result<PushRestrictionTarget | null> {
  if (allow === undefined) {
    return ok(unrestrict ? { kind: "unrestrict" } : null);
  }
  const logins = allowedLogins({ allow });
  const errors: string[] = [];
  if (logins.length === 0) {
    errors.push(
      "--allow needs at least one login: a restriction allowing nobody shuts every non-admin out of the queue",
    );
  }
  if (unrestrict) {
    errors.push("--allow and --unrestrict are opposite changes; pass one");
  }
  return errors.length > 0 ? err(errors) : ok({ kind: "restrict", logins });
}

/**
 * Parse the invocation before resolving a repository or a credential.
 *
 * @param rest argv after `github push-restriction`
 * @returns the parsed read or change, or every usage problem
 */
export function parseGithubPushRestrictionArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GithubPushRestrictionArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_PUSH_RESTRICTION_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const values = parsed.value.values;
  const allowValue = values["allow"];
  const target = targetOf({
    allow: typeof allowValue === "string" ? allowValue : undefined,
    unrestrict: values["unrestrict"] === true,
  });
  if (target.isErr()) {
    return err(target.error);
  }
  const branchValue = values["branch"];
  const home = values["home"];
  const repoValue = values["repo"];
  return ok({
    branch: typeof branchValue === "string" && branchValue.length > 0 ? branchValue : DEFAULT_BRANCH,
    dryRun: values["dry-run"] === true,
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    repo: typeof repoValue === "string" ? repoValue : undefined,
    target: target.value,
  });
}

/**
 * The external-write door request for one branch's push-restriction change.
 *
 * @param identity the resolved `owner/name`
 * @param branch the branch whose rule is being written
 * @param home the Slopweaver state home whose door records the write
 * @returns the exact external-write request admitted by the door
 */
export function pushRestrictionDoorRequest({
  identity,
  branch,
  home,
}: {
  identity: string;
  branch: string;
  home: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "push-restriction" },
    artifact: { id: `${identity}@${branch}` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}
