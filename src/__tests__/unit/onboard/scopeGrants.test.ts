/*
 * The four grant lists the onboarding tiers are assembled from, read directly: which scopes each list holds, on
 * which lane, and in which order. The composed manifests have their own cases beside this file.
 */
import { describe, expect, it } from "vitest";

import {
  AGENT_BOT_GRANTS,
  INGEST_GRANTS,
  type ScopeGrant,
  SPEAKING_BOT_GRANTS,
  SPEAKING_USER_GRANTS,
} from "../../../onboard/scopeGrants.js";

/** One list as ordered `lane:scope` strings, so a moved scope, a changed lane or a reorder all fail. */
function laneScopes({ grants }: { grants: readonly ScopeGrant[] }): readonly string[] {
  return grants.map((grant) => `${grant.lane}:${grant.scope}`);
}

describe("the scope grant lists", () => {
  it("holds the ingest scopes on the user lane, in the preflight's order", () => {
    expect(laneScopes({ grants: INGEST_GRANTS })).toEqual([
      "user:users:read",
      "user:users:read.email",
      "user:channels:read",
      "user:channels:history",
      "user:groups:read",
      "user:groups:history",
      "user:files:read",
      "user:pins:read",
      "user:bookmarks:read",
      "user:team:read",
      "user:usergroups:read",
    ]);
  });

  it("adds exactly two user scopes for the speaking tiers, the sharpest first", () => {
    expect(laneScopes({ grants: SPEAKING_USER_GRANTS })).toEqual(["user:chat:write", "user:files:write"]);
  });

  it("holds the speaking tiers' bot scopes on the bot lane", () => {
    expect(laneScopes({ grants: SPEAKING_BOT_GRANTS })).toEqual([
      "bot:app_mentions:read",
      "bot:im:history",
      "bot:chat:write",
      "bot:chat:write.public",
      "bot:files:write",
      "bot:reactions:write",
      "bot:reactions:read",
      "bot:channels:history",
      "bot:groups:history",
      "bot:channels:read",
      "bot:groups:read",
      "bot:users:read",
      "bot:users:read.email",
    ]);
  });

  it("adds one bot scope for the agent tier and no other", () => {
    expect(laneScopes({ grants: AGENT_BOT_GRANTS })).toEqual(["bot:assistant:write"]);
  });
});
