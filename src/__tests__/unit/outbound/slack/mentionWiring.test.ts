/*
 * `mentionsFromIdentity`: a mention resolves against the DERIVED roster `derive` writes, the HUMAN roster overrides
 * it, a missing or garbled roster resolves nothing, a store outage refuses a send naming someone, and the roster's
 * freshness reads absent, stale or fresh off its stamp.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { MentionResolution } from "../../../../outbound/slack/mentionIndex.js";
import { mentionsFromIdentity } from "../../../../outbound/slack/mentionWiring.js";
import { observeSources, writeFreshnessStamp } from "../../../../silver/derive/stamp.js";
import type { IdentityRecord } from "../../../../silver/identity.js";
import { unavailableIdentityRosterPort } from "../../../identityRosterFixture.js";
import {
  derivedPerson,
  freshHome,
  ROSTER_REVISION,
  rosterPort,
  useFreshHomes,
  writeDerived,
} from "../../cli/commands/slack/wiring/harness.js";

useFreshHomes();

/** When every send in this file was asked for — fixed, so no verdict here depends on the wall clock. */
const ASKED_AT_ISO = "2026-08-23T08:00:00.000Z";

/** `mentionsFromIdentity`, unwrapped: the resolution over a roster holding the given human records. */
async function resolveMentions({
  home,
  people,
  records,
}: {
  home: string;
  people: readonly string[];
  records?: readonly IdentityRecord[];
}): Promise<MentionResolution> {
  return unwrap(
    await mentionsFromIdentity({
      askedAtIso: ASKED_AT_ISO,
      groups: [],
      home,
      identityRoster: rosterPort(records === undefined ? {} : { records }),
      people,
    }),
  );
}

describe("mentionsFromIdentity — the DERIVED roster is the population", () => {
  it("resolves against corpus/silver/index/identities.json, which is what derive actually writes", async () => {
    // The shipped defect: only the human roster was read, and a correct onboarding leaves that empty
    // while writing hundreds of people HERE. Every mention was unresolvable.
    const home = freshHome({ prefix: "pr5-wiring-derived-" });
    writeDerived({
      home,
      value: {
        candidates: [],
        conflicts: [],
        people: [derivedPerson({ handle: "ada-l", id: "p-ada", slackId: "U_fake_ada" })],
      },
    });

    const resolution = await resolveMentions({ home, people: ["p-ada", "ada-l", "@ada-l", "U_fake_ada"] });

    expect(resolution.resolved.get("p-ada")).toEqual({ origin: "derived", slackId: "U_fake_ada" });
    expect(resolution.resolved.get("ada-l")).toEqual({ origin: "derived", slackId: "U_fake_ada" });
    expect(resolution.resolved.get("@ada-l")).toEqual({ origin: "derived", slackId: "U_fake_ada" });
    expect(resolution.resolved.get("U_fake_ada")).toEqual({ origin: "derived", slackId: "U_fake_ada" });
  });

  it("lets the HUMAN roster override a derived resolution", async () => {
    const home = freshHome({ prefix: "pr5-wiring-override-" });
    writeDerived({
      home,
      value: {
        candidates: [],
        conflicts: [],
        people: [derivedPerson({ handle: "ada-l", id: "p-ada", slackId: "U_fake_wrong" })],
      },
    });
    const records: readonly IdentityRecord[] = [
      {
        handle: "ada-l",
        id: "p-ada",
        identities: [{ nativeId: "U_fake_right", source: "slack" }],
        name: "ada",
      },
    ];

    const resolution = await resolveMentions({ home, people: ["p-ada"], records });

    expect(resolution.resolved.get("p-ada")).toEqual({ origin: "override", slackId: "U_fake_right" });
  });

  it("resolves nothing when neither roster exists, instead of throwing", async () => {
    const home = freshHome({ prefix: "pr5-wiring-empty-" });

    const resolution = await resolveMentions({ home, people: ["anyone"] });

    expect(resolution.resolved.size).toBe(0);
    expect(resolution.roster.derivedPeople).toBe(0);
  });

  it("resolves nothing when the derived roster is garbled, instead of throwing", async () => {
    const home = freshHome({ prefix: "pr5-wiring-bad-" });
    writeDerived({ home, value: "not-an-object" });

    expect((await resolveMentions({ home, people: ["anyone"] })).resolved.size).toBe(0);
  });

  it("refuses with the roster's own typed error when the store cannot be opened, resolving nothing", async () => {
    const home = freshHome({ prefix: "pr5-wiring-outage-" });
    writeDerived({
      home,
      value: {
        candidates: [],
        conflicts: [],
        people: [derivedPerson({ handle: "ada-l", id: "p-ada", slackId: "U_fake_ada" })],
      },
    });

    const refused = await mentionsFromIdentity({
      askedAtIso: ASKED_AT_ISO,
      groups: [],
      home,
      identityRoster: unavailableIdentityRosterPort(),
      people: ["ada-l"],
    });

    expect(unwrapErr(refused).code).toBe("IDENTITY_ROSTER_STORE_UNAVAILABLE");
    expect(unwrapErr(refused).message).toContain("this install keeps its identity roster in the store");
  });

  it("lets a send naming no person through a store outage, since no roster could change who it addresses", async () => {
    const home = freshHome({ prefix: "pr5-wiring-nobody-" });
    const resolution = await mentionsFromIdentity({
      askedAtIso: ASKED_AT_ISO,
      groups: [],
      home,
      identityRoster: unavailableIdentityRosterPort(),
      people: [],
    });
    expect(unwrap(resolution).resolved.size).toBe(0);
  });

  it("reports the roster as ABSENT when derive has never run", async () => {
    const home = freshHome({ prefix: "pr5-wiring-absent-" });

    expect((await resolveMentions({ home, people: [] })).roster.freshness.kind).toBe("absent");
  });

  it("reports the roster as STALE when the stamp witnessed another revision of the human roster", async () => {
    const home = freshHome({ prefix: "pr5-wiring-revision-" });
    writeDerived({
      home,
      value: { candidates: [], conflicts: [], observedAtIso: "2026-08-23T08:59:00.000Z", people: [] },
    });
    writeFreshnessStamp({
      artefacts: null,
      derivedAtIso: "2026-08-23T09:00:00.000Z",
      home,
      observation: observeSources({ home, rosterRevision: ROSTER_REVISION + 1 }),
      observedAtIso: "2026-08-23T08:59:00.000Z",
    });

    expect((await resolveMentions({ home, people: [] })).roster.freshness.kind).toBe("stale");
  });

  it("reports the roster as FRESH when a stamp records the state the reader observes", async () => {
    const home = freshHome({ prefix: "pr5-wiring-fresh-" });
    writeDerived({
      home,
      value: { candidates: [], conflicts: [], observedAtIso: "2026-08-23T08:59:00.000Z", people: [] },
    });
    writeFreshnessStamp({
      artefacts: null,
      derivedAtIso: "2026-08-23T09:00:00.000Z",
      home,
      observation: observeSources({ home, rosterRevision: ROSTER_REVISION }),
      observedAtIso: "2026-08-23T08:59:00.000Z",
    });

    expect((await resolveMentions({ home, people: [] })).roster.freshness.kind).toBe("fresh");
  });

  it("reports an UNSTAMPED roster as unusable rather than fresh", async () => {
    const home = freshHome({ prefix: "pr5-wiring-unstamped-" });
    writeDerived({ home, value: { candidates: [], conflicts: [], people: [] } });

    expect((await resolveMentions({ home, people: [] })).roster.freshness.kind).toBe("absent");
  });

  it("resolves the bot's own declared id (the as-me door), even though it authors no corpus record", async () => {
    const home = freshHome({ prefix: "pr5-wiring-self-" });
    writeDerived({ home, value: { candidates: [], conflicts: [], people: [] } });
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackBot: { selfUserIds: ["U_fake_bot"] },
        sources: [],
      }),
      "utf8",
    );

    const resolution = await resolveMentions({ home, people: ["U_fake_bot", "U_unknown"] });

    expect(resolution.resolved.get("U_fake_bot")).toEqual({ origin: "self", slackId: "U_fake_bot" });
    expect(resolution.resolved.has("U_unknown")).toBe(false);
  });
});
