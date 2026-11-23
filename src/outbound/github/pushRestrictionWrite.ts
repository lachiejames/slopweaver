/**
 * Who may push to, merge into and enqueue onto one branch — the classic PUSH RESTRICTION — shaped, judged and
 * written through `slopweaver github push-restriction`.
 *
 * ## Why this is how `main` is protected, and a required review is not
 *
 * A required code-owner review was on `lachiejames/slopweaver` `main` before the switch to GitHub's merge queue. Its owner authors nearly every pull request and GitHub never lets
 * an author approve their own, while an administrator's bypass is honoured only by a DIRECT merge — never by
 * `enqueuePullRequest`, under classic protection or a ruleset alike. So a required review and the queue
 * cannot coexist for that owner. A push restriction listing the owner alone keeps everyone else
 * from pushing, merging or ENQUEUEING ("Base branch restricts merging to restricted users") while the owner's own
 * enqueues keep landing. The research and its sources: `skills/github/reference/push-restriction.md`.
 */

import { branchPushRulesVia, updatePushRestrictionVia, userNodeIdVia } from "../../corpus/github/pushRestriction.js";
import { makeGithubWriteCtx } from "../../corpus/github/writeCtx.js";
import type { IngestError } from "../../lib/ingestError.js";
import { err, ok, type Result, type ResultAsync } from "../../lib/result.js";
import { type PushRestrictionError, PushRestrictionErrors } from "./pushRestrictionErrors.js";
import { type BranchPushRule, parseBranchPushRule, parseUserNodeId } from "./pushRestrictionParse.js";
import type { GithubWritePrivacy } from "./writePrivacy.js";

/** Injectable read/mutation surface; tests provide plain fakes. */
export interface GithubPushRestrictionApi {
  readRules(args: { owner: string; repo: string }): ResultAsync<unknown, IngestError>;
  userId(args: { login: string }): ResultAsync<unknown, IngestError>;
  update(args: {
    ruleId: string;
    restrictsPushes: boolean;
    actorIds: readonly string[];
  }): ResultAsync<void, IngestError>;
}

/**
 * Build the production no-SDK-retry client for the push-restriction verb.
 *
 * @param token the GitHub token
 * @returns the rule read, the login-to-node-id read and the restriction mutation
 */
export function makeGithubPushRestrictionApi({
  privacy,
  token,
}: {
  privacy: GithubWritePrivacy;
  token: string;
}): GithubPushRestrictionApi {
  const ctx = makeGithubWriteCtx({ privacy, token });
  return {
    readRules: ({ owner, repo }) => branchPushRulesVia({ ctx, input: { owner, repo } }),
    update: ({ ruleId, restrictsPushes, actorIds }) =>
      updatePushRestrictionVia({ ctx, input: { actorIds, restrictsPushes, ruleId } }),
    userId: ({ login }) => userNodeIdVia({ ctx, input: { login } }),
  };
}

/** What a write asks the branch to hold: restricted to exactly these user logins, or unrestricted. */
export type PushRestrictionTarget =
  { readonly kind: "restrict"; readonly logins: readonly string[] } | { readonly kind: "unrestrict" };

/**
 * One line naming a rule's restriction state, the form the mismatch message and the report both print.
 *
 * @param rule the rule to describe
 * @returns `restricted to user:a, team:b`, `restricted to nobody`, or `unrestricted`
 */
export function describeRestriction({
  rule,
}: {
  rule: Pick<BranchPushRule, "restrictsPushes" | "allowances">;
}): string {
  if (!rule.restrictsPushes) {
    return rule.allowances.length === 0
      ? "unrestricted"
      : `unrestricted (stale allowances: ${allowanceNames({ rule })})`;
  }
  return rule.allowances.length === 0 ? "restricted to nobody" : `restricted to ${allowanceNames({ rule })}`;
}

/** The allowances as sorted `kind:name` tokens. */
function allowanceNames({ rule }: { rule: Pick<BranchPushRule, "allowances"> }): string {
  return rule.allowances
    .map((allowance) => `${allowance.kind}:${allowance.name}`)
    .toSorted()
    .join(", ");
}

/**
 * Whether a rule already holds the target — GitHub logins are case-insensitive, so they compare lowercased.
 *
 * @param rule the rule as read
 * @param target what the caller asked for
 * @returns true when writing the target would change nothing
 */
export function ruleHoldsTarget({
  rule,
  target,
}: {
  rule: Pick<BranchPushRule, "restrictsPushes" | "allowances">;
  target: PushRestrictionTarget;
}): boolean {
  if (target.kind === "unrestrict") {
    return !rule.restrictsPushes && rule.allowances.length === 0;
  }
  const held = rule.allowances.map((allowance) => `${allowance.kind}:${allowance.name.toLowerCase()}`).toSorted();
  const wanted = [...new Set(target.logins.map((login) => `user:${login.toLowerCase()}`))].toSorted();
  return rule.restrictsPushes && held.join("\n") === wanted.join("\n");
}

/**
 * What else moved on the rule between the read and the read-back, or undefined when nothing did.
 *
 * The read-back finds the rule by PATTERN again, so the id is compared to prove it is the rule that was
 * patched, and every other field this read carries is compared to prove the mutation touched nothing beside
 * the restriction.
 *
 * @param before the rule as read before the write
 * @param after the rule as read back
 * @returns a one-line description of the first difference, or undefined
 */
export function neighboursMoved({
  before,
  after,
}: {
  before: BranchPushRule;
  after: BranchPushRule;
}): string | undefined {
  if (after.ruleId !== before.ruleId) {
    return `a different rule (${after.ruleId}, was ${before.ruleId})`;
  }
  const fields = ["isAdminEnforced", "requiresApprovingReviews", "requiresCodeOwnerReviews"] as const;
  const changed = fields.find((field) => after[field] !== before[field]);
  return changed === undefined ? undefined : `${changed} ${String(after[changed])}, was ${String(before[changed])}`;
}

/**
 * Resolve the logins, send the restriction once, then read the rule back and compare.
 *
 * @param api the read/mutation surface to drive
 * @param rule the rule as read before the write, whose id is patched
 * @param target the restriction to store
 * @returns the rule as read back, or the one way the round trip failed
 */
export async function setAndConfirmPushRestriction({
  api,
  identity,
  owner,
  repo,
  branch,
  rule,
  target,
}: {
  api: GithubPushRestrictionApi;
  identity: string;
  owner: string;
  repo: string;
  branch: string;
  rule: BranchPushRule;
  target: PushRestrictionTarget;
}): Promise<Result<BranchPushRule, PushRestrictionError>> {
  const actorIds = await resolveActorIds({ api, target });
  if (actorIds.isErr()) {
    return err(actorIds.error);
  }
  const sent = await api.update({
    actorIds: actorIds.value,
    restrictsPushes: target.kind === "restrict",
    ruleId: rule.ruleId,
  });
  if (sent.isErr()) {
    return err(PushRestrictionErrors.callFailed({ cause: sent.error }));
  }
  const after = await api.readRules({ owner, repo });
  if (after.isErr()) {
    return err(PushRestrictionErrors.callFailed({ cause: after.error }));
  }
  const stored = parseBranchPushRule({ branch, data: after.value, identity });
  if (stored.isErr()) {
    return err(stored.error);
  }
  return confirmReadBack({ before: rule, branch, identity, stored: stored.value, target });
}

/**
 * Resolve every login a restriction names to its node id, before anything is sent.
 *
 * @param api the read surface the lookups go through
 * @param target the restriction asked for; an unrestrict needs no ids
 * @returns the ids in login order, or the first lookup that failed
 */
async function resolveActorIds({
  api,
  target,
}: {
  api: GithubPushRestrictionApi;
  target: PushRestrictionTarget;
}): Promise<Result<string[], PushRestrictionError>> {
  const actorIds: string[] = [];
  if (target.kind === "unrestrict") {
    return ok(actorIds);
  }
  for (const login of target.logins) {
    const looked = await api.userId({ login });
    if (looked.isErr()) {
      return err(PushRestrictionErrors.callFailed({ cause: looked.error }));
    }
    const id = parseUserNodeId({ data: looked.value, login });
    if (id.isErr()) {
      return err(id.error);
    }
    actorIds.push(id.value);
  }
  return ok(actorIds);
}

/**
 * Judge the read-back: the same rule, nothing else on it moved, and exactly the restriction asked for.
 *
 * @param before the rule as read before the write
 * @param stored the rule as read back
 * @param target the restriction asked for
 * @returns the read-back rule, or the mismatch naming what is stored instead
 */
function confirmReadBack({
  before,
  stored,
  target,
  identity,
  branch,
}: {
  before: BranchPushRule;
  stored: BranchPushRule;
  target: PushRestrictionTarget;
  identity: string;
  branch: string;
}): Result<BranchPushRule, PushRestrictionError> {
  const moved = neighboursMoved({ after: stored, before });
  if (moved !== undefined) {
    return err(
      PushRestrictionErrors.readBackMismatch({
        branch,
        identity,
        stored: moved,
        wanted: "only the push restriction changed",
      }),
    );
  }
  if (ruleHoldsTarget({ rule: stored, target })) {
    return ok(stored);
  }
  const wanted =
    target.kind === "restrict"
      ? describeRestriction({
          rule: { allowances: target.logins.map((name) => ({ kind: "user", name })), restrictsPushes: true },
        })
      : "unrestricted";
  return err(
    PushRestrictionErrors.readBackMismatch({ branch, identity, stored: describeRestriction({ rule: stored }), wanted }),
  );
}
