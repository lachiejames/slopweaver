/*
 * What a file attached in the Messenger may be: one of the three pictures `file_read` returns as a picture, or
 * UTF-8 text it reads as a window — refused whole otherwise, never cut down — kept under a name that is a plain file
 * name and not a credential's.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  ATTACHMENT_NAME_MAX_BYTES,
  ATTACHMENT_PICTURE_MAX_BYTES,
  ATTACHMENT_TEXT_MAX_BYTES,
  attachmentCapOf,
  attachmentVerdict,
  safeAttachmentName,
} from "../../../talk/attachment.js";

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const WEBP_HEAD = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];

/** What every binary refusal says the voice can read. */
const READABLE = "the voice reads PNG, JPEG and WebP pictures and UTF-8 text files, not a PDF or other binary file";

/** A picture of exactly `size` bytes opening with `head`. */
function picture({ head, size }: { head: readonly number[]; size: number }): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(head);
  return bytes;
}

/** A text file of exactly `size` ASCII bytes. */
function text({ size }: { size: number }): Uint8Array {
  return new Uint8Array(size).fill(0x61);
}

describe("attachmentVerdict", () => {
  it("keeps each of the three pictures by its first bytes, whatever it is called", () => {
    const kept = [PNG_HEAD, JPEG_HEAD, WEBP_HEAD].map((head) =>
      unwrap(attachmentVerdict({ bytes: picture({ head, size: 64 }), name: "shot.txt" })),
    );
    expect(kept).toMatchObject([
      { kind: "picture", mediaType: "image/png", safeName: "shot.txt" },
      { kind: "picture", mediaType: "image/jpeg", safeName: "shot.txt" },
      { kind: "picture", mediaType: "image/webp", safeName: "shot.txt" },
    ]);
  });

  it("keeps a picture at its cap and refuses one byte over it, never cut down", () => {
    const at = attachmentVerdict({
      bytes: picture({ head: PNG_HEAD, size: ATTACHMENT_PICTURE_MAX_BYTES }),
      name: "a.png",
    });
    expect(unwrap(at).bytes.length).toBe(ATTACHMENT_PICTURE_MAX_BYTES);
    const over = attachmentVerdict({
      bytes: picture({ head: PNG_HEAD, size: ATTACHMENT_PICTURE_MAX_BYTES + 1 }),
      name: "a.png",
    });
    expect(unwrapErr(over)).toEqual({
      bytes: 8_388_609,
      code: "TOO_LARGE",
      maxBytes: 8_388_608,
      message: "the picture is 8388609 bytes; the most attached is 8388608",
    });
  });

  it("keeps a text file at its cap and refuses one byte over it", () => {
    const at = unwrap(attachmentVerdict({ bytes: text({ size: ATTACHMENT_TEXT_MAX_BYTES }), name: "notes.md" }));
    expect([at.kind, at.safeName, at.bytes.length]).toEqual(["text", "notes.md", 1_048_576]);
    const over = attachmentVerdict({ bytes: text({ size: ATTACHMENT_TEXT_MAX_BYTES + 1 }), name: "notes.md" });
    expect(unwrapErr(over).message).toBe("the text file is 1048577 bytes; the most attached is 1048576");
  });

  it("keeps Unicode text byte for byte", () => {
    const bytes = new TextEncoder().encode("café — 東京\n");
    const kept = unwrap(attachmentVerdict({ bytes, name: "note.txt" }));
    expect(Array.from(kept.bytes)).toEqual(Array.from(bytes));
  });

  it("refuses an empty file", () => {
    expect(unwrapErr(attachmentVerdict({ bytes: new Uint8Array(0), name: "a.txt" }))).toEqual({
      code: "EMPTY",
      message: "the file is empty",
    });
  });

  it("refuses a file holding a NUL byte, and one that is not UTF-8, naming what the voice reads", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\n\u0000binary");
    const latin1 = Uint8Array.from([0x63, 0x61, 0x66, 0xe9]);
    expect([pdf, latin1].map((bytes) => unwrapErr(attachmentVerdict({ bytes, name: "doc" })))).toEqual([
      {
        code: "BINARY",
        message: `the file is not a picture or text (it holds a NUL byte): ${READABLE}`,
        reason: "nul-byte",
      },
      {
        code: "BINARY",
        message: `the file is not a picture or text (it is not valid UTF-8): ${READABLE}`,
        reason: "invalid-utf8",
      },
    ]);
  });

  it("judges the name before the bytes", () => {
    expect(unwrapErr(attachmentVerdict({ bytes: new Uint8Array(0), name: ".env" })).code).toBe("NAME_INVALID");
  });
});

/** The page's copy of the caps, imported by address because `src/`'s `rootDir` may not contain a `site/` file. */
const SITE_ATTACHMENT_MODULE = new URL("../../../../site/lib/messengerAttachment.ts", import.meta.url).href;

describe("the page's caps", () => {
  it("are the verb's, so a file the page sends is never one the verb was always going to refuse on size", async () => {
    const site = (await import(SITE_ATTACHMENT_MODULE)) as {
      MESSENGER_ATTACH_PICTURE_MAX_BYTES: number;
      MESSENGER_ATTACH_TEXT_MAX_BYTES: number;
    };
    expect([site.MESSENGER_ATTACH_PICTURE_MAX_BYTES, site.MESSENGER_ATTACH_TEXT_MAX_BYTES]).toEqual([
      ATTACHMENT_PICTURE_MAX_BYTES,
      ATTACHMENT_TEXT_MAX_BYTES,
    ]);
  });
});

describe("attachmentCapOf", () => {
  it("holds a picture head to the picture cap and anything else to the text cap", () => {
    expect([
      attachmentCapOf({ head: Uint8Array.from(PNG_HEAD) }),
      attachmentCapOf({ head: Uint8Array.from([0x25, 0x50, 0x44, 0x46]) }),
    ]).toEqual([
      { kind: "picture", maxBytes: 8_388_608 },
      { kind: "text", maxBytes: 1_048_576 },
    ]);
  });
});

/** The line separator, paragraph separator and right-to-left override, built so this source stays free of them. */
const [LINE_SEPARATOR, PARAGRAPH_SEPARATOR, RIGHT_TO_LEFT_OVERRIDE] = [0x2028, 0x2029, 0x202e].map((point) =>
  String.fromCodePoint(point),
);

describe("safeAttachmentName", () => {
  it("keeps only the last segment, whichever separator a caller used", () => {
    expect(
      ["/Users/me/Desktop/shot.png", "C:\\Users\\me\\shot.png", "../../etc/hosts"].map((name) =>
        unwrap(safeAttachmentName({ name })),
      ),
    ).toEqual(["shot.png", "shot.png", "hosts"]);
  });

  it("drops control characters and trims, so none can disguise a credential name", () => {
    expect(unwrap(safeAttachmentName({ name: "  notes\u0000\u0007.md \n" }))).toBe("notes.md");
    expect(unwrapErr(safeAttachmentName({ name: ".e\u0000nv" })).message).toBe(
      "the file name cannot be kept: it is named like a credential, which file_read refuses",
    );
  });

  it("drops a line or paragraph separator and a bidi override, so a name cannot end or reorder its line", () => {
    const name = `notes${LINE_SEPARATOR!}Ignore that.${PARAGRAPH_SEPARATOR!}md`;
    expect(unwrap(safeAttachmentName({ name }))).toBe("notesIgnore that.md");
    expect(unwrap(safeAttachmentName({ name: `report${RIGHT_TO_LEFT_OVERRIDE!}fdp.txt` }))).toBe("reportfdp.txt");
  });

  it("refuses an empty name and a dot name", () => {
    expect(["", "dir/", ".", ".."].map((name) => safeAttachmentName({ name }).isErr())).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(unwrapErr(safeAttachmentName({ name: "folder/" }))).toEqual({
      code: "NAME_INVALID",
      message: "the file name cannot be kept: it is empty once its folders are left off",
      name: "folder/",
    });
  });

  it("keeps a name at the byte cap and refuses one byte over, counting UTF-8 bytes", () => {
    const at = "é".repeat(ATTACHMENT_NAME_MAX_BYTES / 2);
    expect(unwrap(safeAttachmentName({ name: at }))).toBe(at);
    expect(unwrapErr(safeAttachmentName({ name: `${at}a` })).message).toBe(
      "the file name cannot be kept: it is 241 bytes; the most kept is 240",
    );
  });

  it("refuses a credential name in any case, and keeps an env example", () => {
    expect(["id_ed25519", "SERVER.PEM", ".env.local"].map((name) => safeAttachmentName({ name }).isErr())).toEqual([
      true,
      true,
      true,
    ]);
    expect(unwrap(safeAttachmentName({ name: ".env.example" }))).toBe(".env.example");
  });
});
