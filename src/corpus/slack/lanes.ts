/**
 * The conversation LANES every Slack `conversations.list` walk asks along, and the only place a `types`
 * string is written.
 *
 * It is a leaf module rather than a section of `./fetch.ts` for two reasons. The mechanical one: `fetch.ts`
 * imports `./discovery.ts`, so a lane constant living there and read by discovery is an import cycle. The
 * real one: `./api.ts`, `./discovery.ts`, `./structures.ts`, `../../cli/commands/refresh/slackCoverage.ts`
 * and `../../live/slack/pagination.ts` all need the same answer to "which conversations am I asking for",
 * and the defect below is exactly what happens when two of them answer it separately.
 *
 * MEASURED, real workspace, real user token, `exclude_archived: false`, `limit: 200`, each walk
 * paged to exhaustion:
 *
 *     types=public_channel,private_channel,mpim,im  11 pages  548 public  57 private  81 im   0 mpim
 *     types=mpim,im                                  1 page     0          0          81 im  51 mpim
 *     types=mpim                                     1 page     0          0           0 im  51 mpim
 *     types=private_channel,mpim                     1 page     0         57           0 im  51 mpim
 *     types=public_channel,mpim                     11 pages  548          0           0 im   0 mpim
 *
 * **`public_channel` present in the list suppresses every `mpim` row**, at every page, all the way to
 * exhaustion. Order in the list makes no difference, and `im` survives the same combination. This is Slack's
 * behaviour inside the call, not our filtering — `channelsFromPage` and `reachKind` read `is_mpim` correctly
 * and simply never saw one. So asking for everything at once reaches LESS than asking twice, and every walk
 * here is per lane.
 *
 * Two things the measurement does not say, stated so nobody infers them. It does not say a third class
 * cannot be dropped the same way by some other combination — the standing protection against that is the
 * `refresh --source slack --coverage` denominator, not this file. And group-DM ids in this workspace are
 * **`C`-prefixed** (`C0SYN000026`, `is_mpim: true`), so counting `G`-prefixed containers measures nothing:
 * `is_mpim` is the only signal there has ever been.
 *
 * Reproduce the consequence without a probe script:
 *
 *     slopweaver refresh --source slack --coverage   # the `group-dm` tally line
 */

/**
 * Which `conversations.list` type set ONE message-crawl discovery walk asks for. Two lanes, because Slack
 * serves fewer conversations when asked for more — see this module's header for the measurement.
 */
export type SlackConversationLane = "channels-and-dms" | "group-dms";

/**
 * The `conversations.list` `types` string each read lane asks for. ONE registry, because the whole defect
 * was two conversation classes sharing one request — a lane naming both `public_channel` and `mpim`
 * silently returns no group DMs, and `unit/corpus/slack/conversationLanes.test.ts` is what refuses that
 * pairing.
 */
export const SLACK_LANE_TYPES = {
  "channels-and-dms": "public_channel,private_channel,im",
  "group-dms": "mpim",
} as const satisfies Record<SlackConversationLane, string>;

/** Every read lane, in walk order — named once so a caller cannot page one and forget the other. */
export const SLACK_CONVERSATION_LANES: readonly SlackConversationLane[] = ["channels-and-dms", "group-dms"];

/**
 * Which conversation class ONE structural `conversations.list` walk asks for.
 *
 * **`im` is deliberately absent, and this is the note saying so rather than leaving it looking forgotten.**
 * What a structure row adds over the message rows is the MEMBER LIST, and a DM's membership is definitionally
 * the token owner plus the one other party that every message in it already names. A group DM's membership is
 * not derivable that way — it is the audience answer, three to nine people, and the reason this lane exists.
 * Adding `im` would put 81 two-person rows through `buildChannelRows`' serial `conversations.members` loop
 * for nothing retrieval can use; the lane is one string away if that ever changes.
 */
export type SlackStructureLane = "channels" | "group-dms";

/** The `conversations.list` `types` string each structural lane asks for. One registry, so the two cannot drift. */
export const SLACK_STRUCTURE_LANE_TYPES = {
  channels: "public_channel,private_channel",
  "group-dms": "mpim",
} as const satisfies Record<SlackStructureLane, string>;

/** Every structural lane, in walk order — named once so a caller cannot page one and forget the other. */
export const SLACK_STRUCTURE_LANES: readonly SlackStructureLane[] = ["channels", "group-dms"];

/**
 * The human label for a read lane, used to open a paging warning so a short walk names the conversation
 * class it truncated rather than reading as one undifferentiated "channel discovery".
 *
 * @param lane the conversation lane being paged
 * @returns the label to put at the front of a warning line
 */
export function slackLaneLabel({ lane }: { lane: SlackConversationLane }): string {
  return lane === "group-dms" ? "slack group-DM discovery" : "slack channel discovery";
}

/**
 * The human label for a structural lane. Same job as {@link slackLaneLabel} on the read side: a membership
 * cap that skipped conversations has to name WHICH class it skipped, because the two lanes are hundreds of rows
 * and dozens of rows and one undifferentiated count hides that the whole group-DM lane went unresolved.
 *
 * @param lane the structural lane being planned or paged
 * @returns the label to name that class with inside a warning line
 */
export function slackStructureLaneLabel({ lane }: { lane: SlackStructureLane }): string {
  return lane === "group-dms" ? "group DM" : "channel";
}
