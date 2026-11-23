/**
 * The Vendors tag's endpoint contracts: one strict boundary per endpoint that answers JSON, declared once at
 * load and read by `vendors.ts`'s operations. Kept apart from the request plumbing so a schema drift is fixed
 * in one small file that names every route it covers.
 */
import { defineBoundary } from "#lib/boundary.js";
import {
  vantaSecurityReviewDtoSchema,
  vantaSecurityReviewsPageSchema,
  vantaVendorAssessmentDtoSchema,
  vantaVendorAssessmentsPageSchema,
  vantaVendorDocumentDtoSchema,
  vantaVendorDocumentsPageSchema,
  vantaVendorDtoSchema,
  vantaVendorFindingDtoSchema,
  vantaVendorFindingsPageSchema,
} from "../schemas/vendors.js";

/**
 * One strict boundary per Vendors endpoint that answers JSON, named by its method and path template. A field
 * Vanta adds, drops or renames refuses that read by name; the fix is this map's schema, never a looser read.
 * Two endpoints sharing a schema still get a boundary each, because the endpoint leads every refusal.
 *
 * @internal — exported so a test can lock the endpoint each operation names.
 */
export const VANTA_VENDORS_OPERATION_BOUNDARIES = {
  createFindingForVendor: defineBoundary({
    endpoint: "POST /v1/vendors/{vendorId}/findings",
    schema: vantaVendorFindingDtoSchema,
  }),
  createVendor: defineBoundary({ endpoint: "POST /v1/vendors", schema: vantaVendorDtoSchema }),
  getAssessmentForVendor: defineBoundary({
    endpoint: "GET /v1/vendors/{vendorId}/assessments/{assessmentId}",
    schema: vantaVendorAssessmentDtoSchema,
  }),
  getSecurityReviewForVendor: defineBoundary({
    endpoint: "GET /v1/vendors/{vendorId}/security-reviews/{securityReviewId}",
    schema: vantaSecurityReviewDtoSchema,
  }),
  getVendor: defineBoundary({ endpoint: "GET /v1/vendors/{vendorId}", schema: vantaVendorDtoSchema }),
  listAssessmentsForVendor: defineBoundary({
    endpoint: "GET /v1/vendors/{vendorId}/assessments",
    schema: vantaVendorAssessmentsPageSchema,
  }),
  listDocumentsForSecurityReview: defineBoundary({
    endpoint: "GET /v1/vendors/{vendorId}/security-reviews/{securityReviewId}/documents",
    schema: vantaVendorDocumentsPageSchema,
  }),
  listDocumentsForVendor: defineBoundary({
    endpoint: "GET /v1/vendors/{vendorId}/documents",
    schema: vantaVendorDocumentsPageSchema,
  }),
  listFindingsForVendor: defineBoundary({
    endpoint: "GET /v1/vendors/{vendorId}/findings",
    schema: vantaVendorFindingsPageSchema,
  }),
  listSecurityReviewsForVendor: defineBoundary({
    endpoint: "GET /v1/vendors/{vendorId}/security-reviews",
    schema: vantaSecurityReviewsPageSchema,
  }),
  setStatusForVendor: defineBoundary({
    endpoint: "POST /v1/vendors/{vendorId}/set-status",
    schema: vantaVendorDtoSchema,
  }),
  updateFindingForVendor: defineBoundary({
    endpoint: "PATCH /v1/vendors/{vendorId}/findings/{findingId}",
    schema: vantaVendorFindingDtoSchema,
  }),
  updateVendor: defineBoundary({ endpoint: "PATCH /v1/vendors/{vendorId}", schema: vantaVendorDtoSchema }),
  uploadDocumentForSecurityReview: defineBoundary({
    endpoint: "POST /v1/vendors/{vendorId}/security-reviews/{securityReviewId}/documents",
    schema: vantaVendorDocumentDtoSchema,
  }),
  uploadDocumentForVendor: defineBoundary({
    endpoint: "POST /v1/vendors/{vendorId}/documents",
    schema: vantaVendorDocumentDtoSchema,
  }),
} as const;
