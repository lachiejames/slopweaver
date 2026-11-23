/**
 * The digest an approval is bound to, and the gate that compares it. Pure: no home, no clock, no network.
 */
import { describe, expect, it } from "vitest";

import { isApprovalGate } from "../../../../admit/approval.js";
import type { DoorRequest } from "../../../../admit/types.js";
import {
  DEACTIVATE_UNAPPROVED_CODE,
  vantaDeactivateApprovalGate,
  vantaDeactivateDigest,
} from "../../../../atlas/vanta/deactivateApproval.js";
import type { VantaDeactivateUpdate } from "../../../../atlas/vanta/vulnerabilityApiSchemas.js";

const BATCH: readonly VantaDeactivateUpdate[] = [
  { deactivateReason: "not reachable in our usage", id: "v_1", shouldReactivateWhenFixable: false },
];

const REQUEST: DoorRequest = {
  action: { kind: "verb", noun: "write", verb: "vanta deactivate" },
  artifact: {},
  meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: true },
};

describe("vantaDeactivateDigest", () => {
  it("is stable for the same batch", () => {
    expect(vantaDeactivateDigest({ updates: BATCH })).toBe(vantaDeactivateDigest({ updates: BATCH }));
  });

  it("is 16 hex characters, so it can be typed back by hand", () => {
    expect(vantaDeactivateDigest({ updates: BATCH })).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when the reason changes, because the reason is the part an auditor reads", () => {
    const edited = [{ ...BATCH[0]!, deactivateReason: "wontfix" }];
    expect(vantaDeactivateDigest({ updates: edited })).not.toBe(vantaDeactivateDigest({ updates: BATCH }));
  });

  it("changes when a finding is added to the batch", () => {
    const widened = [...BATCH, { deactivateReason: "same", id: "v_2", shouldReactivateWhenFixable: false }];
    expect(vantaDeactivateDigest({ updates: widened })).not.toBe(vantaDeactivateDigest({ updates: BATCH }));
  });

  it("changes when an until-date appears, so an indefinite approval never admits a dated batch", () => {
    const dated = [{ ...BATCH[0]!, deactivateUntilDate: "2027-01-01" }];
    expect(vantaDeactivateDigest({ updates: dated })).not.toBe(vantaDeactivateDigest({ updates: BATCH }));
  });

  it("changes when the reopen-when-fixable flag flips", () => {
    const reopening = [{ ...BATCH[0]!, shouldReactivateWhenFixable: true }];
    expect(vantaDeactivateDigest({ updates: reopening })).not.toBe(vantaDeactivateDigest({ updates: BATCH }));
  });

  it("changes when two findings swap places — a reader checked THAT list", () => {
    const second = { deactivateReason: "same", id: "v_2", shouldReactivateWhenFixable: false };
    const forwards = vantaDeactivateDigest({ updates: [BATCH[0]!, second] });
    const backwards = vantaDeactivateDigest({ updates: [second, BATCH[0]!] });
    expect(forwards).not.toBe(backwards);
  });

  it("is empty-batch safe, so the digest is defined before the batch rules refuse one", () => {
    expect(vantaDeactivateDigest({ updates: [] })).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("vantaDeactivateApprovalGate", () => {
  const expected = vantaDeactivateDigest({ updates: BATCH });

  it("is marked as an approval gate, which is what lets the verb declare requiresApproval", () => {
    expect(isApprovalGate(vantaDeactivateApprovalGate({ expected, supplied: null }))).toBe(true);
  });

  it("holds with nothing supplied, and says stopping monitoring is not an agent's call alone", () => {
    const findings = vantaDeactivateApprovalGate({ expected, supplied: null })(REQUEST);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe(DEACTIVATE_UNAPPROVED_CODE);
    expect(findings[0]!.severity).toBe("hold");
    expect(findings[0]!.summary).toBe(
      "this deactivation has not been approved — stopping monitoring on a finding is not an agent's to decide alone",
    );
  });

  it("puts the digest to type in the correction, so the refusal carries its own fix", () => {
    const findings = vantaDeactivateApprovalGate({ expected, supplied: null })(REQUEST);
    expect(findings[0]!.correction).toContain(`--approve ${expected}`);
  });

  it("holds a stale approval and names both digests, because the batch changed after it was approved", () => {
    const findings = vantaDeactivateApprovalGate({ expected, supplied: "0000000000000000" })(REQUEST);
    expect(findings[0]!.summary).toBe(
      `the approval 0000000000000000 does not match this batch (${expected}) — it was approved, then it changed`,
    );
  });

  it("passes the exact digest", () => {
    expect(vantaDeactivateApprovalGate({ expected, supplied: expected })(REQUEST)).toEqual([]);
  });
});
