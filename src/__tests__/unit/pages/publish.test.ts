/**
 * `publishPage` over a recording store write: the document it builds, the files it reads, the version it answers,
 * and that it writes nothing on disk — the store is the page's only copy.
 * deleted-with-code: PageStoreCarrier
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { artifactKey } from "../../../outbound/briefing/freezeStore.js";
import { pagePath, publishPage } from "../../../pages/publish.js";
import { SHELL_BYTES, wrapPageFragment } from "../../../pages/shell.js";
import {
  localPagePublisher as publish,
  publisherWith,
  recordingWriter,
  refusingWriter,
} from "../../pagePublisherFake.js";

const NOW = "2026-09-13T06:00:00.000Z";

/** The `sha256:<hex>` digest of the document a fragment publishes as. */
function documentSha256({ fragment }: { fragment: string }): string {
  return `sha256:${createHash("sha256").update(wrapPageFragment({ fragment })).digest("hex")}`;
}

describe("publishPage", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-pages-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("hands the store the fragment wrapped in the shell, writes nothing on disk, and answers its address", async () => {
    const fragment = "<title>Queue Decision</title><h1>hello</h1>";
    const { writer, written } = recordingWriter();
    const published = unwrap(await publishPage({ fragment, home, nowIso: NOW, slug: "queue-decision", write: writer }));
    const path = pagePath({ home, slug: "queue-decision" });
    expect(published).toStrictEqual({
      bytes: SHELL_BYTES + Buffer.byteLength(fragment),
      frozen: { frozenIso: NOW, key: "queue-decision", sha256: documentSha256({ fragment }) },
      path,
      url: pathToFileURL(path).href,
    });
    expect(written).toStrictEqual([
      {
        assets: [],
        document: wrapPageFragment({ fragment }),
        frozenAt: new Date(NOW),
        home,
        importedAt: new Date(NOW),
        slug: "queue-decision",
      },
    ]);
    expect([existsSync(join(home, "pages")), existsSync(join(home, "published-pages"))]).toStrictEqual([false, false]);
  });

  it("appends an appendix after the fragment, inside the shell, and freezes the whole document", async () => {
    const fragment = "<title>A</title><p>one</p>";
    const appendix = '\n<details data-page-review="waived"><summary>x</summary></details>\n';
    const { writer, written } = recordingWriter();
    const published = unwrap(await publishPage({ appendix, fragment, home, nowIso: NOW, slug: "a", write: writer }));
    expect(written[0]!.document).toBe(wrapPageFragment({ fragment: `${fragment}${appendix}` }));
    expect(published.frozen.sha256).toBe(documentSha256({ fragment: `${fragment}${appendix}` }));
  });

  it("keys the freeze on the slug, so two pages do not overwrite each other's history", async () => {
    const a = unwrap(await publish({ fragment: "<p>a</p>", home, nowIso: NOW, slug: "alpha" }));
    const b = unwrap(await publish({ fragment: "<p>b</p>", home, nowIso: NOW, slug: "beta" }));
    expect([a.frozen.key, b.frozen.key]).toStrictEqual(["alpha", "beta"]);
  });

  it("refuses a slug that would become a different directory, and writes nothing", async () => {
    const { writer, written } = recordingWriter();
    const refused = await publishPage({ fragment: "<p>x</p>", home, nowIso: NOW, slug: "../escape", write: writer });
    expect(unwrapErr(refused)[0]).toContain("cannot be a page slug");
    expect(written).toStrictEqual([]);
  });

  it("refuses an instant the store could never read back, and writes nothing", async () => {
    const { writer, written } = recordingWriter();
    const refused = await publishPage({
      fragment: "<p>x</p>",
      home,
      nowIso: "not-a-date",
      slug: "acme",
      write: writer,
    });
    expect(unwrapErr(refused)).toEqual([
      '"not-a-date" is not an ISO-8601 datetime with an offset, and a freeze stamped with it is one the store can ' +
        "never read back; nothing was written",
    ]);
    expect(written).toStrictEqual([]);
  });

  it("publishes a page whose fragment is empty, costing exactly the shell", async () => {
    const published = unwrap(await publish({ fragment: "", home, nowIso: NOW, slug: "empty" }));
    expect(published.bytes).toBe(SHELL_BYTES);
  });

  it("refuses a page naming images the console cannot load, and writes nothing", async () => {
    const fragment = '<img src="file:///Users/x/charts/a.png"><img src="../b.png"><img src="ok.png">';
    const { writer, written } = recordingWriter();
    const lines = unwrapErr(await publishPage({ fragment, home, nowIso: NOW, slug: "charts", write: writer }));

    expect(lines).toEqual([
      expect.stringMatching(/^slopweaver page publish blocked because the page names an image or stylesheet/u),
      expect.stringMatching(/^Legitimate exceptions may include the page is archival HTML/u),
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_PAGE_EXTERNAL_LOCAL_ASSET=1 slopweaver page publish.",
      "Use good judgement to determine whether the owner would approve of this, then proceed or correct your approach.",
    ]);
    expect(lines[0]).toContain(
      "(2 in this page: file:///Users/x/charts/a.png (file-url, img-src); ../b.png (parent-relative, img-src); " +
        "link each relatively and name its directory with --assets-from)",
    );
    expect(written).toStrictEqual([]);
  });

  it("refuses a plain relative image that the document's base resolves outside the page, and writes nothing", async () => {
    const fragment = '<base href="../"><img src="secret.png">';
    const { writer, written } = recordingWriter();
    const lines = unwrapErr(await publishPage({ fragment, home, nowIso: NOW, slug: "acme-victim", write: writer }));

    expect(lines[0]).toContain(
      "(1 in this page: secret.png (resolves outside the page); " +
        "link each relatively and name its directory with --assets-from)",
    );
    expect(written).toStrictEqual([]);
  });

  it("refuses a video that climbs outside the page, and writes nothing", async () => {
    const { writer, written } = recordingWriter();
    const lines = unwrapErr(
      await publishPage({
        fragment: '<video src="../secret.mp4"></video>',
        home,
        nowIso: NOW,
        slug: "acme-demo",
        write: writer,
      }),
    );

    expect(lines[0]).toContain("(1 in this page: ../secret.mp4 (resolves outside the page);");
    expect(written).toStrictEqual([]);
  });

  it("publishes the same page when the caller opens the hatch", async () => {
    const fragment = '<img src="file:///Users/x/charts/a.png">';
    const { writer, written } = recordingWriter();
    unwrap(
      await publishPage({
        allowExternalLocalAssets: true,
        fragment,
        home,
        nowIso: NOW,
        slug: "archival",
        write: writer,
      }),
    );
    expect(written[0]!.document).toBe(wrapPageFragment({ fragment }));
  });

  it("publishes the same page when the operator opens the hatch for the process", async () => {
    const fragment = '<img src="/Users/x/a.png">';
    const { writer, written } = recordingWriter();
    process.env["SLOPWEAVER_ALLOW_PAGE_EXTERNAL_LOCAL_ASSET"] = "1";
    try {
      unwrap(await publishPage({ fragment, home, nowIso: NOW, slug: "operator", write: writer }));
      expect(written[0]!.document).toBe(wrapPageFragment({ fragment }));
    } finally {
      delete process.env["SLOPWEAVER_ALLOW_PAGE_EXTERNAL_LOCAL_ASSET"];
    }
  });

  it("reads a relative image from the directory source and hands it to the store with the page", async () => {
    const root = join(home, "drafts");
    mkdirSync(join(root, "charts"), { recursive: true });
    writeFileSync(join(root, "charts", "a.png"), "png");
    const fragment = '<figure><img src="charts/a.png" alt="a"></figure>';
    const { writer, written } = recordingWriter();
    unwrap(
      await publishPage({
        assetSource: { kind: "directory", root },
        fragment,
        home,
        nowIso: NOW,
        slug: "beside",
        write: writer,
      }),
    );
    expect(written[0]!.assets.map((asset) => [asset.relativePath, asset.bytes.toString("utf8")])).toStrictEqual([
      ["charts/a.png", "png"],
    ]);
  });

  it("refuses a relative image when no source is named, and writes nothing", async () => {
    const { writer, written } = recordingWriter();
    const refused = await publishPage({
      fragment: '<img src="charts/a.png" alt="a">',
      home,
      nowIso: NOW,
      slug: "beside",
      write: writer,
    });
    expect(unwrapErr(refused)).toStrictEqual([
      "the page loads 1 file(s) beside it (charts/a.png); name the directory they are read from with --assets-from <dir>",
    ]);
    expect(written).toStrictEqual([]);
  });
});

describe("publishPage — the store write", () => {
  it("fails the publish when the store refuses, answering no address, and leaves nothing on disk", async () => {
    const home = mkdtempSync(join(tmpdir(), "sw-pages-store-"));
    try {
      const refused = await publisherWith({ writer: refusingWriter({ line: "the store is down" }) })({
        fragment: "<p>unstored</p>",
        home,
        nowIso: NOW,
        slug: "unstored",
      });
      expect(unwrapErr(refused)).toEqual([
        "writing unstored into the store failed or could not be confirmed, so the publish did not complete and the " +
          "page has no address yet. Re-run the same publish to complete it.",
        "the store is down",
      ]);
      expect(existsSync(join(home, "pages"))).toBe(false);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("hands the store the same document on a re-run, so the retry writes the same version", async () => {
    const fragment = "<p>retried</p>";
    const request = { fragment, home: "/home/acme/.slopweaver", nowIso: NOW, slug: "retried" };
    expect(unwrapErr(await publisherWith({ writer: refusingWriter({ line: "the store is down" }) })(request))[1]).toBe(
      "the store is down",
    );
    const { writer, written } = recordingWriter();
    const second = unwrap(await publisherWith({ writer })(request));
    expect(second.frozen.sha256).toBe(documentSha256({ fragment }));
    expect(written.map((page) => page.document)).toStrictEqual([wrapPageFragment({ fragment })]);
  });
});

describe("a home whose path carries a space", () => {
  it("still produces an address the parser reads the slug back out of", async () => {
    const published = unwrap(
      await publish({ fragment: "<p>x</p>", home: "/home/acme/a home", nowIso: NOW, slug: "spaced" }),
    );
    expect(published.url).toContain("a%20home");
    expect(unwrap(artifactKey({ artifact: published.url }))).toBe("spaced");
  });
});
