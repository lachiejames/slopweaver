/*
 * Context the agent chooses: `--around` keeps the parent and the addressed reply's neighbours and downloads only
 * those, `--channel-around` adds a separately bounded channel layer with its own widen command, and a direct
 * `--since` combined with channel context is refused before any history read.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import type { SlackApi } from "../../../../../corpus/slack/fetch.js";
import { renderThreadText } from "../../../../../live/slack/document.js";
import { readSlackThread } from "../../../../../live/slack/readThread.js";
import { apiServing, LINK, type ReadApi, THREAD } from "./fixtures.js";
import { deps, recordingDownloader, tempRoot, useTempRoots } from "./harness.js";

useTempRoots();

describe("readSlackThread with agent-selected context", () => {
  const R1 = "1785114500.000100";
  const R2 = "1785114600.000200";
  const R3 = "1785114700.000300";
  const REPLY_LINK = `https://example.slack.com/archives/C123/p${R2.replace(".", "")}?thread_ts=${THREAD}`;
  const NORMALIZED_REPLY_LINK = `${REPLY_LINK}&cid=C123`;

  /** A readable file on a reply, so selection can prove withheld messages cost no attachment download. */
  function attachedReply({ fileId, ts }: { fileId: string; ts: string }): unknown {
    return {
      files: [
        {
          id: fileId,
          mimetype: "application/pdf",
          name: `${fileId}.pdf`,
          size: 4,
          url_private_download: `https://files.slack.com/${fileId}`,
        },
      ],
      text: fileId,
      thread_ts: THREAD,
      ts,
      user: "U2",
    };
  }

  it("returns parent plus the addressed reply at radius zero and downloads only those full messages", async () => {
    const calls: string[] = [];
    const doc = unwrap(
      await readSlackThread({
        around: 0,
        deps: deps({
          api: apiServing({
            messages: [
              { reply_count: 3, text: "parent", ts: THREAD, user: "U1" },
              attachedReply({ fileId: "FOLD", ts: R1 }),
              attachedReply({ fileId: "FANCHOR", ts: R2 }),
              attachedReply({ fileId: "FNEW", ts: R3 }),
            ],
          }),
          downloadFile: recordingDownloader({ calls }),
        }),
        filesRoot: tempRoot(),
        permalink: REPLY_LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    expect(doc.messages.map((message) => message.ts)).toEqual([THREAD, R2]);
    expect(doc.selection).toEqual({
      anchorTs: R2,
      around: 0,
      mode: "around",
      returned: 2,
      withheldAfter: 1,
      withheldBefore: 1,
    });
    expect(calls).toEqual(["FANCHOR.pdf"]);
    expect(doc.navigation).toEqual({
      readWholeThread: `slopweaver slack read-thread '${NORMALIZED_REPLY_LINK}'`,
      widenThread: `slopweaver slack read-thread '${NORMALIZED_REPLY_LINK}' --around 1`,
    });
    expect(renderThreadText({ document: doc })).toContain("1 older and 1 newer replies withheld");
  });

  it("adds an independently bounded channel layer and preserves it in the thread-widen command", async () => {
    const historyArgs: Parameters<SlackApi["history"]>[0][] = [];
    const base = apiServing({
      messages: [
        { reply_count: 1, text: "parent", ts: THREAD, user: "U1" },
        { text: "reply", thread_ts: THREAD, ts: R1, user: "U2" },
      ],
    });
    const api: ReadApi = {
      ...base,
      history: async (args) => {
        historyArgs.push(args);
        return {
          messages: [
            { text: "newest withheld", ts: "1785114900.000500", user: "U5" },
            { blocks: [{ type: "section" }], text: "after", ts: "1785114800.000400", user: "U4" },
            { reply_count: 1, text: "parent", ts: THREAD, user: "U1" },
            { files: [{ id: "FSUMMARY", is_external: false }], text: "before", ts: "1785114300.000050", user: "U3" },
            { text: "oldest withheld", ts: "1785114200.000040", user: "U2" },
          ],
        };
      },
    };
    const doc = unwrap(
      await readSlackThread({
        around: 0,
        channelAround: 1,
        deps: deps({ api }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    expect(historyArgs).toEqual([{ channel: "C123", latest: "9999999999", oldest: "0", paced: true }]);
    expect(doc.neighbourhood?.before.map((message) => message.textPreview)).toEqual(["before"]);
    expect(doc.neighbourhood?.after.map((message) => message.textPreview)).toEqual(["after"]);
    expect(doc.neighbourhood?.withheldBefore).toBe(1);
    expect(doc.neighbourhood?.withheldAfter).toBe(1);
    expect(doc.neighbourhood?.before[0]?.fileCount).toBe(1);
    expect(doc.neighbourhood?.after[0]?.blockCount).toBe(1);
    expect(doc.navigation).toEqual({
      readWholeThread: `slopweaver slack read-thread '${LINK}'`,
      widenChannel: `slopweaver slack read-thread '${LINK}' --around 0 --channel-around 2`,
      widenThread: `slopweaver slack read-thread '${LINK}' --around 1 --channel-around 1`,
    });
    const rendered = renderThreadText({ document: doc });
    expect(rendered).toContain("CHANNEL CONTEXT (compact navigational summaries, not full message bodies)");
    expect(rendered).toContain("1 older and 1 newer withheld");
  });

  it("refuses a direct --since plus channel-context call before reading history", async () => {
    const result = await readSlackThread({
      channelAround: 1,
      deps: deps(),
      filesRoot: tempRoot(),
      permalink: LINK,
      principal: "user",
      sinceTs: THREAD,
      token: "xoxp-test",
    });

    expect(unwrapErr(result).code).toBe("CHANNEL_SELECTION_CONFLICT");
  });
});
