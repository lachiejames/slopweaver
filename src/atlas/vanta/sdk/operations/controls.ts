/**
 * The Controls tag's twelve methods. Endpoint shapes are built from Vanta's own OpenAPI spec, and every
 * method that reads JSON back reads it through its endpoint's strict boundary in
 * {@link VANTA_CONTROLS_OPERATION_BOUNDARIES} (`controlsBoundaries.ts`), declared once at load.
 */
import type { Result } from "../../../../lib/result.js";
import { vantaControlDetailEndpoint } from "../../inventory.js";
import type { VantaTokenProvider } from "../../oauth.js";
import type { VantaTransport } from "../../transport.js";
import type { VantaSdkError } from "../errors.js";
import { requestJson, requestNoContent } from "../httpBoundary.js";
import { withVantaPageQuery } from "../pageQuery.js";
import type {
  VantaAddControlDocumentMappingInput,
  VantaAddControlDocumentMappingResponse,
  VantaAddControlFromLibraryInput,
  VantaAddControlTestMappingInput,
  VantaAddControlTestMappingResponse,
  VantaControlDetailDto,
  VantaControlDocumentsPage,
  VantaControlDto,
  VantaControlLibraryPage,
  VantaCreateControlInput,
  VantaSetOwnerForControlInput,
  VantaUpdateControlMetadataInput,
} from "../schemas/controls.js";
import { VANTA_CONTROLS_OPERATION_BOUNDARIES } from "./controlsBoundaries.js";

type Bound = { tokenProvider: VantaTokenProvider; transport: VantaTransport };

function controlsPath(): string {
  return "/v1/controls";
}

function controlsLibraryAddPath(): string {
  return "/v1/controls/add-from-library";
}

function controlsLibraryListPath(): string {
  return "/v1/controls/controls-library";
}

function controlDocumentsPath({ controlId }: { controlId: string }): string {
  return `/v1/controls/${encodeURIComponent(controlId)}/documents`;
}

function controlDocumentPath({ controlId, documentId }: { controlId: string; documentId: string }): string {
  return `/v1/controls/${encodeURIComponent(controlId)}/documents/${encodeURIComponent(documentId)}`;
}

function controlAddDocumentPath({ controlId }: { controlId: string }): string {
  return `/v1/controls/${encodeURIComponent(controlId)}/add-document-to-control`;
}

function controlSetOwnerPath({ controlId }: { controlId: string }): string {
  return `/v1/controls/${encodeURIComponent(controlId)}/set-owner`;
}

function controlAddTestPath({ controlId }: { controlId: string }): string {
  return `/v1/controls/${encodeURIComponent(controlId)}/add-test-to-control`;
}

function controlTestPath({ controlId, testId }: { controlId: string; testId: string }): string {
  return `/v1/controls/${encodeURIComponent(controlId)}/tests/${encodeURIComponent(testId)}`;
}

const JSON_HEADERS = { "content-type": "application/json" };

export interface VantaControlsOperations {
  /** `GET /v1/controls/{controlId}` — a single control by ID. */
  getControl: (input: { controlId: string }) => Promise<Result<VantaControlDetailDto, VantaSdkError>>;
  /** `POST /v1/controls` — create a custom control. */
  createControl: (input: VantaCreateControlInput) => Promise<Result<VantaControlDto, VantaSdkError>>;
  /** `POST /v1/controls/add-from-library` — add a control from Vanta's own library. */
  addControlFromLibrary: (input: VantaAddControlFromLibraryInput) => Promise<Result<VantaControlDto, VantaSdkError>>;
  /**
   * `GET /v1/controls/controls-library` — list Vanta's library controls.
   * @deprecated Vanta's own spec marks this endpoint deprecated. Kept for completeness per this client's
   *   1:1-with-the-real-API-surface scope.
   */
  listLibraryControls: (input: {
    pageSize?: number;
    pageCursor?: string;
  }) => Promise<Result<VantaControlLibraryPage, VantaSdkError>>;
  /** `PATCH /v1/controls/{controlId}` — update a control's metadata. Omitted fields are left unchanged. */
  updateControlMetadata: (
    input: { controlId: string } & VantaUpdateControlMetadataInput,
  ) => Promise<Result<VantaControlDetailDto, VantaSdkError>>;
  /** `DELETE /v1/controls/{controlId}` — deactivate a custom or Vanta control. */
  deleteControl: (input: { controlId: string }) => Promise<Result<null, VantaSdkError>>;
  /** `POST /v1/controls/{controlId}/add-document-to-control` — map a document to a control. */
  addDocumentToControl: (
    input: { controlId: string } & VantaAddControlDocumentMappingInput,
  ) => Promise<Result<VantaAddControlDocumentMappingResponse, VantaSdkError>>;
  /** `GET /v1/controls/{controlId}/documents` — list a control's mapped documents. */
  listDocumentsForControl: (input: {
    controlId: string;
    pageSize?: number;
    pageCursor?: string;
  }) => Promise<Result<VantaControlDocumentsPage, VantaSdkError>>;
  /** `DELETE /v1/controls/{controlId}/documents/{documentId}` — remove a document from a control. */
  deleteDocumentForControl: (input: { controlId: string; documentId: string }) => Promise<Result<null, VantaSdkError>>;
  /** `POST /v1/controls/{controlId}/set-owner` — assign or clear a control's owner. */
  setOwnerForControl: (
    input: { controlId: string } & VantaSetOwnerForControlInput,
  ) => Promise<Result<VantaControlDto, VantaSdkError>>;
  /** `POST /v1/controls/{controlId}/add-test-to-control` — map a test to a control. */
  addTestToControl: (
    input: { controlId: string } & VantaAddControlTestMappingInput,
  ) => Promise<Result<VantaAddControlTestMappingResponse, VantaSdkError>>;
  /** `DELETE /v1/controls/{controlId}/tests/{testId}` — remove a test from a control. */
  deleteTestForControl: (input: { controlId: string; testId: string }) => Promise<Result<null, VantaSdkError>>;
}

async function getControl({
  controlId,
  tokenProvider,
  transport,
}: { controlId: string } & Bound): Promise<Result<VantaControlDetailDto, VantaSdkError>> {
  return requestJson({
    boundary: VANTA_CONTROLS_OPERATION_BOUNDARIES.getControl,
    method: "GET",
    operationId: "GetControl",
    path: vantaControlDetailEndpoint({ controlId }).path,
    tokenProvider,
    transport,
  });
}

async function createControl(input: VantaCreateControlInput & Bound): Promise<Result<VantaControlDto, VantaSdkError>> {
  const { tokenProvider, transport, ...body } = input;
  return requestJson({
    body: JSON.stringify(body),
    boundary: VANTA_CONTROLS_OPERATION_BOUNDARIES.createControl,
    headers: JSON_HEADERS,
    method: "POST",
    operationId: "CreateCustomControl",
    path: controlsPath(),
    tokenProvider,
    transport,
  });
}

async function addControlFromLibrary(
  input: VantaAddControlFromLibraryInput & Bound,
): Promise<Result<VantaControlDto, VantaSdkError>> {
  const { tokenProvider, transport, ...body } = input;
  return requestJson({
    body: JSON.stringify(body),
    boundary: VANTA_CONTROLS_OPERATION_BOUNDARIES.addControlFromLibrary,
    headers: JSON_HEADERS,
    method: "POST",
    operationId: "AddControlFromLibrary",
    path: controlsLibraryAddPath(),
    tokenProvider,
    transport,
  });
}

async function listLibraryControls({
  pageSize,
  pageCursor,
  tokenProvider,
  transport,
}: { pageSize?: number; pageCursor?: string } & Bound): Promise<Result<VantaControlLibraryPage, VantaSdkError>> {
  return requestJson({
    boundary: VANTA_CONTROLS_OPERATION_BOUNDARIES.listLibraryControls,
    method: "GET",
    operationId: "ListLibraryControls",
    path: withVantaPageQuery({ pageCursor, pageSize, path: controlsLibraryListPath() }),
    tokenProvider,
    transport,
  });
}

async function updateControlMetadata({
  controlId,
  tokenProvider,
  transport,
  ...fields
}: { controlId: string } & VantaUpdateControlMetadataInput & Bound): Promise<
  Result<VantaControlDetailDto, VantaSdkError>
> {
  return requestJson({
    body: JSON.stringify(fields),
    boundary: VANTA_CONTROLS_OPERATION_BOUNDARIES.updateControlMetadata,
    headers: JSON_HEADERS,
    method: "PATCH",
    operationId: "UpdateControlMetadata",
    path: vantaControlDetailEndpoint({ controlId }).path,
    tokenProvider,
    transport,
  });
}

async function deleteControl({
  controlId,
  tokenProvider,
  transport,
}: { controlId: string } & Bound): Promise<Result<null, VantaSdkError>> {
  return requestNoContent({
    method: "DELETE",
    operationId: "DeleteControl",
    path: vantaControlDetailEndpoint({ controlId }).path,
    tokenProvider,
    transport,
  });
}

async function addDocumentToControl({
  controlId,
  documentId,
  tokenProvider,
  transport,
}: { controlId: string } & VantaAddControlDocumentMappingInput & Bound): Promise<
  Result<VantaAddControlDocumentMappingResponse, VantaSdkError>
> {
  return requestJson({
    body: JSON.stringify({ documentId }),
    boundary: VANTA_CONTROLS_OPERATION_BOUNDARIES.addDocumentToControl,
    headers: JSON_HEADERS,
    method: "POST",
    operationId: "AddDocumentToControl",
    path: controlAddDocumentPath({ controlId }),
    tokenProvider,
    transport,
  });
}

async function listDocumentsForControl({
  controlId,
  pageSize,
  pageCursor,
  tokenProvider,
  transport,
}: { controlId: string; pageSize?: number; pageCursor?: string } & Bound): Promise<
  Result<VantaControlDocumentsPage, VantaSdkError>
> {
  return requestJson({
    boundary: VANTA_CONTROLS_OPERATION_BOUNDARIES.listDocumentsForControl,
    method: "GET",
    operationId: "ListDocumentsForControl",
    path: withVantaPageQuery({ pageCursor, pageSize, path: controlDocumentsPath({ controlId }) }),
    tokenProvider,
    transport,
  });
}

async function deleteDocumentForControl({
  controlId,
  documentId,
  tokenProvider,
  transport,
}: { controlId: string; documentId: string } & Bound): Promise<Result<null, VantaSdkError>> {
  return requestNoContent({
    method: "DELETE",
    operationId: "DeleteDocumentForcontrol",
    path: controlDocumentPath({ controlId, documentId }),
    tokenProvider,
    transport,
  });
}

async function setOwnerForControl({
  controlId,
  userId,
  tokenProvider,
  transport,
}: { controlId: string } & VantaSetOwnerForControlInput & Bound): Promise<Result<VantaControlDto, VantaSdkError>> {
  return requestJson({
    body: JSON.stringify({ userId }),
    boundary: VANTA_CONTROLS_OPERATION_BOUNDARIES.setOwnerForControl,
    headers: JSON_HEADERS,
    method: "POST",
    operationId: "SetOwnerForControl",
    path: controlSetOwnerPath({ controlId }),
    tokenProvider,
    transport,
  });
}

async function addTestToControl({
  controlId,
  testId,
  tokenProvider,
  transport,
}: { controlId: string } & VantaAddControlTestMappingInput & Bound): Promise<
  Result<VantaAddControlTestMappingResponse, VantaSdkError>
> {
  return requestJson({
    body: JSON.stringify({ testId }),
    boundary: VANTA_CONTROLS_OPERATION_BOUNDARIES.addTestToControl,
    headers: JSON_HEADERS,
    method: "POST",
    operationId: "AddTestToControl",
    path: controlAddTestPath({ controlId }),
    tokenProvider,
    transport,
  });
}

async function deleteTestForControl({
  controlId,
  testId,
  tokenProvider,
  transport,
}: { controlId: string; testId: string } & Bound): Promise<Result<null, VantaSdkError>> {
  return requestNoContent({
    method: "DELETE",
    operationId: "DeleteTestForControl",
    path: controlTestPath({ controlId, testId }),
    tokenProvider,
    transport,
  });
}

/**
 * Build the Controls tag's operations.
 *
 * @param tokenProvider mints/reuses the bearer token for every request
 * @param transport the bound Vanta transport
 * @returns the operations, spread into `VantaClient`
 */
export function createControlsOperations({ tokenProvider, transport }: Bound): VantaControlsOperations {
  return {
    addControlFromLibrary: (input) => addControlFromLibrary({ ...input, tokenProvider, transport }),
    addDocumentToControl: (input) => addDocumentToControl({ ...input, tokenProvider, transport }),
    addTestToControl: (input) => addTestToControl({ ...input, tokenProvider, transport }),
    createControl: (input) => createControl({ ...input, tokenProvider, transport }),
    deleteControl: (input) => deleteControl({ ...input, tokenProvider, transport }),
    deleteDocumentForControl: (input) => deleteDocumentForControl({ ...input, tokenProvider, transport }),
    deleteTestForControl: (input) => deleteTestForControl({ ...input, tokenProvider, transport }),
    getControl: (input) => getControl({ ...input, tokenProvider, transport }),
    listDocumentsForControl: (input) => listDocumentsForControl({ ...input, tokenProvider, transport }),
    // oxlint-disable-next-line no-deprecated -- wiring the deprecated-but-still-live endpoint into the client is the point; see the method's own @deprecated note
    listLibraryControls: (input) => listLibraryControls({ ...input, tokenProvider, transport }),
    setOwnerForControl: (input) => setOwnerForControl({ ...input, tokenProvider, transport }),
    updateControlMetadata: (input) => updateControlMetadata({ ...input, tokenProvider, transport }),
  };
}
