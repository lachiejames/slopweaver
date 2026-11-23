/*
 * The page route's serving half over an in-memory store: the page and the files it serves are answered with their
 * types and a sandbox policy, nothing the page's rows do not name is, bytes that are not the named ones never are, and
 * a store that could not say is never a missing page.
 */

import { describe, expect, it } from "vitest";

import { FRAMED_LINK_SCRIPT } from "../../lib/framedLinks";
import {
  PAGE_CSP,
  type PresentationSource,
  type SignedBodyFetch,
  STORE_UNREADABLE_BODY,
  servePageFile,
} from "../../lib/localPageServe";
import { PLATFORM_SHELL_OPEN, SHELL_CLOSE, SHELL_OPEN } from "../../lib/localPageShell";
import { keptPresentation } from "../../lib/pageStoreSource";
import { pageVersionOf } from "../../lib/pageVersion";
import { versionReportElement } from "../../lib/pageVersionReport";
import { pageStoreFake } from "../pageStoreFake";

const ALPHA = { "assets/style.css": "h1{}", "index.html": "<h1>alpha</h1>", "run.sh": "echo" };

/** The version a source names for a page now, as `view/page.tsx` reads it, throwing (so failing) when it names none. */
async function versionNow({ presentation, slug }: { presentation: PresentationSource; slug: string }): Promise<string> {
  const read = pageVersionOf({ read: await presentation({ fresh: true, slug }) });
  if (read.kind !== "version") {
    throw new Error(`expected a version, got ${read.kind}`);
  }
  return read.version;
}

/** The report a document of `slug` served at its source's current version ends with. */
async function reportNow({ presentation, slug }: { presentation: PresentationSource; slug: string }): Promise<string> {
  return versionReportElement({ slug, version: await versionNow({ presentation, slug }) });
}

/** Serve one file of a store holding `alpha`, plus `extra` pages. */
function serveFrom({
  slug,
  file,
  extra = {},
}: {
  slug: string;
  file: readonly string[];
  extra?: Readonly<Record<string, Readonly<Record<string, string | Uint8Array>>>>;
}) {
  const store = pageStoreFake({ pages: { alpha: ALPHA, ...extra } });
  return { response: servePageFile({ ...store, file, slug }), store };
}

describe("servePageFile", () => {
  it("serves a page's index with its type, no caching, a sandboxed origin and its version report", async () => {
    const { response: pending, store } = serveFrom({ file: ["index.html"], slug: "alpha" });
    const response = await pending;
    const report = await reportNow({ presentation: store.presentation, slug: "alpha" });
    expect([
      response.status,
      await response.text(),
      response.headers.get("content-type"),
      response.headers.get("cache-control"),
      response.headers.get("content-security-policy"),
      response.headers.get("x-content-type-options"),
    ]).toEqual([
      200,
      `<h1>alpha</h1>${FRAMED_LINK_SCRIPT}${report}`,
      "text/html; charset=utf-8",
      "no-store",
      PAGE_CSP,
      "nosniff",
    ]);
  });

  it("asks the store afresh for the document, and lets a file the page loads reuse that answer", async () => {
    const { store, response } = serveFrom({ file: ["index.html"], slug: "alpha" });
    await response;
    await servePageFile({ ...store, file: ["assets", "style.css"], slug: "alpha" });
    expect(store.asked).toEqual([
      { fresh: true, slug: "alpha" },
      { fresh: false, slug: "alpha" },
    ]);
  });

  it("never lets the page share the console's origin, nor send a request or a form", () => {
    expect(PAGE_CSP.split("; ")).toEqual([
      "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads",
      "connect-src 'none'",
      "form-action 'none'",
    ]);
  });

  it("serves a nested asset the page links relatively", async () => {
    const response = await serveFrom({ file: ["assets", "style.css"], slug: "alpha" }).response;
    expect([response.status, await response.text(), response.headers.get("content-type")]).toEqual([
      200,
      "h1{}",
      "text/css; charset=utf-8",
    ]);
  });

  it("answers 404 for a missing page, a missing file, an unserved type and a dot-walk", async () => {
    const responses = await Promise.all([
      serveFrom({ file: ["index.html"], slug: "missing" }).response,
      serveFrom({ file: ["other.html"], slug: "alpha" }).response,
      serveFrom({ file: ["run.sh"], slug: "alpha" }).response,
      serveFrom({ file: ["..", "outside", "secret.txt"], slug: "alpha" }).response,
    ]);
    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404]);
  });

  it("answers 404 naming the path for a page the store does not hold", async () => {
    const response = await serveFrom({ file: ["index.html"], slug: "escape" }).response;
    expect([response.status, await response.text()]).toEqual([404, "no local page file escape/index.html"]);
  });

  it("answers 503 in fixed words, never 404, when the store could not say", async () => {
    const store = pageStoreFake({ pages: { alpha: ALPHA }, unreadable: true });
    const response = await servePageFile({ ...store, file: ["index.html"], slug: "alpha" });
    expect([response.status, await response.text()]).toEqual([503, STORE_UNREADABLE_BODY]);
  });

  it("asks once more, fresh, when a kept address answers other bytes, then answers 502", async () => {
    const store = pageStoreFake({ pages: { alpha: ALPHA } });
    store.tamper.bytes = new TextEncoder().encode("h1{color:red}");
    const response = await servePageFile({ ...store, file: ["assets", "style.css"], slug: "alpha" });
    expect([response.status, await response.text()]).toEqual([502, "the store did not return alpha/assets/style.css"]);
    expect(store.asked).toEqual([
      { fresh: false, slug: "alpha" },
      { fresh: true, slug: "alpha" },
    ]);
  });

  it("serves an index published in the platform shell in the current one", async () => {
    const legacy = { "index.html": `${PLATFORM_SHELL_OPEN}<h1>Café</h1>${SHELL_CLOSE}` };
    const { response: pending, store } = serveFrom({ extra: { legacy }, file: ["index.html"], slug: "legacy" });
    const response = await pending;
    const report = await reportNow({ presentation: store.presentation, slug: "legacy" });
    expect([response.status, await response.text(), response.headers.get("content-security-policy")]).toEqual([
      200,
      `${SHELL_OPEN}<h1>Café</h1>${SHELL_CLOSE}${FRAMED_LINK_SCRIPT}${report}`,
      PAGE_CSP,
    ]);
  });

  it("serves any other HTML file in its own shell, even one shaped like a page, carrying only the link script", async () => {
    const legacy = { "appendix.html": `${PLATFORM_SHELL_OPEN}<h1>a</h1>${SHELL_CLOSE}`, "index.html": "<p>i</p>" };
    const response = await serveFrom({ extra: { legacy }, file: ["appendix.html"], slug: "legacy" }).response;
    expect(await response.text()).toBe(`${PLATFORM_SHELL_OPEN}<h1>a</h1>${SHELL_CLOSE}${FRAMED_LINK_SCRIPT}`);
  });

  it("serves an HTML file that is not valid UTF-8 with its own bytes, then the link script's", async () => {
    const raw = Buffer.from([0x3c, 0x70, 0x3e, 0xff, 0x3c, 0x2f, 0x70, 0x3e]);
    const page = { "appendix.html": new Uint8Array(raw), "index.html": "<p>i</p>" };
    const response = await serveFrom({ extra: { page }, file: ["appendix.html"], slug: "page" }).response;
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.concat([raw, Buffer.from(FRAMED_LINK_SCRIPT, "utf8")]),
    );
  });

  it("serves a file that is not HTML byte for byte, with no link script", async () => {
    const page = { "data.json": '{"href":"https://example.com"}', "index.html": "<p>i</p>" };
    const response = await serveFrom({ extra: { page }, file: ["data.json"], slug: "page" }).response;
    expect(await response.text()).toBe('{"href":"https://example.com"}');
  });
});

/**
 * A kept source, as the route builds it, over a page `alpha` the test republishes from one document to another, with
 * the clock in the test's hand.
 */
function republishing(): {
  presentation: PresentationSource;
  fetchBody: SignedBodyFetch;
  republish: (args: { atMs: number }) => void;
} {
  const before = pageStoreFake({ pages: { alpha: { "index.html": "<h1>before</h1>" } } });
  const after = pageStoreFake({ pages: { alpha: { "index.html": "<h1>after</h1>" } } });
  const state = { current: before, nowMs: 0 };
  const presentation = keptPresentation({
    nowMs: () => state.nowMs,
    read: async ({ slug }) => state.current.presentation({ fresh: true, slug }),
  });
  const fetchBody: SignedBodyFetch = async ({ url }) => {
    const old = await before.fetchBody({ url });
    if (old !== undefined) {
      return old;
    }
    return after.fetchBody({ url });
  };
  const republish = ({ atMs }: { atMs: number }): void => {
    state.current = after;
    state.nowMs = atMs;
  };
  return { fetchBody, presentation, republish };
}

describe("servePageFile, for a frame naming the version its viewer read", () => {
  it("frames the version the viewer read, reporting it, when the page is republished before the frame asks", async () => {
    const store = republishing();
    const pinned = await versionNow({ presentation: store.presentation, slug: "alpha" });
    store.republish({ atMs: 10_000 });
    const response = await servePageFile({ ...store, file: ["index.html"], pinned, slug: "alpha" });
    const report = versionReportElement({ slug: "alpha", version: pinned });
    expect(await response.text()).toBe(`<h1>before</h1>${FRAMED_LINK_SCRIPT}${report}`);
  });

  it("frames the republished page for a frame naming no version, as before", async () => {
    const store = republishing();
    await versionNow({ presentation: store.presentation, slug: "alpha" });
    store.republish({ atMs: 10_000 });
    const response = await servePageFile({ ...store, file: ["index.html"], slug: "alpha" });
    const report = await reportNow({ presentation: store.presentation, slug: "alpha" });
    expect(await response.text()).toBe(`<h1>after</h1>${FRAMED_LINK_SCRIPT}${report}`);
  });

  it("asks afresh when the version named is not the one kept", async () => {
    const store = republishing();
    await versionNow({ presentation: store.presentation, slug: "alpha" });
    store.republish({ atMs: 10_000 });
    const response = await servePageFile({ ...store, file: ["index.html"], pinned: "f".repeat(64), slug: "alpha" });
    const report = await reportNow({ presentation: store.presentation, slug: "alpha" });
    expect(await response.text()).toBe(`<h1>after</h1>${FRAMED_LINK_SCRIPT}${report}`);
  });

  it("past the kept window, frames the republished page and reports ITS version, never the one pinned", async () => {
    const store = republishing();
    const pinned = await versionNow({ presentation: store.presentation, slug: "alpha" });
    store.republish({ atMs: 300_000 });
    const response = await servePageFile({ ...store, file: ["index.html"], pinned, slug: "alpha" });
    const served = await versionNow({ presentation: store.presentation, slug: "alpha" });
    expect([await response.text(), served === pinned]).toEqual([
      `<h1>after</h1>${FRAMED_LINK_SCRIPT}${versionReportElement({ slug: "alpha", version: served })}`,
      false,
    ]);
  });
});
