/**
 * The build of the person set from the directory and the member pull, over the shapes the real files hold.
 *
 * Every row below is the SHAPE measured off `~/.slopweaver/corpus/members/<source>.jsonl` and
 * `~/.slopweaver/corpus/directory/google-admin.jsonl`, with synthetic ids: a real Slack member id is a
 * `raw-workspace-id` leak class the hygiene gate flags, refusing it wherever `IDENTIFIER_VERDICT` reads
 * `refuse`, and only the structure matters to a pure build.
 *
 * The properties worth the file are the ones the old shape let through: a human is one row however many
 * platforms know them, a bot is never a row, an id never lands in the wrong column, and nobody is named by
 * their id.
 */
import { describe, expect, it } from "vitest";

import type { DirectoryUserRow } from "../../../corpus/directory/types.js";
import type { MemberBronzeRow } from "../../../corpus/members/types.js";
import {
  buildPeople,
  foldActive,
  githubAccountId,
  isKeyableAddress,
  isPlaceholderAddress,
  latestMembers,
  memberDisplayName,
  terminatedAliases,
} from "../../../store/identity/people.js";

/** A directory user carrying only what the build reads, so each test states its own subject. */
const user = (over: Partial<DirectoryUserRow> = {}): DirectoryUserRow => ({
  aliases: [],
  archived: false,
  emailNormalised: "ada@example.invalid",
  fetchedAtIso: "2026-09-14T00:00:00.000Z",
  fullName: "Ada Lovelace",
  googleId: "100000000000000000001",
  isAdmin: false,
  primaryEmail: "Ada@example.invalid",
  raw: {},
  suspended: false,
  version: 1,
  ...over,
});

/** A member row carrying only what the build reads. */
const member = (over: Partial<MemberBronzeRow> = {}): MemberBronzeRow => ({
  fetchedAtIso: "2026-09-09T00:00:00.000Z",
  identity: { emailTrust: "missing", nativeId: "U0SYNADA00001", source: "slack" },
  profile: {},
  provenance: ["slack.users.list"],
  raw: {},
  source: "slack",
  sourceId: "U0SYNADA00001",
  version: 1,
  warnings: [],
  ...over,
});

const LINEAR_ID = "9c1f0000-0000-4000-8000-000000000001";

/** A Slack member of Ada's, carrying her trusted address. */
const adaOnSlack = member({
  identity: {
    email: "ada@example.invalid",
    emailNormalised: "ada@example.invalid",
    emailTrust: "trusted",
    handle: "ada",
    name: "Ada L",
    nativeId: "U0SYNADA00001",
    source: "slack",
  },
  profile: { active: true, bot: false },
});

describe("the directory is the authority", () => {
  it("makes one person per directory user, named by Google and keyed by the normalised address", () => {
    const built = buildPeople({ directory: [user()], members: [] });
    expect(built.people.length).toBe(1);
    expect(built.people[0]!.email).toBe("ada@example.invalid");
    expect(built.people[0]!.displayName).toBe("Ada Lovelace");
    expect(built.people[0]!.googleId).toBe("100000000000000000001");
    expect(built.fromDirectory).toBe(1);
  });

  it("reads active off Google's own suspended and archived flags", () => {
    const built = buildPeople({ directory: [user({ suspended: true })], members: [adaOnSlack] });
    expect(built.people[0]!.active).toBe(false);
  });

  it("puts a member's platform id on the directory person their trusted address reaches", () => {
    const built = buildPeople({ directory: [user()], members: [adaOnSlack] });
    expect(built.people.length).toBe(1);
    expect(built.people[0]!.slackUserId).toBe("U0SYNADA00001");
    expect(built.people[0]!.displayName).toBe("Ada Lovelace");
  });

  it("reaches the person through a Google alias, because an alias is the same mailbox", () => {
    const aliased = user({ aliases: ["ada.lovelace@example.invalid"] });
    const viaAlias = member({
      identity: {
        email: "ada.lovelace@example.invalid",
        emailNormalised: "ada.lovelace@example.invalid",
        emailTrust: "trusted",
        nativeId: LINEAR_ID,
        source: "linear",
      },
      source: "linear",
      sourceId: LINEAR_ID,
    });
    const built = buildPeople({ directory: [aliased], members: [viaAlias] });
    expect(built.people.length).toBe(1);
    expect(built.people[0]!.linearUserId).toBe(LINEAR_ID);
  });

  it("joins one human across every platform into ONE row, which is the defect the old shape allowed", () => {
    const onLinear = member({
      identity: {
        email: "ADA@Example.invalid",
        emailNormalised: "ada@example.invalid",
        emailTrust: "trusted",
        nativeId: LINEAR_ID,
        source: "linear",
      },
      source: "linear",
      sourceId: LINEAR_ID,
    });
    const onGithub = member({
      identity: {
        email: "ada@example.invalid",
        emailNormalised: "ada@example.invalid",
        emailTrust: "trusted",
        handle: "ada-lovelace",
        nativeId: "ada-lovelace",
        source: "github",
      },
      raw: { listMember: { id: 279926207, login: "ada-lovelace" } },
      source: "github",
      sourceId: "ada-lovelace",
    });
    const built = buildPeople({ directory: [user()], members: [adaOnSlack, onLinear, onGithub] });
    expect(built.people.length).toBe(1);
    expect(built.people[0]).toStrictEqual({
      active: true,
      displayName: "Ada Lovelace",
      email: "ada@example.invalid",
      familyName: null,
      githubId: "279926207",
      githubLogin: "ada-lovelace",
      givenName: null,
      googleId: "100000000000000000001",
      linearDisplayName: null,
      linearUserId: LINEAR_ID,
      notionUserId: null,
      orgUnitPath: null,
      slackUserId: "U0SYNADA00001",
      title: null,
    });
  });
});

describe("a person Google does not hold", () => {
  it("still becomes a person on a trusted address, with no Google id, so nobody is forgotten", () => {
    const built = buildPeople({ directory: [], members: [adaOnSlack] });
    expect(built.people.length).toBe(1);
    expect(built.people[0]!.googleId).toBe(null);
    expect(built.people[0]!.displayName).toBe("Ada L");
    expect(built.people[0]!.slackUserId).toBe("U0SYNADA00001");
    expect(built.fromDirectory).toBe(0);
  });

  it("takes active from the platforms when Google has no word", () => {
    const deactivated = member({
      identity: { ...adaOnSlack.identity },
      profile: { active: false, bot: false },
    });
    expect(buildPeople({ directory: [], members: [deactivated] }).people[0]!.active).toBe(false);
  });

  it("is never named by an id: a member with no name or handle is named by their address", () => {
    const nameless = member({
      identity: {
        email: "ada@example.invalid",
        emailNormalised: "ada@example.invalid",
        emailTrust: "trusted",
        nativeId: "U0SYNADA00001",
        source: "slack",
      },
    });
    expect(buildPeople({ directory: [], members: [nameless] }).people[0]!.displayName).toBe("ada@example.invalid");
  });
});

describe("what is refused or skipped", () => {
  it("skips a bot, because a bot is never a person", () => {
    const bot = member({
      identity: { emailTrust: "missing", name: "Datadog", nativeId: "U0SYNBOT00001", source: "slack" },
      profile: { bot: true },
      sourceId: "U0SYNBOT00001",
    });
    const built = buildPeople({ directory: [user()], members: [bot] });
    expect(built.people.length).toBe(1);
    expect(built.bots).toBe(1);
    expect(built.candidates).toStrictEqual([]);
  });

  it("refuses an id that is not the shape of its platform, so a Slack bot id never reaches the Linear column", () => {
    const wrongShape = member({
      identity: {
        email: "ada@example.invalid",
        emailNormalised: "ada@example.invalid",
        emailTrust: "trusted",
        nativeId: "B0SYN000014",
        source: "linear",
      },
      source: "linear",
      sourceId: "B0SYN000014",
    });
    const built = buildPeople({ directory: [user()], members: [wrongShape] });
    expect(built.people[0]!.linearUserId).toBe(null);
    expect(built.refused).toStrictEqual([
      "linear B0SYN000014: not the shape of a linear member id, so it cannot be a person's",
    ]);
  });

  it("does not join on a weak address, because a shared mailbox is not a person", () => {
    const shared = member({
      identity: {
        email: "team@example.invalid",
        emailNormalised: "team@example.invalid",
        emailTrust: "weak",
        name: "Team Inbox",
        nativeId: "U0SYNTEAM0001",
        source: "slack",
      },
      sourceId: "U0SYNTEAM0001",
    });
    const built = buildPeople({ directory: [], members: [shared] });
    expect(built.people).toStrictEqual([]);
    expect(built.unmatched).toBe(1);
  });

  it("records a name match as a candidate and never applies it", () => {
    const noAddress = member({
      identity: { emailTrust: "missing", name: "Ada Lovelace", nativeId: LINEAR_ID, source: "linear" },
      source: "linear",
      sourceId: LINEAR_ID,
    });
    const built = buildPeople({ directory: [user()], members: [noAddress] });
    expect(built.people[0]!.linearUserId).toBe(null);
    expect(built.candidates.length).toBe(1);
    expect(built.candidates[0]!.email).toBe("ada@example.invalid");
    expect(built.candidates[0]!.nativeId).toBe(LINEAR_ID);
    expect(built.candidates[0]!.signal.detail).toBe('"Ada Lovelace" resembles "Ada Lovelace"');
    expect(built.unmatched).toBe(0);
  });
});

describe("the helpers", () => {
  it("collapses the append-only log to the last physical row per person", () => {
    const rows = [
      member({ identity: { emailTrust: "missing", name: "Old Name", nativeId: "U0SYNADA00001", source: "slack" } }),
      member({ identity: { emailTrust: "missing", name: "New Name", nativeId: "U0SYNADA00001", source: "slack" } }),
    ];
    expect(latestMembers({ rows }).length).toBe(1);
    expect(memberDisplayName({ row: latestMembers({ rows })[0]! })).toBe("New Name");
  });

  it("reads GitHub's immutable account id off the payload, and reports none when it is absent", () => {
    expect(githubAccountId({ row: member({ raw: { listMember: { id: 42 } }, source: "github" }) })).toBe("42");
    expect(githubAccountId({ row: member({ source: "github" }) })).toBe(null);
  });

  it("folds activity: any yes wins, all no is no, and silence is silence", () => {
    expect(foldActive({ words: [false, true] })).toBe(true);
    expect(foldActive({ words: [false, null] })).toBe(false);
    expect(foldActive({ words: [null, null] })).toBe(null);
    expect(foldActive({ words: [] })).toBe(null);
  });
});

describe("the addresses that are not mailboxes", () => {
  it("refuses Slack's deactivated-user placeholder as a key, however unique it is", () => {
    expect(isPlaceholderAddress({ email: "deactivateduser000001-acme@slack-corp.com" })).toBe(true);
    expect(isPlaceholderAddress({ email: "ada@example.invalid" })).toBe(false);
    const placeholder = member({
      identity: {
        email: "deactivateduser000001-acme@slack-corp.com",
        emailNormalised: "deactivateduser000001-acme@slack-corp.com",
        emailTrust: "trusted",
        name: "deactivateduser",
        nativeId: "U0SYNGONE0001",
        source: "slack",
      },
      sourceId: "U0SYNGONE0001",
    });
    expect(buildPeople({ directory: [], members: [placeholder] }).people).toStrictEqual([]);
  });

  it("folds the address an off-boarded person USED into the term_emp one the directory now holds", () => {
    const directory = [
      user({
        emailNormalised: "term_emp_ada@example.invalid",
        primaryEmail: "term_emp_ada@example.invalid",
        suspended: true,
      }),
    ];
    expect(terminatedAliases({ directory }).get("ada@example.invalid")).toBe("term_emp_ada@example.invalid");
    const built = buildPeople({ directory, members: [adaOnSlack] });
    expect(built.people.length).toBe(1);
    expect(built.people[0]!.email).toBe("term_emp_ada@example.invalid");
    expect(built.people[0]!.slackUserId).toBe("U0SYNADA00001");
  });

  it("claims nothing when the directory has since re-issued the plain address to somebody", () => {
    const directory = [
      user({ emailNormalised: "term_emp_ada@example.invalid", primaryEmail: "term_emp_ada@example.invalid" }),
      user({ fullName: "Someone Else", googleId: "2" }),
    ];
    expect(terminatedAliases({ directory }).size).toBe(0);
    const built = buildPeople({ directory, members: [adaOnSlack] });
    expect(built.people.length).toBe(2);
    expect(built.people.find((person) => person.email === "ada@example.invalid")!.slackUserId).toBe("U0SYNADA00001");
  });
});

describe("the one place a name links rather than waits", () => {
  const ghMember = (over: { login: string; name: string | null }): MemberBronzeRow =>
    member({
      identity: { emailTrust: "missing", handle: over.login, nativeId: over.login, source: "github" },
      raw: { listMember: { id: 279926207, login: over.login }, profile: { login: over.login, name: over.name } },
      source: "github",
      sourceId: over.login,
    });

  it("links a GitHub org member whose full name is exactly one person's, and records it as accepted", () => {
    const built = buildPeople({
      directory: [user()],
      members: [ghMember({ login: "ada-lovelace", name: "Ada Lovelace" })],
    });
    expect(built.people[0]!.githubId).toBe("279926207");
    expect(built.people[0]!.githubLogin).toBe("ada-lovelace");
    expect(built.candidates.length).toBe(1);
    expect(built.candidates[0]!.status).toBe("accepted");
    expect(built.candidates[0]!.signal.kind).toBe("name_exact_org_member");
    expect(built.candidates[0]!.signal.confidence).toBe(1);
  });

  it("refuses to link when two people share that name, because the link would be a guess", () => {
    const twins = [
      user(),
      user({ emailNormalised: "ada2@example.invalid", googleId: "2", primaryEmail: "ada2@example.invalid" }),
    ];
    const built = buildPeople({
      directory: twins,
      members: [ghMember({ login: "ada-lovelace", name: "Ada Lovelace" })],
    });
    expect(built.people.every((person) => person.githubId === null)).toBe(true);
    expect(built.candidates.every((candidate) => candidate.status === "pending")).toBe(true);
  });

  it("refuses a single-word profile name, which is a handle rather than a full name", () => {
    const built = buildPeople({
      directory: [user({ fullName: "Ada" })],
      members: [ghMember({ login: "ada", name: "Ada" })],
    });
    expect(built.people[0]!.githubId).toBe(null);
  });

  it("does nothing for a member whose GitHub profile carries no name at all", () => {
    const built = buildPeople({ directory: [user()], members: [ghMember({ login: "user3-acme", name: null })] });
    expect(built.people[0]!.githubId).toBe(null);
    expect(built.unmatched).toBe(1);
  });
});

describe("two accounts on one platform for one person", () => {
  it("keeps the active one and refuses the dead one, whichever order the file lists them", () => {
    const dead = member({
      identity: { ...adaOnSlack.identity, nativeId: "U0SYNDEAD0001" },
      profile: { active: false, bot: false },
      sourceId: "U0SYNDEAD0001",
    });
    const built = buildPeople({ directory: [user()], members: [dead, adaOnSlack] });
    expect(built.people[0]!.slackUserId).toBe("U0SYNADA00001");
    expect(built.refused).toStrictEqual([
      "slack U0SYNDEAD0001: ada@example.invalid already carries slack U0SYNADA00001",
    ]);
  });
});

describe("Linear's @-handle", () => {
  const linearMember = (over: { active: boolean | undefined; displayName: string }): MemberBronzeRow =>
    member({
      identity: {
        email: "ada@example.invalid",
        emailNormalised: "ada@example.invalid",
        emailTrust: "trusted",
        nativeId: LINEAR_ID,
        source: "linear",
      },
      profile: over.active === undefined ? { bot: false } : { active: over.active, bot: false },
      raw: { displayName: over.displayName, id: LINEAR_ID },
      source: "linear",
      sourceId: LINEAR_ID,
    });

  it("is kept for an org member, because tens of thousands of Linear rows name their author by it alone", () => {
    const built = buildPeople({ directory: [user()], members: [linearMember({ active: true, displayName: "ada" })] });
    expect(built.people[0]!.linearDisplayName).toBe("ada");
  });

  it("is not kept for an external user, whose handle can echo a member's", () => {
    const built = buildPeople({
      directory: [user()],
      members: [linearMember({ active: undefined, displayName: "ada" })],
    });
    expect(built.people[0]!.linearUserId).toBe(LINEAR_ID);
    expect(built.people[0]!.linearDisplayName).toBe(null);
  });

  it("is not kept when it is not the shape of a handle", () => {
    const built = buildPeople({
      directory: [user()],
      members: [linearMember({ active: true, displayName: "Ada Lovelace" })],
    });
    expect(built.people[0]!.linearDisplayName).toBe(null);
  });
});

describe("two mailboxes carrying one name", () => {
  it("keeps both as people and records the pair for review rather than merging them", () => {
    const directory = [
      user(),
      user({ emailNormalised: "ada@nz.invalid", googleId: "2", primaryEmail: "ada@nz.invalid" }),
    ];
    const built = buildPeople({ directory, members: [] });
    expect(built.people.length).toBe(2);
    const pair = built.candidates.filter((candidate) => candidate.signal.kind === "same_name_second_mailbox");
    expect(pair.length).toBe(1);
    expect(pair[0]!.status).toBe("pending");
    expect(pair[0]!.email).toBe("ada@example.invalid");
    expect(pair[0]!.nativeId).toBe("ada@nz.invalid");
  });

  it("records nothing when every person's name is their own", () => {
    const directory = [
      user(),
      user({
        emailNormalised: "b@example.invalid",
        fullName: "Someone Else",
        googleId: "2",
        primaryEmail: "b@example.invalid",
      }),
    ];
    expect(buildPeople({ directory, members: [] }).candidates).toStrictEqual([]);
  });
});

describe("an address the person key cannot accept", () => {
  it("refuses it rather than letting the CHECK abort the whole reconcile", () => {
    expect(isKeyableAddress({ email: "ada@example.invalid" })).toBe(true);
    expect(isKeyableAddress({ email: "ada@b@example.invalid" })).toBe(false);
    expect(isKeyableAddress({ email: "a da@example.invalid" })).toBe(false);
    expect(isKeyableAddress({ email: "ada@" })).toBe(false);
    expect(isKeyableAddress({ email: "@example.invalid" })).toBe(false);
  });

  it("skips a member carrying one, naming it, and still builds everybody else", () => {
    const malformed = member({
      identity: {
        email: "a da@example.invalid",
        emailNormalised: "a da@example.invalid",
        emailTrust: "trusted",
        name: "Odd Address",
        nativeId: "U0SYNODD00001",
        source: "slack",
      },
      sourceId: "U0SYNODD00001",
    });
    const built = buildPeople({ directory: [user()], members: [malformed, adaOnSlack] });
    expect(built.people.length).toBe(1);
    expect(built.people[0]!.email).toBe("ada@example.invalid");
    expect(built.refused).toStrictEqual([
      'slack U0SYNODD00001: "a da@example.invalid" is not a shape the person key accepts',
    ]);
  });

  it("skips a directory user carrying one, naming the Google id", () => {
    const odd = user({
      emailNormalised: "two@at@example.invalid",
      googleId: "7",
      primaryEmail: "two@at@example.invalid",
    });
    const built = buildPeople({ directory: [odd, user()], members: [] });
    expect(built.people.length).toBe(1);
    expect(built.refused).toStrictEqual([
      'directory 7: "two@at@example.invalid" is not a shape the person key accepts',
    ]);
  });
});
