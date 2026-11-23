/*
 * What a read does with each kind of attachment: a readable image downloaded to a local path, a PDF's words
 * read into the thread, a scanned PDF stated as text-less, a video stated as skipped, a failed download named
 * rather than dropped, and a Block Kit `slack_file` reference resolved through `files.info` or stated as lost.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { err, ok, unwrap } from "#lib/result.js";

import { renderThreadText } from "../../../../../live/slack/document.js";
import type { DownloadFile } from "../../../../../live/slack/download.js";
import { SlackFileDownloadErrors } from "../../../../../live/slack/downloadErrors.js";
import { readSlackThread, threadDirectoryKey } from "../../../../../live/slack/readThread.js";
import { apiServing, CANONICAL_WORKSPACE, LINK, refusingHistory, THREAD } from "./fixtures.js";
import { deps, recordingDownloader, tempRoot, useTempRoots } from "./harness.js";

/** A downloader that serves one committed fixture's bytes — the real document, through the real seam. */
function fixtureDownloader({ fixture }: { fixture: string }): DownloadFile {
  return async ({ filename, destinationDir }) => {
    const bytes = readFileSync(fixture);
    const localPath = join(destinationDir, filename);
    writeFileSync(localPath, bytes);
    return ok({ bytes: bytes.byteLength, localPath });
  };
}

/** The one-page fixture with a real text layer. */
const TEXT_SAMPLE = join(import.meta.dirname, "../../../../fixtures/pdf/text-sample.pdf");

/** The two-page fixture drawn without a font, so it has no text layer at all. */
const SCANNED_SAMPLE = join(import.meta.dirname, "../../../../fixtures/pdf/scanned-sample.pdf");

useTempRoots();

describe("readSlackThread", () => {
  it("downloads a readable attachment and reports its local path", async () => {
    const calls: string[] = [];
    const root = tempRoot();
    const doc = unwrap(
      await readSlackThread({
        deps: deps({
          api: apiServing({
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
          }),
          downloadFile: recordingDownloader({ calls }),
        }),
        filesRoot: root,
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    expect(calls).toEqual(["F0BKXLKV0QJ.png"]);
    expect(doc.files.length).toBe(1);
    expect(doc.files[0]!.localPath).toBe(
      join(root, threadDirectoryKey({ channel: "C123", threadTs: THREAD }), "F0BKXLKV0QJ.png"),
    );
    expect(readFileSync(doc.files[0]!.localPath, "utf8")).toContain("bytes-of");
  });

  it("reads a PDF attachment's words into the thread, not just its path", async () => {
    // THE DEFECT THIS FIXES: measured, a thread carrying a 321,706-byte pentest report rendered
    // as a local path and nothing else. A session answering the tag that carried it cannot open a file.
    const root = tempRoot();
    const doc = unwrap(
      await readSlackThread({
        deps: deps({
          api: apiServing({
            messages: [
              {
                files: [
                  {
                    id: "F0PDF0001",
                    mimetype: "application/pdf",
                    name: "policy.pdf",
                    size: 2000,
                    url_private_download: "https://files.slack.com/files-pri/T1-F1/download/policy.pdf",
                  },
                ],
                text: "what does this say",
                ts: THREAD,
                user: "U1",
              },
            ],
          }),
          downloadFile: fixtureDownloader({ fixture: TEXT_SAMPLE }),
        }),
        filesRoot: root,
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    expect(doc.files.length).toBe(1);
    expect(doc.files[0]!.text).toContain("personnel and contractors");
    expect(doc.files[0]!.pdf).toEqual({ glyphless: false, pages: 1, pagesRead: 1 });

    const rendered = renderThreadText({ document: doc });
    expect(rendered).toContain("--- text of policy.pdf (1 page(s)) ---");
    expect(rendered).toContain("personnel and contractors");
  });

  it("says a scanned PDF has no text layer where the message is, never a blank body", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps({
          api: apiServing({
            messages: [
              {
                files: [
                  {
                    id: "F0PDF0002",
                    mimetype: "application/pdf",
                    name: "scan.pdf",
                    size: 2000,
                    url_private_download: "https://files.slack.com/files-pri/T1-F1/download/scan.pdf",
                  },
                ],
                text: "and this one",
                ts: THREAD,
                user: "U1",
              },
            ],
          }),
          downloadFile: fixtureDownloader({ fixture: SCANNED_SAMPLE }),
        }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    expect(doc.files[0]!.text).toBe(undefined);
    expect(doc.files[0]!.pdf).toEqual({ glyphless: true, pages: 2, pagesRead: 2 });
    expect(renderThreadText({ document: doc })).toContain("no extractable text");
  });

  it("STATES a skipped video rather than dropping it", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps({
          api: apiServing({
            messages: [
              {
                files: [{ id: "F1", mimetype: "video/mp4", name: "demo.mp4", size: 213_000_000 }],
                text: "watch",
                ts: THREAD,
                user: "U1",
              },
            ],
          }),
        }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    expect(doc.files.length).toBe(0);
    expect(doc.skippedFiles[0]!.reason).toBe("not-model-readable");
    expect(doc.limitations).toEqual(["1 file not retrieved: not a type the model can read (video/audio/binary)"]);
  });

  it("never returns a thread SILENTLY missing its file when a planned download fails", async () => {
    // This case used to assert the read FAILED outright. That was the defect, not the contract: killing the
    // whole thread to report one file meant a single unreachable attachment cost the reader every message.
    // The invariant it was reaching for is the one asserted here — a file that did not arrive is never
    // merely absent — and it is now met without destroying the read. See `completeness.ts` for the argument.
    const failing: DownloadFile = async () =>
      err(
        SlackFileDownloadErrors.responseRejected({
          filename: "diagram.png",
          reason: "Slack returned an HTML page instead of file bytes (the token is probably not authorised for it)",
        }),
      );
    const result = await readSlackThread({
      deps: deps({
        api: apiServing({
          messages: [
            {
              files: [
                {
                  id: "F0BKXLKV0QJ",
                  mimetype: "image/png",
                  size: 10,
                  url_private_download: "https://files.slack.com/files-pri/T1-F1/download/x",
                },
              ],
              text: "see",
              ts: THREAD,
              user: "U1",
            },
          ],
        }),
        downloadFile: failing,
      }),
      filesRoot: tempRoot(),
      permalink: LINK,
      principal: "user",
      token: "xoxp-test",
    });

    const doc = unwrap(result);
    expect(doc.files).toEqual([]);
    expect(doc.unretrievableFiles.length).toBe(1);
    expect(doc.unretrievableFiles[0]!.detail).toContain("HTML page");
    expect(doc.limitations.join(" ")).toContain("HTML page");
    expect(renderThreadText({ document: doc })).toContain("NOT AVAILABLE");
  });

  it("RETRIEVES a Block Kit `slack_file` reference through files.info instead of only naming it", async () => {
    const calls: string[] = [];
    const looked: string[] = [];
    const doc = unwrap(
      await readSlackThread({
        deps: deps({
          api: {
            filesInfo: async ({ fileId }) => {
              looked.push(fileId);
              return {
                file: {
                  id: fileId,
                  mimetype: "image/png",
                  name: "from-a-block.png",
                  size: 20,
                  url_private_download: "https://files.slack.com/files-pri/T1-F1/download/from-a-block.png",
                },
              };
            },
            grantedScopes: async () => ["files:read"],
            history: refusingHistory,
            replies: async () => ({
              messages: [
                {
                  blocks: [{ slack_file: { id: "F0ASRB5L69X" }, type: "image" }],
                  text: "",
                  ts: THREAD,
                  user: "U1",
                },
              ],
            }),
            workspaceUrl: async () => CANONICAL_WORKSPACE,
          },
          downloadFile: recordingDownloader({ calls }),
        }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    expect(looked).toEqual(["F0ASRB5L69X"]);
    expect(calls).toEqual(["F0ASRB5L69X.png"]);
    expect(doc.files.length).toBe(1);
    expect(doc.files[0]!.fileId).toBe("F0ASRB5L69X");
    expect(doc.skippedFiles).toEqual([]);
  });

  it("degrades a failed files.info to a STATED skip carrying the provider's words, not a dead read", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps({
          api: {
            filesInfo: async () => {
              throw new Error("missing_scope");
            },
            grantedScopes: async () => ["files:read"],
            history: refusingHistory,
            replies: async () => ({
              messages: [
                { blocks: [{ slack_file: { id: "F0ASRB5L69X" }, type: "image" }], text: "", ts: THREAD, user: "U1" },
              ],
            }),
            workspaceUrl: async () => CANONICAL_WORKSPACE,
          },
        }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    // The whole thread still reads — before this the id was a skip anyway, so a fatal lookup would be a
    // regression in availability rather than a gain in honesty.
    expect(doc.messageCount).toBe(1);
    expect(doc.skippedFiles.length).toBe(1);
    expect(doc.skippedFiles[0]!.reason).toBe("block-lookup-failed");
    expect(doc.skippedFiles[0]!.detail).toBe("files.info on F0ASRB5L69X failed: missing_scope");
    expect(doc.limitations).toEqual([
      "1 file referenced only inside Block Kit not retrieved: files.info could not resolve the id to a download URL (see `detail`)",
    ]);
  });
});
