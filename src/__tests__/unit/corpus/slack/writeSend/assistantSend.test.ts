/**
 * `runAssistantCompositeSend`, the bot answer's twin of the card send: images and documents in one message, the
 * stated loss when a file never becomes attachable, and the retraction when the attach or read-back fails.
 */
import { describe, expect, it } from "vitest";

import { runAssistantCompositeSend } from "../../../../../corpus/slack/writeSend.js";
import { SlackCompositeSendError } from "../../../../../corpus/slack/writeSendSteps.js";
import { assertInstanceOf } from "../../../../assertInstanceOf.js";
import { admitAll } from "../../../../imageAdmitFake.js";
import { ASSISTANT_PAYLOAD, NEVER_READY, POSTED, READY, uploads } from "./fixtures.js";
import { emptyCalls, fakeTransport } from "./transport.js";

describe("runAssistantCompositeSend — the answer's twin", () => {
  it("posts an answer with no media and returns its identity, never void", async () => {
    const calls = emptyCalls();

    const result = await runAssistantCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      documents: [],
      payload: ASSISTANT_PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: [],
    });

    expect(result).toEqual({ channel: "C1", fileIds: [], missingMedia: [], ok: true, ts: "1700000000.000100" });
    expect(calls.assistantAttached).toEqual([]);
  });

  it("uploads, posts, attaches and reads back — in that order — for a two-image send", async () => {
    const calls = emptyCalls();

    const result = await runAssistantCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      documents: [],
      payload: ASSISTANT_PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png", "b.png"] }),
    });

    expect(calls.uploaded).toEqual(["a.png", "b.png"]);
    expect(calls.assistantAttached).toEqual([["F_a.png", "F_b.png"]]);
    expect(calls.readBacks).toEqual([2]);
    expect(result.fileIds).toEqual(["F_a.png", "F_b.png"]);
  });

  it("uploads the DOCUMENTS after the images and attaches both in one message", async () => {
    const calls = emptyCalls();

    const result = await runAssistantCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      documents: uploads({ names: ["iso.md", "iso.html"] }),
      payload: ASSISTANT_PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png"] }),
    });

    expect(calls.uploaded).toEqual(["a.png", "iso.md", "iso.html"]);
    expect(calls.assistantAttached).toEqual([["F_a.png", "F_iso.md", "F_iso.html"]]);
    expect(calls.readBacks).toEqual([3]);
    expect(result.fileIds).toEqual(["F_a.png", "F_iso.md", "F_iso.html"]);
  });

  it("offers image admission the IMAGES only — a markdown file has no visual-evidence record to check", async () => {
    const fake = admitAll();

    await runAssistantCompositeSend({
      admit: fake.admit,
      channel: "C1",
      documents: uploads({ names: ["iso.md"] }),
      payload: ASSISTANT_PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls: emptyCalls() }),
      uploads: uploads({ names: ["a.png"] }),
    });

    expect(fake.asked).toEqual([["a.png"], ["a.png"]]);
  });

  it("sends a DOCUMENT-only answer, admitting an empty image batch", async () => {
    const calls = emptyCalls();

    const result = await runAssistantCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      documents: uploads({ names: ["iso.md"] }),
      payload: ASSISTANT_PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: [],
    });

    expect(calls.uploaded).toEqual(["iso.md"]);
    expect(result.fileIds).toEqual(["F_iso.md"]);
  });

  it("never calls the CARD post/attach methods — only the assistant ones", async () => {
    const calls = emptyCalls();

    await runAssistantCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      documents: [],
      payload: ASSISTANT_PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png"] }),
    });

    expect(calls.posted).toEqual([]);
    expect(calls.attached).toEqual([]);
    expect(calls.assistantPosted).toEqual([1]);
    expect(calls.assistantAttached).toEqual([["F_a.png"]]);
  });

  it("distinguishes a file Slack never READ from one it never FINISHED", async () => {
    const calls = emptyCalls();

    const result = await runAssistantCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      documents: [],
      payload: ASSISTANT_PAYLOAD,
      readiness: {
        waitForFile: async () => ({ kind: "unreadable", lastError: "ratelimited", polls: 27, waitedMs: 118_200 }),
      },
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png"] }),
    });

    expect(result.missingMedia).toEqual([
      {
        fileId: "F_a.png",
        filename: "a.png",
        reason: "files.info never succeeded in 27 poll(s) over 118.2s (last: ratelimited)",
      },
    ]);
  });

  it("STILL POSTS the answer when readiness never becomes true, stating the loss", async () => {
    const calls = emptyCalls();

    const result = await runAssistantCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      documents: [],
      payload: ASSISTANT_PAYLOAD,
      readiness: NEVER_READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png"] }),
    });

    expect(calls.assistantPosted).toEqual([1]);
    expect(result.missingMedia.map((item) => item.fileId)).toEqual(["F_a.png"]);
    expect(calls.assistantPostedPayloads[0]!.attachments[0].blocks.at(-1)).toEqual({
      elements: [
        {
          text:
            ":warning: 1 image could not be attached to this message: a.png (F_a.png) — " +
            "Slack never finished processing it in 12 poll(s) over 119.6s",
          type: "mrkdwn",
        },
      ],
      type: "context",
    });
  });

  it("deletes the message when chat.update fails to attach, and says so", async () => {
    const calls = emptyCalls();

    const error = await runAssistantCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      documents: [],
      payload: ASSISTANT_PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls, failAttach: true }),
      uploads: uploads({ names: ["a.png"] }),
    }).catch((caught: unknown) => caught);

    assertInstanceOf(error, SlackCompositeSendError);
    expect(calls.deleted).toEqual([POSTED]);
    expect(error.deletedMessage).toBe(true);
  });

  it("deletes the message when the read-back finds fewer images than were attached", async () => {
    const calls = emptyCalls();

    const error = await runAssistantCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      documents: [],
      payload: ASSISTANT_PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls, readBackReturns: 0 }),
      uploads: uploads({ names: ["a.png"] }),
    }).catch((caught: unknown) => caught);

    expect(calls.deleted).toEqual([POSTED]);
    assertInstanceOf(error, SlackCompositeSendError);
    expect(error.message).toContain("read-back found 0 files, expected 1");
  });
});
