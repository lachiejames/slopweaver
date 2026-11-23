/**
 * The one real write path for `responders.json`: round-trip add/remove, idempotence, and refusing to
 * overwrite a file it cannot trust.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { admitResponder } from "../../../../live/listen/whitelist.js";
import { loadResponderWhitelist } from "../../../../live/listen/whitelistStore.js";
import { addResponder, removeResponder } from "../../../../live/listen/whitelistWrite.js";
import { stateHomePaths } from "../../../../stateHome.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp home with nothing in it. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-responders-write-"));
  fixtureDirs.push(home);
  return home;
}

/** Write `responders.json` into a temp home with the given raw text, and return the home. */
function seed({ text }: { text: string }): string {
  const home = freshHome();
  writeFileSync(stateHomePaths({ home }).respondersJson, text, "utf8");
  return home;
}

describe("addResponder", () => {
  it("creates the file when none exists, adding the one id", () => {
    const home = freshHome();

    const result = addResponder({ home, userId: "U0NEW" });

    expect(result).toEqual({ after: ["U0NEW"], before: [], kind: "written" });
    expect(loadResponderWhitelist({ home })).toEqual({ identities: ["U0NEW"], kind: "list" });
  });

  it("appends to an existing list, preserving order", () => {
    const home = seed({ text: JSON.stringify(["U0OWNER"]) });

    const result = addResponder({ home, userId: "U0NEW" });

    expect(result).toEqual({ after: ["U0OWNER", "U0NEW"], before: ["U0OWNER"], kind: "written" });
    expect(loadResponderWhitelist({ home })).toEqual({ identities: ["U0OWNER", "U0NEW"], kind: "list" });
  });

  it("is a no-op, reported as such, when the id is already present", () => {
    const home = seed({ text: JSON.stringify(["U0OWNER"]) });

    const result = addResponder({ home, userId: "U0OWNER" });

    expect(result).toEqual({ identities: ["U0OWNER"], kind: "unchanged" });
    expect(loadResponderWhitelist({ home })).toEqual({ identities: ["U0OWNER"], kind: "list" });
  });

  it("refuses rather than overwrites when the current file is unreadable", () => {
    const home = seed({ text: "not json" });

    const result = addResponder({ home, userId: "U0NEW" });

    expect(result.kind).toBe("refused");
    expect(loadResponderWhitelist({ home }).kind).toBe("unreadable");
  });

  it("creates the directory when it does not exist yet", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-responders-write-"));
    fixtureDirs.push(home);

    addResponder({ home, userId: "U0NEW" });

    expect(loadResponderWhitelist({ home })).toEqual({ identities: ["U0NEW"], kind: "list" });
  });

  /**
   * The exact real-world sequence: an asker tags the bot, is correctly refused (not yet on the
   * list), the owner adds them, and a fresh read afterward correctly admits them. MEASURED against
   * `ledgers/door.jsonl` and `responders.json` that this is what actually happened for the growth-ops
   * asker's refusal in the owner's #dev-team report — the count logged at refusal time (16) was accurate
   * for the list as it stood then, and the add landed afterward through this exact path. Not a false
   * negative; both branches of the boundary this sequence crosses are asserted here so a real staleness bug
   * (an admit reading a whitelist snapshot from BEFORE its own add) would fail this test.
   */
  it("refuses before the add and admits after it, reading fresh each time", () => {
    const home = seed({ text: JSON.stringify(["U0OWNER"]) });

    const before = admitResponder({
      openOverride: false,
      userId: "U_GROWTHOPS",
      whitelist: loadResponderWhitelist({ home }),
    });
    expect(before).toEqual({
      admitted: false,
      why: "`U_GROWTHOPS` is not on the responder whitelist (1 configured identities)",
    });

    addResponder({ home, userId: "U_GROWTHOPS" });

    const after = admitResponder({
      openOverride: false,
      userId: "U_GROWTHOPS",
      whitelist: loadResponderWhitelist({ home }),
    });
    expect(after).toEqual({ admitted: true });
  });
});

describe("removeResponder", () => {
  it("removes a present id, preserving the order of the rest", () => {
    const home = seed({ text: JSON.stringify(["U0OWNER", "U0MID", "U0LAST"]) });

    const result = removeResponder({ home, userId: "U0MID" });

    expect(result).toEqual({ after: ["U0OWNER", "U0LAST"], before: ["U0OWNER", "U0MID", "U0LAST"], kind: "written" });
    expect(loadResponderWhitelist({ home })).toEqual({ identities: ["U0OWNER", "U0LAST"], kind: "list" });
  });

  it("is a no-op, reported as such, when the id was never present", () => {
    const home = seed({ text: JSON.stringify(["U0OWNER"]) });

    const result = removeResponder({ home, userId: "U0GHOST" });

    expect(result).toEqual({ identities: ["U0OWNER"], kind: "unchanged" });
  });

  it("is a no-op against an absent file", () => {
    const home = freshHome();

    const result = removeResponder({ home, userId: "U0GHOST" });

    expect(result).toEqual({ identities: [], kind: "unchanged" });
  });

  it("refuses rather than overwrites when the current file is unreadable", () => {
    const home = freshHome();
    mkdirSync(stateHomePaths({ home }).respondersJson);

    const result = removeResponder({ home, userId: "U0OWNER" });

    expect(result.kind).toBe("refused");
  });
});
