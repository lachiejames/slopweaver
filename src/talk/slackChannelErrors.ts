/**
 * Every way `slopweaver talk slack-channel` fails to read the channel the owner named — its own union, because a name that
 * matches nothing, a name that matches two channels and a channel the token cannot read are three different things
 * to tell the owner, and none of them is "the channel is empty".
 */

/** What the owner named is neither a channel name, a Slack link to one, nor a conversation id. */
export interface ChannelAddressInvalidError {
  readonly code: "CHANNEL_ADDRESS_INVALID";
  readonly message: string;
  readonly input: string;
}

/** No channel the token can see carries that name. */
export interface ChannelNotFoundError {
  readonly code: "CHANNEL_NOT_FOUND";
  readonly message: string;
  readonly name: string;
  /** The closest names the token can see — suggestions to say, never a channel read in its place. */
  readonly nearest: readonly string[];
}

/** More than one channel the token can see carries that name; none is chosen. */
export interface ChannelAmbiguousError {
  readonly code: "CHANNEL_AMBIGUOUS";
  readonly message: string;
  readonly name: string;
  readonly count: number;
}

/** The channel list could not be read whole, so whether the name exists cannot be said. */
export interface ChannelListFailedError {
  readonly code: "CHANNEL_LIST_FAILED";
  readonly message: string;
}

/** Slack would not say what conversation an id or link names, or that this token may read it. */
export interface ChannelInfoFailedError {
  readonly code: "CHANNEL_INFO_FAILED";
  readonly message: string;
  readonly channel: string;
}

/** The channel was found and its history would not read. */
export interface ChannelHistoryFailedError {
  readonly code: "CHANNEL_HISTORY_FAILED";
  readonly message: string;
  /** The channel as the owner would name it: `#name`, or `a DM with …`. */
  readonly channel: string;
}

/** The workspace's own address could not be read, so no message could carry a link back to it. */
export interface ChannelWorkspaceUnknownError {
  readonly code: "CHANNEL_WORKSPACE_UNKNOWN";
  readonly message: string;
}

/** Every way `talk slack-channel` fails. */
export type SlackChannelError =
  | ChannelAddressInvalidError
  | ChannelNotFoundError
  | ChannelAmbiguousError
  | ChannelListFailedError
  | ChannelInfoFailedError
  | ChannelHistoryFailedError
  | ChannelWorkspaceUnknownError;

/** The factories every `talk slack-channel` failure is constructed through. */
export const SlackChannelErrors = {
  addressInvalid: ({ input, why }: { input: string; why: string }): ChannelAddressInvalidError => ({
    code: "CHANNEL_ADDRESS_INVALID",
    input,
    message: `${JSON.stringify(input)} names no Slack channel: ${why}. Pass the channel's name as the screen shows it, or a Slack link to it`,
  }),
  ambiguous: ({ name, count }: { name: string; count: number }): ChannelAmbiguousError => ({
    code: "CHANNEL_AMBIGUOUS",
    count,
    message: `${String(count)} channels are named #${name}, so none was read; a link to a message in the one the owner means names it exactly`,
    name,
  }),
  historyFailed: ({ channel, why }: { channel: string; why: string }): ChannelHistoryFailedError => ({
    channel,
    code: "CHANNEL_HISTORY_FAILED",
    message: `${channel} was found but its messages would not read: ${why}`,
  }),
  infoFailed: ({ channel, why }: { channel: string; why: string }): ChannelInfoFailedError => ({
    channel,
    code: "CHANNEL_INFO_FAILED",
    message: `Slack would not say what conversation ${channel} is, or this token may not read it: ${why}`,
  }),
  listFailed: ({ why }: { why: string }): ChannelListFailedError => ({
    code: "CHANNEL_LIST_FAILED",
    message: `the channel list could not be read whole, so whether that channel exists cannot be said: ${why}`,
  }),
  notFound: ({
    name,
    nearest,
    botToken,
  }: {
    name: string;
    nearest: readonly string[];
    botToken: boolean;
  }): ChannelNotFoundError => {
    const near = nearest.length > 0 ? ` The nearest names are ${nearest.map((entry) => `#${entry}`).join(", ")}.` : "";
    const bot = botToken ? " This read used the BOT token, which sees no private channel it was not invited to." : "";
    return {
      code: "CHANNEL_NOT_FOUND",
      message: `no channel this token can see is named #${name}.${near}${bot}`,
      name,
      nearest,
    };
  },
  workspaceUnknown: ({ why }: { why: string }): ChannelWorkspaceUnknownError => ({
    code: "CHANNEL_WORKSPACE_UNKNOWN",
    message: `the Slack workspace's address could not be read, so no message could be linked: ${why}`,
  }),
} as const;
