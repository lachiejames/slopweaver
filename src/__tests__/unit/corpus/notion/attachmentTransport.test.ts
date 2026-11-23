/**
 * The attachment transport over a plain request fake answering real `Response` objects — no socket, no
 * global fetch replacement. A ranged call sends `Range: bytes=0-(n-1)` and leaves the body unread; a full
 * call reads it; a non-2xx is returned rather than thrown; a rejecting request stays a rejection.
 */
import { describe, expect, it } from "vitest";

import { makeAttachmentTransport } from "../../../../corpus/notion/attachmentTransport.js";

const URL_SIGNED = "https://files.example.com/secure/a.pdf?X-Amz-Signature=abc";

/** One request the fake received. */
interface RequestCall {
  readonly url: string;
  readonly init: { headers: Record<string, string>; method: "GET" };
}

describe("makeAttachmentTransport", () => {
  it("sends a ranged GET for a size probe and answers headers and status without a body", async () => {
    const calls: RequestCall[] = [];
    const response = new Response("PDF-BYTES", {
      headers: { "content-range": "bytes 0-1023/52000", "content-type": "application/pdf" },
      status: 206,
    });
    const transport = makeAttachmentTransport({
      request: (call) => {
        calls.push(call);
        return Promise.resolve(response);
      },
    });

    const probed = await transport({ rangeBytes: 1024, url: URL_SIGNED });

    expect(calls).toEqual([{ init: { headers: { Range: "bytes=0-1023" }, method: "GET" }, url: URL_SIGNED }]);
    expect(probed).toStrictEqual({
      contentRange: "bytes 0-1023/52000",
      contentType: "application/pdf",
      ok: true,
      status: 206,
    });
    expect(response.bodyUsed).toBe(false);
  });

  it("sends an unranged GET for a download and answers the exact bytes", async () => {
    const calls: RequestCall[] = [];
    const transport = makeAttachmentTransport({
      request: (call) => {
        calls.push(call);
        return Promise.resolve(
          new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
            headers: { "content-type": "application/pdf" },
            status: 200,
          }),
        );
      },
    });

    const downloaded = await transport({ rangeBytes: undefined, url: URL_SIGNED });

    expect(calls).toEqual([{ init: { headers: {}, method: "GET" }, url: URL_SIGNED }]);
    expect(downloaded).toStrictEqual({
      body: Buffer.from([0x25, 0x50, 0x44, 0x46]),
      contentRange: null,
      contentType: "application/pdf",
      ok: true,
      status: 200,
    });
  });

  it("returns a non-2xx response with ok false and its status, rather than throwing", async () => {
    const transport = makeAttachmentTransport({
      request: () => Promise.resolve(new Response(null, { status: 403 })),
    });

    await expect(transport({ rangeBytes: 1024, url: URL_SIGNED })).resolves.toStrictEqual({
      contentRange: null,
      contentType: null,
      ok: false,
      status: 403,
    });
  });

  it("lets a rejecting request stay a rejection, with no retry or conversion of its own", async () => {
    const broken = new TypeError("fetch failed");
    const transport = makeAttachmentTransport({ request: () => Promise.reject(broken) });

    await expect(transport({ rangeBytes: undefined, url: URL_SIGNED })).rejects.toBe(broken);
  });
});
