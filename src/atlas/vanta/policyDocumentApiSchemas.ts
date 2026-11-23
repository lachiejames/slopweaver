/**
 * The Manage API shapes behind `GET /v1/knowledge-base/resources` — the endpoint that serves this
 * organisation's own policy DOCUMENTS as files.
 *
 * ## Why this file exists, and what it corrects
 *
 * This atlas holds each of its policies as an object — name, status, approval date, a one-line
 * purpose and a document URL — and not one line of any policy's text. The reason it recorded was that the
 * Manage API has no body surface, established by calling nine content-shaped routes under
 * `/v1/policies/{id}` and getting HTTP 404 from every one.
 *
 * Every one of those nine was GUESSED. The published document lists `/knowledge-base/resources`, and
 * MEASURED it answers **HTTP 200 with every policy document as a FILE resource**, each carrying a presigned
 * `fileUrl` — the organisation's whole ISMS policy set. `inventory.ts` had gone further and declared the whole knowledge base absent from the Manage API on
 * the strength of two more guessed paths (`/v1/knowledge-base` and `/v1/knowledge-base/articles`), which is
 * how an endpoint serving the most consequential documents in the platform stayed invisible.
 *
 * That is why this atlas now has a pinned DENOMINATOR (`generated/specLock.ts`): a route nobody guessed is
 * an absence, and absences appear in no coverage report.
 *
 * ## `fileUrl` is presigned and expires in an hour
 *
 * Vanta's own description says so, and it is the reason the sync DOWNLOADS the bytes rather than storing
 * the address: a URL that stops resolving is not a local copy, and the whole point of the sync is that
 * local reflects remote so local is what gets searched.
 */
import { z } from "zod";

/** The fields a `FILE` and a `URL` resource share, transcribed from the document's two output schemas. */
const resourceBase = {
  categoryId: z.string().nullable(),
  customerVisibility: z.enum(["PUBLIC", "SHAREABLE", "PRIVATE", "REQUEST_ACCESS"]).nullable(),
  description: z.string().nullable(),
  expirationDate: z.string().nullable(),
  expirationStatus: z.enum(["CURRENT", "EXPIRED"]),
  id: z.string().min(1),
  isUsedInQuestionnaires: z.boolean().nullable(),
  lastUpdated: z.string(),
  lastVerified: z.string().nullable(),
  ownerAssignment: z
    .strictObject({ displayName: z.string().nullable(), id: z.string(), type: z.enum(["User", "Team"]) })
    .nullable(),
  tags: z.array(z.strictObject({ categoryId: z.string(), tagId: z.string() })),
  title: z.string(),
};

/**
 * One knowledge-base resource, as `GET /v1/knowledge-base/resources` returns it: the document's
 * `TrustKnowledgeBaseResourceOutput`, a `FILE` or a `URL`, told apart by `type` and each strict. Transcribed
 * from `jq '.components.schemas.KnowledgeBaseDocumentResourceOutput,
 * .components.schemas.KnowledgeBaseWebpageResourceOutput' manage-vanta.json`, and MEASURED 2026
 * against every resource the account holds: each a `FILE`, carrying exactly the `FILE` arm's fifteen keys.
 * The `URL` arm is the document's alone — no live resource has carried it.
 */
export const vantaKnowledgeBaseResourceDtoSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...resourceBase,
    downloadPermission: z.enum(["VIEW_ONLY", "VIEW_AND_DOWNLOAD"]).nullable(),
    /** Presigned and valid for one hour, so it is fetched during the sync and never stored as a citation. */
    fileUrl: z.string(),
    type: z.literal("FILE"),
  }),
  z.strictObject({
    ...resourceBase,
    includeSubPages: z.boolean().nullable(),
    type: z.literal("URL"),
    url: z.string(),
  }),
]);

export type VantaKnowledgeBaseResourceDto = z.infer<typeof vantaKnowledgeBaseResourceDtoSchema>;

/**
 * Whether a resource is one whose bytes this atlas fetches.
 *
 * @param dto the resource as the Manage API returned it
 * @returns the presigned file URL when this is a downloadable file, or `null`
 */
export function knowledgeBaseFileUrl({ dto }: { dto: VantaKnowledgeBaseResourceDto }): string | null {
  if (dto.type !== "FILE") {
    return null;
  }
  return dto.fileUrl.length > 0 ? dto.fileUrl : null;
}
