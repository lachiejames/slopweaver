/**
 * The canonical vendor schema the Vendors tag module re-exports: it is the same object, it requires all
 * twenty-seven fields, and it reads a strict and a lax vendor whole with any one nullable field null.
 */
import { describe, expect, it } from "vitest";

import { vantaVendorDtoSchema as canonicalVendorSchema } from "../../../../../../../atlas/vanta/apiSchemas.js";
import { vantaVendorDtoSchema } from "../../../../../../../atlas/vanta/sdk/schemas/vendors.js";
import { pathsWhenFieldMissing, rowsWithOneNestedNull, rowsWithOneNull } from "./probes.js";

// --- the canonical vendor ------------------------------------------------------------------------------

const VENDOR_STRICT_AUTH = {
  accountManagerEmail: "vendor.strict.manager@example.test",
  accountManagerName: "Vendor Strict Manager",
  additionalNotes: "Vendor strict additional notes",
  authDetails: {
    method: "OKTA",
    passwordMFA: true,
    passwordMinimumLength: 14,
    passwordRequiresNumber: false,
    passwordRequiresSymbol: true,
  },
  businessOwnerUserId: "vendor-strict-business-owner-id",
  category: { displayName: "Vendor strict category" },
  contractAmount: { amount: 4800.5, currency: "AUD" },
  contractRenewalDate: "2131-01-31T10:10:10.010Z",
  contractStartDate: "2132-02-28T11:11:11.011Z",
  contractTerminationDate: "2133-03-29T12:12:12.012Z",
  customFields: [
    { label: "vendor-strict-field-label", value: ["vendor-strict-field-first", "vendor-strict-field-second"] },
  ],
  id: "vendor-strict-id",
  inherentRiskLevel: "HIGH",
  isRiskAutoScored: true,
  isVisibleToAuditors: false,
  lastSecurityReviewCompletionDate: "2134-04-30T13:13:13.013Z",
  latestDecision: { lastUpdatedAt: "2135-05-27T14:14:14.014Z", status: "NOT_APPROVED" },
  linkedTaskTrackerTaskProcurementRequest: {
    service: "vendor-strict-tracker",
    url: "https://tracker.example.test/strict",
  },
  name: "Vendor strict name",
  nextSecurityReviewDueDate: "2136-06-26T15:15:15.015Z",
  residualRiskLevel: "LOW",
  riskAttributeIds: ["vendor-strict-attribute-a", "vendor-strict-attribute-b"],
  securityOwnerUserId: "vendor-strict-security-owner-id",
  servicesProvided: "Vendor strict services provided",
  status: "MANAGED",
  vendorHeadquarters: "AUS",
  websiteUrl: "https://vendor-strict.example.test",
} as const;

/* Across the strict vendor above and this one, the five nullable flags each take a different sequence of values:
   risk auto-scored true then false, auditor visibility false then true, multi-factor true then null, the number
   requirement false then null, the symbol requirement true then true. */
const VENDOR_LAX_AUTH = {
  accountManagerEmail: null,
  accountManagerName: null,
  additionalNotes: null,
  authDetails: {
    method: null,
    passwordMFA: null,
    passwordMinimumLength: null,
    passwordRequiresNumber: null,
    passwordRequiresSymbol: true,
  },
  businessOwnerUserId: null,
  category: null,
  contractAmount: null,
  contractRenewalDate: null,
  contractStartDate: null,
  contractTerminationDate: null,
  customFields: null,
  id: "vendor-lax-id",
  inherentRiskLevel: "MEDIUM",
  isRiskAutoScored: false,
  isVisibleToAuditors: true,
  lastSecurityReviewCompletionDate: null,
  latestDecision: null,
  linkedTaskTrackerTaskProcurementRequest: null,
  name: "Vendor lax name",
  nextSecurityReviewDueDate: null,
  residualRiskLevel: "CRITICAL",
  riskAttributeIds: [],
  securityOwnerUserId: null,
  servicesProvided: null,
  status: "IN_PROCUREMENT",
  vendorHeadquarters: null,
  websiteUrl: null,
} as const;

describe("the canonical vendor schema this module re-exports", () => {
  it("is the schema itself, not a copy", () => {
    expect(vantaVendorDtoSchema).toBe(canonicalVendorSchema);
  });

  it("requires every one of a vendor's twenty-seven fields, each missing one refusing at its own path", () => {
    expect(Object.keys(VENDOR_STRICT_AUTH).length).toBe(27);
    expect(pathsWhenFieldMissing({ row: VENDOR_STRICT_AUTH, schema: vantaVendorDtoSchema })).toStrictEqual(
      Object.keys(VENDOR_STRICT_AUTH).map((field) => [[field]]),
    );
  });

  it("reads a vendor whose password multi-factor and symbol flags are set and whose number flag is not, whole", () => {
    expect(vantaVendorDtoSchema.parse(VENDOR_STRICT_AUTH)).toStrictEqual(VENDOR_STRICT_AUTH);
  });

  it("reads a vendor with the inverse top-level flags, two password flags unset and every other nullable field null, whole", () => {
    expect(vantaVendorDtoSchema.parse(VENDOR_LAX_AUTH)).toStrictEqual(VENDOR_LAX_AUTH);
  });

  it("reads a vendor with exactly one of its twenty top-level nullable fields null at a time, each whole", () => {
    const rows = rowsWithOneNull({
      keys: [
        "accountManagerEmail",
        "accountManagerName",
        "additionalNotes",
        "businessOwnerUserId",
        "category",
        "contractAmount",
        "contractRenewalDate",
        "contractStartDate",
        "contractTerminationDate",
        "customFields",
        "isRiskAutoScored",
        "isVisibleToAuditors",
        "lastSecurityReviewCompletionDate",
        "latestDecision",
        "linkedTaskTrackerTaskProcurementRequest",
        "nextSecurityReviewDueDate",
        "securityOwnerUserId",
        "servicesProvided",
        "vendorHeadquarters",
        "websiteUrl",
      ],
      row: VENDOR_STRICT_AUTH,
    });
    expect(rows.length).toBe(20);
    expect(rows.map((row) => vantaVendorDtoSchema.parse(row))).toStrictEqual(rows);
  });

  it("reads a vendor with exactly one of its five auth fields null at a time, each whole", () => {
    const rows = rowsWithOneNestedNull({
      key: "authDetails",
      keys: ["method", "passwordMFA", "passwordMinimumLength", "passwordRequiresNumber", "passwordRequiresSymbol"],
      nested: VENDOR_STRICT_AUTH.authDetails,
      row: VENDOR_STRICT_AUTH,
    });
    expect(rows.length).toBe(5);
    expect(rows.map((row) => vantaVendorDtoSchema.parse(row))).toStrictEqual(rows);
  });
});
