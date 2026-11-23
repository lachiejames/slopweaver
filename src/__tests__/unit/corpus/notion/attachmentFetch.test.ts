/**
 * The transport is an INJECTED plain function, never a mock, and the store is a real temp directory so the
 * round trip is exercised rather than described.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type AttachmentTransport,
  fetchAttachment,
  measureAttachment,
} from "../../../../corpus/notion/attachmentFetch.js";
import { attachmentDigest, attachmentPath, storeAttachment } from "../../../../corpus/notion/attachmentStore.js";

const homes: string[] = [];
const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-attach-"));
  homes.push(home);
  return home;
};
afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A transport that answers from a fixed body, and records how it was called. */
const transportOver = ({
  body,
  calls,
  status = 200,
  contentRange,
}: {
  body: Buffer;
  calls: (number | undefined)[];
  status?: number;
  contentRange?: string | null;
}): AttachmentTransport => {
  return ({ rangeBytes }) => {
    calls.push(rangeBytes);
    const range = contentRange === undefined ? `bytes 0-1023/${String(body.byteLength)}` : contentRange;
    if (rangeBytes !== undefined) {
      return Promise.resolve({ contentRange: range, contentType: "application/pdf", ok: status < 400, status });
    }
    return Promise.resolve({
      body,
      contentRange: null,
      contentType: "application/pdf",
      ok: status < 400,
      status,
    });
  };
};

describe("measureAttachment", () => {
  it("probes with a range and lets a file under the ceiling through", async () => {
    const calls: (number | undefined)[] = [];
    const outcome = await measureAttachment({
      ceilingBytes: 1_000_000,
      scopeId: "t",
      transport: transportOver({ body: Buffer.alloc(500), calls }),
      url: "https://files.notion.so/a.pdf",
    });
    expect(outcome).toBeUndefined();
    expect(calls).toEqual([1024]);
  });

  it("refuses a file over the ceiling without ever reading it", async () => {
    const calls: (number | undefined)[] = [];
    const outcome = await measureAttachment({
      ceilingBytes: 100,
      scopeId: "t",
      transport: transportOver({ body: Buffer.alloc(5000), calls }),
      url: "https://files.notion.so/big.pdf",
    });
    expect(outcome).toEqual({ bytes: 5000, kind: "too-large" });
    // The probe, and nothing else. A full read would show as an `undefined` entry.
    expect(calls).toEqual([1024]);
  });

  it("reports a failure when the probe is refused", async () => {
    const outcome = await measureAttachment({
      ceilingBytes: 100,
      scopeId: "t",
      transport: transportOver({ body: Buffer.alloc(10), calls: [], status: 403 }),
      url: "https://files.notion.so/forbidden.pdf",
    });
    expect(outcome).toEqual({ kind: "failed", reason: "ranged probe returned 403" });
  });

  it("does not fetch when the probe reports no total", async () => {
    const outcome = await measureAttachment({
      ceilingBytes: 1_000_000,
      scopeId: "t",
      transport: transportOver({ body: Buffer.alloc(10), calls: [], contentRange: null }),
      url: "https://files.notion.so/unknown.pdf",
    });
    expect(outcome).toEqual({ kind: "size-unknown" });
  });
});

describe("fetchAttachment", () => {
  it("probes, then downloads, and stores the bytes under their digest", async () => {
    const home = freshHome();
    const body = Buffer.from("a policy document");
    const calls: (number | undefined)[] = [];
    const outcome = await fetchAttachment({
      ceilingBytes: 1_000_000,
      scopeId: "t",
      store: ({ bytes }) => storeAttachment({ bytes, home }),
      transport: transportOver({ body, calls }),
      url: "https://files.notion.so/a.pdf",
    });
    const digest = attachmentDigest({ bytes: body });
    expect(outcome).toEqual({
      bytes: body.byteLength,
      contentType: "application/pdf",
      digest,
      kind: "fetched",
    });
    expect(calls).toEqual([1024, undefined]);
    expect(readFileSync(attachmentPath({ digest, home })).toString()).toBe("a policy document");
  });

  it("never reaches the download when the ceiling refuses it", async () => {
    const home = freshHome();
    const calls: (number | undefined)[] = [];
    const outcome = await fetchAttachment({
      ceilingBytes: 10,
      scopeId: "t",
      store: ({ bytes }) => storeAttachment({ bytes, home }),
      transport: transportOver({ body: Buffer.alloc(9999), calls }),
      url: "https://files.notion.so/big.pdf",
    });
    expect(outcome).toEqual({ bytes: 9999, kind: "too-large" });
    expect(calls).toEqual([1024]);
  });

  it("refuses on the bytes that ACTUALLY arrived, not only on what the probe promised", async () => {
    // A server that under-reports its own Content-Range would otherwise walk straight past the bound.
    const home = freshHome();
    const outcome = await fetchAttachment({
      ceilingBytes: 100,
      scopeId: "t",
      store: ({ bytes }) => storeAttachment({ bytes, home }),
      transport: transportOver({ body: Buffer.alloc(5000), calls: [], contentRange: "bytes 0-1023/50" }),
      url: "https://files.notion.so/liar.pdf",
    });
    expect(outcome).toEqual({ bytes: 5000, kind: "too-large" });
  });
});

describe("storeAttachment", () => {
  it("is idempotent, so a re-pull writes nothing the second time", () => {
    const home = freshHome();
    const bytes = Buffer.from("the same file");
    const first = storeAttachment({ bytes, home });
    const second = storeAttachment({ bytes, home });
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.digest).toBe(first.digest);
    expect(second.path).toBe(first.path);
  });

  it("shards on the digest's first two characters", () => {
    const home = freshHome();
    const stored = storeAttachment({ bytes: Buffer.from("x"), home });
    expect(stored.path).toBe(join(home, "corpus", "attachments", "notion", stored.digest.slice(0, 2), stored.digest));
  });

  it("gives two different files two different digests", () => {
    const home = freshHome();
    expect(storeAttachment({ bytes: Buffer.from("one"), home }).digest).not.toBe(
      storeAttachment({ bytes: Buffer.from("two"), home }).digest,
    );
  });
});
