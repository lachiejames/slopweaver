/**
 * Serving a parked draft's stored picture to the queue card: only a hash names a blob, only the bytes that hash
 * promises are sent, and only as a picture or video. Round-trips a throwaway store.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  directoriesBelow,
  draftMediaPath,
  inlineMediaTypeOf,
  type PdfTextOf,
  serveDraftMedia,
  serveDraftMediaText,
  utf8TextOf,
} from "../../lib/draftMediaServe";

/** A PNG's signature and a few bytes past it — enough to be typed, not decoded. */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

/** The lowercase-hex SHA-256 of some bytes. */
function sha({ bytes }: { bytes: Uint8Array }): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** An ISO-BMFF header whose brand is the given four characters. */
function isoBmff({ brand }: { brand: string }): Uint8Array {
  return Uint8Array.from([0, 0, 0, 0x18, ...Buffer.from(`ftyp${brand}`)]);
}

let store: string;

/** Write bytes into the store under a name, the way `slack draft record --media` lays them out. */
function put({ bytes, name }: { bytes: Uint8Array; name: string }): void {
  mkdirSync(join(store, name.slice(0, 2)), { recursive: true });
  writeFileSync(join(store, name.slice(0, 2), name), bytes);
}

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "draft-media-"));
});

afterEach(() => {
  rmSync(store, { force: true, recursive: true });
});

describe("draftMediaPath", () => {
  it("files a hash under its first two characters", () => {
    expect(draftMediaPath({ sha256: "ab".padEnd(64, "0"), storeDir: "/s" })).toBe(`/s/ab/${"ab".padEnd(64, "0")}`);
  });

  it("refuses anything but 64 lowercase hex characters, so no request can spell a path", () => {
    expect(
      ["../../etc/passwd", "A".repeat(64), "a".repeat(63), `${"a".repeat(62)}/.`].map((name) =>
        draftMediaPath({ sha256: name, storeDir: "/s" }),
      ),
    ).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("inlineMediaTypeOf", () => {
  it("types each picture and video container by its bytes", () => {
    const riff = Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]);
    expect(
      [
        PNG,
        Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
        Uint8Array.from(Buffer.from("GIF89a")),
        Uint8Array.from([0x42, 0x4d, 0x00]),
        riff,
        isoBmff({ brand: "isom" }),
        isoBmff({ brand: "qt  " }),
      ].map((bytes) => inlineMediaTypeOf({ bytes })),
    ).toEqual(["image/png", "image/jpeg", "image/gif", "image/bmp", "image/webp", "video/mp4", "video/quicktime"]);
  });

  it("answers nothing for a document, a TIFF or nothing at all", () => {
    expect(
      [Uint8Array.from(Buffer.from("%PDF-1.7")), Uint8Array.from([0x49, 0x49, 0x2a, 0x00]), new Uint8Array()].map(
        (bytes) => inlineMediaTypeOf({ bytes }),
      ),
    ).toEqual([undefined, undefined, undefined]);
  });
});

describe("serveDraftMedia", () => {
  it("serves the stored bytes as the picture they are, immutable and sandboxed", async () => {
    const name = sha({ bytes: PNG });
    put({ bytes: PNG, name });
    const response = await serveDraftMedia({ sha256: name, storeDir: store });
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    expect(Object.fromEntries(response.headers.entries())).toEqual({
      "cache-control": "private, max-age=31536000, immutable",
      "content-security-policy": "sandbox; default-src 'none'",
      "content-type": "image/png",
      "x-content-type-options": "nosniff",
    });
  });

  it("refuses bytes that are not the ones their name promises", async () => {
    const name = sha({ bytes: PNG });
    put({ bytes: Uint8Array.from([...PNG, 0xff]), name });
    const response = await serveDraftMedia({ sha256: name, storeDir: store });
    expect([response.status, await response.text()]).toEqual([404, `no draft attachment ${name}`]);
  });

  it("refuses a stored document even when its hash matches", async () => {
    const pdf = Uint8Array.from(Buffer.from("%PDF-1.7 body"));
    const name = sha({ bytes: pdf });
    put({ bytes: pdf, name });
    expect((await serveDraftMedia({ sha256: name, storeDir: store })).status).toBe(404);
  });

  it("refuses a missing blob, a malformed name and a blob that is a symlink", async () => {
    const name = sha({ bytes: PNG });
    const outside = join(store, "outside.png");
    writeFileSync(outside, PNG);
    mkdirSync(join(store, name.slice(0, 2)), { recursive: true });
    symlinkSync(outside, join(store, name.slice(0, 2), name));
    const statuses = await Promise.all(
      [name, "f".repeat(64), "../outside.png"].map(
        async (asked) => (await serveDraftMedia({ sha256: asked, storeDir: store })).status,
      ),
    );
    expect(statuses).toEqual([404, 404, 404]);
  });

  it("refuses a blob reached through a linked shard, though the same bytes serve from a real one", async () => {
    const name = sha({ bytes: PNG });
    const elsewhere = join(store, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, name), PNG);
    const linkedStore = join(store, "linked");
    mkdirSync(linkedStore);
    symlinkSync(elsewhere, join(linkedStore, name.slice(0, 2)));
    const realStore = join(store, "real");
    mkdirSync(join(realStore, name.slice(0, 2)), { recursive: true });
    writeFileSync(join(realStore, name.slice(0, 2), name), PNG);
    const statuses = await Promise.all(
      [linkedStore, realStore].map(async (storeDir) => (await serveDraftMedia({ sha256: name, storeDir })).status),
    );
    expect(statuses).toEqual([404, 200]);
  });

  it("refuses a text document even when its hash matches — words go through the text route", async () => {
    const text = Uint8Array.from(Buffer.from("# a heading\n"));
    const name = sha({ bytes: text });
    put({ bytes: text, name });
    expect((await serveDraftMedia({ sha256: name, storeDir: store })).status).toBe(404);
  });

  it("refuses a store root or a queue directory that is a link", async () => {
    const name = sha({ bytes: PNG });
    const realQueue = join(store, "real-queue");
    mkdirSync(join(realQueue, "media", name.slice(0, 2)), { recursive: true });
    writeFileSync(join(realQueue, "media", name.slice(0, 2), name), PNG);
    symlinkSync(realQueue, join(store, "linked-queue"));
    mkdirSync(join(store, "home"));
    symlinkSync(join(realQueue, "media"), join(store, "home", "media"));
    const statuses = await Promise.all(
      [join(realQueue, "media"), join(store, "linked-queue", "media"), join(store, "home", "media")].map(
        async (storeDir) => (await serveDraftMedia({ sha256: name, storeDir })).status,
      ),
    );
    expect(statuses).toEqual([200, 404, 404]);
  });

  it("refuses a blob in a deeper store reached through a linked directory nearer the home", async () => {
    // `<home>/live` linked elsewhere, with the channel-media store's three own hops all real beyond it.
    const name = sha({ bytes: PNG });
    const home = join(store, "home");
    const outside = join(store, "outside");
    mkdirSync(join(outside, "slack", "channel-media", name.slice(0, 2)), { recursive: true });
    writeFileSync(join(outside, "slack", "channel-media", name.slice(0, 2), name), PNG);
    mkdirSync(home);
    symlinkSync(outside, join(home, "live"));
    const before = process.env["SLOPWEAVER_HOME"];
    process.env["SLOPWEAVER_HOME"] = home;
    try {
      const statuses = await Promise.all(
        [join(home, "live", "slack", "channel-media"), join(outside, "slack", "channel-media")].map(
          async (storeDir) => (await serveDraftMedia({ sha256: name, storeDir })).status,
        ),
      );
      expect(statuses).toEqual([404, 200]);
    } finally {
      if (before === undefined) {
        delete process.env["SLOPWEAVER_HOME"];
      } else {
        process.env["SLOPWEAVER_HOME"] = before;
      }
    }
  });
});

describe("directoriesBelow", () => {
  it("names every directory under the home on the way to the shard, nearest the home first", () => {
    expect(directoriesBelow({ dir: "/h/live/slack/channel-media/ab", top: "/h" })).toEqual([
      "/h/live",
      "/h/live/slack",
      "/h/live/slack/channel-media",
      "/h/live/slack/channel-media/ab",
    ]);
  });

  it("names none for a shard outside the home, or the home itself", () => {
    expect([directoriesBelow({ dir: "/elsewhere/ab", top: "/h" }), directoriesBelow({ dir: "/h", top: "/h" })]).toEqual(
      [[], []],
    );
  });
});

describe("utf8TextOf", () => {
  it("decodes UTF-8 text and drops a byte-order mark", () => {
    expect([
      utf8TextOf({ bytes: Uint8Array.from(Buffer.from("café — ok\n")) }),
      utf8TextOf({ bytes: Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from("x")]) }),
      utf8TextOf({ bytes: new Uint8Array() }),
    ]).toEqual(["café — ok\n", "x", ""]);
  });

  it("reads nothing from invalid UTF-8 or bytes carrying a NUL", () => {
    expect([
      utf8TextOf({ bytes: Uint8Array.from([0x61, 0xff, 0x62]) }),
      utf8TextOf({ bytes: Uint8Array.from([0x61, 0x00, 0x62]) }),
      utf8TextOf({ bytes: PNG }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe("serveDraftMediaText", () => {
  /** A PDF answer the fake extractor gives back, carrying the byte count it was handed. */
  const pdfTextOf: PdfTextOf = ({ bytes }) =>
    Promise.resolve({
      glyphless: false,
      kind: "pdf",
      pages: 2,
      pagesRead: 2,
      text: `read ${String(bytes.length)} bytes`,
    });

  it("answers a stored markdown file's exact text as JSON, sandboxed and never cached", async () => {
    const markdown = "# ISO concerns\n\n- **leavers**: <script>alert(1)</script>\n";
    const bytes = Uint8Array.from(Buffer.from(markdown));
    const name = sha({ bytes });
    put({ bytes, name });
    const response = await serveDraftMediaText({ pdfTextOf, sha256: name, storeDir: store });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "text", text: markdown });
    expect(Object.fromEntries(response.headers.entries())).toEqual({
      "cache-control": "no-store",
      "content-security-policy": "sandbox; default-src 'none'",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    });
  });

  it("hands a stored PDF's verified bytes to the extractor and answers what it read", async () => {
    const pdf = Uint8Array.from(Buffer.from("%PDF-1.7 body"));
    const name = sha({ bytes: pdf });
    put({ bytes: pdf, name });
    const response = await serveDraftMediaText({ pdfTextOf, sha256: name, storeDir: store });
    expect(await response.json()).toEqual({
      glyphless: false,
      kind: "pdf",
      pages: 2,
      pagesRead: 2,
      text: `read ${String(pdf.length)} bytes`,
    });
  });

  it("answers 404 when the extractor could not read the PDF", async () => {
    const pdf = Uint8Array.from(Buffer.from("%PDF-1.7 broken"));
    const name = sha({ bytes: pdf });
    put({ bytes: pdf, name });
    const response = await serveDraftMediaText({
      pdfTextOf: () => Promise.resolve(undefined),
      sha256: name,
      storeDir: store,
    });
    expect([response.status, await response.text()]).toEqual([404, `no draft attachment ${name}`]);
  });

  it("refuses a picture, a text whose bytes are not its name's, and a malformed name", async () => {
    const pngName = sha({ bytes: PNG });
    put({ bytes: PNG, name: pngName });
    const text = Uint8Array.from(Buffer.from("approved words"));
    const swappedName = sha({ bytes: text });
    put({ bytes: Uint8Array.from(Buffer.from("swapped words")), name: swappedName });
    const statuses = await Promise.all(
      [pngName, swappedName, "../outside.md"].map(
        async (asked) => (await serveDraftMediaText({ pdfTextOf, sha256: asked, storeDir: store })).status,
      ),
    );
    expect(statuses).toEqual([404, 404, 404]);
  });
});
