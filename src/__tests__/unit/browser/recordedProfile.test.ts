/**
 * Which Chrome profile the browser legs use: the store's `browser-profile` row, read through the REAL port and
 * register orchestration over an in-memory store, with the retired `browser.json` a real file in a temp home.
 *
 * The property that matters is what happens when there is NO recorded profile: nothing here guesses. A guess that
 * landed on a personal profile would drive the owner's own browsing as if it were work, so an unrecorded profile is
 * a refusal naming the verb that records one — and a store that cannot be reached is a refusal too, never the file.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { STORED_PROFILE_SOURCE } from "../../../browser/errors.js";
import {
  inertProfileFileLine,
  parseRecordedProfileDocument,
  readRecordedProfile,
  readRecordedProfileFile,
} from "../../../browser/recordedProfile.js";
import { memoryRecordedProfilePort, unavailableRecordedProfilePort } from "../../recordedProfileFixture.js";
import { FIXTURE_OUTAGE_REASON, memorySingletonStore } from "../../singletonRegisterFixture.js";

let home: string;
let path: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "recorded-profile-"));
  path = join(home, "browser.json");
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("parseRecordedProfileDocument", () => {
  it("trims a directory name that arrived with whitespace around it", () => {
    expect(unwrap(parseRecordedProfileDocument({ source: "x", value: { profileDirectory: "  Profile 3  " } }))).toEqual(
      { profileDirectory: "Profile 3" },
    );
  });

  it.each([
    ["no profileDirectory", { somethingElse: true }],
    ["an empty profileDirectory", { profileDirectory: "   " }],
    ["a non-string profileDirectory", { profileDirectory: 3 }],
    ["a document that is not an object", ["Profile 1"]],
  ])("refuses %s as malformed rather than reading it as unset", (_label, value) => {
    const refused = unwrapErr(parseRecordedProfileDocument({ source: STORED_PROFILE_SOURCE, value }));
    expect(refused.code).toBe("PROFILE_REGISTER_MALFORMED");
    expect(refused.message).toContain(STORED_PROFILE_SOURCE);
  });

  it("sends a bad stored row to the store, never to a --set that would fail on the same read", () => {
    const refused = unwrapErr(parseRecordedProfileDocument({ source: STORED_PROFILE_SOURCE, value: [] }));
    expect(refused.message).toContain("`slopweaver store status`");
    expect(refused.message).not.toContain("--set");
  });

  it("sends a bad retired file out of the home before a --set, since the read fails on it until then", () => {
    const refused = unwrapErr(parseRecordedProfileDocument({ source: path, value: [] }));
    expect(refused.message).toContain(path);
    expect(refused.message).toContain("move it out of the home");
  });
});

describe("readRecordedProfileFile, the one-time import's read", () => {
  it("answers undefined when the retired file is absent", () => {
    expect(unwrap(readRecordedProfileFile({ path }))).toBe(undefined);
  });

  it("reads the retired document", () => {
    writeFileSync(path, JSON.stringify({ profileDirectory: "Default" }), "utf8");
    expect(unwrap(readRecordedProfileFile({ path }))).toEqual({ profileDirectory: "Default" });
  });

  it("refuses unparseable JSON as malformed, naming the file", () => {
    writeFileSync(path, "{ not json", "utf8");
    const refused = unwrapErr(readRecordedProfileFile({ path }));
    expect(refused.code).toBe("PROFILE_REGISTER_MALFORMED");
    expect(refused.message).toContain(path);
  });

  it("refuses a path it cannot read as a file, rather than calling it absent", () => {
    mkdirSync(path);
    const refused = unwrapErr(readRecordedProfileFile({ path }));
    expect(refused.code).toBe("PROFILE_REGISTER_MALFORMED");
    expect(refused.message).toContain("could not be read");
  });
});

describe("the port: the store's row is the authority", () => {
  it("refuses with PROFILE_UNSET when nothing is recorded and there is no file, naming the verb that records one", async () => {
    const refused = unwrapErr(await readRecordedProfile({ home, profiles: memoryRecordedProfilePort() }));
    expect(refused.code).toBe("PROFILE_UNSET");
    expect(refused.message).toContain("slopweaver browser profile --list");
  });

  it("records at revision 1 and reads back exactly what was recorded", async () => {
    const profiles = memoryRecordedProfilePort();
    const written = unwrap(await profiles.record({ directory: "Profile 3", expectedRevision: null, home }));
    expect(written).toEqual({ directory: "Profile 3", inertFile: undefined, revision: 1 });
    expect(unwrap(await readRecordedProfile({ home, profiles }))).toBe("Profile 3");
  });

  it("overwrites an earlier recording pinned to its revision, bumping it", async () => {
    const profiles = memoryRecordedProfilePort();
    unwrap(await profiles.record({ directory: "Profile 1", expectedRevision: null, home }));
    const second = unwrap(await profiles.record({ directory: "Profile 9", expectedRevision: 1, home }));
    expect(second.revision).toBe(2);
    expect(unwrap(await readRecordedProfile({ home, profiles }))).toBe("Profile 9");
  });

  it("refuses a write pinned to a stale revision, writing nothing", async () => {
    const store = memorySingletonStore();
    const profiles = memoryRecordedProfilePort({ store });
    unwrap(await profiles.record({ directory: "Profile 1", expectedRevision: null, home }));
    unwrap(await profiles.record({ directory: "Profile 2", expectedRevision: 1, home }));
    const refused = unwrapErr(await profiles.record({ directory: "Profile 9", expectedRevision: 1, home }));
    expect(refused.code).toBe("PROFILE_REVISION_CONFLICT");
    expect(store.rows.get(home)).toEqual({ document: { profileDirectory: "Profile 2" }, revision: 2 });
  });

  it("refuses a stored row that is not the declared shape, naming the row", async () => {
    const store = memorySingletonStore();
    store.rows.set(home, { document: { profileDirectory: 7 }, revision: 4 });
    const refused = unwrapErr(await memoryRecordedProfilePort({ store }).read({ home }));
    expect(refused.code).toBe("PROFILE_REGISTER_MALFORMED");
    expect(refused.message).toContain(STORED_PROFILE_SOURCE);
  });

  it("refuses when the store is down, carrying its reason, even with a retired file sitting in the home", async () => {
    writeFileSync(path, JSON.stringify({ profileDirectory: "Default" }), "utf8");
    const refused = unwrapErr(await readRecordedProfile({ home, profiles: unavailableRecordedProfilePort() }));
    expect(refused.code).toBe("PROFILE_STORE_UNAVAILABLE");
    expect(refused.message).toContain(FIXTURE_OUTAGE_REASON);
  });
});

describe("the retired browser.json is imported once, then inert", () => {
  it("imports the file into a missing row, at revision 1", async () => {
    const store = memorySingletonStore();
    writeFileSync(path, JSON.stringify({ profileDirectory: "Default" }), "utf8");
    const read = unwrap(await memoryRecordedProfilePort({ store }).read({ home }));
    expect(read.directory).toBe("Default");
    expect(read.revision).toBe(1);
    expect(store.rows.get(home)).toEqual({ document: { profileDirectory: "Default" }, revision: 1 });
  });

  it("reads the row, not the file, once the row exists — an edited file changes nothing", async () => {
    const profiles = memoryRecordedProfilePort();
    writeFileSync(path, JSON.stringify({ profileDirectory: "Default" }), "utf8");
    unwrap(await profiles.read({ home }));
    writeFileSync(path, JSON.stringify({ profileDirectory: "Profile 9" }), "utf8");
    expect(unwrap(await readRecordedProfile({ home, profiles }))).toBe("Default");
  });

  it("refuses a malformed file rather than importing it, leaving no row", async () => {
    const store = memorySingletonStore();
    writeFileSync(path, "{ not json", "utf8");
    const refused = unwrapErr(await memoryRecordedProfilePort({ store }).read({ home }));
    expect(refused.code).toBe("PROFILE_REGISTER_MALFORMED");
    expect(store.rows.size).toBe(0);
  });

  it("says the file is inert while it still sits beside the row, naming it and the row's revision", async () => {
    writeFileSync(path, JSON.stringify({ profileDirectory: "Default" }), "utf8");
    const read = unwrap(await memoryRecordedProfilePort().read({ home }));
    expect(read.inertFile).toBe(path);
    const line = inertProfileFileLine({ snapshot: read })!;
    expect(line).toContain(`${path} is retired and read by nothing`);
    expect(line).toContain("(revision 1)");
  });

  it("warns about nothing when the file has left the home", async () => {
    const read = unwrap(await memoryRecordedProfilePort({ directory: "Profile 3" }).read({ home }));
    expect(read.inertFile).toBe(undefined);
    expect(inertProfileFileLine({ snapshot: read })).toBe(undefined);
  });
});
