/*
 * The Slack member directory — how one `users.list` member projects into an identity and profile row, and how
 * `fetchSlackMembers` pages the directory. It moved here when `fetch.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import type { SlackApi } from "../../../../../corpus/slack/fetch.js";
import { fetchSlackMembers, projectSlackMember } from "../../../../../corpus/slack/members.js";
import { unwrap } from "../../../../../lib/result.js";
import { unusedFilesInfo } from "./harness.js";

const AT = "2026-07-20T00:00:00.000Z";

describe("projectSlackMember", () => {
  it("captures the full member (email + name + handle) and keeps the raw object", () => {
    const raw = {
      // `deleted` is on every real `users.list` member — MEASURED, all 911 on one install
      // carry it — and the projection now READS it rather than inferring activity from its absence.
      deleted: false,
      id: "U1",
      is_admin: true,
      name: "ada",
      profile: { display_name: "Ada", email: "ada@example.com", title: "Engineer" },
      tz: "Australia/Sydney",
    };
    const row = projectSlackMember({ fetchedAtIso: AT, raw })!;
    expect(row.identity).toEqual({
      email: "ada@example.com",
      emailNormalised: "ada@example.com",
      emailTrust: "trusted",
      handle: "ada",
      name: "Ada",
      nativeId: "U1",
      source: "slack",
    });
    expect(row.profile).toEqual({
      active: true,
      admin: true,
      avatarUrl: undefined,
      bot: false,
      guest: false,
      timezone: "Australia/Sydney",
      title: "Engineer",
    });
    expect(row.raw).toEqual(raw);
  });

  it("marks a deactivated member inactive rather than dropping them", () => {
    const row = projectSlackMember({ fetchedAtIso: AT, raw: { deleted: true, id: "U2", name: "bo" } })!;
    expect(row.profile.active).toBe(false);
    expect(row.sourceId).toBe("U2");
  });

  it("says nothing about activity when the payload carries no deleted field", () => {
    const row = projectSlackMember({ fetchedAtIso: AT, raw: { id: "U3", name: "cy" } })!;
    expect(row.profile.active).toBe(undefined);
  });

  it("warns (no guessed email) when the users:read.email scope did not populate profile.email", () => {
    const row = projectSlackMember({ fetchedAtIso: AT, raw: { id: "U2", name: "grace", profile: {} } })!;
    expect(row.identity.emailTrust).toBe("missing");
    expect(row.warnings).toEqual(["no email — set the users:read.email scope for cross-source linking"]);
  });

  it("flags a bot and a deactivated member", () => {
    expect(projectSlackMember({ fetchedAtIso: AT, raw: { id: "B1", is_bot: true, profile: {} } })!.profile.bot).toBe(
      true,
    );
    expect(
      projectSlackMember({ fetchedAtIso: AT, raw: { deleted: true, id: "D1", profile: {} } })!.profile.active,
    ).toBe(false);
  });

  it("projects the 48px and 72px avatars Slack draws beside a message, leaving an empty one unset", () => {
    const profile = {
      image_48: "https://avatars.example/a_48.png",
      image_72: "https://avatars.example/a_72.png",
      image_512: "https://avatars.example/a.png",
    };
    const row = projectSlackMember({ fetchedAtIso: AT, raw: { id: "U1", name: "ada", profile } })!;
    expect([row.profile.avatar48Url, row.profile.avatar72Url, row.profile.avatarUrl]).toEqual([
      "https://avatars.example/a_48.png",
      "https://avatars.example/a_72.png",
      "https://avatars.example/a.png",
    ]);
    const blank = projectSlackMember({ fetchedAtIso: AT, raw: { id: "U2", name: "bo", profile: { image_72: "" } } })!;
    expect([blank.profile.avatar48Url, blank.profile.avatar72Url]).toEqual([undefined, undefined]);
  });
});

describe("fetchSlackMembers", () => {
  it("pages users.list into member rows and aggregates the missing-email warning", async () => {
    const api: SlackApi = {
      filesInfo: unusedFilesInfo,
      grantedScopes: async () => ["files:read"],
      history: async () => ({ messages: [] }),
      listChannels: async () => ({ channels: [] }),
      listUsers: async ({ cursor }) =>
        cursor === undefined
          ? { members: [{ id: "U1", profile: { email: "ada@example.com" } }], nextCursor: "c2" }
          : { members: [{ id: "U2", profile: {} }] },
      replies: async () => ({ messages: [] }),
      workspaceUrl: async () => "https://acme.slack.com",
    };
    const result = unwrap(await fetchSlackMembers({ api, fetchedAtIso: AT }));
    expect(result.rows.map((r) => r.sourceId)).toEqual(["U1", "U2"]);
    expect(result.warnings).toEqual(["no email — set the users:read.email scope for cross-source linking"]);
  });
});
