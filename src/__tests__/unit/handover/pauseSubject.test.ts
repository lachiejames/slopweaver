import { describe, expect, it } from "vitest";

import {
  OWNER_PAUSE_SUBJECT,
  ownerNames,
  ownerRosterPersons,
  pauseSubjectFor,
  sharedOwnerNames,
  unsharedOwnerNames,
} from "../../../handover/pauseSubject.js";
import type { IdentityRecord } from "../../../silver/identity.js";

const ADA: IdentityRecord = {
  handle: "ada",
  heardAs: ["Adah"],
  id: "person:ada",
  identities: [
    { handle: "ada-acme", nativeId: "U0ADA", source: "slack" },
    { name: "Ada Lovelace", nativeId: "lin-ada", source: "linear" },
  ],
  name: "Ada Lovelace",
};

const QUINN: IdentityRecord = {
  handle: "quinn",
  id: "person:quinn",
  identities: [{ nativeId: "U0QUINN", source: "slack" }],
  name: "Quinn Byrne",
};

const ROSTER: readonly IdentityRecord[] = [QUINN, ADA];

describe("ownerRosterPersons", () => {
  it("finds the owner by the profile's own id", () => {
    expect(ownerRosterPersons({ ownerSlackUserId: undefined, profileId: "person:ada", roster: ROSTER })).toEqual([ADA]);
  });

  it("finds the owner by the declared Slack user id when the profile id is a placeholder", () => {
    expect(ownerRosterPersons({ ownerSlackUserId: "U0ADA", profileId: "me", roster: ROSTER })).toEqual([ADA]);
  });

  it("names nobody when neither crosswalk matches", () => {
    expect(ownerRosterPersons({ ownerSlackUserId: "U0NOBODY", profileId: "me", roster: ROSTER })).toEqual([]);
  });
});

describe("pauseSubjectFor", () => {
  const names = ownerNames({ displayName: undefined, persons: [ADA] });

  it("records the store's display name and its first word as the owner's role word with no roster entry at all", () => {
    const stored = ownerNames({ displayName: "Grace Hopper", persons: [] });
    expect(["Grace", "grace hopper", "Hopper"].map((who) => pauseSubjectFor({ names: stored, who }))).toEqual([
      "owner",
      "owner",
      "Hopper",
    ]);
  });

  it("matches a Greek name in either case, its final sigma included", () => {
    const greek = ownerNames({ displayName: "ΟΣ Person", persons: [] });
    expect(["ος", "Ος", "ΟΣ"].map((who) => pauseSubjectFor({ names: greek, who }))).toEqual([
      "owner",
      "owner",
      "owner",
    ]);
  });

  it("keeps a spelling only one case direction relates to the owner's name as passed, never as the role word", () => {
    const iris = ownerNames({ displayName: "Iris Owner", persons: [] });
    const greek = ownerNames({ displayName: "ΟΣ Person", persons: [] });
    expect(pauseSubjectFor({ names: iris, who: "ıris" })).toBe("ıris");
    expect(pauseSubjectFor({ names: iris, who: "IRIS" })).toBe("owner");
    expect(pauseSubjectFor({ names: greek, who: "οσ" })).toBe("οσ");
  });

  it("matches nothing on an empty display name", () => {
    expect([...ownerNames({ displayName: "", persons: [] })]).toEqual([]);
  });

  it("records the owner's first name as the role word, whatever its case", () => {
    expect(pauseSubjectFor({ names, who: "ada" })).toBe("owner");
    expect(pauseSubjectFor({ names, who: "  ADA " })).toBe("owner");
  });

  it("reads a handle with its leading @ as the handle", () => {
    expect(["@ada", "@ada-acme", "@quinn"].map((who) => pauseSubjectFor({ names, who }))).toEqual([
      "owner",
      "owner",
      "@quinn",
    ]);
  });

  it("records each of the owner's other recorded names as the role word", () => {
    expect(["Ada Lovelace", "ada-acme", "Adah"].map((who) => pauseSubjectFor({ names, who }))).toEqual([
      "owner",
      "owner",
      "owner",
    ]);
  });

  it("keeps anybody else's name exactly as passed", () => {
    expect(pauseSubjectFor({ names, who: "Quinn" })).toBe("Quinn");
  });

  it("drops a name another roster person also answers to, keeping the ones only they carry", () => {
    const byron: IdentityRecord = { handle: "abyron", id: "person:abyron", name: "Ada Byron" };
    const unshared = unsharedOwnerNames({ names, others: [QUINN, byron] });
    expect(["Ada", "Ada Lovelace", "Ada Byron"].map((who) => pauseSubjectFor({ names: unshared, who }))).toEqual([
      "Ada",
      "owner",
      "Ada Byron",
    ]);
  });

  it("names each shared name it drops, so the reading verb can say which of the owner's names it declines", () => {
    const byron: IdentityRecord = { handle: "abyron", id: "person:abyron", name: "Ada Byron" };
    expect(sharedOwnerNames({ names, others: [QUINN, byron] })).toEqual(["ada"]);
    expect(sharedOwnerNames({ names, others: [QUINN] })).toEqual([]);
  });

  it("keeps every subject as passed when no owner resolved", () => {
    expect(pauseSubjectFor({ names: ownerNames({ displayName: undefined, persons: [] }), who: "Ada" })).toBe("Ada");
  });

  it("writes the owner role word, and keeps the role word itself as passed", () => {
    expect(OWNER_PAUSE_SUBJECT).toBe("owner");
    const none = ownerNames({ displayName: undefined, persons: [] });
    expect(pauseSubjectFor({ names: none, who: "owner" })).toBe("owner");
  });
});
