/**
 * Read, fan out and fold the `pages-project` kind — the first kind to get its own module, once a
 * fourth non-flat kind would have pushed `sync.ts` over the repo's file-size ratchet. Every non-flat kind
 * now has one, registered in `nonFlatKinds.ts`'s `nonFlatKindSpecs`; this one mirrors `gatewayListSync.ts`
 * exactly, built on the same shared `kindFold.ts` infrastructure.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../lib/result.js";
import { type CloudflareClientError, CloudflareClientErrors } from "./errors.js";
import type { ParentCollectionAttempt } from "./fanout.js";
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
import type { CloudflareEntity, CloudflareGap, CloudflareKindFile } from "./model.js";
import { fanOutAndReconcile, parentFanoutScope } from "./parentFanoutFold.js";
import type { reconcileParentFanout } from "./parentFanoutReconcile.js";
import {
  type CloudflarePagesChildItem,
  type CloudflarePagesRawChildItem,
  type CloudflareRawPagesProject,
  extractCloudflarePagesChildren,
  isCloudflarePagesProjectDetail,
  missingDeclaredPagesDomains,
  normalizeCloudflarePagesChildItem,
  projectCloudflarePagesProject,
} from "./projection/pages.js";
import { readCloudflarePagesProjectChildren, readCloudflarePagesProjectInventory } from "./readers/pages.js";

/**
 * Build the observed gaps and rechecks for this run's Pages attempt. Like a gateway-list attempt, a
 * succeeded-but-incomplete project opens a fresh `pagination-incomplete` gap instead of rechecking it
 * resolved — the combined deployments/domains read succeeded, but still missed a domain the project itself
 * declared.
 *
 * @param accountId the selected account id
 * @param attempts this run's per-project fan-out attempts
 * @param entities this run's reconciled `pages-project` entities
 * @param at this run's ISO timestamp
 * @returns the gaps this run observed, and the rechecks it earned
 */
function pagesProjectGapInputs({
  accountId,
  attempts,
  entities,
  at,
}: {
  accountId: string;
  attempts: readonly ParentCollectionAttempt<CloudflarePagesChildItem>[];
  entities: readonly CloudflareEntity[];
  at: string;
}): { observed: readonly CloudflareGap[]; rechecks: readonly CloudflareGapRecheck[] } {
  const entityByProjectId = new Map(entities.map((entity) => [entity.providerId, entity]));
  const observed: CloudflareGap[] = [];
  const rechecks: CloudflareGapRecheck[] = [];
  const nonPaginationConditions = CLOUDFLARE_GAP_CONDITIONS.filter(
    (condition) => condition !== "pagination-incomplete",
  );
  for (const attempt of attempts) {
    const scope = parentFanoutScope({ accountId, kind: "pages-project", parentId: attempt.parentId });
    if (attempt.result.isErr()) {
      observed.push(
        openCloudflareGap({
          at,
          condition: classifyCloudflareClientErrorGap({ error: attempt.result.error }),
          kind: "pages-project",
          reason: attempt.result.error.message,
          scope,
        }),
      );
      continue;
    }
    nonPaginationConditions.forEach((condition) => rechecks.push({ condition, resolved: true, scope }));
    const entity = entityByProjectId.get(attempt.parentId);
    const detail = entity !== undefined && isCloudflarePagesProjectDetail(entity.detail) ? entity.detail : null;
    if (detail === null || detail.domainsComplete) {
      rechecks.push({ condition: "pagination-incomplete", resolved: true, scope });
    } else {
      observed.push(
        openCloudflareGap({
          at,
          condition: "pagination-incomplete",
          kind: "pages-project",
          reason: `declared domain(s) not read: ${missingDeclaredPagesDomains({ declared: detail.declaredDomainNames, read: detail.domains }).join(", ")}`,
          scope,
        }),
      );
    }
  }
  return { observed, rechecks };
}

/**
 * Whether this run's Pages reconciliation is complete — the fan-out itself succeeding is not enough; every
 * project's read must also have covered its declared domain list.
 *
 * @param reconciliation this run's reconciled `pages-project` entities
 * @returns overall completeness, and every reason it fell short
 */
function pagesProjectCompleteness({
  reconciliation,
}: {
  reconciliation: ReturnType<typeof reconcileParentFanout<CloudflareRawPagesProject, CloudflarePagesChildItem>>;
}): { complete: boolean; reasons: readonly string[] } {
  const incomplete = reconciliation.entities.filter(
    (entity) => isCloudflarePagesProjectDetail(entity.detail) && !entity.detail.domainsComplete,
  );
  return {
    complete: reconciliation.complete && incomplete.length === 0,
    reasons: [
      ...reconciliation.reasons,
      ...incomplete.map((entity) => `${entity.providerId}: declared domain(s) not read`),
    ],
  };
}

/**
 * Read one Pages project's children by its fan-out id, resolving the id to the project's own NAME first —
 * Pages addresses deployments/domains by name, never by id, so `readChild`'s id-only contract needs this
 * lookup in between.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param projectNameById every current project's id mapped to its own name
 * @param parentId the project id this fan-out attempt is for
 * @returns this project's combined deployments/domains read, or why it could not be resolved/read
 */
async function readPagesProjectChildrenById({
  client,
  accountId,
  projectNameById,
  parentId,
}: {
  client: Cloudflare;
  accountId: string;
  projectNameById: ReadonlyMap<string, string>;
  parentId: string;
}): Promise<Result<readonly CloudflarePagesRawChildItem[], CloudflareClientError>> {
  const projectName = projectNameById.get(parentId);
  if (projectName === undefined) {
    return err(
      CloudflareClientErrors.schema({
        cause: `no Pages project name resolved for id ${parentId}`,
        operation: "pages-project-children-list",
      }),
    );
  }
  return readCloudflarePagesProjectChildren({ accountId, client, projectName });
}

/**
 * Read, fan out and fold this run's Pages attempt into its stored kind file. A failed project's own
 * deployments/domains read preserves only that project's previous children; a project absent from a
 * successful inventory read is pruned. A succeeded read missing a name from the project's own declared domain
 * list opens a `pagination-incomplete` gap rather than being reported complete.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param stored the `pages-project` kind file as it stood before this run
 * @param at this run's ISO timestamp
 * @returns the file to publish and this run's outcome, or why the reconciliation itself failed
 */
export async function syncPagesProjectKind({
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
  const scope = flatKindScope({ accountId, kind: "pages-project" });
  const inventory = await readCloudflarePagesProjectInventory({ accountId, client });
  if (inventory.isErr()) {
    return ok(foldFailedKindRead({ at, error: inventory.error, kind: "pages-project", scope, stored }));
  }
  const projectNameById = new Map(inventory.value.map((project) => [project.id, project.name]));

  const { attempts, reconciliation } = await fanOutAndReconcile<
    CloudflareRawPagesProject,
    CloudflarePagesRawChildItem,
    CloudflarePagesChildItem
  >({
    accountId,
    at,
    buildEntity: ({ accountId: entityAccountId, at: entityAt, children, parent }) =>
      projectCloudflarePagesProject({ accountId: entityAccountId, at: entityAt, children, raw: parent }),
    extractStoredChildren: (entity) =>
      isCloudflarePagesProjectDetail(entity.detail) ? extractCloudflarePagesChildren({ detail: entity.detail }) : null,
    normalizeChild: ({ raw }) => normalizeCloudflarePagesChildItem({ raw }),
    parents: inventory.value,
    readChild: ({ parentId }) => readPagesProjectChildrenById({ accountId, client, parentId, projectNameById }),
    stored: stored.entities,
  });

  const { complete, reasons } = pagesProjectCompleteness({ reconciliation });
  const cell = buildFanoutCoverageCell({
    at,
    complete,
    reasons,
    scope,
    stored,
    successReason: `reconciled ${String(reconciliation.entities.length)} Pages project(s)`,
  });

  return foldFanoutResult({
    at,
    cell,
    complete,
    entities: reconciliation.entities,
    gapInputs: pagesProjectGapInputs({ accountId, at, attempts, entities: reconciliation.entities }),
    kind: "pages-project",
    kindScopeRead: "succeeded",
    reasons,
    scope,
    stored,
  });
}
