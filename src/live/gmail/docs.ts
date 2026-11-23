/**
 * Reading the Google Doc a Gemini meeting-notes email links to.
 *
 * ## Why this lives under `live/gmail` rather than in a `live/google-docs` of its own
 *
 * It is not a second door. Nothing here is reachable except from the mail lane: the ONLY way a document id
 * enters this module is by being the link inside a message the Gemini recogniser already matched, and the
 * credential it reads with is the same `gmail connect` grant. Giving it its own noun would advertise a
 * capability the program does not have — "read any Google Doc" — when what it actually has is "follow the
 * link in a meeting-notes email". The scope reflects that too: `documents.readonly` reads a document by id
 * and cannot list a Drive, so an id this module was never handed is one it cannot find.
 *
 * ## The tabs are the whole reason this is not one call and a `.join()`
 *
 * A Meet notes document is TABBED. Measured on a real one: the notes email's link carries a `tab=t.…`
 * fragment, and the document holds a summary tab and a transcript tab as separate `Tab` resources. The
 * Docs API returns only the first tab unless `includeTabsContent` is set, so the obvious call — `get` with
 * the id — returns the summary and silently omits the transcript, which is exactly the content the ingest
 * exists to capture. Nested tabs are walked too, because `childTabs` is part of the resource and a document
 * that used them would otherwise lose whole sections with no error anywhere.
 *
 * ## What a paragraph becomes
 *
 * Text is lifted from `paragraph.elements[].textRun.content` and from every table cell, in document order,
 * with one line per structural element. Everything else a document can hold — inline images, equations,
 * footnote references, positioned objects — carries no text and is dropped. A transcript is prose, so this
 * loses nothing real, and stating the omission is better than a reader assuming an image's alt text is in
 * there.
 */
import { docs, type docs_v1 } from "@googleapis/docs";
import type { OAuth2Client } from "googleapis-common";

import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import type { Result } from "../../lib/result.js";
import { type GmailError, GmailErrors } from "./errors.js";

/**
 * How deep the tab walk descends.
 *
 * A bound rather than a budget: Meet's own notes documents are flat, so any nesting at all is a document a
 * person built by hand, and a malformed `childTabs` cycle must not be able to spin this walk forever.
 */
const MAX_TAB_DEPTH = 8;

/** One tab's readable text, with the title the document gave it. */
interface DocTab {
  /** The tab's own title, as the document names it — `Summary`, `Transcript`. */
  readonly title: string | undefined;
  /** The tab's text, one line per structural element, in document order. */
  readonly text: string;
}

/** One Google Doc, reduced to what a transcript record needs. */
export interface DocContent {
  readonly documentId: string;
  readonly title: string | undefined;
  readonly tabs: readonly DocTab[];
}

/** The Docs call the mail lane makes. Injected, so the transcript projection needs no network. */
export interface GoogleDocsApi {
  readonly getDocument: (args: { documentId: string }) => Promise<Result<DocContent, GmailError>>;
}

/**
 * The document id inside a Google Docs URL, when the URL names one.
 *
 * Matched with a bounded character class, so the pattern has one way to match at each position and cannot
 * backtrack — the same requirement every pattern run over mail-derived text carries here. Pure.
 *
 * @param url the link target, from a message's HTML part
 * @returns the document id, or undefined when the URL is not a Google Doc
 */
export function docIdFromUrl({ url }: { url: string }): string | undefined {
  const match = /^https:\/\/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]+)/.exec(url);
  return match?.[1];
}

/**
 * The runs of one paragraph. The API omits `elements` from a paragraph that holds nothing — an empty line
 * between two blocks of a transcript — so a missing list is a paragraph with no text.
 */
function paragraphElements({ paragraph }: { paragraph: docs_v1.Schema$Paragraph }): docs_v1.Schema$ParagraphElement[] {
  const { elements } = paragraph;
  if (elements == null) {
    return [];
  }
  return elements;
}

/**
 * The structural elements inside one container — a tab's or a document's `Body`, or a table cell. The API
 * omits `content` from a container with nothing in it, so a missing list is an empty body or an empty cell.
 */
function containerContent({
  container,
}: {
  container: docs_v1.Schema$Body | docs_v1.Schema$TableCell;
}): docs_v1.Schema$StructuralElement[] {
  const { content } = container;
  if (content == null) {
    return [];
  }
  return content;
}

/** The rows of one table. A table the API returned with no `tableRows` key has no rows to read text from. */
function tableRows({ table }: { table: docs_v1.Schema$Table }): docs_v1.Schema$TableRow[] {
  const rows = table.tableRows;
  if (rows == null) {
    return [];
  }
  return rows;
}

/** The cells of one table row. A row the API returned with no `tableCells` key has no cell to read. */
function rowCells({ row }: { row: docs_v1.Schema$TableRow }): docs_v1.Schema$TableCell[] {
  const cells = row.tableCells;
  if (cells == null) {
    return [];
  }
  return cells;
}

/** The text of one paragraph, joined from its runs. */
function paragraphText({ paragraph }: { paragraph: docs_v1.Schema$Paragraph }): string {
  return paragraphElements({ paragraph })
    .flatMap((element) => {
      const content = element.textRun?.content;
      // An element with no `textRun` is an inline image, an equation or a footnote reference — it carries
      // no text at all, so it contributes NOTHING rather than an empty string standing in for one.
      return typeof content === "string" ? [content] : [];
    })
    .join("")
    .replace(/\s+$/u, "");
}

/**
 * Every line of text in a run of structural elements, descending into table cells.
 *
 * Positional because `Array.prototype.flatMap` dictates the signature, and typed from the SDK's own
 * resource shape rather than restated.
 */
function elementLines(element: docs_v1.Schema$StructuralElement): readonly string[] {
  if (element.paragraph != null) {
    return [paragraphText({ paragraph: element.paragraph })];
  }
  if (element.table != null) {
    return tableRows({ table: element.table }).flatMap((row) =>
      rowCells({ row }).flatMap((cell) => containerContent({ container: cell }).flatMap(elementLines)),
    );
  }
  return [];
}

/**
 * The tabs nested under one tab. Nesting is something a person builds by hand — Meet's own notes documents
 * are flat — and the API omits `childTabs` from a tab that has none, so a missing list is a tab with no
 * children.
 */
function childTabsOf({ tab }: { tab: docs_v1.Schema$Tab }): readonly docs_v1.Schema$Tab[] {
  const { childTabs } = tab;
  if (childTabs == null) {
    return [];
  }
  return childTabs;
}

/**
 * The top-level tabs of one document. A document in the pre-tabs shape the API still returns for some
 * documents carries no `tabs` at all, and {@link reduceDocument} reads its `body` instead — so a missing list
 * is that shape, not an empty document.
 */
function documentTabs({ document }: { document: docs_v1.Schema$Document }): readonly docs_v1.Schema$Tab[] {
  const { tabs } = document;
  if (tabs == null) {
    return [];
  }
  return tabs;
}

/**
 * The body content of one tab, each level of the path read on its own. `documentTab` is the tab's document
 * payload, and the API sets it only on a tab of that kind, so a tab without one has no body to read. A
 * document tab whose `body` is omitted holds nothing either, and a body with no `content` is an empty body
 * ({@link containerContent}). Every level is read without ever substituting another level's value.
 */
function tabContent({ tab }: { tab: docs_v1.Schema$Tab }): docs_v1.Schema$StructuralElement[] {
  const { documentTab } = tab;
  if (documentTab == null) {
    return [];
  }
  const { body } = documentTab;
  if (body == null) {
    return [];
  }
  return containerContent({ container: body });
}

/** The content of a document in the pre-tabs shape. A document whose `body` is omitted holds no text. */
function untabbedContent({ document }: { document: docs_v1.Schema$Document }): docs_v1.Schema$StructuralElement[] {
  const { body } = document;
  if (body == null) {
    return [];
  }
  return containerContent({ container: body });
}

/**
 * One tab's own title. `tabProperties` and its `title` are separately optional in the API's schema, so each is
 * read on its own; either one missing is a tab the document does not name, which {@link DocTab.title} carries
 * as `undefined` rather than as an invented label.
 */
function tabTitle({ tab }: { tab: docs_v1.Schema$Tab }): string | undefined {
  const { tabProperties } = tab;
  if (tabProperties == null) {
    return undefined;
  }
  const { title } = tabProperties;
  if (title == null) {
    return undefined;
  }
  return title;
}

/** The document's own title. The API may omit it or send `null`; both are a document it did not name. */
function documentTitle({ document }: { document: docs_v1.Schema$Document }): string | undefined {
  const { title } = document;
  if (title == null) {
    return undefined;
  }
  return title;
}

/** One tab and every tab beneath it, flattened depth-first. */
function flattenTabs({ tabs, depth }: { tabs: readonly docs_v1.Schema$Tab[]; depth: number }): readonly DocTab[] {
  if (depth > MAX_TAB_DEPTH) {
    return [];
  }
  return tabs.flatMap((tab): readonly DocTab[] => [
    {
      text: tabContent({ tab })
        .flatMap(elementLines)
        .filter((line) => line.length > 0)
        .join("\n"),
      title: tabTitle({ tab }),
    },
    ...flattenTabs({ depth: depth + 1, tabs: childTabsOf({ tab }) }),
  ]);
}

/**
 * Reduce a Docs response to its tabs' text.
 *
 * A document with no `tabs` at all is the pre-tabs shape the API still returns for some documents, and its
 * `body` is treated as one untitled tab rather than as an empty document — the alternative is a transcript
 * that reads as blank with nothing anywhere saying why. Pure.
 *
 * @param document the document as the API returned it
 * @param documentId the id it was fetched by, carried through so a caller never re-derives it
 * @returns the reduced content
 */
export function reduceDocument({
  document,
  documentId,
}: {
  document: docs_v1.Schema$Document;
  documentId: string;
}): DocContent {
  const tabs = flattenTabs({ depth: 0, tabs: documentTabs({ document }) });
  const untabbed: readonly DocTab[] =
    tabs.length > 0
      ? []
      : [
          {
            text: untabbedContent({ document })
              .flatMap(elementLines)
              .filter((line) => line.length > 0)
              .join("\n"),
            title: undefined,
          },
        ];
  return { documentId, tabs: [...tabs, ...untabbed], title: documentTitle({ document }) };
}

/** Map a boundary failure into the mail domain's own union, carrying the cause. */
function toGmailError({ error }: { error: IngestError }): GmailError {
  return GmailErrors.apiFailed({ cause: error, message: error.message });
}

/**
 * Build the production Docs seam over the same auth client the Gmail grant already resolved.
 *
 * @param auth the OAuth client built from the stored Gmail grant
 * @param account the mailbox the grant bound to, hashed into the shared rate scope
 * @returns the seam the transcript lane calls
 */
export function makeGoogleDocsApi({ auth, account }: { auth: OAuth2Client; account: string }): GoogleDocsApi {
  const scopeId = scopeIdForToken({ token: account });
  const client = docs({ auth, version: "v1" });
  return {
    getDocument: async ({ documentId }) =>
      safeProviderCall({
        // `includeTabsContent` is load-bearing, not a nicety: without it the API returns the FIRST tab only,
        // and a Meet notes document keeps its transcript in a later one. The failure is silent — a valid
        // response, a plausible-looking summary, and no transcript.
        execute: () => client.documents.get({ documentId, includeTabsContent: true }),
        // Prefixed `gmail.` because the operation label's first segment names the PROVIDER, and this call runs
        // on the Gmail grant, the Gmail rate scope and the Gmail provider entry. A bare `docs.` label would
        // name a provider with no rate-limit entry at all, which `src/lib/rateLimits.ts` has no class for.
        operation: "gmail.docs.documents.get",
        provider: "gmail",
        retryMode: "transient",
        scopeId,
      })
        .map((response): DocContent => reduceDocument({ document: response.data, documentId }))
        .mapErr((error) => toGmailError({ error })),
  };
}
