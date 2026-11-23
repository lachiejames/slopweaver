/**
 * The write-side and summary blocks of the Outlook verbs' output: the dry run and its outcome, the stored draft,
 * the send preview and sent report, and the measurement, triage and attachment blocks.
 */
import { describe, expect, it } from "vitest";
import type { OutlookSavedAttachment } from "../../../../live/outlook/attachments.js";
import type { OutlookSendPlan } from "../../../../live/outlook/drafts.js";
import type { OutlookChangeOutcome, OutlookChangePlan } from "../../../../live/outlook/mutations.js";
import {
  renderOutlookAttachmentText,
  renderOutlookChangeOutcomeText,
  renderOutlookChangePlanText,
  renderOutlookDraftOutcomeText,
  renderOutlookMeasureText,
  renderOutlookSendPlanText,
  renderOutlookSentText,
  renderOutlookTriageText,
} from "../../../../live/outlook/render.js";

/** A send plan with any field overridden. */
function sendPlan({ over = {} }: { over?: Partial<OutlookSendPlan> }): OutlookSendPlan {
  return {
    bcc: [],
    body: "Synthetic body.",
    cc: [],
    digest: "abc123def456",
    draftId: "draft-9",
    from: "owner@example.test",
    subject: "Synthetic subject",
    to: ["Pat Example <pat@example.test>"],
    ...over,
  };
}

describe("change plan and outcome", () => {
  const plan: OutlookChangePlan = {
    intent: "archive",
    steps: [
      { destinationId: "folder-archive", id: "m1", kind: "move" },
      { id: "m2", kind: "unchanged" },
      { id: "m3", kind: "patch", patch: { isRead: true } },
    ],
    thread: true,
  };

  it("renders a dry run counting writes, and ends on the fact nothing was written", () => {
    expect(renderOutlookChangePlanText({ plan }).split("\n")).toEqual([
      "archive: 2 write(s) planned over 3 message(s) (whole conversations)",
      "  m1: move to folder-archive",
      "  m2: already as asked",
      '  m3: set {"isRead":true}',
      "DRY RUN — nothing was written",
    ]);
  });

  it("renders a clean outcome", () => {
    const outcome: OutlookChangeOutcome = {
      changed: ["m1"],
      failed: undefined,
      intent: "mark",
      notAttempted: [],
      unchanged: ["m2", "m3"],
    };

    expect(renderOutlookChangeOutcomeText({ outcome }).split("\n")).toEqual([
      "mark: 1 changed, 2 already as asked",
      "  changed: m1",
    ]);
  });

  it("renders a failure with everything left not attempted", () => {
    const outcome: OutlookChangeOutcome = {
      changed: ["m1"],
      failed: { id: "m2", message: "429 throttled" },
      intent: "mark",
      notAttempted: ["m3", "m4"],
      unchanged: [],
    };

    expect(renderOutlookChangeOutcomeText({ outcome }).split("\n")).toEqual([
      "mark: 1 changed, 0 already as asked",
      "  changed: m1",
      "  FAILED: m2 — 429 throttled",
      "  not attempted: m3",
      "  not attempted: m4",
    ]);
  });
});

describe("draft and send", () => {
  it("renders a stored draft, says nothing was sent, and names the preview command", () => {
    const text = renderOutlookDraftOutcomeText({
      outcome: { conversationId: "conv-9", draftId: "draft-9", isReply: true },
    });

    expect(text.split("\n")).toEqual([
      "DRAFT STORED (reply): draft-9",
      "conversation: conv-9",
      "Nothing was sent. To preview the send and get its approval digest:",
      "  slopweaver outlook send draft-9",
    ]);
  });

  it("omits the reply tag for a new draft", () => {
    const text = renderOutlookDraftOutcomeText({
      outcome: { conversationId: "conv-9", draftId: "draft-9", isReply: false },
    });

    expect(text.split("\n")[0]).toBe("DRAFT STORED: draft-9");
  });

  it("renders a send preview that sends nothing and carries the approve command", () => {
    const text = renderOutlookSendPlanText({
      plan: sendPlan({ over: { bcc: ["bcc@example.test"], cc: ["cc@example.test"] } }),
    });

    expect(text.split("\n")).toEqual([
      "would send draft draft-9",
      "from: owner@example.test",
      "to: Pat Example <pat@example.test>",
      "cc: cc@example.test",
      "bcc: bcc@example.test",
      "subject: Synthetic subject",
      "",
      "Synthetic body.",
      "",
      "This preview sends nothing. To send exactly this content:",
      "  slopweaver outlook send draft-9 --approve abc123def456",
    ]);
  });

  it("shows a missing subject and leaves out empty cc and bcc lines", () => {
    const text = renderOutlookSendPlanText({ plan: sendPlan({ over: { subject: null } }) });

    expect(text).toContain("subject: (no subject)");
    expect(text).not.toContain("cc:");
    expect(text).not.toContain("bcc:");
  });

  it("renders a sent report with the envelope only", () => {
    expect(renderOutlookSentText({ plan: sendPlan({}) }).split("\n")).toEqual([
      "SENT: draft draft-9",
      "from: owner@example.test",
      "to: Pat Example <pat@example.test>",
      "subject: Synthetic subject",
    ]);
  });
});

describe("measure, triage and attachment", () => {
  it("renders coverage first, then totals and each folder", () => {
    const text = renderOutlookMeasureText({
      measure: {
        coverage: "provider folder counters",
        exact: false,
        folders: [{ id: "f1", path: "Inbox", totalItemCount: 3, unreadItemCount: 2 }],
        totalItemCount: 3,
        truncated: true,
        unreadItemCount: 2,
      },
    });

    expect(text.split("\n")).toEqual([
      "coverage: provider folder counters",
      "total: 3 messages, 2 unread",
      "  Inbox  3 / 2 unread",
      "the folder walk stopped at its page ceiling — the totals cover a prefix of the mailbox",
    ]);
  });

  it("renders sender groups with the unread marker, and says when the inbox holds more", () => {
    const text = renderOutlookTriageText({
      triage: {
        groups: [
          {
            address: "sender@example.test",
            count: 2,
            key: "sender@example.test",
            messages: [
              { id: "m1", isRead: false, receivedIso: "2026-10-02T09:00:00Z", subject: "Newer" },
              { id: "m2", isRead: true, receivedIso: "2026-10-01T09:00:00Z", subject: null },
            ],
            name: "Sender One",
            newestIso: "2026-10-02T09:00:00Z",
            unread: 1,
          },
        ],
        messages: 2,
        more: true,
      },
    });

    expect(text.split("\n")).toEqual([
      "2 inbox message(s) from 1 sender(s)",
      "Sender One <sender@example.test>  2 message(s), 1 unread",
      "  * Newer  id: m1",
      "    (no subject)  id: m2",
      "the inbox holds more — raise --limit to group further back",
    ]);
  });

  it("renders a saved attachment with the path to read first", () => {
    const saved: OutlookSavedAttachment = {
      attachmentId: "att-1",
      contentType: "text/plain",
      messageId: "m1",
      name: "notes.txt",
      path: "/tmp/example/notes.txt",
      sizeBytes: 12,
    };

    expect(renderOutlookAttachmentText({ saved }).split("\n")).toEqual([
      "READ THIS: /tmp/example/notes.txt",
      "name: notes.txt",
      "type: text/plain",
      "bytes: 12",
    ]);
  });

  it("marks an unstated content type", () => {
    const text = renderOutlookAttachmentText({
      saved: { attachmentId: "a", contentType: null, messageId: "m", name: "n", path: "/p", sizeBytes: 1 },
    });

    expect(text).toContain("type: (unstated)");
  });
});
