/**
 * Typed failures for the Slack crawl's two secondary resume stores — the per-channel backfill watermarks
 * (`./channelWatermark.ts`) and the thread cursors (`./threadCursors.ts`). Bounded to those two writes: it is not a
 * variant of `./errors.ts`'s `SlackFetchError`, which covers workspace discovery, a different failure entirely.
 *
 * Two variants rather than one, because the refresh run reports each store's failure under its own name and a
 * reader deciding which resume store to repair needs to know which one did not land.
 */

/** The per-channel watermark file could not be written. */
export interface SlackChannelWatermarkWriteError {
  readonly code: "CHANNEL_WATERMARK_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** The thread-cursor file could not be written. */
export interface SlackThreadCursorsWriteError {
  readonly code: "THREAD_CURSORS_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** Every failure writing one of the crawl's secondary resume stores. */
export type SlackCursorWriteError = SlackChannelWatermarkWriteError | SlackThreadCursorsWriteError;

/** The factory every failure here is built through, so a test constructs one the way the code does. */
export const SlackCursorWriteErrors = {
  channelWatermarkFailed: ({ path, cause }: { path: string; cause: unknown }): SlackChannelWatermarkWriteError => ({
    cause,
    code: "CHANNEL_WATERMARK_WRITE_FAILED",
    message: cause instanceof Error ? cause.message : `failed to write per-channel watermark ${path}`,
    path,
  }),
  threadCursorsFailed: ({ path, cause }: { path: string; cause: unknown }): SlackThreadCursorsWriteError => ({
    cause,
    code: "THREAD_CURSORS_WRITE_FAILED",
    message: cause instanceof Error ? cause.message : `failed to write ${path}`,
    path,
  }),
} as const;
