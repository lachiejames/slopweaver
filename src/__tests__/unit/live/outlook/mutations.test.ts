/**
 * The change verbs: plans computed from current state (write vs unchanged), target resolution with dedupe, and
 * applying a plan over the fake mailbox, stopping at the first failed write.
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { OutlookMessageSummary } from "../../../../live/outlook/messages.js";
import {
  applyOutlookChange,
  planCategory,
  planMark,
  planMove,
  resolveTargets,
} from "../../../../live/outlook/mutations.js";
import { fakeMailbox, fakeOutlookApi, wireMessage } from "../../../fakeOutlookMailbox.js";

/** A summary row for planning, with any field overridden. */
function target({ id, over = {} }: { id: string; over?: Partial<OutlookMessageSummary> }): OutlookMessageSummary {
  return {
    categories: [],
    conversationId: "conv-1",
    folderId: "folder-inbox",
    from: null,
    hasAttachments: false,
    id,
    isRead: false,
    preview: "",
    receivedIso: null,
    subject: null,
    ...over,
  };
}

describe("planMark", () => {
  it("writes isRead only where the state differs", () => {
    const plan = planMark({
      read: true,
      targets: [target({ id: "unread" }), target({ id: "already", over: { isRead: true } })],
      thread: false,
    });

    expect(plan).toEqual({
      intent: "mark",
      steps: [
        { id: "unread", kind: "patch", patch: { isRead: true } },
        { id: "already", kind: "unchanged" },
      ],
      thread: false,
    });
  });

  it("marks unread the other way round", () => {
    const plan = planMark({ read: false, targets: [target({ id: "was-read", over: { isRead: true } })], thread: true });

    expect(plan.steps).toEqual([{ id: "was-read", kind: "patch", patch: { isRead: false } }]);
    expect(plan.thread).toBe(true);
  });
});

describe("planCategory", () => {
  it("writes the absolute next list, and skips a message it would not change", () => {
    const plan = planCategory({
      change: { add: ["Done"], remove: ["Waiting on"] },
      targets: [
        target({ id: "needs", over: { categories: ["Waiting on", "Keep"] } }),
        target({ id: "has", over: { categories: ["Done"] } }),
      ],
      thread: false,
    });

    expect(plan.intent).toBe("category");
    expect(plan.steps).toEqual([
      { id: "needs", kind: "patch", patch: { categories: ["Keep", "Done"] } },
      { id: "has", kind: "unchanged" },
    ]);
  });
});

describe("planMove", () => {
  it("moves what is elsewhere and leaves what is already there", () => {
    const plan = planMove({
      destinationId: "folder-archive",
      targets: [target({ id: "inbox-mail" }), target({ id: "archived", over: { folderId: "folder-archive" } })],
      thread: false,
    });

    expect(plan.intent).toBe("archive");
    expect(plan.steps).toEqual([
      { destinationId: "folder-archive", id: "inbox-mail", kind: "move" },
      { id: "archived", kind: "unchanged" },
    ]);
  });
});

describe("resolveTargets", () => {
  it("reads each named message once, in the order named", async () => {
    const mailbox = fakeMailbox({ messages: [wireMessage({ id: "a" }), wireMessage({ id: "b" })] });

    const targets = unwrap(
      await resolveTargets({ api: fakeOutlookApi({ mailbox }), ids: ["b", "a", "b"], thread: false }),
    );

    expect(targets.map((row) => row.id)).toEqual(["b", "a"]);
  });

  it("widens to the whole conversation under thread and deduplicates members", async () => {
    const mailbox = fakeMailbox({
      messages: [
        wireMessage({ id: "t1", over: { receivedDateTime: "2026-10-01T09:00:00Z" } }),
        wireMessage({ id: "t2", over: { receivedDateTime: "2026-10-02T09:00:00Z" } }),
        wireMessage({ id: "other", over: { conversationId: "conv-2" } }),
      ],
    });

    const targets = unwrap(await resolveTargets({ api: fakeOutlookApi({ mailbox }), ids: ["t1", "t2"], thread: true }));

    expect(targets.map((row) => row.id)).toEqual(["t1", "t2"]);
  });

  it("refuses when a named message cannot be read, before anything is planned", async () => {
    const mailbox = fakeMailbox({ messages: [wireMessage({ id: "a" })] });

    const refused = await resolveTargets({ api: fakeOutlookApi({ mailbox }), ids: ["a", "absent"], thread: false });

    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("API_FAILED");
    expect(unwrapErr(refused).message).toContain("absent");
  });

  it("refuses a target missing a selected field", async () => {
    const mailbox = fakeMailbox({ messages: [wireMessage({ id: "bad", over: { isRead: undefined } })] });

    const refused = await resolveTargets({ api: fakeOutlookApi({ mailbox }), ids: ["bad"], thread: false });

    expect(unwrapErr(refused).code).toBe("RESPONSE_FIELD_MISSING");
  });
});

describe("applyOutlookChange", () => {
  it("writes each changed message and reports unchanged ones without writing them", async () => {
    const mailbox = fakeMailbox({
      messages: [wireMessage({ id: "a" }), wireMessage({ id: "b", over: { isRead: true } })],
    });
    const plan = planMark({
      read: true,
      targets: [target({ id: "a" }), target({ id: "b", over: { isRead: true } })],
      thread: false,
    });

    const outcome = await applyOutlookChange({ api: fakeOutlookApi({ mailbox }), plan });

    expect(outcome).toEqual({
      changed: ["a"],
      failed: undefined,
      intent: "mark",
      notAttempted: [],
      unchanged: ["b"],
    });
    expect(mailbox.writes).toEqual(['patch a {"isRead":true}']);
    expect(mailbox.messages.get("a")!.isRead).toBe(true);
  });

  it("stops at the first failed write and lists every message it did not reach", async () => {
    const mailbox = fakeMailbox({
      messages: [
        wireMessage({ id: "a" }),
        wireMessage({ id: "b" }),
        wireMessage({ id: "c" }),
        wireMessage({ id: "d" }),
      ],
    });
    mailbox.failWritesFor.add("b");
    const plan = planMark({
      read: true,
      targets: [target({ id: "a" }), target({ id: "b" }), target({ id: "c" }), target({ id: "d" })],
      thread: false,
    });

    const outcome = await applyOutlookChange({ api: fakeOutlookApi({ mailbox }), plan });

    expect(outcome.changed).toEqual(["a"]);
    expect(outcome.failed).toEqual({ id: "b", message: "429 throttled writing b" });
    expect(outcome.notAttempted).toEqual(["c", "d"]);
    expect(mailbox.writes).toEqual(['patch a {"isRead":true}']);
  });

  it("applies a move through the move write", async () => {
    const mailbox = fakeMailbox({ messages: [wireMessage({ id: "a" })] });
    const plan = planMove({ destinationId: "folder-archive", targets: [target({ id: "a" })], thread: false });

    const outcome = await applyOutlookChange({ api: fakeOutlookApi({ mailbox }), plan });

    expect(outcome.changed).toEqual(["a"]);
    expect(mailbox.writes).toEqual(["move a folder-archive"]);
    expect(mailbox.messages.get("a")!.parentFolderId).toBe("folder-archive");
  });

  it("reports a failed move with the unchanged ones before it kept in their own list", async () => {
    const mailbox = fakeMailbox({ messages: [wireMessage({ id: "a" }), wireMessage({ id: "b" })] });
    mailbox.failWritesFor.add("b");
    const plan = planMove({
      destinationId: "folder-archive",
      targets: [target({ id: "kept", over: { folderId: "folder-archive" } }), target({ id: "b" }), target({ id: "a" })],
      thread: false,
    });

    const outcome = await applyOutlookChange({ api: fakeOutlookApi({ mailbox }), plan });

    expect(outcome.unchanged).toEqual(["kept"]);
    expect(outcome.failed!.id).toBe("b");
    expect(outcome.notAttempted).toEqual(["a"]);
  });

  it("is a no-op for an empty plan", async () => {
    const mailbox = fakeMailbox();

    const outcome = await applyOutlookChange({
      api: fakeOutlookApi({ mailbox }),
      plan: planMark({ read: true, targets: [], thread: false }),
    });

    expect(outcome).toEqual({ changed: [], failed: undefined, intent: "mark", notAttempted: [], unchanged: [] });
    expect(mailbox.writes).toEqual([]);
  });
});
