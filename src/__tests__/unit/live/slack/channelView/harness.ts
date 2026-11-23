/*
 * The fixtures more than one live channel-window test file reads: the workspace and read instant every document
 * is drawn at, a picture fetch that records what it was asked for, a lookup no test expects to be called, and a
 * three-message history page. A plain module, not a `*.test.ts`, so no test registers twice. It was split out
 * when the channel-window suite became one file per behaviour.
 */
import { err, ok } from "../../../../../lib/result.js";
import type { LookupSlackFile } from "../../../../../live/slack/blockFiles.js";
import type { FetchPicture } from "../../../../../live/slack/channelMedia.js";
import { SlackFileLookupErrors } from "../../../../../live/slack/fileLookupErrors.js";

/** The synthetic workspace every document is drawn in. */
export const WORKSPACE = "https://acme.slack.com";
/** The instant every document is read at. */
export const OBSERVED = "2026-10-17T01:00:00.000Z";
/** The hash every recorded fetch answers with. */
export const SHA = "a".repeat(64);

/**
 * A fetch that answers every preview with one hash and records what it was asked for, in order.
 *
 * @returns a picture fetch appending `fileId:variant` to `asked` and answering `SHA`
 */
export function recordingFetch({ asked }: { asked: string[] }): FetchPicture {
  return async ({ fileId, variant }) => {
    asked.push(`${fileId}:${variant}`);
    return ok({ sha256: SHA });
  };
}

/**
 * A lookup no test expects to be called.
 *
 * @returns a lookup failure naming the file it was unexpectedly asked for
 */
export const NO_LOOKUP: LookupSlackFile = async ({ fileId }) =>
  err(SlackFileLookupErrors.lookupFailed({ cause: `unexpected lookup of ${fileId}`, fileId }));

/** A history page, newest first: a PDF, a picture posted twice, and an old picture. */
export const PAGE: readonly unknown[] = [
  {
    files: [{ id: "F0PDF", mimetype: "application/pdf", name: "spec.pdf" }],
    text: "the spec <@U0SYNMENTION>",
    ts: "1790000900.000900",
    user: "U0NEW",
  },
  {
    files: [{ id: "F0PIC", mimetype: "image/png", name: "graph.png", thumb_480: "https://files.slack.com/480" }],
    text: "again",
    ts: "1790000500.000500",
    user: "U0MID",
  },
  {
    files: [
      { id: "F0PIC", mimetype: "image/png", name: "graph.png", thumb_480: "https://files.slack.com/480" },
      { id: "F0OLD", mimetype: "image/jpeg", name: "old.jpg", thumb_360: "https://files.slack.com/old-360" },
    ],
    reply_count: 3,
    text: "graphs",
    ts: "1790000100.000100",
    user: "U0OLD",
  },
];
