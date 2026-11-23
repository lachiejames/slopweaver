/**
 * Every strict boundary the hand-written Vanta SDK declares names the endpoint it reads, as `METHOD /v1/template`:
 * a GET one is checked against the pinned OpenAPI document's own GET registry, so a typo in a template fails here
 * rather than leading a refusal with a route Vanta does not have, and the whole set is locked so a dropped or
 * renamed operation is a visible diff.
 */
import { describe, expect, it } from "vitest";

import { VANTA_GET_ENDPOINTS } from "../../../../../../atlas/vanta/generated/getEndpoints.js";
import { VANTA_CONTROLS_OPERATION_BOUNDARIES } from "../../../../../../atlas/vanta/sdk/operations/controlsBoundaries.js";
import { VANTA_DOCUMENTS_OPERATION_BOUNDARIES } from "../../../../../../atlas/vanta/sdk/operations/documentsBoundaries.js";
import { VANTA_TESTS_OPERATION_BOUNDARIES } from "../../../../../../atlas/vanta/sdk/operations/testsBoundaries.js";
import { VANTA_VENDORS_OPERATION_BOUNDARIES } from "../../../../../../atlas/vanta/sdk/operations/vendorsBoundaries.js";
import { VANTA_WRITE_BOUNDARIES } from "../../../../../../atlas/vanta/writeClient.js";

/** Every SDK operation's endpoint, keyed `<map>.<operation>`. */
const ENDPOINTS: readonly (readonly [string, string])[] = Object.entries({
  controls: VANTA_CONTROLS_OPERATION_BOUNDARIES,
  documents: VANTA_DOCUMENTS_OPERATION_BOUNDARIES,
  tests: VANTA_TESTS_OPERATION_BOUNDARIES,
  vendors: VANTA_VENDORS_OPERATION_BOUNDARIES,
  write: VANTA_WRITE_BOUNDARIES,
}).flatMap(([map, boundaries]) =>
  Object.entries(boundaries).map(([operation, boundary]) => [`${map}.${operation}`, boundary.endpoint] as const),
);

describe("the Vanta SDK's per-endpoint boundaries", () => {
  it("names every GET endpoint as the pinned document's own route", () => {
    const published = new Set(VANTA_GET_ENDPOINTS.map((row) => `GET /v1${row.path}`));
    const gets = ENDPOINTS.filter(([, endpoint]) => endpoint.startsWith("GET "));
    expect(gets.length).toBe(17);
    expect(gets.filter(([, endpoint]) => !published.has(endpoint))).toEqual([]);
  });

  it("locks the whole set, one endpoint per operation", () => {
    expect(Object.fromEntries(ENDPOINTS)).toStrictEqual({
      "controls.addControlFromLibrary": "POST /v1/controls/add-from-library",
      "controls.addDocumentToControl": "POST /v1/controls/{controlId}/add-document-to-control",
      "controls.addTestToControl": "POST /v1/controls/{controlId}/add-test-to-control",
      "controls.createControl": "POST /v1/controls",
      "controls.getControl": "GET /v1/controls/{controlId}",
      "controls.listDocumentsForControl": "GET /v1/controls/{controlId}/documents",
      "controls.listLibraryControls": "GET /v1/controls/controls-library",
      "controls.setOwnerForControl": "POST /v1/controls/{controlId}/set-owner",
      "controls.updateControlMetadata": "PATCH /v1/controls/{controlId}",
      "documents.createLinkForDocument": "POST /v1/documents/{documentId}/links",
      "documents.getDocument": "GET /v1/documents/{documentId}",
      "documents.listControlsForDocument": "GET /v1/documents/{documentId}/controls",
      "documents.listFilesForDocument": "GET /v1/documents/{documentId}/uploads",
      "documents.listLinksForDocument": "GET /v1/documents/{documentId}/links",
      "documents.setOwnerForDocument": "POST /v1/documents/{documentId}/set-owner",
      "tests.getTest": "GET /v1/tests/{testId}",
      "tests.listTests": "GET /v1/tests",
      "vendors.createFindingForVendor": "POST /v1/vendors/{vendorId}/findings",
      "vendors.createVendor": "POST /v1/vendors",
      "vendors.getAssessmentForVendor": "GET /v1/vendors/{vendorId}/assessments/{assessmentId}",
      "vendors.getSecurityReviewForVendor": "GET /v1/vendors/{vendorId}/security-reviews/{securityReviewId}",
      "vendors.getVendor": "GET /v1/vendors/{vendorId}",
      "vendors.listAssessmentsForVendor": "GET /v1/vendors/{vendorId}/assessments",
      "vendors.listDocumentsForSecurityReview":
        "GET /v1/vendors/{vendorId}/security-reviews/{securityReviewId}/documents",
      "vendors.listDocumentsForVendor": "GET /v1/vendors/{vendorId}/documents",
      "vendors.listFindingsForVendor": "GET /v1/vendors/{vendorId}/findings",
      "vendors.listSecurityReviewsForVendor": "GET /v1/vendors/{vendorId}/security-reviews",
      "vendors.setStatusForVendor": "POST /v1/vendors/{vendorId}/set-status",
      "vendors.updateFindingForVendor": "PATCH /v1/vendors/{vendorId}/findings/{findingId}",
      "vendors.updateVendor": "PATCH /v1/vendors/{vendorId}",
      "vendors.uploadDocumentForSecurityReview":
        "POST /v1/vendors/{vendorId}/security-reviews/{securityReviewId}/documents",
      "vendors.uploadDocumentForVendor": "POST /v1/vendors/{vendorId}/documents",
      "write.createDocument": "POST /v1/documents",
      "write.uploadEvidence": "POST /v1/documents/{documentId}/uploads",
    });
  });
});
