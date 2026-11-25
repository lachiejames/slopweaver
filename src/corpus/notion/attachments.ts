/**
 * Deciding what an attachment reference IS, before anything considers fetching its bytes.
 *
 * Pure: no client, no filesystem, no clock. The effectful half takes these verdicts and acts on them.
 *
 * ## Why a classifier exists at all, which is the finding this module was built from
 *
 * MEASURED across the whole Notion bronze corpus, the file references split three ways and the
 * SPLIT is the point rather than any total. Most are not urls at all, reading `file: <name>.pdf`. The next
 * largest group is EXTERNAL third-party urls — a video host, a course platform, a social site, a drive, a
 * whiteboard. A small remainder are `notion.so` urls, and the sampled one is a page ICON.
 *
 * The cause is in this connector's own code rather than inferred: `curated.ts#stableFileUrl` keeps ONLY an
 * author-provided `external`/`embed` url and never the Notion-hosted one, because that url is signed and
 * expires.
 *
 * So the corpus holds urls for exactly the files that must NOT be downloaded, and names only for the ones
 * that should be. Two consequences follow, and both are enforced here rather than left to a caller's memory:
 *
 * - **A stored reference is never a fetch plan.** The signed url exists only in the response being read right
 *   now, and it EXPIRES — the block json carries an `expiry_time` about an hour out. So the ceiling is
 *   applied at FETCH time against what a ranged probe reports, never against anything on disk.
 *   {@link classifyAttachment} takes a url from a live read for that reason.
 * - **An author's link to somebody else's site is not an attachment.** The requirement is the full page,
 *   attachments on it included. A video-host or social link on a page is that site's content, and
 *   fetching it would be third-party egress nobody asked for, so it is classified `external` and left alone.
 *
 * Reproduce the split over any corpus:
 *
 * ```sh
 * grep -ho '"files":\[[^]]*\]' ~/.slopweaver/corpus/bronze/notion/*.jsonl \
 *   | grep -o 'https\?://[^"/]*' | sort | uniq -c | sort -rn
 * ```
 */
import { isRecord } from "../../lib/parsers.js";

/**
 * The block types that carry a file body.
 *
 * Notion's own vocabulary, and the whole of it — for a file sitting in a page's BODY. It is not the whole
 * of how a file reaches a page, and reading it that way is the measured defect below: a database row
 * carries files on its own `files` PROPERTIES, where no block exists at all. {@link filePropertyUrls} is
 * the other half.
 *
 * Both halves are typed reads rather than a walk over url-shaped strings, which is what the Linear reader
 * has to do: Linear's assets sit under four different field names across four object kinds, while a Notion
 * file is always `{ file: { url } }` or `{ external: { url } }` under a named key.
 */
const FILE_BLOCK_TYPES: ReadonlySet<string> = new Set(["audio", "file", "image", "pdf", "video"]);

/**
 * The signed url on one raw block, or undefined when it carries none. Pure.
 *
 * Lives here beside {@link classifyAttachment} rather than in whichever module happens to run a pass,
 * because both the corpus attachment walk and the live `notion read --pdf` lane need exactly this shape,
 * and a second copy of it is the class `src/pdf/attachment.ts`'s header names — four doors, four chances
 * to differ.
 *
 * @param block one raw block object exactly as `blocks.children.list` returned it
 * @returns the url Notion signed for this read, or undefined when the block carries no file body
 */
export function signedUrlOf({ block }: { block: Record<string, unknown> }): string | undefined {
  const type = typeof block["type"] === "string" ? block["type"] : undefined;
  if (type === undefined || !FILE_BLOCK_TYPES.has(type)) {
    return undefined;
  }
  const body = block[type];
  if (!isRecord(body)) {
    return undefined;
  }
  const file = body["file"];
  if (!isRecord(file)) {
    return undefined;
  }
  return typeof file["url"] === "string" ? file["url"] : undefined;
}

/** The url one entry of a `files` property carries, whether Notion hosts it or an author linked it. */
function fileEntryUrl({ entry }: { entry: unknown }): string | undefined {
  if (!isRecord(entry)) {
    return undefined;
  }
  for (const key of ["file", "external"]) {
    const body = entry[key];
    if (isRecord(body) && typeof body["url"] === "string") {
      return body["url"];
    }
  }
  return undefined;
}

/**
 * Every url a page's own `files` PROPERTIES carry, in the order Notion returned the properties. Pure.
 *
 * ## The measurement that put this here
 *
 * The first `notion read --pdf` planner read file BLOCKS alone, on this module's own claim that a file
 * reaches a page by being one of five block types "and never by any other means". That claim was false for
 * almost every real file in the workspace. MEASURED over the 40 first pdf-bearing pages the
 * bronze corpus names, reproduce with:
 *
 * ```sh
 * grep -h '\.pdf?X-Amz' ~/.slopweaver/corpus/bronze/notion/*.jsonl \
 *   | grep -o '"sourceId":"page:[0-9a-f-]*' | sed 's/.*page://' | sort -u | head -40 \
 *   | while read -r id; do slopweaver notion read "$id" --pdf --limit 100 | grep '^attachments:'; done
 * ```
 *
 * The block-only planner opened a file on **1 of the 40**, and that one was a png. The other 39 carry
 * their PDF on a `files` property of a database row — a CV, a signed form — where the page has
 * no blocks at all. A verb shipped on the block half alone would have answered "none addressed by this
 * payload" for every PDF anybody actually has.
 *
 * A page's `cover` and `icon` are deliberately not read: both are chrome rather than an attachment, and
 * this module's own header records that the one sampled `notion.so` url in the corpus was a page icon.
 *
 * @param page one raw page object exactly as `pages.retrieve` returned it
 * @returns every url its `files` properties address, un-classified — {@link classifyAttachment} judges them
 */
export function filePropertyUrls({ page }: { page: Record<string, unknown> }): readonly string[] {
  const properties = page["properties"];
  if (!isRecord(properties)) {
    return [];
  }
  const urls: string[] = [];
  for (const property of Object.values(properties)) {
    if (!isRecord(property) || property["type"] !== "files") {
      continue;
    }
    const files = property["files"];
    if (!Array.isArray(files)) {
      continue;
    }
    for (const entry of files) {
      const url = fileEntryUrl({ entry });
      if (url !== undefined) {
        urls.push(url);
      }
    }
  }
  return urls;
}

/**
 * The hosts a Notion-hosted attachment is served from.
 *
 * `prod-files-secure.s3.*` and `s3.*.amazonaws.com` are where Notion's own signed file urls point;
 * `notion.so` / `notionusercontent.com` serve icons and some inline media. Matched on the host SUFFIX so a
 * lookalike domain (`notion.so.evil.test`) cannot pass, which a substring test would have allowed.
 */
const NOTION_FILE_HOST_SUFFIXES: readonly string[] = [
  "amazonaws.com",
  "notion-static.com",
  "notion.so",
  "notionusercontent.com",
];

/**
 * The per-file ceiling, in bytes.
 *
 * MEASURED over **145 real attachments** sized across 150 of the 425 attachment-bearing pages in
 * the owner's workspace, using the same ranged probe the crawl uses. The distribution: median 1.51 MiB,
 * p90 5.86, p95 9.96, p99 21.17, max **31.97**, 342.3 MiB in total. PDFs are 90 of the 145, then png, mp3,
 * txt, wav, jpeg, docx, pptx.
 *
 * At this ceiling nothing in that sample is refused. 25 MiB would refuse one file, 10 MiB six, 5 MiB fifteen.
 * 100 MiB is chosen over the observed 32 MiB max for headroom rather than to hug the sample: a ceiling set at
 * the largest thing yet seen refuses the next thing that is merely slightly larger. It is still four orders
 * of magnitude below the owner's stated red line — a file the size of a terabyte is not downloaded — and
 * the other half of that ruling, that 99.999% of pages are wanted in full including its attachments, is what
 * rules out the tighter values.
 *
 * **The first survey would have given a worse number, which is why the sample size is stated.** The first 40
 * pages yielded only 23 files with a 0.083 MiB median and a 9.96 MiB max. A ceiling read off THAT would have
 * been 10 MiB, refusing 6 of the 145 files the wider survey found. Widening the sample changed the answer,
 * so a re-measure should widen it again rather than trust this one.
 *
 * Reproduce by walking attachment-bearing pages' file blocks and probing each signed url with
 * `Range: bytes=0-1023`, reading the total after the slash in `Content-Range`.
 */
export const NOTION_ATTACHMENT_CEILING_BYTES = 100 * 1024 * 1024;

/** What one attachment reference turns out to be. */
export type AttachmentVerdict =
  /** A Notion-hosted file whose signed url is live in the read that produced it. Fetchable, under a ceiling. */
  | { readonly kind: "hosted"; readonly url: string }
  /** An author's link to another site. Kept as a reference and never fetched. */
  | { readonly kind: "external"; readonly url: string }
  /** A reference with no url at all — the shape most stored refs already have. Nothing to fetch. */
  | { readonly kind: "nameOnly" };

/** Whether a host is, or is a subdomain of, one of Notion's file hosts. Pure. */
function isNotionFileHost({ host }: { host: string }): boolean {
  const lower = host.toLowerCase();
  return NOTION_FILE_HOST_SUFFIXES.some((suffix) => lower === suffix || lower.endsWith(`.${suffix}`));
}

/**
 * Classify one attachment reference taken from a LIVE read.
 *
 * @param src the `src` attribute of a media tag, or an author-provided url; anything unparseable as a url is
 *   `nameOnly`, which is also what a stored `file: <name>.pdf` reference resolves to
 * @returns what this reference is, and whether anything may fetch it
 */
export function classifyAttachment({ src }: { src: string | undefined }): AttachmentVerdict {
  if (src === undefined || src.length === 0) {
    return { kind: "nameOnly" };
  }
  let host: string;
  try {
    const parsed = new URL(src);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { kind: "nameOnly" };
    }
    host = parsed.hostname;
  } catch {
    return { kind: "nameOnly" };
  }
  return isNotionFileHost({ host }) ? { kind: "hosted", url: src } : { kind: "external", url: src };
}

/** What a fetch attempt concluded, whether or not any bytes moved. */
export type AttachmentOutcome =
  | { readonly kind: "fetched"; readonly bytes: number; readonly contentType: string | undefined }
  /** Refused after a one-kilobyte probe and BEFORE the file was read, on the total that probe reported. */
  | { readonly kind: "too-large"; readonly bytes: number }
  /** The probe reported no total, so the ceiling could not be enforced without reading the file first. */
  | { readonly kind: "size-unknown" }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Every outcome in which no bytes were kept.
 *
 * Named because a SIZING pass can only ever reach one of these, and saying so in the type is what stops a
 * caller having to handle a `fetched` a probe cannot produce.
 */
export type AttachmentRefusal = Exclude<AttachmentOutcome, { kind: "fetched" }>;

/**
 * Whether a declared size clears the ceiling, and what to conclude when there is no declared size. Pure.
 *
 * A missing total is deliberately NOT treated as "small enough to try". The whole point of the
 * ceiling is that this machine cannot be asked to hold a file it has no room for, and a fetch that has to
 * read the body before it can measure it has already spent whatever the file costs. So an undeclared size is
 * its own outcome rather than an optimistic fetch — the owner's words were that there should be some limits,
 * not that the limit should be attempted and abandoned.
 *
 * The boundary is INCLUSIVE: a file exactly on the ceiling is fetched. A ceiling nobody may reach is a
 * ceiling one byte lower, stated confusingly.
 *
 * @param declaredBytes the total the ranged probe reported, or undefined when it reported none
 * @param ceilingBytes the per-file ceiling this run is operating under
 * @returns the refusal to record, or undefined when the fetch may proceed
 */
export function ceilingVerdict({
  declaredBytes,
  ceilingBytes,
}: {
  declaredBytes: number | undefined;
  ceilingBytes: number;
}): AttachmentRefusal | undefined {
  if (declaredBytes === undefined) {
    return { kind: "size-unknown" };
  }
  if (declaredBytes > ceilingBytes) {
    return { kind: "too-large", bytes: declaredBytes };
  }
  return undefined;
}

/**
 * The TOTAL size a `Content-Range` header reports, as a number. Pure.
 *
 * `Content-Range: bytes 0-1023/272299` means "you asked for the first kilobyte of a 272,299-byte file", and
 * that trailing total is the only way this connector can learn an attachment's size.
 *
 * MEASURED against a real signed url, which is why the size is taken from here rather than from
 * a `Content-Length` on a HEAD: **HEAD returns 403.** Notion's signed S3 urls carry
 * `X-Amz-SignedHeaders` covering GET, so a HEAD falls outside the signature and object storage refuses it.
 * The same url answers `GET` with `Range: bytes=0-1023` with a 206 and the full size in this header. An
 * earlier draft of this module read `Content-Length` off a HEAD and would have classified every attachment
 * in the workspace as unfetchable.
 *
 * @param header the raw `Content-Range` value, or undefined when absent
 * @returns the total size, or undefined when absent, unparseable, or of unknown total (`bytes 0-1023/*`)
 */
export function totalFromContentRange({ header }: { header: string | null | undefined }): number | undefined {
  if (header === null || header === undefined) {
    return undefined;
  }
  const matched = /^bytes\s+\d+-\d+\/(\d+)$/i.exec(header.trim());
  const total = matched?.[1];
  if (total === undefined) {
    return undefined;
  }
  const parsed = Number(total);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * The fetchable source a Notion markdown media tag wraps, or undefined when it wraps none. Pure.
 *
 * MEASURED: `pages.retrieveMarkdown` does NOT put a url in a media tag's `src`. It puts
 * `file://` followed by a percent-encoded JSON envelope, and the envelope's `source` is either an
 * `attachment:<uuid>:<name>` handle carrying no url at all, or an UNSIGNED storage url that answers 403.
 * Across the attachment-richest pages of the real workspace the handles outnumbered the urls by more than
 * seventy to one, and the single url was refused.
 *
 * So this exists to say NO cheaply and honestly, rather than to find a fetch. The signed url lives only in
 * the BLOCK json, and that is where the fetch path takes it from.
 *
 * The envelope also carries a `permissionRecord` naming a space id and a block id. Those are internal
 * identifiers and nothing here returns or stores them.
 *
 * @param src the raw `src` attribute off a markdown media tag
 * @returns the wrapped source string, or undefined when the tag wraps nothing parseable
 */
export function markdownMediaSource({ src }: { src: string }): string | undefined {
  if (!src.startsWith("file://")) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(src.slice("file://".length)));
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const source = (parsed as { source?: unknown }).source;
    return typeof source === "string" ? source : undefined;
  } catch {
    return undefined;
  }
}
