/**
 * Serving one file of one published page out of the store — the half of `/api/page/<slug>/<file…>` that decides what
 * to answer, over two seams the route supplies (`../app/api/page/[slug]/[...file]/route.ts`): what the store says the
 * page serves (`./pagePresentation.ts`), and a fetch of one signed address's bytes. A page lives in the store's
 * Storage and nowhere else (`docs/store/published-pages.md`), so there is no file on disk to open.
 *
 * What this answer carries:
 *
 * - **The page's own list of files, nothing else.** A file is served only when the store's rows name it under this
 *   page, and its bytes only when they hash to the digest those rows give. The viewer never holds a signed address:
 *   this server fetches the bytes and answers them itself, so a relative `<img>`, a `srcset` or a CSS `url()` resolves
 *   under the page's own route exactly as it did from disk.
 * - **A sandboxed origin that cannot script a request.** Served here a page shares the console's origin, and a script
 *   in it would then pass `./consolePress.ts`'s same-origin check and press the console's write routes. A `sandbox`
 *   policy without `allow-same-origin` gives the page an opaque origin, and `connect-src 'none'` with
 *   `form-action 'none'` stops a fetch, an XHR, a socket or a form post — not only one the press guard would refuse.
 *   Every writing route calls that guard (`consolePress.test.ts` walks them), but a route that forgot it once —
 *   `/api/sync/<verb>`, with a `no-cors` POST — is why the page is also kept from sending. It does NOT
 *   stop an `<img>`, a stylesheet or a font loading from an `http` address; the shell asks for none, and a page that
 *   names one still fetches it. Its scripts still run (one page, `fleet-briefing`, uses them, and fetches nothing) and
 *   its links still open — in a new tab when they leave the page, so the frame showing it never goes blank on a site
 *   that refuses to be framed (`./framedLinks.ts`).
 * - **The current shell, on an old page.** An `index.html` published in an earlier shell is served in the current one
 *   (`./localPageShell.ts`), so a page with no stylesheet of its own reads in the house design. Only that file; the
 *   stored bytes are unchanged. Every HTML file served also carries the link script above.
 * - **The document always re-asks the store.** A page open asks afresh, so a republished page is what is shown; a file
 *   the page then loads reuses that answer while its addresses still read. A file served off a kept answer whose address
 *   no longer answers, or answers other bytes, is asked for once more, fresh, before it is refused; the document's own
 *   read is already fresh, so its failure is refused at once, as `./publishedPageTitle.ts` refuses the title's. The
 *   one exception is the viewer's frame, which names the version the viewer read (`?v=`): while the kept answer is
 *   still that version it is served. Past that window it is served fresh, and either way the document reports the
 * version it was served at to the viewer framing it (`./pageVersionReport.ts`), which compares against that.
 *
 * A page or file the store does not hold is a plain 404 naming the page-relative path. A store that could not say is a
 * 503 in fixed words, never a 404: nothing established that the page is not there.
 */
import { createHash } from "node:crypto";

import { withFramedLinks } from "./framedLinks";
import { pageFileOf } from "./localPageHref";
import { houseStyledPage } from "./localPageShell";
import type { PresentationRead, PresentedFile } from "./pagePresentation";
import { pageVersionOf } from "./pageVersion";
import { withVersionReport } from "./pageVersionReport";

/** The policy a served page runs under: scripts and popups, never the console's own origin, and no request out. */
export const PAGE_CSP =
  "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads; connect-src 'none'; form-action 'none'";

/** What a page shows when the store could not say whether it holds it. */
export const STORE_UNREADABLE_BODY = "the store could not be read, so this page cannot be shown: is the store running?";

/** What the route asks the store, `fresh` to skip any answer it kept. */
export type PresentationSource = (args: { slug: string; fresh: boolean }) => Promise<PresentationRead>;

/** One signed address's bytes, or `undefined` when it did not answer them. */
export type SignedBodyFetch = (args: { url: string }) => Promise<Uint8Array | undefined>;

/**
 * A plain-text answer that is not the file, never cached.
 *
 * @returns the response
 */
function plain({ status, body }: { status: number; body: string }): Response {
  return new Response(body, {
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
    status,
  });
}

/**
 * One file's bytes from its signed address, only when they are exactly the bytes its row names.
 *
 * @param file the file's row and address
 * @param fetchBody fetches one address
 * @returns the verified bytes, or `undefined`
 */
export async function verifiedBody({
  file,
  fetchBody,
}: {
  file: PresentedFile;
  fetchBody: SignedBodyFetch;
}): Promise<Uint8Array | undefined> {
  const body = await fetchBody({ url: file.signedUrl });
  if (body?.byteLength !== file.byteLength) {
    return undefined;
  }
  return createHash("sha256").update(body).digest("hex") === file.sha256 ? body : undefined;
}

/**
 * The served bytes and headers of one verified file.
 *
 * @param body the file's verified bytes
 * @param segments the path under the page
 * @param contentType what to serve it as
 * @param report the page and version the document is, which it reports to the viewer framing it
 * @returns the response
 */
function served({
  body,
  segments,
  contentType,
  report,
}: {
  body: Uint8Array;
  segments: readonly string[];
  contentType: string;
  report: { slug: string; version: string } | undefined;
}): Response {
  let bytes: Buffer = Buffer.from(body);
  if (segments.length === 1 && segments[0] === "index.html") {
    bytes = Buffer.from(houseStyledPage({ html: bytes.toString("utf8") }), "utf8");
  }
  if (contentType.startsWith("text/html")) {
    bytes = withFramedLinks({ body: bytes });
  }
  if (report !== undefined) {
    bytes = withVersionReport({ body: bytes, ...report });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "cache-control": "no-store",
      "content-security-policy": PAGE_CSP,
      "content-type": contentType,
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * Serve `<slug>/<file…>` from the store, or say why not.
 *
 * @param slug the page's slug, as the route received it
 * @param file the path under the page, as the route received it
 * @param presentation what the store says the page serves
 * @param fetchBody fetches one signed address's bytes
 * @param pinned the version the viewer read for this page (`./pageVersion.ts`), named by its frame's `?v=`: the
 *   document is served off the kept answer while that answer is still this version, so a republish landing between
 *   the viewer's read and its frame's request never puts a version in the frame the viewer does not know it shows
 * @returns the file with its content type and a sandbox policy, a 404, a 503 when the store could not say, or a 502
 *   when it named a file it then did not return
 */
export async function servePageFile({
  slug,
  file,
  presentation,
  fetchBody,
  pinned,
}: {
  slug: string;
  file: readonly string[];
  presentation: PresentationSource;
  fetchBody: SignedBodyFetch;
  pinned?: string;
}): Promise<Response> {
  const what = `${slug}/${file.join("/")}`;
  const wanted = pageFileOf({ file, slug });
  if (wanted === undefined) {
    return plain({ body: `no local page file ${what}`, status: 404 });
  }
  const relativePath = wanted.segments.join("/");
  let fresh = relativePath === "index.html";
  if (fresh && pinned !== undefined) {
    // Past its kept window, or a different version kept, the document is asked for fresh as before.
    const kept = pageVersionOf({ read: await presentation({ fresh: false, slug }) });
    fresh = kept.kind !== "version" || kept.version !== pinned;
  }
  for (;;) {
    const read = await presentation({ fresh, slug });
    if (read.kind === "store-unreadable") {
      return plain({ body: STORE_UNREADABLE_BODY, status: 503 });
    }
    const row = read.kind === "page" ? read.files.get(relativePath) : undefined;
    if (row === undefined) {
      return plain({ body: `no local page file ${what}`, status: 404 });
    }
    const body = await verifiedBody({ fetchBody, file: row });
    if (body !== undefined) {
      // The document says which answer it was served from, so the viewer compares against what is on screen.
      const version = relativePath === "index.html" ? pageVersionOf({ read }) : undefined;
      const report = version?.kind === "version" ? { slug, version: version.version } : undefined;
      return served({ body, contentType: wanted.contentType, report, segments: wanted.segments });
    }
    if (fresh) {
      return plain({ body: `the store did not return ${what}`, status: 502 });
    }
    fresh = true;
  }
}
