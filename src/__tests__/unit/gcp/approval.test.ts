/**
 * The gate between a previewed GCP write and Google. Pure: both digests are computed before it is built.
 */
import { describe, expect, it } from "vitest";

import { isApprovalGate } from "../../../admit/approval.js";
import type { DoorRequest } from "../../../admit/types.js";
import { gcpWriteApprovalGate } from "../../../gcp/approval.js";

const PREVIEW = "slopweaver gcp services enable --project my-project-01 --service run.googleapis.com";
const NOW = "gcp-0123456789abcdef";

const REQUEST: DoorRequest = {
  action: { kind: "verb", noun: "gcp", verb: "services enable" },
  artifact: {},
  meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: true },
};

describe("gcpWriteApprovalGate", () => {
  it("is an approval gate, so the door accepts it as backing requiresApproval", () => {
    expect(isApprovalGate(gcpWriteApprovalGate({ expected: NOW, preview: PREVIEW, supplied: NOW }))).toBe(true);
  });

  it("raises nothing when the approval is the digest of the plan as it stands", () => {
    expect(gcpWriteApprovalGate({ expected: NOW, preview: PREVIEW, supplied: NOW })(REQUEST)).toEqual([]);
  });

  it("holds a stale approval, naming both digests and the preview that prints the current one", () => {
    const findings = gcpWriteApprovalGate({ expected: NOW, preview: PREVIEW, supplied: "gcp-0000000000000000" })(
      REQUEST,
    );
    expect(findings.map((finding) => [finding.code, finding.severity])).toEqual([["gcp.write-unapproved", "hold"]]);
    expect(findings[0]!.summary).toBe(
      `the approval gcp-0000000000000000 does not match this write (${NOW}) — a resource or the write moved after ` +
        "the preview it was given for",
    );
    expect(findings[0]!.correction).toContain(`run \`${PREVIEW}\` without --approve`);
    expect(findings[0]!.correction).toContain(`--approve ${NOW}`);
    expect(findings[0]!.correction).toContain("There is no override");
  });
});
