/**
 * The pure half of pushing a reviewed policy's markdown into Vanta as a DRAFT version: what an upload is bound
 * to, the digest that binds it, and the gate that stands in front of it.
 *
 * ## The digest covers the BYTES, never the path
 *
 * An approval that named a file name would be satisfied by a different file with the same name, and the
 * whole point of the second act is that it is taken with the exact document on screen. So the digest covers
 * the policy, the page, the markdown the reviewer approved, the SHA-256 of the PDF, and the fact that the
 * disposition is `draft-only`. Re-render the markdown and the digest moves.
 *
 * ## Draft-only is part of what is approved, not a flag beside it
 *
 * The owner's ruling: a policy is not published in Vanta, because every publish of a change marks
 * everyone as not having approved the policy and makes a bunch of controls fail. There is deliberately no `publish` value this type can take, so there is nothing for a future
 * caller to set. Publishing a policy version is the owner's act and this program has no arm for it.
 */
import { createHash } from "node:crypto";

import { type ApprovalGate, approvalGate } from "../../admit/approval.js";
import type { DoorFinding } from "../../admit/types.js";

/** How many hex characters of the approval digest are printed and compared — as the sibling gates use. */
const DIGEST_WIDTH = 16;

/** The finding code an unapproved or mismatched policy-version upload fires. */
export const UPLOAD_POLICY_VERSION_UNAPPROVED_CODE = "vanta.upload-policy-version-unapproved";

/** One upload, resolved against the exact bytes it would attach. */
export interface VantaPolicyUploadPlan {
  /** Versioned, so a digest computed under one shape can never be honoured under another. */
  readonly kind: "vanta-policy-version-upload-v1";
  readonly policyId: string;
  /** The policy page the renewal is started from. */
  readonly url: string;
  /** SHA-256 of the policy markdown the reviewer approved. */
  readonly markdownSha256: string;
  /** SHA-256 of the exact PDF bytes that would be attached. */
  readonly pdfSha256: string;
  /** The commit the markdown was taken from, so the upload names its own provenance. */
  readonly sourceCommit: string;
  /** The only disposition this type can take. */
  readonly disposition: "draft-only";
}

/**
 * The digest one upload is approved by.
 *
 * @param plan the resolved upload
 * @returns the first {@link DIGEST_WIDTH} hex characters of the plan's SHA-256
 */
export function vantaPolicyUploadDigest({ plan }: { plan: VantaPolicyUploadPlan }): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, DIGEST_WIDTH);
}

/**
 * Build the gate for one upload.
 *
 * Pure by construction: both digests are computed before the gate exists, so it cannot reach a browser
 * mid-decision. A `hold` rather than a `warn` for the reason `policyDraftApproval.ts` gives — a `warn`
 * carries an override token, and an environment variable an agent can set is not an owner.
 *
 * @param expected the digest of the upload as it stands
 * @param supplied what the caller passed to `--approve`, `null` when they passed nothing
 * @returns a gate that holds unless the two match exactly
 */
export function vantaUploadPolicyVersionApprovalGate({
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
        ? "this policy version has not been approved — starting a renewal creates a draft of a document an " +
          "auditor reads, and that is not an agent's to decide alone"
        : `the approval ${supplied} does not match this upload (${expected}) — it was approved, then either ` +
          "the markdown or the rendered PDF moved";
    return [
      {
        code: UPLOAD_POLICY_VERSION_UNAPPROVED_CODE,
        correction:
          `run --dry-run to see exactly what would be attached, then re-run with --approve ${expected}. ` +
          "That digest covers the policy, the page, the approved markdown, the PDF's own bytes and the " +
          "draft-only disposition, so re-rendering the markdown invalidates it. There is no override — " +
          "this hold is not waivable by $SLOPWEAVER_DOOR_OVERRIDE",
        severity: "hold",
        summary,
      },
    ];
  };
  return approvalGate({ gate });
}
