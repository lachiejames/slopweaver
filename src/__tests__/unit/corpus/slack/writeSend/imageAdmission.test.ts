/**
 * Image admission at the upload boundary of every composite send: a refused batch uploads and posts nothing,
 * admission sees the whole batch twice, and the answer, recipe-response and drip lanes share the seam.
 */
import { describe, expect, it } from "vitest";

import {
  runAssistantCompositeSend,
  runCompositeSend,
  runDripCompositeSend,
  runRecipeResponseCompositeSend,
} from "../../../../../corpus/slack/writeSend.js";
import { ImageAdmissionRefused, type ImageAdmit } from "../../../../../visualEvidence/admitUploads.js";
import { assertInstanceOf } from "../../../../assertInstanceOf.js";
import { admitAll, admitThenFail, refuseKnownBad, refuseUnrecorded } from "../../../../imageAdmitFake.js";
import { ASSISTANT_PAYLOAD, PAYLOAD, READY, RECIPE_RESPONSE_PAYLOAD, uploads } from "./fixtures.js";
import { emptyCalls, fakeTransport } from "./transport.js";

describe("image admission gates the upload boundary", () => {
  // Every one of these asserts on `calls.uploaded`, which the transport fake appends to
  // exactly when `files.uploadV2` is ATTEMPTED — so an empty array is evidence nothing was offered to
  // Slack, not merely that nothing succeeded.
  it("uploads NOTHING and posts NOTHING when a recorded-bad image is in the batch", async () => {
    const calls = emptyCalls();

    const thrown = await runCompositeSend({
      admit: refuseKnownBad({ filename: "panel.png" }),
      channel: "C1",
      payload: PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["panel.png"] }),
    }).catch((error: unknown) => error);

    assertInstanceOf(thrown, ImageAdmissionRefused);
    expect(thrown.code).toBe("IMAGE_KNOWN_BAD");
    expect(calls.uploaded).toEqual([]);
    expect(calls.posted).toEqual([]);
    expect(calls.attached).toEqual([]);
  });

  // The control that proves the test above did not simply miss the send path.
  it("uploads and posts the SAME batch once admission allows it", async () => {
    const calls = emptyCalls();

    const result = await runCompositeSend({
      admit: admitAll().admit,
      channel: "C1",
      payload: PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["panel.png"] }),
    });

    expect(calls.uploaded).toEqual(["panel.png"]);
    expect(calls.posted).toEqual([1]);
    expect(result.fileIds).toEqual(["F_panel.png"]);
  });

  it("refuses the WHOLE batch, so a good first image is never uploaded alone", async () => {
    const calls = emptyCalls();

    await runCompositeSend({
      admit: refuseKnownBad({ filename: "bad.png" }),
      channel: "C1",
      payload: PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["good.png", "bad.png"] }),
    }).catch(() => undefined);

    expect(calls.uploaded).toEqual([]);
  });

  it("asks admission about the WHOLE batch, in attach order, on every consultation", async () => {
    const calls = emptyCalls();
    const fake = admitAll();

    await runCompositeSend({
      admit: fake.admit,
      channel: "C1",
      payload: PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png", "b.png"] }),
    });

    // Twice: once before the first upload, once after the last and before the post. Both see the whole
    // batch in the caller's order — a per-member consultation is what this asserts is NOT happening.
    expect(fake.asked).toEqual([
      ["a.png", "b.png"],
      ["a.png", "b.png"],
    ]);
  });

  // The r2 race: admitted at T0, recorded unfit at T1 by another session, still mid-upload at T2.
  it("re-consults admission AFTER the uploads, so a failure recorded mid-batch still refuses the post", async () => {
    const calls = emptyCalls();
    const fake = admitThenFail({ filename: "panel.png" });

    const thrown = await runCompositeSend({
      admit: fake.admit,
      channel: "C1",
      payload: PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png", "panel.png"] }),
    }).catch((error: unknown) => error);

    assertInstanceOf(thrown, ImageAdmissionRefused);
    expect(thrown.code).toBe("IMAGE_KNOWN_BAD");
    expect(fake.calls()).toBe(2);
    // The files were uploaded PRIVATELY (channel_id omitted), so nothing reached a reader: the post is the
    // publish, and it never happened.
    expect(calls.posted).toEqual([]);
    expect(calls.attached).toEqual([]);
  });

  it("consults admission exactly twice on a clean send — once before, once before the post", async () => {
    const calls = emptyCalls();
    const fake = admitAll();

    await runCompositeSend({
      admit: fake.admit,
      channel: "C1",
      payload: PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["a.png"] }),
    });

    expect(fake.asked).toEqual([["a.png"], ["a.png"]]);
    expect(calls.posted).toEqual([1]);
  });

  it("refuses an unrecorded image and names the hatch, not an override token", async () => {
    const calls = emptyCalls();

    const thrown = await runCompositeSend({
      admit: refuseUnrecorded({ digest: `sha256:${"a".repeat(64)}` }),
      channel: "C1",
      payload: PAYLOAD,
      readiness: READY,
      transport: fakeTransport({ calls }),
      uploads: uploads({ names: ["panel.png"] }),
    }).catch((error: unknown) => error);

    assertInstanceOf(thrown, ImageAdmissionRefused);
    expect(thrown.code).toBe("IMAGE_RECORD_MISSING");
    expect(thrown.lines.join("\n")).toContain("unread-image");
    expect(calls.uploaded).toEqual([]);
  });

  it("gates the bot answer, the recipe response and the drip lane on the same seam", async () => {
    const dripPayload = { form: "plain" as const, text: "the words", unfurl_links: false, unfurl_media: false };
    const outcomes: string[] = [];
    for (const send of [
      async ({ admit }: { admit: ImageAdmit }) =>
        runAssistantCompositeSend({
          admit,
          channel: "C1",
          documents: [],
          payload: ASSISTANT_PAYLOAD,
          readiness: READY,
          transport: fakeTransport({ calls: emptyCalls() }),
          uploads: uploads({ names: ["panel.png"] }),
        }),
      async ({ admit }: { admit: ImageAdmit }) =>
        runRecipeResponseCompositeSend({
          admit,
          channel: "C1",
          payload: RECIPE_RESPONSE_PAYLOAD,
          readiness: READY,
          transport: fakeTransport({ calls: emptyCalls() }),
          uploads: uploads({ names: ["panel.png"] }),
        }),
      async ({ admit }: { admit: ImageAdmit }) =>
        runDripCompositeSend({
          admit,
          channel: "C1",
          payload: dripPayload,
          readiness: READY,
          transport: fakeTransport({ calls: emptyCalls() }),
          uploads: uploads({ names: ["panel.png"] }),
        }),
    ]) {
      const thrown = await send({ admit: refuseKnownBad({ filename: "panel.png" }) }).catch((error: unknown) => error);
      assertInstanceOf(thrown, ImageAdmissionRefused);
      outcomes.push(thrown.code);
    }
    expect(outcomes).toEqual(["IMAGE_KNOWN_BAD", "IMAGE_KNOWN_BAD", "IMAGE_KNOWN_BAD"]);
  });
});
