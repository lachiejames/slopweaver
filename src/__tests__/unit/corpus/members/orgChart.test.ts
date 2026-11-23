import { describe, expect, it } from "vitest";

import type { VantaEntity } from "../../../../atlas/vanta/model.js";
import type { DirectoryUserRow } from "../../../../corpus/directory/types.js";
import { orgFactsFor } from "../../../../corpus/members/orgChart.js";
import { orgChartIndex } from "../../../../corpus/members/orgChartIndex.js";

function vanta({
  kind,
  id,
  detail,
  state = "observed",
}: {
  kind: "person" | "group";
  id: string;
  detail: unknown;
  state?: "observed" | "stale";
}): VantaEntity {
  return {
    channels: {
      browser: null,
      "manage-api": {
        channel: "manage-api",
        detail,
        firstSeenAt: "2026-09-01T00:00:00.000Z",
        lastSeenAt: "2026-09-29T00:00:00.000Z",
        source: null,
        state,
      },
    },
    financialDetail: null,
    id,
    kind,
    providerId: id,
    sensitivity: null,
  };
}

function person({
  email,
  groupIds,
  jobTitle = null,
  status = "CURRENT",
  startDate = "2025-01-01T00:00:00.000Z",
  state = "observed",
}: {
  email: string;
  groupIds: readonly string[];
  jobTitle?: string | null;
  status?: string;
  startDate?: string;
  state?: "observed" | "stale";
}): VantaEntity {
  return vanta({
    detail: { emailAddress: email, employment: { endDate: null, jobTitle, startDate, status }, groupIds, id: email },
    id: `${email}:${startDate}`,
    kind: "person",
    state,
  });
}

function group({ id, name, size }: { id: string; name: string; size: number }): VantaEntity {
  return vanta({ detail: { id, name, personnelCount: size }, id, kind: "group" });
}

function user({
  email,
  aliases = [],
  title,
  orgUnitPath,
  department,
}: {
  email: string;
  aliases?: readonly string[];
  title?: string;
  orgUnitPath?: string;
  department?: string;
}): DirectoryUserRow {
  return {
    aliases,
    archived: false,
    emailNormalised: email,
    fetchedAtIso: "2026-09-16T00:00:00.000Z",
    fullName: email,
    googleId: email,
    isAdmin: false,
    primaryEmail: email,
    raw: { aliases, organizations: department === undefined ? [] : [{ department, title }] },
    suspended: false,
    version: 1,
    ...(title === undefined ? {} : { title }),
    ...(orgUnitPath === undefined ? {} : { orgUnitPath }),
  };
}

const GROUPS = [
  group({ id: "g-everyone", name: "Everyone", size: 587 }),
  group({ id: "g-fulltime", name: "Full-time permanent", size: 118 }),
  group({ id: "g-operations", name: "Operations", size: 40 }),
];

describe("orgFactsFor", () => {
  it("joins Google's title, team and unit with Vanta's groups, the smallest group first", () => {
    const chart = orgChartIndex({
      directory: [
        user({
          department: "Operations",
          email: "sophie@x.au",
          orgUnitPath: "/Staff/Operations",
          title: "Operations Lead",
        }),
      ],
      vantaGroups: GROUPS,
      vantaPeople: [person({ email: "Sophie@X.au", groupIds: ["g-everyone", "g-fulltime", "g-operations"] })],
    });
    expect(orgFactsFor({ active: true, chart, email: "sophie@x.au" })).toEqual({
      department: "Operations",
      orgUnit: "/Staff/Operations",
      title: { source: "google-admin", value: "Operations Lead" },
      vantaGroups: ["Operations", "Full-time permanent", "Everyone"],
      vantaStatus: "CURRENT",
    });
  });

  it("takes Vanta's job title when Google holds none, and names Vanta as its source", () => {
    const chart = orgChartIndex({
      directory: [user({ email: "jo@x.au" })],
      vantaGroups: GROUPS,
      vantaPeople: [person({ email: "jo@x.au", groupIds: [], jobTitle: "Chief of Staff" })],
    });
    expect(orgFactsFor({ active: true, chart, email: "jo@x.au" })?.title).toEqual({
      source: "vanta",
      value: "Chief of Staff",
    });
  });

  it("answers nothing for an address neither store holds, or no trusted address at all", () => {
    const chart = orgChartIndex({ directory: [user({ email: "a@x.au" })], vantaGroups: [], vantaPeople: [] });
    expect([
      orgFactsFor({ active: true, chart, email: "b@x.au" }),
      orgFactsFor({ active: true, chart, email: undefined }),
    ]).toEqual([undefined, undefined]);
  });

  it("reaches a directory user by an alias and by the address a leaver used before their term_emp_ rename", () => {
    const chart = orgChartIndex({
      directory: [
        user({ aliases: ["seth@old.au"], email: "seth@x.au", title: "Engineer" }),
        user({ email: "term_emp_kim@x.au", orgUnitPath: "/Staff/Leaver" }),
      ],
      vantaGroups: [],
      vantaPeople: [],
    });
    expect([
      orgFactsFor({ active: true, chart, email: "seth@old.au" })?.title?.value,
      orgFactsFor({ active: true, chart, email: "kim@x.au" })?.orgUnit,
    ]).toEqual(["Engineer", "/Staff/Leaver"]);
  });

  it("reads only an observed Vanta generation, and skips a group id no observed group carries", () => {
    const chart = orgChartIndex({
      directory: [],
      vantaGroups: GROUPS,
      vantaPeople: [
        person({ email: "old@x.au", groupIds: ["g-fulltime"], state: "stale" }),
        person({ email: "new@x.au", groupIds: ["g-gone", "g-fulltime"] }),
      ],
    });
    expect([
      orgFactsFor({ active: true, chart, email: "old@x.au" }),
      orgFactsFor({ active: true, chart, email: "new@x.au" })?.vantaGroups,
    ]).toEqual([undefined, ["Full-time permanent"]]);
  });

  it("resolves an address two Vanta people hold only for an active member, and only to its one CURRENT holder", () => {
    const chart = orgChartIndex({
      directory: [],
      vantaGroups: [],
      vantaPeople: [
        person({ email: "re@x.au", groupIds: [], jobTitle: "Leaver", status: "FORMER" }),
        person({ email: "re@x.au", groupIds: [], jobTitle: "Hire", status: "CURRENT" }),
        person({ email: "two@x.au", groupIds: [], jobTitle: "Old", startDate: "2024-01-01T00:00:00.000Z" }),
        person({ email: "two@x.au", groupIds: [], jobTitle: "New", startDate: "2025-01-01T00:00:00.000Z" }),
        person({ email: "gone@x.au", groupIds: [], jobTitle: "Once", status: "FORMER" }),
      ],
    });
    expect([
      orgFactsFor({ active: true, chart, email: "re@x.au" })?.title?.value,
      orgFactsFor({ active: false, chart, email: "re@x.au" }),
      orgFactsFor({ active: true, chart, email: "two@x.au" }),
      orgFactsFor({ active: false, chart, email: "gone@x.au" })?.title?.value,
    ]).toEqual(["Hire", undefined, undefined, "Once"]);
  });

  it("joins nobody on an address two directory users claim, while a primary always means its own user", () => {
    const chart = orgChartIndex({
      directory: [
        user({ email: "term_emp_max@x.au", title: "Leaver" }),
        user({ aliases: ["max@x.au", "team@x.au"], email: "kim@x.au", title: "Kim's" }),
        user({ aliases: ["kim@x.au"], email: "lee@x.au", title: "Lee's" }),
      ],
      vantaGroups: [],
      vantaPeople: [],
    });
    expect([
      orgFactsFor({ active: true, chart, email: "max@x.au" }),
      orgFactsFor({ active: true, chart, email: "kim@x.au" })?.title?.value,
      orgFactsFor({ active: true, chart, email: "team@x.au" })?.title?.value,
    ]).toEqual([undefined, "Kim's", "Kim's"]);
  });

  it("never reaches a colleague through an alias for a deactivated member, whose address was likely handed on", () => {
    const chart = orgChartIndex({
      directory: [
        user({ aliases: ["kim@x.au"], email: "max@x.au", title: "Head of Operations" }),
        user({ email: "term_emp_jo@x.au", title: "Staff" }),
      ],
      vantaGroups: [],
      vantaPeople: [],
    });
    expect([
      orgFactsFor({ active: false, chart, email: "kim@x.au" }),
      orgFactsFor({ active: true, chart, email: "kim@x.au" })?.title?.value,
      orgFactsFor({ active: false, chart, email: "jo@x.au" })?.title?.value,
      orgFactsFor({ active: false, chart, email: "max@x.au" })?.title?.value,
    ]).toEqual([undefined, "Head of Operations", "Staff", "Head of Operations"]);
  });

  it("joins a deactivated member to nobody on a leaver's old address Google re-issued as someone's primary", () => {
    const chart = orgChartIndex({
      directory: [
        user({ email: "term_emp_alice@x.au", title: "Staff" }),
        user({ email: "alice@x.au", orgUnitPath: "/Staff/Platform", title: "Staff Engineer" }),
      ],
      vantaGroups: GROUPS,
      vantaPeople: [person({ email: "alice@x.au", groupIds: ["g-operations"] })],
    });
    expect([
      orgFactsFor({ active: false, chart, email: "alice@x.au" }),
      orgFactsFor({ active: true, chart, email: "alice@x.au" })?.title?.value,
    ]).toEqual([undefined, "Staff Engineer"]);
  });

  it("never draws one store's leaver beside the other's employee on the same address, whichever store lags", () => {
    const chart = orgChartIndex({
      directory: [
        user({ email: "term_emp_alice@x.au", title: "Staff" }),
        user({ email: "alice@x.au", title: "Staff Engineer" }),
        user({ email: "bo@x.au", title: "Engineer" }),
        user({ email: "term_emp_cy@x.au", title: "Medic" }),
        user({ email: "term_emp_di@x.au", title: "Staff" }),
        user({ email: "term_emp_ed@x.au", title: "Staff" }),
      ],
      vantaGroups: GROUPS,
      vantaPeople: [
        person({ email: "alice@x.au", groupIds: ["g-operations"], status: "FORMER" }),
        person({ email: "bo@x.au", groupIds: ["g-operations"], status: "FORMER" }),
        person({ email: "cy@x.au", groupIds: ["g-operations"], status: "FORMER" }),
        person({ email: "di@x.au", groupIds: ["g-operations"], status: "CURRENT" }),
        person({ email: "ed@x.au", groupIds: ["g-operations"], status: "ON_LEAVE" }),
      ],
    });
    expect([
      orgFactsFor({ active: true, chart, email: "alice@x.au" }),
      orgFactsFor({ active: true, chart, email: "bo@x.au" }),
      orgFactsFor({ active: false, chart, email: "cy@x.au" })?.vantaStatus,
      orgFactsFor({ active: false, chart, email: "di@x.au" })?.vantaStatus,
      orgFactsFor({ active: false, chart, email: "ed@x.au" })?.vantaStatus,
    ]).toEqual([
      { title: { source: "google-admin", value: "Staff Engineer" }, vantaGroups: [] },
      { title: { source: "google-admin", value: "Engineer" }, vantaGroups: [] },
      "FORMER",
      undefined,
      "ON_LEAVE",
    ]);
  });

  it("reads Vanta's term_emp_ rename as a re-issue when Google has deleted the leaver it renamed", () => {
    const chart = orgChartIndex({
      directory: [user({ email: "alice@x.au", title: "Staff Engineer" }), user({ email: "term_emp_sy@x.au" })],
      vantaGroups: [],
      vantaPeople: [
        person({ email: "term_emp_alice@x.au", groupIds: [], status: "FORMER" }),
        person({ email: "alice@x.au", groupIds: [], status: "CURRENT" }),
        person({ email: "term_emp_bea@x.au", groupIds: [], status: "FORMER" }),
        person({ email: "bea@x.au", groupIds: [], jobTitle: "Staff", status: "CURRENT" }),
        person({ email: "term_emp_sy@x.au", groupIds: [], status: "FORMER" }),
        person({ email: "sy@x.au", groupIds: [], status: "FORMER" }),
      ],
    });
    expect([
      orgFactsFor({ active: false, chart, email: "alice@x.au" }),
      orgFactsFor({ active: false, chart, email: "bea@x.au" }),
      orgFactsFor({ active: true, chart, email: "alice@x.au" })?.vantaStatus,
      orgFactsFor({ active: true, chart, email: "bea@x.au" })?.title?.value,
      orgFactsFor({ active: false, chart, email: "sy@x.au" })?.vantaStatus,
    ]).toEqual([undefined, undefined, "CURRENT", "Staff", "FORMER"]);
  });

  it("joins an active member to nobody on a leaver's address Vanta says someone employed holds now", () => {
    const chart = orgChartIndex({
      directory: [
        user({ email: "term_emp_alice@x.au", title: "Staff" }),
        user({ email: "term_emp_bo@x.au", title: "Medic" }),
      ],
      vantaGroups: [],
      vantaPeople: [
        person({ email: "alice@x.au", groupIds: [], status: "FORMER" }),
        person({ email: "alice@x.au", groupIds: [], status: "CURRENT" }),
        person({ email: "bo@x.au", groupIds: [], status: "FORMER" }),
      ],
    });
    expect([
      orgFactsFor({ active: true, chart, email: "alice@x.au" }),
      orgFactsFor({ active: false, chart, email: "alice@x.au" })?.title?.value,
      orgFactsFor({ active: true, chart, email: "bo@x.au" })?.title?.value,
    ]).toEqual([undefined, "Staff", "Medic"]);
  });

  it("matches the address exactly as issued, never folding a +tag onto the mailbox it would deliver to", () => {
    const chart = orgChartIndex({
      directory: [user({ aliases: ["hello@x.au"], email: "ceo@x.au", title: "CEO" })],
      vantaGroups: [],
      vantaPeople: [person({ email: "ceo@x.au", groupIds: [] })],
    });
    expect([
      orgFactsFor({ active: true, chart, email: "hello+slack@x.au" }),
      orgFactsFor({ active: true, chart, email: "ceo+slack@x.au" }),
      orgFactsFor({ active: true, chart, email: " CEO@X.au " })?.title?.value,
    ]).toEqual([undefined, undefined, "CEO"]);
  });

  it("says nothing of the root org unit, where Google puts anyone nobody placed", () => {
    const chart = orgChartIndex({
      directory: [user({ email: "r@x.au", orgUnitPath: "/" })],
      vantaGroups: [],
      vantaPeople: [],
    });
    expect(orgFactsFor({ active: true, chart, email: "r@x.au" })).toEqual({ vantaGroups: [] });
  });
});
