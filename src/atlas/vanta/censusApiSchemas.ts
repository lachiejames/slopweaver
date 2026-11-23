/**
 * Zod schemas for every Manage API family beyond the five this atlas syncs in `apiSchemas.ts`, bar the
 * person, whose surface is large enough to hold its own file (`personApiSchemas.ts`).
 *
 * Each schema is `.strict()`, so a field Vanta adds fails that page closed rather than passing silently
 * into a stored entity — which is what makes "the atlas holds every attribute of every response" a property
 * the type system carries rather than a claim. Every field below was measured against the live account
 * (reproduce with `slopweaver atlas vanta sync` and read the refusal a drifted page earns).
 *
 * Two shapes recur across families and are declared once: {@link vantaOwnerRefSchema}, the
 * id/displayName/emailAddress triple Vanta attaches to whatever a person owns, and
 * {@link vantaOutcomeSchema}, the single-field verdict a device check reports.
 */
import { z } from "zod";

import { vantaCustomFieldSchema, vantaFrameworkProgramFields, vantaFrameworkStatusSchema } from "./apiSchemas.js";

/** The person reference Vanta attaches to an owned thing — a device, a test. *
 * @internal
 */
export const vantaOwnerRefSchema = z
  .object({ displayName: z.string(), emailAddress: z.string(), id: z.string() })
  .strict();

/** One device check's verdict, as Vanta reports it. *
 * @internal
 */
export const vantaOutcomeSchema = z.object({ outcome: z.string() }).strict();

/** One Vanta login. Distinct from a person — see `model.ts`'s note on the two kinds. */
export const vantaUserDtoSchema = z
  .object({ displayName: z.string(), email: z.string(), id: z.string(), isActive: z.boolean() })
  .strict();

export type VantaUserDto = z.infer<typeof vantaUserDtoSchema>;

/** One personnel group. `creationDate` is required and nullable in the pinned document. */
export const vantaGroupDtoSchema = z
  .object({
    creationDate: z.string().nullable(),
    description: z.string().nullable(),
    id: z.string(),
    name: z.string(),
    personnelCount: z.number(),
    pointOfContact: z.object({ displayName: z.string(), email: z.string() }).strict().nullable(),
    source: z.string(),
  })
  .strict();

export type VantaGroupDto = z.infer<typeof vantaGroupDtoSchema>;

/**
 * One monitored computer. `owner` is what makes "who owns the failing devices" answerable from the
 * atlas alone, and `serialNumber`/`udid` are what tie a Vanta device to the same machine in another console.
 * `udid` and `operatingSystem` are required and nullable in the pinned document; every live device the sync
 * read carried both, which is the only reason requiring them went unrefuted.
 */
export const vantaMonitoredComputerDtoSchema = z
  .object({
    antivirusInstallation: vantaOutcomeSchema,
    diskEncryption: vantaOutcomeSchema,
    id: z.string(),
    integrationId: z.string(),
    lastCheckDate: z.string().nullable(),
    operatingSystem: z.object({ type: z.string(), version: z.string().nullable() }).strict().nullable(),
    owner: vantaOwnerRefSchema.nullable(),
    passwordManager: vantaOutcomeSchema,
    screenlock: vantaOutcomeSchema,
    serialNumber: z.string().nullable(),
    udid: z.string().nullable(),
  })
  .strict();

export type VantaMonitoredComputerDto = z.infer<typeof vantaMonitoredComputerDtoSchema>;

/** One test — the individual check beneath a control, with its own status, owner and remediation state. */
export const vantaTestDtoSchema = z
  .object({
    category: z.string(),
    deactivatedStatusInfo: z
      .object({
        deactivatedReason: z.string().nullable(),
        isDeactivated: z.boolean(),
        lastUpdatedDate: z.string().nullable(),
      })
      .strict(),
    description: z.string(),
    failureDescription: z.string(),
    id: z.string(),
    integrations: z.array(z.string()),
    lastTestRunDate: z.string(),
    /** Required but nullable in the pinned document: a test that never flipped carries `null`. */
    latestFlipDate: z.string().nullable(),
    name: z.string(),
    owner: vantaOwnerRefSchema.nullable(),
    remediationDescription: z.string(),
    remediationStatusInfo: z
      .object({ itemCount: z.number(), soonestRemediateByDate: z.string().nullable(), status: z.string() })
      .strict(),
    status: z.string(),
    version: z.object({ major: z.number(), minor: z.number() }).strict(),
  })
  .strict();

export type VantaTestDto = z.infer<typeof vantaTestDtoSchema>;

/**
 * One integration and its connections. `connectionErrorMessage` is free text a provider writes, so it is
 * carried as a presence flag rather than as its own content — `censusProjection.ts` says why.
 */
export const vantaIntegrationDtoSchema = z
  .object({
    connections: z.array(
      z
        .object({
          connectionErrorMessage: z.string().nullable(),
          connectionId: z.string(),
          isDisabled: z.boolean(),
        })
        .strict(),
    ),
    displayName: z.string(),
    integrationId: z.string(),
    resourceKinds: z.array(z.string()),
  })
  .strict();

export type VantaIntegrationDto = z.infer<typeof vantaIntegrationDtoSchema>;

/** One framework and its completion counts — the mapping that says which requirements a control satisfies. */
export const vantaFrameworkListDtoSchema = z
  .object({
    description: z.string(),
    displayName: z.string(),
    id: z.string(),
    numControlsCompleted: z.number(),
    numControlsTotal: z.number(),
    numDocumentsPassing: z.number(),
    numDocumentsTotal: z.number(),
    numTestsPassing: z.number(),
    numTestsTotal: z.number(),
    shorthandName: z.string(),
    status: vantaFrameworkStatusSchema.optional(),
    ...vantaFrameworkProgramFields,
  })
  .strict();

export type VantaFrameworkListDto = z.infer<typeof vantaFrameworkListDtoSchema>;

/**
 * What one scanner saw of one asset. Every key below is present on every asset record measured.
 *
 * Workstation and container-image scanner records share this boundary, so a field only one scanner class
 * fills — `assetTags`, `biosUuid`, `fqdns`, `imageDigest`, `imagePushedAtDate` and `imageTags` among them —
 * can arrive as `null`. Each is typed by the document's `VulnerableAssetScanner` rather than as `z.null()`,
 * so the first record from the other scanner class stays admissible: `assetTags` is a list of
 * `KeyValuePair` objects, not of strings, and `targetId` is declared nullable as the document has it.
 */
const vantaAssetScannerSchema = z
  .object({
    assetTags: z.array(z.strictObject({ key: z.string(), value: z.string() })).nullable(),
    biosUuid: z.string().nullable(),
    fqdns: z.array(z.string()).nullable(),
    hostnames: z.array(z.string()).nullable(),
    imageDigest: z.string().nullable(),
    imagePushedAtDate: z.string().nullable(),
    imageTags: z.array(z.string()).nullable(),
    integrationId: z.string(),
    ipv4s: z.array(z.string()).nullable(),
    ipv6s: z.array(z.string()).nullable(),
    macAddresses: z.array(z.string()).nullable(),
    operatingSystems: z.array(z.string()).nullable(),
    parentAccountOrOrganization: z.string().nullable(),
    resourceId: z.string(),
    targetId: z.string().nullable(),
  })
  .strict();

/**
 * One asset a vulnerability scanner looks at. Its `scanners` carry a machine's addresses, MAC addresses and
 * hostnames, which is why this family is one to read before quoting outbound.
 */
export const vantaVulnerableAssetDtoSchema = z
  .object({
    assetType: z.string(),
    hasBeenScanned: z.boolean(),
    id: z.string(),
    imageScanTag: z.string().nullable(),
    name: z.string(),
    scanners: z.array(vantaAssetScannerSchema),
  })
  .strict();

export type VantaVulnerableAssetDto = z.infer<typeof vantaVulnerableAssetDtoSchema>;

/**
 * One entry in Vanta's event log. This DTO exists so the log's SHAPES can be indexed; no entry is ever
 * stored as an entity — see `eventShapes.ts`.
 */
export const vantaEventLogDtoSchema = z
  .object({
    action: z.string(),
    actor: z.object({ id: z.string(), type: z.string() }).strict(),
    date: z.string(),
    id: z.string(),
    targets: z.array(z.object({ id: z.string(), type: z.string() }).strict()),
  })
  .strict();

export type VantaEventLogDto = z.infer<typeof vantaEventLogDtoSchema>;

// --- The eight families this atlas had never called ------------------------------------------------------
//
// Every schema below is transcribed from the OpenAPI document pinned in `generated/specLock.ts`, and that
// provenance is the point rather than a shortcut: a collection that answers an authoritative ZERO leaves no
// live row to measure a field against. A schema measured on a tenant that
// happens to hold no questionnaires would be a schema nobody wrote — `.strict()` would then refuse the first
// questionnaire this organisation ever creates. Reproduce any of them with
// `yarn tsx tools/generateVantaEndpoints.ts --fetch` and read the document's own `required` list.
//
// The ones that DO answer rows were transcribed the same way and then checked against the live
// answer: measured by `yarn tsx tools/probeVantaGetEndpoints.ts`, each collection that returned rows
// returned rows whose key set is exactly the document's own.

/** Whether a customer-trust NDA has been satisfied. */
const vantaNdaDetailsSchema = z
  .object({
    ndaSatisfiedDate: z.string().nullable(),
    ndaStatus: z.enum(["SIGNED", "NOT_REQUIRED", "INCOMPLETE"]),
  })
  .strict();

/** How a customer-trust account's access requests are granted. */
const vantaTrustAccessConfigSchema = z
  .object({
    autoApprovalEnabled: z.boolean(),
    grantAccessOption: z.enum(["INCLUDE_EVERYTHING_REQUESTED", "INCLUDE_ONLY_CONFIGURED"]).nullable(),
  })
  .strict();

/** One tag, named by the category it belongs to — the shape a customer-trust account carries its tags in. */
const vantaTagsByCategorySchema = z.object({ categoryId: z.string(), tagIds: z.array(z.string()) }).strict();

/** One external party this organisation shares compliance evidence with. */
export const vantaCustomerTrustAccountDtoSchema = z
  .object({
    accessConfig: vantaTrustAccessConfigSchema.nullable(),
    createdDate: z.string(),
    customFields: z.array(vantaCustomFieldSchema),
    emailDomain: z.string(),
    id: z.string(),
    name: z.string(),
    ndaDetails: vantaNdaDetailsSchema,
    tagsByCategory: z.array(vantaTagsByCategorySchema),
    updatedDate: z.string(),
  })
  .strict();

export type VantaCustomerTrustAccountDto = z.infer<typeof vantaCustomerTrustAccountDtoSchema>;

/**
 * Every state a security questionnaire moves through. Transcribed whole rather than narrowed: the document
 * declares twenty-three, most of them stages of Vanta's own extraction pipeline, and a narrowed enum would
 * refuse a questionnaire caught mid-import.
 */
const vantaQuestionnaireStatusSchema = z.enum([
  "APPROVED",
  "IN_PROGRESS",
  "IN_REVIEW",
  "READY_FOR_REVIEW",
  "WAITING_ON_ANSWERS",
  "ON_HOLD",
  "NO_LONGER_NEEDED",
  "COMPLETE",
  "ERROR",
  "EXTRACTING_QUESTIONS",
  "QUEUED_FOR_SECTION_EXTRACTION",
  "EXTRACTING_SECTIONS",
  "MAPPING_SECTIONS",
  "QUEUED_FOR_ANSWERING",
  "GENERATING_ANSWERS",
  "QUEUED_FOR_EXTRACTION",
  "PROCESSING",
  "QUEUED_FOR_PROCESSING",
  "WAITING_ON_COLUMN_SELECTION",
  "WAITING_ON_COLUMN_APPROVAL",
  "QUEUED_FOR_COLUMN_DETECTION",
  "DETECTING_COLUMNS",
]);

/** Who a questionnaire or an answer-library entry is assigned to — a person or a team, never both. */
const vantaAssignmentSchema = z
  .object({ displayName: z.string().nullable(), id: z.string(), type: z.enum(["User", "Team"]) })
  .strict();

/** One recorded status transition on a questionnaire, with who moved it and when. */
const vantaQuestionnaireStatusLogSchema = z
  .object({
    message: z.string().nullable(),
    status: vantaQuestionnaireStatusSchema,
    updatedAt: z.string(),
    updatedBy: z.object({ displayName: z.string().nullable(), email: z.string().nullable(), id: z.string() }).strict(),
  })
  .strict();

/** One tag on a questionnaire or an answer-library entry, carrying the category that scopes it. */
const vantaTagRefSchema = z.object({ categoryId: z.string(), tagId: z.string() }).strict();

/** One security questionnaire a customer sent this organisation, and where it has got to. */
export const vantaQuestionnaireDtoSchema = z
  .object({
    approverAssignment: vantaAssignmentSchema.optional(),
    completedDate: z.string().optional(),
    createdDate: z.string(),
    customerTrustAccountId: z.string().optional(),
    displayName: z.string(),
    dueDate: z.string().optional(),
    id: z.string(),
    metadata: z.array(z.object({ key: z.string(), value: z.string() }).strict()).optional(),
    ownerAssignment: vantaAssignmentSchema.optional(),
    status: vantaQuestionnaireStatusSchema,
    statusLog: z.array(vantaQuestionnaireStatusLogSchema),
    tagAndCategoryIds: z.array(vantaTagRefSchema),
    type: z.enum(["SPREADSHEET", "WEBSITE", "DOCUMENT"]),
    updatedDate: z.string(),
    url: z.string().optional(),
  })
  .strict();

export type VantaQuestionnaireDto = z.infer<typeof vantaQuestionnaireDtoSchema>;

/** One person a questionnaire may be assigned to. An id and a display name — the whole documented row. */
export const vantaAssignableUserDtoSchema = z.object({ displayName: z.string(), id: z.string() }).strict();

export type VantaAssignableUserDto = z.infer<typeof vantaAssignableUserDtoSchema>;

/** One category the customer-trust tags are grouped under. */
export const vantaTrustTagCategoryDtoSchema = z.object({ displayName: z.string(), id: z.string() }).strict();

export type VantaTrustTagCategoryDto = z.infer<typeof vantaTrustTagCategoryDtoSchema>;

/**
 * One identity-provider group this organisation could import into Vanta but has not.
 *
 * It is deliberately a kind of its own rather than a flag on `group`: a row here is a group that exists in
 * the IdP and NOT in Vanta, so folding it into the imported groups would make "how many groups does Vanta
 * hold" unanswerable from the file that is supposed to answer it.
 */
export const vantaImportableIdpGroupDtoSchema = z
  .object({
    externalAccountId: z.string().nullable(),
    id: z.string(),
    integrationId: z.string(),
    name: z.string(),
  })
  .strict();

export type VantaImportableIdpGroupDto = z.infer<typeof vantaImportableIdpGroupDtoSchema>;

/** One reusable question-and-answer pair this organisation answers customer questionnaires from. */
export const vantaAnswerLibraryEntryDtoSchema = z
  .object({
    answer: z.string(),
    expirationDate: z.string().nullable(),
    expirationStatus: z.enum(["CURRENT", "EXPIRED"]),
    id: z.string(),
    lastUpdated: z.string(),
    lastVerified: z.string().nullable(),
    ownerAssignment: vantaAssignmentSchema.nullable(),
    question: z.string(),
    tags: z.array(vantaTagRefSchema),
  })
  .strict();

export type VantaAnswerLibraryEntryDto = z.infer<typeof vantaAnswerLibraryEntryDtoSchema>;

/**
 * One vulnerability that was fixed, with the SLA it was measured against.
 *
 * Distinct from the `vulnerability` family, which holds findings that are open: a remediation is the record
 * of a finding closing, and it carries the two dates — `slaDeadlineDate` and `remediationDate` — that decide
 * whether the fix landed on time. Those exist nowhere in the finding itself.
 */
export const vantaVulnerabilityRemediationDtoSchema = z
  .object({
    detectedDate: z.string().nullable(),
    id: z.string(),
    remediationDate: z.string().nullable(),
    severity: z.string(),
    slaDeadlineDate: z.string().nullable(),
    vulnerabilityId: z.string(),
    vulnerableAssetId: z.string(),
  })
  .strict();

export type VantaVulnerabilityRemediationDto = z.infer<typeof vantaVulnerabilityRemediationDtoSchema>;
