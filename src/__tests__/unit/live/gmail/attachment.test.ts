/**
 * Unit: `gmail attachment` — selecting one part, building a contained on-disk name from a sender-chosen
 * filename, the two size checks, and the whole fetch over a recording fake seam and a throwaway directory.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { writeFileAtomicBytes } from "../../../../lib/writeAtomic.js";
import type { GmailApi } from "../../../../live/gmail/api.js";
import {
  attachmentFileName,
  attachmentParts,
  decodeAttachmentData,
  fetchGmailAttachment,
  type GmailAttachmentCandidate,
  localAttachmentPath,
  selectAttachment,
} from "../../../../live/gmail/attachment.js";
import { prepareAttachmentDirectory } from "../../../../live/gmail/attachmentSave.js";
import { GmailErrors } from "../../../../live/gmail/errors.js";
import type { GmailMessage, GmailPart } from "../../../../live/gmail/parse.js";

const NOW = "2026-09-17T01:00:00.000Z";
const CONTENT = Buffer.from("WEBVTT\n\nspeaker one: hello\n", "utf8");

const TREE: GmailPart = {
  mimeType: "multipart/mixed",
  partId: "",
  parts: [
    { body: { data: "aGk", size: 2 }, mimeType: "text/plain", partId: "0" },
    {
      body: { attachmentId: "tok-1", size: CONTENT.length },
      filename: "notes.txt",
      mimeType: "text/plain",
      partId: "1",
    },
    {
      mimeType: "multipart/related",
      partId: "2",
      parts: [
        { body: { attachmentId: "tok-2", size: 10 }, filename: "notes.txt", mimeType: "text/plain", partId: "2.1" },
      ],
    },
    { body: { attachmentId: "tok-3" }, filename: "image.png", partId: "3" },
  ],
};

const MESSAGE: GmailMessage = { id: "1a0ad140e3849e8f", payload: TREE, threadId: "t1" };

/** Build a seam whose `getAttachment` records each call and answers from `body`. */
function recordingApi({
  message,
  body,
  calls,
}: {
  message: GmailMessage;
  body: { data: string; size: number | undefined };
  calls: string[];
}): GmailApi {
  const notHere = async (): Promise<never> => {
    throw new Error("the attachment fetch must only read the message and its attachment");
  };
  return {
    createDraft: notHere,
    getAttachment: async ({ attachmentId }) => {
      calls.push(attachmentId);
      return ok(body);
    },
    getDraft: notHere,
    getMessage: async ({ id }) =>
      id === message.id ? ok(message) : err(GmailErrors.apiFailed({ message: `no fixture for ${id}` })),
    getProfile: notHere,
    getThread: notHere,
    listHistory: notHere,
    listLabels: notHere,
    listMessageIds: notHere,
    modifyMessage: notHere,
    modifyThread: notHere,
    sendDraft: notHere,
  };
}

const candidate = (over: Partial<GmailAttachmentCandidate>): GmailAttachmentCandidate => ({
  attachmentId: "tok",
  filename: "notes.txt",
  mimeType: "text/plain",
  partId: "1",
  sizeBytes: 5,
  ...over,
});

describe("attachmentParts", () => {
  it("walks the tree depth-first and keeps only parts with a token and a filename", () => {
    expect(attachmentParts({ part: TREE })).toStrictEqual([
      { attachmentId: "tok-1", filename: "notes.txt", mimeType: "text/plain", partId: "1", sizeBytes: CONTENT.length },
      { attachmentId: "tok-2", filename: "notes.txt", mimeType: "text/plain", partId: "2.1", sizeBytes: 10 },
      { attachmentId: "tok-3", filename: "image.png", mimeType: undefined, partId: "3", sizeBytes: undefined },
    ]);
  });

  it("is empty for an absent payload", () => {
    expect(attachmentParts({ part: undefined })).toStrictEqual([]);
  });
});

describe("selectAttachment", () => {
  const parts = attachmentParts({ part: TREE });

  it("selects the one part a unique name matches", () => {
    expect(unwrap(selectAttachment({ parts, selector: { name: "image.png", partId: undefined } })).partId).toBe("3");
  });

  it("refuses a name two parts share, listing both with their part ids", () => {
    const error = unwrapErr(selectAttachment({ parts, selector: { name: "notes.txt", partId: undefined } }));
    expect(error.code).toBe("ATTACHMENT_AMBIGUOUS");
    expect(error.message).toBe(
      '2 attachments match; add --part <partId> to pick one: part 1 "notes.txt" (text/plain, 27 bytes); ' +
        'part 2.1 "notes.txt" (text/plain, 10 bytes)',
    );
  });

  it("disambiguates by part id when both are given", () => {
    const picked = unwrap(selectAttachment({ parts, selector: { name: "notes.txt", partId: "2.1" } }));
    expect(picked.attachmentId).toBe("tok-2");
  });

  it("refuses an unmatched name, listing every attachment the message carries", () => {
    const error = unwrapErr(selectAttachment({ parts, selector: { name: "missing.pdf", partId: undefined } }));
    expect(error.code).toBe("ATTACHMENT_NOT_FOUND");
    expect(error.message).toBe(
      'no attachment matches --name "missing.pdf"; the message carries: part 1 "notes.txt" (text/plain, 27 bytes); ' +
        'part 2.1 "notes.txt" (text/plain, 10 bytes); part 3 "image.png" (unknown type, size unknown)',
    );
  });

  it("says so when the message carries no attachments at all", () => {
    const error = unwrapErr(selectAttachment({ parts: [], selector: { name: undefined, partId: "1" } }));
    expect(error.code).toBe("ATTACHMENT_NOT_FOUND");
    expect(error.message).toBe("no attachment matches --part 1: this message carries no attachments");
  });

  it("refuses a selector naming nothing", () => {
    expect(unwrapErr(selectAttachment({ parts, selector: { name: undefined, partId: undefined } })).code).toBe(
      "ATTACHMENT_SELECTOR_MISSING",
    );
  });
});

describe("attachmentFileName", () => {
  it.each([
    [
      "Acme Widgets(Initech) x Vendor Quarterly Review 2026-01-05 09:30(GMT+01:00).txt",
      "1-Acme_Widgets_Initech_x_Vendor_Quarterly_Review_2026-01-05_09_30_GMT_01_00_.txt",
    ],
    ["../../etc/passwd", "1-.._.._etc_passwd"],
    ["/abs/path.pdf", "1-_abs_path.pdf"],
    ["a\\b.txt", "1-a_b.txt"],
    ["a\u0000b.txt", "1-a_b.txt"],
    ["..", "1-.."],
    [".bashrc", "1-attachment.bashrc"],
    ["report.tar.gz", "1-report.tar.gz"],
    ["weird.ext/../x", "1-weird.ext_.._x"],
  ])("builds %j as %j", (filename, expected) => {
    expect(attachmentFileName({ filename, partId: "1" })).toBe(expected);
  });

  it("caps a very long stem and keeps the extension", () => {
    expect(attachmentFileName({ filename: `${"a".repeat(300)}.pdf`, partId: "2.1" })).toBe(
      `2.1-${"a".repeat(100)}.pdf`,
    );
  });
});

describe("localAttachmentPath", () => {
  it("places the file directly inside the message's directory under the root", () => {
    expect(
      unwrap(localAttachmentPath({ candidate: candidate({}), messageId: "abc123", root: "/home/x/att" })),
    ).toStrictEqual({
      directory: "/home/x/att/abc123",
      partId: "1",
      path: "/home/x/att/abc123/1-notes.txt",
    });
  });

  it("refuses a message id that is not alphanumeric", () => {
    const error = unwrapErr(localAttachmentPath({ candidate: candidate({}), messageId: "../abc", root: "/r" }));
    expect(error.code).toBe("INVALID_ADDRESS");
  });

  it.each([["../1"], ["1/2"], [""]])("refuses the part id %j", (partId) => {
    expect(
      unwrapErr(localAttachmentPath({ candidate: candidate({ partId }), messageId: "abc", root: "/r" })).code,
    ).toBe("DESTINATION_UNUSABLE");
  });

  it("refuses a part Gmail gave no part id", () => {
    expect(
      unwrapErr(localAttachmentPath({ candidate: candidate({ partId: undefined }), messageId: "abc", root: "/r" }))
        .code,
    ).toBe("DESTINATION_UNUSABLE");
  });
});

describe("decodeAttachmentData", () => {
  const data = CONTENT.toString("base64url");

  it("decodes bytes whose length matches Gmail's figure", () => {
    expect(unwrap(decodeAttachmentData({ data, maxBytes: 1000, reportedBytes: CONTENT.length })).equals(CONTENT)).toBe(
      true,
    );
  });

  it("refuses a decoded length that differs from Gmail's figure", () => {
    const error = unwrapErr(decodeAttachmentData({ data, maxBytes: 1000, reportedBytes: CONTENT.length + 1 }));
    expect(error.code).toBe("ATTACHMENT_SIZE_MISMATCH");
    expect(error.message).toBe(
      "Gmail reported 28 bytes but 27 decoded; nothing was written, because a short or corrupted file would read as the real one",
    );
  });

  it("refuses decoded bytes over the ceiling even when Gmail under-reported them", () => {
    expect(unwrapErr(decodeAttachmentData({ data, maxBytes: 5, reportedBytes: 3 })).code).toBe("ATTACHMENT_TOO_LARGE");
  });

  it("refuses a body with a character the decoder would silently drop, even with no reported size", () => {
    const corrupt = `${data.slice(0, 5)}!${data.slice(6)}`;
    expect(unwrapErr(decodeAttachmentData({ data: corrupt, maxBytes: 1000, reportedBytes: undefined })).code).toBe(
      "ATTACHMENT_CORRUPT",
    );
  });

  it("refuses a body a stray padding character would truncate, even with no reported size", () => {
    const truncated = `${data.slice(0, 4)}=${data.slice(4)}`;
    expect(unwrapErr(decodeAttachmentData({ data: truncated, maxBytes: 1000, reportedBytes: undefined })).code).toBe(
      "ATTACHMENT_CORRUPT",
    );
  });

  it("accepts a padded body, since padding carries no data", () => {
    const twoBytes = Buffer.from("ab", "utf8");
    expect(twoBytes.toString("base64")).toBe("YWI=");
    expect(unwrap(decodeAttachmentData({ data: "YWI=", maxBytes: 1000, reportedBytes: 2 })).equals(twoBytes)).toBe(
      true,
    );
  });
});

describe("the fetch, over a throwaway directory", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gmail-att-"));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("refuses a symlinked message directory", () => {
    const elsewhere = join(dir, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(dir, "linked"));
    expect(unwrapErr(prepareAttachmentDirectory({ directory: join(dir, "linked") })).code).toBe("DESTINATION_UNUSABLE");
  });

  it("refuses a symlinked ancestor the attachment tree owns, and writes nothing through it", () => {
    const elsewhere = join(dir, "elsewhere");
    mkdirSync(join(dir, "live", "gmail"), { recursive: true });
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(dir, "live", "gmail", "attachments"));
    const directory = join(dir, "live", "gmail", "attachments", "1a0ad140e3849e8f");
    expect(unwrapErr(prepareAttachmentDirectory({ directory })).code).toBe("DESTINATION_UNUSABLE");
  });

  it("accepts a tree of real directories", () => {
    const directory = join(dir, "live", "gmail", "attachments", "1a0ad140e3849e8f");
    expect(prepareAttachmentDirectory({ directory }).isOk()).toBe(true);
  });

  it("refuses an over-ceiling part BEFORE fetching any bytes", async () => {
    const calls: string[] = [];
    const result = await fetchGmailAttachment({
      account: "me@example.test",
      api: recordingApi({ body: { data: "", size: 0 }, calls, message: MESSAGE }),
      maxBytes: 5,
      messageId: "1a0ad140e3849e8f",
      nowIso: () => NOW,
      root: dir,
      selector: { name: undefined, partId: "1" },
      writeBytes: writeFileAtomicBytes,
    });
    expect(unwrapErr(result).code).toBe("ATTACHMENT_TOO_LARGE");
    expect(calls).toStrictEqual([]);
  });

  it("writes nothing when the decoded bytes are not the size Gmail returned", async () => {
    const calls: string[] = [];
    const result = await fetchGmailAttachment({
      account: "me@example.test",
      api: recordingApi({ body: { data: CONTENT.toString("base64url"), size: 99 }, calls, message: MESSAGE }),
      maxBytes: 1000,
      messageId: "1a0ad140e3849e8f",
      nowIso: () => NOW,
      root: dir,
      selector: { name: undefined, partId: "1" },
      writeBytes: writeFileAtomicBytes,
    });
    expect(unwrapErr(result).code).toBe("ATTACHMENT_SIZE_MISMATCH");
    expect(calls).toStrictEqual(["tok-1"]);
    expect(existsSync(join(dir, "1a0ad140e3849e8f"))).toBe(false);
  });

  it("saves the bytes owner-only and reports the path, never the bytes or the token", async () => {
    const calls: string[] = [];
    const result = unwrap(
      await fetchGmailAttachment({
        account: "me@example.test",
        api: recordingApi({
          body: { data: CONTENT.toString("base64url"), size: CONTENT.length },
          calls,
          message: MESSAGE,
        }),
        maxBytes: 1000,
        messageId: "1a0ad140e3849e8f",
        nowIso: () => NOW,
        root: dir,
        selector: { name: "notes.txt", partId: "1" },
        writeBytes: ({ bytes, path }) => {
          writeFileAtomicBytes({ bytes, dirMode: 0o700, fileMode: 0o600, path });
        },
      }),
    );
    const expectedPath = join(dir, "1a0ad140e3849e8f", "1-notes.txt");
    expect(calls).toStrictEqual(["tok-1"]);
    expect(result.saved).toStrictEqual({
      account: "me@example.test",
      filename: "notes.txt",
      localPath: expectedPath,
      messageId: "1a0ad140e3849e8f",
      mimeType: "text/plain",
      partId: "1",
      sizeBytes: CONTENT.length,
    });
    expect(readFileSync(expectedPath).equals(CONTENT)).toBe(true);
    expect(statSync(expectedPath).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "1a0ad140e3849e8f")).mode & 0o777).toBe(0o700);
    expect(result.document.target).toStrictEqual({
      address: "1a0ad140e3849e8f/1",
      identity: "me@example.test",
      kind: "attachment",
    });
    expect(JSON.stringify(result.document)).not.toContain("tok-1");
  });
});
