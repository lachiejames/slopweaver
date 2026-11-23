/**
 * The owner's general rulings: the pure parse, and the filesystem edge that turns `general-rulings.json` into
 * one of its states. Absent is no rulings — per install, never a constant in the shared source.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseGeneralRulings } from "../../../../live/turn/generalRulings.js";
import { loadGeneralRulings } from "../../../../live/turn/generalRulingsStore.js";
import { tagDecisionTreeFor } from "../../../../live/turn/tagDecisionTreeStore.js";
import { stateHomePaths } from "../../../../stateHome.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp home with nothing in it. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-rulings-"));
  fixtureDirs.push(home);
  return home;
}

/** Write `general-rulings.json` into a temp home with the given raw text, and return the home. */
function seed({ text }: { text: string }): string {
  const home = freshHome();
  writeFileSync(stateHomePaths({ home }).generalRulingsJson, text, "utf8");
  return home;
}

const RULING = { act: "investigate immediately", anchor: "talk-call:abc#turn_1", kind: "a failed deployment" };

describe("parseGeneralRulings", () => {
  it("accepts an array of rulings in file order", () => {
    const second = { act: "answer it", anchor: "talk-call:abc#turn_2", kind: "a good-faith question" };
    expect(unwrap(parseGeneralRulings({ value: [RULING, second] }))).toEqual([RULING, second]);
  });

  it("refuses the whole file over one blank field rather than dropping the ruling", () => {
    expect(unwrapErr(parseGeneralRulings({ value: [RULING, { ...RULING, act: "  " }] }))).toEqual([
      "every act in general-rulings.json must be non-blank",
    ]);
  });

  it("refuses an unknown key, which may be a condition nothing would read", () => {
    expect(unwrapErr(parseGeneralRulings({ value: [{ ...RULING, unless: "after hours" }] })).length).toBe(1);
  });

  it("refuses a value that is not an array", () => {
    expect(unwrapErr(parseGeneralRulings({ value: RULING }))).toEqual([
      "general-rulings.json must be a JSON array of { kind, act, anchor } objects",
    ]);
  });
});

describe("loadGeneralRulings", () => {
  it("loads a valid file", () => {
    expect(loadGeneralRulings({ home: seed({ text: JSON.stringify([RULING]) }) })).toEqual({
      kind: "list",
      rulings: [RULING],
    });
  });

  it("loads an absent file as absent", () => {
    expect(loadGeneralRulings({ home: freshHome() })).toEqual({ kind: "absent" });
  });

  it("loads a file the read could not reach as unreadable, never absent", () => {
    const parent = freshHome();
    const home = join(parent, "home-is-a-file");
    writeFileSync(home, "not a directory", "utf8");

    const loaded = loadGeneralRulings({ home });

    expect(loaded.kind).toBe("unreadable");
    expect((loaded as { why: string }).why).toContain("ENOTDIR");
  });

  it("loads non-JSON as unreadable", () => {
    expect(loadGeneralRulings({ home: seed({ text: "a failed deployment" }) })).toEqual({
      kind: "unreadable",
      why: "general-rulings.json is not valid JSON",
    });
  });

  it("loads a malformed ruling as unreadable with the parse reason", () => {
    expect(loadGeneralRulings({ home: seed({ text: JSON.stringify([{ ...RULING, kind: "" }]) }) })).toEqual({
      kind: "unreadable",
      why: "every kind in general-rulings.json must be non-blank",
    });
  });
});

describe("tagDecisionTreeFor", () => {
  it("renders this install's own rulings and this asker's own tier standing", () => {
    const home = seed({ text: JSON.stringify([RULING]) });
    writeFileSync(stateHomePaths({ home }).trustedAskersJson, JSON.stringify(["U0SYNCOLLEAGUE"]), "utf8");
    const lines = tagDecisionTreeFor({ home, userId: "U0SYNCOLLEAGUE" });
    expect(lines).toContain("      - a failed deployment: investigate immediately. [talk-call:abc#turn_1]");
    expect(lines).toContain("  (c) No ruling covers it? This asker IS on the trusted tier, so investigate.");
  });

  it("covers nothing and trusts nobody on an install holding neither file", () => {
    const text = tagDecisionTreeFor({ home: freshHome(), userId: "U0SYNCOLLEAGUE" }).join("\n");
    expect(text).toContain("so (b) covers nothing.");
    expect(text).toContain("This asker is NOT on the trusted tier");
  });
});
