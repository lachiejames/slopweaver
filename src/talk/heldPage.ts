/**
 * A published page's document read for the console voice out of the STORE, never `pages/`: stage 5 of
 * [the published pages doc](../../docs/store/published-pages.md). The voice still asks for a page by its address,
 * `<home>/pages/<slug>/index.html`, because that address is the page's identity in every card, prompt and tool
 * argument; `talk file read` recognises it ({@link publishedPageOf}) and reads the store's current document for
 * the slug instead of the file.
 *
 * Both modes read the held bytes through the same cores a file read uses (`./localImage.ts`, `./localText.ts`,
 * `./pageWordsRead.ts`), so a page out of the store is sniffed, windowed, outlined and masked byte for byte as the same
 * page off disk is: an `index.html` whose bytes open with a JPEG signature would otherwise read as text out of
 * the store and as a picture off disk.
 *
 * Residue, stated: only the DOCUMENT is recognised. Any other file under a page (an image, a stylesheet) is still
 * read off disk while the folders exist, and stops being readable when stage 7 deletes them.
 */
import { join, normalize, resolve } from "node:path";

import { err, type Result } from "../lib/result.js";
import { isValidPageSlug, PAGE_FILENAME } from "../pages/url.js";

import { readWindow } from "./codeBounds.js";
import { TalkErrors } from "./errors.js";
import { IMAGE_SNIFF_BYTES, sniffImage } from "./imageSniff.js";
import type { LocalReadPolicy } from "./localFile.js";
import { type LocalFileError, LocalFileErrors, type PathRefusedError } from "./localFileErrors.js";
import { type LocalImageRead, readHeldImage } from "./localImage.js";
import { expandLocalPath, refusalFor } from "./localPath.js";
import { type LocalRead, readHeldText } from "./localText.js";
import { PAGE_WORDS_SOURCE_MAX_BYTES, pageWordsOf } from "./pageWordsRead.js";

/**
 * The page a path names when it is exactly a published page's document in this home, `<home>/pages/<slug>/index.html`,
 * compared LEXICALLY after `~` is expanded and the path normalised: the store holds no file to resolve a symlink
 * against, so a spelling through a symlink is a file read, never the page.
 *
 * @param raw the absolute or `~/` path asked for
 * @param home the Slopweaver home whose pages the store holds
 * @param homeDir the owner's home directory, which `~` names
 * @returns the slug and the page's address in its canonical spelling, or nothing when the path is any other file
 */
export function publishedPageOf({
  raw,
  home,
  homeDir,
}: {
  raw: string;
  home: string;
  homeDir: string;
}): { readonly slug: string; readonly address: string } | undefined {
  const expanded = expandLocalPath({ homeDir, raw });
  if (expanded.isErr()) {
    return undefined;
  }
  const pages = join(resolve(home), "pages");
  const path = normalize(expanded.value);
  const prefix = `${pages}/`;
  const suffix = `/${PAGE_FILENAME}`;
  if (!path.startsWith(prefix) || !path.endsWith(suffix)) {
    return undefined;
  }
  const slug = path.slice(prefix.length, path.length - suffix.length);
  if (!isValidPageSlug({ slug })) {
    return undefined;
  }
  return { address: join(pages, slug, PAGE_FILENAME), slug };
}

/**
 * The credential-path refusal a file read applies, judged on a page's address before the store is opened. A home
 * inside `~/.ssh` would otherwise read its pages out of the store where the same file off disk is refused. There
 * is no file, so the inode rules (`./storeLinks.ts`) have nothing to check; the hatch lifts this exactly as it lifts a
 * file's.
 *
 * @param path the page's address
 * @param policy what is refused
 * @returns the refusal, or nothing when the address may be read
 */
export function heldPageRefusal({
  path,
  policy,
}: {
  path: string;
  policy: LocalReadPolicy;
}): PathRefusedError | undefined {
  if (policy.refusalsLifted) {
    return undefined;
  }
  const rule = refusalFor({ paths: [path], stores: policy.stores });
  if (rule === undefined) {
    return undefined;
  }
  return LocalFileErrors.refused({ path, rule });
}

/**
 * One window of a held page's document: its masked text with its outline, or its masked words.
 *
 * @param bytes the document the store returned, verified against its digest
 * @param path the page's address, what the read and every refusal name
 * @param from the byte offset to start at — into the WORDS when `words` is set
 * @param budget the most bytes one window carries
 * @param words whether to read the page as its words rather than its markup
 * @param denylist the owner's private secret strings, masked wherever they appear
 * @returns the window, or the whole picture when its first bytes name one, or the one reason it could not be read
 */
export function readHeldPage({
  bytes,
  path,
  from,
  budget,
  words,
  denylist,
}: {
  bytes: Uint8Array;
  path: string;
  from: number;
  budget: number;
  words: boolean;
  denylist: readonly string[];
}): Result<LocalRead | LocalImageRead, LocalFileError> {
  if (words) {
    const markup = heldWindow({ budget: PAGE_WORDS_SOURCE_MAX_BYTES, bytes, denylist, from: 0, path });
    return pageWordsOf({ budget, denylist, from, markup });
  }
  return heldWindow({ budget, bytes, denylist, from, path });
}

/** One masked window of held bytes, or the whole picture they are, judged in the order a file's read judges them. */
function heldWindow({
  bytes,
  path,
  from,
  budget,
  denylist,
}: {
  bytes: Uint8Array;
  path: string;
  from: number;
  budget: number;
  denylist: readonly string[];
}): Result<LocalRead | LocalImageRead, LocalFileError> {
  const planned = readWindow({ budget, from, size: bytes.byteLength });
  if (planned.isErr()) {
    return err(TalkErrors.windowInvalid({ from, size: bytes.byteLength }));
  }
  const mediaType = sniffImage({ head: bytes.subarray(0, IMAGE_SNIFF_BYTES) });
  if (mediaType !== undefined) {
    return readHeldImage({ bytes, from, mediaType, path });
  }
  return readHeldText({ bytes, denylist, path, planned: planned.value });
}
