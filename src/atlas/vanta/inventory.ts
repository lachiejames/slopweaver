/**
 * The closed inventory of Vanta Manage API surfaces this atlas covers.
 *
 * A surface not named here cannot silently vanish from a coverage report the way an unmapped one would — it
 * is either one of the required surfaces below, or it is a named out-of-scope group. That is what makes
 * "what does this atlas NOT cover" a printable list rather than a guess.
 *
 * Every `browser` row is named here so a surface nobody has walked is a row rather than an absence.
 *
 * **What this list does NOT do, stated because its own header used to claim otherwise.** Nothing reads it
 * but {@link roleFor} in `syncKind.ts`, so a row added here is a DECLARATION and not a gap the coverage
 * report raises — `slopweaver atlas vanta coverage` prints `descriptor.ts`'s `excludes` and the stored
 * gaps, neither of which is derived from this constant. The header this replaced said a browser row
 * "surfaces as a permanent, named gap", and that was never wired: check it in one command with
 * `grep -rn VANTA_REQUIRED_SURFACES src --include='*.ts'`. So a surface that is genuinely missing coverage
 * has to say so in the descriptor too, which is where the policy body's own `not-fetched` row lives.
 */
import { VANTA_CENSUS_FAMILY_LIST, type VantaCensusFamily } from "./census.js";
import { VANTA_CHILD_FAMILY_LIST } from "./childCensus.js";
import type { VantaTestEntityStatus } from "./controlEvidenceApiSchemas.js";
import type { VantaChannel, VantaEvidenceRole, VantaKind } from "./model.js";

/** One surface this atlas is required to cover, for one kind, through one channel. */
export interface VantaRequiredSurface {
  readonly kind: VantaKind;
  readonly channel: VantaChannel;
  readonly surface: string;
  readonly role: VantaEvidenceRole;
  readonly description: string;
}

/**
 * A Manage API surface's endpoint, as the single source of truth for its path and fixed query params.
 * Cursor params (`pageSize`, `pageCursor`) are NOT here — `pagination.ts` owns those.
 */
export interface VantaManageEndpoint {
  readonly method: "GET";
  readonly path: string;
  readonly fixedQuery: Readonly<Record<string, string>>;
}

/**
 * The hand-listed Manage API surfaces' endpoints — every one that is not a census family. Kept as its own
 * closed record so {@link vantaManageEndpointFor} is total over its keys rather than a lookup that can miss.
 */
const VANTA_LISTED_MANAGE_ENDPOINTS = {
  "controls-active": { fixedQuery: {}, method: "GET", path: "/v1/controls" },
  "controls-deactivated": { fixedQuery: {}, method: "GET", path: "/v1/controls/deactivated-controls" },
  "evidence-documents": { fixedQuery: {}, method: "GET", path: "/v1/documents" },
  "knowledge-base-resources": { fixedQuery: {}, method: "GET", path: "/v1/knowledge-base/resources" },
  "policies-list": { fixedQuery: {}, method: "GET", path: "/v1/policies" },
  "risks-enterprise-risk": { fixedQuery: { type: "Enterprise Risk" }, method: "GET", path: "/v1/risk-scenarios" },
  "event-logs-walk": { fixedQuery: {}, method: "GET", path: "/v1/event-logs" },
  "risks-risk-scenario": { fixedQuery: { type: "Risk Scenario" }, method: "GET", path: "/v1/risk-scenarios" },
  "vendors-list": { fixedQuery: {}, method: "GET", path: "/v1/vendors" },
} as const satisfies Readonly<Record<string, VantaManageEndpoint>>;

/** One hand-listed Manage API surface — closed, so a misspelled surface fails to compile. */
export type VantaListedManageSurface = keyof typeof VANTA_LISTED_MANAGE_ENDPOINTS;

/**
 * The endpoint one census family is listed through, built from the family's own row.
 *
 * @param family the census family, from `census.ts`'s table
 * @returns the endpoint, with no fixed query
 */
export function vantaCensusEndpoint({ family }: { family: VantaCensusFamily }): VantaManageEndpoint {
  return { fixedQuery: {}, method: "GET", path: family.path };
}

/**
 * Every Manage API surface's endpoint, keyed by the same surface name used in
 * {@link VANTA_REQUIRED_SURFACES}. `client.ts` reads the two halves this is built from rather than
 * redeclaring a path.
 */
export const VANTA_MANAGE_ENDPOINTS: Readonly<Record<string, VantaManageEndpoint>> = {
  ...Object.fromEntries(VANTA_CENSUS_FAMILY_LIST.map((family) => [family.surface, vantaCensusEndpoint({ family })])),
  ...VANTA_LISTED_MANAGE_ENDPOINTS,
};

/** The surface the event-log walk reports under. Its rows are indexed by shape, never stored — see `eventShapes.ts`. */
export const VANTA_EVENT_LOGS_SURFACE = "event-logs-walk";

/**
 * The frameworks-list endpoint.
 *
 * @returns the endpoint
 */
export function vantaFrameworksEndpoint(): VantaManageEndpoint {
  return { fixedQuery: {}, method: "GET", path: "/v1/frameworks" };
}

/**
 * The control-detail endpoint for one control.
 *
 * @param controlId the control's provider id
 * @returns the endpoint
 */
export function vantaControlDetailEndpoint({ controlId }: { controlId: string }): VantaManageEndpoint {
  return { fixedQuery: {}, method: "GET", path: `/v1/controls/${encodeURIComponent(controlId)}` };
}

/**
 * The control-tests endpoint for one control.
 *
 * @param controlId the control's provider id
 * @returns the endpoint
 */
export function vantaControlTestsEndpoint({ controlId }: { controlId: string }): VantaManageEndpoint {
  return { fixedQuery: {}, method: "GET", path: `/v1/controls/${encodeURIComponent(controlId)}/tests` };
}

/**
 * The test-entities endpoint for one control test.
 *
 * @param testId the test's provider id
 * @param entityStatus which entities to list; `null` sends no filter, which Vanta answers with FAILING
 * @returns the endpoint
 */
export function vantaTestEntitiesEndpoint({
  testId,
  entityStatus,
}: {
  testId: string;
  entityStatus: VantaTestEntityStatus | null;
}): VantaManageEndpoint {
  return {
    fixedQuery: entityStatus === null ? {} : { entityStatus },
    method: "GET",
    path: `/v1/tests/${encodeURIComponent(testId)}/entities`,
  };
}

/** The filters `GET /v1/vulnerabilities` accepts that this package exposes. Every one is optional. */
export interface VantaVulnerabilityFilters {
  readonly severity: string | null;
  readonly isDeactivated: boolean | null;
  readonly isFixAvailable: boolean | null;
}

/**
 * The vulnerabilities-list endpoint, with the caller's filters folded into its fixed query.
 *
 * Filters ride in `fixedQuery` rather than being baked into the path so `client.ts`'s existing
 * `singleSurfaceLister` walks this surface unchanged — `pagination.ts` still owns `pageSize`/`pageCursor`,
 * and one filtered walk is just an endpoint with more fixed params.
 *
 * @param filters which vulnerabilities to ask Vanta for; a `null` member is simply not sent
 * @returns the endpoint
 */
export function vantaVulnerabilitiesEndpoint({ filters }: { filters: VantaVulnerabilityFilters }): VantaManageEndpoint {
  const fixedQuery: Record<string, string> = {};
  if (filters.severity !== null) {
    fixedQuery["severity"] = filters.severity;
  }
  if (filters.isDeactivated !== null) {
    fixedQuery["isDeactivated"] = String(filters.isDeactivated);
  }
  if (filters.isFixAvailable !== null) {
    fixedQuery["isFixAvailable"] = String(filters.isFixAvailable);
  }
  return { fixedQuery, method: "GET", path: "/v1/vulnerabilities" };
}

/**
 * The single-vulnerability endpoint.
 *
 * @param vulnerabilityId the finding's provider id
 * @returns the endpoint
 */
export function vantaVulnerabilityDetailEndpoint({
  vulnerabilityId,
}: {
  vulnerabilityId: string;
}): VantaManageEndpoint {
  return { fixedQuery: {}, method: "GET", path: `/v1/vulnerabilities/${encodeURIComponent(vulnerabilityId)}` };
}

/**
 * The endpoint for one hand-listed Manage API surface. A census family goes through
 * {@link vantaCensusEndpoint} instead, and a browser-only surface has no endpoint to ask for.
 *
 * @param surface the surface name, closed over the listed endpoints' own keys
 * @returns the endpoint — total, because the key type is derived from the record it reads
 */
export function vantaManageEndpointFor({ surface }: { surface: VantaListedManageSurface }): VantaManageEndpoint {
  return VANTA_LISTED_MANAGE_ENDPOINTS[surface];
}

/**
 * Every surface this atlas is required to cover. Not exhaustive of every Vanta Manage endpoint — see
 * {@link VANTA_OUT_OF_SCOPE_GROUPS} for what's named as out of scope instead.
 */
const VANTA_REQUIRED_SURFACES: readonly VantaRequiredSurface[] = [
  {
    channel: "manage-api",
    description: "active controls",
    kind: "control",
    role: "authoritative",
    surface: "controls-active",
  },
  {
    channel: "manage-api",
    description: "deactivated controls",
    kind: "control",
    role: "authoritative",
    surface: "controls-deactivated",
  },
  {
    channel: "browser",
    description: "the controls list as the Editor UI shows it — no browser capture ships for this atlas yet",
    kind: "control",
    role: "corroborating",
    surface: "controls-collection",
  },
  {
    channel: "manage-api",
    description: "risk-scenario-type risks",
    kind: "risk",
    role: "authoritative",
    surface: "risks-risk-scenario",
  },
  {
    channel: "manage-api",
    description: "enterprise-risk-type risks",
    kind: "risk",
    role: "authoritative",
    surface: "risks-enterprise-risk",
  },
  {
    channel: "browser",
    description: "the risk register as the Editor UI shows it — no browser capture ships for this atlas yet",
    kind: "risk",
    role: "corroborating",
    surface: "risks-collection",
  },
  {
    channel: "manage-api",
    description: "every policy",
    kind: "policy",
    role: "authoritative",
    surface: "policies-list",
  },
  {
    channel: "browser",
    description: "the policy list as the Editor UI shows it — no browser capture ships for this atlas yet",
    kind: "policy",
    role: "corroborating",
    surface: "policies-collection",
  },
  {
    channel: "manage-api",
    description:
      "the FILE behind each policy: `GET /v1/knowledge-base/resources` returns every policy document this organisation holds, each with a presigned URL its bytes are fetched from during the sync. AUTHORITATIVE, and API-first by measurement: the predecessor of this row said the body was browser-only because nine content-shaped routes under `/v1/policies/{id}` answer HTTP 404 — all nine were guessed, and this endpoint is in Vanta's own published document",
    kind: "policy-document",
    role: "authoritative",
    surface: "knowledge-base-resources",
  },
  {
    channel: "manage-api",
    description: "every document/evidence item",
    kind: "evidence",
    role: "authoritative",
    surface: "evidence-documents",
  },
  {
    channel: "browser",
    description: "the documents list as the Editor UI shows it — no browser capture ships for this atlas yet",
    kind: "evidence",
    role: "corroborating",
    surface: "evidence-collection",
  },
  {
    channel: "browser",
    description:
      "every audit card visible to this account — no Manage API surface exists, and no browser capture ships for this atlas yet",
    kind: "audit",
    role: "authoritative",
    surface: "audits-collection",
  },
  {
    channel: "manage-api",
    description: "every vendor",
    kind: "vendor",
    role: "authoritative",
    surface: "vendors-list",
  },
  {
    channel: "browser",
    description: "the vendor list as the browser shows it — no browser capture ships for this atlas yet",
    kind: "vendor",
    role: "corroborating",
    surface: "vendors-collection",
  },
  ...VANTA_CENSUS_FAMILY_LIST.map((family): VantaRequiredSurface => ({
    channel: "manage-api",
    description: family.description,
    kind: family.kind,
    role: "authoritative",
    surface: family.surface,
  })),
  // Every fan-out surface, one row each. A family with two surfaces contributes two, which is the point:
  // `/controls/{controlId}/documents` and `/documents/{documentId}/controls` are separate operations in
  // Vanta's own document, so a run that made one of them is not a run that made both.
  ...VANTA_CHILD_FAMILY_LIST.flatMap((family) =>
    family.surfaces.map((surface): VantaRequiredSurface => ({
      channel: "manage-api",
      description: family.description,
      kind: family.kind,
      role: "authoritative",
      surface: surface.surface,
    })),
  ),
  {
    channel: "manage-api",
    description: "every event kind the log holds, and the attributes each carries — shapes, never events",
    kind: "event-shape",
    role: "authoritative",
    surface: VANTA_EVENT_LOGS_SURFACE,
  },
];

/**
 * A closed list of the required surfaces for one kind.
 *
 * @param kind the kind to look up
 * @returns every surface this atlas requires for that kind
 */
export function vantaRequiredSurfacesForKind({ kind }: { kind: VantaKind }): readonly VantaRequiredSurface[] {
  return VANTA_REQUIRED_SURFACES.filter((entry) => entry.kind === kind);
}

/**
 * What this atlas does NOT hold from the Manage API, and the measured reason for each — so an absence is a
 * declared fact rather than something a reader has to notice. Reproduce every line below by issuing the
 * named GET through `transport.ts`; nothing here is copied from documentation.
 *
 * `vulnerabilities` is deliberately absent from this list: the census now stores them, and
 * `slopweaver atlas vanta vulnerabilities` still reads them live and filtered on top.
 */
export const VANTA_OUT_OF_SCOPE_GROUPS: readonly string[] = [
  "audits — GET /v1/audits answers HTTP 403 on this credential: audits belong to the Auditor API, the audit firm's own surface, not this account's. Owed to the browser channel",
  "contracts — GET /v1/contracts answers HTTP 403 on this credential, which is an entitlement boundary rather than a role one: a client-credentials token carries no human's role, so no role change could open it. Owed to the browser channel",
  "trust centres — 30 documented GET operations this atlas cannot address, every one keyed by a Trust Center slug no documented GET returns. The claim this line replaced lumped customer trust in with them and said all 40 answer HTTP 404 with no Manage API surface at all; that was established from five GUESSED paths and was wrong twice over. Customer trust is now WALKED: /v1/customer-trust/accounts, /v1/customer-trust/questionnaires, /v1/customer-trust/questionnaires/assignable-users and /v1/customer-trust/tag-categories are census families, an authoritative zero among them counted as an answer. See generated/getEndpoints.ts for the exact rows",
  "individual event-log entries — indexed by SHAPE instead, one entity per event kind. See eventShapes.ts for the ruling",
  "the remaining 39 documented GET operations, enumerated one row at a time in generated/getEndpoints.ts with a disposition each. The claim this line replaced said `GET /v1/remediations` answers HTTP 404 and concluded there is no such route; the route is `/v1/vulnerability-remediations`, it answers HTTP 200 with this organisation's own remediations, and it is a census family. A guessed path that 404s establishes nothing about a surface, which is why this atlas now divides by Vanta's own published document rather than by what anyone thought to try",
];

/**
 * Every path template the Manage API sync actually calls, written in the PUBLISHED DOCUMENT's own shape —
 * relative to the `https://api.vanta.com/v1` server, so with no `/v1` prefix and with `{brace}` parameters
 * where {@link VANTA_MANAGE_ENDPOINTS} and the path builders above interpolate a real id.
 *
 * This is the NUMERATOR, and it is spelled separately from the endpoints above for one reason: those are
 * assembled — some from `VANTA_CENSUS_FAMILY_LIST`, some by a builder that takes an id — so nothing can
 * read a template out of them. `unit/atlas/vanta/endpointDenominator.test.ts` asserts every literal path in
 * `VANTA_MANAGE_ENDPOINTS` appears here with its `/v1` removed, so the two cannot drift apart silently.
 *
 * The DENOMINATOR is `generated/specLock.ts`'s pinned document. Dividing one by the other is what
 * `generated/getEndpoints.ts` holds and what `slopweaver atlas vanta coverage` prints.
 */
export const VANTA_SYNCED_SPEC_PATHS: readonly string[] = [
  "/controls",
  "/controls/controls-library",
  "/controls/deactivated-controls",
  "/controls/{controlId}",
  "/controls/{controlId}/documents",
  "/controls/{controlId}/tests",
  "/customer-trust/accounts",
  "/customer-trust/questionnaires",
  "/customer-trust/questionnaires/assignable-users",
  "/customer-trust/tag-categories",
  "/discovered-vendors",
  "/discovered-vendors/{discoveredVendorId}/accounts",
  "/documents",
  "/documents/{documentId}/controls",
  "/documents/{documentId}/links",
  "/documents/{documentId}/uploads",
  "/event-logs",
  "/frameworks",
  "/frameworks/{frameworkId}/controls",
  "/groups",
  "/groups/{groupId}/people",
  "/groups/importable-idp-groups",
  "/integrations",
  "/integrations/{integrationId}/resource-kinds",
  "/integrations/{integrationId}/resource-kinds/{resourceKind}/resources",
  "/issues",
  "/knowledge-base/answer-library",
  "/knowledge-base/resources",
  "/monitored-computers",
  "/people",
  "/policies",
  "/risk-scenarios",
  "/risk-scenarios/{riskScenarioId}/controls",
  "/tests",
  "/tests/{testId}/entities",
  "/users",
  "/vendor-assessment-types",
  "/vendor-risk-attributes",
  "/vendors",
  "/vendors/{vendorId}/assessments",
  "/vendors/{vendorId}/documents",
  "/vendors/{vendorId}/security-reviews",
  "/vulnerabilities",
  "/vulnerabilities/{vulnerabilityId}",
  "/vulnerability-remediations",
  "/vulnerable-assets",
];
