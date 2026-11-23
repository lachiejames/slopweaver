/**
 * Which projection each admitted call's records go through.
 *
 * A lookup keyed on the call's own id rather than a `switch` inside the sync, for one reason worth stating:
 * `inventory.ts` is a closed table and this is its other half, so a row added there without a projection
 * here is a compile error at the projector table's own `Record<GithubProjectedCallId, …>` type rather than
 * a call whose records are silently dropped. Two calls in the table deliberately share one kind and do NOT share a projection —
 * `repo-settings` and `repo-security-settings` read the same repository document and project different
 * parts of it — which is exactly the case a switch on `kind` would have got wrong.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type GithubRefusalError, GithubRefusalErrors } from "./errors.js";
import { type GithubProjectedCallId, isGithubDiscoveryCallId } from "./inventory.js";
import type { GithubEntity } from "./kindFiles.js";
import {
  type ProjectionContext,
  projectGithubActionsPolicy,
  projectGithubAppInstallation,
  projectGithubCodeScanningDefaultSetup,
  projectGithubCodeSecurityConfiguration,
  projectGithubCustomPropertyDefinition,
  projectGithubCustomRepositoryRole,
  projectGithubDeployKey,
  projectGithubEnvironment,
  projectGithubOrganizationSettings,
  projectGithubRepositoryLabel,
  projectGithubRepositorySecuritySettings,
  projectGithubRepositorySettings,
  projectGithubRuleset,
  projectGithubSecretName,
  projectGithubVariableName,
  projectGithubWebhook,
} from "./projection.js";
import type { CallOutcome } from "./syncRead.js";

/**
 * What every projector does: turn one call's records into stored entities, dropping what it cannot read.
 *
 * `companion` carries the records of a call that folds into THIS one's entity rather than producing its
 * own. GitHub splits its Actions policy across two routes — the enablement document and the workflow
 * defaults — and they describe ONE policy, so projecting them separately mints two entities with the same
 * identity and `mergeKind` refuses the whole run for producing one id twice. That is not hypothetical: it
 * is exactly what the first version of this file did, and the sync's own test is what caught it.
 *
 * @internal
 */
export type CallProjector = (input: {
  records: readonly unknown[];
  companion: readonly unknown[];
  scopeRef: string;
  context: ProjectionContext;
}) => readonly GithubEntity[];

/**
 * Which call's records fold into another call's entity rather than producing their own.
 *
 * Keyed by the call whose records are ABSORBED, valued by the call that absorbs them.
 *
 * @internal
 */
export const GITHUB_COMPANION_CALLS: Readonly<Record<string, string>> = {
  "org-actions-workflow-defaults": "org-actions-policy",
  "repo-actions-workflow-defaults": "repo-actions-policy",
};

/** Lift a single-record projection into one that reads the first record a route returned. */
function singleton({
  project,
}: {
  project: (input: { raw: unknown; scopeRef: string; context: ProjectionContext }) => GithubEntity | null;
}): CallProjector {
  return ({ records, scopeRef, context }) => {
    const first = records[0];
    if (first === undefined) {
      return [];
    }
    const projected = project({ context, raw: first, scopeRef });
    return projected === null ? [] : [projected];
  };
}

/** Lift a per-record projection into one that reads a whole listing, dropping records it cannot read. */
function listing({
  project,
}: {
  project: (input: { raw: unknown; scopeRef: string; context: ProjectionContext }) => GithubEntity | null;
}): CallProjector {
  return ({ records, scopeRef, context }) =>
    records.flatMap((raw): readonly GithubEntity[] => {
      const projected = project({ context, raw, scopeRef });
      return projected === null ? [] : [projected];
    });
}

/**
 * Every admitted call's projection, keyed by the call's own id.
 *
 * A TABLE rather than a switch, and keyed on the call id rather than on the kind. Two calls in
 * `inventory.ts` deliberately share one kind and do NOT share a projection — `repo-settings` and
 * `repo-security-settings` read the same repository document and project different parts of it — which is
 * exactly the case a switch on `kind` would have got wrong.
 */
const PROJECTORS: Readonly<Record<GithubProjectedCallId, CallProjector>> = {
  "org-actions-policy": ({ records, companion, scopeRef, context }) => {
    // The workflow-defaults route folds in as this call's COMPANION rather than as its own entity — see
    // GITHUB_COMPANION_CALLS. A run that read only this one leaves those fields null, which is what
    // "null means this token did not see it" already means everywhere else in this atlas. Both documents are
    // handed over as they arrived: the projection reads each only once it has proven it a record, so a route
    // that returned nothing reaches it as exactly that, with no stand-in value chosen here.
    const projected = projectGithubActionsPolicy({
      context,
      permissions: records[0],
      scopeLevel: "organization",
      scopeRef,
      workflow: companion[0],
    });
    return projected === null ? [] : [projected];
  },
  // Absorbed by org-actions-policy. Producing nothing here is what keeps one policy one entity.
  "org-actions-workflow-defaults": () => [],
  "org-app-installations": listing({ project: projectGithubAppInstallation }),
  "org-code-security-configurations": listing({ project: projectGithubCodeSecurityConfiguration }),
  "org-custom-properties": listing({ project: projectGithubCustomPropertyDefinition }),
  "org-custom-repository-roles": listing({ project: projectGithubCustomRepositoryRole }),
  "org-rulesets": listing({
    project: ({ raw, scopeRef, context }) =>
      projectGithubRuleset({ context, raw, scopeLevel: "organization", scopeRef }),
  }),
  "org-secrets": listing({
    project: ({ raw, scopeRef, context }) =>
      projectGithubSecretName({ context, raw, scopeLevel: "organization", scopeRef }),
  }),
  "org-settings": singleton({ project: projectGithubOrganizationSettings }),
  "org-variables": listing({
    project: ({ raw, scopeRef, context }) =>
      projectGithubVariableName({ context, raw, scopeLevel: "organization", scopeRef }),
  }),
  "org-webhooks": listing({
    project: ({ raw, scopeRef, context }) =>
      projectGithubWebhook({ context, raw, scopeLevel: "organization", scopeRef }),
  }),
  "repo-actions-policy": ({ records, companion, scopeRef, context }) => {
    // The repository's workflow defaults fold in exactly as the organisation's do — see org-actions-policy.
    const projected = projectGithubActionsPolicy({
      context,
      permissions: records[0],
      scopeLevel: "repository",
      scopeRef,
      workflow: companion[0],
    });
    return projected === null ? [] : [projected];
  },
  // Absorbed by repo-actions-policy, for the same reason as its organisation twin.
  "repo-actions-workflow-defaults": () => [],
  "repo-code-scanning-default-setup": singleton({ project: projectGithubCodeScanningDefaultSetup }),
  "repo-deploy-keys": listing({ project: projectGithubDeployKey }),
  "repo-environments": listing({ project: projectGithubEnvironment }),
  "repo-labels": listing({ project: projectGithubRepositoryLabel }),
  "repo-rulesets": listing({
    project: ({ raw, scopeRef, context }) => projectGithubRuleset({ context, raw, scopeLevel: "repository", scopeRef }),
  }),
  "repo-secrets": listing({
    project: ({ raw, scopeRef, context }) =>
      projectGithubSecretName({ context, raw, scopeLevel: "repository", scopeRef }),
  }),
  "repo-security-settings": singleton({ project: projectGithubRepositorySecuritySettings }),
  "repo-settings": singleton({ project: projectGithubRepositorySettings }),
  "repo-variables": listing({
    project: ({ raw, scopeRef, context }) =>
      projectGithubVariableName({ context, raw, scopeLevel: "repository", scopeRef }),
  }),
  "repo-webhooks": listing({
    project: ({ raw, scopeRef, context }) => projectGithubWebhook({ context, raw, scopeLevel: "repository", scopeRef }),
  }),
};

/**
 * Whether a call id is one the projector table declares as its OWN key — every admitted call but the two
 * discovery calls, which produce a scope list rather than an entity.
 */
function isProjectedCallId(id: string): id is GithubProjectedCallId {
  return Object.hasOwn(PROJECTORS, id);
}

/**
 * The projection one projected call's records go through.
 *
 * Total: {@link PROJECTORS} is typed by every projected call id, so an admitted row added without a
 * projector is a compile error there, and a discovery or unknown id cannot reach here at all — the caller
 * settles both first, in {@link projectCallOutcome}.
 *
 * @param callId a call the table projects, never a discovery call
 * @returns its projector
 */
export function projectorFor({ callId }: { callId: GithubProjectedCallId }): CallProjector {
  return PROJECTORS[callId];
}

/**
 * One successful call's records, projected into entities — or refused when the call is in neither half of
 * the closed inventory.
 *
 * The two cases a projector lookup could miss are different facts and are answered differently: a
 * DISCOVERY call is a valid call with no projection by design, and an id outside the inventory is a
 * malformed call whose records would otherwise be dropped without a word.
 *
 * @param at this run's ISO timestamp, stamped on every projected entity's provenance
 * @param companion the records of the call that folds into this one's entity, at the same scope
 * @param outcome a call that read successfully
 * @returns the call's entities, or the refusal naming a call the inventory does not hold
 */
export function projectCallOutcome({
  at,
  companion,
  outcome,
}: {
  at: string;
  companion: readonly unknown[];
  outcome: Extract<CallOutcome, { readonly error: null }>;
}): Result<readonly GithubEntity[], GithubRefusalError> {
  const { call, route, scopeRef } = outcome;
  if (isGithubDiscoveryCallId(call.id)) {
    // Absent by design: a discovery call's records ARE the scope list — the logins and coordinates the rest
    // of the table is run against — never configuration, so there is no entity for them to become.
    return ok([]);
  }
  if (!isProjectedCallId(call.id)) {
    return err(GithubRefusalErrors.callUnregistered({ callId: call.id }));
  }
  const context: ProjectionContext = { at, source: { endpoint: route, observedAt: at, surface: "rest-live" } };
  return ok(projectorFor({ callId: call.id })({ companion, context, records: outcome.outcome.records, scopeRef }));
}
