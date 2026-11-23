/**
 * Saving one Outlook file attachment: selection by name or id, the kind and size refusals before any byte is
 * fetched, the built on-disk path, and the injected write seam. The filesystem is a mkdtemp root removed after
 * each test; the write itself goes through a plain recording function.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  fetchOutlookAttachment,
  outlookAttachmentPath,
  selectOutlookAttachment,
  withOutlookAttachments,
} from "../../../../live/outlook/attachments.js";
import type { GraphAttachment } from "../../../../live/outlook/graphWire.js";
import { toMessage } from "../../../../live/outlook/messages.js";
import { fakeMailbox, fakeOutlookApi, wireMessage } from "../../../fakeOutlookMailbox.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A fresh temp root, removed after the test. */
function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "olatt-"));
  roots.push(root);
  return root;
}

/** A file attachment as Graph lists it. */
function file({ id, name, size = 5 }: { id: string; name: string | null; size?: number }): GraphAttachment {
  return { "@odata.type": "#microsoft.graph.fileAttachment", contentType: "text/plain", id, name, size };
}

/** A recorder standing in for the owner-only atomic write. */
function recorder(): {
  writes: { path: string; bytes: Buffer }[];
  write: (args: { path: string; bytes: Buffer }) => void;
} {
  const writes: { path: string; bytes: Buffer }[] = [];
  return { write: (args) => void writes.push(args), writes };
}

describe("selectOutlookAttachment", () => {
  const attachments = [
    file({ id: "a1", name: "notes.txt" }),
    file({ id: "a2", name: "twin.txt" }),
    file({ id: "a3", name: "twin.txt" }),
  ];

  it("picks the one attachment with an exact name", () => {
    expect(unwrap(selectOutlookAttachment({ attachments, selector: { name: "notes.txt" } })).id).toBe("a1");
  });

  it("picks by attachment id", () => {
    expect(unwrap(selectOutlookAttachment({ attachments, selector: { attachmentId: "a3" } })).id).toBe("a3");
  });

  it("refuses an ambiguous name, listing only the matches", () => {
    const refused = selectOutlookAttachment({ attachments, selector: { name: "twin.txt" } });

    expect(unwrapErr(refused).code).toBe("ATTACHMENT_UNRESOLVED");
    expect(unwrapErr(refused).message).toContain("2 attachments match --name twin.txt");
    expect(unwrapErr(refused).message).toContain("id=a2");
    expect(unwrapErr(refused).message).not.toContain("id=a1");
  });

  it("refuses an unmatched name, listing what the message carries", () => {
    const refused = selectOutlookAttachment({ attachments, selector: { name: "missing.txt" } });

    expect(unwrapErr(refused).code).toBe("ATTACHMENT_UNRESOLVED");
    expect(unwrapErr(refused).message).toContain("notes.txt [fileAttachment] id=a1");
  });

  it("refuses when the message carries no attachments at all", () => {
    const refused = selectOutlookAttachment({ attachments: [], selector: { attachmentId: "x" } });

    expect(unwrapErr(refused).message).toContain("this message carries no attachments");
  });
});

describe("outlookAttachmentPath", () => {
  it("builds a file directly inside a hashed message directory under the root", () => {
    const root = freshRoot();

    const located = unwrap(
      outlookAttachmentPath({ index: 2, messageId: "AAMk/long+id=", name: "../../etc/passwd", root }),
    );

    expect(dirname(located.directory)).toBe(root);
    expect(basename(located.directory)).toMatch(/^[0-9a-f]{32}$/);
    expect(dirname(located.path)).toBe(located.directory);
    expect(basename(located.path)).toBe("2-.._.._etc_passwd");
  });

  it("is stable for one message id and different for another", () => {
    const root = freshRoot();
    const first = unwrap(outlookAttachmentPath({ index: 1, messageId: "m1", name: "a.txt", root }));
    const again = unwrap(outlookAttachmentPath({ index: 1, messageId: "m1", name: "a.txt", root }));
    const other = unwrap(outlookAttachmentPath({ index: 1, messageId: "m2", name: "a.txt", root }));

    expect(again.directory).toBe(first.directory);
    expect(other.directory).not.toBe(first.directory);
  });
});

describe("fetchOutlookAttachment", () => {
  it("fetches the bytes and writes them through the seam to the built path", async () => {
    const root = freshRoot();
    const mailbox = fakeMailbox();
    mailbox.attachments.set("m1", [file({ id: "a1", name: "notes.txt", size: 5 })]);
    mailbox.bytes.set("a1", new TextEncoder().encode("hello"));
    const sink = recorder();

    const saved = unwrap(
      await fetchOutlookAttachment({
        api: fakeOutlookApi({ mailbox }),
        maxBytes: 1024,
        messageId: "m1",
        root,
        selector: { name: "notes.txt" },
        writeBytes: sink.write,
      }),
    );

    expect(saved.name).toBe("notes.txt");
    expect(saved.contentType).toBe("text/plain");
    expect(saved.sizeBytes).toBe(5);
    expect(basename(saved.path)).toBe("1-notes.txt");
    expect(sink.writes).toHaveLength(1);
    expect(sink.writes[0]!.path).toBe(saved.path);
    expect(sink.writes[0]!.bytes.toString("utf8")).toBe("hello");
  });

  it("refuses an attached Outlook item by kind, fetching nothing", async () => {
    const mailbox = fakeMailbox();
    mailbox.attachments.set("m1", [
      { "@odata.type": "#microsoft.graph.itemAttachment", contentType: null, id: "a1", name: "forwarded message" },
    ]);
    const sink = recorder();

    const refused = await fetchOutlookAttachment({
      api: fakeOutlookApi({ mailbox }),
      maxBytes: 1024,
      messageId: "m1",
      root: freshRoot(),
      selector: { attachmentId: "a1" },
      writeBytes: sink.write,
    });

    expect(unwrapErr(refused).code).toBe("ATTACHMENT_KIND_UNSUPPORTED");
    expect(unwrapErr(refused).message).toContain("itemAttachment");
    expect(sink.writes).toEqual([]);
  });

  it("refuses an attachment Graph reports over the ceiling before fetching it", async () => {
    const mailbox = fakeMailbox();
    mailbox.attachments.set("m1", [file({ id: "a1", name: "big.bin", size: 2048 })]);
    const sink = recorder();

    const refused = await fetchOutlookAttachment({
      api: fakeOutlookApi({ mailbox }),
      maxBytes: 1024,
      messageId: "m1",
      root: freshRoot(),
      selector: { name: "big.bin" },
      writeBytes: sink.write,
    });

    expect(unwrapErr(refused).code).toBe("ATTACHMENT_TOO_LARGE");
    expect(unwrapErr(refused).message).toContain("2048 bytes");
    expect(sink.writes).toEqual([]);
  });

  it("refuses bytes longer than the ceiling even when Graph reported a small size", async () => {
    const mailbox = fakeMailbox();
    mailbox.attachments.set("m1", [file({ id: "a1", name: "liar.bin", size: 3 })]);
    mailbox.bytes.set("a1", new Uint8Array(2000));
    const sink = recorder();

    const refused = await fetchOutlookAttachment({
      api: fakeOutlookApi({ mailbox }),
      maxBytes: 1024,
      messageId: "m1",
      root: freshRoot(),
      selector: { name: "liar.bin" },
      writeBytes: sink.write,
    });

    expect(unwrapErr(refused).code).toBe("ATTACHMENT_TOO_LARGE");
    expect(unwrapErr(refused).message).toContain("2000 bytes");
    expect(sink.writes).toEqual([]);
  });

  it("passes a failed byte fetch through and writes nothing", async () => {
    const mailbox = fakeMailbox();
    mailbox.attachments.set("m1", [file({ id: "a1", name: "gone.txt" })]);
    const sink = recorder();

    const refused = await fetchOutlookAttachment({
      api: fakeOutlookApi({ mailbox }),
      maxBytes: 1024,
      messageId: "m1",
      root: freshRoot(),
      selector: { name: "gone.txt" },
      writeBytes: sink.write,
    });

    expect(unwrapErr(refused).code).toBe("API_FAILED");
    expect(sink.writes).toEqual([]);
  });

  it("turns a throwing write into a destination refusal", async () => {
    const mailbox = fakeMailbox();
    mailbox.attachments.set("m1", [file({ id: "a1", name: "notes.txt" })]);
    mailbox.bytes.set("a1", new TextEncoder().encode("hello"));

    const refused = await fetchOutlookAttachment({
      api: fakeOutlookApi({ mailbox }),
      maxBytes: 1024,
      messageId: "m1",
      root: freshRoot(),
      selector: { name: "notes.txt" },
      writeBytes: () => {
        throw new Error("disk full");
      },
    });

    expect(unwrapErr(refused).code).toBe("DESTINATION_UNUSABLE");
    expect(unwrapErr(refused).message).toContain("disk full");
  });

  it("refuses an unmatched selector before touching the byte endpoint", async () => {
    const mailbox = fakeMailbox();
    const sink = recorder();

    const refused = await fetchOutlookAttachment({
      api: fakeOutlookApi({ mailbox }),
      maxBytes: 1024,
      messageId: "m1",
      root: freshRoot(),
      selector: { name: "nothing.txt" },
      writeBytes: sink.write,
    });

    expect(unwrapErr(refused).code).toBe("ATTACHMENT_UNRESOLVED");
    expect(sink.writes).toEqual([]);
  });
});

describe("withOutlookAttachments", () => {
  /** A message as the read verb holds it. */
  const message = ({ id, hasAttachments }: { id: string; hasAttachments: boolean }) =>
    unwrap(toMessage({ message: wireMessage({ id, over: { hasAttachments } }), operation: "test.op" }));

  it("lists each flagged message's attachments by name, kind and id, and asks nothing of an unflagged one", async () => {
    const mailbox = fakeMailbox();
    mailbox.attachments.set("m1", [
      file({ id: "a1", name: "notes.txt", size: 5 }),
      { "@odata.type": "#microsoft.graph.itemAttachment", contentType: null, id: "a2", name: "Fwd: plan" },
    ]);
    // Graph flags m2 as carrying none, so whatever the list would say is never asked for.
    mailbox.attachments.set("m2", [file({ id: "b1", name: "unasked.txt" })]);

    const read = unwrap(
      await withOutlookAttachments({
        api: fakeOutlookApi({ mailbox }),
        messages: [message({ hasAttachments: true, id: "m1" }), message({ hasAttachments: false, id: "m2" })],
      }),
    );

    expect(read.map((one) => one.message.id)).toEqual(["m1", "m2"]);
    expect(read[0]!.attachments).toEqual([
      { attachmentId: "a1", contentType: "text/plain", kind: "fileAttachment", name: "notes.txt", sizeBytes: 5 },
      { attachmentId: "a2", contentType: null, kind: "itemAttachment", name: "Fwd: plan", sizeBytes: null },
    ]);
    expect(read[1]!.attachments).toEqual([]);
  });

  it("answers an empty read for no messages", async () => {
    const read = unwrap(
      await withOutlookAttachments({ api: fakeOutlookApi({ mailbox: fakeMailbox() }), messages: [] }),
    );

    expect(read).toEqual([]);
  });
});
