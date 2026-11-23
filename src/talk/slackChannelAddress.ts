/**
 * What the console voice passes `talk slack-channel` to name a channel, parsed before anything reaches Slack.
 *
 * The voice reads the channel off the owner's screen and never asks the owner for an id. The Slack desktop app shows a channel's NAME in its header and no address at all, so a name is the
 * ordinary input; a browser shows a link, and another tool may already hold an id. All three are accepted here.
 * Pure: no I/O, no clock.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type SlackChannelError, SlackChannelErrors } from "./slackChannelErrors.js";

/** A workspace host: one or more whole DNS labels before `slack.com`, so `.slack.com` or `a..slack.com` is no Slack. */
const SLACK_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+slack\.com$/;

/**
 * A channel named by its id, from a link or another tool.
 *
 * @internal
 */
export interface SlackChannelById {
  readonly kind: "id";
  readonly channel: string;
  /** The workspace origin the link named, e.g. `https://acme.slack.com`; absent for a bare id or an app link. */
  readonly workspace?: string;
}

/**
 * A channel named as the owner's screen shows it, lowercased with its `#` removed.
 *
 * @internal
 */
export interface SlackChannelByName {
  readonly kind: "name";
  readonly name: string;
}

/** What one `--channel` names. */
export type SlackChannelAddress = SlackChannelById | SlackChannelByName;

/** The longest name Slack allows a channel. */
const MAX_NAME_CHARS = 80;

/** A conversation id: Slack's own uppercase shape, never a name a person typed (names are lowercase). */
const CONVERSATION_ID = /^[CGD][A-Z0-9]{6,}$/u;

/**
 * Parse what names a channel: a name (`squad-platform`, `#squad-platform`), a Slack link to the channel or a message
 * in it (`https://acme.slack.com/archives/C…`, `https://app.slack.com/client/T…/C…`), or a conversation id.
 *
 * @param input the words the voice passed, as read off the owner's screen or handed over by another tool
 * @returns what it names, or why it names nothing
 */
export function parseSlackChannelAddress({ input }: { input: string }): Result<SlackChannelAddress, SlackChannelError> {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return err(SlackChannelErrors.addressInvalid({ input, why: "it is empty" }));
  }
  if (/^https?:\/\//iu.test(trimmed)) {
    return channelFromLink({ input, link: trimmed });
  }
  if (CONVERSATION_ID.test(trimmed)) {
    return ok({ channel: trimmed, kind: "id" });
  }
  const name = trimmed.replace(/^#/u, "").toLowerCase();
  if (name.length === 0) {
    return err(SlackChannelErrors.addressInvalid({ input, why: "it is a # with no name" }));
  }
  if (/\s/u.test(name)) {
    return err(SlackChannelErrors.addressInvalid({ input, why: "a channel name has no spaces" }));
  }
  if (name.length > MAX_NAME_CHARS) {
    return err(
      SlackChannelErrors.addressInvalid({
        input,
        why: `a channel name is at most ${String(MAX_NAME_CHARS)} characters`,
      }),
    );
  }
  // Slack names hold letters, numbers, hyphens and underscores only, so a path or another scheme is refused here
  // rather than carried to Slack as a name nothing matches.
  if (!/^[\p{L}\p{N}_-]+$/u.test(name)) {
    return err(
      SlackChannelErrors.addressInvalid({
        input,
        why: "a channel name holds only letters, numbers, hyphens and underscores",
      }),
    );
  }
  return ok({ kind: "name", name });
}

/** The channel a Slack link names, with its workspace when the host carries one. */
function channelFromLink({
  input,
  link,
}: {
  input: string;
  link: string;
}): Result<SlackChannelAddress, SlackChannelError> {
  // The URL parser strips a tab or newline and keeps an empty user name, so "https://\t:\n@acme.slack.com/…" would
  // reach the port and credentials check clean; a link Slack draws carries none of them. It also reads
  // a backslash as a slash, so "https://acme.slack.com\archives\C…" would pass as the link it is not.
  if (/[\s\p{Cc}@\\]/u.test(link)) {
    return err(
      SlackChannelErrors.addressInvalid({
        input,
        why: "a Slack link carries no spaces, control characters, backslashes or @",
      }),
    );
  }
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return err(SlackChannelErrors.addressInvalid({ input, why: "it is not a well-formed link" }));
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !SLACK_HOST.test(host)) {
    return err(SlackChannelErrors.addressInvalid({ input, why: "it is not an https link on slack.com" }));
  }
  // Another port is another server; credentials cannot reach here, refused above with their "@".
  if (url.port !== "") {
    return err(SlackChannelErrors.addressInvalid({ input, why: "a Slack link carries no port" }));
  }
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  const channel = conversationSegment({ segments });
  if (channel === undefined) {
    return err(SlackChannelErrors.addressInvalid({ input, why: "the link names no conversation" }));
  }
  if (host === "app.slack.com") {
    return ok({ channel, kind: "id" });
  }
  return ok({ channel, kind: "id", workspace: url.origin });
}

/** The conversation id after `/archives/` or `/client/<team>/`, when the path carries one. */
function conversationSegment({ segments }: { segments: readonly string[] }): string | undefined {
  const [first, second, third] = segments;
  let candidate: string | undefined;
  if (first === "archives") {
    candidate = second;
  } else if (first === "client") {
    candidate = third;
  }
  if (candidate === undefined || !CONVERSATION_ID.test(candidate)) {
    return undefined;
  }
  return candidate;
}
