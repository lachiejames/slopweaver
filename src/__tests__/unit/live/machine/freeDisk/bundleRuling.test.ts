/**
 * The owner's bundle ruling, read from a throwaway state home: an absent file rules nothing removable, a valid
 * one is read exactly, and a malformed or path-naming one is refused rather than read as empty.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { parseBundleRuling, readBundleRuling } from "../../../../../live/machine/freeDisk/bundleRuling.js";

const homes: string[] = [];

/** A fresh state home, holding the ruling file when `text` is given. */
function home({ text }: { text?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "bundle-ruling-"));
  homes.push(dir);
  if (text !== undefined) {
    mkdirSync(join(dir, "machine"));
    writeFileSync(join(dir, "machine", "free-disk-bundles.json"), text);
  }
  return dir;
}

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("readBundleRuling", () => {
  it("reads an absent file as a ruling that names nothing", () => {
    expect(unwrap(readBundleRuling({ home: home() }))).toEqual({ kept: [], removable: [] });
  });

  it("reads a valid ruling exactly", () => {
    const text = JSON.stringify({ kept: ["Acme Browser.app"], removable: ["Acme Scanner Edition.app"] });
    expect(unwrap(readBundleRuling({ home: home({ text }) }))).toEqual({
      kept: ["Acme Browser.app"],
      removable: ["Acme Scanner Edition.app"],
    });
  });

  it("refuses a file that is there but is not JSON, naming its path", () => {
    const dir = home({ text: "{ not json" });
    expect(unwrapErr(readBundleRuling({ home: dir })).message).toBe(
      `${join(dir, "machine", "free-disk-bundles.json")} is not a bundle ruling (it is not JSON); nothing was read as approved`,
    );
  });
});

describe("parseBundleRuling", () => {
  it("refuses a path for a name, a name without .app, an unknown key and a missing list", () => {
    const texts = [
      { kept: [], removable: ["/Applications/Acme.app"] },
      { kept: [], removable: ["Acme Scanner"] },
      { kept: [], removable: [], extra: true },
      { removable: [] },
    ].map((value) => unwrapErr(parseBundleRuling({ path: "ruling.json", text: JSON.stringify(value) })).code);
    expect(texts).toEqual([
      "BUNDLE_RULING_INVALID",
      "BUNDLE_RULING_INVALID",
      "BUNDLE_RULING_INVALID",
      "BUNDLE_RULING_INVALID",
    ]);
  });

  it("says why a name was refused", () => {
    const text = JSON.stringify({ kept: [], removable: ["/Applications/Acme.app"] });
    expect(unwrapErr(parseBundleRuling({ path: "ruling.json", text })).message).toBe(
      "ruling.json is not a bundle ruling (a bundle name ending .app, never a path); nothing was read as approved",
    );
  });
});
