import { describe, expect, it } from "vitest";
import { identifierWords, novelWordCount } from "../../../devLint/commentQuality.js";

describe("identifierWords", () => {
  it("splits camelCase into lowercase parts", () => {
    expect(identifierWords({ name: "tsIso" })).toEqual(["ts", "iso"]);
  });

  it("splits an acronym run before a trailing word", () => {
    expect(identifierWords({ name: "URLPath" })).toEqual(["url", "path"]);
  });

  it("splits snake_case and kebab-case", () => {
    expect(identifierWords({ name: "home_dir" })).toEqual(["home", "dir"]);
    expect(identifierWords({ name: "home-dir" })).toEqual(["home", "dir"]);
  });

  it("leaves a single lowercase word alone", () => {
    expect(identifierWords({ name: "home" })).toEqual(["home"]);
  });

  it("splits a digit run from its neighbouring letters on both sides", () => {
    expect(identifierWords({ name: "http2Port" })).toEqual(["http", "2", "port"]);
    expect(identifierWords({ name: "s3Bucket" })).toEqual(["s", "3", "bucket"]);
  });
});

describe("novelWordCount", () => {
  it("is zero for a literal restatement of the parameter name", () => {
    expect(novelWordCount({ description: "the source", name: "source" })).toBe(0);
  });

  it("is zero for glue words alone, even split across the identifier's own parts", () => {
    expect(novelWordCount({ description: "the ts iso to use", name: "tsIso" })).toBe(0);
  });

  it("counts every novel word carrying a real constraint", () => {
    expect(novelWordCount({ description: "the decision timestamp", name: "tsIso" })).toBe(2);
  });

  it("counts distinct novel words once each, not per occurrence", () => {
    expect(novelWordCount({ description: "the decision, the decision timestamp", name: "tsIso" })).toBe(2);
  });

  it("ignores case when matching against the identifier", () => {
    expect(novelWordCount({ description: "the Source path", name: "source" })).toBe(1);
  });

  it("is zero for an empty description", () => {
    expect(novelWordCount({ description: "", name: "home" })).toBe(0);
  });

  it("counts every genuinely new word in a longer description", () => {
    expect(
      novelWordCount({ description: "the resolved state home, defaulting to the ambient install", name: "home" }),
    ).toBe(5);
  });

  it("recognises a restatement that spells out the identifier's embedded digit", () => {
    // Without the digit-boundary split, "http2Port" splits to {"http2", "port"} — neither matches the
    // description's bare "http", so the restatement would be miscredited with one novel word.
    expect(novelWordCount({ description: "the HTTP 2 port", name: "http2Port" })).toBe(0);
  });

  it("recognises a restatement that spells the identifier out inline, camelCase and all", () => {
    // Without splitting the description's own words, "tsIso" lowercases to the single glued token "tsiso",
    // which matches neither "ts" nor "iso" — the restatement would be miscredited with one novel word.
    expect(novelWordCount({ description: "the tsIso value", name: "tsIso" })).toBe(0);
  });

  it("strips a trailing possessive before comparing against the identifier", () => {
    expect(novelWordCount({ description: "the user's config", name: "user" })).toBe(1);
  });

  it("strips a bare trailing possessive apostrophe (plural possessive)", () => {
    expect(novelWordCount({ description: "the users' shared config", name: "users" })).toBe(2);
  });

  it("strips a possessive typed with a curly apostrophe, not just a straight one", () => {
    expect(novelWordCount({ description: "the user’s config", name: "user" })).toBe(1);
  });

  it("treats a description's digit run as novel when it names a different digit than the identifier", () => {
    // "3" is captured and compared like any other word now — it does not match "http2Port"'s own "2", so
    // this is genuinely novel content (a different port), not the restatement "the HTTP 2 port" would be.
    expect(novelWordCount({ description: "the HTTP 3 port", name: "http2Port" })).toBe(1);
  });
});
