/**
 * The filesystem edge: what `loadResponderWhitelist` returns for a real, absent, empty, invalid, or
 * unreadable `responders.json` — including proof there is no profile fallback of any kind.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadResponderWhitelist } from "../../../../live/listen/whitelistStore.js";
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
  const home = mkdtempSync(join(tmpdir(), "slopweaver-responders-"));
  fixtureDirs.push(home);
  return home;
}

/** Write `responders.json` into a temp home with the given raw text, and return the home. */
function seed({ text }: { text: string }): string {
  const home = freshHome();
  writeFileSync(stateHomePaths({ home }).respondersJson, text, "utf8");
  return home;
}

describe("loadResponderWhitelist", () => {
  it("loads a valid list", () => {
    const home = seed({ text: JSON.stringify(["U0OWNER", "U0BOT"]) });
    expect(loadResponderWhitelist({ home })).toEqual({ identities: ["U0OWNER", "U0BOT"], kind: "list" });
  });

  it("loads an absent file as absent, not open", () => {
    const home = freshHome();
    expect(loadResponderWhitelist({ home })).toEqual({ kind: "absent" });
  });

  it("loads an empty array as a closed, empty list", () => {
    const home = seed({ text: "[]" });
    expect(loadResponderWhitelist({ home })).toEqual({ identities: [], kind: "list" });
  });

  it("ignores a profile declaring owner and bot ids when responders.json is absent — no fallback", () => {
    const home = freshHome();
    writeFileSync(
      stateHomePaths({ home }).profileJson,
      JSON.stringify({
        displayName: "Ada Owner",
        gitNamespace: "ada-gh",
        id: "owner-1",
        schemaVersion: 1,
        slackBot: { botUserIds: ["U0BOT"], ownerUserId: "U0OWNER" },
        sources: ["github"],
      }),
      "utf8",
    );
    expect(loadResponderWhitelist({ home })).toEqual({ kind: "absent" });
  });

  it("loads invalid JSON as unreadable", () => {
    const home = seed({ text: "not json" });
    const whitelist = loadResponderWhitelist({ home });
    expect(whitelist.kind).toBe("unreadable");
  });

  it("loads the wrong top-level shape as unreadable", () => {
    const home = seed({ text: JSON.stringify({ U0OWNER: true }) });
    const whitelist = loadResponderWhitelist({ home });
    expect(whitelist.kind).toBe("unreadable");
  });

  it("loads an invalid element as unreadable", () => {
    const home = seed({ text: JSON.stringify(["U0OWNER", "not an id with spaces"]) });
    const whitelist = loadResponderWhitelist({ home });
    expect(whitelist.kind).toBe("unreadable");
  });

  it("loads a directory at the responders.json path as unreadable", () => {
    const home = freshHome();
    mkdirSync(stateHomePaths({ home }).respondersJson);
    const whitelist = loadResponderWhitelist({ home });
    expect(whitelist.kind).toBe("unreadable");
  });

  it("loads an unreadable-permission file as unreadable", () => {
    const home = seed({ text: JSON.stringify(["U0OWNER"]) });
    const path = stateHomePaths({ home }).respondersJson;
    chmodSync(path, 0o000);
    const whitelist = loadResponderWhitelist({ home });
    chmodSync(path, 0o600);
    expect(whitelist.kind).toBe("unreadable");
  });

  it("loads a file behind an untraversable directory as unreadable, never absent", () => {
    const home = seed({ text: JSON.stringify(["U0OWNER"]) });
    chmodSync(home, 0o000);
    const whitelist = loadResponderWhitelist({ home });
    chmodSync(home, 0o700);
    expect(whitelist.kind).toBe("unreadable");
  });

  it("loads a dangling link at the responders.json path as unreadable, never absent", () => {
    const home = freshHome();
    symlinkSync(join(home, "gone.json"), stateHomePaths({ home }).respondersJson);
    expect(loadResponderWhitelist({ home }).kind).toBe("unreadable");
  });
});
