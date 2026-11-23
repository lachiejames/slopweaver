/**
 * Every Manage API collection this atlas reaches by FANNING OUT over a parent it already holds — declared
 * once as data, exactly as `census.ts` declares the single-request families.
 *
 * A census family is one request for a whole family. A child family is one request per parent ROW, so its
 * cost is the parent's cardinality and its completeness is bounded by the parent's. That difference is why
 * these are a separate table rather than more rows in `census.ts`: the runner has to walk a parent kind's
 * stored entities first, and a table whose rows meant two different things would be the special case
 * `census.ts`'s header warns against growing.
 *
 * ## Two shapes of row, and the difference is what gets STORED
 *
 * A `pairing` row's response carries an object this atlas already holds under another kind. MEASURED
 * against the pinned document: `/controls/{controlId}/documents` returns the `/documents` row shape
 * exactly, `/documents/{documentId}/controls` and `/frameworks/{frameworkId}/controls` return the
 * `/controls` row shape exactly, and `/groups/{groupId}/people` returns the `/people` row shape exactly.
 * The only thing those calls establish that this atlas did not already hold is which parent names which
 * child, so the PAIRING is stored and the object is left where it lives. Storing it twice would be the
 * duplication `covered-by-list` exists to prevent, applied to the very same objects.
 *
 * Five of the object rows' schemas come from `sdk/schemas/`, which already declared them from the same
 * published spec — see `childApiSchemas.ts`'s header on the duplication a review pass caught.
 *
 * An `object` row's response carries something no other kind holds — a vendor's assessments, a document's
 * uploads, an integration's resource kinds — and every attribute is stored unchanged, as a census row is.
 *
 * ## One parent that fails does not empty the kind
 *
 * The fan-out is `all-or-nothing per KIND`, which is `foldKindSync`'s existing contract rather than a new
 * one: a kind merges its entities only on a complete read. So a single parent whose child call fails leaves
 * the whole kind incomplete and its previous entities untouched, rather than publishing a partial set that
 * would read as "this vendor has no assessments".
 *
 * What a family and a surface ARE, and how a parent id fills a surface's path, is `childSurface.ts`; this
 * file is only which families exist.
 */
import { vantaControlsPageSchema, vantaDocumentsPageSchema, vantaPageEnvelopeSchema } from "./apiSchemas.js";
import {
  vantaDiscoveredVendorAccountDtoSchema,
  vantaResourceKindDtoSchema,
  vantaRiskControlLinkDtoSchema,
} from "./childApiSchemas.js";
import type { VantaChildDto, VantaChildFamily, VantaChildKind, VantaChildSurface } from "./childSurface.js";
import { vantaIntegrationResourceDtoSchema, vantaUndeclaredResourceFields } from "./integrationResourceApiSchemas.js";
import { vantaPagedBoundary, vantaUnpagedBoundary } from "./pageBoundary.js";
import { vantaPersonDtoSchema } from "./personApiSchemas.js";
import { vantaDocumentFilesPageSchema, vantaDocumentLinksPageSchema } from "./sdk/schemas/documents.js";
import {
  vantaSecurityReviewsPageSchema,
  vantaVendorAssessmentsPageSchema,
  vantaVendorDocumentsPageSchema,
} from "./sdk/schemas/vendors.js";

/** Read one named string field off a row without asserting the row's type — see `census.ts`'s twin. */
function stringField({ dto, field }: { dto: VantaChildDto; field: string }): string {
  const found = Object.entries(dto).find(([key]) => key === field)?.[1];
  return typeof found === "string" ? found : "";
}

/** The `id` every child row but the risk-control pairing keys on. */
function idOf(dto: VantaChildDto): string {
  return stringField({ dto, field: "id" });
}

/**
 * Every child family, keyed by the kind it produces.
 *
 * Entity counts are deliberately absent, exactly as in `census.ts`: `slopweaver atlas vanta coverage --json`
 * prints the current one per kind, and a number written here could only ever go stale.
 */
export const VANTA_CHILD_FAMILIES: Readonly<Record<VantaChildKind, VantaChildFamily>> = {
  "control-document-link": {
    kind: "control-document-link",
    description:
      "which controls each document evidences, read from BOTH directions Vanta serves it in — the two calls are separate operations in the published document and neither implies the other",
    handleWithCare: false,
    payload: "pairing",
    surfaces: [
      {
        childId: idOf,
        parentCeiling: null,
        pageBoundary: vantaPagedBoundary({
          endpoint: "GET /v1/controls/{controlId}/documents",
          pageSchema: vantaDocumentsPageSchema,
        }),
        parentKind: "control",
        specPath: "/v1/controls/{controlId}/documents",
        surface: "control-documents",
      },
      {
        childId: idOf,
        parentCeiling: null,
        pageBoundary: vantaPagedBoundary({
          endpoint: "GET /v1/documents/{documentId}/controls",
          pageSchema: vantaControlsPageSchema,
        }),
        parentKind: "evidence",
        specPath: "/v1/documents/{documentId}/controls",
        surface: "document-controls",
      },
    ],
  },
  "framework-control-link": {
    kind: "framework-control-link",
    description: "which controls each framework maps to",
    handleWithCare: false,
    payload: "pairing",
    surfaces: [
      {
        childId: idOf,
        parentCeiling: null,
        pageBoundary: vantaPagedBoundary({
          endpoint: "GET /v1/frameworks/{frameworkId}/controls",
          pageSchema: vantaControlsPageSchema,
        }),
        parentKind: "framework",
        specPath: "/v1/frameworks/{frameworkId}/controls",
        surface: "framework-controls",
      },
    ],
  },
  "risk-control-link": {
    kind: "risk-control-link",
    description:
      "which controls each risk scenario names, and whether each one already exists or is part of the treatment plan",
    handleWithCare: false,
    payload: "pairing",
    surfaces: [
      {
        childId: (dto) => stringField({ dto, field: "controlId" }),
        parentCeiling: null,
        pageBoundary: vantaPagedBoundary({
          endpoint: "GET /v1/risk-scenarios/{riskScenarioId}/controls",
          pageSchema: vantaPageEnvelopeSchema({ dataSchema: vantaRiskControlLinkDtoSchema }),
        }),
        parentKind: "risk",
        specPath: "/v1/risk-scenarios/{riskScenarioId}/controls",
        surface: "risk-scenario-controls",
      },
    ],
  },
  "group-member": {
    kind: "group-member",
    description: "which people belong to each personnel group",
    handleWithCare: true,
    payload: "pairing",
    surfaces: [
      {
        childId: idOf,
        parentCeiling: null,
        pageBoundary: vantaUnpagedBoundary({
          dataSchema: vantaPersonDtoSchema,
          endpoint: "GET /v1/groups/{groupId}/people",
          shape: "bare-array",
        }),
        parentKind: "group",
        specPath: "/v1/groups/{groupId}/people",
        surface: "group-people",
      },
    ],
  },
  "discovered-vendor-account": {
    kind: "discovered-vendor-account",
    description: "the accounts an integration attributes to each discovered vendor — a person's login, or a machine",
    handleWithCare: true,
    payload: "object",
    surfaces: [
      {
        childId: idOf,
        parentCeiling: null,
        pageBoundary: vantaPagedBoundary({
          endpoint: "GET /v1/discovered-vendors/{discoveredVendorId}/accounts",
          pageSchema: vantaPageEnvelopeSchema({ dataSchema: vantaDiscoveredVendorAccountDtoSchema }),
        }),
        parentKind: "discovered-vendor",
        specPath: "/v1/discovered-vendors/{discoveredVendorId}/accounts",
        surface: "discovered-vendor-accounts",
      },
    ],
  },
  "document-link": {
    kind: "document-link",
    description: "the external links attached to each document, standing in for a file Vanta does not hold",
    handleWithCare: false,
    payload: "object",
    surfaces: [
      {
        childId: idOf,
        parentCeiling: null,
        pageBoundary: vantaPagedBoundary({
          endpoint: "GET /v1/documents/{documentId}/links",
          pageSchema: vantaDocumentLinksPageSchema,
        }),
        parentKind: "evidence",
        specPath: "/v1/documents/{documentId}/links",
        surface: "document-links",
      },
    ],
  },
  "document-upload": {
    kind: "document-upload",
    description: "the files uploaded against each document — the evidence itself rather than the document record",
    handleWithCare: true,
    payload: "object",
    surfaces: [
      {
        childId: idOf,
        parentCeiling: null,
        pageBoundary: vantaPagedBoundary({
          endpoint: "GET /v1/documents/{documentId}/uploads",
          pageSchema: vantaDocumentFilesPageSchema,
        }),
        parentKind: "evidence",
        specPath: "/v1/documents/{documentId}/uploads",
        surface: "document-uploads",
      },
    ],
  },
  "integration-resource-kind": {
    kind: "integration-resource-kind",
    description: "the kinds of resource each connected integration exposes, and what Vanta may change about each",
    handleWithCare: false,
    payload: "object",
    surfaces: [
      {
        childId: (dto) => stringField({ dto, field: "resourceKind" }),
        parentCeiling: {
          because:
            'Vanta answers HTTP 422 with "Accessing resource kinds not supported for Connectors integrations" — a bound on the integration\'s own TYPE, measured on the Connectors-type integrations a sync asks',
          status: 422,
        },
        pageBoundary: vantaUnpagedBoundary({
          dataSchema: vantaResourceKindDtoSchema,
          endpoint: "GET /v1/integrations/{integrationId}/resource-kinds",
          shape: "bare-array",
        }),
        parentKind: "integration",
        specPath: "/v1/integrations/{integrationId}/resource-kinds",
        surface: "integration-resource-kinds",
      },
    ],
  },
  // Declared AFTER its parent on purpose: `sync.ts` walks this table in order, and this is the one family
  // whose parent is itself a fan-out kind, so the resource kinds must be read before their resources are.
  "integration-resource": {
    kind: "integration-resource",
    description:
      "every resource each integration exposes to Vanta — a cloud role, a repository, an account, a device — with its owner, description and audit scope",
    handleWithCare: true,
    payload: "object",
    surfaces: [
      {
        childId: (dto) => stringField({ dto, field: "resourceId" }),
        parentCeiling: null,
        pageBoundary: vantaPagedBoundary({
          endpoint: "GET /v1/integrations/{integrationId}/resource-kinds/{resourceKind}/resources",
          pageSchema: vantaPageEnvelopeSchema({ dataSchema: vantaIntegrationResourceDtoSchema }),
        }),
        parentKind: "integration-resource-kind",
        specPath: "/v1/integrations/{integrationId}/resource-kinds/{resourceKind}/resources",
        surface: "integration-resources",
        undeclaredShape: (dto) => vantaUndeclaredResourceFields({ row: dto }),
      },
    ],
  },
  "vendor-assessment": {
    kind: "vendor-assessment",
    description: "each vendor's assessments, with the decision that closed one and the dates it was judged against",
    handleWithCare: true,
    payload: "object",
    surfaces: [
      {
        childId: idOf,
        parentCeiling: null,
        pageBoundary: vantaPagedBoundary({
          endpoint: "GET /v1/vendors/{vendorId}/assessments",
          pageSchema: vantaVendorAssessmentsPageSchema,
        }),
        parentKind: "vendor",
        specPath: "/v1/vendors/{vendorId}/assessments",
        surface: "vendor-assessments",
      },
    ],
  },
  "vendor-document": {
    kind: "vendor-document",
    description: "the files each vendor supplied — a report, a signed agreement, a review attachment",
    handleWithCare: true,
    payload: "object",
    surfaces: [
      {
        childId: idOf,
        parentCeiling: null,
        pageBoundary: vantaPagedBoundary({
          endpoint: "GET /v1/vendors/{vendorId}/documents",
          pageSchema: vantaVendorDocumentsPageSchema,
        }),
        parentKind: "vendor",
        specPath: "/v1/vendors/{vendorId}/documents",
        surface: "vendor-documents",
      },
    ],
  },
  "vendor-security-review": {
    kind: "vendor-security-review",
    description: "each vendor's security reviews, with the decision notes a reviewer left",
    handleWithCare: true,
    payload: "object",
    surfaces: [
      {
        childId: idOf,
        parentCeiling: null,
        pageBoundary: vantaPagedBoundary({
          endpoint: "GET /v1/vendors/{vendorId}/security-reviews",
          pageSchema: vantaSecurityReviewsPageSchema,
        }),
        parentKind: "vendor",
        specPath: "/v1/vendors/{vendorId}/security-reviews",
        surface: "vendor-security-reviews",
      },
    ],
  },
};

/** Every child family as a list, in a stable order a walk can iterate. */
export const VANTA_CHILD_FAMILY_LIST: readonly VantaChildFamily[] = Object.values(VANTA_CHILD_FAMILIES);

/** Every child surface across every family, so the inventory and the numerator can both read one list. */
export const VANTA_CHILD_SURFACE_LIST: readonly VantaChildSurface[] = VANTA_CHILD_FAMILY_LIST.flatMap(
  (family) => family.surfaces,
);
