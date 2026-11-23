/**
 * The write half of the Vanta Manage API client: `createDocument`, `uploadEvidence` and `submitDocument`
 * (additive — they create or advance a document) plus `deleteUpload` and `deleteDocument` (destructive —
 * they remove one). Kept separate from `client.ts`'s read-only surface by design: the additive/destructive
 * split within this file mirrors a real distinction at the endpoint level (Vanta's own destructive routes
 * are separately named, not a flag on the additive ones) that a future confirmation gate can key off
 * directly.
 *
 * No caller wires this client into a live CLI verb yet in this port — see the port's own PR notes. The
 * vulnerability write that DOES have a verb lives in `vulnerabilityWriteClient.ts`; the token-resolution and
 * body-parsing mechanics both writes share were extracted to `writeTransport.ts` when it arrived. Each write
 * that answers JSON reads it through its endpoint's strict boundary in {@link VANTA_WRITE_BOUNDARIES}.
 */
import { defineBoundary } from "#lib/boundary.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type VantaDocumentDto, vantaDocumentDtoSchema } from "./apiSchemas.js";
import type { VantaTokenProvider } from "./oauth.js";
import type { VantaTransport } from "./transport.js";
import {
  type VantaDocumentCadence,
  type VantaDocumentReminderWindow,
  type VantaDocumentTimeSensitivity,
  type VantaUploadedFileDto,
  type VantaUploadFileInput,
  vantaUploadedFileDtoSchema,
} from "./writeApiSchemas.js";
import { parseVantaWriteBody, performVantaWrite } from "./writeTransport.js";

/**
 * One strict boundary per document write that answers JSON, named by its method and path template.
 *
 * @internal — exported so a test can lock the endpoint each write names.
 */
export const VANTA_WRITE_BOUNDARIES = {
  createDocument: defineBoundary({ endpoint: "POST /v1/documents", schema: vantaDocumentDtoSchema }),
  uploadEvidence: defineBoundary({
    endpoint: "POST /v1/documents/{documentId}/uploads",
    schema: vantaUploadedFileDtoSchema,
  }),
} as const;

export interface VantaCreateDocumentInput {
  readonly title: string;
  readonly description: string;
  readonly timeSensitivity: VantaDocumentTimeSensitivity;
  readonly cadence: VantaDocumentCadence;
  readonly reminderWindow: VantaDocumentReminderWindow;
  readonly isSensitive: boolean;
}

export interface VantaUploadEvidenceInput {
  readonly documentId: string;
  readonly file: VantaUploadFileInput;
  readonly description: string | null;
  readonly effectiveAtDate: string | null;
}

/** The three write calls that create or advance a document — never remove one. */
interface VantaAdditiveWriteClient {
  createDocument: (input: VantaCreateDocumentInput) => Promise<Result<VantaDocumentDto>>;
  uploadEvidence: (input: VantaUploadEvidenceInput) => Promise<Result<VantaUploadedFileDto>>;
  submitDocument: (input: { documentId: string }) => Promise<Result<null>>;
}

/** The two write calls that remove something — Vanta's own separately-named delete routes. */
interface VantaDestructiveWriteClient {
  deleteUpload: (input: { documentId: string; uploadedFileId: string }) => Promise<Result<null>>;
  deleteDocument: (input: { documentId: string }) => Promise<Result<null>>;
}

export interface VantaManageWriteClient extends VantaAdditiveWriteClient, VantaDestructiveWriteClient {}

/**
 * The `create-document` endpoint. Exported so `writePreview.ts` resolves the same endpoint rather than
 * re-deriving it.
 *
 * @returns the endpoint path
 */
export function documentsPath(): string {
  return "/v1/documents";
}

/**
 * The single-document endpoint.
 *
 * @param documentId the document's provider id
 * @returns the endpoint path
 */
function documentPath({ documentId }: { documentId: string }): string {
  return `/v1/documents/${encodeURIComponent(documentId)}`;
}

/**
 * The `upload-evidence` endpoint. Exported so `writePreview.ts` resolves the same endpoint rather than
 * re-deriving it.
 *
 * @param documentId the document's provider id
 * @returns the endpoint path
 */
export function documentUploadsPath({ documentId }: { documentId: string }): string {
  return `/v1/documents/${encodeURIComponent(documentId)}/uploads`;
}

/**
 * The single-upload endpoint, for deleting one uploaded file.
 *
 * @param documentId the document's provider id
 * @param uploadedFileId the uploaded file's provider id
 * @returns the endpoint path
 */
function documentUploadPath({ documentId, uploadedFileId }: { documentId: string; uploadedFileId: string }): string {
  return `/v1/documents/${encodeURIComponent(documentId)}/uploads/${encodeURIComponent(uploadedFileId)}`;
}

/**
 * The `submit-document` endpoint. Exported so `writePreview.ts` resolves the same endpoint rather than
 * re-deriving it.
 *
 * @param documentId the document's provider id
 * @returns the endpoint path
 */
export function documentSubmitPath({ documentId }: { documentId: string }): string {
  return `/v1/documents/${encodeURIComponent(documentId)}/submit`;
}

async function createDocument({
  title,
  description,
  timeSensitivity,
  cadence,
  reminderWindow,
  isSensitive,
  tokenProvider,
  transport,
}: VantaCreateDocumentInput & { tokenProvider: VantaTokenProvider; transport: VantaTransport }): Promise<
  Result<VantaDocumentDto>
> {
  const raw = await performVantaWrite({
    body: JSON.stringify({ cadence, description, isSensitive, reminderWindow, timeSensitivity, title }),
    headers: { "content-type": "application/json" },
    method: "POST",
    path: documentsPath(),
    tokenProvider,
    transport,
  });
  if (raw.isErr()) {
    return err(raw.error);
  }
  return parseVantaWriteBody({
    body: raw.value.body,
    boundary: VANTA_WRITE_BOUNDARIES.createDocument,
    surface: "create-document",
  });
}

async function uploadEvidence({
  documentId,
  file,
  description,
  effectiveAtDate,
  tokenProvider,
  transport,
}: VantaUploadEvidenceInput & { tokenProvider: VantaTokenProvider; transport: VantaTransport }): Promise<
  Result<VantaUploadedFileDto>
> {
  const form = new FormData();
  form.set("file", new Blob([file.content], { type: file.mimeType }), file.name);
  if (effectiveAtDate !== null) {
    form.set("effectiveAtDate", effectiveAtDate);
  }
  if (description !== null) {
    form.set("description", description);
  }
  const raw = await performVantaWrite({
    // Deliberately no content-type header: `fetch` computes the multipart boundary itself from the
    // FormData body, and a hand-set `multipart/form-data` header with no boundary breaks the request.
    body: form,
    headers: {},
    method: "POST",
    path: documentUploadsPath({ documentId }),
    tokenProvider,
    transport,
  });
  if (raw.isErr()) {
    return err(raw.error);
  }
  return parseVantaWriteBody({
    body: raw.value.body,
    boundary: VANTA_WRITE_BOUNDARIES.uploadEvidence,
    surface: "upload-evidence",
  });
}

async function submitDocument({
  documentId,
  tokenProvider,
  transport,
}: {
  documentId: string;
  tokenProvider: VantaTokenProvider;
  transport: VantaTransport;
}): Promise<Result<null>> {
  const raw = await performVantaWrite({
    body: undefined,
    headers: {},
    method: "POST",
    path: documentSubmitPath({ documentId }),
    tokenProvider,
    transport,
  });
  if (raw.isErr()) {
    return err(raw.error);
  }
  return ok(null);
}

async function deleteUpload({
  documentId,
  uploadedFileId,
  tokenProvider,
  transport,
}: {
  documentId: string;
  uploadedFileId: string;
  tokenProvider: VantaTokenProvider;
  transport: VantaTransport;
}): Promise<Result<null>> {
  const raw = await performVantaWrite({
    body: undefined,
    headers: {},
    method: "DELETE",
    path: documentUploadPath({ documentId, uploadedFileId }),
    tokenProvider,
    transport,
  });
  if (raw.isErr()) {
    return err(raw.error);
  }
  return ok(null);
}

async function deleteDocument({
  documentId,
  tokenProvider,
  transport,
}: {
  documentId: string;
  tokenProvider: VantaTokenProvider;
  transport: VantaTransport;
}): Promise<Result<null>> {
  const raw = await performVantaWrite({
    body: undefined,
    headers: {},
    method: "DELETE",
    path: documentPath({ documentId }),
    tokenProvider,
    transport,
  });
  if (raw.isErr()) {
    return err(raw.error);
  }
  return ok(null);
}

/**
 * Build the write client.
 *
 * @param tokenProvider mints/reuses the bearer token for every request
 * @param transport the bound Vanta transport
 * @returns the client
 */
export function createVantaManageWriteClient({
  tokenProvider,
  transport,
}: {
  tokenProvider: VantaTokenProvider;
  transport: VantaTransport;
}): VantaManageWriteClient {
  return {
    createDocument: (input) => createDocument({ ...input, tokenProvider, transport }),
    deleteDocument: ({ documentId }) => deleteDocument({ documentId, tokenProvider, transport }),
    deleteUpload: ({ documentId, uploadedFileId }) =>
      deleteUpload({ documentId, tokenProvider, transport, uploadedFileId }),
    submitDocument: ({ documentId }) => submitDocument({ documentId, tokenProvider, transport }),
    uploadEvidence: (input) => uploadEvidence({ ...input, tokenProvider, transport }),
  };
}
