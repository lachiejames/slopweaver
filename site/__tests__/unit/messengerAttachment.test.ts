/*
 * A file the owner attaches in the Messenger, on the page's side: the route takes only canonical base64 under the
 * picture cap, the verb's receipt and refusal are read off its stdout, and the owner's message carries one quoted line naming the
 * kept file — refused whole, never cut, when it would not fit in one message. A paste or drop into the box takes the
 * paperclip's way, a text-carrying paste staying text.
 */
import { describe, expect, it } from "vitest";

import { attachSendOf, base64Of } from "../../components/voice/attachClient";
import {
  attachmentsAfterKeep,
  attachmentsAfterSend,
  attachmentsSending,
  MESSENGER_ATTACH_MAX_FILES,
  MESSENGER_ATTACH_PICTURE_MAX_BYTES,
  messengerAttachmentLine,
  messengerAttachPrecheck,
  messengerAttachReceiptOf,
  messengerAttachRefusalOf,
  messengerAttachRoom,
  messengerMessageOf,
  messengerTransferDecision,
  type PendingMessengerAttachment,
  parseMessengerAttachRequest,
} from "../../lib/messengerAttachment";
import { TYPED_TEXT_MAX_CHARS } from "../../lib/planCallContract";

const RECEIPT = {
  bytes: 4096,
  kind: "text",
  name: "notes.md",
  path: "/Users/acme/.slopweaver/talk/attachments/u1/notes.md",
} as const;

describe("parseMessengerAttachRequest", () => {
  it("decodes a name and canonical base64 to the exact bytes", () => {
    const parsed = parseMessengerAttachRequest({ body: { base64: "aGVsbG8K", name: "notes.md" } });
    expect(parsed.kind).toBe("ok");
    expect(parsed).toMatchObject({ kind: "ok", name: "notes.md" });
    expect(Array.from((parsed as { bytes: Buffer }).bytes)).toEqual([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x0a]);
  });

  it("refuses a missing name, unpadded or non-canonical base64, and a body over the picture cap", () => {
    const over = Buffer.alloc(MESSENGER_ATTACH_PICTURE_MAX_BYTES + 1).toString("base64");
    expect([
      parseMessengerAttachRequest({ body: { base64: "aGVsbG8K" } }),
      parseMessengerAttachRequest({ body: { base64: "aGVsbG8", name: "a" } }),
      parseMessengerAttachRequest({ body: { base64: "aGVsbG9=", name: "a" } }),
      parseMessengerAttachRequest({ body: { base64: "aGVs bG8K", name: "a" } }),
      parseMessengerAttachRequest({ body: { base64: over, name: "a" } }),
    ]).toEqual([
      { kind: "refused", status: 400, why: "name must be the file's name, up to 1024 characters" },
      { kind: "refused", status: 400, why: "base64 must be the file's bytes in standard, padded base64" },
      { kind: "refused", status: 400, why: "base64 is not canonical, so the bytes it decodes to are not certain" },
      { kind: "refused", status: 400, why: "base64 must be the file's bytes in standard, padded base64" },
      {
        kind: "refused",
        status: 413,
        why: "the file is 8.0 MB; the most attached is 8.0 MB for a picture, 1.0 MB for a text file",
      },
    ]);
  });
});

describe("messengerAttachPrecheck", () => {
  it("refuses an empty file and one over the picture cap before it is read, and leaves the rest to the verb", () => {
    expect([
      messengerAttachPrecheck({ bytes: 0 }),
      messengerAttachPrecheck({ bytes: MESSENGER_ATTACH_PICTURE_MAX_BYTES }),
      messengerAttachPrecheck({ bytes: 20 * 1024 * 1024 }),
    ]).toEqual([
      "the file is empty",
      undefined,
      "the file is 20 MB; the most attached is 8.0 MB for a picture, 1.0 MB for a text file",
    ]);
  });
});

describe("the verb's answers", () => {
  it("reads a receipt, and refuses a stdout that is not one", () => {
    expect([
      messengerAttachReceiptOf({ out: `${JSON.stringify(RECEIPT)}\n` }),
      messengerAttachReceiptOf({ out: JSON.stringify({ ...RECEIPT, kind: "pdf" }) }),
      messengerAttachReceiptOf({ out: "kept text notes.md" }),
    ]).toEqual([RECEIPT, undefined, undefined]);
  });

  it("reads a refusal's sentence", () => {
    const out = JSON.stringify({ refused: { code: "BINARY", message: "the file is not a picture or text" } });
    expect([messengerAttachRefusalOf({ out }), messengerAttachRefusalOf({ out: "{}" })]).toEqual([
      "the file is not a picture or text",
      undefined,
    ]);
  });
});

describe("messengerMessageOf", () => {
  const line =
    '[Attached: "notes.md", a text file of 4.0 KB, saved at "/Users/acme/.slopweaver/talk/attachments/u1/notes.md". Read it with file_read.]';

  it("names the kept file in one quoted line, under what the owner typed or alone", () => {
    expect([
      messengerMessageOf({ draft: "what does this say?", receipts: [RECEIPT] }),
      messengerMessageOf({ draft: "  ", receipts: [RECEIPT] }),
      messengerMessageOf({ draft: "no file", receipts: [] }),
    ]).toEqual([
      { kind: "ok", text: `what does this say?\n\n${line}` },
      { kind: "ok", text: line },
      { kind: "ok", text: "no file" },
    ]);
  });

  it("names several kept files one line each, in the owner's order", () => {
    const shot = { ...RECEIPT, bytes: 2048, kind: "picture", name: "a.png", path: "/k/a.png" } as const;
    const shotLine = '[Attached: "a.png", a picture of 2.0 KB, saved at "/k/a.png". Read it with file_read.]';
    expect(messengerMessageOf({ draft: "compare", receipts: [shot, RECEIPT] })).toEqual({
      kind: "ok",
      text: `compare\n\n${shotLine}\n${line}`,
    });
  });

  it("quotes a name that would otherwise end the line", () => {
    const receipt = { ...RECEIPT, bytes: 2_000_000, kind: "picture", name: 'shot "1"].png' } as const;
    expect(messengerAttachmentLine({ receipt })).toBe(
      '[Attached: "shot \\"1\\"].png", a picture of 1.9 MB, saved at "/Users/acme/.slopweaver/talk/attachments/u1/notes.md". Read it with file_read.]',
    );
  });

  it("refuses a message that would not fit whole with its line, rather than cutting it", () => {
    const draft = "a".repeat(TYPED_TEXT_MAX_CHARS - 10);
    const message = messengerMessageOf({ draft, receipts: [RECEIPT] });
    expect(message.kind).toBe("refused");
    expect((message as { why: string }).why).toContain("one message carries 16000");
  });
});

describe("attachmentsAfterKeep", () => {
  const keeping = (token: string): PendingMessengerAttachment => ({
    bytes: 4096,
    kind: "keeping",
    name: `${token}.md`,
    previewUrl: undefined,
    token,
  });

  it("keeps only the answered file, leaving the others as they were", () => {
    const now = [keeping("t1"), keeping("t2")];
    expect(attachmentsAfterKeep({ now, receipt: RECEIPT, token: "t2" })).toEqual([
      keeping("t1"),
      { ...keeping("t2"), kind: "kept", receipt: RECEIPT },
    ]);
  });

  it("takes a refused file off, and never brings back one the owner removed while it was being kept", () => {
    const now = [keeping("t1"), keeping("t2")];
    expect([
      attachmentsAfterKeep({ now, receipt: undefined, token: "t1" }),
      attachmentsAfterKeep({ now: [keeping("t2")], receipt: RECEIPT, token: "t1" }),
    ]).toEqual([[keeping("t2")], [keeping("t2")]]);
  });
});

describe("messengerAttachRoom", () => {
  it("takes every file under the cap, and names how many were left out past it", () => {
    expect([
      messengerAttachRoom({ offered: 3, waiting: 0 }),
      messengerAttachRoom({ offered: 3, waiting: MESSENGER_ATTACH_MAX_FILES - 2 }),
      messengerAttachRoom({ offered: 1, waiting: MESSENGER_ATTACH_MAX_FILES }),
    ]).toEqual([
      { take: 3, why: undefined },
      { take: 2, why: "1 file was left out; at most 10 wait at once" },
      { take: 0, why: "1 file was left out; at most 10 wait at once" },
    ]);
  });

  it("counts several left out in the plural", () => {
    expect(messengerAttachRoom({ offered: 12, waiting: 0 })).toEqual({
      take: 10,
      why: "2 files were left out; at most 10 wait at once",
    });
  });
});

describe("attachmentsSending and attachmentsAfterSend", () => {
  const file = (token: string): PendingMessengerAttachment => ({
    bytes: 1,
    kind: "kept",
    name: token,
    previewUrl: undefined,
    receipt: RECEIPT,
    token,
  });
  const out = (token: string): PendingMessengerAttachment => ({ ...file(token), kind: "sending", receipt: RECEIPT });
  const keeping = (token: string): PendingMessengerAttachment => ({
    bytes: 1,
    kind: "keeping",
    name: token,
    previewUrl: undefined,
    token,
  });

  it("marks only the kept files a send carries as out with it", () => {
    expect(attachmentsSending({ now: [file("a"), file("b"), keeping("c")], sent: [file("a"), keeping("c")] })).toEqual([
      out("a"),
      file("b"),
      keeping("c"),
    ]);
  });

  it("takes off only the files that went, keeping any the owner added while the send was out", () => {
    expect([
      attachmentsAfterSend({ now: [out("a"), out("b")], sent: [file("a"), file("b")], went: true }),
      attachmentsAfterSend({ now: [out("a"), file("c")], sent: [file("a"), file("b")], went: true }),
    ]).toEqual([[], [file("c")]]);
  });

  it("makes a refused send's files ready again, never bringing back one the owner removed while it was out", () => {
    expect([
      attachmentsAfterSend({ now: [out("a"), out("b"), file("c")], sent: [file("a"), file("b")], went: false }),
      attachmentsAfterSend({ now: [out("b")], sent: [file("a"), file("b")], went: false }),
    ]).toEqual([[file("a"), file("b"), file("c")], [file("b")]]);
  });

  it("leaves nothing a second composer can send while the first send is out", () => {
    const whileOut = attachmentsSending({ now: [file("a")], sent: [file("a")] });
    expect(whileOut.filter((one) => one.kind === "kept")).toEqual([]);
  });
});

describe("attachSendOf", () => {
  it("keeps only the route's own 2xx with a receipt", () => {
    expect([
      attachSendOf({ body: { outcome: "kept", receipt: RECEIPT }, status: 200 }),
      attachSendOf({ body: { outcome: "kept", receipt: RECEIPT }, status: 502 }),
      attachSendOf({ body: { outcome: "refused", why: "the file is empty" }, status: 422 }),
      attachSendOf({ body: undefined, status: 500 }),
    ]).toEqual([
      { kind: "kept", receipt: RECEIPT },
      { kind: "refused", why: "the attach route answered HTTP 502" },
      { kind: "refused", why: "the file is empty" },
      { kind: "refused", why: "the attach route answered HTTP 500" },
    ]);
  });

  it("encodes bytes past one chunk as the base64 the route decodes", () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, at) => at % 256);
    expect(base64Of({ bytes })).toBe(Buffer.from(bytes).toString("base64"));
  });
});

describe("messengerTransferDecision", () => {
  const NOW = "2026-10-18T04:53:12.345Z";
  const shot = { name: "image.png", type: "image/png" } as const;

  it("leaves a transfer with no file, and a paste that also carries text, to the default", () => {
    expect([
      messengerTransferDecision({ files: [], hasPlainText: true, nowIso: NOW, source: "paste" }),
      messengerTransferDecision({ files: [], hasPlainText: false, nowIso: NOW, source: "drop" }),
      messengerTransferDecision({ files: [shot], hasPlainText: true, nowIso: NOW, source: "paste" }),
    ]).toEqual([{ kind: "default" }, { kind: "default" }, { kind: "default" }]);
  });

  it("names a clipboard picture under the browser's generic name for the instant it was pasted", () => {
    const pasted = ({ name, type }: { name: string; type: string }): unknown =>
      messengerTransferDecision({ files: [{ name, type }], hasPlainText: false, nowIso: NOW, source: "paste" });
    expect([
      pasted(shot),
      pasted({ name: "IMAGE.JPG", type: "image/jpeg" }),
      pasted({ name: "image", type: "image/webp" }),
      pasted({ name: " ", type: "" }),
    ]).toEqual([
      { kind: "attach", picks: [{ fileIndex: 0, name: "pasted-2026-10-18T04-53-12-345Z.png" }] },
      { kind: "attach", picks: [{ fileIndex: 0, name: "pasted-2026-10-18T04-53-12-345Z.jpg" }] },
      { kind: "attach", picks: [{ fileIndex: 0, name: "pasted-2026-10-18T04-53-12-345Z.webp" }] },
      { kind: "attach", picks: [{ fileIndex: 0, name: "pasted-2026-10-18T04-53-12-345Z" }] },
    ]);
  });

  it("keeps a pasted file's own name, and every dropped file's, the generic one included", () => {
    const named = { name: "Screenshot 2026-10-18 at 4.53.12 pm.png", type: "image/png" };
    expect([
      messengerTransferDecision({ files: [named], hasPlainText: false, nowIso: NOW, source: "paste" }),
      messengerTransferDecision({ files: [shot], hasPlainText: true, nowIso: NOW, source: "drop" }),
    ]).toEqual([
      { kind: "attach", picks: [{ fileIndex: 0, name: named.name }] },
      { kind: "attach", picks: [{ fileIndex: 0, name: "image.png" }] },
    ]);
  });

  it("attaches every dropped file, in the order they came", () => {
    const notes = { name: "notes.md", type: "text/markdown" };
    const decision = messengerTransferDecision({
      files: [notes, shot, shot],
      hasPlainText: false,
      nowIso: NOW,
      source: "drop",
    });
    expect(decision).toEqual({
      kind: "attach",
      picks: [
        { fileIndex: 0, name: "notes.md" },
        { fileIndex: 1, name: "image.png" },
        { fileIndex: 2, name: "image.png" },
      ],
    });
  });

  it("names several pasted pictures apart by their place in the paste, a named one kept as it is", () => {
    const named = { name: "diagram.png", type: "image/png" };
    const decision = messengerTransferDecision({
      files: [shot, named, shot],
      hasPlainText: false,
      nowIso: NOW,
      source: "paste",
    });
    expect(decision).toEqual({
      kind: "attach",
      picks: [
        { fileIndex: 0, name: "pasted-2026-10-18T04-53-12-345Z.png" },
        { fileIndex: 1, name: "diagram.png" },
        { fileIndex: 2, name: "pasted-2026-10-18T04-53-12-345Z-3.png" },
      ],
    });
  });
});
