/**
 * The digest a reactivation approval is bound to, and the gate that compares it. Pure: no home, no clock,
 * no network.
 */
import { describe, expect, it } from "vitest";

import { isApprovalGate } from "../../../../admit/approval.js";
import type { DoorRequest } from "../../../../admit/types.js";
import {
  REACTIVATE_UNAPPROVED_CODE,
  vantaReactivateApprovalGate,
  vantaReactivateDigest,
} from "../../../../atlas/vanta/reactivateApproval.js";
import type { VantaReactivateUpdate } from "../../../../atlas/vanta/vulnerabilityApiSchemas.js";
import { resolveVantaWriteRequest } from "../../../../atlas/vanta/writePreview.js";

const REQUEST: DoorRequest = {
  action: { kind: "verb", noun: "write", verb: "vanta reactivate" },
  artifact: {},
  meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: true },
};

/** The digest of the reactivation request that would carry exactly these ids. */
function digestOf({ updates }: { updates: readonly VantaReactivateUpdate[] }): string {
  return vantaReactivateDigest({
    request: resolveVantaWriteRequest({ input: { updates }, kind: "reactivate-vulnerabilities" }),
  });
}

describe("vantaReactivateDigest", () => {
  it("is 16 hex characters, stable for the same batch", () => {
    const digest = digestOf({ updates: [{ id: "v_1" }] });
    expect(digest).toMatch(/^[0-9a-f]{16}$/);
    expect(digestOf({ updates: [{ id: "v_1" }] })).toBe(digest);
  });

  it("changes when a finding is added", () => {
    expect(digestOf({ updates: [{ id: "v_1" }, { id: "v_2" }] })).not.toBe(digestOf({ updates: [{ id: "v_1" }] }));
  });

  it("changes when two findings swap places", () => {
    expect(digestOf({ updates: [{ id: "v_1" }, { id: "v_2" }] })).not.toBe(
      digestOf({ updates: [{ id: "v_2" }, { id: "v_1" }] }),
    );
  });

  it("differs from the deactivate route's digest over the same ids, because the route is covered", () => {
    const deactivate = resolveVantaWriteRequest({
      input: { updates: [{ deactivateReason: "r", id: "v_1", shouldReactivateWhenFixable: false }] },
      kind: "deactivate-vulnerabilities",
    });
    const sameIdsOtherRoute = { ...deactivate, body: { json: '{"updates":[{"id":"v_1"}]}', kind: "json" as const } };
    expect(vantaReactivateDigest({ request: sameIdsOtherRoute })).not.toBe(digestOf({ updates: [{ id: "v_1" }] }));
  });
});

describe("vantaReactivateApprovalGate", () => {
  const expected = digestOf({ updates: [{ id: "v_1" }] });

  it("is marked as an approval gate, which is what lets the verb declare requiresApproval", () => {
    expect(isApprovalGate(vantaReactivateApprovalGate({ expected, supplied: null }))).toBe(true);
  });

  it("holds with nothing supplied, and puts the digest to type in the correction", () => {
    const findings = vantaReactivateApprovalGate({ expected, supplied: null })(REQUEST);
    expect(findings.map((finding) => [finding.code, finding.severity])).toEqual([[REACTIVATE_UNAPPROVED_CODE, "hold"]]);
    expect(findings[0]!.correction).toContain(`--approve ${expected}`);
  });

  it("holds a stale approval and names both digests", () => {
    const findings = vantaReactivateApprovalGate({ expected, supplied: "0000000000000000" })(REQUEST);
    expect(findings[0]!.summary).toBe(
      `the approval 0000000000000000 does not match this batch (${expected}) — it was approved, then it changed`,
    );
  });

  it("passes the exact digest", () => {
    expect(vantaReactivateApprovalGate({ expected, supplied: expected })(REQUEST)).toEqual([]);
  });
});
