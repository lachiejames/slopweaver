import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  boardOwnerNames,
  profileOwner,
  recordedSubject,
} from "../../../../../cli/commands/handover/pauseOwnerCheck.js";
import { ownerNames, pauseSubjectFor, unsharedOwnerNames } from "../../../../../handover/pauseSubject.js";
import type { IdentityRecord } from "../../../../../silver/identity.js";
import { memoryIdentityRosterPort, unavailableIdentityRosterPort } from "../../../../identityRosterFixture.js";

/** The opening a warning carries in these tests. */
const OPENING = "test: the owner's names did not read:";

/** The minimum a profile needs to parse, naming the roster's owner by its own id. */
const PROFILE = { displayName: "", gitNamespace: "", id: "person:ada", schemaVersion: 1, sources: [] };

const ROSTER: readonly IdentityRecord[] = [
  { handle: "ada", id: "person:ada", name: "Ada Lovelace" },
  { handle: "quinn", id: "person:quinn", name: "Quinn Byrne" },
];

describe("the owner check over a real temp home", () => {
  const homes: string[] = [];
  afterEach(() => {
    while (homes.length > 0) {
      rmSync(homes.pop()!, { force: true, recursive: true });
    }
  });

  /** A temp home holding the profile alone: the identity roster is the store's, and a test home selects no store. */
  function home({ profile }: { profile: string | undefined }): string {
    const dir = mkdtempSync(join(tmpdir(), "pause-owner-"));
    homes.push(dir);
    if (profile !== undefined) {
      writeFileSync(join(dir, "profile.json"), profile, "utf8");
    }
    return dir;
  }

  /** The unshared names the owner answers to over a roster the caller read: `profileOwner` plus the pure half. */
  function namesOver({
    profile,
    roster,
  }: {
    profile: string | undefined;
    roster: readonly IdentityRecord[];
  }): ReadonlySet<string> {
    const owner = profileOwner({ home: home({ profile }), opening: OPENING, roster });
    const names = new Set([
      ...ownerNames({ displayName: undefined, persons: owner.persons }),
      ...ownerNames({ displayName: owner.displayName, persons: [] }),
    ]);
    return unsharedOwnerNames({ names, others: owner.others });
  }

  it("writes the owner's role word when --on names the owner by the roster entry the profile points at", () => {
    const names = namesOver({ profile: JSON.stringify(PROFILE), roster: ROSTER });
    expect(pauseSubjectFor({ names, who: "Ada" })).toBe("owner");
    expect(pauseSubjectFor({ names, who: "ada lovelace" })).toBe("owner");
  });

  it("writes the role word off the profile's own display name when no roster entry resolves", async () => {
    const dir = home({ profile: JSON.stringify({ ...PROFILE, displayName: "Grace Hopper", id: "me" }) });
    expect(await recordedSubject({ home: dir, identityRoster: memoryIdentityRosterPort(), who: "grace" })).toBe(
      "owner",
    );
    expect(await recordedSubject({ home: dir, identityRoster: memoryIdentityRosterPort(), who: "Ada" })).toBe("Ada");
  });

  it("leaves a first name the owner shares with a colleague as passed, and still reads the owner's full name as theirs", () => {
    const roster = [...ROSTER, { handle: "abyron", id: "person:abyron", name: "Ada Byron" }];
    const names = namesOver({ profile: JSON.stringify({ ...PROFILE, displayName: "Ada Lovelace" }), roster });
    expect(pauseSubjectFor({ names, who: "Ada" })).toBe("Ada");
    expect(pauseSubjectFor({ names, who: "Ada Lovelace" })).toBe("owner");
    expect(pauseSubjectFor({ names, who: "Ada Byron" })).toBe("Ada Byron");
  });

  it("hands back the whole roster as somebody else's when the home has no profile, so a shared name stays shared", () => {
    const owner = profileOwner({ home: home({ profile: undefined }), opening: OPENING, roster: ROSTER });
    expect(owner.persons).toEqual([]);
    expect(owner.others.map((person) => person.id)).toEqual(["person:ada", "person:quinn"]);
  });

  it("hands back the whole roster as somebody else's when the profile will not read", () => {
    const owner = profileOwner({ home: home({ profile: "{" }), opening: OPENING, roster: ROSTER });
    expect(owner.others.map((person) => person.id)).toEqual(["person:ada", "person:quinn"]);
  });

  it("splits the roster into the owner and everyone else when the profile resolves the owner", () => {
    const owner = profileOwner({ home: home({ profile: JSON.stringify(PROFILE) }), opening: OPENING, roster: ROSTER });
    expect(owner.persons.map((person) => person.id)).toEqual(["person:ada"]);
    expect(owner.others.map((person) => person.id)).toEqual(["person:quinn"]);
  });

  it("leaves anyone else's name as passed", () => {
    const names = namesOver({ profile: JSON.stringify(PROFILE), roster: ROSTER });
    expect(pauseSubjectFor({ names, who: "Quinn" })).toBe("Quinn");
  });

  it("writes the subject as passed when the profile will not read, rather than stopping the pause", async () => {
    const dir = home({ profile: "{" });
    expect(await recordedSubject({ home: dir, identityRoster: memoryIdentityRosterPort(), who: "Ada" })).toBe("Ada");
  });

  it("writes the subject as passed when the store cannot answer, rather than stopping the pause", async () => {
    // The temp home selects no store, so both the owner row and the roster read are refused here.
    const dir = home({ profile: JSON.stringify(PROFILE) });
    expect(
      await recordedSubject({ home: dir, identityRoster: unavailableIdentityRosterPort(), who: "Ada Lovelace" }),
    ).toBe("Ada Lovelace");
  });

  it("claims no name as the owner's when the roster cannot be read, even one the profile's display name gives", async () => {
    // Without the roster nothing says which of the owner's names another person shares, so the owner's role word
    // written over a shared name would be a subject publication could never recover; the literal name it re-reads as
    // the owner's later.
    const dir = home({ profile: JSON.stringify({ ...PROFILE, displayName: "Ada Lovelace" }) });
    const identityRoster = unavailableIdentityRosterPort();
    expect(await recordedSubject({ home: dir, identityRoster, who: "Ada" })).toBe("Ada");
    expect(await recordedSubject({ home: dir, identityRoster, who: "Ada Lovelace" })).toBe("Ada Lovelace");
    expect((await boardOwnerNames({ home: dir, identityRoster })).size).toBe(0);
  });

  it("gives the board the names only the owner answers to, so an older pause naming the owner reads as theirs", () => {
    const roster = [...ROSTER, { handle: "abyron", id: "person:abyron", name: "Ada Byron" }];
    const names = namesOver({ profile: JSON.stringify(PROFILE), roster });
    expect(pauseSubjectFor({ names, who: "Ada Lovelace" })).toBe("owner");
    // The owner's handle `ada` folds to the first name Ada Byron also answers to, so it stays shared, as `Ada` does.
    expect(pauseSubjectFor({ names, who: "@ada" })).toBe("@ada");
    expect(pauseSubjectFor({ names, who: "Ada" })).toBe("Ada");
    expect(pauseSubjectFor({ names, who: "Quinn" })).toBe("Quinn");
  });

  it("reads the roster through the port it is handed, so the store's entry for the owner resolves their full name", async () => {
    const dir = home({ profile: JSON.stringify(PROFILE) });
    const identityRoster = memoryIdentityRosterPort({ records: ROSTER });
    expect(await recordedSubject({ home: dir, identityRoster, who: "Ada Lovelace" })).toBe("owner");
    expect(await recordedSubject({ home: dir, identityRoster, who: "Quinn" })).toBe("Quinn");
    // The owner's handle and full name, each held under the case-folded key `ownerNames` mints.
    expect((await boardOwnerNames({ home: dir, identityRoster })).size).toBe(2);
  });

  it("gives the board no names when the home records no owner", async () => {
    expect(
      (await boardOwnerNames({ home: home({ profile: undefined }), identityRoster: memoryIdentityRosterPort() })).size,
    ).toBe(0);
  });
});
