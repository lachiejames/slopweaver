import { describe, expect, it } from "vitest";
import { avatarRoster } from "../../../../corpus/members/avatars.js";
import { buildMemberIdentity } from "../../../../corpus/members/email.js";
import type { MemberBronzeRow, MemberProfileFields } from "../../../../corpus/members/types.js";
import type { IdentitySource } from "../../../../silver/identity.js";

function row({
  source,
  nativeId,
  profile = {},
}: {
  source: IdentitySource;
  nativeId: string;
  profile?: MemberProfileFields;
}): MemberBronzeRow {
  return {
    fetchedAtIso: "2026-07-20T00:00:00.000Z",
    identity: buildMemberIdentity({ handle: nativeId, name: `Name of ${nativeId}`, nativeId, source }),
    profile,
    provenance: [],
    raw: {},
    source,
    sourceId: nativeId,
    version: 1,
    warnings: [],
  };
}

const ROWS: readonly MemberBronzeRow[] = [
  row({ nativeId: "ada", profile: { avatarUrl: "https://avatars.example/ada.png" }, source: "github" }),
  row({ nativeId: "U1", profile: { avatarUrl: "https://slack.example/u1.png", bot: true }, source: "slack" }),
  row({ nativeId: "no-picture", profile: {}, source: "github" }),
  row({ nativeId: "blank-picture", profile: { avatarUrl: "   " }, source: "github" }),
];

describe("avatarRoster", () => {
  it("keeps one entry per row with a picture, in read order, and drops the rows without one", () => {
    const roster = avatarRoster({ rows: ROWS });
    expect(roster).toEqual([
      {
        avatarUrl: "https://avatars.example/ada.png",
        bot: false,
        handle: "ada",
        name: "Name of ada",
        nativeId: "ada",
        source: "github",
      },
      {
        avatarUrl: "https://slack.example/u1.png",
        bot: true,
        handle: "U1",
        name: "Name of U1",
        nativeId: "U1",
        source: "slack",
      },
    ]);
  });

  it("narrows to one source when asked", () => {
    expect(avatarRoster({ rows: ROWS, source: "slack" }).map((entry) => entry.nativeId)).toEqual(["U1"]);
    expect(avatarRoster({ rows: ROWS, source: "linear" })).toEqual([]);
  });

  it("keeps only the platform ids named, when a set is given", () => {
    expect(avatarRoster({ ids: new Set(["U1", "nobody"]), rows: ROWS }).map((entry) => entry.nativeId)).toEqual(["U1"]);
    expect(avatarRoster({ ids: new Set(), rows: ROWS })).toEqual([]);
  });

  it("keeps one entry per member, the row fetched last, when bronze holds many", () => {
    const older = {
      ...row({ nativeId: "U2", profile: { avatarUrl: "https://slack.example/old.png" }, source: "slack" }),
      fetchedAtIso: "2026-07-01T00:00:00.000Z",
    };
    const newer = {
      ...row({ nativeId: "U2", profile: { avatarUrl: "https://slack.example/new.png" }, source: "slack" }),
      fetchedAtIso: "2026-09-01T00:00:00.000Z",
    };
    expect(avatarRoster({ rows: [newer, older] }).map((entry) => entry.avatarUrl)).toEqual([
      "https://slack.example/new.png",
    ]);
    expect(avatarRoster({ rows: [older, newer] }).map((entry) => entry.avatarUrl)).toEqual([
      "https://slack.example/new.png",
    ]);
  });

  it("answers an empty roster for no rows", () => {
    expect(avatarRoster({ rows: [] })).toEqual([]);
  });
});
