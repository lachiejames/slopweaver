/**
 * The Documents tag's seven methods. Endpoint shapes are built from Vanta's own OpenAPI spec.
 *
 * `GetUploadedfileMedia` (`GET /v1/documents/{documentId}/uploads/{uploadedFileId}/media`) is deliberately
 * NOT built here. It returns a raw file stream — Vanta's spec lists dozens of possible content types — and
 * `transport.ts` only ever reads a response via `.text()`, which UTF-8-decodes the body. That is silently
 * lossy for binary content, so building this now would ship a real correctness bug rather than a working
 * method. Building it properly needs a binary/stream-response capability in `transport.ts` first.
 *
 * Every method that reads JSON back reads it through its endpoint's strict boundary in
 * {@link VANTA_DOCUMENTS_OPERATION_BOUNDARIES} (`documentsBoundaries.ts`), declared once at load.
 */
import type { Result } from "../../../../lib/result.js";
import type { VantaTokenProvider } from "../../oauth.js";
import type { VantaTransport } from "../../transport.js";
import type { VantaSdkError } from "../errors.js";
import { requestJson, requestNoContent } from "../httpBoundary.js";
import { withVantaPageQuery } from "../pageQuery.js";
import type {
  VantaCreateLinkForDocumentInput,
  VantaDocumentControlsPage,
  VantaDocumentDetailDto,
  VantaDocumentDto,
  VantaDocumentFilesPage,
  VantaDocumentLinksPage,
  VantaSetOwnerForDocumentInput,
  VantaUploadedLinkDto,
} from "../schemas/documents.js";
import { VANTA_DOCUMENTS_OPERATION_BOUNDARIES } from "./documentsBoundaries.js";

type Bound = { tokenProvider: VantaTokenProvider; transport: VantaTransport };

function documentPath({ documentId }: { documentId: string }): string {
  return `/v1/documents/${encodeURIComponent(documentId)}`;
}

function documentControlsPath({ documentId }: { documentId: string }): string {
  return `/v1/documents/${encodeURIComponent(documentId)}/controls`;
}

function documentLinksPath({ documentId }: { documentId: string }): string {
  return `/v1/documents/${encodeURIComponent(documentId)}/links`;
}

function documentLinkPath({ documentId, linkId }: { documentId: string; linkId: string }): string {
  return `/v1/documents/${encodeURIComponent(documentId)}/links/${encodeURIComponent(linkId)}`;
}

function documentSetOwnerPath({ documentId }: { documentId: string }): string {
  return `/v1/documents/${encodeURIComponent(documentId)}/set-owner`;
}

function documentUploadsPath({ documentId }: { documentId: string }): string {
  return `/v1/documents/${encodeURIComponent(documentId)}/uploads`;
}

const JSON_HEADERS = { "content-type": "application/json" };

export interface VantaDocumentsOperations {
  /** `GET /v1/documents/{documentId}` — a single document by ID. */
  getDocument: (input: { documentId: string }) => Promise<Result<VantaDocumentDetailDto, VantaSdkError>>;
  /** `GET /v1/documents/{documentId}/controls` — list a document's mapped controls. */
  listControlsForDocument: (input: {
    documentId: string;
    pageSize?: number;
    pageCursor?: string;
  }) => Promise<Result<VantaDocumentControlsPage, VantaSdkError>>;
  /** `GET /v1/documents/{documentId}/links` — list a document's uploaded links. */
  listLinksForDocument: (input: {
    documentId: string;
    pageSize?: number;
    pageCursor?: string;
  }) => Promise<Result<VantaDocumentLinksPage, VantaSdkError>>;
  /** `POST /v1/documents/{documentId}/links` — attach a link to a document. */
  createLinkForDocument: (
    input: { documentId: string } & VantaCreateLinkForDocumentInput,
  ) => Promise<Result<VantaUploadedLinkDto, VantaSdkError>>;
  /** `DELETE /v1/documents/{documentId}/links/{linkId}` — remove a link from a document. */
  deleteLinkForDocument: (input: { documentId: string; linkId: string }) => Promise<Result<null, VantaSdkError>>;
  /** `POST /v1/documents/{documentId}/set-owner` — assign or clear a document's owner. */
  setOwnerForDocument: (
    input: { documentId: string } & VantaSetOwnerForDocumentInput,
  ) => Promise<Result<VantaDocumentDto, VantaSdkError>>;
  /** `GET /v1/documents/{documentId}/uploads` — list a document's uploaded files. */
  listFilesForDocument: (input: {
    documentId: string;
    pageSize?: number;
    pageCursor?: string;
  }) => Promise<Result<VantaDocumentFilesPage, VantaSdkError>>;
}

async function getDocument({
  documentId,
  tokenProvider,
  transport,
}: { documentId: string } & Bound): Promise<Result<VantaDocumentDetailDto, VantaSdkError>> {
  return requestJson({
    boundary: VANTA_DOCUMENTS_OPERATION_BOUNDARIES.getDocument,
    method: "GET",
    operationId: "GetDocument",
    path: documentPath({ documentId }),
    tokenProvider,
    transport,
  });
}

async function listControlsForDocument({
  documentId,
  pageSize,
  pageCursor,
  tokenProvider,
  transport,
}: { documentId: string; pageSize?: number; pageCursor?: string } & Bound): Promise<
  Result<VantaDocumentControlsPage, VantaSdkError>
> {
  return requestJson({
    boundary: VANTA_DOCUMENTS_OPERATION_BOUNDARIES.listControlsForDocument,
    method: "GET",
    operationId: "ListControlsForDocument",
    path: withVantaPageQuery({ pageCursor, pageSize, path: documentControlsPath({ documentId }) }),
    tokenProvider,
    transport,
  });
}

async function listLinksForDocument({
  documentId,
  pageSize,
  pageCursor,
  tokenProvider,
  transport,
}: { documentId: string; pageSize?: number; pageCursor?: string } & Bound): Promise<
  Result<VantaDocumentLinksPage, VantaSdkError>
> {
  return requestJson({
    boundary: VANTA_DOCUMENTS_OPERATION_BOUNDARIES.listLinksForDocument,
    method: "GET",
    operationId: "ListLinksForDocument",
    path: withVantaPageQuery({ pageCursor, pageSize, path: documentLinksPath({ documentId }) }),
    tokenProvider,
    transport,
  });
}

async function createLinkForDocument({
  documentId,
  tokenProvider,
  transport,
  ...body
}: { documentId: string } & VantaCreateLinkForDocumentInput & Bound): Promise<
  Result<VantaUploadedLinkDto, VantaSdkError>
> {
  return requestJson({
    body: JSON.stringify(body),
    boundary: VANTA_DOCUMENTS_OPERATION_BOUNDARIES.createLinkForDocument,
    headers: JSON_HEADERS,
    method: "POST",
    operationId: "CreateLinkForDocument",
    path: documentLinksPath({ documentId }),
    tokenProvider,
    transport,
  });
}

async function deleteLinkForDocument({
  documentId,
  linkId,
  tokenProvider,
  transport,
}: { documentId: string; linkId: string } & Bound): Promise<Result<null, VantaSdkError>> {
  return requestNoContent({
    method: "DELETE",
    operationId: "DeleteLinkForDocument",
    path: documentLinkPath({ documentId, linkId }),
    tokenProvider,
    transport,
  });
}

async function setOwnerForDocument({
  documentId,
  userId,
  tokenProvider,
  transport,
}: { documentId: string } & VantaSetOwnerForDocumentInput & Bound): Promise<Result<VantaDocumentDto, VantaSdkError>> {
  return requestJson({
    body: JSON.stringify({ userId }),
    boundary: VANTA_DOCUMENTS_OPERATION_BOUNDARIES.setOwnerForDocument,
    headers: JSON_HEADERS,
    method: "POST",
    operationId: "SetOwnerForDocument",
    path: documentSetOwnerPath({ documentId }),
    tokenProvider,
    transport,
  });
}

async function listFilesForDocument({
  documentId,
  pageSize,
  pageCursor,
  tokenProvider,
  transport,
}: { documentId: string; pageSize?: number; pageCursor?: string } & Bound): Promise<
  Result<VantaDocumentFilesPage, VantaSdkError>
> {
  return requestJson({
    boundary: VANTA_DOCUMENTS_OPERATION_BOUNDARIES.listFilesForDocument,
    method: "GET",
    operationId: "ListFilesForDocument",
    path: withVantaPageQuery({ pageCursor, pageSize, path: documentUploadsPath({ documentId }) }),
    tokenProvider,
    transport,
  });
}

/**
 * Build the Documents tag's operations.
 *
 * @param tokenProvider mints/reuses the bearer token for every request
 * @param transport the bound Vanta transport
 * @returns the operations, spread into `VantaClient`
 */
export function createDocumentsOperations({ tokenProvider, transport }: Bound): VantaDocumentsOperations {
  return {
    createLinkForDocument: (input) => createLinkForDocument({ ...input, tokenProvider, transport }),
    deleteLinkForDocument: (input) => deleteLinkForDocument({ ...input, tokenProvider, transport }),
    getDocument: (input) => getDocument({ ...input, tokenProvider, transport }),
    listControlsForDocument: (input) => listControlsForDocument({ ...input, tokenProvider, transport }),
    listFilesForDocument: (input) => listFilesForDocument({ ...input, tokenProvider, transport }),
    listLinksForDocument: (input) => listLinksForDocument({ ...input, tokenProvider, transport }),
    setOwnerForDocument: (input) => setOwnerForDocument({ ...input, tokenProvider, transport }),
  };
}
