/**
 * The door gate that stands between a resolved document write and a real compliance record.
 *
 * The same shape `deactivateApproval.ts` carries, and for the same reason rather than for symmetry: an
 * evidence document is what an auditor reads, `submitDocument` advances one into review, and the Manage API
 * surface here has no update call at all — so a title or a description typed wrong is not editable
 * afterwards through this door. That makes a second deliberate act, taken with the exact request on screen,
 * worth the friction.
 *
 * A `hold` rather than a `warn`, for the reason `deactivateApproval.ts` states: a `warn` must carry an
 * override token, and an environment variable an agent can set is not an owner.
 *
 * **It does not authenticate a human.** The same process that prints the digest can compute it. What it
 * buys is that the write is a SECOND deliberate act against a request that cannot have changed underneath
 * it, and that the unapproved attempt is refused AT THE DOOR and recorded rather than silently skipped.
 */
import { createHash } from "node:crypto";

import { type ApprovalGate, approvalGate } from "../../admit/approval.js";
import type { DoorFinding } from "../../admit/types.js";
import type { VantaResolvedWriteRequest } from "./writePreview.js";

/** How many hex characters of the approval digest are printed and compared — as `write vanta deactivate` uses. */
const DIGEST_WIDTH = 16;

/** The finding code an unapproved or mismatched document write fires. */
export const DOCUMENT_UNAPPROVED_CODE = "vanta.document-unapproved";

/**
 * The digest an approval is bound to: a hash over exactly the request that would be sent, and nothing else.
 *
 * Taken over the RESOLVED request rather than the caller's flags, so it covers the method, the path and the
 * body as `writePreview.ts` renders them — which is what `--dry-run` puts on screen. An upload's body carries the
 * file's byte count and SHA-256, never its bytes, so the digest binds the FILE and not merely its name. The clock,
 * the home and the `--json` choice are not in it, because none of them is what a reader checked.
 *
 * @param request the request as `resolveVantaWriteRequest` resolved it
 * @returns the leading hex characters of the SHA-256 over the canonical request
 */
export function vantaDocumentDigest({ request }: { request: VantaResolvedWriteRequest }): string {
  const canonical = JSON.stringify({ body: request.body, method: request.method, path: request.path });
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, DIGEST_WIDTH);
}

/**
 * Build the gate for one resolved document write.
 *
 * @param expected the digest of the request as it stands right now
 * @param supplied what the caller passed to `--approve`, `null` when they passed nothing
 * @returns an `ApprovalGate` that holds unless the two match exactly
 */
export function vantaDocumentApprovalGate({
  expected,
  supplied,
}: {
  expected: string;
  supplied: string | null;
}): ApprovalGate {
  const gate = (): readonly DoorFinding[] => {
    if (supplied === expected) {
      return [];
    }
    const summary =
      supplied === null
        ? "this document write has not been approved — an evidence document is what an auditor reads, and " +
          "this API surface has no way to edit one afterwards"
        : `the approval ${supplied} does not match this request (${expected}) — it was approved, then it changed`;
    return [
      {
        code: DOCUMENT_UNAPPROVED_CODE,
        correction:
          `run --dry-run to see the exact request, then re-run with --approve ${expected}. ` +
          "That digest covers the method, the path and every byte of the body exactly as shown, an upload's " +
          "file SHA-256 included; changing any of them invalidates it. There is no override — this hold is not waivable by " +
          "$SLOPWEAVER_DOOR_OVERRIDE",
        severity: "hold",
        summary,
      },
    ];
  };
  return approvalGate({ gate });
}
