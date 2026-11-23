/*
 * One PNG attachment that cannot be had: the thread still reads, the loss is named beside the message and in
 * the attachment reading, and a token missing `files:read` skips the download and says which scope it lacks.
 */
import { describe, expect, it } from "vitest";

import { err, unwrap } from "#lib/result.js";

import { renderThreadText } from "../../../../../live/slack/document.js";
import { SlackFileDownloadErrors } from "../../../../../live/slack/downloadErrors.js";
import { readSlackThread } from "../../../../../live/slack/readThread.js";
import { apiServing, LINK, type ReadApi, THREAD } from "./fixtures.js";
import { deps, recordingDownloader, tempRoot, useTempRoots } from "./harness.js";

useTempRoots();

/** A thread whose single message carries one readable PNG attachment. */
function threadWithOneAttachment({
  scopes,
  unknownScopes = false,
}: {
  scopes?: readonly string[];
  unknownScopes?: boolean;
} = {}): ReadApi {
  const api = apiServing({
    messages: [
      {
        files: [
          {
            id: "F0BKXLKV0QJ",
            mimetype: "image/png",
            name: "diagram.png",
            size: 14,
            url_private_download: "https://files.slack.com/files-pri/T1-F1/download/diagram.png",
          },
        ],
        text: "see this",
        ts: THREAD,
        user: "U1",
      },
    ],
    ...(scopes !== undefined ? { scopes } : {}),
  });
  // `undefined` from the seam is the "could not be established" case, which the fake cannot express by
  // omitting the field — the default would fill it back in.
  return unknownScopes ? { ...api, grantedScopes: async () => undefined } : api;
}

describe("readSlackThread — a lost attachment never costs the thread", () => {
  it("returns the messages and NAMES the file, rather than failing the whole read", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps({
          api: threadWithOneAttachment(),
          downloadFile: async () =>
            err(
              SlackFileDownloadErrors.responseRejected({
                filename: "F0BKXLKV0QJ.png",
                reason: "Slack returned HTTP 403 for the file",
              }),
            ),
        }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    // The read SUCCEEDS — the message survives a file that could not be fetched.
    expect(doc.messageCount).toBe(1);
    expect(doc.messages[0]!.text).toBe("see this");
    // And the loss is stated in all three places, so nothing about it is silent.
    expect(doc.files).toEqual([]);
    expect(doc.unretrievableFiles.length).toBe(1);
    expect(doc.unretrievableFiles[0]!.fileId).toBe("F0BKXLKV0QJ");
    expect(doc.unretrievableFiles[0]!.reason).toBe("download-failed");
    expect(doc.fileCompleteness.verdict).toBe("unretrievable-loss");
    expect(doc.fileCompleteness.unretrievable).toBe(1);
    expect(doc.limitations.join(" ")).toContain("diagram.png (F0BKXLKV0QJ)");
    expect(doc.warnings.join(" ")).toContain("1 attachment could NOT be retrieved");
  });

  it("tells the model, beside the message itself, that it is reading without the content", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps({
          api: threadWithOneAttachment(),
          downloadFile: async () => err(SlackFileDownloadErrors.emptyBody({ filename: "F0BKXLKV0QJ.png" })),
        }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    const rendered = renderThreadText({ document: doc });

    expect(rendered).toContain("NOT AVAILABLE (download-failed)");
    expect(rendered).toContain("You are reading this message WITHOUT its content");
    expect(rendered).toContain("attachments: unretrievable-loss — 1 seen on the messages returned, 0 retrieved");
  });

  it("names a lost attachment by its name and mimetype, or by its id and `unknown` when Slack sent neither", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps({
          api: threadWithOneAttachment(),
          downloadFile: async () => err(SlackFileDownloadErrors.emptyBody({ filename: "F0BKXLKV0QJ.png" })),
        }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );
    const lost = doc.unretrievableFiles[0]!;
    const bare = {
      detail: lost.detail,
      fileId: lost.fileId,
      messageTs: lost.messageTs,
      method: lost.method,
      reason: lost.reason,
    };

    expect(renderThreadText({ document: doc })).toContain(
      "file diagram.png (image/png) -> NOT AVAILABLE (download-failed): ",
    );
    expect(renderThreadText({ document: { ...doc, unretrievableFiles: [bare] } })).toContain(
      "file F0BKXLKV0QJ (unknown) -> NOT AVAILABLE (download-failed): ",
    );
  });

  it("prints the attachment reading on a CLEAN read too, so its absence never means 'fine'", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps({ api: threadWithOneAttachment(), downloadFile: recordingDownloader({ calls: [] }) }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    expect(doc.fileCompleteness.verdict).toBe("complete");
    expect(renderThreadText({ document: doc })).toContain("file diagram.png (image/png) -> READ THIS: ");
    expect(renderThreadText({ document: doc })).toContain(
      "attachments: complete — 1 seen on the messages returned, 1 retrieved, 0 skipped by rule, 0 unretrievable (file scope: sufficient)",
    );
  });
});

describe("readSlackThread — the scope preflight", () => {
  it("does not attempt a download, and says which scope is missing, on a narrowed token", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps({
          api: threadWithOneAttachment({ scopes: ["channels:history", "users:read"] }),
          downloadFile: async ({ filename }) => {
            throw new Error(`no download must be attempted without files:read, but one was for ${filename}`);
          },
        }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    expect(doc.scopePreflight.verdict).toBe("insufficient");
    expect(doc.scopePreflight.missing).toEqual(["files:read"]);
    expect(doc.unretrievableFiles[0]!.reason).toBe("scope-missing");
    expect(doc.warnings.join(" ")).toContain("missing the Slack scope(s) files:read");
    // The messages still came back in full: a scope gap costs the attachments, never the thread.
    expect(doc.messageCount).toBe(1);
  });

  it("reads the thread and states the gap when the scope set could not be established", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps({
          api: threadWithOneAttachment({ unknownScopes: true }),
          downloadFile: recordingDownloader({ calls: [] }),
        }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    // The download still happened — a failed diagnostic must not stop a read.
    expect(doc.files.length).toBe(1);
    expect(doc.scopePreflight.verdict).toBe("undetermined");
    expect(doc.scopePreflight.granted).toBe(null);
    // But the document does NOT claim the scope was verified.
    expect(doc.warnings.join(" ")).toContain("could not be established");
  });
});
