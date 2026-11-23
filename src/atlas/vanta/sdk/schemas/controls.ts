/**
 * Zod response schemas and request types for the Controls tag, built from Vanta's own published OpenAPI
 * spec.
 *
 * `Control`/`Document`/`Test` are identical, field-for-field, to `apiSchemas.ts`'s
 * `vantaControlDtoSchema`/`vantaDocumentDtoSchema` and `controlEvidenceApiSchemas.ts`'s
 * `vantaControlTestDtoSchema` — those are imported and reused rather than redeclared here.
 *
 * Requests are plain TypeScript types, not Zod — matching `writeClient.ts`'s convention. A request body is
 * data this package already fully controls at the call site; only a RESPONSE crosses a real trust boundary
 * and needs runtime validation.
 */
import { z } from "zod";

import {
  type VantaControlDto,
  type VantaCustomField,
  vantaControlDtoSchema,
  vantaDocumentDtoSchema,
  vantaPageEnvelopeSchema,
} from "../../apiSchemas.js";
import {
  type VantaControlDetailDto,
  vantaControlDetailDtoSchema,
  vantaControlTestDtoSchema,
} from "../../controlEvidenceApiSchemas.js";

/**
 * Vanta's own `ControlDomain` enum, verbatim — including its own inconsistencies (a space instead of an
 * underscore in `NETWORK SECURITY`, mismatched separators in `PROJECT_&_RESOURCE MANAGEMENT`). These are
 * the real wire values; do not "fix" them.
 */
const VANTA_CONTROL_DOMAINS = [
  "ARTIFICIAL_&_AUTONOMOUS_TECHNOLOGY",
  "ASSET_MANAGEMENT",
  "BUSINESS_CONTINUITY_&_DISASTER_RECOVERY",
  "CAPACITY_&_PERFORMANCE_PLANNING",
  "CHANGE_MANAGEMENT",
  "CLOUD_SECURITY",
  "COMPLIANCE",
  "CONFIGURATION_MANAGEMENT",
  "CONTINUOUS_MONITORING",
  "CRYPTOGRAPHIC_PROTECTIONS",
  "DATA_CLASSIFICATION_&_HANDLING",
  "EMBEDDED_TECHNOLOGY",
  "ENDPOINT_SECURITY",
  "HUMAN_RESOURCES_SECURITY",
  "IDENTIFICATION_&_AUTHENTICATION",
  "INCIDENT_RESPONSE",
  "INFORMATION_ASSURANCE",
  "MAINTENANCE",
  "MOBILE_DEVICE_MANAGEMENT",
  "NETWORK SECURITY",
  "PHYSICAL_&_ENVIRONMENTAL_SECURITY",
  "PRIVACY",
  "PROJECT_&_RESOURCE MANAGEMENT",
  "RISK_MANAGEMENT",
  "SECURE_ENGINEERING_&_ARCHITECTURE",
  "SECURITY_AWARENESS_&_TRAINING",
  "SECURITY_OPERATIONS",
  "SECURITY_&_PRIVACY_GOVERNANCE",
  "TECHNOLOGY_DEVELOPMENT_&_ACQUISITION",
  "THIRD-PARTY_MANAGEMENT",
  "THREAT_MANAGEMENT",
  "VULNERABILITY_&_PATCH_MANAGEMENT",
  "WEB_SECURITY",
  "ADMINISTRATIVE",
  "PHYSICAL",
  "TECHNICAL",
  "BASIC",
  "DERIVED",
] as const;

type VantaControlDomain = (typeof VANTA_CONTROL_DOMAINS)[number];

/** The GDPR role a control maps to — only meaningful for controls mapped to the GDPR framework. */
type VantaGdprRole = "BOTH" | "CONTROLLER" | "PROCESSOR";

interface VantaFrameworkSection {
  /** A documented `FrameworkId` (e.g. `'ISO_27001_2022'`), or any other string Vanta accepts here. */
  readonly frameworkId: string;
  readonly sectionId: string;
}

/** `POST /v1/controls` — request body. */
export interface VantaCreateControlInput {
  readonly externalId: string;
  readonly name: string | null;
  readonly description: string;
  readonly effectiveDate: string;
  readonly domain: VantaControlDomain;
  readonly sections?: readonly VantaFrameworkSection[];
  readonly role?: VantaGdprRole | null;
  readonly customFields?: readonly VantaCustomField[];
}

/** `POST /v1/controls/add-from-library` — request body. */
export interface VantaAddControlFromLibraryInput {
  readonly controlId: string;
}

/**
 * `PATCH /v1/controls/{controlId}` — request body. Every field is optional by Vanta's own design:
 * omitting a field means "leave it unchanged," which is why this uses `?:` rather than `| null`.
 */
export interface VantaUpdateControlMetadataInput {
  readonly name?: string;
  readonly externalId?: string;
  readonly description?: string;
  readonly domain?: VantaControlDomain;
  readonly note?: string;
  readonly customFields?: readonly VantaCustomField[];
}

/** `POST /v1/controls/{controlId}/add-document-to-control` — request body. */
export interface VantaAddControlDocumentMappingInput {
  readonly documentId: string;
}

/** `POST /v1/controls/{controlId}/set-owner` — request body. `null` removes the owner. */
export interface VantaSetOwnerForControlInput {
  readonly userId: string | null;
}

/** `POST /v1/controls/{controlId}/add-test-to-control` — request body. */
export interface VantaAddControlTestMappingInput {
  readonly testId: string;
}

/** `GET /v1/controls/controls-library` — response body. Deprecated by Vanta itself; see `@deprecated` on the method. */
export const vantaControlLibraryPageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaControlDtoSchema });
export type VantaControlLibraryPage = z.infer<typeof vantaControlLibraryPageSchema>;

/** `GET /v1/controls/{controlId}/documents` — response body. */
export const vantaControlDocumentsPageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaDocumentDtoSchema });
export type VantaControlDocumentsPage = z.infer<typeof vantaControlDocumentsPageSchema>;

/** `POST /v1/controls/{controlId}/add-document-to-control` — response body. */
export const vantaAddControlDocumentMappingResponseSchema = z
  .object({ control: vantaControlDtoSchema, document: vantaDocumentDtoSchema })
  .strict();
export type VantaAddControlDocumentMappingResponse = z.infer<typeof vantaAddControlDocumentMappingResponseSchema>;

/** `POST /v1/controls/{controlId}/add-test-to-control` — response body. */
export const vantaAddControlTestMappingResponseSchema = z
  .object({ control: vantaControlDtoSchema, test: vantaControlTestDtoSchema })
  .strict();
export type VantaAddControlTestMappingResponse = z.infer<typeof vantaAddControlTestMappingResponseSchema>;

export type { VantaControlDetailDto, VantaControlDto };
export { vantaControlDetailDtoSchema, vantaControlDtoSchema };
