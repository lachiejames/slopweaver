/**
 * Unit: the calendar write approval gate. It is a `hold` with no override token, and the door refuses a
 * request declaring `requiresApproval` unless a gate built by `approvalGate` decides it.
 */
import { describe, expect, it } from "vitest";
import { isApprovalGate } from "../../../../admit/approval.js";
import { admitDoor } from "../../../../admit/door.js";
import type { DoorRequest } from "../../../../admit/types.js";
import {
  CALENDAR_WRITE_UNAPPROVED_CODE,
  calendarWriteApprovalGate,
} from "../../../../outbound/calendar/approvalGate.js";

const DIGEST = "9c1e4b7a2d5f8e01";
const ANCHOR = "talk-call:a0000024-0000-4000-8000-000000000027#turn_000000000000000000020";

const REQUEST: DoorRequest = {
  action: { kind: "verb", noun: "calendar", verb: "book" },
  artifact: { intentId: "intent-1" },
  meta: { createsWorkItem: false, effect: "external-write", home: "/tmp/home", requiresApproval: true },
};

describe("calendarWriteApprovalGate", () => {
  it("is marked as an approval gate, which is what lets a request declare requiresApproval at all", () => {
    const approval = { digest: DIGEST, kind: "digest" } as const;
    expect(isApprovalGate(calendarWriteApprovalGate({ approval, expected: DIGEST, intentId: "i" }))).toBe(true);
  });

  it("holds with no approval, and routes to the owner's anchored yes rather than asking for a digest", () => {
    const findings = calendarWriteApprovalGate({ approval: undefined, expected: DIGEST, intentId: "intent-1" })(
      REQUEST,
    );
    expect(findings.length).toBe(1);
    expect(findings[0]!.code).toBe(CALENDAR_WRITE_UNAPPROVED_CODE);
    expect(findings[0]!.severity).toBe("hold");
    expect(findings[0]!.correction).toContain(
      "once the owner says yes, run: slopweaver calendar commit intent-1 --anchor <where the owner said yes>",
    );
    expect(findings[0]!.correction).toContain("Never ask the owner for a digest");
  });

  it("holds on a digest that does not match, and says it was approved then changed", () => {
    const findings = calendarWriteApprovalGate({
      approval: { digest: "0000000000000000", kind: "digest" },
      expected: DIGEST,
      intentId: "intent-1",
    })(REQUEST);
    expect(findings[0]!.summary).toContain("it was approved, then the event or the form changed");
  });

  it("passes on the exact digest", () => {
    const approval = { digest: DIGEST, kind: "digest" } as const;
    expect(calendarWriteApprovalGate({ approval, expected: DIGEST, intentId: "intent-1" })(REQUEST)).toStrictEqual([]);
  });

  it("passes an anchored yes whose previewed digest is the plan as it stands now", () => {
    const approval = { anchor: ANCHOR, kind: "anchor", previewDigest: DIGEST } as const;
    expect(calendarWriteApprovalGate({ approval, expected: DIGEST, intentId: "intent-1" })(REQUEST)).toStrictEqual([]);
  });

  it("holds an anchored yes given over a preview the event has since drifted from, naming both digests", () => {
    const approval = { anchor: ANCHOR, kind: "anchor", previewDigest: "0000000000000000" } as const;
    const findings = calendarWriteApprovalGate({ approval, expected: DIGEST, intentId: "intent-1" })(REQUEST);
    expect(findings[0]!.summary).toBe(
      `the owner's yes at ${ANCHOR} was given over the preview 0000000000000000, and this write now digests to ${DIGEST} — the event or the form changed since it was shown`,
    );
    expect(findings[0]!.correction).toContain("re-run the verb for a fresh preview");
  });

  it("is not waivable: the door still HOLDS with an override token set for every action", () => {
    const decision = admitDoor({
      env: { SLOPWEAVER_DOOR_OVERRIDE: "*" },
      gates: [calendarWriteApprovalGate({ approval: undefined, expected: DIGEST, intentId: "intent-1" })],
      request: REQUEST,
    });
    expect(decision.status).toBe("hold");
    expect(decision.overridden).toStrictEqual([]);
  });

  it("the door REFUSES a requiresApproval request carrying no approval gate, so the claim cannot be decorative", () => {
    expect(admitDoor({ env: {}, gates: [], request: REQUEST }).status).toBe("hold");
  });
});
