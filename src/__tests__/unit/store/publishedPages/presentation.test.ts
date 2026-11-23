/**
 * Which files a page shows and how each pairs with its signed address: a page with no local row is not published, a
 * local row whose document is missing or names another body is inconsistent rather than absent, and a file the
 * signing answer left out refuses the whole page.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { presentedFiles, signedFiles } from "../../../../store/publishedPages/presentation.js";
import { PublishedPagesReadErrors } from "../../../../store/publishedPages/readErrors.js";

const DOC = "a".repeat(64);
const IMAGE = "b".repeat(64);

/** A local page whose document is `DOC`, serving `files`. */
function localPage({
  files,
}: {
  files: readonly { relativePath: string; sha256: string; byteLength: number | null }[];
}) {
  return { files, page: { currentSha256: DOC, kind: "local" } };
}

describe("presentedFiles", () => {
  it("lists the document first and every other file by path", () => {
    const files = unwrap(
      presentedFiles({
        pageKey: "standup-brief",
        rows: localPage({
          files: [
            { byteLength: 9, relativePath: "shots/z.png", sha256: IMAGE },
            { byteLength: 120, relativePath: "index.html", sha256: DOC },
            { byteLength: 9, relativePath: "a.png", sha256: IMAGE },
          ],
        }),
      }),
    );
    expect(files.map((file) => file.relativePath)).toEqual(["index.html", "a.png", "shots/z.png"]);
    expect(files[0]).toEqual({ byteLength: 120, relativePath: "index.html", sha256: DOC });
  });

  it("refuses a key with no row, and a history with no page, as not published", () => {
    const none = unwrapErr(presentedFiles({ pageKey: "gone", rows: { files: [], page: undefined } }));
    expect(none).toEqual(PublishedPagesReadErrors.notPublished({ pageKey: "gone" }));
    const history = unwrapErr(
      presentedFiles({
        pageKey: "fleet-briefing",
        rows: { files: [], page: { currentSha256: null, kind: "history-only" } },
      }),
    );
    expect(history.code).toBe("PAGES_NOT_PUBLISHED");
  });

  it("refuses a local page whose document is missing or names another body as inconsistent, never absent", () => {
    const missing = unwrapErr(
      presentedFiles({
        pageKey: "p",
        rows: localPage({ files: [{ byteLength: 9, relativePath: "a.png", sha256: IMAGE }] }),
      }),
    );
    expect(missing).toEqual(
      PublishedPagesReadErrors.inconsistent({ detail: "its document is not its current body", pageKey: "p" }),
    );
    const other = unwrapErr(
      presentedFiles({
        pageKey: "p",
        rows: localPage({ files: [{ byteLength: 9, relativePath: "index.html", sha256: IMAGE }] }),
      }),
    );
    expect(other.code).toBe("PAGES_READ_INCONSISTENT");
  });

  it("refuses a file whose body row is missing rather than dropping it", () => {
    const refused = unwrapErr(
      presentedFiles({
        pageKey: "p",
        rows: localPage({
          files: [
            { byteLength: 120, relativePath: "index.html", sha256: DOC },
            { byteLength: null, relativePath: "a.png", sha256: IMAGE },
          ],
        }),
      }),
    );
    expect(refused).toEqual(PublishedPagesReadErrors.inconsistent({ detail: "a.png has no body row", pageKey: "p" }));
  });
});

describe("signedFiles", () => {
  const files = [
    { byteLength: 120, relativePath: "index.html", sha256: DOC },
    { byteLength: 9, relativePath: "a.png", sha256: IMAGE },
  ];

  it("pairs each file with its body's address, two files sharing a body sharing it", () => {
    const signed = new Map([
      [DOC, "http://127.0.0.1:54321/storage/v1/object/sign/published-pages/doc?token=t1"],
      [IMAGE, "http://127.0.0.1:54321/storage/v1/object/sign/published-pages/img?token=t2"],
    ]);
    const paired = unwrap(
      signedFiles({ files: [...files, { ...files[1]!, relativePath: "b.png" }], pageKey: "p", signed }),
    );
    expect(paired.map((file) => file.signedUrl)).toEqual([
      "http://127.0.0.1:54321/storage/v1/object/sign/published-pages/doc?token=t1",
      "http://127.0.0.1:54321/storage/v1/object/sign/published-pages/img?token=t2",
      "http://127.0.0.1:54321/storage/v1/object/sign/published-pages/img?token=t2",
    ]);
  });

  it("refuses the whole page when one file was not signed", () => {
    const refused = unwrapErr(signedFiles({ files, pageKey: "p", signed: new Map([[DOC, "http://x/doc"]]) }));
    expect(refused).toEqual(PublishedPagesReadErrors.inconsistent({ detail: "a.png was not signed", pageKey: "p" }));
  });
});
