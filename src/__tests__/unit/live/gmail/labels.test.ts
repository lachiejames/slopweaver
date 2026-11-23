/** Unit: the pure label vocabulary — name/id resolution, the TRASH/SPAM rail, and the two planners. */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  type GmailLabel,
  labelType,
  planLabelChange,
  planThreadLabelChange,
  rejectUnaddableLabels,
  resolveLabelRef,
  resolveLabelRefs,
  SYSTEM_LABELS,
} from "../../../../live/gmail/labels.js";

const LABELS: readonly GmailLabel[] = [
  { id: "INBOX", name: "INBOX", type: "system" },
  { id: "UNREAD", name: "UNREAD", type: "system" },
  { id: "IMPORTANT", name: "IMPORTANT", type: "system" },
  { id: "Label_7", name: "Waiting on", type: "user" },
  { id: "Label_8", name: "Clients/Othercompany", type: "user" },
];

describe("labelType", () => {
  it("keeps a built-in label as system", () => {
    expect(labelType({ type: "system" })).toBe("system");
  });

  it("treats a person's label, an unknown kind and an absent one alike as user", () => {
    expect(labelType({ type: "user" })).toBe("user");
    expect(labelType({ type: "something-new" })).toBe("user");
    expect(labelType({ type: null })).toBe("user");
    expect(labelType({ type: undefined })).toBe("user");
  });
});

describe("resolveLabelRef", () => {
  it("resolves a user label's display name to its opaque id", () => {
    expect(unwrap(resolveLabelRef({ labels: LABELS, ref: "Waiting on" }))).toBe("Label_7");
  });

  it("matches a display name case-insensitively, because the Gmail label picker does", () => {
    expect(unwrap(resolveLabelRef({ labels: LABELS, ref: "waiting ON" }))).toBe("Label_7");
  });

  it("resolves a nested label by its full slash-separated name", () => {
    expect(unwrap(resolveLabelRef({ labels: LABELS, ref: "Clients/Othercompany" }))).toBe("Label_8");
  });

  it("resolves a raw id that matches no name", () => {
    expect(unwrap(resolveLabelRef({ labels: LABELS, ref: "Label_8" }))).toBe("Label_8");
  });

  it("resolves a system label, whose id and name are the same string", () => {
    expect(unwrap(resolveLabelRef({ labels: LABELS, ref: "INBOX" }))).toBe("INBOX");
  });

  it("refuses rather than guessing when a user label collides case-insensitively with a system one", () => {
    // A system label's name IS its id, so "name first" cannot break this tie. Gmail's own interface will not
    // create such a label; the resolver guards it because it takes whatever vocabulary the API returns.
    const shadowing: readonly GmailLabel[] = [
      { id: "IMPORTANT", name: "IMPORTANT", type: "system" },
      { id: "Label_9", name: "important", type: "user" },
    ];
    const failed = resolveLabelRef({ labels: shadowing, ref: "important" });
    expect(failed.isErr()).toBe(true);
    expect(unwrapErr(failed).message).toContain("IMPORTANT, Label_9");
  });

  it("refuses an ambiguous name rather than picking one, naming both ids", () => {
    const twins: readonly GmailLabel[] = [
      { id: "Label_1", name: "Duplicate", type: "user" },
      { id: "Label_2", name: "duplicate", type: "user" },
    ];
    const failed = resolveLabelRef({ labels: twins, ref: "Duplicate" });
    expect(failed.isErr()).toBe(true);
    expect(unwrapErr(failed).code).toBe("INVALID_ADDRESS");
    expect(unwrapErr(failed).message).toContain("Label_1, Label_2");
  });

  it("refuses a label that does not exist, and points at the verb that lists them", () => {
    const failed = resolveLabelRef({ labels: LABELS, ref: "Nope" });
    expect(failed.isErr()).toBe(true);
    expect(unwrapErr(failed).message).toContain("slopweaver gmail labels");
  });

  it("refuses an empty reference", () => {
    const failed = resolveLabelRef({ labels: LABELS, ref: "   " });
    expect(unwrapErr(failed).message).toBe("an empty label was given — name a label or its id");
  });

  it("refuses every reference against an empty mailbox vocabulary", () => {
    const failed = resolveLabelRef({ labels: [], ref: "INBOX" });
    expect(unwrapErr(failed).message).toBe(
      'no label named or identified by "INBOX" exists in this mailbox — `slopweaver gmail labels` lists them',
    );
  });
});

describe("resolveLabelRefs", () => {
  it("resolves each reference in the order it was written", () => {
    expect(unwrap(resolveLabelRefs({ labels: LABELS, refs: ["Waiting on", "INBOX"] }))).toStrictEqual([
      "Label_7",
      "INBOX",
    ]);
  });

  it("returns an empty list for no references", () => {
    expect(unwrap(resolveLabelRefs({ labels: LABELS, refs: [] }))).toStrictEqual([]);
  });

  it("reports the FIRST failure rather than a partial plan", () => {
    const failed = resolveLabelRefs({ labels: LABELS, refs: ["Waiting on", "Nope", "AlsoNope"] });
    expect(failed.isErr()).toBe(true);
    expect(unwrapErr(failed).message).toContain('"Nope"');
  });
});

describe("rejectUnaddableLabels", () => {
  it("refuses adding TRASH, and says why rather than only that", () => {
    const failed = rejectUnaddableLabels({ addLabelIds: [SYSTEM_LABELS.trash] });
    expect(failed.isErr()).toBe(true);
    expect(unwrapErr(failed).message).toContain("deletes mail");
  });

  it("refuses adding SPAM", () => {
    const failed = rejectUnaddableLabels({ addLabelIds: [SYSTEM_LABELS.spam] });
    expect(unwrapErr(failed).message).toBe(
      "refusing to add SPAM — adding TRASH deletes mail and adding SPAM trains a filter " +
        "against the sender. Neither is what a label change is for, and this door does not do either",
    );
  });

  it("names every blocked label when more than one is asked for", () => {
    const failed = rejectUnaddableLabels({ addLabelIds: ["TRASH", "INBOX", "SPAM"] });
    expect(unwrapErr(failed).message).toContain("TRASH, SPAM");
  });

  it("allows an ordinary add", () => {
    expect(unwrap(rejectUnaddableLabels({ addLabelIds: ["INBOX", "Label_7"] }))).toBe(null);
  });

  it("allows an empty add list", () => {
    expect(unwrap(rejectUnaddableLabels({ addLabelIds: [] }))).toBe(null);
  });
});

describe("planLabelChange", () => {
  it("keeps only the adds the message does not already have", () => {
    const plan = planLabelChange({
      addLabelIds: ["INBOX", "Label_7"],
      currentLabelIds: ["INBOX", "UNREAD"],
      removeLabelIds: [],
    });
    expect(plan.addLabelIds).toStrictEqual(["Label_7"]);
    expect(plan.noop).toBe(false);
  });

  it("keeps only the removals the message actually carries", () => {
    const plan = planLabelChange({
      addLabelIds: [],
      currentLabelIds: ["INBOX"],
      removeLabelIds: ["INBOX", "UNREAD"],
    });
    expect(plan.removeLabelIds).toStrictEqual(["INBOX"]);
  });

  it("reports noop when archiving something already archived", () => {
    const plan = planLabelChange({ addLabelIds: [], currentLabelIds: ["UNREAD"], removeLabelIds: ["INBOX"] });
    expect(plan.noop).toBe(true);
    expect(plan.removeLabelIds).toStrictEqual([]);
  });

  it("reports noop for an empty request", () => {
    expect(planLabelChange({ addLabelIds: [], currentLabelIds: ["INBOX"], removeLabelIds: [] }).noop).toBe(true);
  });

  it("deduplicates a label named twice", () => {
    const plan = planLabelChange({
      addLabelIds: ["Label_7", "Label_7"],
      currentLabelIds: [],
      removeLabelIds: [],
    });
    expect(plan.addLabelIds).toStrictEqual(["Label_7"]);
  });

  it("plans against a message with no labels at all", () => {
    const plan = planLabelChange({ addLabelIds: ["INBOX"], currentLabelIds: [], removeLabelIds: ["UNREAD"] });
    expect(plan.addLabelIds).toStrictEqual(["INBOX"]);
    expect(plan.removeLabelIds).toStrictEqual([]);
  });
});

describe("planThreadLabelChange", () => {
  it("does NOT narrow against the first message — a thread's messages differ", () => {
    const plan = planThreadLabelChange({
      addLabelIds: [],
      messageLabelIds: [["INBOX"], ["INBOX", "UNREAD"]],
      removeLabelIds: ["UNREAD"],
    });
    expect(plan.removeLabelIds).toStrictEqual(["UNREAD"]);
    expect(plan.noop).toBe(false);
  });

  it("reports noop only when NO message in the thread would move", () => {
    const plan = planThreadLabelChange({
      addLabelIds: [],
      messageLabelIds: [["INBOX"], ["INBOX"]],
      removeLabelIds: ["UNREAD"],
    });
    expect(plan.noop).toBe(true);
  });

  it("reports a move when a single message out of many still carries the label", () => {
    const plan = planThreadLabelChange({
      addLabelIds: [],
      messageLabelIds: [["INBOX"], ["INBOX"], ["INBOX", "UNREAD"]],
      removeLabelIds: ["UNREAD"],
    });
    expect(plan.noop).toBe(false);
  });

  it("reports a move when one message is missing a label the others have", () => {
    const plan = planThreadLabelChange({
      addLabelIds: ["Label_7"],
      messageLabelIds: [["Label_7"], []],
      removeLabelIds: [],
    });
    expect(plan.noop).toBe(false);
  });

  it("reports noop for an empty thread", () => {
    expect(planThreadLabelChange({ addLabelIds: ["INBOX"], messageLabelIds: [], removeLabelIds: [] }).noop).toBe(true);
  });

  it("deduplicates without narrowing", () => {
    const plan = planThreadLabelChange({
      addLabelIds: ["Label_7", "Label_7"],
      messageLabelIds: [["Label_7"], []],
      removeLabelIds: [],
    });
    expect(plan.addLabelIds).toStrictEqual(["Label_7"]);
  });
});
