import { describe, expect, it } from "vitest";
import type { MemberBronzeRow } from "../../../../corpus/members/types.js";
import {
  connectMemberName,
  listedMemberIds,
  mergeConnectMembers,
  NO_EMAIL_WARNING,
  projectConnectMember,
  USER_PROFILE_PROVENANCE,
  USERS_LIST_PROVENANCE,
} from "../../../../corpus/slack/connectMembers.js";
import { foldProfileLine, type ProfileSighting } from "../../../../corpus/slack/connectMembersScan.js";
import { projectSlackMember } from "../../../../corpus/slack/members.js";
import { classifyMemberRow } from "../../../../silver/accountKind.js";

const FETCHED = "2026-09-20T00:00:00.000Z";

/** The verbatim shape Slack stamps on a message whose author `users.list` cannot return. */
const PROFILE = {
  avatar_hash: "d9911dae6a78",
  display_name: "Martin Zell",
  first_name: "Dr",
  image_72: "https://avatars.slack-edge.com/72.png",
  is_restricted: false,
  is_ultra_restricted: false,
  name: "dr.martin.zell",
  real_name: "Dr Martin Zell",
  team: "T0SYN000002",
};

/** One bronze JSONL line carrying a message, its author and an optional `user_profile`. */
function bronzeLine({
  author,
  tsIso,
  profile,
}: {
  author: string;
  tsIso: string;
  profile?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    author,
    container: "slack/C0SYN000025",
    kind: "message",
    raw: { text: "hi", ...(profile !== undefined ? { user_profile: profile } : {}) },
    refs: [],
    source: "slack",
    sourceId: `C0SYN000025:${tsIso}`,
    text: "hi",
    tsIso,
    url: "https://acme.slack.com/archives/C0SYN000025/p1",
  });
}

describe("connectMemberName", () => {
  it("prefers display_name", () => {
    expect(connectMemberName({ profile: PROFILE })).toBe("Martin Zell");
  });

  it("falls back to real_name when display_name is empty", () => {
    expect(connectMemberName({ profile: { ...PROFILE, display_name: "" } })).toBe("Dr Martin Zell");
  });

  it("falls back to the handle when neither name is present", () => {
    expect(connectMemberName({ profile: { name: "dr.martin.zell" } })).toBe("dr.martin.zell");
  });

  it("is undefined for a profile carrying no name at all", () => {
    expect(connectMemberName({ profile: { team: "T0SYN000002" } })).toBeUndefined();
  });
});

describe("projectConnectMember", () => {
  it("projects the id, handle, name and team off a message profile", () => {
    const row = projectConnectMember({ fetchedAtIso: FETCHED, profile: PROFILE, userId: "U0SYN000009" })!;
    expect(row.sourceId).toBe("U0SYN000009");
    expect(row.identity.nativeId).toBe("U0SYN000009");
    expect(row.identity.handle).toBe("dr.martin.zell");
    expect(row.identity.name).toBe("Martin Zell");
    expect(row.profile.teams).toEqual(["T0SYN000002"]);
    expect(row.provenance).toEqual([USER_PROFILE_PROVENANCE]);
    expect(row.source).toBe("slack");
    expect(row.version).toBe(1);
    expect(row.fetchedAtIso).toBe(FETCHED);
  });

  it("records the email as missing and says why, since no scope can add one", () => {
    const row = projectConnectMember({ fetchedAtIso: FETCHED, profile: PROFILE, userId: "U0SYN000009" })!;
    expect(row.identity.emailTrust).toBe("missing");
    expect(row.identity.email).toBeUndefined();
    expect(row.warnings).toEqual([NO_EMAIL_WARNING]);
  });

  it("omits active rather than inventing one — user_profile carries no deleted field", () => {
    const row = projectConnectMember({ fetchedAtIso: FETCHED, profile: PROFILE, userId: "U0SYN000009" })!;
    expect("active" in row.profile).toBe(false);
  });

  it("omits bot rather than manufacturing a negative — user_profile carries no is_bot field", () => {
    // An unconditional `bot: false` would stop classifyMemberRow's first structural rule from ever firing on
    // a bot recovered this way, classifying it a teammate on a fact nobody asserted. Found by the r2 review.
    const row = projectConnectMember({ fetchedAtIso: FETCHED, profile: PROFILE, userId: "U0SYN000009" })!;
    expect("bot" in row.profile).toBe(false);
  });

  it("classifies a recovered row as a person, never external — the Linear customer rule must not reach it", () => {
    const row = projectConnectMember({ fetchedAtIso: FETCHED, profile: PROFILE, userId: "U0SYN000009" })!;
    expect(classifyMemberRow({ row }).kind).toBe("person");
  });

  it("does not claim the external provenance the Linear lane uses", () => {
    const row = projectConnectMember({ fetchedAtIso: FETCHED, profile: PROFILE, userId: "U0SYN000009" })!;
    expect(row.provenance).not.toContain("linear.externalUsers");
  });

  it("reads guest off is_restricted", () => {
    const row = projectConnectMember({
      fetchedAtIso: FETCHED,
      profile: { ...PROFILE, is_restricted: true },
      userId: "U1",
    })!;
    expect(row.profile.guest).toBe(true);
  });

  it("reads guest off is_ultra_restricted", () => {
    const row = projectConnectMember({
      fetchedAtIso: FETCHED,
      profile: { ...PROFILE, is_ultra_restricted: true },
      userId: "U1",
    })!;
    expect(row.profile.guest).toBe(true);
  });

  it("prefers the 512px avatar and falls back to the 72px one", () => {
    const small = projectConnectMember({ fetchedAtIso: FETCHED, profile: PROFILE, userId: "U1" })!;
    expect(small.profile.avatarUrl).toBe("https://avatars.slack-edge.com/72.png");
    const large = projectConnectMember({
      fetchedAtIso: FETCHED,
      profile: { ...PROFILE, image_512: "https://avatars.slack-edge.com/512.png" },
      userId: "U1",
    })!;
    expect(large.profile.avatarUrl).toBe("https://avatars.slack-edge.com/512.png");
  });

  it("is undefined for a non-object profile", () => {
    expect(projectConnectMember({ fetchedAtIso: FETCHED, profile: "nope", userId: "U1" })).toBeUndefined();
  });

  it("is undefined for an empty author id", () => {
    expect(projectConnectMember({ fetchedAtIso: FETCHED, profile: PROFILE, userId: "" })).toBeUndefined();
  });

  it("omits teams when the profile names no team", () => {
    const row = projectConnectMember({ fetchedAtIso: FETCHED, profile: { name: "x" }, userId: "U1" })!;
    expect(row.profile.teams).toBeUndefined();
  });
});

describe("listedMemberIds", () => {
  const fromList = projectSlackMember({ fetchedAtIso: FETCHED, raw: { id: "U0SYN000018", name: "dr.martin.zell" } })!;
  const fromProfile = projectConnectMember({ fetchedAtIso: FETCHED, profile: PROFILE, userId: "U0SYN000009" })!;

  it("names the ids users.list answered for, and only those", () => {
    const ids = listedMemberIds({ stored: [fromList, fromProfile] });
    expect([...ids]).toEqual(["U0SYN000018"]);
  });

  it("reads the provenance the users.list lane actually writes", () => {
    expect(fromList.provenance).toEqual([USERS_LIST_PROVENANCE]);
  });

  it("is empty for a store holding nothing", () => {
    expect([...listedMemberIds({ stored: [] })]).toEqual([]);
  });
});

describe("mergeConnectMembers", () => {
  const harvestedZell = projectConnectMember({ fetchedAtIso: FETCHED, profile: PROFILE, userId: "U0SYN000009" })!;
  const harvestedDup = projectConnectMember({ fetchedAtIso: FETCHED, profile: PROFILE, userId: "U0SYN000018" })!;

  it("keeps a recovered row whose id users.list never returned", () => {
    const kept = mergeConnectMembers({ harvested: [harvestedZell], listed: new Set(["U0SYN000018"]) });
    expect(kept.map((row) => row.sourceId)).toEqual(["U0SYN000009"]);
  });

  it("drops a recovered row for an id users.list already answered, so one id never gets two rows", () => {
    const kept = mergeConnectMembers({
      harvested: [harvestedDup, harvestedZell],
      listed: new Set(["U0SYN000018"]),
    });
    expect(kept.map((row) => row.sourceId)).toEqual(["U0SYN000009"]);
  });

  it("keeps everything when users.list has never returned anything", () => {
    const kept = mergeConnectMembers({ harvested: [harvestedZell, harvestedDup], listed: new Set() });
    expect(kept.map((row) => row.sourceId)).toEqual(["U0SYN000009", "U0SYN000018"]);
  });

  it("is empty when there is nothing to recover", () => {
    const kept: readonly MemberBronzeRow[] = mergeConnectMembers({
      harvested: [],
      listed: new Set(["U0SYN000018"]),
    });
    expect(kept).toEqual([]);
  });

  it("keeps a departed colleague's users.list row authoritative after they drop OUT of users.list", () => {
    // The r1 review's counterexample: they moved to a sibling Grid workspace, so this hydration's `users.list`
    // no longer names them, while their old messages still carry a profile. Subtracting only the current batch
    // would write a recovered row with a later `fetchedAtIso`, which `latestMemberRows` prefers — losing their
    // trusted email and their `active` flag.
    const storedFromList = projectSlackMember({
      fetchedAtIso: "2026-09-01T00:00:00.000Z",
      raw: { id: "U0SYN000018", name: "dr.martin.zell", profile: { email: "dr.martin.zell@acme.com" } },
    })!;
    const thisHydration: readonly MemberBronzeRow[] = [];
    const kept = mergeConnectMembers({
      harvested: [harvestedDup],
      listed: new Set([...listedMemberIds({ stored: [storedFromList] }), ...thisHydration.map((row) => row.sourceId)]),
    });
    expect(kept).toEqual([]);
  });
});

describe("foldProfileLine", () => {
  it("captures the profile an addressed line carries", () => {
    const sightings = new Map<string, ProfileSighting>();
    foldProfileLine({
      line: bronzeLine({ author: "U0SYN000009", profile: PROFILE, tsIso: "2026-09-01T00:00:00.000Z" }),
      sightings,
    });
    expect(sightings.size).toBe(1);
    expect(sightings.get("U0SYN000009")!.atIso).toBe("2026-09-01T00:00:00.000Z");
  });

  it("keeps the NEWEST profile per author, whatever order the lines arrive in", () => {
    const sightings = new Map<string, ProfileSighting>();
    const older = { ...PROFILE, display_name: "Old Name" };
    const newer = { ...PROFILE, display_name: "New Name" };
    foldProfileLine({
      line: bronzeLine({ author: "U1", profile: newer, tsIso: "2026-09-10T00:00:00.000Z" }),
      sightings,
    });
    foldProfileLine({
      line: bronzeLine({ author: "U1", profile: older, tsIso: "2026-01-01T00:00:00.000Z" }),
      sightings,
    });
    const row = projectConnectMember({
      fetchedAtIso: FETCHED,
      profile: sightings.get("U1")!.profile,
      userId: "U1",
    })!;
    expect(row.identity.name).toBe("New Name");
  });

  // Seen on a live corpus: `U0SYN000021` posted one message that bronze holds
  // TWICE, because a later refresh re-fetched it after the author shortened their Slack display name. Both copies
  // carry the same `sourceId` and the same `tsIso`, so the message's own instant cannot separate them and
  // only bronze READ POSITION can — the signal `latestRecords` already breaks a timestamp tie by.
  it("prefers the LATER capture of one message when the two copies tie on the message's instant", () => {
    const sightings = new Map<string, ProfileSighting>();
    const asCaptured = { ...PROFILE, display_name: "Wren Ito" };
    const asRecaptured = { ...PROFILE, display_name: "Wren" };
    foldProfileLine({
      line: bronzeLine({ author: "U0SYN000021", profile: asCaptured, tsIso: "2026-07-14T08:38:28.000Z" }),
      sightings,
    });
    foldProfileLine({
      line: bronzeLine({ author: "U0SYN000021", profile: asRecaptured, tsIso: "2026-07-14T08:38:28.000Z" }),
      sightings,
    });
    const row = projectConnectMember({
      fetchedAtIso: FETCHED,
      profile: sightings.get("U0SYN000021")!.profile,
      userId: "U0SYN000021",
    })!;
    expect(row.identity.name).toBe("Wren");
  });

  it("still lets a line with no instant lose to one that has an instant, in either arrival order", () => {
    const undated = new Map<string, ProfileSighting>();
    foldProfileLine({ line: bronzeLine({ author: "U1", profile: PROFILE, tsIso: "" }), sightings: undated });
    foldProfileLine({
      line: bronzeLine({
        author: "U1",
        profile: { ...PROFILE, display_name: "Dated" },
        tsIso: "2026-09-01T00:00:00.000Z",
      }),
      sightings: undated,
    });
    expect(undated.get("U1")!.atIso).toBe("2026-09-01T00:00:00.000Z");

    const dated = new Map<string, ProfileSighting>();
    foldProfileLine({
      line: bronzeLine({
        author: "U1",
        profile: { ...PROFILE, display_name: "Dated" },
        tsIso: "2026-09-01T00:00:00.000Z",
      }),
      sightings: dated,
    });
    foldProfileLine({ line: bronzeLine({ author: "U1", profile: PROFILE, tsIso: "" }), sightings: dated });
    expect(dated.get("U1")!.atIso).toBe("2026-09-01T00:00:00.000Z");
  });

  it("ignores a line with no user_profile", () => {
    const sightings = new Map<string, ProfileSighting>();
    foldProfileLine({ line: bronzeLine({ author: "U1", tsIso: "2026-09-01T00:00:00.000Z" }), sightings });
    expect(sightings.size).toBe(0);
  });

  it("ignores an empty line and an unparseable one", () => {
    const sightings = new Map<string, ProfileSighting>();
    foldProfileLine({ line: "", sightings });
    foldProfileLine({ line: '{"user_profile": broken', sightings });
    expect(sightings.size).toBe(0);
  });

  it("ignores a line whose user_profile is not an object", () => {
    const sightings = new Map<string, ProfileSighting>();
    foldProfileLine({
      line: JSON.stringify({
        author: "U1",
        container: "slack/C1",
        kind: "message",
        raw: { user_profile: "nope" },
        refs: [],
        source: "slack",
        sourceId: "C1:1",
        text: "hi",
        tsIso: "2026-09-01T00:00:00.000Z",
        url: "https://example.invalid/1",
      }),
      sightings,
    });
    expect(sightings.size).toBe(0);
  });
});
