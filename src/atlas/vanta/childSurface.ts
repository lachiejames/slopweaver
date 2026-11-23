/**
 * What a Vanta child family and one of its surfaces ARE, and how a parent id fills a surface's path.
 *
 * `childCensus.ts` declares which families exist; this file is the shape every one of them is declared in,
 * so the runner, the projection and the client can read the contract without reading the whole table.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { VantaControlDto, VantaDocumentDto } from "./apiSchemas.js";
import type {
  VantaDiscoveredVendorAccountDto,
  VantaResourceKindDto,
  VantaRiskControlLinkDto,
} from "./childApiSchemas.js";
import type { VantaIntegrationResourceDto } from "./integrationResourceApiSchemas.js";
import type { VantaManageEndpoint } from "./inventory.js";
import type { VantaKind } from "./model.js";
import type { VantaPageBoundary } from "./pageBoundary.js";
import type { VantaPersonDto } from "./personApiSchemas.js";
import type { VantaUploadedLinkDto } from "./sdk/schemas/documents.js";
import type {
  VantaSecurityReviewDto,
  VantaVendorAssessmentDto,
  VantaVendorDocumentDto,
} from "./sdk/schemas/vendors.js";
import type { VantaUploadedFileDto } from "./writeApiSchemas.js";

/** Every DTO a child family can yield. */
export type VantaChildDto =
  | VantaControlDto
  | VantaDiscoveredVendorAccountDto
  | VantaDocumentDto
  | VantaIntegrationResourceDto
  | VantaSecurityReviewDto
  | VantaUploadedFileDto
  | VantaUploadedLinkDto
  | VantaPersonDto
  | VantaResourceKindDto
  | VantaRiskControlLinkDto
  | VantaVendorAssessmentDto
  | VantaVendorDocumentDto;

/**
 * Every kind the child table owns. Declared as a union rather than derived, so a kind added here without a
 * row below fails to compile rather than syncing nothing.
 */
export type VantaChildKind =
  | "control-document-link"
  | "discovered-vendor-account"
  | "document-link"
  | "document-upload"
  | "framework-control-link"
  | "group-member"
  | "integration-resource"
  | "integration-resource-kind"
  | "risk-control-link"
  | "vendor-assessment"
  | "vendor-document"
  | "vendor-security-review";

/**
 * What one child surface's rows are worth storing AS.
 *
 * `object` stores the row unchanged, the way a census family does. `pairing` stores only the parent-to-child
 * identity, because the row itself is a copy of something another kind already holds — see this file's
 * header for the measurement that decides which is which.
 * @internal
 */
export type VantaChildPayload = "object" | "pairing";

/** One surface of one child family: the path template, and the boundary its answer is read through. */
export interface VantaChildSurface {
  /** The coverage surface name this read reports under. Distinct across the whole atlas. */
  readonly surface: string;
  /** The published document's own path template, with `/v1` and the `{parent}` placeholder intact. */
  readonly specPath: string;
  /** The kind whose stored entities supply the value for the template's one parameter. */
  readonly parentKind: VantaKind;
  /** The endpoint's declared read, named by the method and this surface's own `specPath`. */
  readonly pageBoundary: VantaPageBoundary<VantaChildDto>;
  /** This row's own id within one parent, so an entity id can be `<parentId>:<childId>`. */
  readonly childId: (dto: VantaChildDto) => string;
  /**
   * An HTTP status this surface treats as ONE PARENT's own ceiling rather than as a failed read.
   *
   * Nearly always `null`, and the exception is what the field exists for. MEASURED:
   * `GET /v1/integrations/{integrationId}/resource-kinds` answers HTTP 200 for every other integration
   * and HTTP 422 for a Connectors-type one, with Vanta's own message — _"Accessing resource kinds
   * not supported for Connectors integrations"_. That is the provider naming a bound on one PARENT, not a
   * read this atlas got wrong, and treating it as a failed read cost every other parent's answer: the store's
   * never-acquired guard refused the whole generation rather than publish a kind that had no rows.
   *
   * Narrow on purpose. The status is declared per surface rather than tolerated globally, the parent that
   * hit it becomes a gap carrying the provider's own words, and the coverage cell says how many parents
   * answered out of how many were asked — so a ceiling that spread from one integration to many is
   * visible in the fraction rather than hidden behind a `synced`. Every other status still fails the kind.
   */
  readonly parentCeiling: { readonly status: number; readonly because: string } | null;
  /**
   * The field names of a row this surface's schema accepted only through a declared UNDECLARED-shape
   * fallback, or `null` for a row the document describes. Absent on every surface whose schema has no such
   * fallback; `integrationResourceApiSchemas.ts` carries the one measured reason a surface needs one.
   */
  readonly undeclaredShape?: (dto: VantaChildDto) => readonly string[] | null;
}

/** One family reached by fanning out over a parent, and what its answers are stored as. */
export interface VantaChildFamily {
  readonly kind: VantaChildKind;
  readonly description: string;
  readonly payload: VantaChildPayload;
  /** Every surface this kind reads. Two only for `control-document-link`, which Vanta serves both ways. */
  readonly surfaces: readonly VantaChildSurface[];
  /** Whether these rows need care before their content is quoted outbound — see `census.ts`. */
  readonly handleWithCare: boolean;
}

/**
 * Fill a child surface's `{parameters}` with a real parent id, as the one GET endpoint that parent's walk reads.
 *
 * One parameter takes the whole id. More than one takes the id's `:`-separated parts in order, because a
 * parent that is itself a fan-out kind is keyed `<grandparentId>:<childId>` by `childProjection.ts` —
 * `integration-resource-kind`'s `gcp:GCPRoleGrant` fills `{integrationId}` and `{resourceKind}`. A part
 * count that differs from the parameter count is refused rather than mis-filled.
 *
 * @param specPath the surface's own path template
 * @param parentId the parent entity's provider id
 * @returns the endpoint with its concrete path, ready for the transport, or why this id cannot fill this template
 */
export function vantaChildEndpoint({
  specPath,
  parentId,
}: {
  specPath: string;
  parentId: string;
}): Result<VantaManageEndpoint> {
  const parameters = specPath.match(/\{[^}]+\}/g);
  if (parameters === null) {
    return err([`${specPath} declares no path parameter for parent ${parentId} to fill`]);
  }
  const parts = parameters.length === 1 ? [parentId] : parentId.split(":");
  if (parts.length !== parameters.length) {
    return err([
      `parent id ${parentId} has ${String(parts.length)} ":"-separated part(s) and ${specPath} has ${String(parameters.length)} parameter(s)`,
    ]);
  }
  // One placeholder per part, leftmost first. An encoded part can never re-introduce a `{`, so a later
  // replacement cannot land inside an earlier part's value.
  const path = parts.reduce((filled, part) => filled.replace(/\{[^}]+\}/, encodeURIComponent(part)), specPath);
  return ok({ fixedQuery: {}, method: "GET", path });
}
