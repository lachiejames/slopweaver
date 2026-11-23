/**
 * `runDripCompositeSend`, the as-me lane's twin of the card send: uploads settle before anything posts under the owner's
 * name, and a post whose attach or read-back fails is retracted or reported still visible.
 */
import { describe, expect, it } from "vitest";

import { runDripCompositeSend } from "../../../../../corpus/slack/writeSend.js";
import { SlackCompositeSendError } from "../../../../../corpus/slack/writeSendSteps.js";
import { assertInstanceOf } from "../../../../assertInstanceOf.js";
import { admitAll } from "../../../../imageAdmitFake.js";
import { NEVER_READY, POSTED, READY, uploads } from "./fixtures.js";
import { emptyCalls, fakeTransport } from "./transport.js";

describe("runDripCompositeSend — the AS-ME lane's twin", () => {
  const DRIP_PAYLOAD = { form: "plain" as const, text: "the words", unfurl_links: false, unfurl_media: false };

  it("posts a drip message with no media and returns its identity, never void", async () => {
    const calls = emptyCalls();

    const result = await runDripCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: DRIP_PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: [],
    });

    expect(result).toEqual({ channel: "C1", fileIds: [], ts: "1700000000.000100" });
    expect(calls.dripAttached).toEqual([]);
  });

  it("uploads, posts, attaches and reads back — in that order — for a two-image send", async () => {
    const calls = emptyCalls();

    const result = await runDripCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: DRIP_PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png", "b.png"] }),
    });

    expect(calls.uploaded).toEqual(["a.png", "b.png"]);
    expect(calls.dripAttached).toEqual([["F_a.png", "F_b.png"]]);
    expect(calls.readBacks).toEqual([2]);
    expect(result.fileIds).toEqual(["F_a.png", "F_b.png"]);
  });

  it("never calls the CARD, assistant or recipe post methods — the human lane has no card", async () => {
    const calls = emptyCalls();

    await runDripCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: DRIP_PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png"] }),
    });

    expect(calls.posted).toEqual([]);
    expect(calls.assistantPosted).toEqual([]);
    expect(calls.recipeResponsePosted).toEqual([]);
    expect(calls.dripPosted).toEqual([1]);
  });

  it("uploads BEFORE posting, so an unreadable file leaves nothing under the owner's name", async () => {
    const calls = emptyCalls();

    const error = await runDripCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: DRIP_PAYLOAD,
      readiness: NEVER_READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png"] }),
    }).catch((caught: unknown) => caught);

    assertInstanceOf(error, SlackCompositeSendError);
    expect(calls.dripPosted).toEqual([]);
    expect(calls.deleted).toEqual([]);
    expect(error.message).toBe(
      "1 of 1 upload(s) never became attachable — a.png (F_a.png): Slack never finished processing it in " +
        "12 poll(s) over 119.6s; nothing was posted",
    );
    expect(error.missing.map((item) => item.filename)).toEqual(["a.png"]);
  });

  it("deletes the message when chat.update fails to attach, and says so", async () => {
    const calls = emptyCalls();

    const error = await runDripCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: DRIP_PAYLOAD,
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

    const error = await runDripCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: DRIP_PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls, readBackReturns: 0 }),
      uploads: uploads({ names: ["a.png"] }),
    }).catch((caught: unknown) => caught);

    expect(calls.deleted).toEqual([POSTED]);
    assertInstanceOf(error, SlackCompositeSendError);
    expect(error.message).toContain("read-back found 0 files, expected 1");
  });

  it("reports the message as still visible when the retraction ALSO fails", async () => {
    const calls = emptyCalls();

    const error = await runDripCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: DRIP_PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls, deleteSucceeds: false, failAttach: true }),
      uploads: uploads({ names: ["a.png"] }),
    }).catch((caught: unknown) => caught);

    assertInstanceOf(error, SlackCompositeSendError);
    expect(error.deletedMessage).toBe(false);
    expect(error.message).toContain("still visible at ts 1700000000.000100");
  });
});
