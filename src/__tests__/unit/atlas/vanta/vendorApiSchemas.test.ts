import { describe, expect, it } from "vitest";

import { vantaPageEnvelopeSchema } from "../../../../atlas/vanta/apiSchemas.js";
import {
  vantaDiscoveredVendorDtoSchema,
  vantaVendorAssessmentTypeDtoSchema,
  vantaVendorRiskAttributeDtoSchema,
} from "../../../../atlas/vanta/vendorApiSchemas.js";

/**
 * A vendor risk attribute shaped as Vanta's pinned document declares `VendorRiskAttribute`, `riskSection`
 * included — the key whose arrival on every live row made `vendor-risk-attributes-list` fail closed. Every
 * id is synthetic.
 */
const attributeJson = {
  description: "the vendor stores customer data",
  enabled: true,
  id: "attr-1",
  name: "Stores customer data",
  riskLevel: "HIGH",
  riskSection: { id: "section-1", name: "Data handling" },
  vendorCategories: ["Infrastructure"],
  vendorCategoryIds: ["category-1"],
};

const pageInfo = { endCursor: null, hasNextPage: false, hasPreviousPage: false, startCursor: null };

describe("vantaVendorRiskAttributeDtoSchema", () => {
  it("accepts a row carrying riskSection and keeps it exactly as returned", () => {
    const parsed = vantaVendorRiskAttributeDtoSchema.parse(attributeJson);
    expect(parsed.riskSection).toEqual({ id: "section-1", name: "Data handling" });
  });

  it("refuses a row without riskSection, which the document marks required", () => {
    const { riskSection: _omitted, ...withoutSection } = attributeJson;
    const parsed = vantaVendorRiskAttributeDtoSchema.safeParse(withoutSection);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.path).toEqual(["riskSection"]);
  });

  it("refuses an unknown key inside riskSection, at that path", () => {
    const parsed = vantaVendorRiskAttributeDtoSchema.safeParse({
      ...attributeJson,
      riskSection: { ...attributeJson.riskSection, weight: 2 },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.code).toBe("unrecognized_keys");
    expect(parsed.error!.issues[0]!.path).toEqual(["riskSection"]);
  });

  it("accepts a row carrying vendorCategoryIds and keeps the ids exactly as returned", () => {
    const parsed = vantaVendorRiskAttributeDtoSchema.parse(attributeJson);
    expect(parsed.vendorCategoryIds).toEqual(["category-1"]);
  });

  it("refuses a row without vendorCategoryIds, which the document marks required", () => {
    const { vendorCategoryIds: _omitted, ...withoutIds } = attributeJson;
    const parsed = vantaVendorRiskAttributeDtoSchema.safeParse(withoutIds);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.path).toEqual(["vendorCategoryIds"]);
  });

  it("still refuses an unknown key on the row, naming it — the shape that broke the sync", () => {
    const parsed = vantaVendorRiskAttributeDtoSchema.safeParse({ ...attributeJson, somethingNew: 1 });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toBe(`Unrecognized key: "somethingNew"`);
  });
});

/** A discovered vendor as the pinned `DiscoveredVendor` declares it, nobody having ignored or rejected it. */
const discoveredJson = {
  category: { name: "drift-category" },
  discoveredDate: "2026-10-01T00:00:00.000Z",
  id: "discovered-1",
  ignored: null,
  name: "Drift Vendor",
  normalizedName: "drift vendor",
  numberOfAccounts: 3,
  rejected: null,
  source: "GSUITE",
} as const;

const IGNORED = {
  ignoredAtDate: "2026-10-02T00:00:00.000Z",
  ignoredByUserId: "ignoring-user-1",
  ignoredReason: null,
} as const;

const REJECTED = {
  rejectedAtDate: null,
  rejectedByUserId: "rejecting-user-1",
  rejectedReason: "not a vendor we pay",
} as const;

describe("vantaDiscoveredVendorDtoSchema and the ignore/reject records", () => {
  it("reads a vendor nobody has ignored or rejected — the only shape live rows have carried", () => {
    expect(vantaDiscoveredVendorDtoSchema.parse(discoveredJson)).toStrictEqual(discoveredJson);
  });

  it("reads who ignored a vendor, when and why, whole — an object in the document, never a flag", () => {
    const row = { ...discoveredJson, ignored: IGNORED };
    expect(vantaDiscoveredVendorDtoSchema.parse(row)).toStrictEqual(row);
  });

  it("reads who rejected a vendor, when and why, whole", () => {
    const row = { ...discoveredJson, rejected: REJECTED };
    expect(vantaDiscoveredVendorDtoSchema.parse(row)).toStrictEqual(row);
  });

  it("refuses the boolean it used to read, at each field's own path", () => {
    const parsed = vantaDiscoveredVendorDtoSchema.safeParse({ ...discoveredJson, ignored: true, rejected: false });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.path)).toEqual([["ignored"], ["rejected"]]);
  });

  it("requires every key of the ignore record, nullable or not", () => {
    const { ignoredReason: _omitted, ...withoutReason } = IGNORED;
    const parsed = vantaDiscoveredVendorDtoSchema.safeParse({ ...discoveredJson, ignored: withoutReason });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.path).toEqual(["ignored", "ignoredReason"]);
  });

  it("refuses an unknown key inside the reject record, at that path", () => {
    const parsed = vantaDiscoveredVendorDtoSchema.safeParse({ ...discoveredJson, rejected: { ...REJECTED, by: "x" } });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.code).toBe("unrecognized_keys");
    expect(parsed.error!.issues[0]!.path).toEqual(["rejected"]);
  });
});

describe("vantaVendorAssessmentTypeDtoSchema", () => {
  const typeJson = { description: null, id: "assessment-type-1", name: "Annual review", status: "ACTIVE" } as const;

  it("reads an assessment type with no description, which the document declares nullable", () => {
    expect(vantaVendorAssessmentTypeDtoSchema.parse(typeJson)).toStrictEqual(typeJson);
  });

  it("still refuses one that omits description, which the document marks required", () => {
    const { description: _omitted, ...withoutDescription } = typeJson;
    const parsed = vantaVendorAssessmentTypeDtoSchema.safeParse(withoutDescription);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.path).toEqual(["description"]);
  });

  it("reads the audience Vanta started sending, exactly as returned — the key that exited the sync 1", () => {
    const row = { ...typeJson, audience: "EXTERNAL" };
    expect(vantaVendorAssessmentTypeDtoSchema.parse(row)).toStrictEqual(row);
  });

  it("refuses an audience that is not a string, at that path", () => {
    const parsed = vantaVendorAssessmentTypeDtoSchema.safeParse({ ...typeJson, audience: 1 });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.path).toEqual(["audience"]);
  });

  it("still refuses an unknown key on the row, naming it", () => {
    const parsed = vantaVendorAssessmentTypeDtoSchema.safeParse({ ...typeJson, audienceLabel: "External" });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toBe(`Unrecognized key: "audienceLabel"`);
  });
});

describe("the vendor-risk-attributes page", () => {
  const pageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaVendorRiskAttributeDtoSchema });

  it("parses a whole page whose every row carries riskSection", () => {
    const page = { results: { data: [attributeJson, { ...attributeJson, id: "attr-2" }], pageInfo } };
    const parsed = pageSchema.parse(page);
    expect(parsed.results.data.map((row) => row.id)).toEqual(["attr-1", "attr-2"]);
  });
});
