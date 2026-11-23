/**
 * `access-policy` — the one kind whose fan-out is BIPARTITE, and the only reason this module is not shaped
 * like its four siblings.
 *
 * Every other fan-out kind embeds a child collection back into the SAME parent that owns it. An Access
 * policy does not: it can be reusable across many applications, or exclusive to one, so the fan-out reads
 * the account-level reusable list PLUS one policy list per current application, and `accessPolicyReconcile.ts`
 * reconciles the two into a policy/application graph. One failed application's read therefore leaves only
 * that application's bindings untouched, never blanking or freezing any other application's successful
 * update — see that module's own header.
 *
 * That also means the gap inputs are hand-written rather than `basicParentFanoutGapInputs`: this kind has
 * two KINDS of sub-attempt (the reusable list, and each application), and each needs its own scope.
 */
import type Cloudflare from "cloudflare";

import { ok, type Result } from "../../lib/result.js";

import { type AccessPolicyAppAttempt, reconcileAccessPolicies } from "./accessPolicyReconcile.js";
import type { CloudflareClientError } from "./errors.js";
import { readParentCollections } from "./fanout.js";
import {
  CLOUDFLARE_GAP_CONDITIONS,
  type CloudflareGapRecheck,
  classifyCloudflareClientErrorGap,
  openCloudflareGap,
} from "./gaps.js";
import {
  buildFanoutCoverageCell,
  flatKindScope,
  foldFailedKindRead,
  foldFanoutResult,
  type KindFoldResult,
} from "./kindFold.js";
import type { CloudflareGap, CloudflareKindFile } from "./model.js";
import { PARENT_FANOUT_CONCURRENCY } from "./parentFanoutFold.js";
import type { CloudflareRawAccessPolicy } from "./projection/accessPolicy.js";
import { readCloudflareAccessApplications } from "./readers/access.js";
import {
  readCloudflareAccessApplicationPolicies,
  readCloudflareAccessReusablePolicies,
} from "./readers/accessPolicy.js";

/** The scope one Access application's policy fan-out attempt is recorded under. */
function accessPolicyAppScope({ accountId, applicationId }: { accountId: string; applicationId: string }): string {
  return `account/${accountId}/access-policy/app/${applicationId}`;
}

/** The scope the account-level reusable-policy read is recorded under. */
function accessPolicyReusableScope({ accountId }: { accountId: string }): string {
  return `account/${accountId}/access-policy/reusable-list`;
}

/**
 * Build the observed gaps and rechecks for this run's Access-policy attempt — one gap per failed
 * sub-attempt (the reusable list, or one application), and a recheck for every sub-attempt that succeeded.
 *
 * @param accountId the selected account id
 * @param reusableRead this run's account-level reusable-policy read
 * @param appAttempts this run's per-application policy-read attempts
 * @param at this run's ISO timestamp
 * @returns the gaps this run observed, and the rechecks it earned
 */
function accessPolicyGapInputs({
  accountId,
  reusableRead,
  appAttempts,
  at,
}: {
  accountId: string;
  reusableRead: Result<readonly CloudflareRawAccessPolicy[], CloudflareClientError>;
  appAttempts: readonly AccessPolicyAppAttempt[];
  at: string;
}): {
  observed: readonly CloudflareGap[];
  rechecks: readonly CloudflareGapRecheck[];
} {
  const observed: CloudflareGap[] = [];
  const rechecks: CloudflareGapRecheck[] = [];
  const reusableScope = accessPolicyReusableScope({ accountId });
  if (reusableRead.isErr()) {
    observed.push(
      openCloudflareGap({
        at,
        condition: classifyCloudflareClientErrorGap({ error: reusableRead.error }),
        kind: "access-policy",
        reason: reusableRead.error.message,
        scope: reusableScope,
      }),
    );
  } else {
    CLOUDFLARE_GAP_CONDITIONS.forEach((condition) =>
      rechecks.push({ condition, resolved: true, scope: reusableScope }),
    );
  }
  for (const attempt of appAttempts) {
    const scope = accessPolicyAppScope({ accountId, applicationId: attempt.applicationId });
    if (attempt.result.isErr()) {
      observed.push(
        openCloudflareGap({
          at,
          condition: classifyCloudflareClientErrorGap({ error: attempt.result.error }),
          kind: "access-policy",
          reason: attempt.result.error.message,
          scope,
        }),
      );
    } else {
      CLOUDFLARE_GAP_CONDITIONS.forEach((condition) => rechecks.push({ condition, resolved: true, scope }));
    }
  }
  return { observed, rechecks };
}

/**
 * Read the account-level reusable-policy list and fan out one policy-list read per current application.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param currentApplicationIds every currently-listed application id to fan out over
 * @returns this run's reusable-list read, and every application's own attempt
 */
async function readAccessPolicyFanout({
  client,
  accountId,
  currentApplicationIds,
}: {
  client: Cloudflare;
  accountId: string;
  currentApplicationIds: readonly string[];
}): Promise<{
  reusableRead: Result<readonly CloudflareRawAccessPolicy[], CloudflareClientError>;
  appAttempts: readonly AccessPolicyAppAttempt[];
}> {
  const reusableRead = await readCloudflareAccessReusablePolicies({ accountId, client });
  const attempts = await readParentCollections<CloudflareRawAccessPolicy>({
    concurrency: PARENT_FANOUT_CONCURRENCY,
    parentIds: currentApplicationIds,
    read: ({ parentId }) => readCloudflareAccessApplicationPolicies({ accountId, applicationId: parentId, client }),
  });
  return {
    appAttempts: attempts.map((attempt) => ({ applicationId: attempt.parentId, result: attempt.result })),
    reusableRead,
  };
}

/**
 * Read, reconcile and fold this run's Access-policy fan-out into its stored kind file. Not a flat kind:
 * one failed application's policy read leaves only that application's bindings untouched, never blanking
 * or freezing any other application's successful update — see `accessPolicyReconcile.ts`'s header.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param stored the `access-policy` kind file as it stood before this run
 * @param at this run's ISO timestamp
 * @returns the file to publish and this run's outcome, or why the reconciliation itself failed
 */
export async function syncAccessPolicyKind({
  client,
  accountId,
  stored,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  stored: CloudflareKindFile;
  at: string;
}): Promise<Result<KindFoldResult>> {
  const scope = flatKindScope({ accountId, kind: "access-policy" });
  const appInventory = await readCloudflareAccessApplications({ accountId, at, client });
  if (appInventory.isErr()) {
    return ok(foldFailedKindRead({ at, error: appInventory.error, kind: "access-policy", scope, stored }));
  }
  const currentApplicationIds = appInventory.value.map((application) => application.providerId);

  const { reusableRead, appAttempts } = await readAccessPolicyFanout({ accountId, client, currentApplicationIds });
  const reconciliation = reconcileAccessPolicies({
    accountId,
    appAttempts,
    at,
    currentApplicationIds,
    reusableRead,
    stored: stored.entities,
  });
  const cell = buildFanoutCoverageCell({
    at,
    complete: reconciliation.complete,
    reasons: reconciliation.reasons,
    scope,
    stored,
    successReason: `reconciled ${String(reconciliation.entities.length)} polic(y/ies) across ${String(currentApplicationIds.length)} application(s)`,
  });

  return foldFanoutResult({
    at,
    cell,
    complete: reconciliation.complete,
    entities: reconciliation.entities,
    gapInputs: accessPolicyGapInputs({ accountId, appAttempts, at, reusableRead }),
    kind: "access-policy",
    kindScopeRead: "succeeded",
    reasons: reconciliation.reasons,
    scope,
    stored,
  });
}
