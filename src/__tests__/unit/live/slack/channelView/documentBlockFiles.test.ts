/*
 * The live channel window over Block Kit file references: a reference by URL or id is resolved and an
 * unresolvable one drawn as a lookup card, and at most the lookup bound of them is looked up, newest first. It
 * was split out when the channel-window suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import type { LookupSlackFile } from "../../../../../live/slack/blockFiles.js";
import { channelViewDocument } from "../../../../../live/slack/channelView.js";
import { CHANNEL_VIEW_LOOKUPS } from "../../../../../live/slack/channelViewLookups.js";
import { SlackFileLookupErrors } from "../../../../../live/slack/fileLookupErrors.js";
import { OBSERVED, recordingFetch, WORKSPACE } from "./harness.js";

describe("channelViewDocument", () => {
  it("resolves a Block Kit file reference, and draws an unresolvable one as a lookup card", async () => {
    const lookup: LookupSlackFile = async ({ fileId }) => {
      if (fileId === "F0BLK") {
        return ok({
          id: "F0BLK",
          isExternal: false,
          mimetype: "image/png",
          name: "block.png",
          thumb480Url: "https://files.slack.com/blk",
        });
      }
      return err(SlackFileLookupErrors.lookupFailed({ cause: "file_not_found", fileId }));
    };
    const asked: string[] = [];
    const document = unwrap(
      await channelViewDocument({
        channel: "C0CHAN",
        fetchPicture: recordingFetch({ asked }),
        hasMore: false,
        lookupFile: lookup,
        name: "proj-monitoring",
        observedAtIso: OBSERVED,
        rows: [
          {
            blocks: [
              // Slack accepts a file reference by URL as well as by id.
              {
                alt_text: "a",
                slack_file: { url: "https://files.slack.com/files-pri/T012-F0BLK/b.png" },
                type: "image",
              },
              { alt_text: "b", slack_file: { id: "F0GONE" }, type: "image" },
              // A rich-text section may carry a file element too.
              {
                elements: [{ elements: [{ file_id: "F0RICH", type: "file" }], type: "rich_text_section" }],
                type: "rich_text",
              },
            ],
            text: "",
            ts: "1790000100.000100",
            user: "U0BLK",
          },
        ],
        workspace: WORKSPACE,
      }),
    );

    expect(asked).toEqual(["F0BLK:thumb-480"]);
    expect(document.messages.at(0)!.files.map((file) => [file.id, file.shown])).toEqual([
      ["F0BLK", "picture"],
      ["F0GONE", "card"],
      ["F0RICH", "card"],
    ]);
    expect(document.messages.at(0)!.files.at(1)!).toEqual({
      detail: expect.stringContaining("file_not_found"),
      id: "F0GONE",
      mimetype: undefined,
      name: undefined,
      reason: "lookup-failed",
      shown: "card",
    });
  });

  it("looks up at most the lookup bound of block references, newest first, and cards the rest", async () => {
    const looked: string[] = [];
    const lookup: LookupSlackFile = async ({ fileId }) => {
      looked.push(fileId);
      return err(SlackFileLookupErrors.lookupFailed({ cause: "file_not_found", fileId }));
    };
    const rows = Array.from({ length: CHANNEL_VIEW_LOOKUPS + 1 }, (_, index) => ({
      blocks: [{ alt_text: "x", slack_file: { id: `F0R${String(index).padStart(2, "0")}` }, type: "image" }],
      text: "ref",
      ts: `17900${String(10000 - index).padStart(5, "0")}.000100`,
      user: "U0REF",
    }));
    const document = unwrap(
      await channelViewDocument({
        channel: "C0CHAN",
        fetchPicture: recordingFetch({ asked: [] }),
        hasMore: false,
        lookupFile: lookup,
        name: "proj-monitoring",
        observedAtIso: OBSERVED,
        rows,
        workspace: WORKSPACE,
      }),
    );

    expect(looked.length).toBe(CHANNEL_VIEW_LOOKUPS);
    // Rows are newest first, so the last one is the oldest message and the one left un-asked.
    expect(looked.includes("F0R16")).toBe(false);
    expect(document.messages.at(0)!.files).toEqual([
      {
        detail: "F0R16 was not looked up: this read already looked up 16 files",
        id: "F0R16",
        mimetype: undefined,
        name: undefined,
        reason: "lookup-failed",
        shown: "card",
      },
    ]);
  });
});
