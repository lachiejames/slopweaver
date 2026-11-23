/**
 * A published page's document read out of the store for the voice (`src/talk/heldPage.ts`): which paths are a page's
 * address, and that held bytes are windowed, outlined and masked exactly as the same bytes read off disk.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { TalkErrors } from "../../../talk/errors.js";
import { heldPageRefusal, publishedPageOf, readHeldPage } from "../../../talk/heldPage.js";
import { type LocalRead, type LocalReadPolicy, readLocalFile } from "../../../talk/localFile.js";
import { LocalFileErrors } from "../../../talk/localFileErrors.js";
import type { LocalImageRead } from "../../../talk/localImage.js";
import { credentialStores } from "../../../talk/localPath.js";
import { readPageWords } from "../../../talk/pageWordsRead.js";

/** A GitHub token's prefix, spelled apart so this file carries no token shape. */
const GH = ["gh", "p"].join("");

/** A GitHub token's body. */
const BODY = "A1".repeat(18);

/** A page with an outline, an entity-split token and a denylisted string, so every masking pass has work. */
const HTML = [
  "<html><head><title>acme briefing</title></head><body>",
  "<h1>Where ABC-1 stands</h1>",
  `<p>key ${GH}&#95;${BODY} and hunter2-private</p>`,
  "<h2>Next</h2>",
  `<p>${"words ".repeat(400)}</p>`,
  "</body></html>",
].join("\n");

/**
 * The text read a case expects, narrowed; a picture throws, so a read of the wrong kind fails the case loudly.
 *
 * @returns the read, as text
 */
function textRead({ read }: { read: LocalRead | LocalImageRead }): LocalRead {
  if (read.kind !== "text") {
    throw new Error(`expected a text read, got a ${read.kind} read`);
  }
  return read;
}

let home = "";
let slopweaverHome = "";
let policy: LocalReadPolicy;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "held-page-")));
  slopweaverHome = join(home, ".slopweaver");
  mkdirSync(join(slopweaverHome, "pages", "briefing"), { recursive: true });
  writeFileSync(join(slopweaverHome, "pages", "briefing", "index.html"), HTML);
  policy = {
    denylist: ["hunter2-private"],
    homeDir: home,
    protectedPaths: [],
    refusalsLifted: false,
    stores: credentialStores({ homeDir: home, homeEntries: [], slopweaverHomes: [slopweaverHome] }),
  };
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("publishedPageOf", () => {
  it("names the slug and the canonical address of a page's document, in every spelling of it", () => {
    const address = join(slopweaverHome, "pages", "briefing", "index.html");
    const spellings = [
      address,
      "~/.slopweaver/pages/briefing/index.html",
      join(slopweaverHome, "pages", "other", "..", "briefing", "index.html"),
      `${slopweaverHome}//pages/briefing/./index.html`,
    ];
    expect(spellings.map((raw) => publishedPageOf({ home: `${slopweaverHome}/`, homeDir: home, raw }))).toEqual(
      spellings.map(() => ({ address, slug: "briefing" })),
    );
  });

  it("names nothing for any other file, under the pages directory or not", () => {
    const others = [
      join(slopweaverHome, "pages", "briefing", "shot.png"),
      join(slopweaverHome, "pages", "briefing", "deeper", "index.html"),
      join(slopweaverHome, "pages", "index.html"),
      join(slopweaverHome, "pages", ".hidden", "index.html"),
      join(home, "elsewhere", "pages", "briefing", "index.html"),
      "pages/briefing/index.html",
    ];
    expect(others.map((raw) => publishedPageOf({ home: slopweaverHome, homeDir: home, raw }))).toEqual(
      others.map(() => undefined),
    );
  });
});

describe("heldPageRefusal", () => {
  it("refuses a page address inside a credential store exactly as the file off disk is, unless the hatch lifts it", () => {
    const address = join(slopweaverHome, "pages", "briefing", "index.html");
    const inside = { ...policy, stores: [...policy.stores, slopweaverHome] };

    expect(heldPageRefusal({ path: address, policy: inside })).toEqual(
      LocalFileErrors.refused({ path: address, rule: "credential-store" }),
    );
    expect(heldPageRefusal({ path: address, policy: inside })).toEqual(
      unwrapErr(readLocalFile({ budget: 64, from: 0, policy: inside, raw: address })),
    );
    expect(heldPageRefusal({ path: address, policy: { ...inside, refusalsLifted: true } })).toBeUndefined();
    expect(heldPageRefusal({ path: address, policy })).toBeUndefined();
  });
});

describe("readHeldPage", () => {
  const path = (): string => join(slopweaverHome, "pages", "briefing", "index.html");
  const bytes = (): Uint8Array => new TextEncoder().encode(HTML);

  it("reads held markup exactly as the same file off disk, outline and masks included", () => {
    const held = readHeldPage({
      budget: 512,
      bytes: bytes(),
      denylist: policy.denylist,
      from: 0,
      path: path(),
      words: false,
    });
    const disk = readLocalFile({ budget: 512, from: 0, policy, raw: path() });
    expect(unwrap(held)).toEqual(unwrap(disk));
    expect(textRead({ read: unwrap(held) }).outline.map((heading) => heading.text)).toEqual([
      "Where ABC-1 stands",
      "Next",
    ]);
  });

  it("reads held words exactly as the same file off disk, the entity-split token and the denylist masked", () => {
    const held = textRead({
      read: unwrap(
        readHeldPage({ budget: 1024, bytes: bytes(), denylist: policy.denylist, from: 0, path: path(), words: true }),
      ),
    });
    const disk = unwrap(readPageWords({ budget: 1024, from: 0, policy, raw: path() }));
    expect(held).toEqual(disk);
    expect(held.text).not.toContain(BODY);
    expect(held.text).not.toContain("hunter2-private");
    expect(HTML).toContain("hunter2-private");
    expect(held.window.nextFrom).toBe(disk.window.nextFrom);
    expect(held.window.truncated).toBe(true);
  });

  it("continues a words read from the offset the first one handed back, as a disk read does", () => {
    const first = textRead({
      read: unwrap(readHeldPage({ budget: 1024, bytes: bytes(), denylist: [], from: 0, path: path(), words: true })),
    });
    const from = first.window.nextFrom!;
    const held = readHeldPage({ budget: 1024, bytes: bytes(), denylist: [], from, path: path(), words: true });
    expect(unwrap(held)).toEqual(
      unwrap(readPageWords({ budget: 1024, from, policy: { ...policy, denylist: [] }, raw: path() })),
    );
  });

  it("reads a document whose first bytes name a picture as that picture, and refuses its words, as off disk", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x41, 0x42, 0x43]);
    writeFileSync(path(), jpeg);
    const read = ({ words }: { words: boolean }) =>
      readHeldPage({ budget: 64, bytes: jpeg, denylist: [], from: 0, path: path(), words });

    expect(unwrap(read({ words: false }))).toEqual(unwrap(readLocalFile({ budget: 64, from: 0, policy, raw: path() })));
    expect(unwrap(read({ words: false })).kind).toBe("image");
    expect(unwrapErr(read({ words: true }))).toEqual(
      unwrapErr(readPageWords({ budget: 64, from: 0, policy, raw: path() })),
    );
    expect(unwrapErr(read({ words: true }))).toEqual(
      LocalFileErrors.notAPage({ path: path(), why: "it is not an HTML page" }),
    );
  });

  it("refuses an offset past the document, and binary bytes, naming the address", () => {
    const past = readHeldPage({ budget: 64, bytes: bytes(), denylist: [], from: 999_999, path: path(), words: false });
    expect(unwrapErr(past)).toEqual(TalkErrors.windowInvalid({ from: 999_999, size: bytes().byteLength }));
    const binary = new Uint8Array([0x3c, 0x70, 0x00, 0x3e]);
    const refused = readHeldPage({ budget: 64, bytes: binary, denylist: [], from: 0, path: path(), words: false });
    expect(unwrapErr(refused)).toEqual(LocalFileErrors.binary({ path: path(), size: 4 }));
  });
});
