import { describe, expect, it } from "vitest";

import {
  bareContentType,
  GITHUB_ATTACHMENT_HOSTS,
  githubMediaFileName,
  githubRenderedMedia,
  unsignedAddress,
} from "../../../../live/github/media.js";

const PRIVATE = "https://private-user-images.githubusercontent.com";

describe("githubRenderedMedia", () => {
  it("names nested videos and images in document order, numbered after filtering", () => {
    const html = [
      `<p><a href="https://example.com"><img src="https://img.shields.io/badge/proof-gold.svg"></a></p>`,
      `<details><summary>clip</summary><video src="${PRIVATE}/1/a.mp4?jwt=one" poster="${PRIVATE}/1/poster.png"></video></details>`,
      `<p><img src="${PRIVATE}/1/b.png?jwt=two"></p>`,
    ].join("");

    expect(githubRenderedMedia({ allowedHosts: GITHUB_ATTACHMENT_HOSTS, html })).toEqual([
      { index: 1, kind: "video", url: `${PRIVATE}/1/a.mp4?jwt=one` },
      { index: 2, kind: "image", url: `${PRIVATE}/1/b.png?jwt=two` },
    ]);
  });

  it("refuses every host that is not an exact attachment host, and anything not https", () => {
    const html = [
      `<img src="https://avatars.githubusercontent.com/u/1">`,
      `<img src="https://camo.githubusercontent.com/x">`,
      `<img src="https://evil-private-user-images.githubusercontent.com/x.png">`,
      `<img src="https://private-user-images.githubusercontent.com.evil.example/x.png">`,
      `<img src="http://private-user-images.githubusercontent.com/x.png">`,
      `<img src="/relative.png">`,
      `<video><source src="${PRIVATE}/source.mp4"></video>`,
      `<a href="${PRIVATE}/link.mp4">link</a>`,
    ].join("");

    expect(githubRenderedMedia({ allowedHosts: GITHUB_ATTACHMENT_HOSTS, html })).toEqual([]);
  });

  it("keeps the first of two signed addresses for the same asset", () => {
    const html = `<img src="${PRIVATE}/1/a.png?jwt=first"><img src="${PRIVATE}/1/a.png?jwt=second"><img src="${PRIVATE}/1/c.png?jwt=third">`;

    expect(githubRenderedMedia({ allowedHosts: GITHUB_ATTACHMENT_HOSTS, html })).toEqual([
      { index: 1, kind: "image", url: `${PRIVATE}/1/a.png?jwt=first` },
      { index: 2, kind: "image", url: `${PRIVATE}/1/c.png?jwt=third` },
    ]);
  });

  it("answers an empty body with no candidates rather than a failure", () => {
    expect(githubRenderedMedia({ allowedHosts: GITHUB_ATTACHMENT_HOSTS, html: "" })).toEqual([]);
  });
});

describe("githubMediaFileName", () => {
  it("names each supported content type by position, ignoring case and parameters", () => {
    expect(
      [
        "image/gif",
        "image/jpeg",
        "image/png",
        "image/webp",
        "video/mp4",
        "video/quicktime",
        "VIDEO/WEBM; charset=binary",
      ].map((contentType, offset) => githubMediaFileName({ contentType, index: offset + 1 })),
    ).toEqual([
      "github-media-01.gif",
      "github-media-02.jpg",
      "github-media-03.png",
      "github-media-04.webp",
      "github-media-05.mp4",
      "github-media-06.mov",
      "github-media-07.webm",
    ]);
  });

  it("names no file for a missing or unsupported type, or a position that is not 1-based", () => {
    expect(githubMediaFileName({ contentType: undefined, index: 1 })).toBe(undefined);
    expect(githubMediaFileName({ contentType: "text/html", index: 1 })).toBe(undefined);
    expect(githubMediaFileName({ contentType: "video/mp4", index: 0 })).toBe(undefined);
    expect(githubMediaFileName({ contentType: "video/mp4", index: 1.5 })).toBe(undefined);
  });
});

describe("bareContentType", () => {
  it("keeps only a plain type/subtype, lowercased and without parameters", () => {
    expect(bareContentType({ contentType: "Video/MP4; codecs=avc1" })).toBe("video/mp4");
  });

  it("refuses a header that is not a media-type token", () => {
    expect(bareContentType({ contentType: "https://host/a?jwt=x" })).toBe(undefined);
    expect(bareContentType({ contentType: "" })).toBe(undefined);
    expect(bareContentType({ contentType: undefined })).toBe(undefined);
  });
});

describe("unsignedAddress", () => {
  it("drops the query and fragment that carry the signing token", () => {
    expect(unsignedAddress({ url: `${PRIVATE}/1/a.mp4?jwt=secret-token#t=3` })).toBe(`${PRIVATE}/1/a.mp4`);
  });

  it("echoes nothing of an unparseable address", () => {
    expect(unsignedAddress({ url: "not a url jwt=secret-token" })).toBe("(an unparseable address)");
  });
});
