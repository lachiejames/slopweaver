/**
 * The Vendors tag's eighteen net-new methods. Endpoint shapes are built from Vanta's own OpenAPI spec.
 * `ListVendors` (`GET /v1/vendors`) is deliberately NOT here — it already has read coverage in `client.ts`.
 *
 * `SetStatusForVendor` is the one surprising shape: Vanta sends this as `multipart/form-data` (a single
 * `status` field), not JSON, unlike every other vendor mutation here.
 *
 * Every method that reads JSON back reads it through its endpoint's strict boundary in
 * {@link VANTA_VENDORS_OPERATION_BOUNDARIES} (`vendorsBoundaries.ts`), declared once at load.
 */
import type { Result } from "../../../../lib/result.js";
import type { VantaTokenProvider } from "../../oauth.js";
import type { VantaTransport } from "../../transport.js";
import type { VantaSdkError } from "../errors.js";
import { requestJson, requestNoContent } from "../httpBoundary.js";
import type {
  VantaCreateVendorFindingInput,
  VantaCreateVendorInput,
  VantaListVendorAssessmentsInput,
  VantaListVendorFindingsInput,
  VantaSecurityReviewDto,
  VantaSecurityReviewsPage,
  VantaSetStatusForVendorInput,
  VantaUpdateVendorFindingInput,
  VantaUpdateVendorInput,
  VantaUploadVendorDocumentInput,
  VantaVendorAssessmentDto,
  VantaVendorAssessmentsPage,
  VantaVendorDocumentDto,
  VantaVendorDocumentsPage,
  VantaVendorDto,
  VantaVendorFindingDto,
  VantaVendorFindingsPage,
} from "../schemas/vendors.js";
import { VANTA_VENDORS_OPERATION_BOUNDARIES } from "./vendorsBoundaries.js";

type Bound = { tokenProvider: VantaTokenProvider; transport: VantaTransport };

function vendorsPath(): string {
  return "/v1/vendors";
}

function vendorPath({ vendorId }: { vendorId: string }): string {
  return `/v1/vendors/${encodeURIComponent(vendorId)}`;
}

function vendorAssessmentsPath({ vendorId }: { vendorId: string }): string {
  return `/v1/vendors/${encodeURIComponent(vendorId)}/assessments`;
}

function vendorAssessmentPath({ vendorId, assessmentId }: { vendorId: string; assessmentId: string }): string {
  return `/v1/vendors/${encodeURIComponent(vendorId)}/assessments/${encodeURIComponent(assessmentId)}`;
}

function vendorDocumentsPath({ vendorId }: { vendorId: string }): string {
  return `/v1/vendors/${encodeURIComponent(vendorId)}/documents`;
}

function vendorFindingsPath({ vendorId }: { vendorId: string }): string {
  return `/v1/vendors/${encodeURIComponent(vendorId)}/findings`;
}

function vendorFindingPath({ vendorId, findingId }: { vendorId: string; findingId: string }): string {
  return `/v1/vendors/${encodeURIComponent(vendorId)}/findings/${encodeURIComponent(findingId)}`;
}

function vendorSecurityReviewsPath({ vendorId }: { vendorId: string }): string {
  return `/v1/vendors/${encodeURIComponent(vendorId)}/security-reviews`;
}

function vendorSecurityReviewPath({
  vendorId,
  securityReviewId,
}: {
  vendorId: string;
  securityReviewId: string;
}): string {
  return `/v1/vendors/${encodeURIComponent(vendorId)}/security-reviews/${encodeURIComponent(securityReviewId)}`;
}

function vendorSecurityReviewDocumentsPath({
  vendorId,
  securityReviewId,
}: {
  vendorId: string;
  securityReviewId: string;
}): string {
  return `/v1/vendors/${encodeURIComponent(vendorId)}/security-reviews/${encodeURIComponent(securityReviewId)}/documents`;
}

function vendorSecurityReviewDocumentPath({
  vendorId,
  securityReviewId,
  documentId,
}: {
  vendorId: string;
  securityReviewId: string;
  documentId: string;
}): string {
  return `/v1/vendors/${encodeURIComponent(vendorId)}/security-reviews/${encodeURIComponent(securityReviewId)}/documents/${encodeURIComponent(documentId)}`;
}

function vendorSetStatusPath({ vendorId }: { vendorId: string }): string {
  return `/v1/vendors/${encodeURIComponent(vendorId)}/set-status`;
}

/** The optional cursor-pagination params every list read sends, omitting any left undefined. */
function pageParams({
  pageSize,
  pageCursor,
}: {
  pageSize: number | undefined;
  pageCursor: string | undefined;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (pageSize !== undefined) {
    params.set("pageSize", String(pageSize));
  }
  if (pageCursor !== undefined) {
    params.set("pageCursor", pageCursor);
  }
  return params;
}

/** A path with its query string, or the bare path when no param was set. */
function withQuery({ path, params }: { path: string; params: URLSearchParams }): string {
  const query = params.toString();
  return query === "" ? path : `${path}?${query}`;
}

/** Build a query string from optional cursor-pagination params, omitting any left undefined. */
function withPageQuery({ path, ...page }: { path: string } & Parameters<typeof pageParams>[0]): string {
  return withQuery({ params: pageParams(page), path });
}

/**
 * Build `GET /v1/vendors/{vendorId}/assessments`'s query string, repeating a key per array entry. Both
 * filters are declared optional, so a caller that sets neither filters nothing — by design, not a default.
 */
function withVendorAssessmentsQuery({ path, input }: { path: string; input: VantaListVendorAssessmentsInput }): string {
  const params = pageParams({ pageCursor: input.pageCursor, pageSize: input.pageSize });
  if (input.typeIdMatchesAny !== undefined) {
    for (const typeId of input.typeIdMatchesAny) {
      params.append("typeIdMatchesAny", typeId);
    }
  }
  if (input.statusMatchesAny !== undefined) {
    for (const status of input.statusMatchesAny) {
      params.append("statusMatchesAny", status);
    }
  }
  return withQuery({ params, path });
}

/** Build `GET /v1/vendors/{vendorId}/findings`'s query string, omitting any filter left undefined. */
function withVendorFindingsQuery({ path, input }: { path: string; input: VantaListVendorFindingsInput }): string {
  const params = pageParams({ pageCursor: input.pageCursor, pageSize: input.pageSize });
  if (input.securityReviewId !== undefined) {
    params.set("securityReviewId", input.securityReviewId);
  }
  if (input.documentId !== undefined) {
    params.set("documentId", input.documentId);
  }
  return withQuery({ params, path });
}

/** Build the multipart body for uploading a vendor or security-review document. */
function vendorDocumentUploadForm({ file, type, title, description }: VantaUploadVendorDocumentInput): FormData {
  const form = new FormData();
  form.set("file", new Blob([file.content], { type: file.mimeType }), file.name);
  form.set("type", type);
  if (title !== undefined) {
    form.set("title", title);
  }
  if (description !== undefined) {
    form.set("description", description);
  }
  return form;
}

export interface VantaVendorsOperations {
  /** `POST /v1/vendors` — create a vendor. Only `name` is required. */
  createVendor: (input: VantaCreateVendorInput) => Promise<Result<VantaVendorDto, VantaSdkError>>;
  /** `GET /v1/vendors/{vendorId}` — a single vendor by ID. */
  getVendor: (input: { vendorId: string }) => Promise<Result<VantaVendorDto, VantaSdkError>>;
  /** `DELETE /v1/vendors/{vendorId}` — remove a vendor. */
  deleteVendor: (input: { vendorId: string }) => Promise<Result<null, VantaSdkError>>;
  /** `PATCH /v1/vendors/{vendorId}` — update a vendor's metadata. */
  updateVendor: (
    input: { vendorId: string } & VantaUpdateVendorInput,
  ) => Promise<Result<VantaVendorDto, VantaSdkError>>;
  /** `GET /v1/vendors/{vendorId}/assessments` — list a vendor's assessments. */
  listAssessmentsForVendor: (
    input: { vendorId: string } & VantaListVendorAssessmentsInput,
  ) => Promise<Result<VantaVendorAssessmentsPage, VantaSdkError>>;
  /** `GET /v1/vendors/{vendorId}/assessments/{assessmentId}` — a single assessment by ID. */
  getAssessmentForVendor: (input: {
    vendorId: string;
    assessmentId: string;
  }) => Promise<Result<VantaVendorAssessmentDto, VantaSdkError>>;
  /** `GET /v1/vendors/{vendorId}/documents` — list a vendor's uploaded documents. */
  listDocumentsForVendor: (input: {
    vendorId: string;
    pageSize?: number;
    pageCursor?: string;
  }) => Promise<Result<VantaVendorDocumentsPage, VantaSdkError>>;
  /** `POST /v1/vendors/{vendorId}/documents` — upload a document to a vendor. */
  uploadDocumentForVendor: (
    input: { vendorId: string } & VantaUploadVendorDocumentInput,
  ) => Promise<Result<VantaVendorDocumentDto, VantaSdkError>>;
  /** `GET /v1/vendors/{vendorId}/findings` — list a vendor's findings. */
  listFindingsForVendor: (
    input: { vendorId: string } & VantaListVendorFindingsInput,
  ) => Promise<Result<VantaVendorFindingsPage, VantaSdkError>>;
  /** `POST /v1/vendors/{vendorId}/findings` — create a finding for a vendor. */
  createFindingForVendor: (
    input: { vendorId: string } & VantaCreateVendorFindingInput,
  ) => Promise<Result<VantaVendorFindingDto, VantaSdkError>>;
  /** `PATCH /v1/vendors/{vendorId}/findings/{findingId}` — update a vendor finding. */
  updateFindingForVendor: (
    input: { vendorId: string; findingId: string } & VantaUpdateVendorFindingInput,
  ) => Promise<Result<VantaVendorFindingDto, VantaSdkError>>;
  /** `DELETE /v1/vendors/{vendorId}/findings/{findingId}` — remove a vendor finding. */
  deleteFindingForVendor: (input: { vendorId: string; findingId: string }) => Promise<Result<null, VantaSdkError>>;
  /** `GET /v1/vendors/{vendorId}/security-reviews` — list a vendor's security reviews. */
  listSecurityReviewsForVendor: (input: {
    vendorId: string;
    pageSize?: number;
    pageCursor?: string;
  }) => Promise<Result<VantaSecurityReviewsPage, VantaSdkError>>;
  /** `GET /v1/vendors/{vendorId}/security-reviews/{securityReviewId}` — a single security review by ID. */
  getSecurityReviewForVendor: (input: {
    vendorId: string;
    securityReviewId: string;
  }) => Promise<Result<VantaSecurityReviewDto, VantaSdkError>>;
  /** `POST /v1/vendors/{vendorId}/security-reviews/{securityReviewId}/documents` — upload a document to a security review. */
  uploadDocumentForSecurityReview: (
    input: { vendorId: string; securityReviewId: string } & VantaUploadVendorDocumentInput,
  ) => Promise<Result<VantaVendorDocumentDto, VantaSdkError>>;
  /** `GET /v1/vendors/{vendorId}/security-reviews/{securityReviewId}/documents` — list a security review's documents. */
  listDocumentsForSecurityReview: (input: {
    vendorId: string;
    securityReviewId: string;
    pageSize?: number;
    pageCursor?: string;
  }) => Promise<Result<VantaVendorDocumentsPage, VantaSdkError>>;
  /** `DELETE /v1/vendors/{vendorId}/security-reviews/{securityReviewId}/documents/{documentId}` — remove a security review's document. */
  deleteDocumentForSecurityReview: (input: {
    vendorId: string;
    securityReviewId: string;
    documentId: string;
  }) => Promise<Result<null, VantaSdkError>>;
  /** `POST /v1/vendors/{vendorId}/set-status` — set a vendor's status. Sent as `multipart/form-data`. */
  setStatusForVendor: (
    input: { vendorId: string } & VantaSetStatusForVendorInput,
  ) => Promise<Result<VantaVendorDto, VantaSdkError>>;
}

const JSON_HEADERS = { "content-type": "application/json" };

async function createVendor({
  tokenProvider,
  transport,
  ...body
}: VantaCreateVendorInput & Bound): Promise<Result<VantaVendorDto, VantaSdkError>> {
  return requestJson({
    body: JSON.stringify(body),
    boundary: VANTA_VENDORS_OPERATION_BOUNDARIES.createVendor,
    headers: JSON_HEADERS,
    method: "POST",
    operationId: "CreateVendor",
    path: vendorsPath(),
    tokenProvider,
    transport,
  });
}

async function getVendor({
  vendorId,
  tokenProvider,
  transport,
}: { vendorId: string } & Bound): Promise<Result<VantaVendorDto, VantaSdkError>> {
  return requestJson({
    boundary: VANTA_VENDORS_OPERATION_BOUNDARIES.getVendor,
    method: "GET",
    operationId: "GetVendor",
    path: vendorPath({ vendorId }),
    tokenProvider,
    transport,
  });
}

async function deleteVendor({
  vendorId,
  tokenProvider,
  transport,
}: { vendorId: string } & Bound): Promise<Result<null, VantaSdkError>> {
  return requestNoContent({
    method: "DELETE",
    operationId: "DeleteById",
    path: vendorPath({ vendorId }),
    tokenProvider,
    transport,
  });
}

async function updateVendor({
  vendorId,
  tokenProvider,
  transport,
  ...body
}: { vendorId: string } & VantaUpdateVendorInput & Bound): Promise<Result<VantaVendorDto, VantaSdkError>> {
  return requestJson({
    body: JSON.stringify(body),
    boundary: VANTA_VENDORS_OPERATION_BOUNDARIES.updateVendor,
    headers: JSON_HEADERS,
    method: "PATCH",
    operationId: "UpdateVendor",
    path: vendorPath({ vendorId }),
    tokenProvider,
    transport,
  });
}

async function listAssessmentsForVendor({
  vendorId,
  tokenProvider,
  transport,
  ...filters
}: { vendorId: string } & VantaListVendorAssessmentsInput & Bound): Promise<
  Result<VantaVendorAssessmentsPage, VantaSdkError>
> {
  return requestJson({
    boundary: VANTA_VENDORS_OPERATION_BOUNDARIES.listAssessmentsForVendor,
    method: "GET",
    operationId: "GetAssessmentsByVendorId",
    path: withVendorAssessmentsQuery({ input: filters, path: vendorAssessmentsPath({ vendorId }) }),
    tokenProvider,
    transport,
  });
}

async function getAssessmentForVendor({
  vendorId,
  assessmentId,
  tokenProvider,
  transport,
}: { vendorId: string; assessmentId: string } & Bound): Promise<Result<VantaVendorAssessmentDto, VantaSdkError>> {
  return requestJson({
    boundary: VANTA_VENDORS_OPERATION_BOUNDARIES.getAssessmentForVendor,
    method: "GET",
    operationId: "GetAssessmentById",
    path: vendorAssessmentPath({ assessmentId, vendorId }),
    tokenProvider,
    transport,
  });
}

async function listDocumentsForVendor({
  vendorId,
  pageSize,
  pageCursor,
  tokenProvider,
  transport,
}: { vendorId: string; pageSize?: number; pageCursor?: string } & Bound): Promise<
  Result<VantaVendorDocumentsPage, VantaSdkError>
> {
  return requestJson({
    boundary: VANTA_VENDORS_OPERATION_BOUNDARIES.listDocumentsForVendor,
    method: "GET",
    operationId: "ListVendorDocuments",
    path: withPageQuery({ pageCursor, pageSize, path: vendorDocumentsPath({ vendorId }) }),
    tokenProvider,
    transport,
  });
}

async function uploadDocumentForVendor({
  vendorId,
  tokenProvider,
  transport,
  ...input
}: { vendorId: string } & VantaUploadVendorDocumentInput & Bound): Promise<
  Result<VantaVendorDocumentDto, VantaSdkError>
> {
  return requestJson({
    // Deliberately no content-type header: `fetch` computes the multipart boundary itself from the FormData body.
    body: vendorDocumentUploadForm(input),
    boundary: VANTA_VENDORS_OPERATION_BOUNDARIES.uploadDocumentForVendor,
    method: "POST",
    operationId: "UploadDocumentToVendor",
    path: vendorDocumentsPath({ vendorId }),
    tokenProvider,
    transport,
  });
}

async function listFindingsForVendor({
  vendorId,
  tokenProvider,
  transport,
  ...filters
}: { vendorId: string } & VantaListVendorFindingsInput & Bound): Promise<
  Result<VantaVendorFindingsPage, VantaSdkError>
> {
  return requestJson({
    boundary: VANTA_VENDORS_OPERATION_BOUNDARIES.listFindingsForVendor,
    method: "GET",
    operationId: "ListVendorFindings",
    path: withVendorFindingsQuery({ input: filters, path: vendorFindingsPath({ vendorId }) }),
    tokenProvider,
    transport,
  });
}

async function createFindingForVendor({
  vendorId,
  tokenProvider,
  transport,
  ...body
}: { vendorId: string } & VantaCreateVendorFindingInput & Bound): Promise<
  Result<VantaVendorFindingDto, VantaSdkError>
> {
  return requestJson({
    body: JSON.stringify(body),
    boundary: VANTA_VENDORS_OPERATION_BOUNDARIES.createFindingForVendor,
    headers: JSON_HEADERS,
    method: "POST",
    operationId: "CreateVendorFinding",
    path: vendorFindingsPath({ vendorId }),
    tokenProvider,
    transport,
  });
}

async function updateFindingForVendor({
  vendorId,
  findingId,
  tokenProvider,
  transport,
  ...body
}: { vendorId: string; findingId: string } & VantaUpdateVendorFindingInput & Bound): Promise<
  Result<VantaVendorFindingDto, VantaSdkError>
> {
  return requestJson({
    body: JSON.stringify(body),
    boundary: VANTA_VENDORS_OPERATION_BOUNDARIES.updateFindingForVendor,
    headers: JSON_HEADERS,
    method: "PATCH",
    operationId: "UpdateVendorFinding",
    path: vendorFindingPath({ findingId, vendorId }),
    tokenProvider,
    transport,
  });
}

async function deleteFindingForVendor({
  vendorId,
  findingId,
  tokenProvider,
  transport,
}: { vendorId: string; findingId: string } & Bound): Promise<Result<null, VantaSdkError>> {
  return requestNoContent({
    method: "DELETE",
    operationId: "DeleteFindingById",
    path: vendorFindingPath({ findingId, vendorId }),
    tokenProvider,
    transport,
  });
}

async function listSecurityReviewsForVendor({
  vendorId,
  pageSize,
  pageCursor,
  tokenProvider,
  transport,
}: { vendorId: string; pageSize?: number; pageCursor?: string } & Bound): Promise<
  Result<VantaSecurityReviewsPage, VantaSdkError>
> {
  return requestJson({
    boundary: VANTA_VENDORS_OPERATION_BOUNDARIES.listSecurityReviewsForVendor,
    method: "GET",
    operationId: "GetSecurityReviewsByVendorId",
    path: withPageQuery({ pageCursor, pageSize, path: vendorSecurityReviewsPath({ vendorId }) }),
    tokenProvider,
    transport,
  });
}

async function getSecurityReviewForVendor({
  vendorId,
  securityReviewId,
  tokenProvider,
  transport,
}: { vendorId: string; securityReviewId: string } & Bound): Promise<Result<VantaSecurityReviewDto, VantaSdkError>> {
  return requestJson({
    boundary: VANTA_VENDORS_OPERATION_BOUNDARIES.getSecurityReviewForVendor,
    method: "GET",
    operationId: "GetSecurityReviewsById",
    path: vendorSecurityReviewPath({ securityReviewId, vendorId }),
    tokenProvider,
    transport,
  });
}

async function uploadDocumentForSecurityReview({
  vendorId,
  securityReviewId,
  tokenProvider,
  transport,
  ...input
}: { vendorId: string; securityReviewId: string } & VantaUploadVendorDocumentInput & Bound): Promise<
  Result<VantaVendorDocumentDto, VantaSdkError>
> {
  return requestJson({
    body: vendorDocumentUploadForm(input),
    boundary: VANTA_VENDORS_OPERATION_BOUNDARIES.uploadDocumentForSecurityReview,
    method: "POST",
    operationId: "UploadDocumentForSecurityReview",
    path: vendorSecurityReviewDocumentsPath({ securityReviewId, vendorId }),
    tokenProvider,
    transport,
  });
}

async function listDocumentsForSecurityReview({
  vendorId,
  securityReviewId,
  pageSize,
  pageCursor,
  tokenProvider,
  transport,
}: { vendorId: string; securityReviewId: string; pageSize?: number; pageCursor?: string } & Bound): Promise<
  Result<VantaVendorDocumentsPage, VantaSdkError>
> {
  return requestJson({
    boundary: VANTA_VENDORS_OPERATION_BOUNDARIES.listDocumentsForSecurityReview,
    method: "GET",
    operationId: "GetSecurityReviewDocuments",
    path: withPageQuery({
      pageCursor,
      pageSize,
      path: vendorSecurityReviewDocumentsPath({ securityReviewId, vendorId }),
    }),
    tokenProvider,
    transport,
  });
}

async function deleteDocumentForSecurityReview({
  vendorId,
  securityReviewId,
  documentId,
  tokenProvider,
  transport,
}: { vendorId: string; securityReviewId: string; documentId: string } & Bound): Promise<Result<null, VantaSdkError>> {
  return requestNoContent({
    method: "DELETE",
    operationId: "DeleteSecurityReviewDocumentById",
    path: vendorSecurityReviewDocumentPath({ documentId, securityReviewId, vendorId }),
    tokenProvider,
    transport,
  });
}

async function setStatusForVendor({
  vendorId,
  status,
  tokenProvider,
  transport,
}: { vendorId: string } & VantaSetStatusForVendorInput & Bound): Promise<Result<VantaVendorDto, VantaSdkError>> {
  const form = new FormData();
  form.set("status", status);
  return requestJson({
    body: form,
    boundary: VANTA_VENDORS_OPERATION_BOUNDARIES.setStatusForVendor,
    method: "POST",
    operationId: "SetStatusForVendor",
    path: vendorSetStatusPath({ vendorId }),
    tokenProvider,
    transport,
  });
}

/**
 * Build the Vendors tag's operations.
 *
 * @param tokenProvider mints/reuses the bearer token for every request
 * @param transport the bound Vanta transport
 * @returns the operations, spread into `VantaClient`
 */
export function createVendorsOperations({ tokenProvider, transport }: Bound): VantaVendorsOperations {
  return {
    createFindingForVendor: (input) => createFindingForVendor({ ...input, tokenProvider, transport }),
    createVendor: (input) => createVendor({ ...input, tokenProvider, transport }),
    deleteDocumentForSecurityReview: (input) => deleteDocumentForSecurityReview({ ...input, tokenProvider, transport }),
    deleteFindingForVendor: (input) => deleteFindingForVendor({ ...input, tokenProvider, transport }),
    deleteVendor: (input) => deleteVendor({ ...input, tokenProvider, transport }),
    getAssessmentForVendor: (input) => getAssessmentForVendor({ ...input, tokenProvider, transport }),
    getSecurityReviewForVendor: (input) => getSecurityReviewForVendor({ ...input, tokenProvider, transport }),
    getVendor: (input) => getVendor({ ...input, tokenProvider, transport }),
    listAssessmentsForVendor: (input) => listAssessmentsForVendor({ ...input, tokenProvider, transport }),
    listDocumentsForSecurityReview: (input) => listDocumentsForSecurityReview({ ...input, tokenProvider, transport }),
    listDocumentsForVendor: (input) => listDocumentsForVendor({ ...input, tokenProvider, transport }),
    listFindingsForVendor: (input) => listFindingsForVendor({ ...input, tokenProvider, transport }),
    listSecurityReviewsForVendor: (input) => listSecurityReviewsForVendor({ ...input, tokenProvider, transport }),
    setStatusForVendor: (input) => setStatusForVendor({ ...input, tokenProvider, transport }),
    updateFindingForVendor: (input) => updateFindingForVendor({ ...input, tokenProvider, transport }),
    updateVendor: (input) => updateVendor({ ...input, tokenProvider, transport }),
    uploadDocumentForSecurityReview: (input) => uploadDocumentForSecurityReview({ ...input, tokenProvider, transport }),
    uploadDocumentForVendor: (input) => uploadDocumentForVendor({ ...input, tokenProvider, transport }),
  };
}
