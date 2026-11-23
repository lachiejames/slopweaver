/**
 * The Controls tag's endpoint contracts: one strict boundary per endpoint that answers JSON, declared once at
 * load and read by `controls.ts`'s operations. Kept apart from the request plumbing so a schema drift is fixed
 * in one small file that names every route it covers.
 */
import { defineBoundary } from "#lib/boundary.js";
import {
  vantaAddControlDocumentMappingResponseSchema,
  vantaAddControlTestMappingResponseSchema,
  vantaControlDetailDtoSchema,
  vantaControlDocumentsPageSchema,
  vantaControlDtoSchema,
  vantaControlLibraryPageSchema,
} from "../schemas/controls.js";

/**
 * One strict boundary per Controls endpoint that answers JSON, named by its method and path template. A field
 * Vanta adds, drops or renames refuses that read by name; the fix is this map's schema, never a looser read.
 *
 * @internal — exported so a test can lock the endpoint each operation names.
 */
export const VANTA_CONTROLS_OPERATION_BOUNDARIES = {
  addControlFromLibrary: defineBoundary({
    endpoint: "POST /v1/controls/add-from-library",
    schema: vantaControlDtoSchema,
  }),
  addDocumentToControl: defineBoundary({
    endpoint: "POST /v1/controls/{controlId}/add-document-to-control",
    schema: vantaAddControlDocumentMappingResponseSchema,
  }),
  addTestToControl: defineBoundary({
    endpoint: "POST /v1/controls/{controlId}/add-test-to-control",
    schema: vantaAddControlTestMappingResponseSchema,
  }),
  createControl: defineBoundary({ endpoint: "POST /v1/controls", schema: vantaControlDtoSchema }),
  getControl: defineBoundary({ endpoint: "GET /v1/controls/{controlId}", schema: vantaControlDetailDtoSchema }),
  listDocumentsForControl: defineBoundary({
    endpoint: "GET /v1/controls/{controlId}/documents",
    schema: vantaControlDocumentsPageSchema,
  }),
  listLibraryControls: defineBoundary({
    endpoint: "GET /v1/controls/controls-library",
    schema: vantaControlLibraryPageSchema,
  }),
  setOwnerForControl: defineBoundary({
    endpoint: "POST /v1/controls/{controlId}/set-owner",
    schema: vantaControlDtoSchema,
  }),
  updateControlMetadata: defineBoundary({
    endpoint: "PATCH /v1/controls/{controlId}",
    schema: vantaControlDetailDtoSchema,
  }),
} as const;
