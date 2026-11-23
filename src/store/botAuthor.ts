/**
 * Whether a content row was written by an automation rather than a person — the one rule behind
 * `content.author_is_bot`.
 *
 * The detective verbs start HUMAN-ONLY and widen, the way Slack search excludes automations
 * by default. That needs one source-neutral column, and a column is only as good as the rule that fills it,
 * so the rule lives here ONCE and both writers call it: the projection (`./project.ts`) over a bronze
 * record's payload, and the backfill (`./resolveBots.ts`) over the same keys read back out of the side
 * tables. A second copy written in SQL for the backfill's sake is the drift `./resolveEdges.ts`'s header
 * already refused for the thread edge.
 *
 * ## The signals, each one read in bronze rather than assumed
 *
 * - **Slack**: a `bot_id` on the message — the rule `content_slack.is_bot` has always used — or Slack's own
 *   `bot_message` subtype.
 * - **GitHub**: the structural `[bot]` login suffix GitHub gives an App account (a self-hosted Renovate App's
 *   `<login>[bot]` is in bronze), via `accountKind.ts`'s own exact test, or the payload's `user.type === "Bot"`.
 *   No login is named here: the suffix is the whole signal, so an organisation's own bot needs no registry.
 * - **Linear**: a `botActor` whose `userDisplayName` carries the `[bot]` suffix (Renovate's issues arrive
 *   through the GitHub integration that way), or one whose `type` is an AUTOMATION — Linear's own
 *   `workflow`, an `oauthClient` such as CodeRabbit — with no human author object beside it. A botActor
 *   alone is NOT the signal, because most of Linear's integrations are CONDUITS for a person's words: Slack
 *   thread sync, Slack Asks, inbound email and GitHub issue sync all arrive with a `botActor`. MEASURED in
 *   `bronze/linear/compact.jsonl`: 15,388 records carry the older slim `botActor: {name:
 *   "Slack"}` with `user` and `externalUser` both null, and a support lead's question to the team, synced from
 *   a Slack thread, is one of them (`grep -c '"botActor":{"name":"Slack"}'`). Calling those bots would
 *   hide a person's words from every detective. `accountKind.ts` states the same asymmetry — a missed bot
 *   is visible noise, a hidden human is invisible loss — so a conduit's own boilerplate stays visible.
 * - **Every other source** answers `false`. Notion's projected payload names its author by id only, and
 *   Gmail, Calendar, Fathom and the owner's own `self` rows carry no automation marker at all. That is a
 *   stated limit of this column, not a claim that those sources hold no automation.
 */
import { isRecord } from "../lib/parsers.js";
import { hasBotLoginSuffix } from "../silver/accountKind.js";

/** Slack's own subtype for a message an integration posted. */
const SLACK_BOT_SUBTYPE = "bot_message";

/** The `user.type` GitHub's REST payload gives an App account. */
const GITHUB_BOT_USER_TYPE = "Bot";

/** The payload keys a Linear record names a HUMAN author under, any one of which makes it a person's words. */
const LINEAR_HUMAN_AUTHOR_KEYS: readonly string[] = ["user", "externalUser", "creator"];

/** The Linear `botActor.type` values that are an automation rather than a conduit for a person's words. */
const LINEAR_AUTOMATION_ACTOR_TYPES: ReadonlySet<string> = new Set(["workflow", "oauthClient"]);

/**
 * The payload keys this rule reads, per source — what the backfill must select back out of a side table's
 * `raw` envelope so it hands {@link authorIsBot} the same bag the projection did.
 *
 * Exported so the backfill's SELECT and this rule cannot disagree about which keys matter: a key added here
 * and not there would be a signal the projection honours and the backfill silently never sees.
 */
export const BOT_PAYLOAD_KEYS = {
  github: ["user"],
  linear: ["botActor", ...LINEAR_HUMAN_AUTHOR_KEYS],
  slack: ["bot_id", "subtype"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/**
 * A string field of a payload bag, or nothing when it is absent or not a non-empty string.
 *
 * @param bag the payload, or nothing
 * @param key the field
 * @returns the string, or `null`
 */
function text({ bag, key }: { bag: Readonly<Record<string, unknown>> | undefined; key: string }): string | null {
  const value = bag?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Whether a Linear payload was written by an integration with no person behind it.
 *
 * @param raw the record's payload
 * @returns true for an integration-authored record
 */
function linearIsBot({ raw }: { raw: Readonly<Record<string, unknown>> }): boolean {
  const actor = raw["botActor"];
  if (!isRecord(actor)) {
    return false;
  }
  const actingFor = text({ bag: actor, key: "userDisplayName" });
  if (actingFor !== null && hasBotLoginSuffix({ value: actingFor })) {
    return true;
  }
  const actorType = text({ bag: actor, key: "type" });
  if (actorType === null || !LINEAR_AUTOMATION_ACTOR_TYPES.has(actorType)) {
    return false;
  }
  return !LINEAR_HUMAN_AUTHOR_KEYS.some((key) => isRecord(raw[key]));
}

/**
 * Whether one content row's author is an automation, from what its platform said about it.
 *
 * Pure. Both writers of `content.author_is_bot` call this and nothing else decides it.
 *
 * @param source the record's source slug
 * @param authorNativeId what the platform said authored it — a login, a member id — when it said anything
 * @param raw the record's provider payload, or the subset of it {@link BOT_PAYLOAD_KEYS} names
 * @returns true when the author is a bot or integration
 */
export function authorIsBot({
  source,
  authorNativeId,
  raw,
}: {
  source: string;
  authorNativeId: string | null;
  raw: Readonly<Record<string, unknown>> | undefined;
}): boolean {
  if (source === "slack") {
    return text({ bag: raw, key: "bot_id" }) !== null || text({ bag: raw, key: "subtype" }) === SLACK_BOT_SUBTYPE;
  }
  if (source === "github") {
    if (authorNativeId !== null && hasBotLoginSuffix({ value: authorNativeId })) {
      return true;
    }
    const user = raw?.["user"];
    return isRecord(user) && text({ bag: user, key: "type" }) === GITHUB_BOT_USER_TYPE;
  }
  if (source === "linear") {
    return raw !== undefined && linearIsBot({ raw });
  }
  return false;
}
