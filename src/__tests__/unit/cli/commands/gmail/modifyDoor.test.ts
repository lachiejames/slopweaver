/**
 * The door request one Gmail mutation makes: the verb named from the intent's first word, and an artifact of ids,
 * labels and a count only. A plan carrying a subject-like label name proves nothing of the mail's content reaches it.
 */
import { describe, expect, it } from "vitest";

import { modifyDoorRequest } from "../../../../../cli/commands/gmail/modifyDoor.js";
import type { GmailModifyPlan } from "../../../../../live/gmail/modify.js";

/** A thread-scoped plan over two messages, adding one label and removing another. */
const PLAN: GmailModifyPlan = {
  account: "owner@example.test",
  address: "t-1",
  before: [
    { id: "m-1", labelIds: ["INBOX", "UNREAD"] },
    { id: "m-2", labelIds: ["INBOX"] },
  ],
  intent: "label +Waiting on",
  labelNames: { INBOX: "INBOX", Label_7: "Waiting on" },
  plan: { addLabelIds: ["Label_7"], noop: false, removeLabelIds: ["INBOX"] },
  scope: "thread",
};

describe("modifyDoorRequest", () => {
  it("names the verb from the intent's first word and carries ids, labels and a count only", () => {
    expect(modifyDoorRequest({ home: "/fixture/home", plan: PLAN })).toStrictEqual({
      action: { kind: "verb", noun: "gmail", verb: "label" },
      artifact: {
        addLabelIds: ["Label_7"],
        address: "t-1",
        messages: 2,
        removeLabelIds: ["INBOX"],
        scope: "thread",
      },
      meta: { createsWorkItem: false, effect: "external-write", home: "/fixture/home", requiresApproval: false },
    });
  });

  it("names an empty verb for an empty intent rather than throwing", () => {
    expect(modifyDoorRequest({ home: "/fixture/home", plan: { ...PLAN, intent: "" } })).toStrictEqual({
      action: { kind: "verb", noun: "gmail", verb: "" },
      artifact: {
        addLabelIds: ["Label_7"],
        address: "t-1",
        messages: 2,
        removeLabelIds: ["INBOX"],
        scope: "thread",
      },
      meta: { createsWorkItem: false, effect: "external-write", home: "/fixture/home", requiresApproval: false },
    });
  });
});
