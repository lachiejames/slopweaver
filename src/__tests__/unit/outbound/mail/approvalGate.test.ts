/**
 * The shared mail send gate under the Outlook door's own finding code. Gmail's wrapper is pinned in
 * `../gmail/approvalGate.test.ts`; this pins that the code a caller passes is the code a refusal carries, and
 * that the hold survives every override token — so a refused Outlook send names its own door in the ledger.
 */
import { describe, expect, it } from "vitest";
import { isApprovalGate } from "../../../../admit/approval.js";
import { admitDoor } from "../../../../admit/door.js";
import type { DoorRequest } from "../../../../admit/types.js";
import { OUTLOOK_SEND_UNAPPROVED_CODE } from "../../../../cli/commands/outlook/composeRun.js";
import { mailSendApprovalGate } from "../../../../outbound/mail/approvalGate.js";

const request: DoorRequest = {
  action: { kind: "verb", noun: "outlook", verb: "send" },
  artifact: { bcc: 0, cc: 0, digest: "aaaa", to: 1 },
  meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: true },
};

describe("mailSendApprovalGate", () => {
  it("is marked as the gate that decides approval", () => {
    expect(
      isApprovalGate(mailSendApprovalGate({ code: OUTLOOK_SEND_UNAPPROVED_CODE, expected: "aaaa", supplied: "aaaa" })),
    ).toBe(true);
  });

  it("fires under the code its caller passed", () => {
    const [finding] = mailSendApprovalGate({
      code: OUTLOOK_SEND_UNAPPROVED_CODE,
      expected: "aaaa",
      supplied: undefined,
    })(request);
    expect(finding!.code).toBe("outlook.send-unapproved");
    expect(finding!.severity).toBe("hold");
  });

  it("never echoes a mismatched --approve value into the ledgered summary, naming only the computed digest", () => {
    const [finding] = mailSendApprovalGate({
      code: OUTLOOK_SEND_UNAPPROVED_CODE,
      expected: "aaaa",
      supplied: "someone@example.test",
    })(request);
    expect(finding!.summary).toBe(
      "the approval supplied does not match this draft (now aaaa) — it was approved, then it changed",
    );
    expect(JSON.stringify(finding)).not.toContain("someone@example.test");
  });

  it("stays a hold with the Outlook code named in the override", () => {
    const decision = admitDoor({
      env: { SLOPWEAVER_DOOR_OVERRIDE: `${OUTLOOK_SEND_UNAPPROVED_CODE},outlook.send` },
      gates: [mailSendApprovalGate({ code: OUTLOOK_SEND_UNAPPROVED_CODE, expected: "aaaa", supplied: "bbbb" })],
      request,
    });
    expect(decision.status).toBe("hold");
    expect(decision.overridden).toEqual([]);
  });
});
