/**
 * The closed Vanta Manage API client: the seven collection reads used by atlas sync, the framework,
 * control-test and bounded entity reads used for live control evidence, the status-filtered entity walk
 * used by `slopweaver atlas vanta test-entities`, and the filtered vulnerability walk and detail read used
 * by `slopweaver atlas vanta vulnerabilities`.
 *
 * `inventory.ts`'s `VANTA_MANAGE_ENDPOINTS` is the single source of truth for each surface's path and
 * fixed query params or path builders; this file assembles the client from `surfaceWalk.ts`'s one-surface
 * walk, which hands exhaustive collection walks to `pagination.ts`. No endpoint path is redeclared here.
 */
import { type Boundary, defineBoundary } from "#lib/boundary.js";
import { err, ok, type Result } from "../../lib/result.js";
import {
  type VantaControlDto,
  type VantaDocumentDto,
  type VantaPolicyDto,
  type VantaVendorDto,
  vantaControlsPageSchema,
  vantaDocumentsPageSchema,
  vantaPageEnvelopeSchema,
  vantaPoliciesPageSchema,
  vantaVendorsPageSchema,
} from "./apiSchemas.js";
import { VANTA_CENSUS_FAMILY_LIST, type VantaCensusDto, type VantaCensusFamily } from "./census.js";
import { type VantaEventLogDto, vantaEventLogDtoSchema } from "./censusApiSchemas.js";
import { VANTA_CHILD_SURFACE_LIST } from "./childCensus.js";
import { type VantaChildDto, vantaChildEndpoint } from "./childSurface.js";
import {
  type VantaControlDetailDto,
  type VantaControlTestDto,
  type VantaFrameworkDto,
  type VantaTestEntityDto,
  type VantaTestEntityStatus,
  vantaControlDetailDtoSchema,
  vantaControlTestsPageSchema,
  vantaFrameworksPageSchema,
  vantaTestEntitiesPageSchema,
} from "./controlEvidenceApiSchemas.js";
import { isVantaHttpError, VantaHttpErrors, vantaHttpErrorLines, vantaTransportFailureLines } from "./httpErrors.js";
import {
  VANTA_EVENT_LOGS_SURFACE,
  type VantaManageEndpoint,
  type VantaVulnerabilityFilters,
  vantaCensusEndpoint,
  vantaControlDetailEndpoint,
  vantaControlTestsEndpoint,
  vantaFrameworksEndpoint,
  vantaManageEndpointFor,
  vantaTestEntitiesEndpoint,
  vantaVulnerabilitiesEndpoint,
  vantaVulnerabilityDetailEndpoint,
} from "./inventory.js";
import { type VantaLibraryControlDto, vantaLibraryControlDtoSchema } from "./libraryControlApiSchemas.js";
import type { VantaTokenProvider } from "./oauth.js";
import { noteIfUnauthorized } from "./oauth.js";
import { vantaPagedBoundary } from "./pageBoundary.js";
import { type VantaKnowledgeBaseResourceDto, vantaKnowledgeBaseResourceDtoSchema } from "./policyDocumentApiSchemas.js";
import { type VantaRiskScenarioDto, vantaRiskScenariosPageSchema } from "./riskApiSchemas.js";
import { type VantaSurfaceError, VantaSurfaceErrors } from "./surfaceErrors.js";
import { fetchVantaPage, pageQuery, singleSurfaceLister, type VantaSurfaceRefusal } from "./surfaceWalk.js";
import { redactTokensInErrors, withTokensRedacted } from "./tokenRedaction.js";
import type { VantaTransport } from "./transport.js";
import {
  type VantaVulnerabilityDto,
  vantaVulnerabilitiesPageSchema,
  vantaVulnerabilityDtoSchema,
} from "./vulnerabilityApiSchemas.js";

/**
 * The seven original collection reads, plus the census walk and the event-log walk the sync also runs. Each
 * fails with a {@link VantaSurfaceError}: graded from the failure's typed code before it was rendered, so
 * the sync opens its gap from the code and never from the sentence.
 */
export interface VantaAtlasSyncClient {
  /**
   * Walk one census family exhaustively. Keyed by surface rather than one method per family, because the
   * families are declared as data in `census.ts` — a method per row would be the same code twelve times.
   */
  listCensusFamily: (input: { surface: string }) => Promise<Result<readonly VantaCensusDto[], VantaSurfaceError>>;
  /** Walk the whole event log. Its rows are indexed by shape and never stored — see `eventShapes.ts`. */
  listEventLog: () => Promise<Result<readonly VantaEventLogDto[], VantaSurfaceError>>;
  listControlsActive: () => Promise<Result<readonly VantaControlDto[], VantaSurfaceError>>;
  listControlsDeactivated: () => Promise<Result<readonly VantaLibraryControlDto[], VantaSurfaceError>>;
  listRisksRiskScenario: () => Promise<Result<readonly VantaRiskScenarioDto[], VantaSurfaceError>>;
  listRisksEnterpriseRisk: () => Promise<Result<readonly VantaRiskScenarioDto[], VantaSurfaceError>>;
  listPolicies: () => Promise<Result<readonly VantaPolicyDto[], VantaSurfaceError>>;
  listEvidenceDocuments: () => Promise<Result<readonly VantaDocumentDto[], VantaSurfaceError>>;
  /** Every knowledge-base resource — this organisation's own policy documents. See `policyDocuments.ts`. */
  listKnowledgeBaseResources: () => Promise<Result<readonly VantaKnowledgeBaseResourceDto[], VantaSurfaceError>>;
  listVendors: () => Promise<Result<readonly VantaVendorDto[], VantaSurfaceError>>;
  /**
   * Walk one child surface for ONE parent row. Keyed by surface and parent id rather than one method per
   * family, for the same reason `listCensusFamily` is — `childCensus.ts` declares them as data.
   */
  listChildSurface: (input: {
    surface: string;
    parentId: string;
  }) => Promise<Result<VantaChildAnswer, VantaSurfaceError>>;
}

/** Live reads used to explain one control without relying on the stored atlas. */
interface VantaControlEvidenceClient {
  listFrameworks: () => Promise<Result<readonly VantaFrameworkDto[]>>;
  getControl: (input: { controlId: string }) => Promise<Result<VantaControlDetailDto>>;
  listControlTests: (input: { controlId: string }) => Promise<Result<readonly VantaControlTestDto[]>>;
  getTestEntitySample: (input: { testId: string; limit: number }) => Promise<Result<VantaTestEntitySample>>;
}

interface VantaTestEntitySample {
  readonly entities: readonly VantaTestEntityDto[];
  readonly hasMore: boolean;
}

/**
 * The exhaustive entity walk for one test, filtered by `entityStatus` — what `slopweaver atlas vanta
 * test-entities` reads. Separate from the bounded sample above, which exists to explain one control.
 *
 * @internal
 */
export interface VantaTestEntityClient {
  listTestEntities: (input: {
    testId: string;
    entityStatus: VantaTestEntityStatus;
  }) => Promise<Result<readonly VantaTestEntityDto[]>>;
}

/**
 * Live vulnerability reads. Deliberately NOT part of {@link VantaAtlasSyncClient}: nothing here is ever
 * published into a stored generation, because a finding's whole value is that it is current — see
 * `vulnerabilityApiSchemas.ts`'s header.
 *
 * @internal
 */
export interface VantaVulnerabilityClient {
  listVulnerabilities: (input: {
    filters: VantaVulnerabilityFilters;
  }) => Promise<Result<readonly VantaVulnerabilityDto[]>>;
  getVulnerability: (input: { vulnerabilityId: string }) => Promise<Result<VantaVulnerabilityDto>>;
}

export interface VantaManageClient
  extends VantaAtlasSyncClient, VantaControlEvidenceClient, VantaTestEntityClient, VantaVulnerabilityClient {}

/** A sync-facing read for a LIVE caller, which prints its failure and grades nothing: the lines alone. */
async function asLines<TValue>({
  read,
}: {
  read: Promise<Result<TValue, VantaSurfaceError>>;
}): Promise<Result<TValue>> {
  return (await read).mapErr((error) => error.reasons);
}

/**
 * Every read this client declares beyond the census and child tables, one strict boundary per endpoint, named
 * by the method and the document's own path template. A field Vanta adds, drops or renames on any of them
 * refuses that read by name instead of passing through.
 *
 * @internal
 */
export const VANTA_CLIENT_BOUNDARIES = {
  controlDetail: defineBoundary({ endpoint: "GET /v1/controls/{controlId}", schema: vantaControlDetailDtoSchema }),
  controlTests: vantaPagedBoundary({
    endpoint: "GET /v1/controls/{controlId}/tests",
    pageSchema: vantaControlTestsPageSchema,
  }),
  controls: vantaPagedBoundary({ endpoint: "GET /v1/controls", pageSchema: vantaControlsPageSchema }),
  // The document answers this one in `DeactivatedControl` — the library row, `frameworks` and
  // `deactivationReason` included — not the `/controls` row: `jq '.paths["/controls/deactivated-controls"]'`.
  controlsDeactivated: vantaPagedBoundary({
    endpoint: "GET /v1/controls/deactivated-controls",
    pageSchema: vantaPageEnvelopeSchema({ dataSchema: vantaLibraryControlDtoSchema }),
  }),
  documents: vantaPagedBoundary({ endpoint: "GET /v1/documents", pageSchema: vantaDocumentsPageSchema }),
  eventLogs: vantaPagedBoundary({
    endpoint: "GET /v1/event-logs",
    pageSchema: vantaPageEnvelopeSchema({ dataSchema: vantaEventLogDtoSchema }),
  }),
  frameworks: vantaPagedBoundary({ endpoint: "GET /v1/frameworks", pageSchema: vantaFrameworksPageSchema }),
  knowledgeBaseResources: vantaPagedBoundary({
    endpoint: "GET /v1/knowledge-base/resources",
    pageSchema: vantaPageEnvelopeSchema({ dataSchema: vantaKnowledgeBaseResourceDtoSchema }),
  }),
  policies: vantaPagedBoundary({ endpoint: "GET /v1/policies", pageSchema: vantaPoliciesPageSchema }),
  riskScenarios: vantaPagedBoundary({ endpoint: "GET /v1/risk-scenarios", pageSchema: vantaRiskScenariosPageSchema }),
  testEntities: vantaPagedBoundary({
    endpoint: "GET /v1/tests/{testId}/entities",
    pageSchema: vantaTestEntitiesPageSchema,
  }),
  vendors: vantaPagedBoundary({ endpoint: "GET /v1/vendors", pageSchema: vantaVendorsPageSchema }),
  vulnerabilities: vantaPagedBoundary({
    endpoint: "GET /v1/vulnerabilities",
    pageSchema: vantaVulnerabilitiesPageSchema,
  }),
  vulnerabilityDetail: defineBoundary({
    endpoint: "GET /v1/vulnerabilities/{vulnerabilityId}",
    schema: vantaVulnerabilityDtoSchema,
  }),
} as const;

async function fetchVantaObject<TValue>({
  surface,
  endpoint,
  tokenProvider,
  transport,
  boundary,
}: {
  surface: string;
  endpoint: VantaManageEndpoint;
  tokenProvider: VantaTokenProvider;
  transport: VantaTransport;
  boundary: Boundary<TValue>;
}): Promise<Result<TValue>> {
  const token = await tokenProvider.getToken();
  if (token.isErr()) {
    return err(vantaTransportFailureLines({ error: token.error }));
  }
  const response = await transport.request({
    headers: { authorization: `Bearer ${token.value}` },
    method: endpoint.method,
    path: endpoint.path,
  });
  if (response.isErr()) {
    return withTokensRedacted({
      result: err(noteIfUnauthorized({ error: response.error })),
      usedTokens: new Set([token.value]),
    });
  }
  const parsed = boundary.parseJson({ text: response.value.body });
  if (parsed.isErr()) {
    return err(
      vantaHttpErrorLines({ error: VantaHttpErrors.objectUnreadable({ boundaryError: parsed.error, surface }) }),
    );
  }
  return ok(parsed.value);
}

async function fetchTestEntitySample({
  testId,
  limit,
  tokenProvider,
  transport,
}: {
  testId: string;
  limit: number;
  tokenProvider: VantaTokenProvider;
  transport: VantaTransport;
}): Promise<Result<VantaTestEntitySample>> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    return err(vantaHttpErrorLines({ error: VantaHttpErrors.sampleLimitInvalid({ limit }) }));
  }
  const endpoint = vantaTestEntitiesEndpoint({ entityStatus: null, testId });
  const token = await tokenProvider.getToken();
  if (token.isErr()) {
    return err(vantaTransportFailureLines({ error: token.error }));
  }
  const page = await fetchVantaPage({
    cursor: null,
    endpoint: { ...endpoint, fixedQuery: { pageSize: String(limit) } },
    pageBoundary: VANTA_CLIENT_BOUNDARIES.testEntities,
    surface: "test-entities",
    token: token.value,
    transport,
  });
  if (page.isErr()) {
    return err(
      redactTokensInErrors({
        errors: vantaTransportFailureLines({ error: page.error }),
        usedTokens: new Set([token.value]),
      }),
    );
  }
  return ok({ entities: page.value.items, hasMore: page.value.pageInfo.hasNextPage });
}

type Bound = { tokenProvider: VantaTokenProvider; transport: VantaTransport };

/** The census walk plus the event-log walk, both driven from `census.ts`'s table rather than hand-listed. */
function buildCensusListers({
  tokenProvider,
  transport,
}: Bound): Pick<VantaManageClient, "listCensusFamily" | "listEventLog"> {
  const listerFor = ({
    family,
  }: {
    family: VantaCensusFamily;
  }): (() => Promise<Result<readonly VantaCensusDto[], VantaSurfaceError>>) =>
    singleSurfaceLister<VantaCensusDto>({
      endpoint: vantaCensusEndpoint({ family }),
      pageBoundary: family.pageBoundary,
      providerId: family.providerId,
      surface: family.surface,
      tokenProvider,
      transport,
    });
  return {
    listCensusFamily: ({ surface }) => {
      const family = VANTA_CENSUS_FAMILY_LIST.find((candidate) => candidate.surface === surface);
      if (family === undefined) {
        const failure = VantaHttpErrors.notCensusFamily({ surface });
        return Promise.resolve(
          err(VantaSurfaceErrors.fromTransportFailure({ failure, reasons: vantaHttpErrorLines({ error: failure }) })),
        );
      }
      return listerFor({ family })();
    },
    listEventLog: singleSurfaceLister<VantaEventLogDto>({
      endpoint: vantaManageEndpointFor({ surface: VANTA_EVENT_LOGS_SURFACE }),
      pageBoundary: VANTA_CLIENT_BOUNDARIES.eventLogs,
      providerId: (item) => item.id,
      surface: VANTA_EVENT_LOGS_SURFACE,
      tokenProvider,
      transport,
    }),
  };
}

/** What one child surface answered for one parent: its rows, or the provider's own bound on that parent. */
export type VantaChildAnswer =
  | { readonly boundedByProvider: false; readonly rows: readonly VantaChildDto[] }
  | { readonly boundedByProvider: true; readonly because: string };

/**
 * The reason a child walk's refusal is this parent's declared ceiling, or `null` when it is not one.
 *
 * A bound is the provider answering this parent's FIRST page with the declared status — read from the typed
 * failure's `code`, `status` and `safePath`, never from its sentence. Typed, a body-read fault, a token
 * failure or a dead-host refusal is a different code or the printed-only arm, so none can pass for one.
 * `requestsSent === 1` keeps a status on a LATER page (after rows were already read) from being taken for a
 * bound and dropping those rows. The path must be THIS parent's first page: the transport strips the token it
 * sent out of `safePath`, so the request path is redacted the same way before the two are compared — a token
 * equal to a path segment cannot hide a real bound — and the bound's reason goes through the same redaction,
 * so it cannot reintroduce a token the walk presented.
 */
function ceilingBoundReason({
  ceiling,
  firstPage,
  refusal,
}: {
  ceiling: { readonly status: number } | null;
  firstPage: string;
  refusal: VantaSurfaceRefusal;
}): string | null {
  const { failure, requestsSent, usedTokens } = refusal;
  if (
    ceiling === null ||
    requestsSent !== 1 ||
    !isVantaHttpError(failure) ||
    failure.code !== "HTTP_STATUS" ||
    failure.status !== ceiling.status
  ) {
    return null;
  }
  // The whole reason is redacted, not only its path: a token could equal the status suffix too.
  const [askedFor, reason] = redactTokensInErrors({
    errors: [firstPage, `${firstPage} returned HTTP ${String(ceiling.status)}`],
    usedTokens,
  });
  if (failure.safePath === askedFor && reason !== undefined) {
    return reason;
  }
  return null;
}

/**
 * The child walk, driven from `childCensus.ts`'s table.
 *
 * One surface plus one parent id is one endpoint, so this reuses `singleSurfaceLister` unchanged rather
 * than introducing a second pagination path. The provider id it deduplicates within a walk is the CHILD's
 * own, which is correct here because one walk is one parent — a child id repeated across two different
 * parents is a legitimate pairing, and `syncChildren.ts` is what keys the entity by both.
 */
function buildChildLister({ tokenProvider, transport }: Bound): Pick<VantaManageClient, "listChildSurface"> {
  return {
    listChildSurface: async ({ surface, parentId }) => {
      const child = VANTA_CHILD_SURFACE_LIST.find((candidate) => candidate.surface === surface);
      if (child === undefined) {
        const failure = VantaHttpErrors.notChildSurface({ surface });
        return err(
          VantaSurfaceErrors.fromTransportFailure({ failure, reasons: vantaHttpErrorLines({ error: failure }) }),
        );
      }
      const built = vantaChildEndpoint({ parentId, specPath: child.specPath });
      if (built.isErr()) {
        return err(VantaSurfaceErrors.detailUnreadable({ reasons: built.error }));
      }
      const endpoint = built.value;
      const firstPage = pageQuery({ cursor: null, endpoint });
      // Collected rather than assigned to a boolean: the compiler cannot see that a callback ran, and it
      // narrows a `let` the callback is the only writer of to its initial value.
      const boundedBy: string[] = [];
      const walked = await singleSurfaceLister<VantaChildDto>({
        endpoint,
        onRefusal: (refusal) => {
          const reason = ceilingBoundReason({ ceiling: child.parentCeiling, firstPage, refusal });
          if (reason !== null) {
            boundedBy.push(reason);
          }
        },
        pageBoundary: child.pageBoundary,
        providerId: child.childId,
        surface: child.surface,
        tokenProvider,
        transport,
      })();
      if (walked.isOk()) {
        const answered: VantaChildAnswer = { boundedByProvider: false, rows: walked.value };
        return ok(answered);
      }
      const because = boundedBy[0];
      if (because !== undefined) {
        return ok({ because, boundedByProvider: true } satisfies VantaChildAnswer);
      }
      return err(walked.error);
    },
  };
}

/** The listers keyed by a fixed surface name, none of which need a caller-supplied id. */
function buildFixedSurfaceListers({
  tokenProvider,
  transport,
}: Bound): Pick<
  VantaManageClient,
  "listEvidenceDocuments" | "listFrameworks" | "listKnowledgeBaseResources" | "listPolicies" | "listVendors"
> {
  return {
    listEvidenceDocuments: singleSurfaceLister<VantaDocumentDto>({
      endpoint: vantaManageEndpointFor({ surface: "evidence-documents" }),
      pageBoundary: VANTA_CLIENT_BOUNDARIES.documents,
      providerId: (item) => item.id,
      surface: "evidence-documents",
      tokenProvider,
      transport,
    }),
    listFrameworks: () =>
      asLines({
        read: singleSurfaceLister<VantaFrameworkDto>({
          endpoint: vantaFrameworksEndpoint(),
          pageBoundary: VANTA_CLIENT_BOUNDARIES.frameworks,
          providerId: (item) => item.id,
          surface: "frameworks-list",
          tokenProvider,
          transport,
        })(),
      }),
    listKnowledgeBaseResources: singleSurfaceLister<VantaKnowledgeBaseResourceDto>({
      endpoint: vantaManageEndpointFor({ surface: "knowledge-base-resources" }),
      pageBoundary: VANTA_CLIENT_BOUNDARIES.knowledgeBaseResources,
      providerId: (item) => item.id,
      surface: "knowledge-base-resources",
      tokenProvider,
      transport,
    }),
    listPolicies: singleSurfaceLister<VantaPolicyDto>({
      endpoint: vantaManageEndpointFor({ surface: "policies-list" }),
      pageBoundary: VANTA_CLIENT_BOUNDARIES.policies,
      providerId: (item) => item.id,
      surface: "policies-list",
      tokenProvider,
      transport,
    }),
    listVendors: singleSurfaceLister<VantaVendorDto>({
      endpoint: vantaManageEndpointFor({ surface: "vendors-list" }),
      pageBoundary: VANTA_CLIENT_BOUNDARIES.vendors,
      providerId: (item) => item.id,
      surface: "vendors-list",
      tokenProvider,
      transport,
    }),
  };
}

/** The control-kind listers, split active/deactivated and the per-control test walk. */
function buildControlListers({
  tokenProvider,
  transport,
}: Bound): Pick<VantaManageClient, "listControlsActive" | "listControlsDeactivated" | "listControlTests"> {
  return {
    listControlTests: ({ controlId }) =>
      asLines({
        read: singleSurfaceLister<VantaControlTestDto>({
          endpoint: vantaControlTestsEndpoint({ controlId }),
          pageBoundary: VANTA_CLIENT_BOUNDARIES.controlTests,
          providerId: (item) => item.id,
          surface: "control-tests",
          tokenProvider,
          transport,
        })(),
      }),
    listControlsActive: () =>
      singleSurfaceLister<VantaControlDto>({
        endpoint: vantaManageEndpointFor({ surface: "controls-active" }),
        pageBoundary: VANTA_CLIENT_BOUNDARIES.controls,
        providerId: (item) => item.id,
        surface: "controls-active",
        tokenProvider,
        transport,
      })(),
    // Its own row type: the document answers this surface in `DeactivatedControl`, not the `/controls` row.
    listControlsDeactivated: () =>
      singleSurfaceLister<VantaLibraryControlDto>({
        endpoint: vantaManageEndpointFor({ surface: "controls-deactivated" }),
        pageBoundary: VANTA_CLIENT_BOUNDARIES.controlsDeactivated,
        providerId: (item) => item.id,
        surface: "controls-deactivated",
        tokenProvider,
        transport,
      })(),
  };
}

/** The risk-kind listers, split risk-scenario/enterprise-risk. */
function buildRiskListers({
  tokenProvider,
  transport,
}: Bound): Pick<VantaManageClient, "listRisksRiskScenario" | "listRisksEnterpriseRisk"> {
  const listRisks = ({ surface }: { surface: "risks-risk-scenario" | "risks-enterprise-risk" }) =>
    singleSurfaceLister<VantaRiskScenarioDto>({
      endpoint: vantaManageEndpointFor({ surface }),
      pageBoundary: VANTA_CLIENT_BOUNDARIES.riskScenarios,
      providerId: (item) => item.riskId,
      surface,
      tokenProvider,
      transport,
    })();
  return {
    listRisksEnterpriseRisk: () => listRisks({ surface: "risks-enterprise-risk" }),
    listRisksRiskScenario: () => listRisks({ surface: "risks-risk-scenario" }),
  };
}

/** The live vulnerability readers — a filtered collection walk and one bounded detail read. */
function buildVulnerabilityReaders({ tokenProvider, transport }: Bound): VantaVulnerabilityClient {
  return {
    getVulnerability: ({ vulnerabilityId }) =>
      fetchVantaObject({
        endpoint: vantaVulnerabilityDetailEndpoint({ vulnerabilityId }),
        boundary: VANTA_CLIENT_BOUNDARIES.vulnerabilityDetail,
        surface: "vulnerability-detail",
        tokenProvider,
        transport,
      }),
    listVulnerabilities: ({ filters }) =>
      asLines({
        read: singleSurfaceLister<VantaVulnerabilityDto>({
          endpoint: vantaVulnerabilitiesEndpoint({ filters }),
          pageBoundary: VANTA_CLIENT_BOUNDARIES.vulnerabilities,
          providerId: (item) => item.id,
          surface: "vulnerabilities-list",
          tokenProvider,
          transport,
        })(),
      }),
  };
}

/**
 * Build the client.
 *
 * @param tokenProvider mints/reuses the bearer token for every request
 * @param transport the bound Vanta transport
 * @returns the client
 */
export function createVantaManageClient({ tokenProvider, transport }: Bound): VantaManageClient {
  return {
    ...buildFixedSurfaceListers({ tokenProvider, transport }),
    ...buildCensusListers({ tokenProvider, transport }),
    ...buildChildLister({ tokenProvider, transport }),
    ...buildControlListers({ tokenProvider, transport }),
    ...buildRiskListers({ tokenProvider, transport }),
    ...buildVulnerabilityReaders({ tokenProvider, transport }),
    getControl: ({ controlId }) =>
      fetchVantaObject({
        endpoint: vantaControlDetailEndpoint({ controlId }),
        boundary: VANTA_CLIENT_BOUNDARIES.controlDetail,
        surface: "control-detail",
        tokenProvider,
        transport,
      }),
    getTestEntitySample: ({ testId, limit }) => fetchTestEntitySample({ limit, testId, tokenProvider, transport }),
    listTestEntities: ({ testId, entityStatus }) =>
      asLines({
        read: singleSurfaceLister<VantaTestEntityDto>({
          endpoint: vantaTestEntitiesEndpoint({ entityStatus, testId }),
          pageBoundary: VANTA_CLIENT_BOUNDARIES.testEntities,
          providerId: (item) => item.id,
          surface: "test-entities",
          tokenProvider,
          transport,
        })(),
      }),
  };
}
