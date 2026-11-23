/**
 * `account-certificate` — account mTLS certificates, each with its own service associations embedded.
 *
 * The same parent-fanout shape `account-filter-list` uses. The children are service associations
 * (`{service, status}` pairs) — the plan called these "hostname associations", which the real SDK shape does
 * not return; see `projection/accountCertificate.ts`'s header for the correction, and for why the
 * certificate's own PEM body is deliberately not stored.
 *
 * The fan-out is its own function purely because three generic parameters plus eight callbacks do not fit
 * inside the function that also builds a coverage cell and a fold result, under this repo's function-size cap.
 */
import type Cloudflare from "cloudflare";

import { ok, type Result } from "../../lib/result.js";

import {
  buildFanoutCoverageCell,
  flatKindScope,
  foldFailedKindRead,
  foldFanoutResult,
  type KindFoldResult,
} from "./kindFold.js";
import type { CloudflareEntity, CloudflareKindFile } from "./model.js";
import { basicParentFanoutGapInputs, fanOutAndReconcile } from "./parentFanoutFold.js";
import {
  type CloudflareAccountCertificateAssociation,
  type CloudflareRawAccountCertificate,
  type CloudflareRawAccountCertificateAssociation,
  isCloudflareAccountCertificateDetail,
  normalizeCloudflareAccountCertificateAssociation,
  projectCloudflareAccountCertificate,
} from "./projection/accountCertificate.js";
import {
  readCloudflareAccountCertificateAssociations,
  readCloudflareAccountCertificateInventory,
} from "./readers/accountCertificate.js";

/** Fan one association read out per certificate and reconcile the result against what is already stored. */
async function fanOutAccountCertificates({
  client,
  accountId,
  at,
  stored,
  parents,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
  stored: readonly CloudflareEntity[];
  parents: readonly CloudflareRawAccountCertificate[];
}): ReturnType<
  typeof fanOutAndReconcile<
    CloudflareRawAccountCertificate,
    CloudflareRawAccountCertificateAssociation,
    CloudflareAccountCertificateAssociation
  >
> {
  return fanOutAndReconcile<
    CloudflareRawAccountCertificate,
    CloudflareRawAccountCertificateAssociation,
    CloudflareAccountCertificateAssociation
  >({
    accountId,
    at,
    buildEntity: ({ accountId: entityAccountId, at: entityAt, children, parent }) =>
      projectCloudflareAccountCertificate({
        accountId: entityAccountId,
        associations: children,
        at: entityAt,
        raw: parent,
      }),
    extractStoredChildren: (entity) =>
      isCloudflareAccountCertificateDetail(entity.detail) ? entity.detail.associations : null,
    normalizeChild: ({ raw }) => normalizeCloudflareAccountCertificateAssociation({ raw }),
    parents,
    readChild: ({ parentId }) =>
      readCloudflareAccountCertificateAssociations({ accountId, certificateId: parentId, client }),
    stored,
  });
}

/**
 * Read, fan out and fold this run's account mTLS certificate attempt into its stored kind file. A failed
 * certificate's association read preserves only that certificate's own associations; a certificate absent
 * from a successful inventory read is pruned.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param stored the `account-certificate` kind file as it stood before this run
 * @param at this run's ISO timestamp
 * @returns the file to publish and this run's outcome, or why the reconciliation itself failed
 */
export async function syncAccountCertificateKind({
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
  const scope = flatKindScope({ accountId, kind: "account-certificate" });
  const inventory = await readCloudflareAccountCertificateInventory({ accountId, client });
  if (inventory.isErr()) {
    return ok(foldFailedKindRead({ at, error: inventory.error, kind: "account-certificate", scope, stored }));
  }

  const { attempts, reconciliation } = await fanOutAccountCertificates({
    accountId,
    at,
    client,
    parents: inventory.value,
    stored: stored.entities,
  });

  const cell = buildFanoutCoverageCell({
    at,
    complete: reconciliation.complete,
    reasons: reconciliation.reasons,
    scope,
    stored,
    successReason: `reconciled ${String(reconciliation.entities.length)} certificate(s)`,
  });

  return foldFanoutResult({
    at,
    cell,
    complete: reconciliation.complete,
    entities: reconciliation.entities,
    gapInputs: basicParentFanoutGapInputs({ accountId, at, attempts, kind: "account-certificate" }),
    kind: "account-certificate",
    kindScopeRead: "succeeded",
    reasons: reconciliation.reasons,
    scope,
    stored,
  });
}
