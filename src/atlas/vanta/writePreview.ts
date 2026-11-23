/**
 * Resolve the exact HTTP request one Vanta write would send, without sending it — the documents trio
 * (`createDocument`/`uploadEvidence`/`submitDocument`), the two group-membership legs and the two
 * vulnerability monitoring writes. Reuses each
 * client's own path builders and input types — one contract, imported, not replicated — so this can never
 * silently drift from what the real write actually does. Zero network calls, zero token resolution.
 * Destructive writes (`deleteUpload`/`deleteDocument`) have no preview here or anywhere — that line isn't
 * relaxed for a preview.
 *
 * `slopweaver write vanta deactivate --dry-run` and `write vanta reactivate --dry-run` are this function's
 * users, and that is what makes it more than a developer convenience: the dry run is the ONLY thing standing
 * between a composed batch of monitoring rulings and a real change to a compliance posture, so what it
 * prints has to be the bytes, not a description of them. Both vulnerability batches resolve through the
 * client's own serializer, `vantaVulnerabilityBatchBody`, for exactly that reason. An upload's file is the one
 * body part not printed literally — binary does not belong on a terminal — so it is shown as its byte count and
 * SHA-256, the commitment the approval digest then binds.
 */
import { createHash } from "node:crypto";

import { vantaGroupMembershipBody } from "./groupApiSchemas.js";
import { groupLegPath, type VantaGroupBatch } from "./groupWriteClient.js";
import {
  type VantaDeactivateUpdate,
  type VantaReactivateUpdate,
  vantaVulnerabilityBatchBody,
} from "./vulnerabilityApiSchemas.js";
import { vulnerabilitiesDeactivatePath, vulnerabilitiesReactivatePath } from "./vulnerabilityWriteClient.js";
import {
  documentSubmitPath,
  documentsPath,
  documentUploadsPath,
  type VantaCreateDocumentInput,
  type VantaUploadEvidenceInput,
} from "./writeClient.js";

export type VantaWriteRequestInput =
  | { readonly kind: "create-document"; readonly input: VantaCreateDocumentInput }
  | { readonly kind: "upload-evidence"; readonly input: VantaUploadEvidenceInput }
  | { readonly kind: "submit-document"; readonly input: { readonly documentId: string } }
  | { readonly kind: "add-people-to-group"; readonly input: VantaGroupBatch }
  | { readonly kind: "remove-people-from-group"; readonly input: VantaGroupBatch }
  | {
      readonly kind: "deactivate-vulnerabilities";
      readonly input: { readonly updates: readonly VantaDeactivateUpdate[] };
    }
  | {
      readonly kind: "reactivate-vulnerabilities";
      readonly input: { readonly updates: readonly VantaReactivateUpdate[] };
    };

type VantaResolvedWriteBody =
  | { readonly kind: "json"; readonly json: string }
  | { readonly kind: "multipart"; readonly fields: readonly string[] }
  | { readonly kind: "none" };

export interface VantaResolvedWriteRequest {
  readonly method: "POST";
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: VantaResolvedWriteBody;
}

/** Shown in place of a real bearer token — this preview never resolves one. */
const REDACTED_AUTH_HEADER = { authorization: "Bearer <token>" };

/**
 * The multipart field names and metadata a real upload would send, and the file's byte count and SHA-256 — never
 * the file's own bytes.
 *
 * The hash is what makes the approval bind the FILE. `documentApproval.ts` digests this body, so a field naming
 * only the file's name and media type let an approval of one file admit any other file of the same name: swap
 * the bytes on disk after the dry run and the real run recomputed the digest the owner approved. A reader checks it with
 * `shasum -a 256 <path>`, as `policyVersionUpload.ts`'s `pdfSha256` is checked.
 */
function multipartFields({ file, description, effectiveAtDate }: VantaUploadEvidenceInput): readonly string[] {
  const sha256 = createHash("sha256").update(file.content).digest("hex");
  const fields = [`file: ${file.name} (${file.mimeType}, ${String(file.content.byteLength)} bytes, sha256 ${sha256})`];
  if (effectiveAtDate !== null) {
    fields.push(`effectiveAtDate: ${effectiveAtDate}`);
  }
  if (description !== null) {
    fields.push(`description: ${description}`);
  }
  return fields;
}

/**
 * Resolve the request one write kind would send.
 *
 * @param request which write kind, and the same input shape its real client function takes
 * @returns the request that write would send — resolved only, never issued
 */
export function resolveVantaWriteRequest(request: VantaWriteRequestInput): VantaResolvedWriteRequest {
  switch (request.kind) {
    case "create-document":
      return {
        body: { json: JSON.stringify(request.input, null, 2), kind: "json" },
        headers: { ...REDACTED_AUTH_HEADER, "content-type": "application/json" },
        method: "POST",
        path: documentsPath(),
      };
    case "upload-evidence":
      return {
        body: { fields: multipartFields(request.input), kind: "multipart" },
        headers: REDACTED_AUTH_HEADER,
        method: "POST",
        path: documentUploadsPath({ documentId: request.input.documentId }),
      };
    case "submit-document":
      return {
        body: { kind: "none" },
        headers: REDACTED_AUTH_HEADER,
        method: "POST",
        path: documentSubmitPath({ documentId: request.input.documentId }),
      };
    // Both group legs resolve through the CLIENT'S own serializer and path builder, so what a reader
    // approves is the bytes the wire carries. The two cases above pretty-print a body the client sends
    // compact — see `groupApiSchemas.vantaGroupMembershipBody`'s header for that finding.
    case "add-people-to-group":
      return {
        body: { json: vantaGroupMembershipBody({ updates: request.input.updates }), kind: "json" },
        headers: { ...REDACTED_AUTH_HEADER, "content-type": "application/json" },
        method: "POST",
        path: groupLegPath({ direction: "add", groupId: request.input.groupId }),
      };
    case "remove-people-from-group":
      return {
        body: { json: vantaGroupMembershipBody({ updates: request.input.updates }), kind: "json" },
        headers: { ...REDACTED_AUTH_HEADER, "content-type": "application/json" },
        method: "POST",
        path: groupLegPath({ direction: "remove", groupId: request.input.groupId }),
      };
    case "deactivate-vulnerabilities":
      return {
        body: { json: vantaVulnerabilityBatchBody({ updates: request.input.updates }), kind: "json" },
        headers: { ...REDACTED_AUTH_HEADER, "content-type": "application/json" },
        method: "POST",
        path: vulnerabilitiesDeactivatePath(),
      };
    case "reactivate-vulnerabilities":
      return {
        body: { json: vantaVulnerabilityBatchBody({ updates: request.input.updates }), kind: "json" },
        headers: { ...REDACTED_AUTH_HEADER, "content-type": "application/json" },
        method: "POST",
        path: vulnerabilitiesReactivatePath(),
      };
  }
}
