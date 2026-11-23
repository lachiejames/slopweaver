/**
 * The `notion page` dry-run previews: what a create, update or move WOULD send, printed before any token,
 * door record or network call. Pure; split from `pageCore.ts`, which keeps parsing and the outcome vocabulary.
 */
import { bodyPreviewLines } from "../../../outbound/notion/markdownBody.js";
import { intentDigest } from "../../../outbound/notion/pageLedger.js";
import { mediaPreviewLines } from "./mediaCore.js";
import type { NotionPageArgs } from "./pageCore.js";
import { previewAddress } from "./previewAddress.js";

/** How many body lines a dry run prints before summarising the rest. */
const PREVIEW_LINES = 40;

/**
 * The one dry-run line that differs by sub-command: a create's intent digest, or what an update replaces.
 *
 * `title!` is honest rather than defensive. `parseNotionPageArgs` REFUSES a create without a title, so a
 * fallback here would only ever hide a parser regression behind a plausible-looking digest.
 */
function intentLine({
  args,
  body,
  parentPageId,
}: {
  args: NotionPageArgs;
  body: string;
  parentPageId: string | undefined;
}): readonly string[] {
  if (args.verb !== "create") {
    return ["note:      update REPLACES the page's whole content in place; the page id and URL are kept"];
  }
  if (parentPageId === undefined) {
    return ["intent:    (not computed — the parent address did not resolve)"];
  }
  const digest = intentDigest({ body, parentPageId, title: args.title! });
  return [`intent:    ${digest}  (a retry of this exact intent is refused as a duplicate)`];
}

/**
 * What a page write does with a title or icon the invocation leaves out, in the words the preview prints: an
 * update keeps the page's existing title, and a page written with no `--icon` carries none.
 */
const PAGE_UNSET_PREVIEW = { icon: "(none)", title: "(unchanged)" } as const;

/** The `--title` or `--icon` a write would send, or what leaving it out means. */
function pageFieldPreview({ args, key }: { args: NotionPageArgs; key: keyof typeof PAGE_UNSET_PREVIEW }): string {
  const value = args[key];
  if (value === undefined) {
    return PAGE_UNSET_PREVIEW[key];
  }
  return value;
}

/**
 * The dry-run preview for a move: what is being re-parented, and where to.
 *
 * A move sends no bytes, so there is nothing to preview but the two addresses — and the one consequence a
 * reader has to weigh before allowing it, which is that Notion inherits permissions from the parent and the
 * page's audience therefore becomes the destination's audience.
 *
 * @param args the parsed invocation
 * @param pageId the resolved subject page id, or undefined when its address did not resolve
 * @param parentPageId the resolved destination parent id, or undefined when its address did not resolve
 * @returns the operator-facing lines
 */
export function notionMoveDryRunLines({
  args,
  pageId,
  parentPageId,
}: {
  args: NotionPageArgs;
  pageId: string | undefined;
  parentPageId: string | undefined;
}): readonly string[] {
  return [
    `action:    ${args.verb}`,
    `page:      ${previewAddress({ resolved: pageId, typed: args.page })}`,
    `to:        ${previewAddress({ resolved: parentPageId, typed: args.to })}`,
    "note:      a move keeps the page id, the URL and every block; nothing inside the page is sent or replaced",
    "note:      Notion inherits page permissions from the parent, so whoever can see the destination can see " +
      "this page afterwards",
  ];
}

/**
 * The dry-run preview: the exact destination, the intent digest, and the bytes that would be sent.
 *
 * @param args the parsed invocation
 * @param parentPageId the resolved parent page id, or undefined for an update
 * @param body the markdown that would be sent, verbatim
 * @returns the operator-facing lines
 */
export function notionPageDryRunLines({
  args,
  parentPageId,
  body,
}: {
  args: NotionPageArgs;
  parentPageId: string | undefined;
  body: string;
}): readonly string[] {
  return [
    `action:    ${args.verb}`,
    args.verb === "create"
      ? `parent:    ${previewAddress({ resolved: parentPageId, typed: undefined })}`
      : `page:      ${previewAddress({ resolved: undefined, typed: args.page })}`,
    `title:     ${pageFieldPreview({ args, key: "title" })}`,
    `icon:      ${pageFieldPreview({ args, key: "icon" })}`,
    ...intentLine({ args, body, parentPageId }),
    `body:      ${String(Buffer.byteLength(body, "utf8"))} bytes, converted to blocks by Notion itself`,
    ...mediaPreviewLines({ body }),
    "--- markdown ---",
    ...bodyPreviewLines({ lines: PREVIEW_LINES, markdown: body }),
    "--- end ---",
  ];
}
