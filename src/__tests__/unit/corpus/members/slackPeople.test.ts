import { describe, expect, it } from "vitest";
import type { VantaEntity } from "../../../../atlas/vanta/model.js";
import { buildMemberIdentity } from "../../../../corpus/members/email.js";
import { EMPTY_ORG_CHART, orgChartIndex } from "../../../../corpus/members/orgChartIndex.js";
import { slackPeopleFor } from "../../../../corpus/members/slackPeople.js";
import type { MemberBronzeRow, MemberProfileFields } from "../../../../corpus/members/types.js";
import type { IdentitySource } from "../../../../silver/identity.js";

function row({
  source = "slack",
  nativeId,
  name,
  email,
  fetchedAtIso = "2026-09-01T00:00:00.000Z",
  profile = {},
  raw = {},
}: {
  source?: IdentitySource;
  nativeId: string;
  name?: string;
  email?: string;
  fetchedAtIso?: string;
  profile?: MemberProfileFields;
  raw?: unknown;
}): MemberBronzeRow {
  return {
    fetchedAtIso,
    identity: buildMemberIdentity({
      handle: nativeId.toLowerCase(),
      nativeId,
      source,
      ...(name === undefined ? {} : { name }),
      ...(email === undefined ? {} : { email }),
    }),
    profile,
    provenance: [],
    raw,
    source,
    sourceId: nativeId,
    version: 1,
    warnings: [],
  };
}

describe("slackPeopleFor", () => {
  it("names each asked id in the order asked, keeping a member with no picture", () => {
    const rows = [row({ name: "Ari", nativeId: "U0ARI" }), row({ name: "Ada Owner", nativeId: "U0SYNADAOWN" })];
    expect(slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U0SYNADAOWN", "U0ARI"], rows })).toEqual([
      {
        bot: false,
        deactivated: false,
        firstNameUnique: true,
        handle: "u0synadaown",
        name: "Ada Owner",
        nameUnique: true,
        nativeId: "U0SYNADAOWN",
      },
      {
        bot: false,
        deactivated: false,
        firstNameUnique: true,
        handle: "u0ari",
        name: "Ari",
        nameUnique: true,
        nativeId: "U0ARI",
      },
    ]);
  });

  it("marks a member Slack says has left as deactivated, and one whose profile says nothing as not", () => {
    const rows = [
      row({ name: "Gone Person", nativeId: "U1", profile: { active: false } }),
      row({ name: "Here Person", nativeId: "U2", profile: { active: true } }),
      row({ name: "Silent Person", nativeId: "U3" }),
    ];
    expect(
      slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U1", "U2", "U3"], rows }).map((person) => person.deactivated),
    ).toEqual([true, false, false]);
  });

  it("keeps the row appended last, whatever its stamp says", () => {
    const rows = [
      row({ fetchedAtIso: "2026-09-10T00:00:00.000Z", name: "Old Name", nativeId: "U1" }),
      row({ fetchedAtIso: "20260901T000000Z", name: "New Name", nativeId: "U1" }),
    ];
    expect(slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U1"], rows }).map((person) => person.name)).toEqual([
      "New Name",
    ]);
  });

  it("keeps the latest row's missing name missing, rather than reviving an older one", () => {
    const rows = [row({ name: "Old Name", nativeId: "U1" }), row({ nativeId: "U1" })];
    expect(slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U1"], rows }).map((person) => person.name)).toEqual([
      undefined,
    ]);
  });

  it("ignores a row whose key names a different member than its identity", () => {
    const rows = [
      row({ name: "Alice", nativeId: "U0ALICE" }),
      { ...row({ name: "Bob", nativeId: "U0ALICE" }), sourceId: "U0BOB" },
    ];
    expect(slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U0ALICE"], rows }).map((person) => person.name)).toEqual([
      "Alice",
    ]);
  });

  it("withdraws an older name when the member's latest row has lost its identity id", () => {
    const rows = [
      row({ name: "Old Alice", nativeId: "U0ALICE" }),
      { ...row({ nativeId: "" }), sourceId: "U0ALICE" },
      row({ name: "Bob", nativeId: "U0BOB" }),
    ];
    expect(
      slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U0ALICE", "U0BOB"], rows }).map((person) => person.nativeId),
    ).toEqual(["U0BOB"]);
  });

  it("never lends a Slack id the name of another source's member with the same id", () => {
    const rows = [row({ name: "Linear Person", nativeId: "U1", source: "linear" })];
    expect(slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U1"], rows })).toEqual([]);
  });

  it("leaves out an id no row carries, and answers once for a repeated id", () => {
    const rows = [row({ name: "Bot", nativeId: "U2", profile: { bot: true } })];
    expect(slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U2", "U404", "U2"], rows })).toEqual([
      {
        bot: true,
        deactivated: false,
        firstNameUnique: false,
        handle: "u2",
        name: "Bot",
        nameUnique: false,
        nativeId: "U2",
      },
    ]);
  });

  it("carries the profile title trimmed, and none for the blank one Slack stores when it is unset", () => {
    const rows = [
      row({ name: "Rosa", nativeId: "U1", profile: { title: "  Staff Engineer " } }),
      row({ name: "Kyle", nativeId: "U2", profile: { title: "   " } }),
    ];
    expect(
      slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U1", "U2"], rows }).map((person) => person.title),
    ).toEqual(["Staff Engineer", undefined]);
  });

  it("joins org facts by a trusted email only, never by a shared role address", () => {
    const orgChart = orgChartIndex({
      directory: [
        {
          aliases: [],
          archived: false,
          emailNormalised: "rosa@x.au",
          fetchedAtIso: "2026-09-16T00:00:00.000Z",
          fullName: "Rosa Lindqvist",
          googleId: "g1",
          isAdmin: false,
          primaryEmail: "rosa@x.au",
          raw: {},
          suspended: false,
          title: "Head of Engineering",
          version: 1,
        },
      ],
      vantaGroups: [],
      vantaPeople: [],
    });
    const rows = [
      row({ email: "Rosa@X.au", name: "Rosa", nativeId: "U1" }),
      row({ email: "support@x.au", name: "Support", nativeId: "U2" }),
    ];
    expect(slackPeopleFor({ ids: ["U1", "U2"], orgChart, rows }).map((person) => person.org)).toEqual([
      { title: { source: "google-admin", value: "Head of Engineering" }, vantaGroups: [] },
      undefined,
    ]);
  });

  it("gives a bot no org facts, and resolves a re-used Vanta address only for a member still active", () => {
    const vantaPerson = ({ email, status }: { email: string; status: string }): VantaEntity => ({
      channels: {
        browser: null,
        "manage-api": {
          channel: "manage-api",
          detail: {
            emailAddress: email,
            employment: { jobTitle: status, startDate: "2025-01-01", status },
            groupIds: [],
          },
          firstSeenAt: "2026-09-01T00:00:00.000Z",
          lastSeenAt: "2026-09-29T00:00:00.000Z",
          source: null,
          state: "observed",
        },
      },
      financialDetail: null,
      id: `${email}:${status}`,
      kind: "person",
      providerId: `${email}:${status}`,
      sensitivity: null,
    });
    const orgChart = orgChartIndex({
      directory: [],
      vantaGroups: [],
      vantaPeople: [
        vantaPerson({ email: "ci@x.au", status: "CURRENT" }),
        vantaPerson({ email: "ana@x.au", status: "FORMER" }),
        vantaPerson({ email: "ana@x.au", status: "CURRENT" }),
        vantaPerson({ email: "bo@x.au", status: "FORMER" }),
        vantaPerson({ email: "bo@x.au", status: "CURRENT" }),
      ],
    });
    const rows = [
      row({ email: "ci@x.au", name: "CI", nativeId: "U1", profile: { bot: true } }),
      row({ email: "ana@x.au", name: "Ana", nativeId: "U2" }),
      row({ email: "bo@x.au", name: "Bo", nativeId: "U3", profile: { active: false } }),
    ];
    expect(slackPeopleFor({ ids: ["U1", "U2", "U3"], orgChart, rows }).map((person) => person.org)).toEqual([
      undefined,
      { title: { source: "vanta", value: "CURRENT" }, vantaGroups: [], vantaStatus: "CURRENT" },
      undefined,
    ]);
  });

  it("calls a first name unique only when no other current human in the org shares it, asked or not", () => {
    const rows = [
      row({ name: "Kyle Yardley", nativeId: "U1" }),
      row({ name: "kyle Other", nativeId: "U2" }),
      row({ name: "Sadie Smith", nativeId: "U3" }),
      row({ name: "Sadie Gone", nativeId: "U4", profile: { active: false } }),
      row({ name: "Sadie Bot", nativeId: "U5", profile: { bot: true } }),
    ];
    expect(
      slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U1", "U3", "U4"], rows }).map(
        (person) => person.firstNameUnique,
      ),
    ).toEqual([false, true, false]);
  });

  it("never counts a row keyed by a display name as a second person with that first name", () => {
    const rows = [row({ name: "Quinn Vance", nativeId: "U0SYN000004" }), row({ name: "Quinn", nativeId: "Quinn" })];
    expect(
      slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U0SYN000004"], rows }).map((person) => person.firstNameUnique),
    ).toEqual([true]);
  });

  it("counts the first name a member's real name opens on, when their display name is a handle", () => {
    const rows = [
      row({ name: "nickmazitelli", nativeId: "U1", raw: { real_name: "Noel Mazitelli" } }),
      row({ name: "Noel", nativeId: "U2" }),
      row({ name: "eric.kim", nativeId: "U3", raw: { profile: { first_name: "Eric" } } }),
      row({ name: "Eric Mitchell", nativeId: "U4" }),
    ];
    expect(
      slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U2", "U4"], rows }).map((person) => person.firstNameUnique),
    ).toEqual([false, false]);
  });

  it("calls a first name shared when it is any word of another current person's name, surname included", () => {
    const rows = [
      row({ name: "Lucas Salim", nativeId: "U1" }),
      row({ name: "Chris Lucas", nativeId: "U2" }),
      row({ name: "Arthur Costa", nativeId: "U3" }),
      row({ name: "Dr. Lauren Mac Arthur", nativeId: "U4" }),
      row({ name: "Quinn Vance", nativeId: "U5" }),
    ];
    expect(
      slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U1", "U3", "U5"], rows }).map(
        (person) => person.firstNameUnique,
      ),
    ).toEqual([false, false, true]);
  });

  it("never counts Slack's own system members as people, though Slack reports neither is a bot", () => {
    const rows = [
      row({ name: "Slackbot", nativeId: "USLACKBOT" }),
      row({ name: "Slack", nativeId: "USLACK" }),
      row({ name: "Slackbot Fan", nativeId: "U1" }),
      row({ name: "Slack Admin", nativeId: "U2" }),
    ];
    expect(
      slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["USLACKBOT", "USLACK", "U1", "U2"], rows }).map(
        (person) => person.firstNameUnique,
      ),
    ).toEqual([false, false, true, true]);
  });

  it("reads the first name a member row holds at its top level too", () => {
    const rows = [
      row({ name: "rsmith", nativeId: "U1", raw: { first_name: "Rob" } }),
      row({ name: "Rob Jones", nativeId: "U2" }),
    ];
    expect(
      slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U2"], rows }).map((person) => person.firstNameUnique),
    ).toEqual([false]);
  });

  it("calls a whole name theirs alone only when no other current person's name is it or starts with it", () => {
    const rows = [
      row({ name: "Joseph O", nativeId: "U1" }),
      row({ name: "Joseph O'Hara", nativeId: "U2" }),
      row({ name: "Yara Selwyn", nativeId: "U3" }),
      row({ name: "yara selwyn", nativeId: "U4", raw: { real_name: "Yara Selwyn" } }),
      row({ name: "Quinn Vance", nativeId: "U5" }),
      row({ name: "Quinn Vance", nativeId: "U6", profile: { active: false } }),
    ];
    expect(
      slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U1", "U2", "U3", "U5"], rows }).map(
        (person) => person.nameUnique,
      ),
    ).toEqual([false, true, false, true]);
  });

  it("keeps a whole name theirs when the only longer one is their bracketed second account, and no other", () => {
    const rows = [
      row({ name: "Seth Tanner", nativeId: "U0SYN000013" }),
      row({
        name: "Seth Tanner (Staff)",
        nativeId: "U0SYN000024",
        raw: { real_name: "Seth Tanner (Staff)" },
      }),
      row({ name: "Jo Lee", nativeId: "U3" }),
      row({ name: "Jo Lee Wei", nativeId: "U4" }),
      row({ name: "Ann Ko", nativeId: "U5" }),
      row({ name: "Ann Ko (a) (b)", nativeId: "U6" }),
    ];
    expect(
      slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U0SYN000013", "U0SYN000024", "U3", "U5"], rows }).map(
        (person) => [person.nativeId, person.nameUnique],
      ),
    ).toEqual([
      ["U0SYN000013", true],
      ["U0SYN000024", true],
      ["U3", false],
      ["U5", false],
    ]);
  });

  it("answers nothing for no ids", () => {
    expect(slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: [], rows: [row({ name: "X", nativeId: "U1" })] })).toEqual(
      [],
    );
  });

  it("carries the 72px avatar the identity resync projected", () => {
    const rows = [
      row({
        name: "Jasper",
        nativeId: "U0JASPER",
        profile: { avatar48Url: "https://avatars.example/j_48.png", avatar72Url: "https://avatars.example/j_72.png" },
        raw: { profile: { image_72: "https://avatars.example/stale_72.png" } },
      }),
    ];
    expect(
      slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U0JASPER"], rows }).map((person) => person.avatarUrl),
    ).toEqual(["https://avatars.example/j_72.png"]);
  });

  it("draws the larger kept picture for a row that predates the 72px projection, never the redacted raw one", () => {
    const rows = [
      row({
        name: "Jasper",
        nativeId: "U0JASPER",
        profile: { avatarUrl: "https://avatars.example/10949456385762_j_512.png" },
        raw: { profile: { image_72: "https://avatars.example/[number]_j_72.png" } },
      }),
    ];
    expect(
      slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U0JASPER"], rows }).map((person) => person.avatarUrl),
    ).toEqual(["https://avatars.example/10949456385762_j_512.png"]);
  });

  it("leaves the avatar unset when the row's profile holds none, whatever the raw member says", () => {
    const rows = [
      row({ name: "A", nativeId: "U1", raw: { profile: { image_72: "https://avatars.example/a_72.png" } } }),
    ];
    expect(slackPeopleFor({ orgChart: EMPTY_ORG_CHART, ids: ["U1"], rows }).map((person) => person.avatarUrl)).toEqual([
      undefined,
    ]);
  });
});
