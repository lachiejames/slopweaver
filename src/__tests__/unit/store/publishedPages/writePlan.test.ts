import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { foldBodies, storedMediaType } from "../../../../store/publishedPages/bodies.js";
import { type PublishedPagesImportError, PublishedPagesImportErrors } from "../../../../store/publishedPages/errors.js";
import { UNSERVED_MEDIA_TYPE } from "../../../../store/publishedPages/mediaType.js";
import { PublishedPageWriteErrors } from "../../../../store/publishedPages/writeErrors.js";
import { freezeWrite, pageWrite } from "../../../../store/publishedPages/writePlan.js";

const AT = new Date("2026-11-10T01:00:00.000Z");
const HOME = "/home/acme/.slopweaver";

/** The lower-case hex sha-256 of a text. */
function sha({ text }: { text: string }): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("pageWrite", () => {
  it("plans the document as the page's current body and its one new version, beside every file it loads", () => {
    const write = unwrap(
      pageWrite({
        assets: [{ bytes: Buffer.from("PNG"), relativePath: "images/a.png" }],
        document: "<p>doc</p>",
        frozenAt: AT,
        home: HOME,
        slug: "acme-page",
      }),
    );

    expect(write.kind).toBe("publish");
    expect(write.published).toEqual({ bodySha256: sha({ text: "<p>doc</p>" }), frozenAt: AT, pageKey: "acme-page" });
    expect(write.plan.pages).toEqual([
      {
        canonicalAddress: "file:///home/acme/.slopweaver/pages/acme-page/index.html",
        currentBodySha256: sha({ text: "<p>doc</p>" }),
        files: [
          { bodySha256: sha({ text: "<p>doc</p>" }), relativePath: "index.html" },
          { bodySha256: sha({ text: "PNG" }), relativePath: "images/a.png" },
        ],
        kind: "local",
        latestFrozenAt: AT,
        latestFrozenBodySha256: sha({ text: "<p>doc</p>" }),
        pageKey: "acme-page",
        publishedAt: AT,
        versionSha256s: [sha({ text: "<p>doc</p>" })],
      },
    ]);
    expect(write.plan.blobs.map((blob) => [blob.sha256, blob.mediaType, blob.byteLength])).toEqual(
      [
        [sha({ text: "<p>doc</p>" }), "text/html", 10],
        [sha({ text: "PNG" }), "image/png", 3],
      ].toSorted((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    expect(write.plan.counts).toEqual({
      bytes: 13,
      distinctBodies: 2,
      files: 2,
      finderMetadataSkipped: 0,
      historiesWithoutPage: 0,
      localPages: 1,
      publishedAtFromFreeze: 1,
      publishedAtFromModified: 0,
      unservedFiles: 0,
      versions: 1,
    });
  });

  it("refuses a file carrying the document's own bytes under another type", () => {
    const refused = unwrapErr(
      pageWrite({
        assets: [{ bytes: Buffer.from("<p>doc</p>"), relativePath: "copy.png" }],
        document: "<p>doc</p>",
        frozenAt: AT,
        home: HOME,
        slug: "acme-page",
      }),
    );

    expect(refused).toEqual([
      PublishedPagesImportErrors.bodyMediaConflict({
        paths: ["acme-page/index.html (text/html)", "acme-page/copy.png (image/png)"],
        sha256: sha({ text: "<p>doc</p>" }),
      }),
    ]);
  });
});

describe("freezeWrite", () => {
  it("plans one version and a history-only row carrying the key's new latest pointer, no document or files", () => {
    const write = freezeWrite({ document: "<p>stamped</p>", frozenAt: AT, key: "acme-brief", opensHistory: true });

    expect(write).toMatchObject({ kind: "freeze", opensHistory: true });
    expect(write.published).toEqual({
      bodySha256: sha({ text: "<p>stamped</p>" }),
      frozenAt: AT,
      pageKey: "acme-brief",
    });
    expect(write.plan.pages).toEqual([
      {
        canonicalAddress: null,
        currentBodySha256: null,
        files: [],
        kind: "history-only",
        latestFrozenAt: AT,
        latestFrozenBodySha256: sha({ text: "<p>stamped</p>" }),
        pageKey: "acme-brief",
        publishedAt: null,
        versionSha256s: [sha({ text: "<p>stamped</p>" })],
      },
    ]);
    expect(write.plan.counts).toMatchObject({ files: 0, historiesWithoutPage: 1, localPages: 0, versions: 1 });
  });
});

describe("foldBodies", () => {
  it("keeps one body per digest in digest order, gathering a refusal for a second type", () => {
    const refusals: PublishedPagesImportError[] = [];
    const claim = ({ text, mediaType, path }: { text: string; mediaType: string; path: string }) => ({
      bytes: Buffer.from(text),
      mediaType,
      path,
      sha256: sha({ text }),
    });

    const blobs = foldBodies({
      claims: [
        claim({ mediaType: "image/png", path: "p/a.png", text: "A" }),
        claim({ mediaType: "image/png", path: "p/b.png", text: "A" }),
        claim({ mediaType: "text/css", path: "p/a.css", text: "A" }),
        claim({ mediaType: "text/css", path: "p/z.css", text: "Z" }),
      ],
      refusals,
    });

    expect(blobs.map((blob) => [blob.sha256, blob.mediaType])).toEqual(
      [
        [sha({ text: "A" }), "image/png"],
        [sha({ text: "Z" }), "text/css"],
      ].toSorted((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    expect(refusals.map((refusal) => refusal.code)).toEqual(["PAGES_BODY_MEDIA_CONFLICT"]);
  });

  it("types a file no reader serves as opaque bytes", () => {
    expect([storedMediaType({ relativePath: "a.png" }), storedMediaType({ relativePath: "a.unknownext" })]).toEqual([
      "image/png",
      UNSERVED_MEDIA_TYPE,
    ]);
  });
});

describe("PublishedPageWriteErrors", () => {
  it("names the store step that threw", () => {
    const error = PublishedPageWriteErrors.storeUnavailable({ cause: new Error("ECONNREFUSED"), doing: "open" });
    expect([error.code, error.message]).toEqual([
      "PAGES_STORE_UNAVAILABLE",
      "the store connection did not open: ECONNREFUSED",
    ]);
  });
});
