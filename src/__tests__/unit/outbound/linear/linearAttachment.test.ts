/**
 * The PURE half of `linear attach upload`: which files the door will send, what the reservation's headers
 * become, and the rule that keeps an unproven asset URL out of a caller's hands.
 *
 * The last of those is what this file is really for. Linear's `fileUpload` mints an `assetUrl` BEFORE the
 * bytes exist, so a PUT that fails leaves a perfectly well-formed URL that renders as a broken image. Every
 * case below that touches `putReservedAsset` is checking that a non-2xx cannot yield a `StoredAsset`.
 *
 * Every edge is a plain injected function. No mocks.
 */
import { describe, expect, it } from "vitest";

import type { ReservedUpload } from "../../../../corpus/linear/writeAssets.js";
import { unwrap } from "../../../../lib/result.js";
import { putHeadersFor, putReservedAsset } from "../../../../outbound/linear/assetUpload.js";
import {
  classifyLinearAttachment,
  embedsInline,
  LINEAR_ATTACHABLE_MEDIA,
  mediaBlockFor,
  typesTheWorkspaceForbids,
} from "../../../../outbound/linear/attachment.js";
import { NO_TERMS_LINEAR_PRIVACY } from "../../../linearWritePrivacyFixture.js";

const RESERVATION: ReservedUpload = {
  assetUrl: "https://uploads.linear.test/ws/asset/1",
  contentType: "image/png",
  headers: [
    { key: "Content-Type", value: "image/png" },
    { key: "x-amz-meta-id", value: "abc" },
  ],
  uploadUrl: "https://bucket.linear.test/put?sig=1",
};

const CLASSIFIED = { byteLength: 165, contentType: "image/png", fileName: "probe.png" };

describe("classifying a file", () => {
  it("maps a png to the content type Linear stores it as", () => {
    const classified = unwrap(classifyLinearAttachment({ byteLength: 165, fileName: "probe.png" }));

    expect(classified.contentType).toBe("image/png");
    expect(classified.fileName).toBe("probe.png");
    expect(classified.byteLength).toBe(165);
  });

  it("is case-insensitive about the extension, because a filesystem is not", () => {
    expect(unwrap(classifyLinearAttachment({ byteLength: 1, fileName: "SHOT.PNG" })).contentType).toBe("image/png");
  });

  it("refuses a file with no extension, and says the extension is what picks the type", () => {
    const refused = classifyLinearAttachment({ byteLength: 1, fileName: "screenshot" });

    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("UNSUPPORTED_MEDIA");
    expect(refused._unsafeUnwrapErr().message).toContain("no extension");
  });

  it("refuses an SVG BY NAME — Linear renders one as a download, not as a picture", () => {
    const refused = classifyLinearAttachment({ byteLength: 1, fileName: "diagram.svg" });

    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("UNSUPPORTED_MEDIA");
    expect(LINEAR_ATTACHABLE_MEDIA[".svg"]).toBe(undefined);
  });

  it("declares NO local size ceiling, because Linear's own reservation takes the size and refuses", () => {
    // A gigabyte passes the local check on purpose — see `attachment.ts`'s module doc. The server is the
    // authority on the limit, and a number copied into this repo could only go stale against it.
    expect(unwrap(classifyLinearAttachment({ byteLength: 1_073_741_824, fileName: "big.mp4" })).byteLength).toBe(
      1_073_741_824,
    );
  });
});

describe("the staleness check on the door's own table", () => {
  it("forbids nothing when the workspace declares NO restriction — the live case, and the witness's floor", () => {
    expect(typesTheWorkspaceForbids({ restriction: undefined })).toStrictEqual([]);
  });

  it("FIRES when a declared list excludes a type this door would send — proving the check can fail at all", () => {
    expect(typesTheWorkspaceForbids({ restriction: ["image/png"] })).toStrictEqual([
      "image/gif",
      "image/jpeg",
      "image/jpeg",
      "video/quicktime",
      "video/mp4",
      "application/pdf",
      "video/webm",
      "image/webp",
    ]);
  });

  it("forbids EVERYTHING when the workspace declares an empty list, which is not the same as declaring none", () => {
    expect(typesTheWorkspaceForbids({ restriction: [] }).length).toBe(Object.keys(LINEAR_ATTACHABLE_MEDIA).length);
  });

  it("passes clean when the declared list covers every type the door sends", () => {
    expect(typesTheWorkspaceForbids({ restriction: Object.values(LINEAR_ATTACHABLE_MEDIA) })).toStrictEqual([]);
  });
});

describe("what embeds and what links", () => {
  it("embeds an image inline", () => {
    expect(embedsInline({ contentType: "image/png" })).toBe(true);
  });

  it("does NOT embed a PDF — it renders as a file link, which is why the mime is carried at all", () => {
    expect(embedsInline({ contentType: "application/pdf" })).toBe(false);
  });

  it("does not embed a video either", () => {
    expect(embedsInline({ contentType: "video/mp4" })).toBe(false);
  });
});

describe("the media block a form pastes", () => {
  it("carries the asset URL, the caller's alt text and the stored mime", () => {
    const block = mediaBlockFor({ alt: "the failing panel", assetUrl: RESERVATION.assetUrl, contentType: "image/png" });

    expect(block.kind).toBe("media");
    expect(block.url).toBe("https://uploads.linear.test/ws/asset/1");
    expect(block.alt).toBe("the failing panel");
    expect(block.mime).toBe("image/png");
  });
});

describe("the presigned PUT's headers", () => {
  it("sends exactly what Linear listed, because the signature covers those headers", () => {
    const headers = putHeadersFor({ reservation: RESERVATION });

    expect(headers["Content-Type"]).toBe("image/png");
    expect(headers["x-amz-meta-id"]).toBe("abc");
  });

  it("adds Content-Type only when Linear did not name one", () => {
    const headers = putHeadersFor({ reservation: { ...RESERVATION, headers: [{ key: "x-a", value: "b" }] } });

    expect(headers["Content-Type"]).toBe("image/png");
    expect(headers["x-a"]).toBe("b");
  });

  it("does not add a SECOND Content-Type when Linear named it lowercased", () => {
    const headers = putHeadersFor({
      reservation: { ...RESERVATION, headers: [{ key: "content-type", value: "image/webp" }] },
    });

    expect(headers["content-type"]).toBe("image/webp");
    expect(headers["Content-Type"]).toBe(undefined);
  });
});

describe("landing the bytes", () => {
  it("hands back the asset only once the bucket accepted the PUT", async () => {
    const sent: { url: string; bytes: number }[] = [];
    const stored = await putReservedAsset({
      bytes: new Uint8Array([1, 2, 3]),
      classified: CLASSIFIED,
      privacy: NO_TERMS_LINEAR_PRIVACY,
      fetchImpl: ({ url, body }) => {
        sent.push({ bytes: body.length, url });
        return Promise.resolve({ status: 200 });
      },
      reservation: RESERVATION,
    });

    expect(stored.isOk()).toBe(true);
    expect(unwrap(stored).assetUrl).toBe("https://uploads.linear.test/ws/asset/1");
    // ONE request, to the slot Linear named, carrying the file's bytes. That it is a PUT is proven by the
    // cassette's own recorded request line rather than here — this seam has no method to vary.
    expect(sent).toStrictEqual([{ bytes: 3, url: "https://bucket.linear.test/put?sig=1" }]);
  });

  it("REFUSES on a non-2xx, so a reserved-but-empty asset URL never reaches a caller", async () => {
    const refused = await putReservedAsset({
      bytes: new Uint8Array([1]),
      classified: CLASSIFIED,
      privacy: NO_TERMS_LINEAR_PRIVACY,
      fetchImpl: () => Promise.resolve({ status: 403 }),
      reservation: RESERVATION,
    });

    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("ASSET_PUT_FAILED");
    expect(refused._unsafeUnwrapErr().message).toContain("403");
    expect(refused._unsafeUnwrapErr().message).toContain("Do not embed it");
  });

  it("reports status 0 for a PUT that never completed, which no bucket can answer", async () => {
    const refused = await putReservedAsset({
      bytes: new Uint8Array([1]),
      classified: CLASSIFIED,
      privacy: NO_TERMS_LINEAR_PRIVACY,
      fetchImpl: () => Promise.reject(new Error("ECONNRESET")),
      reservation: RESERVATION,
    });

    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("ASSET_PUT_FAILED");
    expect(refused._unsafeUnwrapErr().message).toContain("0 to the PUT");
  });

  it("treats a 204 as accepted — a bucket that stores the bytes need not return a body", async () => {
    const stored = await putReservedAsset({
      bytes: new Uint8Array([1]),
      classified: CLASSIFIED,
      privacy: NO_TERMS_LINEAR_PRIVACY,
      fetchImpl: () => Promise.resolve({ status: 204 }),
      reservation: RESERVATION,
    });

    expect(stored.isOk()).toBe(true);
    expect(unwrap(stored).contentType).toBe("image/png");
    expect(unwrap(stored).fileName).toBe("probe.png");
  });
});
