/**
 * The repository-level settings `github repo --apply-manifest` reads and writes: description, the five feature
 * switches and the merge settings (one `PATCH /repos/{owner}/{repo}`), the topic set, and whether Dependabot alerts
 * are on. On the write lane's context (`./writeCtx.ts`), so each write is sent once.
 *
 * Every field the apply judges is checked at runtime. GitHub returns several merge settings only to a caller with
 * admin on the repository, and the SDK types them optional, so an absent field is an error here rather than a
 * value: an absent `allow_auto_merge` read as `false` would report a setting as already applied that was never
 * read at all.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { errAsync, okAsync, type ResultAsync } from "../../lib/result.js";
import type { RepoRef } from "./write.js";
import type { WriteCtx } from "./writeCtx.js";

/** The five feature switches the apply sets. */
export interface RepoFeatureSettings {
  readonly hasIssues: boolean;
  readonly hasProjects: boolean;
  readonly hasWiki: boolean;
  readonly hasDiscussions: boolean;
  readonly isTemplate: boolean;
}

/** The merge settings the apply sets, in GitHub's own enum spellings. */
export interface RepoMergeSettings {
  readonly allowMergeCommit: boolean;
  readonly allowSquashMerge: boolean;
  readonly allowRebaseMerge: boolean;
  readonly allowAutoMerge: boolean;
  readonly allowUpdateBranch: boolean;
  readonly deleteBranchOnMerge: boolean;
  readonly squashMergeCommitTitle: string;
  readonly squashMergeCommitMessage: string;
  readonly webCommitSignoffRequired: boolean;
}

/** The repository as the apply judges it. */
export interface RepoManifestRepositoryState {
  readonly id: number;
  readonly fullName: string;
  /** `public`, `private` or `internal`, as GitHub reports it. */
  readonly visibility: string;
  readonly description: string | null;
  readonly features: RepoFeatureSettings;
  readonly merge: RepoMergeSettings;
}

/** One write to the repository object; only the fields named are sent. */
export interface RepoSettingsPatch {
  readonly description?: string | null;
  readonly features?: RepoFeatureSettings;
  readonly merge?: RepoMergeSettings;
}

/** A field GitHub must have returned, refused by name when it did not. */
function required<T>({
  value,
  field,
  check,
}: {
  value: unknown;
  field: string;
  check: (value: unknown) => value is T;
}): T {
  if (!check(value)) {
    throw new Error(`GitHub's repository read omitted ${field}, so it is unknown; read it with an admin token`);
  }
  return value;
}

/** Narrow to a boolean. Positional because a type predicate cannot destructure (TS1230). */
function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** Narrow to a string. Positional because a type predicate cannot destructure (TS1230). */
function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Read the repository's identity, visibility, description, features and merge settings. Repeatable.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository to read
 * @returns the live state; a field GitHub omitted is an error, never a default
 */
export function getRepoManifestRepositoryVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<RepoManifestRepositoryState, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      const { data } = await ctx.client.rest.repos.get({ owner, repo });
      const bool = ({ value, field }: { value: unknown; field: string }): boolean =>
        required({ check: isBoolean, field, value });
      const text = ({ value, field }: { value: unknown; field: string }): string =>
        required({ check: isString, field, value });
      return {
        description: data.description,
        features: {
          hasDiscussions: bool({ field: "has_discussions", value: data.has_discussions }),
          hasIssues: bool({ field: "has_issues", value: data.has_issues }),
          hasProjects: bool({ field: "has_projects", value: data.has_projects }),
          hasWiki: bool({ field: "has_wiki", value: data.has_wiki }),
          isTemplate: bool({ field: "is_template", value: data.is_template }),
        },
        fullName: data.full_name,
        id: data.id,
        merge: {
          allowAutoMerge: bool({ field: "allow_auto_merge", value: data.allow_auto_merge }),
          allowMergeCommit: bool({ field: "allow_merge_commit", value: data.allow_merge_commit }),
          allowRebaseMerge: bool({ field: "allow_rebase_merge", value: data.allow_rebase_merge }),
          allowSquashMerge: bool({ field: "allow_squash_merge", value: data.allow_squash_merge }),
          allowUpdateBranch: bool({ field: "allow_update_branch", value: data.allow_update_branch }),
          deleteBranchOnMerge: bool({ field: "delete_branch_on_merge", value: data.delete_branch_on_merge }),
          squashMergeCommitMessage: text({
            field: "squash_merge_commit_message",
            value: data.squash_merge_commit_message,
          }),
          squashMergeCommitTitle: text({ field: "squash_merge_commit_title", value: data.squash_merge_commit_title }),
          webCommitSignoffRequired: bool({
            field: "web_commit_signoff_required",
            value: data.web_commit_signoff_required,
          }),
        },
        visibility: text({ field: "visibility", value: data.visibility }),
      };
    },
    operation: "github.repos.get",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/** A description as GitHub takes it, where clearing one is sending the empty string. */
function descriptionToSend({ value }: { value: string | null }): string {
  if (value === null) {
    return "";
  }
  return value;
}

/**
 * Write the named repository fields in one `PATCH`. Sent once; the caller confirms it with a read-back.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository and the fields to send
 * @returns nothing on GitHub's acceptance
 */
export function updateRepoSettingsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { readonly patch: RepoSettingsPatch };
}): ResultAsync<void, IngestError> {
  const { owner, repo, patch } = input;
  const { features, merge } = patch;
  return safeProviderCall({
    execute: async () => {
      await ctx.client.rest.repos.update({
        owner,
        repo,
        ...("description" in patch ? { description: descriptionToSend({ value: patch.description }) } : {}),
        ...(features === undefined
          ? {}
          : {
              has_discussions: features.hasDiscussions,
              has_issues: features.hasIssues,
              has_projects: features.hasProjects,
              has_wiki: features.hasWiki,
              is_template: features.isTemplate,
            }),
        ...(merge === undefined
          ? {}
          : {
              allow_auto_merge: merge.allowAutoMerge,
              allow_merge_commit: merge.allowMergeCommit,
              allow_rebase_merge: merge.allowRebaseMerge,
              allow_squash_merge: merge.allowSquashMerge,
              allow_update_branch: merge.allowUpdateBranch,
              delete_branch_on_merge: merge.deleteBranchOnMerge,
              squash_merge_commit_message: squashMessageOf({ value: merge.squashMergeCommitMessage }),
              squash_merge_commit_title: squashTitleOf({ value: merge.squashMergeCommitTitle }),
              web_commit_signoff_required: merge.webCommitSignoffRequired,
            }),
      });
    },
    operation: "github.repos.update",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/** GitHub's squash commit message enum, refused by value rather than cast. */
function squashMessageOf({ value }: { value: string }): "PR_BODY" | "COMMIT_MESSAGES" | "BLANK" {
  if (value === "PR_BODY" || value === "COMMIT_MESSAGES" || value === "BLANK") {
    return value;
  }
  throw new Error(`"${value}" is not a squash commit message GitHub accepts`);
}

/** GitHub's squash commit title enum, refused by value rather than cast. */
function squashTitleOf({ value }: { value: string }): "PR_TITLE" | "COMMIT_OR_PR_TITLE" {
  if (value === "PR_TITLE" || value === "COMMIT_OR_PR_TITLE") {
    return value;
  }
  throw new Error(`"${value}" is not a squash commit title GitHub accepts`);
}

/**
 * Read the repository's topics. Repeatable.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository to read
 * @returns the topic names as GitHub holds them
 */
export function getRepoTopicsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<readonly string[], IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => (await ctx.client.rest.repos.getAllTopics({ owner, repo })).data.names,
    operation: "github.repos.getAllTopics",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Replace the repository's whole topic set. Sent once.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository and the complete set it takes
 * @returns nothing on GitHub's acceptance
 */
export function replaceRepoTopicsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { readonly topics: readonly string[] };
}): ResultAsync<void, IngestError> {
  const { owner, repo, topics } = input;
  return safeProviderCall({
    execute: async () => {
      await ctx.client.rest.repos.replaceAllTopics({ names: [...topics], owner, repo });
    },
    operation: "github.repos.replaceAllTopics",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}

/**
 * Read whether Dependabot alerts are on. GitHub answers 204 when they are and 404 when they are not, so a 404 is
 * the state "off" here; the caller has already read the repository, so it cannot mean the repository is missing.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository to read
 * @returns true when alerts are on
 */
export function getDependabotAlertsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<boolean, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      await ctx.client.rest.repos.checkVulnerabilityAlerts({ owner, repo });
      return true;
    },
    operation: "github.repos.checkVulnerabilityAlerts",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  }).orElse((error) => (error.status === 404 ? okAsync(false) : errAsync(error)));
}

/**
 * Turn Dependabot alerts on or off. Sent once.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository and the state it takes
 * @returns nothing on GitHub's acceptance
 */
export function setDependabotAlertsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { readonly enabled: boolean };
}): ResultAsync<void, IngestError> {
  const { owner, repo, enabled } = input;
  return safeProviderCall({
    execute: async () => {
      if (enabled) {
        await ctx.client.rest.repos.enableVulnerabilityAlerts({ owner, repo });
        return;
      }
      await ctx.client.rest.repos.disableVulnerabilityAlerts({ owner, repo });
    },
    operation: enabled ? "github.repos.enableVulnerabilityAlerts" : "github.repos.disableVulnerabilityAlerts",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
