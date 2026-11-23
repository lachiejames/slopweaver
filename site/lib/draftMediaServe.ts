/**
 * Serving one parked draft's attached picture to the queue card — the effectful half of `/api/draft-media/<sha256>`,
 * taking the store directory as an argument so a test can hand it a throwaway one.
 *
 * Measured: the owner could not tell what the images were, because the card drew a file icon and a byte size where
 * Slack draws the picture. The bytes are kept, content-addressed, by `slack draft record --media`
 * (`src/admit/slackDraftMediaStore.ts`: `<store>/<sha[0:2]>/<sha256>`, owner-only); this route is what lets the page
 * see them.
 *
 * What makes this safe to serve from the console:
 *
 * - **The address IS the content.** Only exactly 64 lowercase hex characters is a name, so no request can spell a
 *   path; no directory between the state home and the blob may be a link and the file is opened `O_NOFOLLOW`, so
 *   nothing outside the owner-only store is read; and the bytes are hashed again and must match the name before one byte is
 *   sent, so a blob swapped or corrupted under the store is refused rather than shown as the one the owner approves.
 * - **Pictures and videos only, as bytes.** The type is read off the bytes — never a filename or a query — and only
 *   a PNG, JPEG, GIF, WebP, BMP or MP4/QuickTime container is answered, with `nosniff` and a sandbox policy, so
 *   nothing the store holds can be served as a document the browser would run.
 * - **A document's words, as JSON.** `serveDraftMediaText` (`/api/draft-media/<sha256>/text`; the owner cannot react to a
 *   document whose text they cannot see) answers UTF-8 text or a PDF's extracted text inside a JSON body
 *   the card draws as text nodes, so markdown and HTML reach the owner as their source and never as a page.
 * - **An HTML document, as a sandboxed page, on its own address.** `serveDraftMediaPage`
 *   (`/api/draft-media/<sha256>/page`) answers bytes that ARE an HTML document as one, under the
 *   published-page policy, for the in-app viewer to frame — the one place the store's bytes run as a page, and only
 *   in a sandbox with no reach into the console.
 *
 * Every failure is the same plain 404 naming the hash, because the card branches on nothing but whether it drew.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

import { consoleHome, consoleHomePaths } from "./consoleHome";
import type { DraftMediaText } from "./draftMediaText";
import { PAGE_CSP } from "./localPageServe";

/**
 * The draft-media store under the home this console was started with.
 *
 * @returns the absolute store directory
 */
export function draftMediaStoreDir(): string {
  return consoleHomePaths().draftMedia;
}

/**
 * The store a hand step's picture lives in (`src/hand/shotStore.ts`), under the home this console was started with.
 * Same naming, sharding and modes as the draft-media store, so {@link serveDraftMedia} serves it with every check.
 *
 * @returns the absolute store directory
 */
export function handShotStoreDir(): string {
  return consoleHomePaths().handShots;
}

/**
 * The store a channel hover window's pictures live in (`src/live/slack/channelMedia.ts`), under the home this console
 * was started with. Same naming, sharding and modes as the draft-media store, so {@link serveDraftMedia} serves it with
 * every check.
 *
 * @returns the absolute store directory
 */
export function slackChannelMediaStoreDir(): string {
  return consoleHomePaths().slackChannelMedia;
}

/** A stored blob's name: its lowercase-hex SHA-256. */
const SHA256 = /^[0-9a-f]{64}$/u;

/**
 * Where one blob lives in the store, or `undefined` when the name is not a SHA-256.
 *
 * @param storeDir the draft-media store directory
 * @param sha256 the requested name
 * @returns the blob's path
 */
export function draftMediaPath({ storeDir, sha256 }: { storeDir: string; sha256: string }): string | undefined {
  if (!SHA256.test(sha256)) {
    return undefined;
  }
  return join(storeDir, sha256.slice(0, 2), sha256);
}

/** Leading bytes → the picture type they open, matched at offset 0. */
const SIGNATURES: readonly { readonly type: string; readonly magic: readonly number[] }[] = [
  { magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], type: "image/png" },
  { magic: [0xff, 0xd8, 0xff], type: "image/jpeg" },
  { magic: [0x47, 0x49, 0x46, 0x38], type: "image/gif" },
  { magic: [0x42, 0x4d], type: "image/bmp" },
];

/**
 * The picture or video type bytes open with, or `undefined` for anything else — a document, a TIFF, an unknown.
 *
 * @param bytes the whole blob
 * @returns the content type to serve it as
 */
export function inlineMediaTypeOf({ bytes }: { bytes: Uint8Array }): string | undefined {
  const opens = SIGNATURES.find(({ magic }) => magic.every((byte, index) => bytes[index] === byte));
  if (opens !== undefined) {
    return opens.type;
  }
  if (fourCc({ at: 0, bytes }) === "RIFF" && fourCc({ at: 8, bytes }) === "WEBP") {
    return "image/webp";
  }
  if (fourCc({ at: 4, bytes }) === "ftyp") {
    return fourCc({ at: 8, bytes }) === "qt  " ? "video/quicktime" : "video/mp4";
  }
  return undefined;
}

/** The four bytes at `at`, as characters — a RIFF or ISO-BMFF box field. */
function fourCc({ bytes, at }: { bytes: Uint8Array; at: number }): string {
  return String.fromCodePoint(...bytes.subarray(at, at + 4));
}

/**
 * Whether any of these entries is a symbolic link. `O_NOFOLLOW` guards only the blob itself, so the directories
 * between the state home and it — `queue`, the store root, the shard — are checked here, the same hops the store
 * refuses to write through (`src/admit/slackDraftMediaStore.ts`, `linkedEntry`). The home itself may be a link.
 *
 * @param entries the directories to check, each of which must exist
 * @returns true when one is a link
 */
async function anyLinked({ entries }: { entries: readonly string[] }): Promise<boolean> {
  for (const entry of entries) {
    if ((await lstat(entry)).isSymbolicLink()) {
      return true;
    }
  }
  return false;
}

/**
 * Every directory strictly below `top` on the way to `dir`, `dir` included — none when `dir` is not under `top`.
 *
 * A store nested deeper than one level under the home (`live/slack/channel-media`) has hops the store's own three
 * checks never reach: a linked `live` would be walked straight through, since `O_NOFOLLOW` guards only the blob.
 *
 * @param top the state home, which may itself be a link
 * @param dir the blob's shard directory
 * @returns the directories to check, nearest the home first
 */
export function directoriesBelow({ top, dir }: { top: string; dir: string }): readonly string[] {
  const hops = relative(top, dir);
  if (hops === "" || hops.startsWith("..") || isAbsolute(hops)) {
    return [];
  }
  const parts = hops.split(sep);
  return parts.map((_, index) => join(top, ...parts.slice(0, index + 1)));
}

/**
 * A plain-text 404 naming which blob is not served.
 *
 * @returns the response
 */
function notServed({ sha256 }: { sha256: string }): Response {
  return new Response(`no draft attachment ${sha256}`, {
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
    status: 404,
  });
}

/**
 * Read one blob off the store and check it is the bytes its name promises: no linked directory on the way, the
 * blob itself opened without following a link, and its SHA-256 recomputed. The send reads the same blob through
 * the same check (`src/admit/slackDraftMediaStore.ts`, `readSlackDraftMedia`), so what this answers is what an
 * approval would upload.
 *
 * @param storeDir the draft-media store directory
 * @param sha256 the requested blob's name
 * @returns the verified bytes, or `undefined` for any failure
 */
async function readVerifiedBlob({
  storeDir,
  sha256,
}: {
  storeDir: string;
  sha256: string;
}): Promise<Uint8Array | undefined> {
  const path = draftMediaPath({ sha256, storeDir });
  if (path === undefined) {
    return undefined;
  }
  let bytes: Uint8Array;
  try {
    const belowHome = directoriesBelow({ dir: dirname(path), top: consoleHome() });
    if (await anyLinked({ entries: [dirname(storeDir), storeDir, dirname(path), ...belowHome] })) {
      return undefined;
    }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      bytes = await handle.readFile();
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
    return undefined;
  }
  return bytes;
}

/**
 * Read one blob off the store, check it is the bytes its name promises and a picture or video, and answer it.
 *
 * @param storeDir the draft-media store directory
 * @param sha256 the requested blob's name
 * @returns the bytes, or a 404
 */
export async function serveDraftMedia({ storeDir, sha256 }: { storeDir: string; sha256: string }): Promise<Response> {
  const bytes = await readVerifiedBlob({ sha256, storeDir });
  if (bytes === undefined) {
    return notServed({ sha256 });
  }
  const type = inlineMediaTypeOf({ bytes });
  if (type === undefined) {
    return notServed({ sha256 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      // Content-addressed: these bytes can never change under this name.
      "cache-control": "private, max-age=31536000, immutable",
      "content-security-policy": "sandbox; default-src 'none'",
      "content-type": type,
      "x-content-type-options": "nosniff",
    },
    status: 200,
  });
}

/** How an HTML document opens, once a byte-order mark and leading whitespace are gone: a doctype or the root tag. */
const HTML_OPENING = /^(?:<!doctype html[\s>]|<html[\s>])/iu;

/**
 * Whether bytes are an HTML document: UTF-8 text that opens with `<!doctype html` or `<html`. Typed by the bytes,
 * never by the attachment's name, exactly as {@link inlineMediaTypeOf} types a picture.
 *
 * @param bytes the whole blob
 * @returns the document's text, or `undefined` for anything else
 */
export function htmlDocumentOf({ bytes }: { bytes: Uint8Array }): string | undefined {
  const text = utf8TextOf({ bytes });
  if (text === undefined || !HTML_OPENING.test(text.trimStart())) {
    return undefined;
  }
  return text;
}

/**
 * Read one blob off the store, check it is the bytes its name promises and an HTML document, and answer it as a page
 * for the in-app viewer to frame (`/api/draft-media/<sha256>/page`). Any HTML mentioned in a draft or card is cited
 * so it opens in the in-app viewer. It runs under the policy a published local page runs under (`./localPageServe.ts`'s `PAGE_CSP`): a sandbox
 * with no access to the console's own origin and no request out, so the page draws and can do nothing else.
 *
 * @param storeDir the draft-media store directory
 * @param sha256 the requested blob's name
 * @returns the page, or a 404 naming the hash
 */
export async function serveDraftMediaPage({
  storeDir,
  sha256,
}: {
  storeDir: string;
  sha256: string;
}): Promise<Response> {
  const bytes = await readVerifiedBlob({ sha256, storeDir });
  if (bytes === undefined || htmlDocumentOf({ bytes }) === undefined) {
    return notServed({ sha256 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "cache-control": "private, max-age=31536000, immutable",
      "content-security-policy": PAGE_CSP,
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
    status: 200,
  });
}

/** What a PDF's extractor answered: its text and page counts, or `undefined` when it could not read the document. */
export type PdfTextOf = (args: { bytes: Uint8Array }) => Promise<Extract<DraftMediaText, { kind: "pdf" }> | undefined>;

/** The five bytes every PDF begins with: `%PDF-`. */
const PDF_MAGIC: readonly number[] = [0x25, 0x50, 0x44, 0x46, 0x2d];

/**
 * Bytes as text, when they are text: strict UTF-8 with no NUL. A byte-order mark is dropped, as an editor would.
 *
 * @param bytes the whole blob
 * @returns the text, or `undefined` for bytes that are not UTF-8 text
 */
export function utf8TextOf({ bytes }: { bytes: Uint8Array }): string | undefined {
  if (bytes.includes(0)) {
    return undefined;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Read one blob off the store, check it is the bytes its name promises, and answer the words in it: a PDF's
 * extracted text, or the bytes themselves when they are UTF-8 text. Typed by the BYTES, never by a name or a query,
 * so the route asks nothing but the hash. Answered as JSON the card draws as text nodes — never as a document the
 * browser would render — with `nosniff` and a sandbox policy besides.
 *
 * @param storeDir the draft-media store directory
 * @param sha256 the requested blob's name
 * @param pdfTextOf how a PDF's text is extracted — the route runs `slopweaver pdf read`, a test passes a fake
 * @returns the text as JSON, or a 404 naming the hash
 */
export async function serveDraftMediaText({
  storeDir,
  sha256,
  pdfTextOf,
}: {
  storeDir: string;
  sha256: string;
  pdfTextOf: PdfTextOf;
}): Promise<Response> {
  const bytes = await readVerifiedBlob({ sha256, storeDir });
  if (bytes === undefined) {
    return notServed({ sha256 });
  }
  let answer: DraftMediaText | undefined;
  if (PDF_MAGIC.every((byte, index) => bytes[index] === byte)) {
    answer = await pdfTextOf({ bytes });
  } else {
    const text = utf8TextOf({ bytes });
    if (text !== undefined) {
      answer = { kind: "text", text };
    }
  }
  if (answer === undefined) {
    return notServed({ sha256 });
  }
  return new Response(JSON.stringify(answer), {
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "sandbox; default-src 'none'",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
    status: 200,
  });
}
