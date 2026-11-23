/**
 * One branch's classic PUSH RESTRICTION — who may push to, merge into and enqueue onto it — read and written
 * over GraphQL. The transport only: the payload is returned raw and shaped by the pure parser in
 * `../../outbound/github/pushRestrictionParse.ts`, so the shape decision is tested without a network.
 *
 * ## Why GraphQL, never REST's `PUT …/branches/{branch}/protection`
 *
 * REST can only TURN ON a restriction by replacing the whole protection rule, and that payload has no field
 * for the classic rule's merge-queue requirement — so a PUT built from what REST reads back could silently
 * drop the queue `main` lands through. `updateBranchProtectionRule` PATCHES only the fields it is sent.
 *
 * Same lane, same `WriteCtx`, every `client.graphql` token LEXICALLY inside `safeProviderCall(...)`, and the
 * mutation is `retryMode: "never"`; the caller confirms it with a separate read.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { RepoRef, WriteCtx } from "./write.js";

/**
 * How many classic rules, and how many allowance actors per rule, one read asks for — GraphQL's maximum page.
 * A repository carries a handful of rules; the parser refuses a FULL page rather than trusting it is whole.
 */
export const PUSH_RULE_PAGE = 100;

/**
 * Read every classic branch-protection rule on a repository, with its push restriction and allowances.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the repository whose rules to read
 * @returns the raw GraphQL payload, shaped by `parseBranchPushRule`
 */
export function branchPushRulesVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<unknown, IngestError> {
  return safeProviderCall({
    execute: async (): Promise<unknown> =>
      ctx.client.graphql(
        `query SlopweaverBranchPushRules($owner: String!, $name: String!, $page: Int!) {
          repository(owner: $owner, name: $name) {
            branchProtectionRules(first: $page) {
              totalCount
              nodes {
                id
                pattern
                restrictsPushes
                isAdminEnforced
                requiresApprovingReviews
                requiresCodeOwnerReviews
                pushAllowances(first: $page) {
                  totalCount
                  nodes {
                    actor {
                      __typename
                      ... on User { login }
                      ... on Team { slug }
                      ... on App { slug }
                    }
                  }
                }
              }
            }
          }
        }`,
        { name: input.repo, owner: input.owner, page: PUSH_RULE_PAGE },
      ),
    operation: "github.branchProtectionRules",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Resolve one user login to the GraphQL node id an allowance list is written in.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the login to resolve
 * @returns the raw GraphQL payload, shaped by `parseUserNodeId`
 */
export function userNodeIdVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: { login: string };
}): ResultAsync<unknown, IngestError> {
  return safeProviderCall({
    execute: async (): Promise<unknown> =>
      ctx.client.graphql(
        `query SlopweaverUserNodeId($login: String!) {
          user(login: $login) { id login }
        }`,
        { login: input.login },
      ),
    operation: "github.user",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Set one classic rule's push restriction and its EXACT allowance list. Sent once; the caller reads it back.
 *
 * @param ctx the lane's shared client and rate scope
 * @param input the rule's node id, whether pushes are restricted, and every actor id allowed to push
 * @returns nothing, or the provider failure
 */
export function updatePushRestrictionVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: { ruleId: string; restrictsPushes: boolean; actorIds: readonly string[] };
}): ResultAsync<void, IngestError> {
  return safeProviderCall({
    execute: async () => {
      await ctx.client.graphql(
        `mutation SlopweaverUpdatePushRestriction($ruleId: ID!, $restrictsPushes: Boolean!, $actorIds: [ID!]!) {
          updateBranchProtectionRule(
            input: { branchProtectionRuleId: $ruleId, restrictsPushes: $restrictsPushes, pushActorIds: $actorIds }
          ) {
            branchProtectionRule { id }
          }
        }`,
        { actorIds: [...input.actorIds], restrictsPushes: input.restrictsPushes, ruleId: input.ruleId },
      );
    },
    operation: "github.updateBranchProtectionRule",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
