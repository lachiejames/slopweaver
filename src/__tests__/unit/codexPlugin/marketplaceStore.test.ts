import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

  it("leaves a non-local slopweaver entry exactly as it was", () => {
    const raw = JSON.stringify({ name: "mine", plugins: [{ name: "slopweaver", source: { source: "git" } }] });
    writeMarketplace({ raw, userHome });
    expect(unwrap(ensurePersonalMarketplace({ userHome }))).toEqual({
      skip: "marketplace mine's slopweaver is a git source, not a local path",
    });
    expect(readFileSync(marketplacePath({ userHome }), "utf8")).toBe(raw);
  });
});
