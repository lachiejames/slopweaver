/**
 * The Slack documentation snapshot, read directly: exactly which 11 method pages were read and in what order,
 * the complete row for five methods covering every audience, every pagination style, missing limits and a
 * note, and the whole tier-floor table including the special tier that publishes no floor.
 */
import { describe, expect, it } from "vitest";

import { SLACK_API_METHODS, TIER_FLOOR_PER_MINUTE } from "../../../../atlas/slackApi/methods.js";

/**
 * The documented row for one method, refusing a method the snapshot does not carry.
 *
 * @returns the method's documentation facts
 */
function rowFor({ name }: { name: string }): (typeof SLACK_API_METHODS)[number] {
  const row = SLACK_API_METHODS.find((method) => method.name === name);
  if (row === undefined) {
    throw new Error(`no documented row for ${name}`);
  }
  return row;
}

describe("SLACK_API_METHODS", () => {
  it("holds exactly 11 methods, sorted by name", () => {
    const names = SLACK_API_METHODS.map((method) => method.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names.length).toBe(11);
    expect(names).toEqual([
      "chat.postMessage",
      "conversations.history",
      "conversations.info",
      "conversations.list",
      "conversations.members",
      "conversations.replies",
      "reactions.get",
      "search.all",
      "search.messages",
      "users.conversations",
      "users.list",
    ]);
    expect(names).toEqual(names.toSorted());
  });

  it("records chat.postMessage as the special tier with no pagination and no limits", () => {
    expect(rowFor({ name: "chat.postMessage" })).toEqual({
      audience: "bot-and-user",
      botScopes: ["chat:write"],
      limitDefault: undefined,
      limitMax: undefined,
      name: "chat.postMessage",
      note: "special tier: roughly one message per second per channel, with a workspace-wide ceiling in the hundreds per minute.",
      observedOn: "2026-08-23",
      pagination: "none",
      tier: "special",
      userScopes: ["chat:write"],
    });
  });

  it("records conversations.history as tier 3 cursor paging capped at 999", () => {
    expect(rowFor({ name: "conversations.history" })).toEqual({
      audience: "bot-and-user",
      botScopes: ["channels:history", "groups:history", "im:history", "mpim:history"],
      limitDefault: 100,
      limitMax: 999,
      name: "conversations.history",
      note: "a non-Marketplace commercially distributed app is throttled to 1 request per minute with limit capped at 15; an internal workspace app is not.",
      observedOn: "2026-08-23",
      pagination: "cursor",
      tier: "3",
      userScopes: ["channels:history", "groups:history", "im:history", "mpim:history"],
    });
  });

  // `limitMax` holds the page's stated 1000 while the note names 999 as the usable request value; the only
  // reader (`cli/commands/atlas/slackApiCore.ts`) renders the number and never sends it, so both are pinned.
  it("records conversations.list's stated maximum of 1000 beside its note that 999 is the usable ceiling", () => {
    expect(rowFor({ name: "conversations.list" })).toEqual({
      audience: "bot-and-user",
      botScopes: ["channels:read", "groups:read", "im:read", "mpim:read"],
      limitDefault: 100,
      limitMax: 1000,
      name: "conversations.list",
      note: "limit must be UNDER 1000, so 999 is the usable ceiling.",
      observedOn: "2026-08-23",
      pagination: "cursor",
      tier: "2",
      userScopes: ["channels:read", "groups:read", "im:read", "mpim:read"],
    });
  });

  it("records search.messages as user-only, cursor-or-page, with no bot scope", () => {
    expect(rowFor({ name: "search.messages" })).toEqual({
      audience: "user-only",
      botScopes: [],
      limitDefault: 20,
      limitMax: 100,
      name: "search.messages",
      note: "page is itself capped at 100, so page-paging reaches at most count*100 matches; cursor is the way past that.",
      observedOn: "2026-08-23",
      pagination: "cursor-or-page",
      tier: "2",
      userScopes: ["search:read"],
    });
  });

  it("records users.list with neither a default nor a maximum limit", () => {
    expect(rowFor({ name: "users.list" })).toEqual({
      audience: "bot-and-user",
      botScopes: ["users:read"],
      limitDefault: undefined,
      limitMax: undefined,
      name: "users.list",
      note: "the page states neither a default nor a maximum for limit.",
      observedOn: "2026-08-23",
      pagination: "cursor",
      tier: "2",
      userScopes: ["users:read"],
    });
  });

  it("uses four pagination styles across the snapshot and never unknown, since every row is a page that was read", () => {
    expect([...new Set(SLACK_API_METHODS.map((method) => method.pagination))].toSorted()).toEqual([
      "cursor",
      "cursor-or-page",
      "none",
      "page",
    ]);
  });
});

describe("TIER_FLOOR_PER_MINUTE", () => {
  it("publishes a floor for tiers 1 to 4 and none for the special tier", () => {
    expect(TIER_FLOOR_PER_MINUTE).toEqual({ "1": 1, "2": 20, "3": 50, "4": 100, special: undefined });
    expect(Object.keys(TIER_FLOOR_PER_MINUTE)).toEqual(["1", "2", "3", "4", "special"]);
  });
});
