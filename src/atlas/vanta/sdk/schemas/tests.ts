/**
 * Zod response schemas and request types for the Tests tag, built from Vanta's own published OpenAPI spec.
 *
 * `Test` is identical, field-for-field, to `controlEvidenceApiSchemas.ts`'s `vantaControlTestDtoSchema` —
 * imported and reused here too, never redeclared.
 *
 * `VantaTestStatusFilter`/`VantaTestCategoryFilter` are deliberately separate types from anything on the
 * `Test` DTO itself: Vanta's `statusFilter`/`categoryFilter` query params use a different casing convention
 * than the values that actually appear on a `Test` object's own `status`/`category` fields.
 */
import type { z } from "zod";

import { vantaPageEnvelopeSchema } from "../../apiSchemas.js";
import { type VantaControlTestDto, vantaControlTestDtoSchema } from "../../controlEvidenceApiSchemas.js";

/** `GET /v1/tests`'s `statusFilter` query param. */
type VantaTestStatusFilter = "OK" | "DEACTIVATED" | "NEEDS_ATTENTION" | "IN_PROGRESS" | "INVALID" | "NOT_APPLICABLE";

/** `GET /v1/tests`'s `categoryFilter` query param. */
type VantaTestCategoryFilter =
  | "ACCOUNTS_ACCESS"
  | "ACCOUNT_SECURITY"
  | "ACCOUNT_SETUP"
  | "COMPUTERS"
  | "CUSTOM"
  | "DATA_STORAGE"
  | "EMPLOYEES"
  | "INFRASTRUCTURE"
  | "IT"
  | "LOGGING"
  | "MONITORING_ALERTS"
  | "PEOPLE"
  | "POLICIES"
  | "RISK_ANALYSIS"
  | "SECURITY_ALERT_MANAGEMENT"
  | "SOFTWARE_DEVELOPMENT"
  | "VENDORS"
  | "VULNERABILITY_MANAGEMENT";

/** `GET /v1/tests` — request query params, all optional. */
export interface VantaListTestsInput {
  readonly pageSize?: number;
  readonly pageCursor?: string;
  readonly statusFilter?: VantaTestStatusFilter;
  readonly frameworkFilter?: string;
  readonly integrationFilter?: string;
  readonly controlFilter?: string;
  readonly ownerFilter?: string;
  readonly categoryFilter?: VantaTestCategoryFilter;
  readonly isInRollout?: boolean;
}

/** `POST /v1/tests/{testId}/entities/{entityId}/deactivate` — request body. */
export interface VantaDeactivateTestEntityInput {
  readonly deactivateReason: string;
  readonly deactivateUntilDate?: string;
}

/** `GET /v1/tests` — response body. */
export const vantaTestsPageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaControlTestDtoSchema });
export type VantaTestsPage = z.infer<typeof vantaTestsPageSchema>;

export type { VantaControlTestDto };
export { vantaControlTestDtoSchema };
