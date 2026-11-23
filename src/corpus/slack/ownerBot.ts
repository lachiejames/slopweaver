/**
 * Me-to-me resolution (PR4.5): the owner's OWN bot posts under a bot identity, so a message the bot sent
 * would otherwise read as authored by "a bot", not by the owner — and a thread the bot answered would
 * look still-owed-by-owner. This maps the owner's bot identity back to the owner's Slack user id at
 * projection time, so owner-scoped retrieval ("what's assigned to me", "threads I answered") resolves
 * correctly. A THIRD-party bot never matches — only the ids declared for the owner's own bot.
 *
 * Pure. The bot identity is declared in `profile.json` (see {@link ../../profile.Profile.slackBot}).
 *
 * The feature is off by default, and precisely: it is the ID LISTS that arm it, not the presence of the
 * declaration. `slackOwnerBotIdentity` returns an identity for any declaration, but {@link resolveOwnerBotToOwner}
 * matches by `includes` against `botUserIds`/`appIds`/`botIds`, all of which default to empty — so a
 * declaration carrying only `ownerUserId` (as one carrying only card chrome must) rewrites no author at all.
 * Said explicitly because the same file's `cardChrome` is cosmetic and shares this key, and a reader who
 * believed presence alone armed me-to-me would decline to set a bot's display name.
 */
import { isRecord } from "../../lib/parsers.js";

/**
 * The owner's own Slack bot identity, matched on any of the four ids Slack can attribute a bot post to:
 * the resolved `user`, the app id, the bot-user id, and the internal bot id.
 */
export interface SlackOwnerBotIdentity {
  /** The owner's human Slack user id — what a matched bot post resolves TO. */
  readonly ownerSlackUserId: string;
  /** Bot-user ids the owner's bot posts as (`Uxxx`/`Bxxx`). */
  readonly botUserIds: readonly string[];
  /** App ids of the owner's bot (`raw.app_id`). */
  readonly appIds: readonly string[];
  /** Internal bot ids of the owner's bot (`raw.bot_id`). */
  readonly botIds: readonly string[];
}

/** The persona seed's optional owner-bot declaration (kept structural so this module never imports Profile). */
export interface SlackBotDeclaration {
  /** Absent on a chrome-only declaration; the profile schema requires it whenever an id list is non-empty. */
  readonly ownerUserId?: string | undefined;
  readonly botUserIds?: readonly string[];
  readonly appIds?: readonly string[];
  readonly botIds?: readonly string[];
}

/**
 * Build the owner-bot identity from the persona seed's `slackBot` declaration, defaulting each id list to
 * empty. `undefined` in ⇒ `undefined` out (me-to-me stays off). Pure.
 *
 * @param slackBot the profile's `slackBot` declaration, when set
 * @returns the owner-bot identity, or `undefined`
 */
export function slackOwnerBotIdentity({
  slackBot,
}: {
  slackBot: SlackBotDeclaration | undefined;
}): SlackOwnerBotIdentity | undefined {
  // No declaration, or a chrome-only one with nobody to resolve TO, both mean me-to-me does not run. The
  // second case is not merely inert-by-empty-lists: there is no owner id, so there is no possible rewrite.
  const ownerUserId = slackBot?.ownerUserId;
  if (slackBot === undefined || ownerUserId === undefined) {
    return undefined;
  }
  // Each list arms me-to-me for one KIND of id, and a declaration names only the kinds its bot posts under: a
  // list it leaves out is a kind with no ids, so nothing is matched on it (the module header says why).
  const { appIds = [], botIds = [], botUserIds = [] } = slackBot;
  return { appIds, botIds, botUserIds, ownerSlackUserId: ownerUserId };
}

/** Whether `value` (a raw payload field) is a non-empty string present in `set`. Pure. */
function matchesId({ value, set }: { value: unknown; set: readonly string[] }): boolean {
  return typeof value === "string" && value.length > 0 && set.includes(value);
}

/**
 * Resolve a record's author back to the owner when it was posted by the owner's own bot — else `undefined`
 * (leave the author unchanged). Matches the author/`user`, `app_id`, or `bot_id` of the raw Slack payload
 * against the declared owner-bot ids. A third-party bot matches none of them, so it is never rewritten.
 *
 * @param author the record's author (the raw Slack `user` id), when known
 * @param raw the record's raw Slack payload (carries `app_id`/`bot_id`), when kept
 * @param ownerBot the owner's declared bot identity, when configured
 * @returns the owner's Slack user id when the post is the owner's bot, else `undefined`
 */
export function resolveOwnerBotToOwner({
  author,
  raw,
  ownerBot,
}: {
  author: string | undefined;
  raw: Readonly<Record<string, unknown>> | undefined;
  ownerBot: SlackOwnerBotIdentity | undefined;
}): string | undefined {
  if (ownerBot === undefined) {
    return undefined;
  }
  const rawObj = isRecord(raw) ? raw : {};
  const isOwnerBot =
    matchesId({ set: ownerBot.botUserIds, value: author }) ||
    matchesId({ set: ownerBot.botUserIds, value: rawObj["user"] }) ||
    matchesId({ set: ownerBot.appIds, value: rawObj["app_id"] }) ||
    matchesId({ set: ownerBot.botIds, value: rawObj["bot_id"] });
  return isOwnerBot ? ownerBot.ownerSlackUserId : undefined;
}

/**
 * A record's author after me-to-me resolution: the owner's Slack user id when the post is the owner's own bot,
 * else the author Slack attributed it to. Pure.
 *
 * Moved here from `./project.ts`, which is at its file-size floor, because it is me-to-me's own rule rather
 * than a projection one.
 *
 * @param author the record's author (the raw Slack `user` id), when known
 * @param raw the record's raw Slack payload (carries `app_id`/`bot_id`), when kept
 * @param ownerBot the owner's declared bot identity, when configured
 * @returns the owner's Slack user id for the owner's own bot, else the original author
 */
export function authorAfterMeToMe({
  author,
  raw,
  ownerBot,
}: {
  author: string | undefined;
  raw: Readonly<Record<string, unknown>> | undefined;
  ownerBot: SlackOwnerBotIdentity | undefined;
}): string | undefined {
  const owner = resolveOwnerBotToOwner({ author, ownerBot, raw });
  // Not the owner's own bot, or me-to-me is off: nothing is rewritten, so the attributed author stands.
  if (owner === undefined) {
    return author;
  }
  return owner;
}
