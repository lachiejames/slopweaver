import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SLACK_REQUIRED_USER_SCOPES,
  SLACK_REQUIRED_WRITE_SCOPES,
  SLACK_STATUS_USER_SCOPES,
} from "../../../connect/slack.js";
import { isRecord } from "../../../lib/parsers.js";

/** Load a bundled Slack app manifest by filename. */
function loadManifest({ file }: { file: string }): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../templates/${file}`, import.meta.url)), "utf8"));
}

/** The `oauth_config.scopes` record of a manifest (empty when the shape is unexpected — the test fails loud). */
function scopesOf({ file }: { file: string }): Record<string, unknown> {
  const manifest = loadManifest({ file });
  if (isRecord(manifest) && isRecord(manifest["oauth_config"]) && isRecord(manifest["oauth_config"]["scopes"])) {
    return manifest["oauth_config"]["scopes"];
  }
  return {};
}

/** A manifest's `user` scope list (empty when absent/malformed). */
function userScopes({ file }: { file: string }): readonly string[] {
  const user = scopesOf({ file })["user"];
  return Array.isArray(user) ? user.filter((s): s is string => typeof s === "string") : [];
}

/** A manifest's `bot` scope list (empty when absent/malformed). */
function botScopes({ file }: { file: string }): readonly string[] {
  const bot = scopesOf({ file })["bot"];
  return Array.isArray(bot) ? bot.filter((s): s is string => typeof s === "string") : [];
}

/** A manifest's `settings.event_subscriptions.bot_events` list (empty when absent/malformed). */
function botEvents({ file }: { file: string }): readonly string[] {
  const manifest = loadManifest({ file });
  if (
    !isRecord(manifest) ||
    !isRecord(manifest["settings"]) ||
    !isRecord(manifest["settings"]["event_subscriptions"])
  ) {
    return [];
  }
  const events = manifest["settings"]["event_subscriptions"]["bot_events"];
  return Array.isArray(events) ? events.filter((e): e is string => typeof e === "string") : [];
}

/** A manifest's `features.agent_view.agent_description` (the empty string when the feature is absent). */
function agentDescription({ file }: { file: string }): string {
  const manifest = loadManifest({ file });
  if (!isRecord(manifest) || !isRecord(manifest["features"]) || !isRecord(manifest["features"]["agent_view"])) {
    return "";
  }
  const description = manifest["features"]["agent_view"]["agent_description"];
  return typeof description === "string" ? description : "";
}

/** A manifest's `display_information.name` (the empty string when absent/malformed). */
function appName({ file }: { file: string }): string {
  const manifest = loadManifest({ file });
  if (!isRecord(manifest) || !isRecord(manifest["display_information"])) {
    return "";
  }
  const name = manifest["display_information"]["name"];
  return typeof name === "string" ? name : "";
}

const READONLY = "slack-app-manifest.readonly.json";
const FULL = "slack-app-manifest.full.json";
const AGENT = "slack-app-manifest.agent.json";

/**
 * The scopes the live app holds that a hand-maintained template had drifted away from.
 *
 * Pinned by name rather than counted, because dropping one is not a cosmetic diff: Slack revokes a scope a
 * reinstalled manifest omits, so a template missing these silently turns real-time search off. Four were
 * missing at once when the committed templates were diffed against the live app.
 */
const LIVE_BOT_SCOPES_THAT_DRIFTED: readonly string[] = [
  "metadata.message:read",
  "search:read.files",
  "search:read.public",
  "search:read.users",
];

/** The user-token real-time-search family the live app holds — the same drift, on the other token. */
const LIVE_USER_SEARCH_SCOPES: readonly string[] = [
  "search:read",
  "search:read.files",
  "search:read.im",
  "search:read.mpim",
  "search:read.private",
  "search:read.public",
  "search:read.users",
];

/** The field an onboarding flow populates where the app's name goes. */
const APP_NAME_FIELD = "{{APP_NAME}}";

/** The field an onboarding flow populates where the bot's display name goes. */
const BOT_NAME_FIELD = "{{BOT_DISPLAY_NAME}}";

/** A manifest's `display_information.long_description` (the empty string when absent/malformed). */
function longDescription({ file }: { file: string }): string {
  const manifest = loadManifest({ file });
  if (!isRecord(manifest) || !isRecord(manifest["display_information"])) {
    return "";
  }
  const text = manifest["display_information"]["long_description"];
  return typeof text === "string" ? text : "";
}

/** A manifest's `features.bot_user.display_name` (the empty string when there is no bot user). */
function botDisplayName({ file }: { file: string }): string {
  const manifest = loadManifest({ file });
  if (!isRecord(manifest) || !isRecord(manifest["features"]) || !isRecord(manifest["features"]["bot_user"])) {
    return "";
  }
  const name = manifest["features"]["bot_user"]["display_name"];
  return typeof name === "string" ? name : "";
}

/** A manifest's `settings` record (empty when absent/malformed). */
function settingsOf({ file }: { file: string }): Record<string, unknown> {
  const manifest = loadManifest({ file });
  return isRecord(manifest) && isRecord(manifest["settings"]) ? manifest["settings"] : {};
}

/** A manifest's `settings.<key>` boolean (undefined when absent or not a boolean). */
function settingsBoolean({ file, key }: { file: string; key: string }): boolean | undefined {
  const value = settingsOf({ file })[key];
  return typeof value === "boolean" ? value : undefined;
}

/** A manifest's `features.agent_view.suggested_prompts` list (empty when absent/malformed). */
function suggestedPrompts({ file }: { file: string }): readonly unknown[] {
  const manifest = loadManifest({ file });
  if (!isRecord(manifest) || !isRecord(manifest["features"]) || !isRecord(manifest["features"]["agent_view"])) {
    return [];
  }
  const prompts = manifest["features"]["agent_view"]["suggested_prompts"];
  return Array.isArray(prompts) ? prompts : [];
}

describe("read-only Slack manifest", () => {
  it("has at least one entry in SLACK_REQUIRED_USER_SCOPES, so the guards below are not vacuously green", () => {
    expect(SLACK_REQUIRED_USER_SCOPES.length).toBeGreaterThan(0);
  });

  it("declares EXACTLY the user scopes the ingest lanes require", () => {
    expect([...userScopes({ file: READONLY })].toSorted()).toEqual([...SLACK_REQUIRED_USER_SCOPES].toSorted());
  });

  it("requests no write scopes and no bot scopes (lowest-risk footprint)", () => {
    expect(userScopes({ file: READONLY }).filter((s) => s.includes(":write"))).toEqual([]);
    expect(Object.keys(scopesOf({ file: READONLY }))).toEqual(["user"]);
  });
});

describe("full Slack manifest", () => {
  it("has at least one entry in SLACK_REQUIRED_WRITE_SCOPES, so the guards below are not vacuously green", () => {
    expect(SLACK_REQUIRED_WRITE_SCOPES.length).toBeGreaterThan(0);
  });

  it("is a SUPERSET of the read-only ingest scopes (so ingest works unchanged)", () => {
    const user = new Set(userScopes({ file: FULL }));
    for (const scope of SLACK_REQUIRED_USER_SCOPES) {
      expect(user.has(scope)).toBe(true);
    }
  });

  it("adds write scopes + a bot section for parity with the operating assistant", () => {
    expect(userScopes({ file: FULL }).filter((s) => s.includes(":write")).length).toBeGreaterThan(0);
    expect(botScopes({ file: FULL })).toContain("chat:write");
  });

  it("carries users:read.email on both the user and bot tokens (cross-source member linking)", () => {
    expect(userScopes({ file: FULL })).toContain("users:read.email");
    expect(botScopes({ file: FULL })).toContain("users:read.email");
  });

  it("provisions every outbound WRITE scope on BOTH tokens — as-me and as-bot must both be able to send", () => {
    const user = new Set(userScopes({ file: FULL }));
    const bot = new Set(botScopes({ file: FULL }));
    for (const scope of SLACK_REQUIRED_WRITE_SCOPES) {
      expect(user.has(scope)).toBe(true);
      expect(bot.has(scope)).toBe(true);
    }
  });
});

describe("read-only vs write scopes", () => {
  it("keeps the write scopes OUT of the read-only manifest (the low-risk footprint stays read-only)", () => {
    const readonlyUser = new Set(userScopes({ file: READONLY }));
    expect(SLACK_REQUIRED_WRITE_SCOPES.filter((scope) => readonlyUser.has(scope))).toEqual([]);
  });
});

describe("the status scopes", () => {
  it("names both of `slack status`'s write scopes", () => {
    expect([...SLACK_STATUS_USER_SCOPES]).toEqual(["users.profile:write", "users:write"]);
  });

  it("puts them on the USER token of the full and agent manifests, and never on the read-only one", () => {
    expect(SLACK_STATUS_USER_SCOPES.filter((scope) => !userScopes({ file: FULL }).includes(scope))).toEqual([]);
    expect(SLACK_STATUS_USER_SCOPES.filter((scope) => !userScopes({ file: AGENT }).includes(scope))).toEqual([]);
    expect(SLACK_STATUS_USER_SCOPES.filter((scope) => userScopes({ file: READONLY }).includes(scope))).toEqual([]);
  });
});

/**
 * The AGENT variant is the one manifest whose adoption cannot be undone — Slack: "Once you change your app's
 * manifest from `assistant_view` to `agent_view`, you can't revert". So its diff against the full manifest is
 * ratcheted here rather than trusted: it must differ in EXACTLY the three ways
 * `docs/slack-agent-surface/manifests-and-layout.md` says it does, and the reversible manifest must stay free
 * of all three. A scope quietly added to the irreversible variant is the change this catches.
 */
describe("agent Slack manifest", () => {
  it("adds assistant:write and NOTHING else to the bot scopes", () => {
    const full = new Set(botScopes({ file: FULL }));
    expect(botScopes({ file: AGENT }).filter((scope) => !full.has(scope))).toEqual(["assistant:write"]);
  });

  it("takes nothing away from the full manifest's bot scopes", () => {
    const agent = new Set(botScopes({ file: AGENT }));
    expect(botScopes({ file: FULL }).filter((scope) => !agent.has(scope))).toEqual([]);
  });

  it("leaves the USER scopes identical — the surface is a bot-token feature", () => {
    expect([...userScopes({ file: AGENT })].toSorted()).toEqual([...userScopes({ file: FULL })].toSorted());
  });

  it("declares features.agent_view with a non-empty agent_description", () => {
    expect(agentDescription({ file: AGENT }).length).toBeGreaterThan(0);
  });

  it("subscribes to exactly the events the full manifest does — the feature adds no event", () => {
    expect([...botEvents({ file: AGENT })].toSorted()).toEqual([...botEvents({ file: FULL })].toSorted());
  });

  it("keeps the IRREVERSIBLE toggle out of the default full manifest, so the default install stays revertible", () => {
    expect(agentDescription({ file: FULL })).toBe("");
    expect(botScopes({ file: FULL })).not.toContain("assistant:write");
  });

  it("keeps it out of the read-only manifest too", () => {
    expect(botScopes({ file: READONLY })).toEqual([]);
    expect(agentDescription({ file: READONLY })).toBe("");
  });
});

/**
 * The drift that made these files dangerous, ratcheted so it cannot come back.
 *
 * Measured against the live app: the committed templates were missing four bot scopes and the
 * whole user-token `search:read.*` family. Slack REVOKES a scope an applied manifest omits, so a template
 * that looks like a convenience was a loaded gun — pasting it would have turned real-time search off. The
 * scopes are named rather than counted because it is a specific one going missing that does the damage.
 */
describe("every operating manifest carries the live scope set", () => {
  it("keeps the bot scopes that had drifted out of the committed copies", () => {
    for (const file of [FULL, AGENT]) {
      const bot = new Set(botScopes({ file }));
      expect(LIVE_BOT_SCOPES_THAT_DRIFTED.filter((scope) => !bot.has(scope))).toEqual([]);
    }
  });

  it("keeps the whole user-token real-time-search family", () => {
    for (const file of [FULL, AGENT]) {
      const user = new Set(userScopes({ file }));
      expect(LIVE_USER_SEARCH_SCOPES.filter((scope) => !user.has(scope))).toEqual([]);
    }
  });
});

/**
 * The full non-scope drift found alongside the scope reconciliation: the live
 * app's `bot_events`, `agent_view.suggested_prompts` and `settings` booleans had each moved independently of
 * scopes — precisely why pinning scopes alone let them drift unnoticed. `app_home_opened` is deliberately
 * ABSENT: the owner removed it from the live app's own Event Subscriptions, so its absence here is the
 * templates correctly mirroring reality, not a regression — the 7-event set below is pinned so it cannot
 * silently drift back in.
 */
const LIVE_BOT_EVENTS: readonly string[] = [
  "app_mention",
  "member_joined_channel",
  "message.channels",
  "message.groups",
  "message.im",
  "message.mpim",
  "reaction_added",
];

describe("live non-scope fields", () => {
  it("subscribes to exactly the live bot_events set, in both operating tiers", () => {
    for (const file of [FULL, AGENT]) {
      expect([...botEvents({ file })].toSorted()).toEqual([...LIVE_BOT_EVENTS].toSorted());
    }
  });

  /**
   * The owner changed the live app again, same day as the reconciliation above: `suggested_prompts` went
   * from the four pinned when this suite was first written to an explicit `[]` — the live manifest still
   * declares the key, just empty, so the template matches that shape rather than omitting the key. Asserted
   * on both tiers rather than deleted, so the next divergence (in either direction) still fails.
   */
  it("carries no suggested prompts on either tier — the live app's agent tier declares an empty array", () => {
    expect(suggestedPrompts({ file: AGENT })).toEqual([]);
    expect(suggestedPrompts({ file: FULL })).toEqual([]);
  });

  it("declares the live settings booleans on both operating tiers", () => {
    for (const file of [FULL, AGENT]) {
      expect(settingsBoolean({ file, key: "socket_mode_enabled" })).toBe(true);
      expect(settingsBoolean({ file, key: "token_rotation_enabled" })).toBe(false);
      expect(settingsBoolean({ file, key: "org_deploy_enabled" })).toBe(false);
      expect(settingsBoolean({ file, key: "is_mcp_enabled" })).toBe(false);
    }
  });
});

/**
 * No template names a real app; every name is a FIELD an onboarding flow populates.
 *
 * `display_information.name` and `bot_user.display_name` are applied verbatim, so a template carrying a real
 * name renames the app — in every channel it has ever posted in — the moment someone pastes it. The committed
 * copies carried the plugin's name, which is not the bot's. These are the tokens the onboarding flow
 * substitutes before it hands a manifest over, so they are asserted rather than left to convention.
 */
describe("manifest name fields", () => {
  it("carries the app-name FIELD rather than a real name, in every tier", () => {
    for (const file of [READONLY, FULL, AGENT]) {
      expect(appName({ file })).toBe(APP_NAME_FIELD);
    }
  });

  it("carries the bot-name FIELD wherever there is a bot user", () => {
    for (const file of [FULL, AGENT]) {
      expect(botDisplayName({ file })).toBe(BOT_NAME_FIELD);
    }
  });

  it("declares no bot user in the MINIMAL tier, so it has no bot name to populate", () => {
    expect(botDisplayName({ file: READONLY })).toBe("");
  });

  it("names every field it expects populated, in the file itself", () => {
    expect(longDescription({ file: READONLY })).toContain(APP_NAME_FIELD);
    for (const file of [FULL, AGENT]) {
      expect(longDescription({ file })).toContain(APP_NAME_FIELD);
      expect(longDescription({ file })).toContain(BOT_NAME_FIELD);
    }
  });
});

/**
 * Every tier states its own trade-off, in the file.
 *
 * The tiers exist so the capability-versus-risk choice is the USER's. That only works if the choice is legible
 * where it is made — a reader pasting one of these must see what it enables and what it costs without going to
 * find a doc. So the statement lives in `long_description`, which Slack shows on the app itself, and the
 * default is required to admit that it is the least secure of the three rather than merely the most capable.
 */
describe("tier statements", () => {
  it("labels each file with its tier", () => {
    expect(longDescription({ file: READONLY })).toContain("TIER — MINIMAL");
    expect(longDescription({ file: FULL })).toContain("TIER — STANDARD (the default");
    expect(longDescription({ file: AGENT })).toContain("TIER — STANDARD + AGENTS");
  });

  it("states ENABLES and RISK on every tier, never one without the other", () => {
    for (const file of [READONLY, FULL, AGENT]) {
      expect(longDescription({ file })).toContain("ENABLES:");
      expect(longDescription({ file })).toContain("RISK:");
    }
  });

  it("makes the DEFAULT admit it is the least secure, and offer the safer tier in the same breath", () => {
    expect(longDescription({ file: FULL })).toContain("LEAST SECURE");
    expect(longDescription({ file: FULL })).toContain("Take MINIMAL instead");
  });

  it("warns that the AGENTS tier cannot be undone", () => {
    expect(longDescription({ file: AGENT })).toContain("IRREVERSIBLE");
  });

  it("warns every tier that a manifest is applied whole", () => {
    for (const file of [READONLY, FULL, AGENT]) {
      expect(longDescription({ file })).toContain("FIRST INSTALL ONLY");
    }
  });
});
