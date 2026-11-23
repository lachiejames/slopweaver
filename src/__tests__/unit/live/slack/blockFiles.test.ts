import { describe, expect, it } from "vitest";

import type { SlackApi } from "../../../../corpus/slack/fetch.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { type LookupSlackFile, resolveBlockFileRefs, slackFileLookup } from "../../../../live/slack/blockFiles.js";
import { SlackFileLookupErrors } from "../../../../live/slack/fileLookupErrors.js";
import type { VisibleSlackFile, VisibleSlackMessage } from "../../../../live/slack/types.js";

/** One projected message carrying only the fields this module reads. */
function message({ ts, refs }: { ts: string; refs: readonly string[] }): VisibleSlackMessage {
  return { blockFileRefs: refs, ts } as unknown as VisibleSlackMessage;
}

/** A lookup that records what it was asked and answers from a table. Injected, not mocked. */
function lookupFrom({
  table,
  asked,
}: {
  table: Readonly<Record<string, VisibleSlackFile>>;
  asked: string[];
}): LookupSlackFile {
  return async ({ fileId }) => {
    asked.push(fileId);
    const file = table[fileId];
    return file === undefined
      ? err(SlackFileLookupErrors.lookupFailed({ cause: new Error("file_not_found"), fileId }))
      : ok(file);
  };
}

const PNG: VisibleSlackFile = {
  id: "F0ASRB5L69X",
  isExternal: false,
  mimetype: "image/png",
  urlPrivateDownload: "https://files.slack.com/files-pri/T1-F1/download/x.png",
};

describe("resolveBlockFileRefs", () => {
  it("resolves a reference to the file object the plan can act on", async () => {
    const asked: string[] = [];

    const resolution = await resolveBlockFileRefs({
      lookup: lookupFrom({ asked, table: { F0ASRB5L69X: PNG } }),
      messages: [message({ refs: ["F0ASRB5L69X"], ts: "1.000001" })],
    });

    expect(asked).toEqual(["F0ASRB5L69X"]);
    expect(resolution.unresolved).toEqual([]);
    expect(resolution.resolved).toEqual([{ file: PNG, messageTs: "1.000001" }]);
  });

  it("makes NO call at all for a thread with no references", async () => {
    const asked: string[] = [];

    const resolution = await resolveBlockFileRefs({
      lookup: lookupFrom({ asked, table: {} }),
      messages: [message({ refs: [], ts: "1.000001" }), message({ refs: [], ts: "1.000002" })],
    });

    expect(asked).toEqual([]);
    expect(resolution.resolved).toEqual([]);
    expect(resolution.unresolved).toEqual([]);
  });

  it("accounts for a failed lookup with the provider's own words, never dropping the id", async () => {
    const resolution = await resolveBlockFileRefs({
      lookup: lookupFrom({ asked: [], table: {} }),
      messages: [message({ refs: ["F0ASRB5L69X"], ts: "1.000001" })],
    });

    expect(resolution.resolved).toEqual([]);
    expect(resolution.unresolved).toEqual([
      {
        detail: "files.info on F0ASRB5L69X failed: file_not_found",
        fileId: "F0ASRB5L69X",
        messageTs: "1.000001",
        reason: "block-lookup-failed",
      },
    ]);
  });

  it("looks an id up ONCE even when two messages reference it, and still reports both", async () => {
    const asked: string[] = [];

    const resolution = await resolveBlockFileRefs({
      lookup: lookupFrom({ asked, table: { F0ASRB5L69X: PNG } }),
      messages: [
        message({ refs: ["F0ASRB5L69X"], ts: "1.000001" }),
        message({ refs: ["F0ASRB5L69X"], ts: "1.000002" }),
      ],
    });

    expect(asked).toEqual(["F0ASRB5L69X"]); // one call, not two — these share the workspace quota
    expect(resolution.resolved.map((entry) => entry.messageTs)).toEqual(["1.000001", "1.000002"]);
  });

  it("caches a FAILED lookup too, so a missing scope is not asked about once per message", async () => {
    const asked: string[] = [];

    const resolution = await resolveBlockFileRefs({
      lookup: lookupFrom({ asked, table: {} }),
      messages: [
        message({ refs: ["F0ASRB5L69X"], ts: "1.000001" }),
        message({ refs: ["F0ASRB5L69X"], ts: "1.000002" }),
      ],
    });

    expect(asked).toEqual(["F0ASRB5L69X"]);
    expect(resolution.unresolved.map((entry) => entry.messageTs)).toEqual(["1.000001", "1.000002"]);
  });

  it("keeps one failing id from hiding a second that resolves fine", async () => {
    const second: VisibleSlackFile = { ...PNG, id: "F0B4833K5AP" };

    const resolution = await resolveBlockFileRefs({
      lookup: lookupFrom({ asked: [], table: { F0B4833K5AP: second } }),
      messages: [message({ refs: ["F0ASRB5L69X", "F0B4833K5AP"], ts: "1.000001" })],
    });

    expect(resolution.resolved.map((entry) => entry.file.id)).toEqual(["F0B4833K5AP"]);
    expect(resolution.unresolved.map((entry) => entry.fileId)).toEqual(["F0ASRB5L69X"]);
  });
});

describe("slackFileLookup", () => {
  it("projects the files.info payload with the SAME projector a top-level attachment goes through", async () => {
    const api: Pick<SlackApi, "filesInfo"> = {
      filesInfo: async ({ fileId }) => ({
        file: {
          id: fileId,
          is_external: false,
          mimetype: "image/png",
          name: "from-a-block.png",
          size: 4096,
          url_private_download: "https://files.slack.com/files-pri/T1-F1/download/from-a-block.png",
        },
      }),
    };

    const looked = await slackFileLookup({ api })({ fileId: "F0ASRB5L69X" });

    expect(looked.isOk()).toBe(true);
    const file = unwrap(looked);
    expect(file.id).toBe("F0ASRB5L69X");
    expect(file.mimetype).toBe("image/png");
    expect(file.size).toBe(4096);
    expect(file.isExternal).toBe(false);
    expect(file.urlPrivateDownload).toBe("https://files.slack.com/files-pri/T1-F1/download/from-a-block.png");
  });

  it("turns a thrown SDK error into a VALUE, which is what lets the read degrade instead of dying", async () => {
    const api: Pick<SlackApi, "filesInfo"> = {
      filesInfo: async () => {
        throw new Error("missing_scope");
      },
    };

    const looked = await slackFileLookup({ api })({ fileId: "F0ASRB5L69X" });

    expect(looked.isErr()).toBe(true);
    expect(unwrapErr(looked).message).toBe("files.info on F0ASRB5L69X failed: missing_scope");
  });

  it("fails the lookup rather than inventing a file when files.info answers with no file at all", async () => {
    const api: Pick<SlackApi, "filesInfo"> = { filesInfo: async () => ({ file: undefined }) };

    const looked = await slackFileLookup({ api })({ fileId: "F0ASRB5L69X" });

    expect(looked.isErr()).toBe(true);
    // Named for its real source: the projector's own wording says "a message carried …", which would point
    // a reader at the wrong half of the system.
    expect(unwrapErr(looked).message).toContain("files.info on F0ASRB5L69X returned no usable file");
  });
});
