import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CodexPluginSyncErrors } from "../../../codexPlugin/errors.js";
import { SLOPWEAVER_MARKETPLACE_ENTRY } from "../../../codexPlugin/marketplacePlan.js";
import {
  ensurePersonalMarketplace,
  personalMarketplaceEntry,
  readPersonalMarketplace,
} from "../../../codexPlugin/marketplaceStore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { MARKETPLACE_WITH_SLOPWEAVER, marketplacePath, writeMarketplace } from "./fleetFixture.js";

let userHome: string;

beforeEach(() => {
  userHome = mkdtempSync(join(tmpdir(), "codex-marketplace-"));
});

afterEach(() => {
  rmSync(userHome, { force: true, recursive: true });
});

describe("readPersonalMarketplace", () => {
  it("tells an absent file apart from an unparseable one", () => {
    expect(unwrap(readPersonalMarketplace({ userHome }))).toEqual({
      document: undefined,
      path: marketplacePath({ userHome }),
      raw: undefined,
    });
    writeMarketplace({ raw: "{", userHome });
    expect(unwrapErr(readPersonalMarketplace({ userHome })).code).toBe("MARKETPLACE_UNREADABLE");
  });
});

describe("personalMarketplaceEntry", () => {
  it("never writes, and says why there is no entry for an absent file and for one without slopweaver", () => {
    const path = marketplacePath({ userHome });
    expect(unwrap(personalMarketplaceEntry({ userHome }))).toEqual({
      skip: `no personal Codex marketplace at ${path}`,
    });
    expect(existsSync(path)).toBe(false);

    writeMarketplace({ raw: JSON.stringify({ name: "mine", plugins: [] }), userHome });
    expect(unwrap(personalMarketplaceEntry({ userHome }))).toEqual({
      skip: `the personal Codex marketplace at ${path} lists no slopweaver plugin yet`,
    });
    expect(readFileSync(path, "utf8")).toBe(JSON.stringify({ name: "mine", plugins: [] }));
  });

  it("reads the local entry where there is one", () => {
    writeMarketplace({ raw: JSON.stringify(MARKETPLACE_WITH_SLOPWEAVER), userHome });
    expect(unwrap(personalMarketplaceEntry({ userHome }))).toEqual({
      marketplace: "personal",
      sourcePath: join(userHome, "plugins", "slopweaver"),
    });
  });
});

describe("ensurePersonalMarketplace", () => {
  it("creates an absent file with the seed, and is then a no-op that leaves its bytes alone", () => {
    const entry = unwrap(ensurePersonalMarketplace({ userHome }));
    const written = readFileSync(marketplacePath({ userHome }), "utf8");

    expect(entry).toEqual({ marketplace: "personal", sourcePath: join(userHome, "plugins", "slopweaver") });
    expect(JSON.parse(written)).toEqual(MARKETPLACE_WITH_SLOPWEAVER);
    expect(unwrap(ensurePersonalMarketplace({ userHome }))).toEqual(entry);
    expect(readFileSync(marketplacePath({ userHome }), "utf8")).toBe(written);
  });

  it("never overwrites an unparseable file", () => {
    writeMarketplace({ raw: "not json", userHome });
    expect(unwrapErr(ensurePersonalMarketplace({ userHome })).code).toBe("MARKETPLACE_UNREADABLE");
    expect(readFileSync(marketplacePath({ userHome }), "utf8")).toBe("not json");
  });

  it.each([
    ["an overflowing number", '{"name":"mine","plugins":[],"extra":1e400}'],
    ["negative zero", '{"name":"mine","plugins":[],"extra":-0}'],
    ["an integer past 2^53, which parses already rounded", '{"name":"mine","plugins":[],"extra":9007199254740993}'],
  ])("never rewrites a file holding %s, which JSON would write back differently", (_label, raw) => {
    writeMarketplace({ raw, userHome });
    const path = marketplacePath({ userHome });
    expect(unwrapErr(ensurePersonalMarketplace({ userHome }))).toEqual(
      CodexPluginSyncErrors.marketplaceUnreadable({
        detail: "it holds a number JSON would write back differently, such as 1e400, so it is never rewritten",
        path,
      }),
    );
    expect(readFileSync(path, "utf8")).toBe(raw);
  });

  it("appends to a file whose numbers are already spelled as JSON writes them", () => {
    writeMarketplace({ raw: '{"name":"mine","plugins":[],"extra":9007199254740991}', userHome });
    expect(unwrap(ensurePersonalMarketplace({ userHome }))).toEqual({
      marketplace: "mine",
      sourcePath: join(userHome, "plugins", "slopweaver"),
    });
    expect(JSON.parse(readFileSync(marketplacePath({ userHome }), "utf8"))).toEqual({
      extra: 9007199254740991,
      name: "mine",
      plugins: [SLOPWEAVER_MARKETPLACE_ENTRY],
    });
  });

  it.each([
    ["is the marketplace file", "./.agents/plugins/marketplace.json"],
    ["holds the marketplace file", "./.agents/plugins"],
  ])("skips a local entry whose source path %s, leaving the file's bytes alone", (_how, sourcePath) => {
    const raw = JSON.stringify({
      name: "mine",
      plugins: [{ name: "slopweaver", source: { path: sourcePath, source: "local" } }],
    });
    writeMarketplace({ raw, userHome });
    expect(unwrap(ensurePersonalMarketplace({ userHome }))).toEqual({
      skip: `slopweaver's source path ${join(userHome, sourcePath)} holds the marketplace file itself`,
    });
    expect(readFileSync(marketplacePath({ userHome }), "utf8")).toBe(raw);
  });

  it("skips a source path that reaches the marketplace file through a linked parent directory", () => {
    const raw = JSON.stringify({
      name: "mine",
      plugins: [{ name: "slopweaver", source: { path: "./plugins/marketplace.json", source: "local" } }],
    });
    writeMarketplace({ raw, userHome });
    symlinkSync(join(userHome, ".agents", "plugins"), join(userHome, "plugins"));
    expect(unwrap(ensurePersonalMarketplace({ userHome }))).toEqual({
      skip: `slopweaver's source path ${join(userHome, "plugins", "marketplace.json")} holds the marketplace file itself`,
    });
    expect(readFileSync(marketplacePath({ userHome }), "utf8")).toBe(raw);
  });

  it("leaves a non-local slopweaver entry exactly as it was", () => {
    const raw = JSON.stringify({ name: "mine", plugins: [{ name: "slopweaver", source: { source: "git" } }] });
    writeMarketplace({ raw, userHome });
    expect(unwrap(ensurePersonalMarketplace({ userHome }))).toEqual({
      skip: "marketplace mine's slopweaver is a git source, not a local path",
    });
    expect(readFileSync(marketplacePath({ userHome }), "utf8")).toBe(raw);
  });
});
