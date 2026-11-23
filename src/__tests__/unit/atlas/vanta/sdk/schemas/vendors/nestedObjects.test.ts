/**
 * The nested objects the four vendor DTO kinds carry (an assessment's owner, decision and type, a review's decision,
 * a document's uploader, a finding's remediation): each nested field is required and refuses at its nested path.
 */
import { describe, expect, it } from "vitest";

import {
  vantaSecurityReviewDtoSchema,
  vantaVendorAssessmentDtoSchema,
  vantaVendorDocumentDtoSchema,
  vantaVendorFindingDtoSchema,
} from "../../../../../../../atlas/vanta/sdk/schemas/vendors.js";
import { ASSESSMENT_DECIDED, FINDING_OPEN, REVIEW_TEAM_OWNED, VENDOR_DOCUMENT_BY_USER } from "./fixtures.js";
import { pathsWhenNestedFieldMissing } from "./probes.js";

describe("the nested objects every vendor DTO kind carries", () => {
  it("requires each of an assessment's owner, decision and type fields, refusing at the nested path", () => {
    const nestedRows = [
      { key: "owner", nested: ASSESSMENT_DECIDED.owner },
      { key: "decision", nested: ASSESSMENT_DECIDED.decision },
      { key: "assessmentType", nested: ASSESSMENT_DECIDED.assessmentType },
    ];
    expect(
      nestedRows.map(({ key, nested }) =>
        pathsWhenNestedFieldMissing({ key, nested, row: ASSESSMENT_DECIDED, schema: vantaVendorAssessmentDtoSchema }),
      ),
    ).toStrictEqual([
      [[["owner", "displayName"]], [["owner", "email"]], [["owner", "id"]], [["owner", "type"]]],
      [[["decision", "comments"]], [["decision", "lastUpdatedAt"]], [["decision", "status"]]],
      [[["assessmentType", "description"]], [["assessmentType", "id"]], [["assessmentType", "name"]]],
    ]);
  });

  it("requires both of a review's decision fields, refusing at the nested path", () => {
    expect(
      pathsWhenNestedFieldMissing({
        key: "decision",
        nested: REVIEW_TEAM_OWNED.decision,
        row: REVIEW_TEAM_OWNED,
        schema: vantaSecurityReviewDtoSchema,
      }),
    ).toStrictEqual([[["decision", "lastUpdatedAt"]], [["decision", "status"]]]);
  });

  it("requires both of a vendor document uploader's fields, refusing at the nested path", () => {
    expect(
      pathsWhenNestedFieldMissing({
        key: "uploadedBy",
        nested: VENDOR_DOCUMENT_BY_USER.uploadedBy,
        row: VENDOR_DOCUMENT_BY_USER,
        schema: vantaVendorDocumentDtoSchema,
      }),
    ).toStrictEqual([[["uploadedBy", "id"]], [["uploadedBy", "type"]]]);
  });

  it("requires both of a finding's remediation fields, refusing at the nested path", () => {
    expect(
      pathsWhenNestedFieldMissing({
        key: "remediation",
        nested: FINDING_OPEN.remediation,
        row: FINDING_OPEN,
        schema: vantaVendorFindingDtoSchema,
      }),
    ).toStrictEqual([[["remediation", "requirementNotes"]], [["remediation", "state"]]]);
  });
});
