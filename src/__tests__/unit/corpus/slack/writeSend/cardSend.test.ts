/**
 * `runCompositeSend`, the bot card's composite send: the clean paths, the failures before anything is visible,
 * and a visible card missing its media deleted rather than tolerated.
 */
import { describe, expect, it } from "vitest";

import { runCompositeSend } from "../../../../../corpus/slack/writeSend.js";
import { SlackCompositeSendError } from "../../../../../corpus/slack/writeSendSteps.js";
import { assertInstanceOf } from "../../../../assertInstanceOf.js";
import { admitAll } from "../../../../imageAdmitFake.js";
import { NEVER_READY, PAYLOAD, POSTED, READY, readyExcept, uploads } from "./fixtures.js";
import { emptyCalls, fakeTransport } from "./transport.js";

describe("runCompositeSend — the clean paths", () => {
  it("posts a card with no media and returns its identity, never void", async () => {
    const calls = emptyCalls();

    const result = await runCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: [],
    });

    expect(result).toEqual({ channel: "C1", fileIds: [], missingMedia: [], ok: true, ts: "1700000000.000100" });
  });

  it("does NOT call chat.update when there is no media", async () => {
    const calls = emptyCalls();

    await runCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: [],
    });

    expect(calls.attached).toEqual([]);
    expect(calls.deleted).toEqual([]);
  });

  it("uploads, posts, attaches and reads back — in that order — for a two-file send", async () => {
    const calls = emptyCalls();

    const result = await runCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png", "b.pdf"] }),
    });

    expect(calls.uploaded).toEqual(["a.png", "b.pdf"]);
    expect(calls.attached).toEqual([["F_a.png", "F_b.pdf"]]);
    expect(calls.readBacks).toEqual([2]);
    expect(result.fileIds).toEqual(["F_a.png", "F_b.pdf"]);
    expect(calls.deleted).toEqual([]);
  });

  it("preserves the caller's media order rather than sorting it", async () => {
    const calls = emptyCalls();

    await runCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["z.png", "a.pdf", "m.csv"] }),
    });

    expect(calls.uploaded).toEqual(["z.png", "a.pdf", "m.csv"]);
  });

  it("never calls the ASSISTANT post/attach methods — only the card ones", async () => {
    const calls = emptyCalls();

    await runCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png"] }),
    });

    expect(calls.assistantPosted).toEqual([]);
    expect(calls.assistantAttached).toEqual([]);
    expect(calls.posted).toEqual([1]);
    expect(calls.attached).toEqual([["F_a.png"]]);
  });
});

describe("runCompositeSend — failures BEFORE anything is visible", () => {
  it("never posts when an upload fails", async () => {
    const calls = emptyCalls();

    await expect(
      runCompositeSend({
        admit: admitAll().admit,
        channel: "C1",
        payload: PAYLOAD,
        readiness: READY,
        transport: fakeTransport({ calls, failUploadAt: "b.pdf" }),
        uploads: uploads({ names: ["a.png", "b.pdf"] }),
      }),
    ).rejects.toThrow("upload_failed");

    expect(calls.posted).toEqual([]);
    expect(calls.deleted).toEqual([]);
  });

  it("STILL POSTS when a file never finishes processing — the answer is never dropped", async () => {
    const calls = emptyCalls();

    const result = await runCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: PAYLOAD,
      readiness: NEVER_READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png"] }),
    });

    expect(calls.posted).toEqual([1]);
    expect(calls.attached).toEqual([]);
    expect(result.fileIds).toEqual([]);
    expect(result.missingMedia).toEqual([
      { fileId: "F_a.png", filename: "a.png", reason: "Slack never finished processing it in 12 poll(s) over 119.6s" },
    ]);
  });

  it("says the image is missing IN THE POSTED CARD, never silently", async () => {
    const calls = emptyCalls();

    await runCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: PAYLOAD,
      readiness: NEVER_READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png"] }),
    });

    expect(calls.postedPayloads[0]!.attachments[0].blocks.at(-1)).toEqual({
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

  it("attaches the READY files and states only the one that never arrived", async () => {
    const calls = emptyCalls();

    const result = await runCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: PAYLOAD,
      readiness: readyExcept({ stuck: "F_b.png" }),
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png", "b.png"] }),
    });

    expect(calls.attached).toEqual([["F_a.png"]]);
    expect(calls.readBacks).toEqual([1]);
    expect(result.fileIds).toEqual(["F_a.png"]);
    expect(result.missingMedia.map((item) => item.filename)).toEqual(["b.png"]);
  });

  it("carries the note into chat.update too, so the attach edit cannot drop it", async () => {
    const calls = emptyCalls();

    await runCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: PAYLOAD,
      readiness: readyExcept({ stuck: "F_b.png" }),
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png", "b.png"] }),
    });

    expect(calls.attachedPayloads[0]!.attachments[0].blocks.at(-1)).toEqual(
      calls.postedPayloads[0]!.attachments[0].blocks.at(-1),
    );
  });

  it("does not attempt a delete when the post itself failed — there is nothing to retract", async () => {
    const calls = emptyCalls();

    await expect(
      runCompositeSend({
        admit: admitAll().admit,
        channel: "C1",
        payload: PAYLOAD,
        readiness: READY,
        transport: fakeTransport({ calls, failPost: true }),
        uploads: uploads({ names: ["a.png"] }),
      }),
    ).rejects.toThrow("post_failed");

    expect(calls.deleted).toEqual([]);
  });
});

describe("runCompositeSend — a visible card missing its media is DELETED, not tolerated", () => {
  it("deletes the message when chat.update fails", async () => {
    const calls = emptyCalls();

    const error = await runCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls, failAttach: true }),
      uploads: uploads({ names: ["a.png"] }),
    }).catch((caught: unknown) => caught);

    assertInstanceOf(error, SlackCompositeSendError);
    expect(calls.deleted).toEqual([POSTED]);
    expect(error.deletedMessage).toBe(true);
    expect(error.message).toContain("deleted rather than left visibly incomplete");
  });

  it("deletes the message when the read-back finds fewer files than were attached", async () => {
    const calls = emptyCalls();

    const error = await runCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls, readBackReturns: 0 }),
      uploads: uploads({ names: ["a.png"] }),
    }).catch((caught: unknown) => caught);

    expect(calls.deleted).toEqual([POSTED]);
    assertInstanceOf(error, SlackCompositeSendError);
    expect(error.message).toContain("read-back found 0 files, expected 1");
  });

  it("never trusts ok:true — a silent file drop is caught by the read-back alone", async () => {
    const calls = emptyCalls();

    // attachMedia RESOLVES (Slack said ok) but the message really has no files.
    await expect(
      runCompositeSend({
        admit: admitAll().admit,
        channel: "C1",
        payload: PAYLOAD,
        readiness: READY,
        transport: fakeTransport({ calls, readBackReturns: 0 }),
        uploads: uploads({ names: ["a.png", "b.pdf"] }),
      }),
    ).rejects.toBeInstanceOf(SlackCompositeSendError);

    expect(calls.attached).toEqual([["F_a.png", "F_b.pdf"]]);
    expect(calls.deleted).toEqual([POSTED]);
  });

  it("reports LOUDLY when the delete ALSO fails, naming the ts still visible in the channel", async () => {
    const calls = emptyCalls();

    const error = await runCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls, deleteSucceeds: false, failAttach: true }),
      uploads: uploads({ names: ["a.png"] }),
    }).catch((caught: unknown) => caught);

    assertInstanceOf(error, SlackCompositeSendError);
    expect(error.deletedMessage).toBe(false);
    expect(error.message).toContain("still visible at ts 1700000000.000100");
  });

  it("carries the uploaded file ids and the posted message on the error, for audit", async () => {
    const calls = emptyCalls();

    const error = await runCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls, failAttach: true }),
      uploads: uploads({ names: ["a.png", "b.pdf"] }),
    }).catch((caught: unknown) => caught);

    assertInstanceOf(error, SlackCompositeSendError);
    expect(error.uploadedFileIds).toEqual(["F_a.png", "F_b.pdf"]);
    expect(error.posted).toEqual(POSTED);
  });
});
