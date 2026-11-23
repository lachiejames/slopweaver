/*
 * A read bounded by `--since`: only messages after the anchor come back and only their attachments are fetched,
 * while the counts and completeness keep describing the whole thread and the rendered text states the bound.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { renderThreadText } from "../../../../../live/slack/document.js";
import { readSlackThread } from "../../../../../live/slack/readThread.js";
import { apiServing, LINK, THREAD } from "./fixtures.js";
import { deps, recordingDownloader, tempRoot, useTempRoots } from "./harness.js";

useTempRoots();

describe("readSlackThread with --since", () => {
  const OLD = "1785114500.000100";
  const NEW = "1785114600.000200";

  /** A parent, an older reply carrying an attachment, and a newer reply carrying a different one. */
  function twoAttachedReplies(): readonly unknown[] {
    return [
      { text: "parent", ts: THREAD, user: "U1" },
      {
        files: [
          {
            id: "FOLD",
            mimetype: "application/pdf",
            name: "old.pdf",
            size: 4,
            url_private_download: "https://files.slack.com/old",
          },
        ],
        text: "older",
        thread_ts: THREAD,
        ts: OLD,
        user: "U2",
      },
      {
        files: [
          {
            id: "FNEW",
            mimetype: "application/pdf",
            name: "new.pdf",
            size: 4,
            url_private_download: "https://files.slack.com/new",
          },
        ],
        text: "newer",
        thread_ts: THREAD,
        ts: NEW,
        user: "U3",
      },
    ];
  }

  it("returns only messages posted after the anchor, and never the anchor itself", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps({ api: apiServing({ messages: twoAttachedReplies() }) }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        sinceTs: OLD,
        token: "xoxp-test",
      }),
    );

    expect(doc.messages.map((m) => m.ts)).toEqual([NEW]);
  });

  it("keeps messageCount describing the WHOLE thread, not the returned subset", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps({ api: apiServing({ messages: twoAttachedReplies() }) }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        sinceTs: OLD,
        token: "xoxp-test",
      }),
    );

    expect(doc.messageCount).toBe(3);
    expect(doc.replyCount).toBe(2);
    expect(doc.messages.length).toBe(1);
  });

  it("does NOT fetch the attachment of a withheld message — the caller already has it", async () => {
    const calls: string[] = [];
    const doc = unwrap(
      await readSlackThread({
        deps: deps({
          api: apiServing({ messages: twoAttachedReplies() }),
          downloadFile: recordingDownloader({ calls }),
        }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        sinceTs: OLD,
        token: "xoxp-test",
      }),
    );

    expect(calls).toEqual(["FNEW.pdf"]);
    expect(doc.files.map((f) => f.fileId)).toEqual(["FNEW"]);
  });

  it("leaves completeness describing the whole thread, so a selection is never read as provider loss", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps({
          api: apiServing({
            messages: [
              { reply_count: 2, text: "parent", ts: THREAD, user: "U1" },
              { text: "older", thread_ts: THREAD, ts: OLD, user: "U2" },
              { text: "newer", thread_ts: THREAD, ts: NEW, user: "U3" },
            ],
          }),
        }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        sinceTs: OLD,
        token: "xoxp-test",
      }),
    );

    expect(doc.completeness.held).toBe(3);
    expect(doc.completeness.verdict).toBe("corroborated");
  });

  it("carries the limitation into the rendered text, where the model actually reads it", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps({ api: apiServing({ messages: twoAttachedReplies() }) }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        sinceTs: OLD,
        token: "xoxp-test",
      }),
    );

    const rendered = renderThreadText({ document: doc });

    expect(rendered).toContain("since 1785114500.000100: returning 1 of 3 message(s), 2 withheld as already read");
    expect(rendered).toContain("edited or deleted");
  });

  it("says a full read is a full read, and adds no limitation to it", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps({ api: apiServing({ messages: twoAttachedReplies() }) }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    expect(doc.selection).toEqual({ mode: "full", returned: 3 });
    expect(renderThreadText({ document: doc })).toContain("returning all 3 message(s) — no thread bound was given");
    expect(doc.limitations.join(" ")).not.toContain("edited or deleted");
  });
});
