/**
 * Zod schemas for the Vanta Manage API: the cursor-page envelope, and one DTO per kind this atlas syncs.
 *
 * Built from Vanta's own published OpenAPI document
 * (`https://developer.vanta.com/reference/manage-vanta.json`). Every object schema is `.strict()`,
 * matching Vanta's own `additionalProperties: false`: an unrecognised field fails that page closed rather
 * than silently passing through.
 *
 * `CountryCode` is the one deliberate exception. Vanta's OpenAPI enumerates ~190 ISO-3166 alpha-3 codes
 * plus a handful of UK-nation pseudo-codes; embedding the full list buys nothing a shape check does not
 * already buy. It is checked as three uppercase letters instead.
 */
import { z } from "zod";

/** One page's pagination metadata. Cursor-based: continue only while `hasNextPage` is true. */
const vantaPageInfoSchema = z
  .object({
    endCursor: z.string().nullable(),
    hasNextPage: z.boolean(),
    hasPreviousPage: z.boolean(),
    startCursor: z.string().nullable(),
  })
  .strict();

export type VantaPageInfo = z.infer<typeof vantaPageInfoSchema>;

/**
 * The page envelope, generic over one kind's DTO. `totalCount` is the one documented extra field Vanta's
 * `results` object may carry beyond `data` and `pageInfo`.
 *
 * @param dataSchema the per-kind DTO schema
 * @returns the envelope schema for that kind
 */
export function vantaPageEnvelopeSchema<T extends z.ZodType>({
  dataSchema,
}: {
  dataSchema: T;
}): z.ZodType<{ results: { data: z.infer<T>[]; pageInfo: VantaPageInfo; totalCount?: number | undefined } }> {
  return z
    .object({
      results: z
        .object({
          data: z.array(dataSchema),
          pageInfo: vantaPageInfoSchema,
          totalCount: z.number().int().nonnegative().optional(),
        })
        .strict(),
    })
    .strict();
}

export const vantaOwnerSchema = z
  .object({ displayName: z.string(), emailAddress: z.string(), id: z.string() })
  .strict();

export const vantaCustomFieldSchema = z
  .object({ label: z.string(), value: z.union([z.string(), z.array(z.string())]) })
  .strict();
export type VantaCustomField = z.infer<typeof vantaCustomFieldSchema>;

// --- Control -------------------------------------------------------------------------------------------

const controlSourceSchema = z.enum(["Vanta", "Custom"]);

export const vantaControlDtoSchema = z
  .object({
    creationDate: z.string().nullable(),
    customFields: z.array(vantaCustomFieldSchema),
    description: z.string(),
    domains: z.array(z.string()),
    externalId: z.string().nullable(),
    id: z.string(),
    /** Optional and nullable in the pinned document; Vanta sends it on every control. */
    implementationDetails: z.string().nullable().optional(),
    modificationDate: z.string().nullable(),
    name: z.string(),
    owner: vantaOwnerSchema.nullable(),
    /**
     * Nullable and absent from `Control`'s `required` list in the pinned document. Every live row the sync
     * read carried the key, so requiring it was measured rather than declared.
     */
    role: z.string().nullable().optional(),
    source: controlSourceSchema,
  })
  .strict();

export type VantaControlDto = z.infer<typeof vantaControlDtoSchema>;

export const vantaControlsPageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaControlDtoSchema });

// --- Policy ---------------------------------------------------------------------------------------------

const policyStatusSchema = z.enum(["OK", "NEEDS_REMEDIATION"]);
const policyVersionStatusSchema = z.enum([
  "NOT_STARTED",
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "RENEW_SOON",
  "EXPIRED",
]);
const policyLocaleSchema = z.enum([
  "CS",
  "CY",
  "DA",
  "DE",
  "EN",
  "ES",
  "FI",
  "FR",
  "HU",
  "IS",
  "IT",
  "JA",
  "KO",
  "NL",
  "NO",
  "NOT_SPECIFIED",
  "PL",
  "PT",
  "ET",
  "RO",
  "AR",
  "SK",
  "SV",
  "TR",
  "ZH",
]);
const policyDocumentSchema = z
  .object({ language: policyLocaleSchema.nullable(), slugId: z.string(), url: z.string() })
  .strict();
const policyLatestVersionSchema = z.object({ status: policyVersionStatusSchema }).strict();
const policyLatestApprovedVersionSchema = z
  .object({ documents: z.array(policyDocumentSchema), versionId: z.string() })
  .strict();

const vantaPolicyDtoSchema = z
  .object({
    approvedAtDate: z.string().nullable(),
    description: z.string(),
    id: z.string(),
    latestApprovedVersion: policyLatestApprovedVersionSchema.nullable(),
    latestVersion: policyLatestVersionSchema,
    name: z.string(),
    status: policyStatusSchema,
  })
  .strict();

export type VantaPolicyDto = z.infer<typeof vantaPolicyDtoSchema>;

export const vantaPoliciesPageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaPolicyDtoSchema });

// --- Document (evidence) ---------------------------------------------------------------------------------

export const documentCategorySchema = z.enum([
  "Accounts access",
  "Account security",
  "Account setup",
  "Computers",
  "Custom",
  "Data storage",
  "Employees",
  "Infrastructure",
  "IT",
  "Logging",
  "Monitoring alerts",
  "People",
  "Policies",
  "Risk analysis",
  "Software development",
  "CSPM alert management",
  "Vendors",
  "Vulnerability management",
]);
export const documentStatusSchema = z.enum(["Needs document", "Needs update", "Not relevant", "OK"]);

/**
 * A framework's lifecycle status, as Vanta's published frameworks list declares it: `null` is a framework with
 * no lifecycle status, and a framework schema carries it `.optional()` because Vanta omits it when it has no
 * status information. This is the field a snooze or unsnooze moves.
 */
export const vantaFrameworkStatusSchema = z.enum(["ACTIVE", "DRAFT", "SNOOZED", "ARCHIVED", "NEW_UPGRADE"]).nullable();

/**
 * The fields Vanta's frameworks list gained after the pin in `generated/specLock.ts`, declared off the SERVED
 * document's `Framework` schema. Vanta sends them before the
 * pinned document moved, and every `.strict()` framework row refused them, so `atlas vanta sync` exited 1.
 * `activeVariants` is omitted for a framework without tiers. `isPurchased` is REQUIRED in that document and
 * optional here, so a row Vanta sends without it is still admitted; this schema parses live answers only. An unpurchased framework's progress counts are
 * -1, per the same document. Reproduce: read `components.schemas.Framework` in the document at
 * `VANTA_SPEC_PIN.url` (`yarn tsx tools/generateVantaEndpoints.ts --verify --fetch` names the pin drift).
 */
export const vantaFrameworkProgramFields = {
  activeVariants: z.array(z.object({ id: z.string(), label: z.string() }).strict()).optional(),
  isPurchased: z.boolean().optional(),
} as const;

export const vantaDocumentDtoSchema = z
  .object({
    category: documentCategorySchema,
    description: z.string(),
    id: z.string(),
    isSensitive: z.boolean(),
    ownerId: z.string().nullable(),
    title: z.string(),
    uploadStatus: documentStatusSchema,
    uploadStatusDate: z.string().nullable(),
    url: z.string().nullable(),
  })
  .strict();

export type VantaDocumentDto = z.infer<typeof vantaDocumentDtoSchema>;

export const vantaDocumentsPageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaDocumentDtoSchema });

// --- Vendor -----------------------------------------------------------------------------------------------

const vendorAuthMethodSchema = z.enum([
  "AUTH_0",
  "AZURE_AD",
  "GOOGLE_WORKSPACE",
  "O_AUTH",
  "O365",
  "OKTA",
  "ONE_LOGIN",
  "OWA",
  "SSO",
  "USERNAME_PASSWORD",
  "OTHER",
]);
export type VantaVendorAuthMethod = z.infer<typeof vendorAuthMethodSchema>;

const vendorStatusSchema = z.enum(["MANAGED", "ARCHIVED", "IN_PROCUREMENT"]);
export type VantaVendorStatus = z.infer<typeof vendorStatusSchema>;

const vendorRiskLevelSchema = z.enum(["CRITICAL", "HIGH", "LOW", "MEDIUM", "UNSCORED"]);
export type VantaVendorRiskLevel = z.infer<typeof vendorRiskLevelSchema>;

const vendorDecisionStatusSchema = z.enum(["APPROVED", "CONDITIONALLY_APPROVED", "NOT_APPROVED"]);
const currencyCodeSchema = z.enum([
  "ARS",
  "AUD",
  "BRL",
  "CAD",
  "COP",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "ILS",
  "INR",
  "JPY",
  "MXN",
  "NOK",
  "NZD",
  "PHP",
  "PKR",
  "PLN",
  "RSD",
  "SEK",
  "SGD",
  "UAH",
  "USD",
  "ZAR",
]);
/** Shape-checked rather than enumerated — see this file's header. */
const countryCodeSchema = z.string().regex(/^[A-Z]{3}$/);
export type VantaCountryCode = z.infer<typeof countryCodeSchema>;

const vendorContractAmountSchema = z.object({ amount: z.number(), currency: currencyCodeSchema }).strict();
export type VantaVendorContractAmount = z.infer<typeof vendorContractAmountSchema>;

const vendorDecisionSchema = z.object({ lastUpdatedAt: z.string(), status: vendorDecisionStatusSchema }).strict();
const vendorAuthDetailsSchema = z
  .object({
    method: vendorAuthMethodSchema.nullable(),
    passwordMFA: z.boolean().nullable(),
    passwordMinimumLength: z.number().nullable(),
    passwordRequiresNumber: z.boolean().nullable(),
    passwordRequiresSymbol: z.boolean().nullable(),
  })
  .strict();
const vendorCategorySchema = z.object({ displayName: z.string() }).strict();
const vendorProcurementLinkSchema = z.object({ service: z.string(), url: z.string() }).strict();

export const vantaVendorDtoSchema = z
  .object({
    accountManagerEmail: z.string().nullable(),
    accountManagerName: z.string().nullable(),
    additionalNotes: z.string().nullable(),
    authDetails: vendorAuthDetailsSchema,
    businessOwnerUserId: z.string().nullable(),
    category: vendorCategorySchema.nullable(),
    contractAmount: vendorContractAmountSchema.nullable(),
    contractRenewalDate: z.string().nullable(),
    contractStartDate: z.string().nullable(),
    contractTerminationDate: z.string().nullable(),
    customFields: z.array(vantaCustomFieldSchema).nullable(),
    id: z.string(),
    inherentRiskLevel: vendorRiskLevelSchema,
    isRiskAutoScored: z.boolean().nullable(),
    isVisibleToAuditors: z.boolean().nullable(),
    lastSecurityReviewCompletionDate: z.string().nullable(),
    latestDecision: vendorDecisionSchema.nullable(),
    linkedTaskTrackerTaskProcurementRequest: vendorProcurementLinkSchema.nullable(),
    name: z.string(),
    nextSecurityReviewDueDate: z.string().nullable(),
    residualRiskLevel: vendorRiskLevelSchema,
    riskAttributeIds: z.array(z.string()),
    securityOwnerUserId: z.string().nullable(),
    servicesProvided: z.string().nullable(),
    status: vendorStatusSchema,
    vendorHeadquarters: countryCodeSchema.nullable(),
    websiteUrl: z.string().nullable(),
  })
  .strict();

export type VantaVendorDto = z.infer<typeof vantaVendorDtoSchema>;

export const vantaVendorsPageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaVendorDtoSchema });
