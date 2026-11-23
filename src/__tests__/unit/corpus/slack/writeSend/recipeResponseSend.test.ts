/**
 * `runRecipeResponseCompositeSend`, the recipe response's twin of the card send: only its own post and attach
 * methods, the stated loss, and the retraction when the attach or read-back fails.
 */
import { describe, expect, it } from "vitest";

import { runRecipeResponseCompositeSend } from "../../../../../corpus/slack/writeSend.js";
import { SlackCompositeSendError } from "../../../../../corpus/slack/writeSendSteps.js";
import { assertInstanceOf } from "../../../../assertInstanceOf.js";
import { admitAll } from "../../../../imageAdmitFake.js";
import { NEVER_READY, POSTED, READY, RECIPE_RESPONSE_PAYLOAD, uploads } from "./fixtures.js";
import { emptyCalls, fakeTransport } from "./transport.js";

describe("runRecipeResponseCompositeSend — the recipe response's twin", () => {
  it("posts a recipe response with no media and returns its identity, never void", async () => {
    const calls = emptyCalls();

    const result = await runRecipeResponseCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: RECIPE_RESPONSE_PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: [],
    });

    expect(result).toEqual({ channel: "C1", fileIds: [], missingMedia: [], ok: true, ts: "1700000000.000100" });
    expect(calls.recipeResponseAttached).toEqual([]);
  });

  it("uploads, posts, attaches and reads back — in that order — for a two-image send", async () => {
    const calls = emptyCalls();

    const result = await runRecipeResponseCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: RECIPE_RESPONSE_PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png", "b.png"] }),
    });

    expect(calls.uploaded).toEqual(["a.png", "b.png"]);
    expect(calls.recipeResponseAttached).toEqual([["F_a.png", "F_b.png"]]);
    expect(calls.readBacks).toEqual([2]);
    expect(result.fileIds).toEqual(["F_a.png", "F_b.png"]);
  });

  it("STILL POSTS when a file never finishes processing, stating the loss", async () => {
    const calls = emptyCalls();

    const result = await runRecipeResponseCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: RECIPE_RESPONSE_PAYLOAD,
      readiness: NEVER_READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png"] }),
    });

    expect(calls.recipeResponsePosted).toEqual([1]);
    expect(calls.recipeResponseAttached).toEqual([]);
    expect(result.missingMedia.map((item) => item.filename)).toEqual(["a.png"]);
  });

  it("never calls the CARD or assistant post/attach methods — only the recipe-response ones", async () => {
    const calls = emptyCalls();

    await runRecipeResponseCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: RECIPE_RESPONSE_PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png"] }),
    });

    expect(calls.posted).toEqual([]);
    expect(calls.assistantPosted).toEqual([]);
    expect(calls.recipeResponsePosted).toEqual([1]);
    expect(calls.recipeResponseAttached).toEqual([["F_a.png"]]);
  });

  it("deletes the message when chat.update fails to attach, and says so", async () => {
    const calls = emptyCalls();

    const error = await runRecipeResponseCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: RECIPE_RESPONSE_PAYLOAD,
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

    const error = await runRecipeResponseCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: RECIPE_RESPONSE_PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls, readBackReturns: 0 }),
      uploads: uploads({ names: ["a.png"] }),
    }).catch((caught: unknown) => caught);

    expect(calls.deleted).toEqual([POSTED]);
    assertInstanceOf(error, SlackCompositeSendError);
    expect(error.message).toContain("read-back found 0 files, expected 1");
  });
});
