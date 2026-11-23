/**
 * What `docs.slack.dev` says about a method, for the methods whose pages were actually read.
 *
 * ## Why this is a table and not a fetch
 *
 * Three facts change how a Slack call is planned and NONE of them is in the TypeScript typings: the
 * rate-limit tier, the OAuth scopes, and which token types the method accepts. They exist only on each
 * method's own documentation page, one page per method.
 *
 * ## Partial on purpose, and it says so
 *
 * This table holds 11 of the SDK's 264 methods. That is not a stub to fill in later — it is the atlas
 * doctrine applied honestly. A row here means a page was fetched and read on {@link DocsFacts.observedOn};
 * a method with no row means nobody looked, and the atlas reports that as a fraction
 * ({@link AtlasCounts.withDocs} over {@link AtlasCounts.methods}) precisely so a reader cannot mistake a
 * partial sweep for a complete one. The alternative — defaulting an unread method to Tier 3 because most
 * are — is the invented name the whole atlas idea exists to remove.
 *
 * The 11 are the ones this repository's own Slack work turns on: the four `conversations.*` calls the
 * corpus crawl makes, the two `search.*` calls that were candidates for replacing part of it, and the
 * `users.*`/`reactions.*`/`chat.*` calls the connector and the outbound door already use.
 *
 * ## The tier fact that changes a plan
 *
 * Slack applies a rate limit **per method, per workspace, per app**, not per app. Two methods in different
 * tiers therefore drain two independent buckets, and a crawl whose calls all go to one method is leaving
 * every other bucket idle. That single sentence is why this table records the tier of methods the crawl does not yet
 * call.
 */
import type { DocsFacts } from "./model.js";

/**
 * Every method whose documentation page has been read, sorted by name.
 *
 * `limitDefault`/`limitMax` are the page's own numbers for whichever of `limit` or `count` that method
 * paginates with; `undefined` where the page states none.
 */
export const SLACK_API_METHODS: readonly DocsFacts[] = [
  {
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
  },
  {
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
  },
  {
    audience: "bot-and-user",
    botScopes: ["channels:read", "groups:read", "im:read", "mpim:read"],
    limitDefault: undefined,
    limitMax: undefined,
    name: "conversations.info",
    observedOn: "2026-08-23",
    pagination: "none",
    tier: "3",
    note: undefined,
    userScopes: ["channels:read", "groups:read", "im:read", "mpim:read"],
  },
  {
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
  },
  {
    audience: "bot-and-user",
    botScopes: ["channels:read", "groups:read", "im:read", "mpim:read"],
    limitDefault: 100,
    limitMax: 1000,
    name: "conversations.members",
    observedOn: "2026-08-23",
    pagination: "cursor",
    tier: "4",
    note: undefined,
    userScopes: ["channels:read", "groups:read", "im:read", "mpim:read"],
  },
  {
    audience: "bot-and-user",
    botScopes: ["channels:history", "groups:history", "im:history", "mpim:history"],
    limitDefault: 1000,
    limitMax: 1000,
    name: "conversations.replies",
    note: "default limit is 1000, not 100 — a crawl asking for 200 pages a 300-reply thread twice for nothing.",
    observedOn: "2026-08-23",
    pagination: "cursor",
    tier: "3",
    userScopes: ["channels:history", "groups:history", "im:history", "mpim:history"],
  },
  {
    audience: "bot-and-user",
    botScopes: ["reactions:read"],
    limitDefault: undefined,
    limitMax: undefined,
    name: "reactions.get",
    observedOn: "2026-08-23",
    pagination: "none",
    tier: "3",
    note: undefined,
    userScopes: ["reactions:read"],
  },
  {
    audience: "user-only",
    botScopes: [],
    limitDefault: 20,
    limitMax: undefined,
    name: "search.all",
    note: "one call returns matches grouped as messages AND files, each with its own paging block.",
    observedOn: "2026-08-23",
    pagination: "page",
    tier: "2",
    userScopes: ["search:read"],
  },
  {
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
  },
  {
    audience: "bot-and-user",
    botScopes: ["channels:read", "groups:read", "im:read", "mpim:read"],
    limitDefault: 100,
    limitMax: 999,
    name: "users.conversations",
    observedOn: "2026-08-23",
    pagination: "cursor",
    tier: "3",
    note: undefined,
    userScopes: ["channels:read", "groups:read", "im:read", "mpim:read"],
  },
  {
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
  },
];

/**
 * The published allowance for each tier, in requests per minute. Slack states these as floors ("50+ per
 * minute"), so a measured throughput ABOVE the number is expected and one below it is the thing worth
 * investigating.
 */
export const TIER_FLOOR_PER_MINUTE: Readonly<Record<string, number | undefined>> = {
  "1": 1,
  "2": 20,
  "3": 50,
  "4": 100,
  special: undefined,
};
