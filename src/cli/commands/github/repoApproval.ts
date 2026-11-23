/**
 * The door gate between a previewed repository rename, transfer, archive, create, visibility change or Actions
 * policy and GitHub — the shape of
 * `../../../gcp/approval.ts`, and a `hold` for the same reason: each of these writes is irreversible from this
 * side, and an environment variable an agent can set is not the owner's yes.
 *
 * The gate compares the digest supplied with `--approve` against the digest of the plan rebuilt from a FRESH
 * read at write time, so an approval cannot be transplanted onto a write nobody previewed, and a repository that
 * moved, was renamed or was archived since the preview invalidates it. It does not authenticate a human (as
 * `../../../admit/approval.ts` states): it makes the write a second deliberate step over exact content, and
 * records an unapproved attempt in the door ledger.
 */
import { type ApprovalGate, approvalGate } from "../../../admit/approval.js";
import type { DoorFinding } from "../../../admit/types.js";

/** The finding code an unapproved or mismatched repository administration write fires. */
const GITHUB_REPO_WRITE_UNAPPROVED_CODE = "github.repo-write-unapproved";

/**
 * Build the gate for one repository administration write.
 *
 * Pure by construction: both digests are computed by the caller before the gate is built.
 *
 * @param expected the digest of the plan as it stands right now
 * @param supplied what the caller passed to `--approve`
 * @param preview the command that prints the preview and its digest, for the correction line
 * @returns an `ApprovalGate` that holds unless the two match exactly
 */
export function githubRepoWriteApprovalGate({
  expected,
  supplied,
  preview,
}: {
  expected: string;
  supplied: string;
  preview: string;
}): ApprovalGate {
  const gate = (): readonly DoorFinding[] => {
    if (supplied === expected) {
      return [];
    }
    return [
      {
        code: GITHUB_REPO_WRITE_UNAPPROVED_CODE,
        correction:
          `run \`${preview}\` to see the write as it stands now, then re-run it with --approve ${expected} once ` +
          "that has been approved. The digest covers the live state the preview read (for an existing repository, " +
          "its id among it) and the exact change; any drift invalidates it. There is no override — this hold is " +
          "not waivable by " +
          "$SLOPWEAVER_DOOR_OVERRIDE",
        severity: "hold",
        summary:
          `the approval ${supplied} does not match this write (${expected}) — the repository or the write moved ` +
          "after the preview it was given for",
      },
    ];
  };
  return approvalGate({ gate });
}
