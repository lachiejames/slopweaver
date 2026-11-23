/**
 * Slack's own read marker for one direct message, off a raw `conversations.info` body — the one place `slack
 * unread` can say UNREAD and mean it.
 *
 * MEASURED on the owner's workspace (`slopweaver slack probe --method conversations.info channel=<a D… id>
 * --shape-at channel`): on the owner's USER token a DM answers `last_read`, `unread_count`, `unread_count_display` and
 * `latest`. No public method answers the same for a thread, which is why `slack unread`'s activity half says
 * "a person's word since yours" and never "unread".
 *
 * Pure: the transport is `../../corpus/slack/api.ts`'s `makeSlackConversationInfoCall`.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { compareSlackTimestamps, isSlackTimestamp } from "./selection.js";

/** The newest message a conversation holds, as `conversations.info` reports it. */
interface LatestMessage {
  readonly ts: string;
  /** The author's id; absent on an app post that carries only a bot id. */
  readonly userId: string | undefined;
}

/** One DM's read state, as Slack holds it for the token's own user. */
export interface ReadMarker {
  readonly channelId: string;
  readonly kind: "dm" | "group";
  /** For a one-to-one DM, the person on the other end. */
  readonly otherUserId: string | undefined;
  /** Slack's `last_read`: the newest message the owner has read here. */
  readonly lastRead: string;
  /**
   * Slack's own count of what is unread, as its sidebar badge shows it. Absent on a group DM, which answers
   * `last_read` and no count — measured on `C0SYN000028` — so only the messages past the marker tell.
   */
  readonly unreadCount: number | undefined;
  /** The newest message, absent for a conversation with none. */
  readonly latest: LatestMessage | undefined;
}

/** Why a `conversations.info` body cannot say what is unread. */
export type ReadMarkerError =
  | { readonly code: "NO_CHANNEL"; readonly message: string }
  | { readonly code: "NOT_DIRECT"; readonly message: string; readonly channelId: string }
  | { readonly code: "NO_LAST_READ"; readonly message: string; readonly channelId: string }
  | { readonly code: "NO_UNREAD_COUNT"; readonly message: string; readonly channelId: string };

/** The one way each {@link ReadMarkerError} is built. */
export const ReadMarkerErrors = {
  noChannel: (): ReadMarkerError => ({ code: "NO_CHANNEL", message: "the response carried no `channel` object" }),
  noLastRead: ({ channelId }: { channelId: string }): ReadMarkerError => ({
    channelId,
    code: "NO_LAST_READ",
    message: `${channelId} answered no \`last_read\`, so what is unread there is unknown`,
  }),
  noUnreadCount: ({ channelId }: { channelId: string }): ReadMarkerError => ({
    channelId,
    code: "NO_UNREAD_COUNT",
    message: `${channelId} answered no \`unread_count_display\`, so what is unread there is unknown`,
  }),
  notDirect: ({ channelId }: { channelId: string }): ReadMarkerError => ({
    channelId,
    code: "NOT_DIRECT",
    message: `${channelId} is not a direct message`,
  }),
} as const;

/**
 * Parse one `conversations.info` body into a read marker.
 *
 * @param body the raw response
 * @returns the marker, or why the body cannot say what is unread — a conversation that is not a DM, a DM with no
 *   `last_read`, or a one-to-one DM with no count is never read as "nothing unread"
 */
export function readMarkerOf({ body }: { body: unknown }): Result<ReadMarker, ReadMarkerError> {
  const channel = isRecord(body) ? body["channel"] : undefined;
  if (!isRecord(channel) || typeof channel["id"] !== "string") {
    return err(ReadMarkerErrors.noChannel());
  }
  const channelId = channel["id"];
  const kind = kindOf({ channel });
  if (kind === undefined) {
    return err(ReadMarkerErrors.notDirect({ channelId }));
  }
  const lastRead = channel["last_read"];
  if (typeof lastRead !== "string" || !isSlackTimestamp({ value: lastRead })) {
    return err(ReadMarkerErrors.noLastRead({ channelId }));
  }
  const count = channel["unread_count_display"];
  if (kind === "dm" && typeof count !== "number") {
    return err(ReadMarkerErrors.noUnreadCount({ channelId }));
  }
  const user = channel["user"];
  return ok({
    channelId,
    kind,
    lastRead,
    latest: latestOf({ value: channel["latest"] }),
    otherUserId: typeof user === "string" ? user : undefined,
    unreadCount: typeof count === "number" ? count : undefined,
  });
}

/**
 * Whether the messages past a marker must be read: Slack's own count says so, a newest message past the marker is
 * not the owner's, or there is no count at all (a group DM), where only those messages can tell. The first two are both read
 * because each misses a case the other sees — the count lags a message seconds old, and a muted DM counts nothing
 * while its marker still trails.
 *
 * @param marker the conversation's read marker
 * @param ownerId the owner's own Slack id; the owner's own newest message is never unread to them
 * @returns false only when the marker itself says nothing is unread
 */
export function mayHaveUnread({ marker, ownerId }: { marker: ReadMarker; ownerId: string }): boolean {
  if (marker.unreadCount === undefined || marker.unreadCount > 0) {
    return true;
  }
  const latest = marker.latest;
  if (latest === undefined || latest.userId === ownerId) {
    return false;
  }
  return compareSlackTimestamps({ left: latest.ts, right: marker.lastRead }) > 0;
}

/**
 * Whether a `conversations.info` body is a DM or group DM at all. `search.messages` `is:mpim` also matches private
 * channels — measured, `C0SYN000008` answered `is_im` and `is_mpim` both false and no unread count — so
 * a caller asks this first and passes such a conversation over rather than reporting it unreadable.
 *
 * @param body the raw response
 * @returns true for a DM or group DM
 */
export function isDirectConversation({ body }: { body: unknown }): boolean {
  const channel = isRecord(body) ? body["channel"] : undefined;
  return isRecord(channel) && kindOf({ channel }) !== undefined;
}

/**
 * Whether a `conversations.info` body SAYS it is not a DM: both flags stated, and both false. A body that names
 * neither flag says nothing, and a caller that passed such a conversation over as a channel would drop a DM
 * silently — so only Slack's own `false` lets one through as not-a-DM.
 *
 * @param body the raw response
 * @returns true only when `is_im` and `is_mpim` are both present and false
 */
export function statesNotDirect({ body }: { body: unknown }): boolean {
  const channel = isRecord(body) ? body["channel"] : undefined;
  return isRecord(channel) && channel["is_im"] === false && channel["is_mpim"] === false;
}

/** Which kind of DM a `conversations.info` channel is, or `undefined` for anything else. */
function kindOf({ channel }: { channel: Record<string, unknown> }): ReadMarker["kind"] | undefined {
  if (channel["is_im"] === true) {
    return "dm";
  }
  if (channel["is_mpim"] === true) {
    return "group";
  }
  return undefined;
}

/** The `latest` object as a message, or `undefined` when it carries no usable `ts`. */
function latestOf({ value }: { value: unknown }): LatestMessage | undefined {
  if (!isRecord(value) || typeof value["ts"] !== "string" || !isSlackTimestamp({ value: value["ts"] })) {
    return undefined;
  }
  const user = value["user"];
  return { ts: value["ts"], userId: typeof user === "string" ? user : undefined };
}
