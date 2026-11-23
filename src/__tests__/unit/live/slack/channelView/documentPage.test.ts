/*
 * The live channel window drawn over one history page: oldest first with each picture fetched once, a failed
 * fetch drawn as a card, two rows sharing a ts kept apart, and a row the projection cannot vouch for refused. It
 * was split out when the channel-window suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";
import { err, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { FetchPicture } from "../../../../../live/slack/channelMedia.js";
import { channelViewDocument } from "../../../../../live/slack/channelView.js";
import { ChannelViewErrors } from "../../../../../live/slack/channelViewErrors.js";
import { NO_LOOKUP, OBSERVED, PAGE, recordingFetch, SHA, WORKSPACE } from "./harness.js";

describe("channelViewDocument", () => {
  it("draws the page oldest first, fetching each picture once, newest message first", async () => {
    const asked: string[] = [];
    const document = unwrap(
      await channelViewDocument({
        channel: "C0CHAN",
        fetchPicture: recordingFetch({ asked }),
        hasMore: true,
        lookupFile: NO_LOOKUP,
        name: "proj-monitoring",
        observedAtIso: OBSERVED,
        rows: PAGE,
        workspace: WORKSPACE,
      }),
    );

    expect(document.kind).toBe("slopweaver.slack.channel-view");
    expect(document.link).toBe("https://acme.slack.com/archives/C0CHAN");
    expect(document.earlierWithheld).toBe(true);
    expect(document.messages.map((message) => message.ts)).toEqual([
      "1790000100.000100",
      "1790000500.000500",
      "1790000900.000900",
    ]);
    expect(document.messages.map((message) => message.replyCount)).toEqual([3, 0, 0]);
    // The picture posted twice is fetched once, for the newer message, and the old one after it.
    expect(asked).toEqual(["F0PIC:thumb-480", "F0OLD:thumb-360"]);
    expect(document.messages.at(0)!.files).toEqual([
      { id: "F0PIC", mimetype: "image/png", name: "graph.png", sha256: SHA, shown: "picture", variant: "thumb-480" },
      { id: "F0OLD", mimetype: "image/jpeg", name: "old.jpg", sha256: SHA, shown: "picture", variant: "thumb-360" },
    ]);
    expect(document.messages.at(2)!.files).toEqual([
      {
        detail: undefined,
        id: "F0PDF",
        mimetype: "application/pdf",
        name: "spec.pdf",
        reason: "not-a-picture",
        shown: "card",
      },
    ]);
  });

  it("draws a failed fetch as a card carrying the failure's words", async () => {
    const failing: FetchPicture = async ({ fileId }) =>
      err(ChannelViewErrors.pictureUnfetched({ cause: "HTTP 403", fileId }));
    const document = unwrap(
      await channelViewDocument({
        channel: "C0CHAN",
        fetchPicture: failing,
        hasMore: false,
        lookupFile: NO_LOOKUP,
        name: "proj-monitoring",
        observedAtIso: OBSERVED,
        rows: [PAGE[1]],
        workspace: WORKSPACE,
      }),
    );

    expect(document.messages.at(0)!.files).toEqual([
      {
        detail: "the preview of F0PIC did not arrive: HTTP 403",
        id: "F0PIC",
        mimetype: "image/png",
        name: "graph.png",
        reason: "fetch-failed",
        shown: "card",
      },
    ]);
  });

  it("keeps each message's files its own when two rows share a ts", async () => {
    const twin = ({ id }: { id: string }): unknown => ({
      files: [{ id, mimetype: "application/pdf", name: `${id}.pdf` }],
      text: id,
      ts: "1790000100.000100",
      user: "U0TWIN",
    });
    const document = unwrap(
      await channelViewDocument({
        channel: "C0CHAN",
        fetchPicture: recordingFetch({ asked: [] }),
        hasMore: false,
        lookupFile: NO_LOOKUP,
        name: "proj-monitoring",
        observedAtIso: OBSERVED,
        rows: [twin({ id: "F0A" }), twin({ id: "F0B" })],
        workspace: WORKSPACE,
      }),
    );

    expect(document.messages.map((message) => [message.text, message.files.map((file) => file.id)])).toEqual([
      ["F0A", ["F0A"]],
      ["F0B", ["F0B"]],
    ]);
  });

  it("refuses a page holding a row the projection cannot vouch for", async () => {
    const refused = unwrapErr(
      await channelViewDocument({
        channel: "C0CHAN",
        fetchPicture: recordingFetch({ asked: [] }),
        hasMore: false,
        lookupFile: NO_LOOKUP,
        name: "proj-monitoring",
        observedAtIso: OBSERVED,
        rows: ["not a message"],
        workspace: WORKSPACE,
      }),
    );

    expect(refused.code).toBe("CHANNEL_ROWS_UNPROJECTABLE");
    expect(refused.message).toContain("C0CHAN");
  });
});
