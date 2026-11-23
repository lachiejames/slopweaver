/**
 * Unit: what a read lists for one attachment part — the filename as given, the declared media type or RFC
 * 2046's name for undeclared binary data, and Gmail's byte count or `0` where it gave none.
 */
import { describe, expect, it } from "vitest";

import { attachmentMetadata } from "../../../../live/gmail/attachmentMeta.js";

describe("attachmentMetadata", () => {
  it("reports the part's own name, media type and size", () => {
    const part = { body: { attachmentId: "att-1", size: 2048 }, filename: "notes.pdf", mimeType: "application/pdf" };
    expect(attachmentMetadata({ part })).toStrictEqual({
      filename: "notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
    });
  });

  it("names an omitted or null media type as undeclared binary data", () => {
    const omitted = { body: { attachmentId: "att-1", size: 5 }, filename: "blob" };
    const nulled = { body: { attachmentId: "att-1", size: 5 }, filename: "blob", mimeType: null };
    expect(attachmentMetadata({ part: omitted }).mimeType).toBe("application/octet-stream");
    expect(attachmentMetadata({ part: nulled }).mimeType).toBe("application/octet-stream");
  });

  it("lists an omitted or null size as 0 bytes, and keeps a reported 0 as itself", () => {
    const omitted = { body: { attachmentId: "att-1" }, filename: "a.txt", mimeType: "text/plain" };
    const nulled = { body: { attachmentId: "att-1", size: null }, filename: "a.txt", mimeType: "text/plain" };
    const empty = { body: { attachmentId: "att-1", size: 0 }, filename: "a.txt", mimeType: "text/plain" };
    expect(attachmentMetadata({ part: omitted }).sizeBytes).toBe(0);
    expect(attachmentMetadata({ part: nulled }).sizeBytes).toBe(0);
    expect(attachmentMetadata({ part: empty }).sizeBytes).toBe(0);
  });
});
