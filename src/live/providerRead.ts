/**
 * The common document returned by every named live-provider read.
 *
 * This is deliberately smaller than a provider object schema. GitHub, Linear and Notion own their payload
 * shapes and change them independently; Slopweaver owns the claims around those bytes: where they came from,
 * when they were read, what address was resolved and what the read withheld. Keeping `data` unknown prevents
 * a generic wrapper from pretending it understands a provider-specific object it only transports.
 */
import type { RegisteredIntegration } from "../integrations/registry.js";
import { isRecord } from "../lib/parsers.js";
import type { PdfAttachment } from "../pdf/attachment.js";
import { GLYPHLESS_LINE } from "../pdf/limits.js";

/**
 * A provider served by the SHARED `<provider> read` reader — one parser, one dispatch: every integration whose
 * manifest says `sharedRead`. A type-only import, so this module never loads the registry; a new member fails to
 * compile at every total record keyed by it (`PROVIDER_READ_FLAG_NAMES`) until it has its rows.
 */
export type ProviderReadSource = Extract<RegisteredIntegration, { readonly sharedRead: true }>["id"];

/**
 * Every source that can produce a {@link ProviderReadDocument}.
 *
 * Wider than {@link ProviderReadSource} on purpose. The three Google doors reuse this document shape — the
 * freshness, the bounded coverage, the residue — but not the shared reader: a mailbox is addressed by query
 * and by message id, a Drive by query and by file id, and an event by a calendar and an id within it, rather
 * than by object URL, so each has its own verbs and its own flags. Widening the reader's own union to include them would force rows of flags into
 * `PROVIDER_READ_FLAG_NAMES` for parsers that do not exist. They are also the sources whose payload is a
 * person's own correspondence and files rather than a work artifact, which is why residue matters more on
 * them than anywhere else — see `src/live/gmail/read.ts` and `src/live/drive/read.ts`.
 */
type ProviderReadDocumentSource = ProviderReadSource | "gmail" | "drive" | "calendar";

/** The object address Slopweaver resolved before it touched a credential or network. */
export interface ProviderReadTarget {
  readonly address: string;
  readonly kind: string;
  readonly identity: string;
}

/** What the typed reader did and did not establish. */
interface ProviderReadCoverage {
  readonly kind: "bounded";
  readonly detail: string;
  readonly residue: readonly string[];
}

/**
 * One file the payload ADDRESSED, and what its bytes turned out to be.
 *
 * This belongs on the wrapper rather than inside `data` for the reason the file header gives: an extraction
 * is a claim about what an address in the payload resolved to, which is Slopweaver's to make, while `data`
 * stays the provider's own bytes and stays `unknown`.
 *
 * Four arms because they are four different claims, and collapsing any two loses the one thing a reader
 * needs. A document that is not a PDF is a FACT, not a failure. Bytes that arrived and would not parse must
 * still report that they arrived — `src/live/slack/readFile.ts` answered `err` there and threw away a
 * download that had succeeded, found by review. And a glyphless scan lives inside
 * {@link PdfAttachment}, which already refuses to report one as an empty document.
 *
 * `PdfAttachment` is imported as a TYPE only, deliberately: `src/pdf/attachment.ts` reaches `pdfjs-dist`,
 * and a value import here would drag a PDF engine onto the load path of every read — the same hazard
 * `src/pdf/limits.ts`'s header exists to keep off `slopweaver --help`.
 */
export type ProviderReadAttachment =
  | { readonly outcome: "read"; readonly url: string; readonly bytes: number; readonly pdf: PdfAttachment }
  | { readonly outcome: "not-a-document"; readonly url: string; readonly bytes: number }
  | { readonly outcome: "unreadable"; readonly url: string; readonly bytes: number; readonly reason: string }
  | { readonly outcome: "unfetched"; readonly url: string; readonly reason: string };

/**
 * One picture or video the body embedded, downloaded to a file the caller named the directory of.
 *
 * Separate from {@link ProviderReadAttachment} because it is a different claim: that list says what an
 * addressed document READ as, this one says which bytes now sit on disk and where. It never carries the
 * address the bytes came from — a private attachment's address is signed, and the token in it is a credential
 * for as long as it lives.
 */
export interface ProviderReadMedia {
  readonly kind: "image" | "video";
  /** The file name written, numbered by position in the body. */
  readonly name: string;
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** A current provider result with non-optional freshness and coverage. */
export interface ProviderReadDocument {
  readonly source: ProviderReadDocumentSource;
  readonly readAtIso: string;
  readonly target: ProviderReadTarget;
  /**
   * The files this read opened, absent when none were asked for. Absent and EMPTY are different answers —
   * "nobody asked" against "asked, and the payload addressed none" — so this is optional rather than
   * defaulting to `[]`.
   */
  readonly attachments?: readonly ProviderReadAttachment[];
  /** The pictures and videos written to disk, absent when none were asked for, EMPTY when the body held none. */
  readonly media?: readonly ProviderReadMedia[];
  readonly coverage: ProviderReadCoverage;
  readonly data: unknown;
}

/**
 * Render a document as stable, pretty JSON.
 *
 * @param document the live provider document
 * @returns one JSON document, with a trailing newline supplied by the logger rather than embedded here
 */
export function renderProviderReadJson({ document }: { document: ProviderReadDocument }): string {
  return JSON.stringify(document, undefined, 2);
}

/**
 * Render a compact human header followed by the exact provider payload as JSON.
 *
 * @param document the live provider document
 * @returns text that keeps freshness and coverage above the payload
 */
export function renderProviderReadText({ document }: { document: ProviderReadDocument }): string {
  const residue = document.coverage.residue.length === 0 ? "none" : document.coverage.residue.join("; ");
  return [
    `${document.source} ${document.target.kind}: ${document.target.identity}`,
    `read at: ${document.readAtIso}`,
    `coverage: ${document.coverage.kind} — ${document.coverage.detail}`,
    `residue: ${residue}`,
    ...attachmentLines({ attachments: document.attachments }),
    ...mediaLines({ media: document.media }),
    "",
    JSON.stringify(document.data, undefined, 2),
  ].join("\n");
}

/** The media block: one line per file written, so the path a caller attaches is on the default output. */
function mediaLines({ media }: { media: readonly ProviderReadMedia[] | undefined }): readonly string[] {
  if (media === undefined) {
    return [];
  }
  if (media.length === 0) {
    return ["media: none embedded in this body"];
  }
  return [
    `media: ${String(media.length)}`,
    ...media.map((file) => `  ${file.path} — ${file.kind}, ${String(file.bytes)} bytes, sha256 ${file.sha256}`),
  ];
}

/** One line for one opened file, saying what it turned out to be. */
function attachmentLine({ attachment }: { attachment: ProviderReadAttachment }): string {
  if (attachment.outcome === "unfetched") {
    return `  ${attachment.url} — not fetched: ${attachment.reason}`;
  }
  if (attachment.outcome === "not-a-document") {
    return `  ${attachment.url} — ${String(attachment.bytes)} bytes, not a PDF`;
  }
  if (attachment.outcome === "unreadable") {
    return `  ${attachment.url} — ${String(attachment.bytes)} bytes retrieved, text not: ${attachment.reason}`;
  }
  const { glyphless, pages, pagesRead } = attachment.pdf;
  if (glyphless) {
    return `  ${attachment.url} — ${String(pages)} page(s), ${GLYPHLESS_LINE}`;
  }
  return `  ${attachment.url} — ${String(pagesRead)}/${String(pages)} page(s) read`;
}

/**
 * The attachment block, above the payload.
 *
 * Rendered at all because the default output is the one a reader actually sees: a field added to the
 * document and not to this function is bytes fetched whose words never reach anyone, which is the exact
 * defect fixed on the Slack side. The extracted TEXT follows the block rather than sitting inside a
 * line, so a multi-page document does not wrap one line past the terminal.
 */
function attachmentLines({
  attachments,
}: {
  attachments: readonly ProviderReadAttachment[] | undefined;
}): readonly string[] {
  if (attachments === undefined) {
    return [];
  }
  if (attachments.length === 0) {
    return ["attachments: none addressed by this payload"];
  }
  const lines = [`attachments: ${String(attachments.length)}`];
  for (const attachment of attachments) {
    lines.push(attachmentLine({ attachment }));
  }
  for (const attachment of attachments) {
    if (attachment.outcome === "read" && attachment.pdf.text !== undefined) {
      lines.push("", `--- ${attachment.url} ---`, attachment.pdf.text);
    }
  }
  return lines;
}

/**
 * Collect the JSON paths of every connection in a raw provider response that says another page exists —
 * the source of a document's {@link ProviderReadCoverage.residue}. Shared by every named-object reader
 * (GitHub, Linear) that walks a GraphQL response for an unread `pageInfo.hasNextPage` OR
 * `pageInfo.hasPreviousPage` — a connection queried with `last` (GitHub's PR `reviews`, so its newest
 * entries land in the capped page rather than its oldest) reports truncation on the latter, never the
 * former.
 *
 * @param value the raw (sub)value being walked
 * @param path the dotted/indexed path to `value` from the response root, `""` at the root itself
 * @param out the accumulator every found residue line is pushed onto
 */
export function collectPaginationResidue({ value, path, out }: { value: unknown; path: string; out: string[] }): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      collectPaginationResidue({ out, path: `${path}[${String(index)}]`, value: item });
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  const pageInfo = value["pageInfo"];
  if (isRecord(pageInfo) && (pageInfo["hasNextPage"] === true || pageInfo["hasPreviousPage"] === true)) {
    out.push(`${path.length === 0 ? "result" : path} has another provider page`);
  }
  for (const [key, child] of Object.entries(value)) {
    collectPaginationResidue({ out, path: path.length === 0 ? key : `${path}.${key}`, value: child });
  }
}
