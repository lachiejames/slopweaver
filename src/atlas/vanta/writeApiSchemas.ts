/**
 * Zod schemas for the Vanta Manage API's write surface: `createDocument`'s request enums and
 * `uploadEvidence`'s response DTO, built from Vanta's own published OpenAPI document.
 * `createDocument`'s own response reuses `vantaDocumentDtoSchema` from `apiSchemas.ts` unchanged.
 */
import { z } from "zod";

export const vantaDocumentTimeSensitivitySchema = z.enum(["MOST_RECENT", "DURING_AUDIT_WINDOW"]);
export type VantaDocumentTimeSensitivity = z.infer<typeof vantaDocumentTimeSensitivitySchema>;

export const vantaDocumentCadenceSchema = z.enum(["P0D", "P1D", "P1W", "P1M", "P3M", "P6M", "P1Y", "P2Y"]);
export type VantaDocumentCadence = z.infer<typeof vantaDocumentCadenceSchema>;

export const vantaDocumentReminderWindowSchema = z.enum(["P0D", "P1D", "P1W", "P1M", "P3M"]);
export type VantaDocumentReminderWindow = z.infer<typeof vantaDocumentReminderWindowSchema>;

export const vantaUploadedFileActorSchema = z
  .object({ id: z.string(), type: z.enum(["USER", "APPLICATION"]) })
  .strict();

/** A file's bytes and metadata, ready to attach to a multipart upload. Shared by every uploader in this package. */
export interface VantaUploadFileInput {
  readonly name: string;
  readonly mimeType: string;
  /** Backed by a real `ArrayBuffer`, not a `SharedArrayBuffer` — required for `Blob`'s constructor. */
  readonly content: Uint8Array<ArrayBuffer>;
}

export const vantaUploadedFileDtoSchema = z
  .object({
    creationDate: z.iso.datetime(),
    deletionDate: z.iso.datetime().nullable(),
    description: z.string().nullable(),
    effectiveDate: z.iso.datetime().nullable(),
    fileName: z.string().nullable(),
    id: z.string(),
    mimeType: z.string(),
    title: z.string(),
    updatedDate: z.iso.datetime(),
    uploadedBy: vantaUploadedFileActorSchema.nullable(),
    url: z.string(),
  })
  .strict();

export type VantaUploadedFileDto = z.infer<typeof vantaUploadedFileDtoSchema>;
