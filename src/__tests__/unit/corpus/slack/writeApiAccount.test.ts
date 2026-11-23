import { describe, expect, it } from "vitest";

import { hasForeignMemberShape, taggedAccountFrom } from "../../../../corpus/slack/writeApiAccount.js";

describe("taggedAccountFrom", () => {
  it("reads a deactivated account and its handle", () => {
    expect(taggedAccountFrom({ user: { deleted: true, id: "U0NOEL", name: "nicholas.hairs" } })).toEqual({
      deleted: true,
      kind: "read",
      name: "nicholas.hairs",
    });
  });

  it("reads a live account", () => {
    expect(taggedAccountFrom({ user: { deleted: false, name: "seth.tanner" } })).toEqual({
      deleted: false,
      kind: "read",
      name: "seth.tanner",
    });
  });

  it("carries no handle when Slack gave none or an empty one", () => {
    expect(taggedAccountFrom({ user: { deleted: true, name: "" } })).toEqual({
      deleted: true,
      kind: "read",
      name: undefined,
    });
  });

  it("is unreadable when `deleted` is absent, never a live account", () => {
    expect(taggedAccountFrom({ user: { name: "seth.tanner" } })).toEqual({
      cause: "users.info did not say whether the account is deactivated",
      kind: "unreadable",
    });
  });

  it("is unreadable when `deleted` is not a boolean", () => {
    expect(taggedAccountFrom({ user: { deleted: "true" } })).toEqual({
      cause: "users.info did not say whether the account is deactivated",
      kind: "unreadable",
    });
  });

  it("is unreadable when there is no user record", () => {
    expect(taggedAccountFrom({ user: undefined })).toEqual({
      cause: "users.info answered with no user record",
      kind: "unreadable",
    });
  });
});

describe("taggedAccountFrom on another workspace's member", () => {
  // The shape measured on a Slack Connect member: no `deleted`, `is_stranger` false, a foreign team.
  const connect = { id: "UAUDITCO", is_stranger: false, name: "felix.marsh", team_id: "TAUDITCO" };
  const asked = { tokenTeamId: "TACME", userId: "UAUDITCO" };
  const unreadable = { cause: "users.info did not say whether the account is deactivated", kind: "unreadable" };

  it("is external when the record omits `deleted`, carries `is_stranger`, a team other than the token's and the asked id", () => {
    expect(taggedAccountFrom({ ...asked, user: connect })).toEqual({ kind: "external", name: "felix.marsh" });
  });

  it("carries no handle on an external account when Slack gave an empty one", () => {
    expect(taggedAccountFrom({ ...asked, user: { ...connect, name: "" } })).toEqual({
      kind: "external",
      name: undefined,
    });
  });

  it("stays unreadable when the record carries no id, so it describes nobody the tag named", () => {
    expect(taggedAccountFrom({ ...asked, user: { is_stranger: false, team_id: "TAUDITCO" } })).toEqual(unreadable);
  });

  it("stays unreadable when the record's id is another account's", () => {
    expect(taggedAccountFrom({ ...asked, user: { ...connect, id: "UOTHER" } })).toEqual(unreadable);
  });

  it("stays unreadable for a Grid member whose teams include the token's", () => {
    const grid = { enterprise_user: { teams: ["TAUDITCO", "TACME"] } };
    expect(taggedAccountFrom({ ...asked, user: { ...connect, ...grid } })).toEqual(unreadable);
  });

  it("stays unreadable for a Grid member whose teams leave the token's out, since they may have just left it", () => {
    const grid = { enterprise_user: { teams: ["TAUDITCO"] } };
    expect(taggedAccountFrom({ ...asked, user: { ...connect, ...grid } })).toEqual(unreadable);
  });

  it("stays unreadable when the record names an enterprise at all", () => {
    expect(taggedAccountFrom({ ...asked, user: { ...connect, enterprise_id: "E0GRID" } })).toEqual(unreadable);
  });

  it("stays unreadable when the asked id was not passed", () => {
    expect(taggedAccountFrom({ tokenTeamId: "TACME", user: connect })).toEqual(unreadable);
  });

  it("stays unreadable when the team is the token's own, since `is_stranger: false` describes local users too", () => {
    expect(taggedAccountFrom({ ...asked, tokenTeamId: "TAUDITCO", user: connect })).toEqual(unreadable);
  });

  it("stays unreadable when the token's own team was not read", () => {
    expect(taggedAccountFrom({ user: connect, userId: "UAUDITCO" })).toEqual(unreadable);
  });

  it("stays unreadable when the record names no team", () => {
    expect(taggedAccountFrom({ ...asked, user: { id: "UAUDITCO", is_stranger: false, name: "x" } })).toEqual(
      unreadable,
    );
  });

  it("stays unreadable when the record's team id is malformed, so it proves no difference", () => {
    expect(taggedAccountFrom({ ...asked, user: { ...connect, team_id: "TACME " } })).toEqual(unreadable);
  });

  it("stays unreadable when the token's team id is malformed", () => {
    expect(taggedAccountFrom({ ...asked, tokenTeamId: "tlocal", user: connect })).toEqual(unreadable);
  });

  it("stays unreadable when `is_stranger` is absent", () => {
    expect(taggedAccountFrom({ ...asked, user: { id: "UAUDITCO", name: "x", team_id: "TAUDITCO" } })).toEqual(
      unreadable,
    );
  });

  it("stays unreadable when `deleted` is present but malformed, never read as absent", () => {
    expect(taggedAccountFrom({ ...asked, user: { ...connect, deleted: null } })).toEqual(unreadable);
  });

  it("reads `deleted` when Slack gave it, whatever the team", () => {
    expect(taggedAccountFrom({ ...asked, user: { ...connect, deleted: true } })).toEqual({
      deleted: true,
      kind: "read",
      name: "felix.marsh",
    });
  });
});

describe("hasForeignMemberShape", () => {
  it("is true for a record with no `deleted` and a boolean `is_stranger`", () => {
    expect(hasForeignMemberShape({ user: { is_stranger: false, team_id: "T1" } })).toBe(true);
  });

  it("is false for a local member's record, which carries `deleted`", () => {
    expect(hasForeignMemberShape({ user: { deleted: false, team_id: "T1" } })).toBe(false);
  });

  it("is false for a record with `deleted` present as null", () => {
    expect(hasForeignMemberShape({ user: { deleted: null, is_stranger: false } })).toBe(false);
  });

  it("is false when there is no record", () => {
    expect(hasForeignMemberShape({ user: undefined })).toBe(false);
  });
});
