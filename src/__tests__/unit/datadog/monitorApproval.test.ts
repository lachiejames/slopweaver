/**
 * The gate between a previewed monitor change and Datadog. Pure: both digests are computed before it is built.
 */
import { describe, expect, it } from "vitest";

import { isApprovalGate } from "../../../admit/approval.js";
import type { DoorRequest } from "../../../admit/types.js";
import { MONITOR_WRITE_UNAPPROVED_CODE, monitorWriteApprovalGate } from "../../../datadog/monitorApproval.js";

const PREVIEW = "slopweaver datadog monitor update";
const NOW = "0123456789abcdef";

const REQUEST: DoorRequest = {
  action: { kind: "verb", noun: "datadog", verb: "monitor update" },
  artifact: {},
  meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: true },
};

describe("monitorWriteApprovalGate", () => {
  it("is an approval gate, so the door accepts it as backing requiresApproval", () => {
    expect(isApprovalGate(monitorWriteApprovalGate({ expected: NOW, preview: PREVIEW, supplied: NOW }))).toBe(true);
  });

  it("raises nothing when the approval is the digest of the change as it stands", () => {
    expect(monitorWriteApprovalGate({ expected: NOW, preview: PREVIEW, supplied: NOW })(REQUEST)).toEqual([]);
  });

  it("holds a stale approval, naming the digest that would apply now and the preview that prints it", () => {
    const [finding] = monitorWriteApprovalGate({ expected: NOW, preview: PREVIEW, supplied: "fedcba9876543210" })(
      REQUEST,
    );
    expect(finding).toMatchObject({ code: MONITOR_WRITE_UNAPPROVED_CODE, severity: "hold" });
    expect(finding?.correction).toContain(`--approve ${NOW}`);
    expect(finding?.correction).toContain(PREVIEW);
  });
});
