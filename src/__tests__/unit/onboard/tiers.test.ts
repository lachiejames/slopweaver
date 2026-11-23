/**
 * The tier declarations and the manifest built from them.
 *
 * The property that matters most here is that the ingest half of the manifest IS the constant
 * `connect slack --check` verifies against — the committed template files drifted from it, and a rendered
 * manifest that drifts the same way would be the same defect with a nicer delivery mechanism.
 */
import { describe, expect, it } from "vitest";

import { SLACK_REQUIRED_USER_SCOPES, SLACK_REQUIRED_USER_WRITE_SCOPES } from "../../../connect/slack.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  AGENT_DESCRIPTION,
  APP_DESCRIPTION,
  botDisplayName,
  buildSlackAppManifest,
  DEFAULT_APP_NAME,
  DEFAULT_TIER,
  MAX_APP_NAME_LENGTH,
  type OnboardTier,
  parseAppName,
  parseTier,
  READ_ONLY_APP_DESCRIPTION,
  renderSlackAppManifest,
  TIER_ORDER,
  TIERS,
} from "../../../onboard/tiers.js";

/** The user scopes of a rendered tier, in manifest order. */
function userScopes({ tier }: { tier: OnboardTier }): readonly string[] {
  return buildSlackAppManifest({ appName: "Slopweaver", tier }).oauth_config.scopes.user;
}

/** The bot scopes of a rendered tier (absent ⇒ empty, which is itself the assertion for `restricted`). */
function botScopes({ tier }: { tier: OnboardTier }): readonly string[] {
  const { bot = [] } = buildSlackAppManifest({ appName: "Slopweaver", tier }).oauth_config.scopes;
  return bot;
}

describe("parseTier", () => {
  it("takes a bare Enter as the RECOMMENDED tier, so the default is what pressing return gets you", () => {
    expect(unwrap(parseTier({ value: "" }))).toBe(DEFAULT_TIER);
    expect(TIERS[DEFAULT_TIER].recommended).toBe(true);
  });

  it("recommends the MOST capable rung — the owner's decision, not the safe engineering one", () => {
    expect(DEFAULT_TIER).toBe("agent");
    expect(TIER_ORDER.filter((tier) => TIERS[tier].recommended)).toEqual(["agent"]);
  });

  it("reads every tier name, case-insensitively and around whitespace", () => {
    expect(unwrap(parseTier({ value: "  AGENT " }))).toBe("agent");
    expect(unwrap(parseTier({ value: "Standard" }))).toBe("standard");
    expect(unwrap(parseTier({ value: "restricted " }))).toBe("restricted");
  });

  it("refuses anything else, naming every valid answer", () => {
    expect(unwrapErr(parseTier({ value: "readonly" }))[0]).toBe(
      'unrecognised tier: readonly (expected "agent", "standard", "restricted")',
    );
  });
});

describe("parseAppName", () => {
  it("takes an empty answer as the default name", () => {
    expect(unwrap(parseAppName({ value: "  " }))).toBe(DEFAULT_APP_NAME);
  });

  it("trims what the user typed", () => {
    expect(unwrap(parseAppName({ value: "  Team Brain  " }))).toBe("Team Brain");
  });

  it("refuses a name longer than Slack accepts, HERE rather than at paste time", () => {
    expect(unwrapErr(parseAppName({ value: "x".repeat(MAX_APP_NAME_LENGTH + 1) }))[0]).toContain(
      "Slack allows at most 35",
    );
  });

  it("accepts a name of exactly the limit", () => {
    expect(unwrap(parseAppName({ value: "x".repeat(MAX_APP_NAME_LENGTH) }))).toBe("x".repeat(MAX_APP_NAME_LENGTH));
  });

  it("refuses a control character, which would corrupt the JSON being pasted", () => {
    expect(unwrapErr(parseAppName({ value: "Team\u0007Brain" }))[0]).toContain("control character");
  });
});

describe("botDisplayName", () => {
  it("derives the bot name from the app name rather than asking for it", () => {
    expect(botDisplayName({ appName: "Team Brain" })).toBe("Team Brain");
  });

  it("replaces the period Slack refuses in a bot display name", () => {
    expect(botDisplayName({ appName: "team.brain" })).toBe("team-brain");
  });
});

describe("the restricted tier", () => {
  it("has at least one entry in SLACK_REQUIRED_USER_SCOPES, so the guards below are not vacuously green", () => {
    expect(SLACK_REQUIRED_USER_SCOPES.length).toBeGreaterThan(0);
  });

  it("asks for EXACTLY the user scopes the ingest lanes require — no more, and no fewer", () => {
    expect([...userScopes({ tier: "restricted" })].toSorted()).toEqual([...SLACK_REQUIRED_USER_SCOPES].toSorted());
  });

  it("asks for no bot token, no bot events and no socket mode", () => {
    const manifest = buildSlackAppManifest({ appName: "Slopweaver", tier: "restricted" });

    expect(botScopes({ tier: "restricted" })).toEqual([]);
    expect(manifest.features).toBe(undefined);
    expect(manifest.settings.event_subscriptions).toBe(undefined);
    expect(manifest.settings.socket_mode_enabled).toBe(false);
  });

  it("asks for no write scope at all", () => {
    expect(userScopes({ tier: "restricted" }).filter((scope) => scope.includes(":write"))).toEqual([]);
  });

  it("names the verbs it cannot run, so the trade is not discovered on a refusal", () => {
    expect(TIERS["restricted"].withholds).toContain("listen");
    expect(TIERS["restricted"].withholds).toContain("slack post");
  });
});

describe("the standard tier", () => {
  it("is a superset of the ingest scopes, so ingest works identically on it", () => {
    const user = new Set(userScopes({ tier: "standard" }));

    expect(SLACK_REQUIRED_USER_SCOPES.filter((scope) => !user.has(scope))).toEqual([]);
  });

  it("adds EXACTLY the as-me write scope to the user token and nothing else", () => {
    const restricted = new Set(userScopes({ tier: "restricted" }));

    expect(userScopes({ tier: "standard" }).filter((scope) => !restricted.has(scope))).toEqual([
      ...SLACK_REQUIRED_USER_WRITE_SCOPES,
    ]);
  });

  it("grants the bot the tag event and the ability to answer it", () => {
    expect(botScopes({ tier: "standard" })).toContain("app_mentions:read");
    expect(botScopes({ tier: "standard" })).toContain("chat:write");
  });

  it("subscribes to BOTH ways of addressing the bot — a DM raises no app_mention at all", () => {
    expect(buildSlackAppManifest({ appName: "Slopweaver", tier: "standard" }).settings.event_subscriptions).toEqual({
      bot_events: ["app_mention", "message.im"],
    });
    expect(botScopes({ tier: "standard" })).toContain("im:history");
  });

  it("opens the messages tab, without which there is no DM composer for the event to come from", () => {
    const manifest = buildSlackAppManifest({ appName: "Slopweaver", tier: "standard" });

    expect(manifest.features?.app_home).toEqual({
      home_tab_enabled: false,
      messages_tab_enabled: true,
      messages_tab_read_only_enabled: false,
    });
  });

  it("turns socket mode on and derives the bot's display name from the app name", () => {
    const manifest = buildSlackAppManifest({ appName: "team.brain", tier: "standard" });

    expect(manifest.settings.socket_mode_enabled).toBe(true);
    expect(manifest.features?.bot_user).toEqual({ always_online: false, display_name: "team-brain" });
  });

  it("declares NO agent view, so this whole rung can be undone by editing the app", () => {
    expect(buildSlackAppManifest({ appName: "Slopweaver", tier: "standard" }).features?.agent_view).toBe(undefined);
    expect(botScopes({ tier: "standard" })).not.toContain("assistant:write");
    expect(TIERS["standard"].irreversible).toEqual([]);
  });
});

/**
 * The rung the owner made the default. Its diff against `standard` is ratcheted rather than trusted: this is
 * the one manifest in the repo whose adoption cannot be reverted, so a scope quietly joining it is the change
 * worth catching before a user pastes it.
 */
describe("the agent tier", () => {
  it("adds assistant:write to the bot lane and NOTHING else", () => {
    const standard = new Set(botScopes({ tier: "standard" }));

    expect(botScopes({ tier: "agent" }).filter((scope) => !standard.has(scope))).toEqual(["assistant:write"]);
  });

  it("takes nothing away from the standard rung, on either lane", () => {
    const agentBot = new Set(botScopes({ tier: "agent" }));
    const agentUser = new Set(userScopes({ tier: "agent" }));

    expect(botScopes({ tier: "standard" }).filter((scope) => !agentBot.has(scope))).toEqual([]);
    expect(userScopes({ tier: "standard" }).filter((scope) => !agentUser.has(scope))).toEqual([]);
  });

  it("leaves the USER lane identical — the Agents surface is a bot-token feature", () => {
    expect([...userScopes({ tier: "agent" })].toSorted()).toEqual([...userScopes({ tier: "standard" })].toSorted());
  });

  it("subscribes to no extra event — the feature adds a placement, not a trigger", () => {
    expect(TIERS["agent"].botEvents).toEqual([...TIERS["standard"].botEvents]);
  });

  it("declares features.agent_view, which IS the irreversible act", () => {
    expect(buildSlackAppManifest({ appName: "Slopweaver", tier: "agent" }).features?.agent_view).toEqual({
      agent_description: AGENT_DESCRIPTION,
    });
  });

  it("is the recommended tier AND is labelled the least secure — the pairing is the whole design", () => {
    expect(TIERS["agent"].recommended).toBe(true);
    expect(TIERS["agent"].securityLabel).toContain("LEAST SECURE");
  });

  it("names what cannot be undone, in the declaration rather than only in the prose", () => {
    expect(TIERS["agent"].irreversible.length).toBe(3);
    expect(TIERS["agent"].irreversible[0]).toContain("CANNOT BE UNDONE");
    expect(TIERS["agent"].irreversible[1]).toContain("GUESTS lose access");
  });

  it("is the ONLY rung that carries an irreversible cost", () => {
    expect(TIER_ORDER.filter((tier) => TIERS[tier].irreversible.length > 0)).toEqual(["agent"]);
    expect(TIER_ORDER.filter((tier) => TIERS[tier].agentView)).toEqual(["agent"]);
  });
});

describe("every scope carries a justification", () => {
  it("names a capability and a call for each scope of each tier", () => {
    const unjustified = TIER_ORDER.flatMap((tier) =>
      TIERS[tier].grants
        .filter((grant) => grant.capability.length === 0 || grant.why.length === 0)
        .map((grant) => `${tier} ${grant.scope}`),
    );

    expect(unjustified).toEqual([]);
  });

  it("declares each scope of a tier exactly once per lane", () => {
    const duplicated = TIER_ORDER.filter((tier) => {
      const keys = TIERS[tier].grants.map((grant) => `${grant.lane} ${grant.scope}`);
      return keys.length !== new Set(keys).size;
    });

    expect(duplicated).toEqual([]);
  });
});

describe("the rendered manifest is safe to paste", () => {
  it("carries no field that could hold an app id, team id or workspace name, in ANY tier", () => {
    for (const tier of TIER_ORDER) {
      const text = renderSlackAppManifest({ appName: "Slopweaver", tier });

      expect(text).not.toContain("app_id");
      expect(text).not.toContain("team_id");
      expect(text).not.toContain("workspace");
    }
  });

  it("varies in exactly one place — the name the user typed", () => {
    const mine = renderSlackAppManifest({ appName: "Team Brain", tier: "agent" });
    const theirs = renderSlackAppManifest({ appName: "Slopweaver", tier: "agent" });

    expect(mine.replaceAll("Team Brain", "Slopweaver")).toBe(theirs);
  });

  it("is two-space JSON that round-trips, so a copy is pasteable verbatim", () => {
    const text = renderSlackAppManifest({ appName: "Slopweaver", tier: "restricted" });

    expect(JSON.parse(text)).toEqual(buildSlackAppManifest({ appName: "Slopweaver", tier: "restricted" }));
    expect(text).toContain('\n  "oauth_config": {');
  });

  it("describes the app without naming any organisation", () => {
    expect(buildSlackAppManifest({ appName: "Slopweaver", tier: "agent" }).display_information.description).toBe(
      APP_DESCRIPTION,
    );
  });

  it("describes the restricted tier's app as one that only reads, since it has no bot to tag", () => {
    expect(buildSlackAppManifest({ appName: "Slopweaver", tier: "restricted" }).display_information.description).toBe(
      READ_ONLY_APP_DESCRIPTION,
    );
  });
});
