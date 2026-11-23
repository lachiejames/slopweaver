/**
 * Typed errors for the console's live channel window — `slack channel-view` (`./channelView.ts`) and the picture
 * cache behind it (`./channelMedia.ts`). Its own union rather than a section of `./errors.ts`'s: a channel read and its
 * picture cache fail in ways no thread read does, and the shape follows `.claude/rules/error-handling.md`.
 */
import { errorMessage } from "../../lib/errorMessage.js";

/** The live read of the channel itself failed — history, its name, or the workspace it lives in. */
export interface ChannelUnreadableError {
  readonly code: "CHANNEL_UNREADABLE";
  readonly message: string;
  readonly channel: string;
}

/** Slack answered for the channel but gave it no name, so the window cannot say which channel it shows. */
export interface ChannelUnnamedError {
  readonly code: "CHANNEL_UNNAMED";
  readonly message: string;
  readonly channel: string;
}

/** A history row the strict projection would not vouch for, so the window refuses rather than drop it. */
export interface ChannelRowsUnprojectableError {
  readonly code: "CHANNEL_ROWS_UNPROJECTABLE";
  readonly message: string;
  readonly channel: string;
}

/** A picture's preview bytes did not arrive — the download refused or the transport failed. */
export interface PictureUnfetchedError {
  readonly code: "PICTURE_UNFETCHED";
  readonly message: string;
  readonly fileId: string;
}

/** A picture's bytes arrived but could not be kept in, or read back from, the owner-only cache. */
export interface PictureUnstoredError {
  readonly code: "PICTURE_UNSTORED";
  readonly message: string;
  readonly fileId: string;
}

/**
 * The token answers for a different workspace than the link named, so the same channel id would be another
 * workspace's channel, or none, and the window refuses rather than draw it under the cited name.
 */
export interface WorkspaceMismatchError {
  readonly code: "WORKSPACE_MISMATCH";
  readonly message: string;
  readonly channel: string;
  readonly asked: string;
  readonly readIn: string;
}

/** Every way the channel window, or one picture in it, fails. */
export type ChannelViewError =
  | ChannelUnreadableError
  | ChannelUnnamedError
  | WorkspaceMismatchError
  | ChannelRowsUnprojectableError
  | PictureUnfetchedError
  | PictureUnstoredError;

/** Factories for {@link ChannelViewError}; each computes the sentence a reader sees. */
export const ChannelViewErrors = {
  channelUnnamed: ({ channel }: { channel: string }): ChannelUnnamedError => ({
    channel,
    code: "CHANNEL_UNNAMED",
    message: `conversations.info gave ${channel} no name, so the window cannot say which channel it shows`,
  }),
  channelUnreadable: ({ channel, cause }: { channel: string; cause: unknown }): ChannelUnreadableError => ({
    channel,
    code: "CHANNEL_UNREADABLE",
    message: `could not read ${channel} live from Slack: ${errorMessage({ error: cause })}`,
  }),
  pictureUnfetched: ({ fileId, cause }: { fileId: string; cause: unknown }): PictureUnfetchedError => ({
    code: "PICTURE_UNFETCHED",
    fileId,
    message: `the preview of ${fileId} did not arrive: ${errorMessage({ error: cause })}`,
  }),
  pictureUnstored: ({ fileId, why }: { fileId: string; why: string }): PictureUnstoredError => ({
    code: "PICTURE_UNSTORED",
    fileId,
    message: `the preview of ${fileId} could not be kept: ${why}`,
  }),
  rowsUnprojectable: ({ channel, cause }: { channel: string; cause: unknown }): ChannelRowsUnprojectableError => ({
    channel,
    code: "CHANNEL_ROWS_UNPROJECTABLE",
    message: `a message in ${channel} is not one the window can vouch for: ${errorMessage({ error: cause })}`,
  }),
  workspaceMismatch: ({
    channel,
    asked,
    readIn,
  }: {
    channel: string;
    asked: string;
    readIn: string;
  }): WorkspaceMismatchError => ({
    asked,
    channel,
    code: "WORKSPACE_MISMATCH",
    message: `the link names ${channel} in ${asked}, but the Slack token reads ${readIn}, so the window will not draw another workspace's channel under that name`,
    readIn,
  }),
} as const;
