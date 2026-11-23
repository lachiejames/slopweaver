/*
 * The live channel window's work limits: it stops fetching past the picture budget and says so on the card, and
 * it fetches and looks up four at a time, newest first, with the bounds unchanged. It was split out when the
 * channel-window suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import type { LookupSlackFile } from "../../../../../live/slack/blockFiles.js";
import type { FetchPicture } from "../../../../../live/slack/channelMedia.js";
import { CHANNEL_VIEW_PICTURES, channelViewDocument } from "../../../../../live/slack/channelView.js";
import { CHANNEL_VIEW_LOOKUPS, CHANNEL_VIEW_PARALLEL } from "../../../../../live/slack/channelViewLookups.js";
import { SlackFileLookupErrors } from "../../../../../live/slack/fileLookupErrors.js";
import { NO_LOOKUP, OBSERVED, recordingFetch, SHA, WORKSPACE } from "./harness.js";

describe("channelViewDocument", () => {
  it("stops fetching past the picture budget and says so on the card", async () => {
    const rows = Array.from({ length: CHANNEL_VIEW_PICTURES + 1 }, (_, index) => ({
      files: [
        {
          id: `F0N${String(index).padStart(2, "0")}`,
          mimetype: "image/png",
          name: "shot.png",
          thumb_480: "https://files.slack.com/480",
        },
      ],
      text: "shot",
      ts: `17900${String(10000 - index).padStart(5, "0")}.000100`,
      user: "U0SHOT",
    }));
    const asked: string[] = [];
    const document = unwrap(
      await channelViewDocument({
        channel: "C0CHAN",
        fetchPicture: recordingFetch({ asked }),
        hasMore: false,
        lookupFile: NO_LOOKUP,
        name: "proj-monitoring",
        observedAtIso: OBSERVED,
        rows,
        workspace: WORKSPACE,
      }),
    );

    expect(asked.length).toBe(CHANNEL_VIEW_PICTURES);
    // The oldest message is the one past the limit: the newest are drawn first.
    expect(document.messages.at(0)!.files.map((file) => file.shown)).toEqual(["card"]);
    expect(document.messages.at(0)!.files.at(0)!).toEqual({
      detail: undefined,
      id: "F0N16",
      mimetype: "image/png",
      name: "shot.png",
      reason: "past-the-limit",
      shown: "card",
    });
    expect(document.messages.at(-1)!.files.map((file) => file.shown)).toEqual(["picture"]);
  });

  it("fetches and looks up four at a time, starting newest first, with the bounds unchanged", async () => {
    const gauge = { inFlight: 0, most: 0 };
    /** Hold a call open across a few turns of the event loop, counting how many are open at once. */
    const held = async <T>({ answer }: { answer: T }): Promise<T> => {
      gauge.inFlight += 1;
      gauge.most = Math.max(gauge.most, gauge.inFlight);
      for (let turn = 0; turn < 3; turn += 1) {
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
      }
      gauge.inFlight -= 1;
      return answer;
    };
    const looked: string[] = [];
    const lookup: LookupSlackFile = async ({ fileId }) => {
      looked.push(fileId);
      return held({ answer: err(SlackFileLookupErrors.lookupFailed({ cause: "file_not_found", fileId })) });
    };
    const fetched: string[] = [];
    const fetchPicture: FetchPicture = async ({ fileId }) => {
      fetched.push(fileId);
      return held({ answer: ok({ sha256: SHA }) });
    };
    const lookupRows = Array.from({ length: CHANNEL_VIEW_LOOKUPS + 2 }, (_, index) => ({
      blocks: [{ alt_text: "x", slack_file: { id: `F0R${String(index).padStart(2, "0")}` }, type: "image" }],
      text: "ref",
      ts: `17900${String(10000 - index).padStart(5, "0")}.000100`,
      user: "U0REF",
    }));
    const lookups = unwrap(
      await channelViewDocument({
        channel: "C0CHAN",
        fetchPicture: recordingFetch({ asked: [] }),
        hasMore: false,
        lookupFile: lookup,
        name: "proj-monitoring",
        observedAtIso: OBSERVED,
        rows: lookupRows,
        workspace: WORKSPACE,
      }),
    );

    expect(gauge.most).toBe(CHANNEL_VIEW_PARALLEL);
    expect(looked).toEqual(
      Array.from({ length: CHANNEL_VIEW_LOOKUPS }, (_, index) => `F0R${String(index).padStart(2, "0")}`),
    );
    expect(lookups.messages.at(0)!.files.at(0)!).toEqual({
      detail: "F0R17 was not looked up: this read already looked up 16 files",
      id: "F0R17",
      reason: "lookup-failed",
      shown: "card",
    });

    gauge.most = 0;
    const pictureRows = Array.from({ length: CHANNEL_VIEW_PICTURES + 2 }, (_, index) => ({
      files: [
        {
          id: `F0N${String(index).padStart(2, "0")}`,
          mimetype: "image/png",
          name: "shot.png",
          thumb_480: "https://files.slack.com/480",
        },
      ],
      text: "shot",
      ts: `17900${String(10000 - index).padStart(5, "0")}.000100`,
      user: "U0SHOT",
    }));
    const pictures = unwrap(
      await channelViewDocument({
        channel: "C0CHAN",
        fetchPicture,
        hasMore: false,
        lookupFile: NO_LOOKUP,
        name: "proj-monitoring",
        observedAtIso: OBSERVED,
        rows: pictureRows,
        workspace: WORKSPACE,
      }),
    );

    expect(gauge.most).toBe(CHANNEL_VIEW_PARALLEL);
    expect(fetched).toEqual(
      Array.from({ length: CHANNEL_VIEW_PICTURES }, (_, index) => `F0N${String(index).padStart(2, "0")}`),
    );
    expect(pictures.messages.map((message) => message.files.at(0)!.shown)).toEqual([
      "card",
      "card",
      ...Array.from({ length: CHANNEL_VIEW_PICTURES }, () => "picture"),
    ]);
  });
});
