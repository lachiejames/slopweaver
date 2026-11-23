/**
 * The census: every Manage API family this atlas walks beyond the original kinds `syncRunners.ts` writes out, declared once
 * as data rather than once per family as code.
 *
 * Each family below is single-surface, id-keyed and carries no withheld field, which is the whole reason a
 * table works: `client.ts` builds one lister per row, `censusProjection.ts` builds one entity per row, and
 * `sync.ts` iterates the table. A family that ever needs a second surface, a merge across two reads or a
 * privacy decision belongs in `syncRunners.ts` beside `control` and `risk` instead — the table is not the place to
 * grow a special case.
 *
 * The event log is deliberately NOT here. Its rows are events rather than entities, and storing them is the
 * one thing the owner ruled out; `eventShapes.ts` indexes what kinds of event exist instead.
 */
import type { z } from "zod";

import { vantaPageEnvelopeSchema } from "./apiSchemas.js";
import {
  type VantaAnswerLibraryEntryDto,
  type VantaAssignableUserDto,
  type VantaCustomerTrustAccountDto,
  type VantaFrameworkListDto,
  type VantaGroupDto,
  type VantaImportableIdpGroupDto,
  type VantaIntegrationDto,
  type VantaMonitoredComputerDto,
  type VantaQuestionnaireDto,
  type VantaTestDto,
  type VantaTrustTagCategoryDto,
  type VantaUserDto,
  type VantaVulnerabilityRemediationDto,
  type VantaVulnerableAssetDto,
  vantaAnswerLibraryEntryDtoSchema,
  vantaAssignableUserDtoSchema,
  vantaCustomerTrustAccountDtoSchema,
  vantaFrameworkListDtoSchema,
  vantaGroupDtoSchema,
  vantaImportableIdpGroupDtoSchema,
  vantaIntegrationDtoSchema,
  vantaMonitoredComputerDtoSchema,
  vantaQuestionnaireDtoSchema,
  vantaTestDtoSchema,
  vantaTrustTagCategoryDtoSchema,
  vantaUserDtoSchema,
  vantaVulnerabilityRemediationDtoSchema,
  vantaVulnerableAssetDtoSchema,
} from "./censusApiSchemas.js";
import { type VantaIssueDto, vantaIssueDtoSchema } from "./issueApiSchemas.js";
import { type VantaLibraryControlDto, vantaLibraryControlDtoSchema } from "./libraryControlApiSchemas.js";
import { type VantaPageBoundary, vantaPagedBoundary, vantaUnpagedBoundary } from "./pageBoundary.js";
import { type VantaPersonDto, vantaPersonDtoSchema } from "./personApiSchemas.js";
import {
  type VantaVendorRegisterDto,
  vantaDiscoveredVendorDtoSchema,
  vantaVendorAssessmentTypeDtoSchema,
  vantaVendorRiskAttributeDtoSchema,
} from "./vendorApiSchemas.js";
import { type VantaVulnerabilityDto, vantaVulnerabilityDtoSchema } from "./vulnerabilityApiSchemas.js";

/** Every DTO a census family can yield. */
export type VantaCensusDto =
  | VantaAnswerLibraryEntryDto
  | VantaAssignableUserDto
  | VantaCustomerTrustAccountDto
  | VantaFrameworkListDto
  | VantaGroupDto
  | VantaImportableIdpGroupDto
  | VantaIntegrationDto
  | VantaIssueDto
  | VantaLibraryControlDto
  | VantaMonitoredComputerDto
  | VantaPersonDto
  | VantaQuestionnaireDto
  | VantaTestDto
  | VantaTrustTagCategoryDto
  | VantaUserDto
  | VantaVendorRegisterDto
  | VantaVulnerabilityDto
  | VantaVulnerabilityRemediationDto
  | VantaVulnerableAssetDto;

/** One Manage API family: its kind, the surface name coverage reports it under, and how to read a row's id. */
export interface VantaCensusFamily {
  readonly kind: VantaCensusKind;
  readonly surface: string;
  readonly path: string;
  readonly description: string;
  /** The endpoint's declared read — every row's DTO strict, so a drifted field refuses the page by name. */
  readonly pageBoundary: VantaPageBoundary<VantaCensusDto>;
  readonly providerId: (dto: VantaCensusDto) => string;
  /**
   * Whether this family's rows need care before their content is quoted outbound. It never gates
   * ingestion — every attribute is stored either way — it marks what a sending surface must read before
   * it repeats. True for the families carrying staff identity or a machine's own identifiers: a person's
   * employment and leave dates, a user's work email, a device's owner, serial number and udid, a group's
   * point of contact, a test's owner, and an integration's connection state.
   */
  readonly handleWithCare: boolean;
}

/**
 * Read one named string field off a row, without asserting the row's type.
 *
 * The empty-string fallback is unreachable rather than a real branch: every family's schema declares its
 * identifying field required and `string`, so a row that reached here has one. It exists because the union
 * of thirteen DTO types has no field common to all of them for the compiler to narrow on.
 */
function stringField({ dto, field }: { dto: VantaCensusDto; field: string }): string {
  const found = Object.entries(dto).find(([key]) => key === field)?.[1];
  return typeof found === "string" ? found : "";
}

/** The `id` twelve of the thirteen families key on. */
function idOf(dto: VantaCensusDto): string {
  return stringField({ dto, field: "id" });
}

/**
 * One cursor-walked family's row. Its endpoint is derived from its own path, so the two can never name different
 * surfaces, and it keys on `id` unless the row names another field.
 */
function pagedFamily({
  dataSchema,
  providerId = idOf,
  ...row
}: Omit<VantaCensusFamily, "pageBoundary" | "providerId"> & {
  dataSchema: z.ZodType<VantaCensusDto>;
  providerId?: VantaCensusFamily["providerId"];
}): VantaCensusFamily {
  const pageSchema = vantaPageEnvelopeSchema({ dataSchema });
  return { ...row, pageBoundary: vantaPagedBoundary({ endpoint: `GET ${row.path}`, pageSchema }), providerId };
}

/**
 * Every kind the census table owns. Declared as a union rather than derived, so a kind added here without a
 * row below — or a row without a runner in `syncRunners.ts` — fails to compile rather than syncing nothing.
 */
export type VantaCensusKind =
  | "answer-library-entry"
  | "customer-trust-account"
  | "discovered-vendor"
  | "framework"
  | "group"
  | "importable-idp-group"
  | "integration"
  | "issue"
  | "library-control"
  | "monitored-computer"
  | "person"
  | "questionnaire"
  | "questionnaire-assignable-user"
  | "test"
  | "trust-tag-category"
  | "user"
  | "vendor-assessment-type"
  | "vendor-risk-attribute"
  | "vulnerability"
  | "vulnerability-remediation"
  | "vulnerable-asset";

/**
 * Every census family, keyed by the kind it produces. Entity counts are deliberately not written here —
 * `slopweaver atlas vanta coverage --json` prints the current one per kind, which cannot go stale.
 */
export const VANTA_CENSUS_FAMILIES: Readonly<Record<VantaCensusKind, VantaCensusFamily>> = {
  user: pagedFamily({
    dataSchema: vantaUserDtoSchema,
    description: "every Vanta login",
    handleWithCare: true,
    kind: "user",
    path: "/v1/users",
    surface: "users-list",
  }),
  person: pagedFamily({
    dataSchema: vantaPersonDtoSchema,
    description: "every personnel record, with its onboarding, training and offboarding task state",
    handleWithCare: true,
    kind: "person",
    path: "/v1/people",
    surface: "people-list",
  }),
  group: pagedFamily({
    dataSchema: vantaGroupDtoSchema,
    description: "every personnel group",
    handleWithCare: true,
    kind: "group",
    path: "/v1/groups",
    surface: "groups-list",
  }),
  "monitored-computer": pagedFamily({
    dataSchema: vantaMonitoredComputerDtoSchema,
    description: "every monitored computer, with its owner and its four device checks",
    handleWithCare: true,
    kind: "monitored-computer",
    path: "/v1/monitored-computers",
    surface: "monitored-computers-list",
  }),
  test: pagedFamily({
    dataSchema: vantaTestDtoSchema,
    description: "every test — the individual check beneath a control",
    handleWithCare: true,
    kind: "test",
    path: "/v1/tests",
    surface: "tests-list",
  }),
  integration: pagedFamily({
    dataSchema: vantaIntegrationDtoSchema,
    description: "every integration and its connections",
    handleWithCare: true,
    kind: "integration",
    path: "/v1/integrations",
    providerId: (dto) => stringField({ dto, field: "integrationId" }),
    surface: "integrations-list",
  }),
  framework: pagedFamily({
    dataSchema: vantaFrameworkListDtoSchema,
    description: "every framework and its control, document and test completion counts",
    handleWithCare: false,
    kind: "framework",
    path: "/v1/frameworks",
    surface: "frameworks-list",
  }),
  "discovered-vendor": pagedFamily({
    dataSchema: vantaDiscoveredVendorDtoSchema,
    description: "every vendor an integration noticed, before anyone put it on the register",
    handleWithCare: false,
    kind: "discovered-vendor",
    path: "/v1/discovered-vendors",
    surface: "discovered-vendors-list",
  }),
  "vendor-assessment-type": pagedFamily({
    dataSchema: vantaVendorAssessmentTypeDtoSchema,
    description: "every vendor assessment type",
    handleWithCare: false,
    kind: "vendor-assessment-type",
    path: "/v1/vendor-assessment-types",
    surface: "vendor-assessment-types-list",
  }),
  "vendor-risk-attribute": pagedFamily({
    dataSchema: vantaVendorRiskAttributeDtoSchema,
    description: "every vendor risk attribute",
    handleWithCare: false,
    kind: "vendor-risk-attribute",
    path: "/v1/vendor-risk-attributes",
    surface: "vendor-risk-attributes-list",
  }),
  issue: pagedFamily({
    dataSchema: vantaIssueDtoSchema,
    description: "every issue",
    handleWithCare: false,
    kind: "issue",
    path: "/v1/issues",
    surface: "issues-list",
  }),
  vulnerability: pagedFamily({
    dataSchema: vantaVulnerabilityDtoSchema,
    description:
      "every vulnerability finding, stored. `slopweaver atlas vanta vulnerabilities` still reads them LIVE and filtered, because triage needs the current answer; the stored census is what makes the finding population itself something the atlas can report on",
    handleWithCare: false,
    kind: "vulnerability",
    path: "/v1/vulnerabilities",
    surface: "vulnerabilities-census",
  }),
  "library-control": pagedFamily({
    dataSchema: vantaLibraryControlDtoSchema,
    description:
      "every control Vanta's own library ships, adopted or not — the row carries the frameworks it maps to and a deactivation reason, neither of which `/v1/controls` returns",
    handleWithCare: false,
    kind: "library-control",
    path: "/v1/controls/controls-library",
    surface: "controls-library",
  }),
  "customer-trust-account": pagedFamily({
    dataSchema: vantaCustomerTrustAccountDtoSchema,
    description: "every external party this organisation shares compliance evidence with, and its NDA state",
    handleWithCare: true,
    kind: "customer-trust-account",
    path: "/v1/customer-trust/accounts",
    surface: "customer-trust-accounts",
  }),
  questionnaire: pagedFamily({
    dataSchema: vantaQuestionnaireDtoSchema,
    description: "every security questionnaire a customer sent, with its whole status history",
    handleWithCare: true,
    kind: "questionnaire",
    path: "/v1/customer-trust/questionnaires",
    surface: "customer-trust-questionnaires",
  }),
  "questionnaire-assignable-user": {
    kind: "questionnaire-assignable-user",
    description: "every person a questionnaire may be assigned to — the answer to who can own one",
    handleWithCare: true,
    path: "/v1/customer-trust/questionnaires/assignable-users",
    providerId: idOf,
    pageBoundary: vantaUnpagedBoundary({
      dataSchema: vantaAssignableUserDtoSchema,
      endpoint: "GET /v1/customer-trust/questionnaires/assignable-users",
      shape: "results-data",
    }),
    surface: "customer-trust-assignable-users",
  },
  "trust-tag-category": {
    kind: "trust-tag-category",
    description: "every category the customer-trust tags are grouped under",
    handleWithCare: false,
    path: "/v1/customer-trust/tag-categories",
    providerId: idOf,
    pageBoundary: vantaUnpagedBoundary({
      dataSchema: vantaTrustTagCategoryDtoSchema,
      endpoint: "GET /v1/customer-trust/tag-categories",
      shape: "results-array",
    }),
    surface: "customer-trust-tag-categories",
  },
  "importable-idp-group": pagedFamily({
    dataSchema: vantaImportableIdpGroupDtoSchema,
    description: "every identity-provider group this organisation could import into Vanta and has not",
    handleWithCare: true,
    kind: "importable-idp-group",
    path: "/v1/groups/importable-idp-groups",
    surface: "importable-idp-groups",
  }),
  "answer-library-entry": pagedFamily({
    dataSchema: vantaAnswerLibraryEntryDtoSchema,
    description: "every reusable question-and-answer pair customer questionnaires are answered from",
    handleWithCare: true,
    kind: "answer-library-entry",
    path: "/v1/knowledge-base/answer-library",
    surface: "answer-library",
  }),
  "vulnerability-remediation": pagedFamily({
    dataSchema: vantaVulnerabilityRemediationDtoSchema,
    description:
      "every vulnerability that was FIXED, with the SLA deadline it was measured against — the two dates that decide whether a fix landed on time exist nowhere on the finding itself",
    handleWithCare: false,
    kind: "vulnerability-remediation",
    path: "/v1/vulnerability-remediations",
    surface: "vulnerability-remediations",
  }),
  "vulnerable-asset": pagedFamily({
    dataSchema: vantaVulnerableAssetDtoSchema,
    description: "every asset a vulnerability scanner looks at, with the addresses and hostnames it reported",
    handleWithCare: true,
    kind: "vulnerable-asset",
    path: "/v1/vulnerable-assets",
    surface: "vulnerable-assets-list",
  }),
};

/** Every census family as a list, in a stable order a walk can iterate. */
export const VANTA_CENSUS_FAMILY_LIST: readonly VantaCensusFamily[] = Object.values(VANTA_CENSUS_FAMILIES);
