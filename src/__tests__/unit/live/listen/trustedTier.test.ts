/**
 * The trusted tier: the pure parse and verdict, and the filesystem edge that turns `trusted-askers.json` into
 * one of its states. Absent is nobody trusted, never a refusal and never a fallback to the who-may-tag list.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { askerTrust, parseTrustedTier, type TrustedTier } from "../../../../live/listen/trustedTier.js";
import { loadTrustedTier } from "../../../../live/listen/trustedTierStore.js";
import { stateHomePaths } from "../../../../stateHome.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp home with nothing in it. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-trusted-"));
  fixtureDirs.push(home);
  return home;
}

/** Write `trusted-askers.json` into a temp home with the given raw text, and return the home. */
function seed({ text }: { text: string }): string {
  const home = freshHome();
  writeFileSync(stateHomePaths({ home }).trustedAskersJson, text, "utf8");
  return home;
}

const LIST: TrustedTier = { identities: ["U0DAILY"], kind: "list" };

describe("parseTrustedTier", () => {
  it("accepts an array of ids and collapses duplicates in first-seen order", () => {
    expect(unwrap(parseTrustedTier({ value: ["U0B", "U0A", "U0B"] }))).toEqual(["U0B", "U0A"]);
  });

  it("refuses the whole file over one malformed entry rather than dropping it", () => {
    expect(unwrapErr(parseTrustedTier({ value: ["U0A", "U 0B"] }))).toEqual([
      "every entry in trusted-askers.json must be a non-empty Slack user id with no whitespace",
    ]);
  });

  it("refuses a value that is not an array", () => {
    expect(unwrapErr(parseTrustedTier({ value: { U0A: true } }))).toEqual([
      "trusted-askers.json must be a JSON array of Slack user id strings",
    ]);
  });
});

describe("askerTrust", () => {
  it("trusts an exact id on the list", () => {
    expect(askerTrust({ tier: LIST, userId: "U0DAILY" })).toEqual({ trusted: true });
  });

  it("does not trust an id the list does not carry", () => {
    expect(askerTrust({ tier: LIST, userId: "U0OTHER" })).toEqual({
      trusted: false,
      why: "`U0OTHER` is not on trusted-askers.json",
    });
  });

  it("trusts nobody when the file is absent, and says the tier is unsettled", () => {
    expect(askerTrust({ tier: { kind: "absent" }, userId: "U0DAILY" })).toEqual({
      trusted: false,
      why: "no trusted-askers.json under $SLOPWEAVER_HOME — nobody is on the tier yet",
    });
  });

  it("trusts nobody when the file is unreadable, and names why", () => {
    expect(askerTrust({ tier: { kind: "unreadable", why: "not JSON" }, userId: "U0DAILY" })).toEqual({
      trusted: false,
      why: "trusted-askers.json could not be read (not JSON) — nobody counts as trusted",
    });
  });
});

describe("loadTrustedTier", () => {
  it("loads a valid list", () => {
    expect(loadTrustedTier({ home: seed({ text: JSON.stringify(["U0DAILY"]) }) })).toEqual(LIST);
  });

  it("loads an absent file as absent, never from responders.json", () => {
    const home = freshHome();
    writeFileSync(stateHomePaths({ home }).respondersJson, JSON.stringify(["U0DAILY"]), "utf8");
    expect(loadTrustedTier({ home })).toEqual({ kind: "absent" });
  });

  it("loads non-JSON as unreadable", () => {
    expect(loadTrustedTier({ home: seed({ text: "U0DAILY" }) })).toEqual({
      kind: "unreadable",
      why: "trusted-askers.json is not valid JSON",
    });
  });

  it("loads a malformed entry as unreadable with the parse reason", () => {
    expect(loadTrustedTier({ home: seed({ text: JSON.stringify([""]) }) })).toEqual({
      kind: "unreadable",
      why: "every entry in trusted-askers.json must be a non-empty Slack user id with no whitespace",
    });
  });
});
