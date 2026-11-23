/**
 * Zod response schemas and request types for the Documents tag, built from Vanta's own published OpenAPI
 * spec.
 *
 * `Document`, its category/status enums, `UploadedFileT` and its cadence/reminder-window enums are
 * identical, field-for-field, to `apiSchemas.ts`'s `vantaDocumentDtoSchema` and `writeApiSchemas.ts`'s
 * `vantaUploadedFileDtoSchema` — imported and reused, never redeclared.
 */
import { z } from "zod";

import {
  documentCategorySchema,
  documentStatusSchema,
  type VantaDocumentDto,
  vantaControlDtoSchema,
  vantaDocumentDtoSchema,
  vantaPageEnvelopeSchema,
} from "../../apiSchemas.js";
import {
  vantaDocumentCadenceSchema,
  vantaDocumentReminderWindowSchema,
  vantaUploadedFileDtoSchema,
} from "../../writeApiSchemas.js";

/**
 * `GET /v1/documents/{documentId}` — response body. Strict like every other DTO here: a field Vanta adds is
 * refused by name at the read and declared here, never stripped (owner ruling: stay strict, update the
 * client when Vanta changes). Vanta's published spec declares these fifteen keys, all required, with
 * `additionalProperties: false` on `DocumentDetail`.
 */
export const vantaDocumentDetailDtoSchema = z.strictObject({
  category: documentCategorySchema,
  deactivatedStatus: z
    .object({
      creationDate: z.string(),
      expiration: z.string().nullable(),
      isDeactivated: z.boolean(),
      reason: z.string().nullable(),
    })
    .strict(),
  description: z.string(),
  id: z.string(),
  isSensitive: z.boolean(),
  nextRenewalDate: z.string().nullable(),
  note: z.string().nullable(),
  ownerId: z.string().nullable(),
  reminderWindow: vantaDocumentReminderWindowSchema.nullable(),
  renewalCadence: vantaDocumentCadenceSchema,
  subscribers: z.array(z.string()),
  title: z.string(),
  uploadStatus: documentStatusSchema,
  uploadStatusDate: z.string().nullable(),
  url: z.string().nullable(),
});
export type VantaDocumentDetailDto = z.infer<typeof vantaDocumentDetailDtoSchema>;

export const vantaUploadedLinkDtoSchema = z
  .object({
    creationDate: z.string(),
    description: z.string(),
    effectiveDate: z.string().nullable(),
    id: z.string(),
    title: z.string(),
    url: z.string(),
  })
  .strict();
export type VantaUploadedLinkDto = z.infer<typeof vantaUploadedLinkDtoSchema>;

/** `GET /v1/documents/{documentId}/controls` — response body: a document's mapped controls. */
export const vantaDocumentControlsPageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaControlDtoSchema });
export type VantaDocumentControlsPage = z.infer<typeof vantaDocumentControlsPageSchema>;

/** `GET /v1/documents/{documentId}/links` — response body. */
export const vantaDocumentLinksPageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaUploadedLinkDtoSchema });
export type VantaDocumentLinksPage = z.infer<typeof vantaDocumentLinksPageSchema>;

/** `GET /v1/documents/{documentId}/uploads` — response body. */
export const vantaDocumentFilesPageSchema = vantaPageEnvelopeSchema({ dataSchema: vantaUploadedFileDtoSchema });
export type VantaDocumentFilesPage = z.infer<typeof vantaDocumentFilesPageSchema>;

/** `POST /v1/documents/{documentId}/links` — request body. */
export interface VantaCreateLinkForDocumentInput {
  readonly url: string;
  readonly title: string;
  readonly description?: string | null;
  readonly effectiveDate?: string | null;
}

/** `POST /v1/documents/{documentId}/set-owner` — request body. `null` removes the owner. */
export interface VantaSetOwnerForDocumentInput {
  readonly userId: string | null;
}

export type { VantaDocumentDto };
export { vantaDocumentDtoSchema };
