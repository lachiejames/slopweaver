/**
 * A published page's own `<title>`, so the messenger band names the page the owner has open rather than the word "Page".
 * The document is read from the store over the same seams the page route serves it by (`./localPageServe.ts`), so the
 * frame's own request for it reuses this ask, and only its opening is searched: its head is at the top.
 */
import { type SignedBodyFetch, verifiedBody } from "./localPageServe";
import type { PresentationRead } from "./pagePresentation";

/** How much of a published page is read for its title. A page's `<title>` sits in its head, well inside this. */
const TITLE_READ_BYTES = 64 * 1024;

/** The longest title carried. */
const TITLE_MAX_CHARS = 200;

/** The named entities a title is written with. */
const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

/** One numeric entity, or the text unchanged for a code point that names no character. */
function codePoint({ code, raw }: { code: number; raw: string }): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw;
}

/** A title with its HTML entities decoded. Run once, so `&amp;lt;` stays the text `&lt;`. */
function decoded({ text }: { text: string }): string {
  return text.replaceAll(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu, (raw, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return codePoint({ code: Number.parseInt(body.slice(2), 16), raw });
    }
    if (body.startsWith("#")) {
      return codePoint({ code: Number.parseInt(body.slice(1), 10), raw });
    }
    const named = NAMED_ENTITIES.get(body.toLowerCase());
    if (named === undefined) {
      return raw;
    }
    return named;
  });
}

/**
 * The first `<title>` in the opening of a page, as one bounded line.
 *
 * @param html the opening of the document
 * @returns the title, or `undefined` for a page with none or an empty one
 */
export function publishedTitleOf({ html }: { html: string }): string | undefined {
  const inner = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title\s*>/iu.exec(html)?.[1];
  if (inner === undefined) {
    return undefined;
  }
  const line = decoded({ text: inner }).replaceAll(/\s+/gu, " ").trim().slice(0, TITLE_MAX_CHARS).trimEnd();
  return line === "" ? undefined : line;
}

/**
 * The title of one published page, from the presentation the viewer already read — the same read that names the
 * version it shows (`./pageVersion.ts`), so the title and that version describe one page.
 *
 * @param read what the store said the page serves, asked fresh by the viewer
 * @param fetchBody fetches one signed address's bytes
 * @returns the page's title, or `undefined` when the page has none or the store could not show it, since the band then
 *   says "Page" and the frame below says why
 */
export async function publishedPageTitle({
  read,
  fetchBody,
}: {
  read: PresentationRead;
  fetchBody: SignedBodyFetch;
}): Promise<string | undefined> {
  const document = read.kind === "page" ? read.files.get("index.html") : undefined;
  if (document === undefined) {
    return undefined;
  }
  const body = await verifiedBody({ fetchBody, file: document });
  if (body === undefined) {
    return undefined;
  }
  return publishedTitleOf({ html: Buffer.from(body.subarray(0, TITLE_READ_BYTES)).toString("utf8") });
}
