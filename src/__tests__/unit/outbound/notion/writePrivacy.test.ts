/**
 * The outbound privacy check at the Notion write transport, through the REAL SDK `Client` that
 * `makeNotionWriteSeam` builds and a real private-terms file under a throwaway home. The `fetch` under the guard is
 * a counting seam rather than a mock: it records exactly what the SDK emitted — method, path and body — so the read
 * allowlist is asserted against the pinned SDK's real requests, a refused write is seen to send nothing and a clean
 * one to send exactly once. Synthetic terms throughout: `quillfeather` is the private person term.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { NotionFetch } from "../../../../corpus/notion/guardedFetch.js";
import { makeNotionMediaApi } from "../../../../corpus/notion/mediaApi.js";
import { makeNotionWriteApi, makeNotionWriteSeam } from "../../../../corpus/notion/writeApi.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { refusedBeforeNotionWire } from "../../../../outbound/notion/sendFailure.js";
import { isNotionReadRequest } from "../../../../outbound/notion/writePrivacyPayload.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { writePrivateTerms } from "../../../privateTermsFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home, its private-terms file holding `rows`, or absent when `rows` is undefined. */
function homeWith({ rows }: { rows: readonly string[] | undefined }): string {
  const home = mkdtempSync(join(tmpdir(), "notion-write-privacy-"));
  homes.push(home);
  if (rows !== undefined) {
    writePrivateTerms({ home, rows });
  }
  return home;
}

const PERSON = ["person\ti\tquillfeather\tsynthetic"];
const PAGE = "3c300000-0000-817c-a1d1-da9a9b003e05";
const PARENT = "39100000-0000-8102-a2f7-d1d8ef1fe6b0";
const BLOCK = "3b300000-0000-818b-91d1-0027228eae95";

/** One answer every route can read: a page, a markdown read, a block list, an upload and a bot user at once. */
const ANSWER = {
  has_more: false,
  id: PAGE,
  in_trash: false,
  last_edited_by: { id: BLOCK },
  last_edited_time: "2026-08-22T00:00:00.000Z",
  markdown: "",
  next_cursor: null,
  object: "page",
  parent: { page_id: PARENT, type: "page_id" },
  results: [{ id: BLOCK, object: "block", type: "image" }],
  status: "uploaded",
  truncated: false,
  unknown_block_ids: [],
  url: "https://app.notion.com/p/x-0000000000000000000000000000a003",
};

/** One request the SDK handed to `fetch`, exactly as it handed it. */
interface Sent {
  readonly method: string | undefined;
  readonly path: string;
  readonly body: string | FormData | undefined;
}

/**
 * Both real seams over `home`, whose every request lands in `sent`. A `fileUploads.send` answers `pending`, so the
 * upload is confirmed by its `fileUploads.retrieve` read and that route is measured too; everything else `answer`.
 */
function countingApis({ home, answer = ANSWER }: { home: string; answer?: unknown }) {
  const sent: Sent[] = [];
  const fetch: NotionFetch = (url, init) => {
    const path = new URL(url).pathname;
    sent.push({ body: init?.body, method: init?.method, path });
    const text = JSON.stringify(path.endsWith("/send") ? { ...ANSWER, status: "pending" } : answer);
    return Promise.resolve({ body: null, headers: {}, ok: true, status: 200, text: () => Promise.resolve(text) });
  };
  const seam = makeNotionWriteSeam({ fetch, home, token: "secret_fixture" });
  return { api: makeNotionWriteApi({ seam }), mediaApi: makeNotionMediaApi({ seam }), sent };
}

const bytes = ({ text }: { text: string }): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

describe("the routes the pinned SDK emits", () => {
  it("sends every read and write the lane makes on exactly these methods and paths, judging only the writes", async () => {
    const { api, mediaApi, sent } = countingApis({ home: homeWith({ rows: [] }) });
    await api.retrievePage({ pageId: PAGE });
    await api.retrieveMarkdown({ pageId: PAGE });
    await api.botUserId();
    await mediaApi.listChildren({ cursor: undefined, parentId: PAGE });
    await api.createPage({ icon: undefined, markdown: "body", parentPageId: PARENT, title: "T" });
    await api.replaceMarkdown({ markdown: "body", pageId: PAGE });
    await api.updatePageHeader({ icon: undefined, pageId: PAGE, title: "T" });
    await api.archivePage({ pageId: PAGE });
    await api.movePage({ pageId: PAGE, parentPageId: PARENT });
    await mediaApi.uploadFile({ bytes: bytes({ text: "png" }), contentType: "image/png", filename: "a.png" });
    await mediaApi.insertMediaAfter({
      afterBlockId: BLOCK,
      blockType: "image",
      caption: "c",
      fileUploadId: PAGE,
      parentId: PAGE,
    });
    await mediaApi.deleteBlock({ blockId: BLOCK });
    const routes = sent.map(({ method, path }) => `${String(method)} ${path}`);
    expect(routes).toEqual([
      `GET /v1/pages/${PAGE}`,
      `GET /v1/pages/${PAGE}/markdown`,
      "GET /v1/users/me",
      `GET /v1/blocks/${PAGE}/children`,
      "POST /v1/pages",
      `PATCH /v1/pages/${PAGE}/markdown`,
      `PATCH /v1/pages/${PAGE}`,
      `PATCH /v1/pages/${PAGE}`,
      `POST /v1/pages/${PAGE}/move`,
      "POST /v1/file_uploads",
      `POST /v1/file_uploads/${PAGE}/send`,
      `GET /v1/file_uploads/${PAGE}`,
      `PATCH /v1/blocks/${PAGE}/children`,
      `DELETE /v1/blocks/${BLOCK}`,
    ]);
    expect(
      sent.map(({ method, path }) => isNotionReadRequest({ method, url: `https://api.notion.com${path}` })),
    ).toEqual([true, true, true, true, false, false, false, false, false, false, false, true, false, false]);
  });
});

describe("the Notion write transport's privacy guard", () => {
  it("refuses a create whose title carries a private term before any request, naming locus and class only", async () => {
    const { api, sent } = countingApis({ home: homeWith({ rows: PERSON }) });
    const result = await api.createPage({
      icon: undefined,
      markdown: "b",
      parentPageId: PARENT,
      title: "Quillfeather",
    });
    const message = unwrapErr(result).message;
    expect(message).toContain(
      "notion pages.create properties.title.title[0].text.content line 1: a private person term (redacted here)",
    );
    expect(message).not.toMatch(/quillfeather/iu);
    expect(refusedBeforeNotionWire({ error: unwrapErr(result) })).toBe(true);
    expect(sent).toEqual([]);
  });

  it("judges a replace's markdown and a move's body, each before the wire", async () => {
    const { api, sent } = countingApis({ home: homeWith({ rows: PERSON }) });
    const replaced = await api.replaceMarkdown({ markdown: "# Notes\n\nask quillfeather", pageId: PAGE });
    const icon = await api.updatePageHeader({ icon: "quillfeather", pageId: PAGE, title: undefined });
    expect(unwrapErr(replaced).message).toContain(
      "notion pages.updateMarkdown replace_content.new_str line 3: a private person term",
    );
    expect(unwrapErr(icon).message).toContain("notion pages.update icon.emoji line 1: a private person term");
    expect(sent).toEqual([]);
  });

  it("sends a clean write exactly once", async () => {
    const { api, sent } = countingApis({ home: homeWith({ rows: PERSON }) });
    const result = await api.createPage({
      icon: undefined,
      markdown: "the build is green",
      parentPageId: PARENT,
      title: "T",
    });
    expect(unwrap(result).id).toBe(PAGE);
    expect(sent.map(({ method }) => method)).toEqual(["POST"]);
  });

  it("refuses every write when the private-terms file is absent, and still sends the reads", async () => {
    const { api, mediaApi, sent } = countingApis({ home: homeWith({ rows: undefined }) });
    const refused = await mediaApi.deleteBlock({ blockId: BLOCK });
    expect(unwrapErr(refused).message).toContain("does not exist, so no outbound write is checked for them");
    expect(unwrap(await api.retrievePage({ pageId: PAGE }))!.id).toBe(PAGE);
    expect(unwrap(await api.botUserId())).toBe(PAGE);
    expect(sent.map(({ method }) => method)).toEqual(["GET", "GET"]);
  });

  it("refuses a later write once the private-terms file is gone, never reusing an earlier load", async () => {
    const home = homeWith({ rows: PERSON });
    const { api, sent } = countingApis({ home });
    await api.movePage({ pageId: PAGE, parentPageId: PARENT });
    rmSync(stateHomePaths({ home }).privateTerms);
    const second = await api.movePage({ pageId: PAGE, parentPageId: PARENT });
    expect(unwrapErr(second).message).toContain("does not exist");
    expect(sent).toHaveLength(1);
  });

  it("never judges a response, so a read answering with a private term still reads", async () => {
    const answer = { ...ANSWER, markdown: "quillfeather wrote this" };
    const { api } = countingApis({ answer, home: homeWith({ rows: PERSON }) });
    expect(unwrap(await api.retrieveMarkdown({ pageId: PAGE })).markdown).toBe("quillfeather wrote this");
  });
});

describe("an upload, judged whole before its slot is reserved", () => {
  it("refuses a text file whose bytes carry a private term before fileUploads.create", async () => {
    const { mediaApi, sent } = countingApis({ home: homeWith({ rows: PERSON }) });
    const result = await mediaApi.uploadFile({
      bytes: bytes({ text: "notes\nfrom quillfeather" }),
      contentType: "text/plain",
      filename: "notes.txt",
    });
    expect(unwrapErr(result).message).toContain("notion attach upload file line 2: a private person term");
    expect(refusedBeforeNotionWire({ error: unwrapErr(result) })).toBe(true);
    expect(sent).toEqual([]);
  });

  it("refuses a filename carrying a private term, whatever the file is", async () => {
    const { mediaApi, sent } = countingApis({ home: homeWith({ rows: PERSON }) });
    const result = await mediaApi.uploadFile({
      bytes: bytes({ text: "png" }),
      contentType: "image/png",
      filename: "quillfeather.png",
    });
    expect(unwrapErr(result).message).toContain("notion attach upload file.filename line 1: a private person term");
    expect(sent).toEqual([]);
  });

  it("refuses a text-like file that is not valid UTF-8", async () => {
    const { mediaApi, sent } = countingApis({ home: homeWith({ rows: PERSON }) });
    const result = await mediaApi.uploadFile({
      bytes: new Uint8Array([0xff, 0xfe, 0xfd]),
      contentType: "text/markdown",
      filename: "a.md",
    });
    expect(unwrapErr(result).message).toContain("a text-like file that is not valid UTF-8, so it cannot be judged");
    expect(sent).toEqual([]);
  });

  it("passes an image's bytes unread, judging its send's multipart fields at the transport too", async () => {
    const { mediaApi, sent } = countingApis({ home: homeWith({ rows: PERSON }) });
    const result = await mediaApi.uploadFile({
      bytes: bytes({ text: "quillfeather drawn into pixels" }),
      contentType: "image/png",
      filename: "hero.png",
    });
    expect(unwrap(result)).toBe(PAGE);
    expect(sent.map(({ method, path }) => `${String(method)} ${path}`)).toEqual([
      "POST /v1/file_uploads",
      `POST /v1/file_uploads/${PAGE}/send`,
      `GET /v1/file_uploads/${PAGE}`,
    ]);
    expect(sent[1]!.body instanceof FormData).toBe(true);
  });
});
