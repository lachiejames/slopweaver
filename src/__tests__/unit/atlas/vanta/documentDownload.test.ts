/**
 * The presigned-document download over a plain request function: the URL goes out verbatim with redirects
 * refused, the body comes back as exact bytes, a non-2xx status and a body past the 64 MiB cap are refused
 * with their literal lines, and a request that throws becomes the unfetchable line rather than a throw.
 */
import { describe, expect, it } from "vitest";

import {
  downloadPresignedDocumentVia,
  type PresignedDocumentRequest,
} from "../../../../atlas/vanta/documentDownload.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const URL_SIGNED = "https://storage.example.test/policy.pdf?X-Amz-Signature=abc&X-Amz-Expires=3600";

const CAP = 64 * 1024 * 1024;

/** A request answering a fixed status and body, recording every call's arguments. */
function answering({ ok, status, body }: { ok: boolean; status: number; body: ArrayBuffer }): {
  calls: { url: string; redirect: "error" }[];
  request: PresignedDocumentRequest;
} {
  const calls: { url: string; redirect: "error" }[] = [];
  return {
    calls,
    request: async (args) => {
      calls.push(args);
      return { arrayBuffer: async () => body, ok, status };
    },
  };
}

describe("downloadPresignedDocumentVia", () => {
  it("requests the URL verbatim with redirects refused and returns the body's exact bytes", async () => {
    const { calls, request } = answering({
      body: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
      ok: true,
      status: 200,
    });

    const result = await downloadPresignedDocumentVia({ request, url: URL_SIGNED });

    expect(result.isOk()).toBe(true);
    expect([...unwrap(result)]).toEqual([0x25, 0x50, 0x44, 0x46]);
    expect(calls).toEqual([{ redirect: "error", url: URL_SIGNED }]);
  });

  it("refuses a non-2xx answer with the literal HTTP status line", async () => {
    const { request } = answering({ body: new ArrayBuffer(0), ok: false, status: 403 });

    const result = await downloadPresignedDocumentVia({ request, url: URL_SIGNED });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(["the presigned document URL answered HTTP 403"]);
  });

  it("accepts a body of exactly the 64 MiB cap", async () => {
    const { request } = answering({ body: new ArrayBuffer(CAP), ok: true, status: 200 });

    const result = await downloadPresignedDocumentVia({ request, url: URL_SIGNED });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result).byteLength).toBe(67_108_864);
  });

  it("refuses a body one byte past the cap with the literal size line", async () => {
    const { request } = answering({ body: new ArrayBuffer(CAP + 1), ok: true, status: 200 });

    const result = await downloadPresignedDocumentVia({ request, url: URL_SIGNED });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual([
      "the presigned document is 67108865 bytes, past the 67108864-byte cap this reader will hold in memory",
    ]);
  });

  it("turns a request that throws into the literal unfetchable line", async () => {
    const request: PresignedDocumentRequest = async () => {
      throw new Error("redirect mode is set to error");
    };

    const result = await downloadPresignedDocumentVia({ request, url: URL_SIGNED });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(["could not fetch the presigned document: redirect mode is set to error"]);
  });

  it("turns a body read that throws into the literal unfetchable line", async () => {
    const request: PresignedDocumentRequest = async () => ({
      arrayBuffer: async () => {
        throw new Error("body stream already read");
      },
      ok: true,
      status: 200,
    });

    const result = await downloadPresignedDocumentVia({ request, url: URL_SIGNED });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(["could not fetch the presigned document: body stream already read"]);
  });
});
