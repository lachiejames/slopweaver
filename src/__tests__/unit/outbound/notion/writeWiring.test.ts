/**
 * The two Notion write guards in their fixed order, the home each production verb builds its capability from, and
 * the platform `fetch` adapter the guarded client sends through.
 *
 * The dead Datadog host refuses FIRST, so a write carrying one is named for it even in a home with no private-terms
 * file. And the capability is built from the home the VERB resolved: each case below builds the production factory
 * under one home while the ambient `$SLOPWEAVER_HOME` (the test sandbox) holds no terms file at all, so a refusal
 * naming a home's own term class can only have read that home. Every write here is refused before the wire, so no
 * case reaches Notion. Synthetic terms: `quillfeather` a person, `zorvane` an organisation.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { productionNotionImageDeps } from "../../../../cli/commands/notion/mediaRun.js";
import { productionNotionPageDeps } from "../../../../cli/commands/notion/writeContext.js";
import { globalNotionFetch, type NotionFetch } from "../../../../corpus/notion/guardedFetch.js";
import { makeNotionMediaApi } from "../../../../corpus/notion/mediaApi.js";
import { makeNotionWriteApi, makeNotionWriteSeam } from "../../../../corpus/notion/writeApi.js";
import { unwrapErr } from "../../../../lib/result.js";
import { refusedBeforeNotionWire } from "../../../../outbound/notion/sendFailure.js";
import { writePrivateTerms } from "../../../privateTermsFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home, its private-terms file holding `rows`, or absent when `rows` is undefined. */
function homeWith({ rows }: { rows: readonly string[] | undefined }): string {
  const home = mkdtempSync(join(tmpdir(), "notion-write-wiring-"));
  homes.push(home);
  if (rows !== undefined) {
    writePrivateTerms({ home, rows });
  }
  return home;
}

const PERSON = ["person\ti\tquillfeather\tsynthetic"];
const ORGANISATION = ["organisation\ti\tzorvane\tsynthetic"];
const PARENT = "39100000-0000-8102-a2f7-d1d8ef1fe6b0";
const BOTH = "quillfeather at zorvane";

/** The link the bot actually posted, on the synthetic `ap1` site rather than an install's own. */
const OFFENDING_URL = "https://app.ap1.datadoghq.com/monitors/1000001";

/** The same monitor on that site's real console host. */
const CORRECT_URL = "https://ap1.datadoghq.com/monitors/1000001";

/** Both real seams over `home`, counting what reaches the transport under the guard. */
function countingApis({ home }: { home: string }) {
  let sent = 0;
  const fetch: NotionFetch = () => {
    sent += 1;
    const text = JSON.stringify({ id: PARENT, url: "https://app.notion.com/p/x" });
    return Promise.resolve({ body: null, headers: {}, ok: true, status: 200, text: () => Promise.resolve(text) });
  };
  const seam = makeNotionWriteSeam({ fetch, home, token: "secret_fixture" });
  return { api: makeNotionWriteApi({ seam }), mediaApi: makeNotionMediaApi({ seam }), sent: () => sent };
}

describe("the dead Datadog host refuses first", () => {
  it("names a dead host in a page body before the privacy check, even with no private-terms file", async () => {
    const { api, sent } = countingApis({ home: homeWith({ rows: undefined }) });
    const result = await api.createPage({
      icon: undefined,
      markdown: `see ${OFFENDING_URL}`,
      parentPageId: PARENT,
      title: "T",
    });
    const error = unwrapErr(result);
    expect(error.message).toContain("blocked because");
    expect(error.message).not.toContain("does not exist");
    expect(refusedBeforeNotionWire({ error })).toBe(true);
    expect(sent()).toBe(0);
  });

  it("refuses a dead host inside an image's bytes before its upload slot is reserved", async () => {
    const { mediaApi, sent } = countingApis({ home: homeWith({ rows: [] }) });
    const result = await mediaApi.uploadFile({
      bytes: new TextEncoder().encode(`png ${OFFENDING_URL}`),
      contentType: "image/png",
      filename: "hero.png",
    });
    expect(unwrapErr(result).message).toContain("blocked because");
    expect(refusedBeforeNotionWire({ error: unwrapErr(result) })).toBe(true);
    expect(sent()).toBe(0);
  });

  it("sends the same body linking the real console", async () => {
    const { api, sent } = countingApis({ home: homeWith({ rows: [] }) });
    await api.createPage({ icon: undefined, markdown: `see ${CORRECT_URL}`, parentPageId: PARENT, title: "T" });
    expect(sent()).toBe(1);
  });
});

describe("the verb's own home reaches the capability", () => {
  it("judges a page verb's client under the home it was built with, not the ambient one", async () => {
    const make = productionNotionPageDeps().makeApis;
    const create = { icon: undefined, markdown: "clean", parentPageId: PARENT, title: BOTH };
    const fromPerson = await make({ home: homeWith({ rows: PERSON }), token: "secret_fixture" }).api.createPage(create);
    const fromOrg = await make({ home: homeWith({ rows: ORGANISATION }), token: "secret_fixture" }).api.createPage(
      create,
    );
    expect(unwrapErr(fromPerson).message).toContain("a private person term (redacted here)");
    expect(unwrapErr(fromPerson).message).not.toContain("organisation term");
    expect(unwrapErr(fromOrg).message).toContain("a private organisation term (redacted here)");
    expect(unwrapErr(fromOrg).message).not.toContain("person term");
  });

  it("judges an attach verb's upload under the home it names", async () => {
    const make = productionNotionImageDeps().makeApis;
    const upload = { bytes: new TextEncoder().encode("png"), contentType: "image/png", filename: `${BOTH}.png` };
    const fromPerson = await make({ home: homeWith({ rows: PERSON }), token: "secret_fixture" }).mediaApi.uploadFile(
      upload,
    );
    const fromOrg = await make({ home: homeWith({ rows: ORGANISATION }), token: "secret_fixture" }).mediaApi.uploadFile(
      upload,
    );
    expect(unwrapErr(fromPerson).message).toContain("notion attach upload file.filename line 1: a private person term");
    expect(unwrapErr(fromOrg).message).toContain(
      "notion attach upload file.filename line 1: a private organisation term",
    );
  });
});

describe("globalNotionFetch", () => {
  it("answers the platform response's status, text and streamed body in the SDK's own shape", async () => {
    const url = `data:application/json,${encodeURIComponent('{"object":"page"}')}`;
    const read = await globalNotionFetch(url, { method: "GET" });
    expect([read.ok, read.status]).toEqual([true, 200]);
    expect(await read.text()).toBe('{"object":"page"}');
    const streamed = await globalNotionFetch(url, { method: "GET" });
    const reader = streamed.body!.getReader();
    const chunks: Uint8Array[] = [];
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      chunks.push(chunk.value!);
    }
    reader.releaseLock();
    expect(Buffer.concat(chunks).toString("utf8")).toBe('{"object":"page"}');
  });
});
