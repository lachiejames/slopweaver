/**
 * The gate standing between a resolved group-membership plan and a real change to what people are obliged
 * to do: what the digest covers, what it deliberately does not, and that the hold carries no override.
 */
import { describe, expect, it } from "vitest";

import { isApprovalGate } from "../../../../admit/approval.js";
import {
  GROUP_MEMBERSHIP_UNAPPROVED_CODE,
  vantaGroupMembershipApprovalGate,
  vantaGroupMembershipDigest,
} from "../../../../atlas/vanta/groupMembershipApproval.js";
import { resolveVantaWriteRequest } from "../../../../atlas/vanta/writePreview.js";

const legs = ({
  groupId,
  add,
  remove,
}: {
  groupId: string;
  add: readonly string[];
  remove: readonly string[];
}): readonly ReturnType<typeof resolveVantaWriteRequest>[] => [
  resolveVantaWriteRequest({
    input: { groupId, updates: add.map((id) => ({ id })) },
    kind: "add-people-to-group",
  }),
  resolveVantaWriteRequest({
    input: { groupId, updates: remove.map((id) => ({ id })) },
    kind: "remove-people-from-group",
  }),
];

const PLAN = legs({ add: ["p1", "p2"], groupId: "g1", remove: ["p3"] });
const DIGEST = vantaGroupMembershipDigest({ requests: PLAN });

/** The door request shape the gate is handed; the gate reads none of it, so a minimal one is honest here. */
const DOOR_REQUEST = {
  action: { kind: "verb", noun: "write", verb: "vanta group-people" },
  artifact: { added: ["p1", "p2"], digest: DIGEST, group: "g1", removed: ["p3"] },
  meta: { createsWorkItem: false, effect: "external-write", home: "/home", requiresApproval: true },
} as const;

describe("vantaGroupMembershipDigest", () => {
  it("is sixteen hex characters, as the other Vanta gates print", () => {
    expect(DIGEST).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is a fixed vector for a fixed plan, so a reader can quote it", () => {
    expect(DIGEST).toBe(
      vantaGroupMembershipDigest({ requests: legs({ add: ["p1", "p2"], groupId: "g1", remove: ["p3"] }) }),
    );
  });

  it("stops matching when the group changes, so an approval cannot be transplanted", () => {
    const other = vantaGroupMembershipDigest({ requests: legs({ add: ["p1", "p2"], groupId: "g2", remove: ["p3"] }) });
    expect(other).not.toBe(DIGEST);
  });

  it("stops matching when one person joins the add side", () => {
    const other = vantaGroupMembershipDigest({
      requests: legs({ add: ["p1", "p2", "p4"], groupId: "g1", remove: ["p3"] }),
    });
    expect(other).not.toBe(DIGEST);
  });

  it("stops matching when one person joins the remove side", () => {
    const other = vantaGroupMembershipDigest({
      requests: legs({ add: ["p1", "p2"], groupId: "g1", remove: ["p3", "p4"] }),
    });
    expect(other).not.toBe(DIGEST);
  });

  it("stops matching when the people are reordered inside one leg", () => {
    const other = vantaGroupMembershipDigest({ requests: legs({ add: ["p2", "p1"], groupId: "g1", remove: ["p3"] }) });
    expect(other).not.toBe(DIGEST);
  });

  it("stops matching when the two legs swap order, because they are not a transaction", () => {
    const [add, remove] = PLAN;
    expect(vantaGroupMembershipDigest({ requests: [remove!, add!] })).not.toBe(DIGEST);
  });

  it("covers a one-leg plan differently from the two-leg plan carrying the same people", () => {
    const addOnly = vantaGroupMembershipDigest({
      requests: [
        resolveVantaWriteRequest({ input: { groupId: "g1", updates: [{ id: "p1" }] }, kind: "add-people-to-group" }),
      ],
    });
    expect(addOnly).not.toBe(DIGEST);
  });
});

describe("vantaGroupMembershipApprovalGate", () => {
  it("is recognised by the door as an approval gate", () => {
    expect(isApprovalGate(vantaGroupMembershipApprovalGate({ expected: DIGEST, supplied: DIGEST }))).toBe(true);
  });

  it("passes when the supplied digest matches exactly", () => {
    expect(vantaGroupMembershipApprovalGate({ expected: DIGEST, supplied: DIGEST })(DOOR_REQUEST)).toEqual([]);
  });

  it("holds when nothing was approved, and says what a group change costs", () => {
    const findings = vantaGroupMembershipApprovalGate({ expected: DIGEST, supplied: null })(DOOR_REQUEST);
    expect(findings.length).toBe(1);
    expect(findings[0]!.code).toBe(GROUP_MEMBERSHIP_UNAPPROVED_CODE);
    expect(findings[0]!.severity).toBe("hold");
    expect(findings[0]!.summary).toContain("has not been approved");
  });

  it("holds on a digest that approved a DIFFERENT plan, and names both", () => {
    const findings = vantaGroupMembershipApprovalGate({ expected: DIGEST, supplied: "0000000000000000" })(DOOR_REQUEST);
    expect(findings[0]!.summary).toBe(
      `the approval 0000000000000000 does not match this plan (${DIGEST}) — it was approved, then it changed`,
    );
  });

  it("puts the digest a caller needs in the correction, not only in the summary", () => {
    const findings = vantaGroupMembershipApprovalGate({ expected: DIGEST, supplied: null })(DOOR_REQUEST);
    expect(findings[0]!.correction).toContain(`--approve ${DIGEST}`);
  });

  it("carries no override token, so $SLOPWEAVER_DOOR_OVERRIDE cannot waive it", () => {
    const findings = vantaGroupMembershipApprovalGate({ expected: DIGEST, supplied: null })(DOOR_REQUEST);
    expect(findings[0]!.correction).toContain("There is no override");
    expect(Object.keys(findings[0]!)).toEqual(["code", "correction", "severity", "summary"]);
  });

  it("holds on a prefix of the right digest rather than accepting a partial match", () => {
    const findings = vantaGroupMembershipApprovalGate({ expected: DIGEST, supplied: DIGEST.slice(0, 8) })(DOOR_REQUEST);
    expect(findings[0]!.severity).toBe("hold");
  });
});
