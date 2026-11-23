/**
 * A link inside a served local page opens in a new tab, so the frame showing the page never navigates off it.
 *
 * A plain click on a link in a briefing page once showed a blank version of the same page instead of opening
 * Datadog in a new tab. A page's links carry no `target`, so in Chrome a plain click on one navigates the frame the
 * page is shown in — the viewer's (`../app/(console)/view/page.tsx`) or the Queue's preview modal — and Datadog,
 * refusing to be framed, left it white under the viewer's Back. The desktop app already sends such a navigation to
 * the owner's browser (`desktop/src/surface.ts`'s `frameNavigationDecision`); a browser tab has no shell to ask, and the
 * frame's page is an opaque origin its parent cannot reach into, so the page itself carries the rule.
 *
 * The rule, the browser's half of that decision: a plain click on a link with no `target` of its own, to an
 * `http(s)` address outside this console's `/api/page/` (this page's own `#` jumps, a file beside it and another
 * local page all stay in the frame), is given `target="_blank"` before the browser follows it. A
 * modified click, a `download` link, a link with a `target` of its own, a non-http scheme, a click the page already
 * handled, and a page opened as a tab of its own (the preview modal's "Open in a new tab") are left alone.
 * `<base target="_blank">` was the shorter fix and is wrong: it sends every in-page `#` jump to a new tab too.
 *
 * **A link to ANOTHER local page by its `file://` address is rewritten to this console's route first.** Neither a click nor a
 * command click on a link to another local page did anything, though it looked clickable. A page names
 * another by `file:///…/pages/<slug>/index.html`, and Chromium refuses to take an `http` document to a `file:`
 * address before any shell hook sees the navigation, so the click was simply dropped. On every activation — a plain
 * click, a modified one, a middle click (`auxclick`), and on a page opened as a tab of its own — such an `href` becomes
 * `/api/page/<slug>/index.html` with its query and fragment, before the rule above runs, so a plain click stays in the
 * frame and a ⌘-click opens it where a ⌘-click would. The address grammar is `./localPageHref.ts`'s
 * `localPageParts`, restated in the script because a served page cannot import it. It is rewritten at the GESTURE,
 * never on load, so a right-click's Copy Link, a context menu's Open Link and the status bar still see the `file://`
 * address until the link has been activated once.
 *
 * What this does NOT cover, because a listener in the page cannot: a page's own script setting `location` or
 * rewriting the `target` after this listener ran, a meta refresh, a `target="_self"` its author wrote, a handler that
 * stops the click reaching `document`, a click landing while the page is still parsing — before the appended script
 * has run, a window a page read off local disk keeps to milliseconds — a page whose own `<meta>` CSP
 * forbids inline script, which blocks this one with its own (no page on disk has one), and a link inside
 * a CLOSED shadow root, which `composedPath()` hides by design (no page on disk uses one), and a
 * malformed page whose bytes END inside an unclosed `<script>`, `<style>`, comment or tag, which swallows the appended
 * element as text (`slopweaver page publish` writes whole documents). Each can
 * still take the frame off the page in a browser tab; only the desktop shell's `will-frame-navigate` sees those.
 *
 * The script is the rule — there is no TypeScript copy of it to drift — and
 * `site/__tests__/unit/framedLinks.test.ts` runs this exact string against a fake document. It is served inline,
 * at the end of the document, which `./localPageServe.ts`'s `PAGE_CSP` allows (scripts run; nothing is fetched),
 * and it is added at serve time only: the bytes on disk, which a card mark or a correction compare reads, are
 * unchanged.
 *
 * Pure: bytes in, bytes out.
 */

/** The click listener every served page carries, as JavaScript, minified by hand so the served page stays small. */
export const FRAMED_LINK_LISTENER =
  // Wrapped so none of its names becomes a global a page's own script could collide with.
  "(()=>{" +
  "const pageSlug=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;" +
  "const unopenable=/%2f|%00|%0[1-9a-f]|%1[0-9a-f]/iu;" +
  'const linkOf=(event)=>event.composedPath().find((node)=>(node.localName==="a"||node.localName==="area")' +
  '&&typeof node.getAttribute==="function"&&node.getAttribute("href")!==null);' +
  "const rehome=(link)=>{" +
  'const raw=link.getAttribute("href");' +
  "let to;" +
  // No base: an address as written, as `localPageParts` reads it, so a page's own `<base href="file:…">` never
  // turns a relative link into a page address.
  "try{to=new URL(raw);}catch{return;}" +
  'if(to.protocol!=="file:"||(to.host!==""&&to.host!=="localhost")||unopenable.test(to.pathname))return;' +
  "let segments;" +
  'try{segments=to.pathname.split("/").map((segment)=>decodeURIComponent(segment));}catch{return;}' +
  "const slug=segments.at(-2);" +
  'if(segments.at(-1)!=="index.html"||segments.at(-3)!=="pages"||slug===undefined||!pageSlug.test(slug))return;' +
  "const cut=raw.search(/[?#]/u);" +
  'link.setAttribute("href","/api/page/"+slug+"/index.html"+(cut===-1?"":raw.slice(cut)));' +
  "};" +
  'document.addEventListener("auxclick",(event)=>{const link=linkOf(event);if(link!==undefined)rehome(link);});' +
  'document.addEventListener("click",(event)=>{' +
  "const link=linkOf(event);" +
  "if(link===undefined)return;" +
  "rehome(link);" +
  "if(window.top===window||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;" +
  'if(link.hasAttribute("target")||link.hasAttribute("download"))return;' +
  "let to;" +
  'try{to=new URL(link.getAttribute("href"),document.baseURI);}catch{return;}' +
  'if(to.protocol!=="http:"&&to.protocol!=="https:")return;' +
  "const here=new URL(location.href);" +
  'if(to.origin===here.origin&&to.pathname.startsWith("/api/page/"))return;' +
  'link.setAttribute("target","_blank");' +
  'link.setAttribute("rel",[link.getAttribute("rel"),"noopener"].filter(Boolean).join(" "));' +
  "});" +
  "})();";

/** {@link FRAMED_LINK_LISTENER} as the inline element a served page carries. */
export const FRAMED_LINK_SCRIPT = `<script data-sw-framed-links>${FRAMED_LINK_LISTENER}</script>`;

/**
 * The served document with {@link FRAMED_LINK_SCRIPT} after its last byte, which the parser places at the end of the
 * body. Never at the front: anything ahead of a doctype but a comment throws the page into quirks mode, and finding
 * where a doctype starts means re-implementing the tokenizer's comment rules, and each pattern tried missed
 * one more form. At the end, every byte the page wrote is parsed exactly as before, and
 * the listener is in place by the time the page has finished loading. Appended as BYTES, never decoded and
 * re-encoded, so a body that is not valid UTF-8 keeps every byte it was handed — an `index.html` has
 * already been through the house shell's UTF-8 re-wrap by then, which predates this.
 *
 * @param body the document about to be served
 * @returns the same bytes, then the script's
 */
export function withFramedLinks({ body }: { body: Uint8Array }): Buffer {
  return Buffer.concat([body, Buffer.from(FRAMED_LINK_SCRIPT, "utf8")]);
}
