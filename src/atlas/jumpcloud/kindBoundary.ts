/**
 * The two answers a failed JumpCloud kind can carry that are about the ORGANISATION rather than a broken
 * read: this administrator may not read the family (`kit/permissionBlock.ts`), or this organisation has no
 * such product (`kit/productAbsence.ts`). Each is stamped on the kind's manifest status, and each exempts
 * the kind from `kit/mandatoryKinds.ts` — so each has to be classified from typed failures alone, with every
 * failure on the kind that one answer, never from prose.
 */
import type { JumpcloudKindWalk } from "./syncEngine.js";

/**
 * Whether this kind failed ONLY because JumpCloud answered that this organisation has no such product.
 *
 * Every failure has to be a 404 (`ROUTE_ABSENT`) and the walk must have read nothing at all. A kind that 404s
 * on one record among entities it did read is a record gone, not a product absent — and a 404 beside any
 * other failure is an absence AND a broken read, which must stay a gap a later run can clear. Owner ruling:
 * a product the organisation does not have is excluded and named, never a publish block —
 * `kit/productAbsence.ts`.
 *
 * @param succeeded whether the read finished, in which case there is no absence to report
 * @param walk what the walk accumulated, whose typed failures carry the provider's own answer
 * @returns the provider's answer, operation by operation, or `null` when this is not purely an absence
 */
export function productAbsence({ succeeded, walk }: { succeeded: boolean; walk: JumpcloudKindWalk }): string | null {
  if (succeeded || walk.failures.length === 0 || walk.entities.length > 0) {
    return null;
  }
  if (!walk.failures.every((failure) => failure.error.code === "ROUTE_ABSENT")) {
    return null;
  }
  return walk.failures.map((failure) => `${failure.surface}: ${failure.error.message}`).join("; ");
}

/**
 * Whether this kind failed ONLY because this administrator may not read it, and what would lift that.
 *
 * Every failure has to be a 403 for this to answer. A kind that hit a permission boundary on one operation
 * and a transport error on another is not a boundary — it is a boundary AND a broken read, and stamping it
 * as the first would exempt it from `kit/mandatoryKinds.ts` on the strength of a failure that a later run
 * could clear. Owner ruling: what the atlas owes is every surface the owner's permissions allow, and
 * whether a gap is permissions or a defect must never be a guess.
 *
 * @param succeeded whether the read finished, in which case there is no boundary to report
 * @param walk what the walk accumulated, whose typed failures carry the provider's own refusal
 * @returns the boundary's detail and remedy, or `null` when this is not purely a permission boundary
 */
export function permissionBoundary({ succeeded, walk }: { succeeded: boolean; walk: JumpcloudKindWalk }): {
  readonly detail: string;
  readonly unblockedBy: string;
} | null {
  if (succeeded || walk.failures.length === 0) {
    return null;
  }
  if (!walk.failures.every((failure) => failure.error.code === "PERMISSION_REFUSED")) {
    return null;
  }
  return {
    detail: walk.failures.map((failure) => `${failure.surface}: ${failure.error.message}`).join("; "),
    unblockedBy:
      "a JumpCloud administrator role permitted to read this family — one family refused while others" +
      " succeed is a permission boundary rather than a broken credential, and widening it is the owner's" +
      " decision",
  };
}

/**
 * The operations that answered they hold nothing for this organisation, when those are the ONLY failures on
 * a kind that otherwise read — or `null` when any failure is something a fix, a grant or a later run would
 * change.
 *
 * Three answers count, each the provider's own and none of them ours: a 404 on an operation (the tenancy has
 * no such route, product or record — owner ruling that a product we do not have is excluded
 * and said so), a 501 (the provider implements no such operation), and a 4xx on an operation that SERVED
 * other records in this same walk. That last one is per-record rather than a missing contract, and the
 * difference is measured rather than assumed: `v2-get-field-config-select-options` answered for some field
 * configurations and refused every other one with "This field configuration does not support select options".
 * A missing contract fails every binding, so an operation with no record at all never counts.
 *
 * A 403 does NOT count, deliberately: a permission boundary is reachable with a grant, and calling the kind
 * complete would hide exactly the distinction the owner ruled a reader must never have to guess at. A kind
 * that read nothing does not count either — that is a whole-kind absence or boundary, which
 * {@link productAbsence} and {@link permissionBoundary} already name.
 *
 * @param walk what the walk accumulated for this kind
 * @returns one `surface: message` line per answer, or `null` when the kind is not complete on answers alone
 */
export function providerAnswers({ walk }: { walk: JumpcloudKindWalk }): readonly string[] | null {
  if (walk.failures.length === 0 || walk.entities.length === 0) {
    return null;
  }
  const served = new Set(walk.entities.map((entity) => surfaceOf({ providerId: entity.providerId })));
  const answered = walk.failures.every(({ error, surface }) => {
    if (error.code === "ROUTE_ABSENT" || error.code === "NOT_IMPLEMENTED") {
      return true;
    }
    return error.code === "OPERATION_UNUSABLE" && served.has(surface);
  });
  if (!answered) {
    return null;
  }
  return walk.failures.map((failure) => `${failure.surface}: ${failure.error.message}`);
}

/**
 * The operation a stored entity came from — its identity is `<surface>#<id>` or `<surface>:<path>#<id>`.
 *
 * @param providerId the stored entity's provider id
 * @returns the operation's registry name
 */
function surfaceOf({ providerId }: { providerId: string }): string {
  const cut = providerId.search(/[:#]/);
  if (cut === -1) {
    return providerId;
  }
  return providerId.slice(0, cut);
}
