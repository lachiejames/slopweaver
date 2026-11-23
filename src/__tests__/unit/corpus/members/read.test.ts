/**
 * The member connectors' defensive field readers: a boolean survives as itself, `false` included, and nothing
 * is coerced into one; an identity takes its source from the caller, keeps only readable optional strings,
 * falls back to `missing` trust for an unknown tier and to an empty native id for an absent one; a profile
 * keeps its readable strings and flags and drops an empty or mistyped team list.
 */
import { describe, expect, it } from "vitest";

import { optBool, readMemberIdentity, readMemberProfile } from "../../../../corpus/members/read.js";

describe("optBool", () => {
  it("keeps true and false as themselves and never coerces anything else", () => {
    expect([true, false, "true", 0, 1, null, undefined].map((value) => optBool({ value }))).toEqual([
      true,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("readMemberIdentity", () => {
  it("reads every curated identity field off a complete row", () => {
    expect(
      readMemberIdentity({
        source: "slack",
        value: {
          email: "Ada@Example.com",
          emailNormalised: "ada@example.com",
          emailTrust: "trusted",
          handle: "ada",
          name: "Ada Lovelace",
          nativeId: "U123",
        },
      }),
    ).toEqual({
      email: "Ada@Example.com",
      emailNormalised: "ada@example.com",
      emailTrust: "trusted",
      handle: "ada",
      name: "Ada Lovelace",
      nativeId: "U123",
      source: "slack",
    });
  });

  it("takes the caller's source, missing trust for an unknown tier, an empty native id, and no unreadable strings", () => {
    expect(
      readMemberIdentity({
        source: "github",
        value: { email: 42, emailTrust: "certain", handle: "", name: null, nativeId: 7, source: "slack" },
      }),
    ).toEqual({ emailTrust: "missing", nativeId: "", source: "github" });
  });

  it("reads a value that is not an object as an empty row", () => {
    expect(readMemberIdentity({ source: "linear", value: "U123" })).toEqual({
      emailTrust: "missing",
      nativeId: "",
      source: "linear",
    });
  });
});

describe("readMemberProfile", () => {
  it("keeps readable strings, non-empty team names and every flag, false included", () => {
    expect(
      readMemberProfile({
        value: {
          active: true,
          admin: false,
          avatar48Url: "https://img/48",
          avatar72Url: "https://img/72",
          avatarUrl: "https://img/full",
          bot: false,
          guest: false,
          teams: ["platform", "", 3, "data"],
          timezone: "Australia/Sydney",
          title: "Engineer",
        },
      }),
    ).toEqual({
      active: true,
      admin: false,
      avatar48Url: "https://img/48",
      avatar72Url: "https://img/72",
      avatarUrl: "https://img/full",
      bot: false,
      guest: false,
      teams: ["platform", "data"],
      timezone: "Australia/Sydney",
      title: "Engineer",
    });
  });

  it("drops a team list with no readable name, a mistyped one, empty strings and non-boolean flags", () => {
    expect(readMemberProfile({ value: { active: "yes", teams: ["", 4], timezone: "", title: 9 } })).toEqual({});
    expect(readMemberProfile({ value: { teams: "platform" } })).toEqual({});
  });
});
