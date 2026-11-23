/**
 * `talk file read --words` over a throwaway home (`src/talk/pageWordsRead.ts`): a page's words are masked AFTER its
 * markup is gone. An entity or a tag inside a token hid it from a mask run
 * over markup, and decoding afterwards handed the voice the token whole.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { TalkErrors } from "../../../talk/errors.js";
import type { LocalReadPolicy } from "../../../talk/localFile.js";
import { LocalFileErrors } from "../../../talk/localFileErrors.js";
import { credentialStores } from "../../../talk/localPath.js";
import { readPageWords } from "../../../talk/pageWordsRead.js";

/** A GitHub token's prefix, spelled apart so this file carries no token shape. */
const GH = ["gh", "p"].join("");

/** A GitHub token's body. */
const BODY = "A1".repeat(18);

let home = "";
let pages = "";
let policy: LocalReadPolicy;

/**
 * Publish one page under the throwaway home.
 *
 * @returns the page's path
 */
function page({ slug, html }: { slug: string; html: string }): string {
  mkdirSync(join(pages, slug), { recursive: true });
  const path = join(pages, slug, "index.html");
  writeFileSync(path, html);
  return path;
}

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "page-words-")));
  const slopweaverHome = join(home, ".slopweaver");
  pages = join(slopweaverHome, "pages");
  mkdirSync(pages, { recursive: true });
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

describe("readPageWords", () => {
  it("masks a token an entity hid from the markup, once the entity is decoded", () => {
    const raw = page({ html: `<p>key ${GH}&#95;${BODY}</p>`, slug: "entity" });
    const read = unwrap(readPageWords({ budget: 4096, from: 0, policy, raw }));
    expect(read.text).toBe("key [redacted:github-token]");
    expect(read.redactions).toEqual([{ count: 1, label: "github-token" }]);
  });

  it("masks a token a tag split, once the tag is gone", () => {
    const raw = page({ html: `<p>key ${GH}_<b></b>${BODY}</p>`, slug: "split" });
    expect(unwrap(readPageWords({ budget: 4096, from: 0, policy, raw })).text).toBe("key [redacted:github-token]");
  });

  it("masks a denylisted string an entity spelled", () => {
    const raw = page({ html: "<p>pw hunter2&#45;private</p>", slug: "denied" });
    expect(unwrap(readPageWords({ budget: 4096, from: 0, policy, raw })).text).toBe("pw [redacted:denylist]");
  });

  it("reads the words whole, counting bytes of words, with nothing left", () => {
    const raw = page({
      html: "<html><head><style>x{}</style></head><body><h1>One</h1><p>Two</p></body></html>",
      slug: "w",
    });
    const read = unwrap(readPageWords({ budget: 4096, from: 0, policy, raw }));
    expect([read.text, read.size, read.window]).toEqual([
      "One\nTwo",
      7,
      { end: 7, nextFrom: null, start: 0, truncated: false },
    ]);
  });

  it("windows the words on a line break and continues from nextFrom", () => {
    const raw = page({ html: "<p>first line</p><p>second line</p>", slug: "paged" });
    const first = unwrap(readPageWords({ budget: 14, from: 0, policy, raw }));
    expect([first.text, first.window]).toEqual(["first line\n", { end: 11, nextFrom: 11, start: 0, truncated: true }]);
    const second = unwrap(readPageWords({ budget: 14, from: 11, policy, raw }));
    expect([second.text, second.window.nextFrom]).toEqual(["second line", null]);
  });

  // A card carries a briefing's words cut to a UTF-8 prefix and resumes at that prefix's
  // bytes (`site/lib/cardBriefings.ts`), so those bytes must be exactly where a words read from them picks up.
  it("resumes a multibyte page's words at a prefix's UTF-8 bytes, neither skipping nor repeating any", () => {
    const raw = page({ html: "<p>café — naïve</p><p>日本語の文章</p><p>señor</p>", slug: "multibyte" });
    const whole = unwrap(readPageWords({ budget: 4096, from: 0, policy, raw })).text;
    const prefix = Array.from(whole).slice(0, 9).join("");
    const from = Buffer.byteLength(prefix, "utf8");
    const rest = unwrap(readPageWords({ budget: 4096, from, policy, raw }));
    expect([from > prefix.length, `${prefix}${rest.text}`, rest.window.start]).toEqual([true, whole, from]);
  });

  it("refuses a file that is not an HTML page, and an offset past the words", () => {
    mkdirSync(join(home, "notes"));
    writeFileSync(join(home, "notes", "a.txt"), "plain\n");
    const raw = page({ html: "<p>ab</p>", slug: "short" });
    expect([
      unwrapErr(readPageWords({ budget: 4096, from: 0, policy, raw: join(home, "notes", "a.txt") })),
      unwrapErr(readPageWords({ budget: 4096, from: 9, policy, raw })),
    ]).toEqual([
      LocalFileErrors.notAPage({ path: join(home, "notes", "a.txt"), why: "it is not an HTML page" }),
      TalkErrors.windowInvalid({ from: 9, size: 2 }),
    ]);
  });
});
