import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import {
  downloadGithubRenderedMedia,
  type GithubMediaWrite,
  makeGithubMediaFetch,
  writeGithubMedia,
} from "../../../../live/github/mediaDownload.js";

const SIGNED = "https://private-user-images.githubusercontent.com/1/a.mp4?jwt=SECRET-WITNESS";
const UNSIGNED = "https://private-user-images.githubusercontent.com/1/a.mp4";

/** A request seam that records every address it is handed and answers with one fixed response. */
function recordingRequest({ calls, respond }: { calls: string[]; respond: () => Response }) {
  return ({ url }: { url: string }): Promise<Response> => {
    calls.push(url);
    return Promise.resolve(respond());
  };
}

describe("makeGithubMediaFetch", () => {
  it("fetches an exact attachment host with nothing but the address, and returns the bytes and type", async () => {
    const calls: string[] = [];
    const fetchMedia = makeGithubMediaFetch({
      maxBytes: 8,
      request: recordingRequest({
        calls,
        respond: () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } }),
      }),
    });

    const fetched = unwrap(await fetchMedia({ url: SIGNED }));

    expect(calls).toEqual([SIGNED]);
    expect([...fetched.bytes]).toEqual([1, 2, 3]);
    expect(fetched.contentType).toBe("video/mp4");
  });

  it("makes no request for a lookalike host, plain http or an unparseable address", async () => {
    const calls: string[] = [];
    const fetchMedia = makeGithubMediaFetch({
      maxBytes: 8,
      request: recordingRequest({ calls, respond: () => new Response("x") }),
    });

    const refused = await Promise.all(
      [
        "https://private-user-images.githubusercontent.com.evil.example/a.mp4?jwt=SECRET-WITNESS",
        "http://private-user-images.githubusercontent.com/a.mp4?jwt=SECRET-WITNESS",
        "not an address",
      ].map((url) => fetchMedia({ url })),
    );

    expect(calls).toEqual([]);
    expect(refused.map((result) => unwrapErr(result).code)).toEqual([
      "MEDIA_DOWNLOAD_FAILED",
      "MEDIA_DOWNLOAD_FAILED",
      "MEDIA_DOWNLOAD_FAILED",
    ]);
  });

  it("refuses a redirect rather than following it, without the signing token in the failure", async () => {
    const fetchMedia = makeGithubMediaFetch({
      maxBytes: 8,
      request: () =>
        Promise.resolve(new Response(null, { headers: { location: "https://elsewhere.example/" }, status: 302 })),
    });

    const failure = unwrapErr(await fetchMedia({ url: SIGNED }));

    expect(failure).toEqual(
      GithubLiveErrors.mediaDownloadFailed({
        reason: "the host answered HTTP 302, a redirect, which is refused",
        url: SIGNED,
      }),
    );
    expect(JSON.stringify(failure)).not.toContain("SECRET-WITNESS");
    expect(SIGNED).toContain("SECRET-WITNESS");
  });

  it("names a non-2xx answer by its status", async () => {
    const fetchMedia = makeGithubMediaFetch({
      maxBytes: 8,
      request: () => Promise.resolve(new Response("gone", { status: 404 })),
    });

    expect(unwrapErr(await fetchMedia({ url: SIGNED })).message).toBe(
      `could not download ${UNSIGNED}: the host answered HTTP 404`,
    );
  });

  it("refuses a declared size past the ceiling before reading the body", async () => {
    const fetchMedia = makeGithubMediaFetch({
      maxBytes: 4,
      request: () => Promise.resolve(new Response("abc", { headers: { "content-length": "5" } })),
    });

    expect(unwrapErr(await fetchMedia({ url: SIGNED })).message).toBe(
      `could not download ${UNSIGNED}: it declares 5 bytes, past the 4-byte ceiling`,
    );
  });

  it("allows exactly the ceiling and stops a body that streams one byte past it", async () => {
    const at = makeGithubMediaFetch({
      maxBytes: 4,
      request: () => Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]))),
    });
    const past = makeGithubMediaFetch({
      maxBytes: 4,
      request: () => Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4, 5]))),
    });

    expect(unwrap(await at({ url: SIGNED })).bytes.byteLength).toBe(4);
    expect(unwrapErr(await past({ url: SIGNED })).message).toBe(
      `could not download ${UNSIGNED}: its body ran past the 4-byte ceiling`,
    );
  });

  it("words a thrown request by its kind, never by the text that quoted the signed address", async () => {
    const fetchMedia = makeGithubMediaFetch({
      maxBytes: 8,
      request: () => Promise.reject(new Error(`refused ${SIGNED}`)),
    });

    const failure = unwrapErr(await fetchMedia({ url: SIGNED }));

    expect(failure.code).toBe("MEDIA_DOWNLOAD_FAILED");
    expect(JSON.stringify(failure)).not.toContain("SECRET-WITNESS");
  });
});

describe("downloadGithubRenderedMedia", () => {
  const video = { index: 1, kind: "video" as const, url: SIGNED };
  const image = {
    index: 2,
    kind: "image" as const,
    url: "https://private-user-images.githubusercontent.com/1/b.png?jwt=SECRET-WITNESS",
  };

  it("writes each candidate in order under its numbered name and reports size and sha256", async () => {
    const writes: { path: string; bytes: number[] }[] = [];
    const write: GithubMediaWrite = ({ bytes, path }) => {
      writes.push({ bytes: [...bytes], path });
      return ok(true);
    };
    const bodies: Readonly<Record<string, { bytes: Buffer; contentType: string }>> = {
      [image.url]: { bytes: Buffer.from([9]), contentType: "image/png" },
      [video.url]: { bytes: Buffer.from([1, 2]), contentType: "video/mp4" },
    };

    const written = unwrap(
      await downloadGithubRenderedMedia({
        candidates: [video, image],
        fetchMedia: ({ url }) => Promise.resolve(ok(bodies[url]!)),
        maxBytes: 8,
        outDir: "/out",
        writeMedia: write,
      }),
    );

    expect(writes).toEqual([
      { bytes: [1, 2], path: "/out/github-media-01.mp4" },
      { bytes: [9], path: "/out/github-media-02.png" },
    ]);
    expect(written).toEqual([
      {
        bytes: 2,
        kind: "video",
        name: "github-media-01.mp4",
        path: "/out/github-media-01.mp4",
        sha256: createHash("sha256")
          .update(Buffer.from([1, 2]))
          .digest("hex"),
      },
      {
        bytes: 1,
        kind: "image",
        name: "github-media-02.png",
        path: "/out/github-media-02.png",
        sha256: createHash("sha256")
          .update(Buffer.from([9]))
          .digest("hex"),
      },
    ]);
    expect(JSON.stringify(written)).not.toContain("SECRET-WITNESS");
  });

  it("writes nothing for an unsupported content type, and names the address without its token", async () => {
    const writes: string[] = [];

    const failure = unwrapErr(
      await downloadGithubRenderedMedia({
        candidates: [video],
        fetchMedia: () => Promise.resolve(ok({ bytes: Buffer.from("<html>"), contentType: "text/html" })),
        maxBytes: 8,
        outDir: "/out",
        writeMedia: ({ path }) => {
          writes.push(path);
          return ok(true);
        },
      }),
    );

    expect(writes).toEqual([]);
    expect(failure.message).toBe(
      `could not download ${UNSIGNED}: the host named content type text/html, not a picture or video this verb writes`,
    );
  });

  it("never prints a content type header that reflects the signed address", async () => {
    const reflected = `text/plain; source="${SIGNED}"`;
    const odd = `${SIGNED}`;

    const [withParameter, notAType] = await Promise.all(
      [reflected, odd].map((contentType) =>
        downloadGithubRenderedMedia({
          candidates: [video],
          fetchMedia: () => Promise.resolve(ok({ bytes: Buffer.from("x"), contentType })),
          maxBytes: 8,
          outDir: "/out",
          writeMedia: () => ok(true),
        }),
      ),
    );

    expect(reflected).toContain("SECRET-WITNESS");
    expect(unwrapErr(withParameter!).message).toBe(
      `could not download ${UNSIGNED}: the host named content type text/plain, not a picture or video this verb writes`,
    );
    expect(unwrapErr(notAType!).message).toBe(
      `could not download ${UNSIGNED}: the host named no recognisable content type, not a picture or video this verb writes`,
    );
  });

  it("holds the ceiling itself whatever the fetch returned", async () => {
    const failure = unwrapErr(
      await downloadGithubRenderedMedia({
        candidates: [video],
        fetchMedia: () => Promise.resolve(ok({ bytes: Buffer.alloc(9), contentType: "video/mp4" })),
        maxBytes: 8,
        outDir: "/out",
        writeMedia: () => ok(true),
      }),
    );

    expect(failure.message).toBe(`could not download ${UNSIGNED}: it is 9 bytes, past the 8-byte ceiling`);
  });

  it("stops at the first failed fetch", async () => {
    const fetched: string[] = [];
    const stop = GithubLiveErrors.mediaDownloadFailed({ reason: "the host answered HTTP 500", url: SIGNED });

    const failure = unwrapErr(
      await downloadGithubRenderedMedia({
        candidates: [video, image],
        fetchMedia: ({ url }) => {
          fetched.push(url);
          return Promise.resolve(err(stop));
        },
        maxBytes: 8,
        outDir: "/out",
        writeMedia: () => ok(true),
      }),
    );

    expect(fetched).toEqual([SIGNED]);
    expect(failure).toEqual(stop);
  });
});

describe("writeGithubMedia", () => {
  let dir: string | undefined;
  afterEach(() => {
    rmSync(dir!, { force: true, recursive: true });
  });

  it("writes the exact bytes, and names the path when the write fails", () => {
    dir = mkdtempSync(join(tmpdir(), "gh-media-"));
    const path = join(dir, "nested", "github-media-01.mp4");
    const bytes = Buffer.from([0, 255, 1, 254]);
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "a file, not a directory");

    expect(unwrap(writeGithubMedia({ bytes, path }))).toBe(true);
    expect([...readFileSync(path)]).toEqual([0, 255, 1, 254]);
    expect(unwrapErr(writeGithubMedia({ bytes, path: join(blocker, "x.mp4") })).code).toBe("MEDIA_WRITE_FAILED");
  });
});
