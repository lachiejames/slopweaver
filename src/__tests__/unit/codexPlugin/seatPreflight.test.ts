/**
 * `cmux spawn`'s Codex plugin preflight over synthetic homes: only a MISSING install, or one whose stamp cannot be
 * looked up, refuses, each under its own code; an install behind HEAD, a stamp that does not parse, or one under any
 * marketplace's directory boots. The preflight reads the home
 * alone, never a marketplace file, and every path is under a throwaway root, so no case reads a real Codex home.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CodexPluginSeatErrors } from "../../../codexPlugin/seatErrors.js";
import { admitCodexPluginSeat, preflightCodexPluginSeat } from "../../../codexPlugin/seatPreflight.js";
import { unwrapErr } from "../../../lib/result.js";
import { cacheOf, loopInstallPath, stampInstall } from "./fleetFixture.js";

const OLD_COMMIT = "0123456789abcdef0123456789abcdef01234567";

const roots: string[] = [];

/** One empty Codex home under a throwaway root. */
function emptyCodexHome(): string {
  const root = mkdtempSync(join(tmpdir(), "codex-seat-preflight-"));
  roots.push(root);
  const codexHome = join(root, "codex");
  mkdirSync(codexHome);
  return codexHome;
}

/** Where the install stamp of `codexHome` sits under the named marketplace directory. */
function stampPathOf({ codexHome, marketplace }: { codexHome: string; marketplace: string }): string {
  return join(cacheOf({ codexHome, marketplace }), ".codex-plugin", "source.json");
}

/** The exact refusal for a home with no stamp in any marketplace directory. */
function missingRefusal({ codexHome }: { codexHome: string }): unknown {
  const stampPath = stampPathOf({ codexHome, marketplace: "*" });
  return {
    code: "PLUGIN_INSTALL_MISSING",
    codexHome,
    message:
      `the Codex home ${codexHome} has no Slopweaver plugin installed (no ${stampPath}), so a seat there would boot ` +
      "without Slopweaver's skills and hooks — run `slopweaver codex plugin-sync` from the main checkout, then spawn again",
    stampPath,
  };
}

afterEach(() => {
  roots.splice(0).forEach((root) => {
    rmSync(root, { force: true, recursive: true });
  });
});

describe("whether a Codex seat may boot on its routed home", () => {
  it("refuses a home with no plugin cache at all, naming the home, where it looked and the repair", () => {
    const codexHome = emptyCodexHome();

    expect(unwrapErr(preflightCodexPluginSeat({ codexHome }))).toEqual(missingRefusal({ codexHome }));
  });

  it("refuses a home whose cache holds a marketplace directory with no Slopweaver stamp in it", () => {
    const codexHome = emptyCodexHome();
    mkdirSync(join(codexHome, "plugins", "cache", "personal", "other-plugin"), { recursive: true });

    expect(unwrapErr(preflightCodexPluginSeat({ codexHome }))).toEqual(missingRefusal({ codexHome }));
  });

  it("boots on an install stamped with an old commit, never comparing it to HEAD", () => {
    const codexHome = emptyCodexHome();
    stampInstall({ codexHome, commit: OLD_COMMIT });

    expect(preflightCodexPluginSeat({ codexHome }).isOk()).toBe(true);
  });

  it("boots on a present stamp that does not parse, which only a missing install refuses", () => {
    const codexHome = emptyCodexHome();
    const stampPath = stampPathOf({ codexHome, marketplace: "personal" });
    mkdirSync(join(stampPath, ".."), { recursive: true });
    writeFileSync(stampPath, "not a stamp");

    expect(preflightCodexPluginSeat({ codexHome }).isOk()).toBe(true);
  });

  // The review's counterexample: an installed home must boot whatever the marketplace file says, and here there
  // is no marketplace file anywhere, while the install sits under a marketplace named other than `personal`.
  it("boots on an install under any marketplace's directory, with no marketplace file to read", () => {
    const codexHome = emptyCodexHome();
    mkdirSync(join(codexHome, "plugins", "cache", "personal"), { recursive: true });
    const stampPath = stampPathOf({ codexHome, marketplace: "acme-tools" });
    mkdirSync(join(stampPath, ".."), { recursive: true });
    writeFileSync(stampPath, JSON.stringify({ commit: OLD_COMMIT }));

    expect(preflightCodexPluginSeat({ codexHome }).isOk()).toBe(true);
  });

  it("refuses as missing, byte for byte, when a directory above the stamp is a file (ENOTDIR)", () => {
    const codexHome = emptyCodexHome();
    const marketplaceDir = join(codexHome, "plugins", "cache", "personal");
    mkdirSync(marketplaceDir, { recursive: true });
    writeFileSync(join(marketplaceDir, "slopweaver"), "not a directory");

    expect(unwrapErr(preflightCodexPluginSeat({ codexHome }))).toEqual(missingRefusal({ codexHome }));
  });

  // A stamp lookup that fails for a reason other than the stamp not being there refuses as unreadable. ELOOP stands
  // in for EACCES here because a self-loop fails the lookup for root as well, where a mode-000 directory would not.
  it("refuses as unreadable, never missing, when the stamp's path cannot be looked up", () => {
    const codexHome = emptyCodexHome();
    const stampPath = loopInstallPath({ codexHome });

    const refused = unwrapErr(preflightCodexPluginSeat({ codexHome }));

    expect(refused.code).toBe("PLUGIN_INSTALL_UNREADABLE");
    expect(refused).toHaveProperty("stampPath", stampPath);
    expect(refused.message).toContain(`the Slopweaver plugin install at ${stampPath} could not be read (`);
    expect(refused.message).toContain("ELOOP");
  });

  it("boots when one marketplace's stamp cannot be looked up and another holds an install", () => {
    const codexHome = emptyCodexHome();
    loopInstallPath({ codexHome, marketplace: "acme-tools" });
    stampInstall({ codexHome, commit: OLD_COMMIT });

    expect(preflightCodexPluginSeat({ codexHome }).isOk()).toBe(true);
  });

  it("refuses a plugin cache that exists and cannot be listed, since Codex cannot load from it either", () => {
    const codexHome = emptyCodexHome();
    const cacheRoot = join(codexHome, "plugins", "cache");
    mkdirSync(join(codexHome, "plugins"));
    // A file where the directory should be: listing it fails for any user, root included.
    writeFileSync(cacheRoot, "not a directory");

    const refused = unwrapErr(preflightCodexPluginSeat({ codexHome }));

    expect(refused.code).toBe("PLUGIN_CACHE_UNREADABLE");
    expect(refused).toHaveProperty("cacheRoot", cacheRoot);
    expect(refused.message).toContain(`the Codex home ${codexHome} cannot be checked for the Slopweaver plugin`);
    expect(refused.message).toContain("ENOTDIR");
  });
});

describe("the pure admission over a home's install states", () => {
  const codexHome = "/home/acme/.codex";
  const stampPath = "/home/acme/.codex/plugins/cache/personal/slopweaver/local/.codex-plugin/source.json";

  it("refuses when every marketplace directory's stamp is absent, or there are none", () => {
    expect(unwrapErr(admitCodexPluginSeat({ codexHome, states: [] })).code).toBe("PLUGIN_INSTALL_MISSING");
    expect(unwrapErr(admitCodexPluginSeat({ codexHome, states: [{ kind: "absent", stampPath }] })).code).toBe(
      "PLUGIN_INSTALL_MISSING",
    );
  });

  it("admits a home where any one stamp is installed or invalid", () => {
    const installed = { commit: OLD_COMMIT, kind: "installed", stampPath } as const;
    const invalid = { kind: "invalid", stampPath, why: "bad json" } as const;

    expect(admitCodexPluginSeat({ codexHome, states: [{ kind: "absent", stampPath }, installed] }).isOk()).toBe(true);
    expect(admitCodexPluginSeat({ codexHome, states: [invalid] }).isOk()).toBe(true);
  });

  it("refuses as unreadable, naming that stamp, when nothing admits and one lookup could not decide", () => {
    const unreadable = { kind: "unreadable", stampPath, why: "EACCES: permission denied" } as const;
    const expected = CodexPluginSeatErrors.installUnreadable({
      codexHome,
      stampPath,
      why: "EACCES: permission denied",
    });

    expect(unwrapErr(admitCodexPluginSeat({ codexHome, states: [unreadable] }))).toEqual(expected);
    expect(
      unwrapErr(
        admitCodexPluginSeat({
          codexHome,
          states: [{ kind: "absent", stampPath: "/home/acme/.codex/other" }, unreadable],
        }),
      ),
    ).toEqual(expected);
  });

  it("admits a home where an unreadable lookup sits beside an installed or invalid stamp", () => {
    const unreadable = { kind: "unreadable", stampPath, why: "EACCES: permission denied" } as const;
    const installed = { commit: OLD_COMMIT, kind: "installed", stampPath } as const;
    const invalid = { kind: "invalid", stampPath, why: "bad json" } as const;

    expect(admitCodexPluginSeat({ codexHome, states: [unreadable, installed] }).isOk()).toBe(true);
    expect(admitCodexPluginSeat({ codexHome, states: [unreadable, invalid] }).isOk()).toBe(true);
  });
});
