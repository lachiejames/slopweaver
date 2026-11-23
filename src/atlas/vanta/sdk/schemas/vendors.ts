/**
 * Zod response schemas and request types for the Vendors tag, built from Vanta's own published OpenAPI
 * spec.
 *
 * `Vendor` is identical, field-for-field, to `apiSchemas.ts`'s `vantaVendorDtoSchema` — imported and
 * reused, never redeclared. `VendorAssessment`, `SecurityReview`, `VendorDocument` and `VendorFinding` are
 * DTOs with no prior schema anywhere in this package. `VendorDocument`'s nested uploader shape does reuse
 * `writeApiSchemas.ts`'s `vantaUploadedFileActorSchema`. The assessment/review "owner" shape
 * (`{id, type, displayName, email}`) is NOT the same contract as `apiSchemas.ts`'s `vantaOwnerSchema`
 * (`{id, displayName, emailAddress}` — different field name, missing `type`), so it gets its own schema.
 *
 * One real asymmetry to note: `category` is a string on `CreateVendorInput`/`UpdateVendorInput` but an
 * object (`{ displayName }`) on the response DTO — Vanta's own spec, not a client-side inconsistency.
 */
import { z } from "zod";

import {
  type VantaCountryCode,
  type VantaCustomField,
  type VantaVendorAuthMethod,
  type VantaVendorContractAmount,
  type VantaVendorDto,
  type VantaVendorRiskLevel,
  type VantaVendorStatus,
  vantaPageEnvelopeSchema,
  vantaVendorDtoSchema,
} from "../../apiSchemas.js";
import { vantaAssessmentAudienceField } from "../../vendorApiSchemas.js";
import { type VantaUploadFileInput, vantaUploadedFileActorSchema } from "../../writeApiSchemas.js";

// --- Shared assessment/review shapes -------------------------------------------------------------------

const assessmentStatusSchema = z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]);
type VantaAssessmentStatus = z.infer<typeof assessmentStatusSchema>;

const assessmentDecisionStatusSchema = z.enum(["APPROVED", "NOT_APPROVED", "CONDITIONALLY_APPROVED"]);

const assessmentTypeSchema = z
  .object({ description: z.string().nullable(), id: z.string(), name: z.string() })
  .strict();

/**
 * The owner of an assessment or security review — `{id, type, displayName, email}`. Deliberately not
 * `apiSchemas.ts`'s `vantaOwnerSchema`: a different field name for email and an extra `type` discriminant
 * make this a genuinely different contract, not the same one spelled differently.
 */
const assessmentOwnerSchema = z
  .object({
    displayName: z.string().nullable(),
    email: z.string().nullable(),
    id: z.string(),
    type: z.enum(["USER", "TEAM"]),
  })
  .strict();

// --- VendorAssessment -------------------------------------------------------------------------------------

export const vantaVendorAssessmentDtoSchema = z
  .object({
    ...vantaAssessmentAudienceField,
    assessmentType: assessmentTypeSchema,
    completedByUserId: z.string().nullable(),
    completionDate: z.string().nullable(),
    createdDate: z.string(),
    decision: z
      .object({ comments: z.string().nullable(), lastUpdatedAt: z.string(), status: assessmentDecisionStatusSchema })
      .strict()
      .nullable(),
    dueDate: z.string().nullable(),
    id: z.string(),
    overrideDueDate: z.string().nullable(),
    owner: assessmentOwnerSchema.nullable(),
    startDate: z.string().nullable(),
    status: assessmentStatusSchema,
    vendorId: z.string(),
  })
  .strict();
export type VantaVendorAssessmentDto = z.infer<typeof vantaVendorAssessmentDtoSchema>;

/** `GET /v1/vendors/{vendorId}/assessments` — response body. */
export const vantaVendorAssessmentsPageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaVendorAssessmentDtoSchema });
export type VantaVendorAssessmentsPage = z.infer<typeof vantaVendorAssessmentsPageSchema>;

// --- SecurityReview ----------------------------------------------------------------------------------------

export const vantaSecurityReviewDtoSchema = z
  .object({
    assessmentType: assessmentTypeSchema,
    comments: z.string().nullable(),
    completedByUserId: z.string().nullable(),
    completionDate: z.string().nullable(),
    decision: z.object({ lastUpdatedAt: z.string(), status: assessmentDecisionStatusSchema }).strict().nullable(),
    decisionNotes: z.string().nullable(),
    dueDate: z.string().nullable(),
    id: z.string(),
    overrideDueDate: z.string().nullable(),
    owner: assessmentOwnerSchema.nullable(),
    startDate: z.string().nullable(),
    vendorId: z.string(),
  })
  .strict();
export type VantaSecurityReviewDto = z.infer<typeof vantaSecurityReviewDtoSchema>;

/** `GET /v1/vendors/{vendorId}/security-reviews` — response body. */
export const vantaSecurityReviewsPageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaSecurityReviewDtoSchema });
export type VantaSecurityReviewsPage = z.infer<typeof vantaSecurityReviewsPageSchema>;

// --- VendorDocument -----------------------------------------------------------------------------------------

/**
 * Distinct from `writeApiSchemas.ts`'s `vantaUploadedFileDtoSchema`: this DTO carries `type` (the vendor
 * document's own category string) and has no `effectiveDate`.
 */
export const vantaVendorDocumentDtoSchema = z
  .object({
    creationDate: z.iso.datetime(),
    deletionDate: z.iso.datetime().nullable(),
    description: z.string().nullable(),
    fileName: z.string().nullable(),
    id: z.string(),
    mimeType: z.string(),
    title: z.string(),
    type: z.string(),
    updatedDate: z.iso.datetime(),
    uploadedBy: vantaUploadedFileActorSchema.nullable(),
    url: z.string(),
  })
  .strict();
export type VantaVendorDocumentDto = z.infer<typeof vantaVendorDocumentDtoSchema>;

/** `GET /v1/vendors/{vendorId}/documents` and `GET .../security-reviews/{securityReviewId}/documents` — same DTO, both directions. */
export const vantaVendorDocumentsPageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaVendorDocumentDtoSchema });
export type VantaVendorDocumentsPage = z.infer<typeof vantaVendorDocumentsPageSchema>;

// --- VendorFinding ------------------------------------------------------------------------------------------

const findingRiskStatusSchema = z.enum(["ACCEPT", "REMEDIATE", "NONE"]);
const findingRemediationStateSchema = z.enum(["OPEN", "CLOSED"]);

export const vantaVendorFindingDtoSchema = z
  .object({
    content: z.string(),
    documentId: z.string().nullable(),
    id: z.string(),
    remediation: z
      .object({ requirementNotes: z.string().nullable(), state: findingRemediationStateSchema })
      .strict()
      .nullable(),
    riskStatus: findingRiskStatusSchema,
    securityReviewId: z.string().nullable(),
    vendorId: z.string(),
  })
  .strict();
export type VantaVendorFindingDto = z.infer<typeof vantaVendorFindingDtoSchema>;

/** `GET /v1/vendors/{vendorId}/findings` — response body. */
export const vantaVendorFindingsPageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaVendorFindingDtoSchema });
export type VantaVendorFindingsPage = z.infer<typeof vantaVendorFindingsPageSchema>;

// --- Requests ------------------------------------------------------------------------------------------------

/** `GET /v1/vendors/{vendorId}/assessments` — request query params, all optional. */
export interface VantaListVendorAssessmentsInput {
  readonly pageSize?: number;
  readonly pageCursor?: string;
  readonly typeIdMatchesAny?: readonly string[];
  readonly statusMatchesAny?: readonly VantaAssessmentStatus[];
}

/** `GET /v1/vendors/{vendorId}/findings` — request query params, all optional. */
export interface VantaListVendorFindingsInput {
  readonly pageSize?: number;
  readonly pageCursor?: string;
  readonly securityReviewId?: string;
  readonly documentId?: string;
}

/** A vendor's compliance-framework scoping — determines which frameworks it applies to. */
interface VantaVendorFrameworkScopeInput {
  readonly scopeType: "ALL" | "PARTIAL" | "NONE";
  readonly frameworkIds?: readonly string[];
}

interface VantaVendorAuthDetailsInput {
  readonly passwordMinimumLength?: number;
  readonly passwordRequiresSymbol?: boolean;
  readonly passwordRequiresNumber?: boolean;
  readonly passwordMFA?: boolean;
  readonly method?: VantaVendorAuthMethod | null;
}

/** `POST /v1/vendors` — request body. Only `name` is required. */
export interface VantaCreateVendorInput {
  readonly name: string;
  readonly websiteUrl?: string;
  readonly accountManagerName?: string;
  readonly accountManagerEmail?: string;
  readonly securityOwnerUserId?: string;
  readonly servicesProvided?: string;
  readonly additionalNotes?: string;
  readonly businessOwnerUserId?: string;
  readonly contractStartDate?: string;
  readonly contractRenewalDate?: string;
  readonly contractTerminationDate?: string;
  readonly isVisibleToAuditors?: boolean;
  readonly authDetails?: VantaVendorAuthDetailsInput;
  readonly status?: VantaVendorStatus;
  readonly category?: string;
  readonly inherentRiskLevel?: VantaVendorRiskLevel;
  readonly residualRiskLevel?: VantaVendorRiskLevel;
  readonly vendorHeadquarters?: VantaCountryCode;
  readonly contractAmount?: VantaVendorContractAmount;
  readonly customFields?: readonly VantaCustomField[];
  readonly frameworkScope?: VantaVendorFrameworkScopeInput;
}

/**
 * `PATCH /v1/vendors/{vendorId}` — request body. Every field is optional, matching Vanta's own PATCH
 * semantics: omission means "leave it unchanged." Where Vanta's own spec additionally marks a field
 * `nullable`, an explicit `null` clears it — preserved field-by-field rather than as a blanket default.
 */
export interface VantaUpdateVendorInput {
  readonly name?: string;
  readonly websiteUrl?: string | null;
  readonly accountManagerName?: string | null;
  readonly accountManagerEmail?: string;
  readonly securityOwnerUserId?: string | null;
  readonly servicesProvided?: string | null;
  readonly additionalNotes?: string | null;
  readonly businessOwnerUserId?: string | null;
  readonly contractStartDate?: string | null;
  readonly contractRenewalDate?: string | null;
  readonly contractTerminationDate?: string | null;
  readonly isVisibleToAuditors?: boolean;
  readonly authDetails?: VantaVendorAuthDetailsInput;
  readonly status?: VantaVendorStatus;
  readonly category?: string;
  readonly inherentRiskLevel?: VantaVendorRiskLevel | null;
  readonly residualRiskLevel?: VantaVendorRiskLevel;
  readonly riskAttributeIds?: readonly string[];
  readonly vendorHeadquarters?: VantaCountryCode | null;
  readonly contractAmount?: VantaVendorContractAmount | null;
  readonly customFields?: readonly VantaCustomField[];
  readonly frameworkScope?: VantaVendorFrameworkScopeInput;
}

/** `POST /v1/vendors/{vendorId}/set-status` — request body. Sent as `multipart/form-data`, a genuine Vanta quirk for this one endpoint. */
export interface VantaSetStatusForVendorInput {
  readonly status: VantaVendorStatus;
}

/** `POST /v1/vendors/{vendorId}/findings` — request body. */
export interface VantaCreateVendorFindingInput {
  readonly content: string;
  readonly riskStatus: "ACCEPT" | "REMEDIATE" | "NONE";
  readonly remediation?: { readonly state: "OPEN" | "CLOSED"; readonly requirementNotes: string };
  readonly securityReviewId?: string;
  readonly documentId?: string;
}

/** `PATCH /v1/vendors/{vendorId}/findings/{findingId}` — request body. */
export interface VantaUpdateVendorFindingInput {
  readonly content?: string;
  readonly riskStatus?: "ACCEPT" | "REMEDIATE" | "NONE";
  readonly remediation?: { readonly state?: "OPEN" | "CLOSED"; readonly requirementNotes?: string };
}

/** A file to upload to a vendor's documents or a security review's documents, plus the vendor document's own required `type` field. */
export interface VantaUploadVendorDocumentInput {
  readonly file: VantaUploadFileInput;
  readonly type: string;
  readonly title?: string;
  readonly description?: string;
}

export type { VantaVendorDto };
export { vantaVendorDtoSchema };
