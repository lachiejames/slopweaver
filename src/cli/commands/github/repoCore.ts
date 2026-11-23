/** Pure parser and door requests for `slopweaver github repo`. */

import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import { GITHUB_REPO_DIGEST_PATTERN, type GithubRepoAdministrationAction } from "./repoPlan.js";
import {
  approvedWritesOf,
  GITHUB_REPO_APPROVED_WRITE_FLAGS,
  GITHUB_REPO_APPROVED_WRITE_STRING_FLAGS,
  GITHUB_REPO_WRITE_FLAG_LIST,
  type GithubRepoApprovedArgs,
} from "./repoWriteArgs.js";

const GITHUB_REPO_FLAGS: FlagSpec = {
  boolean: ["archive", "dry-run", "json", ...GITHUB_REPO_APPROVED_WRITE_FLAGS],
  string: [
    "repo",
    "description",
    "rename-to",
    "transfer-to",
    "approve",
    "home",
    ...GITHUB_REPO_APPROVED_WRITE_STRING_FLAGS,
  ],
};

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_REPO_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_REPO_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_REPO_FLAGS }),
].map((name) => `--${name}`);

/** The resolved description transition. */
export interface GithubRepoArgs {
  readonly owner: string;
  readonly repo: string;
  readonly description: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** One resolved rename, transfer or archive, previewed unless `approve` carries the preview's digest. */
export interface GithubRepoAdministrationArgs {
  readonly owner: string;
  readonly repo: string;
  readonly action: GithubRepoAdministrationAction;
  readonly approve: string | undefined;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * What one `github repo` invocation asks for: the description write, one administration write, or one create,
 * visibility change or Actions policy.
 */
export type GithubRepoInvocation =
  | { readonly kind: "description"; readonly args: GithubRepoArgs }
  | { readonly kind: "administration"; readonly args: GithubRepoAdministrationArgs }
  | { readonly kind: "approved"; readonly args: GithubRepoApprovedArgs };

/** A repository name or account login: non-empty, no whitespace, no slash. GitHub judges the rest. */
const SINGLE_SEGMENT = /^[^\s/]+$/;

/**
 * Read the one administration action the flags name, refusing a malformed value by flag.
 *
 * @param values the parsed flag values
 * @param errors the list a problem is appended to
 * @returns every administration action named, so the caller can refuse more than one
 */
function administrationActionsOf({
  values,
  errors,
}: {
  values: Readonly<Record<string, string | boolean | undefined>>;
  errors: string[];
}): GithubRepoAdministrationAction[] {
  const actions: GithubRepoAdministrationAction[] = [];
  const renameTo = values["rename-to"];
  if (typeof renameTo === "string") {
    if (SINGLE_SEGMENT.test(renameTo)) {
      actions.push({ kind: "rename", newName: renameTo });
    } else {
      errors.push("--rename-to takes the new repository name alone: no owner, slash or whitespace");
    }
  }
  const transferTo = values["transfer-to"];
  if (typeof transferTo === "string") {
    if (SINGLE_SEGMENT.test(transferTo)) {
      actions.push({ kind: "transfer", newOwner: transferTo });
    } else {
      errors.push("--transfer-to takes the receiving account or organisation login alone: no slash or whitespace");
    }
  }
  if (values["archive"] === true) {
    actions.push({ kind: "archive" });
  }
  return actions;
}

/**
 * Validate the flags an administration write may not carry, and its approval digest's shape.
 *
 * @param values the parsed flag values
 * @param errors the list a problem is appended to
 * @returns the approval digest, or undefined for a preview
 */
function administrationApprovalOf({
  values,
  errors,
}: {
  values: Readonly<Record<string, string | boolean | undefined>>;
  errors: string[];
}): string | undefined {
  if (values["dry-run"] === true) {
    errors.push("--dry-run is the description write's preview; every other write previews by default");
  }
  const approve = values["approve"];
  if (typeof approve !== "string") {
    return undefined;
  }
  if (!GITHUB_REPO_DIGEST_PATTERN.test(approve)) {
    // Refused without echoing it: an approval only ever names a digest, so nothing else belongs there.
    errors.push("--approve takes the digest a preview printed: ghrepo- and 16 hex characters");
  }
  return approve;
}

/**
 * Refuse an invocation naming no write flag, unless it is already refused for something else, or more than one.
 *
 * @param named how many write flags the invocation named
 * @param errors the list a problem is appended to
 */
function requireOneWrite({ named, errors }: { named: number; errors: string[] }): void {
  if (named === 0 && errors.length === 0) {
    errors.push(`one of ${GITHUB_REPO_WRITE_FLAG_LIST} is required (pass --description "" to clear it)`);
  }
  if (named > 1) {
    errors.push(`name one of ${GITHUB_REPO_WRITE_FLAG_LIST}; each is its own write`);
  }
}

/**
 * Parse one `github repo` invocation before resolving a credential.
 *
 * Exactly one write flag is required; a rename and a transfer, or a create and turning Actions on, are two
 * invocations with two approvals, never one.
 *
 * @param rest argv after `github repo`
 * @returns the resolved address and change, or every usage problem
 */
export function parseGithubRepoArgs({ rest }: { rest: readonly string[] }): Result<GithubRepoInvocation> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_REPO_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const errors: string[] = [];
  const repoValue = values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  if (repo === undefined) {
    errors.push("--repo owner/name is required");
  }
  const description = values["description"];
  const actions = administrationActionsOf({ errors, values });
  const writes = approvedWritesOf({ errors, values });
  requireOneWrite({ errors, named: actions.length + writes.length + (typeof description === "string" ? 1 : 0) });
  const homeValue = values["home"];
  const common = { home: typeof homeValue === "string" ? homeValue : undefined, json: values["json"] === true };
  if (typeof description === "string") {
    return descriptionInvocationOf({ common, description, errors, repo, values });
  }
  const approve = administrationApprovalOf({ errors, values });
  if (errors.length > 0 || repo === undefined) {
    return err(errors);
  }
  const [action] = actions;
  if (action !== undefined) {
    return ok({ args: { ...common, action, approve, owner: repo.owner, repo: repo.repo }, kind: "administration" });
  }
  const [write] = writes;
  if (write === undefined) {
    return err(errors);
  }
  const isPublic = values["public"] === true;
  const manifestValue = values["apply-manifest"];
  const manifestPath = typeof manifestValue === "string" ? manifestValue : undefined;
  return ok({
    args: { ...common, approve, manifestPath, owner: repo.owner, public: isPublic, repo: repo.repo, write },
    kind: "approved",
  });
}

/**
 * Finish a description invocation: refuse `--approve`, which only an administration write takes.
 *
 * @returns the description invocation, or every usage problem collected so far
 */
function descriptionInvocationOf({
  common,
  description,
  errors,
  repo,
  values,
}: {
  common: { home: string | undefined; json: boolean };
  description: string;
  errors: string[];
  repo: { owner: string; repo: string } | undefined;
  values: Readonly<Record<string, string | boolean | undefined>>;
}): Result<GithubRepoInvocation> {
  if (values["approve"] !== undefined) {
    errors.push("--approve is for every write bar --description, which takes --dry-run instead");
  }
  if (errors.length > 0 || repo === undefined) {
    return err(errors);
  }
  const dryRun = values["dry-run"] === true;
  return ok({ args: { ...common, description, dryRun, owner: repo.owner, repo: repo.repo }, kind: "description" });
}

/**
 * The external-write door request for one repository's description.
 *
 * @param args the parsed repository and description change
 * @param home the Slopweaver state home whose door records the write
 * @returns the exact external-write request admitted by the door
 */
export function repoDescriptionDoorRequest({ args, home }: { args: GithubRepoArgs; home: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "repo" },
    artifact: { id: `${args.owner}/${args.repo}` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}

/**
 * The approval-backed external-write door request for one rename, transfer or archive.
 *
 * @param view the plan view the digest was computed over, recorded so the ledger row names the exact write
 * @param digest the plan's digest as it stands now
 * @param kind which administration write, carried on the action so each row names it
 * @param home the Slopweaver state home whose door records the write
 * @returns the request the door admits only past the approval gate
 */
export function repoAdministrationDoorRequest({
  view,
  digest,
  kind,
  home,
}: {
  view: Readonly<Record<string, unknown>>;
  digest: string;
  kind: GithubRepoAdministrationAction["kind"];
  home: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: `repo ${kind}` },
    artifact: { ...view, digest },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: true },
  };
}
