/**
 * A served page's document says which version it is to the viewer framing it, because the viewer cannot read that off
 * the frame. The frame is an opaque origin (`./localPageServe.ts`'s `PAGE_CSP` sandbox has no `allow-same-origin`), so
 * its location, and any redirect it followed, are hidden from its parent. `postMessage` crosses that boundary by
 * design: the viewer (`../components/console/NewerVersion.tsx`) takes a report only from its own frame's window, so the
 * version it compares republishes against is the one actually on screen, whichever answer the store served it from.
 *
 * The document reports once when its appended script runs, and again whenever its parent asks, so neither order of
 * the frame loading and the viewer hydrating loses the report. A page's own script could post a report too, and the
 * worst it can do is show or hide this button for its own page.
 *
 * Pure: bytes in, bytes out. Added at serve time only, after `./framedLinks.ts`'s link script, so the stored bytes are
 * unchanged.
 */
import { PAGE_VERSION_ASK, PAGE_VERSION_REPORT } from "./pageVersionReply";

/**
 * The report script for one document, as JavaScript.
 *
 * @param slug the page the document belongs to, so a frame that went on to another local page is not taken for this one
 * @param version the document's version (`./pageVersion.ts`)
 * @returns the script, wrapped so none of its names becomes a global
 */
export function pageVersionReporter({ slug, version }: { slug: string; version: string }): string {
  // `<` escaped, so no value can close the element it is served in.
  const report = JSON.stringify({ kind: PAGE_VERSION_REPORT, slug, version }).replaceAll("<", "\\u003c");
  return (
    "(()=>{" +
    "if(window.parent===window)return;" +
    `const report=()=>window.parent.postMessage(${report},"*");` +
    `window.addEventListener("message",(event)=>{if(event.source===window.parent&&event.data!==null&&typeof event.data==="object"&&event.data.kind===${JSON.stringify(PAGE_VERSION_ASK)})report();});` +
    "report();" +
    "})();"
  );
}

/**
 * {@link pageVersionReporter} as the inline element a served document carries.
 *
 * @param slug the page the document belongs to
 * @param version the document's version
 * @returns the element
 */
export function versionReportElement({ slug, version }: { slug: string; version: string }): string {
  return `<script data-sw-page-version>${pageVersionReporter({ slug, version })}</script>`;
}

/**
 * The served document with its version report after its last byte, as `./framedLinks.ts` appends its own.
 *
 * @param body the document about to be served
 * @param slug the page it belongs to
 * @returns the same bytes, then the report's element
 */
export function withVersionReport({
  body,
  slug,
  version,
}: {
  body: Uint8Array;
  slug: string;
  version: string;
}): Buffer {
  return Buffer.concat([body, Buffer.from(versionReportElement({ slug, version }), "utf8")]);
}
