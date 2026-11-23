/**
 * The Documents tag's endpoint contracts: one strict boundary per endpoint that answers JSON, declared once at
 * load and read by `documents.ts`'s operations. Kept apart from the request plumbing so a schema drift is fixed
 * in one small file that names every route it covers.
 */
import { defineBoundary } from "#lib/boundary.js";
import {
  vantaDocumentControlsPageSchema,
  vantaDocumentDetailDtoSchema,
  vantaDocumentDtoSchema,
  vantaDocumentFilesPageSchema,
  vantaDocumentLinksPageSchema,
  vantaUploadedLinkDtoSchema,
} from "../schemas/documents.js";

/**
 * One strict boundary per Documents endpoint that answers JSON, named by its method and path template. A field
 * Vanta adds, drops or renames refuses that read by name; the fix is this map's schema, never a looser read.
 *
 * @internal — exported so a test can lock the endpoint each operation names.
 */
export const VANTA_DOCUMENTS_OPERATION_BOUNDARIES = {
  createLinkForDocument: defineBoundary({
    endpoint: "POST /v1/documents/{documentId}/links",
    schema: vantaUploadedLinkDtoSchema,
  }),
  getDocument: defineBoundary({ endpoint: "GET /v1/documents/{documentId}", schema: vantaDocumentDetailDtoSchema }),
  listControlsForDocument: defineBoundary({
    endpoint: "GET /v1/documents/{documentId}/controls",
    schema: vantaDocumentControlsPageSchema,
  }),
  listFilesForDocument: defineBoundary({
    endpoint: "GET /v1/documents/{documentId}/uploads",
    schema: vantaDocumentFilesPageSchema,
  }),
  listLinksForDocument: defineBoundary({
    endpoint: "GET /v1/documents/{documentId}/links",
    schema: vantaDocumentLinksPageSchema,
  }),
  setOwnerForDocument: defineBoundary({
    endpoint: "POST /v1/documents/{documentId}/set-owner",
    schema: vantaDocumentDtoSchema,
  }),
} as const;
