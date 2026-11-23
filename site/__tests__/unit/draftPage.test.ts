import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { htmlDocumentOf, serveDraftMediaPage } from "../../lib/draftMediaServe";
import { PAGE_CSP } from "../../lib/localPageServe";

const SHA = "06a776a9722bac62d757a9ab8c0b69d842d3e571d8df54bd2fefd6354a39448c";

describe("htmlDocumentOf", () => {
  const bytes = ({ text }: { text: string }): Uint8Array => new TextEncoder().encode(text);

  it("reads a doctype or a root tag, after a byte-order mark and whitespace", () => {
    expect(htmlDocumentOf({ bytes: bytes({ text: "<!DOCTYPE html>\n<p>x</p>" }) })).toBe("<!DOCTYPE html>\n<p>x</p>");
    expect(htmlDocumentOf({ bytes: bytes({ text: "﻿\n  <html lang=en></html>" }) })).toBe("\n  <html lang=en></html>");
  });

  it("refuses text that is not an HTML document, and bytes that are not text", () => {
    expect(htmlDocumentOf({ bytes: bytes({ text: "# a markdown file" }) })).toBe(undefined);
    expect(htmlDocumentOf({ bytes: bytes({ text: "<htmlish>" }) })).toBe(undefined);
    expect(htmlDocumentOf({ bytes: new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, 0x00]) })).toBe(undefined);
  });
});

describe("serveDraftMediaPage", () => {
  let home = "";
  let storeDir = "";

  /** Store `text` content-addressed the way the recorder does, returning its name. */
  const store = ({ text }: { text: string }): string => {
    const sha256 = createHash("sha256").update(text).digest("hex");
    mkdirSync(join(storeDir, sha256.slice(0, 2)), { recursive: true });
    writeFileSync(join(storeDir, sha256.slice(0, 2), sha256), text);
    return sha256;
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "draft-page-"));
    storeDir = join(home, "queue", "slack-draft-media");
    mkdirSync(storeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("answers a stored HTML document as a page under the published-page sandbox", async () => {
    const page = "<!doctype html><h1>Leavers and access</h1>";
    const response = await serveDraftMediaPage({ sha256: store({ text: page }), storeDir });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toBe(PAGE_CSP);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe(page);
  });

  it("refuses stored bytes that are not an HTML document, and a name not in the store", async () => {
    const markdown = await serveDraftMediaPage({ sha256: store({ text: "# notes" }), storeDir });
    expect(markdown.status).toBe(404);
    const missing = await serveDraftMediaPage({ sha256: SHA, storeDir });
    expect([missing.status, await missing.text()]).toEqual([404, `no draft attachment ${SHA}`]);
  });
});
