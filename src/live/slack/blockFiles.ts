/**
 * Turning a Block Kit file REFERENCE into a file we can actually fetch.
 *
 * ## The second channel an attachment arrives through
 *
 * A Block Kit `image` block may name a file as `slack_file: { id }` and nothing else — no entry in the
 * message's top-level `files`, and therefore no `url_private_download`. MEASURED across over a hundred
 * thousand real messages: a handful of such ids, and NONE of them also appeared in `files`. So it is a genuine second channel for an
 * attachment rather than a duplicate of the first, and the file is one the reader can plainly see in Slack.
 *
 * `read-thread` shipped reporting these as a stated skip (`block-referenced-only`). Accounted for, but never
 * retrieved. `files.info` is what closes it: an id in, a `url_private_download` out, after which the file is
 * planned by exactly the same rules as any other attachment — size cap, canvas, tombstone, model-readable —
 * because a file discovered through a block is not a different KIND of file.
 *
 * ## A lookup failure is a stated skip, not a dead read
 *
 * Everywhere else in this verb a failure is fatal, and here it deliberately is not. Before this module these
 * ids were skips; making a `files.info` failure sink the whole thread would mean a token missing `files:read`
 * turns a thread that used to read fine into nothing at all. So the lookup degrades to a skip that names
 * what the provider said — strictly more than the old behaviour reported, and never less.
 *
 * ## `content` is deliberately untouched
 *
 * `files.info` also returns `content` alongside a `content_highlight_html_truncated` flag. This module never
 * reads either. Bytes come from `url_private_download` through the same downloader as every other
 * attachment, so there is no path here on which a truncated inline copy could be mistaken for the file —
 * which for a verb whose entire contract is completeness would be the worst possible place to accept one.
 */

import type { SlackApi } from "../../corpus/slack/fetch.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type SlackFileLookupError, SlackFileLookupErrors } from "./fileLookupErrors.js";
import { projectSlackFile } from "./projection.js";
import type { FileSkipReason, VisibleSlackFile, VisibleSlackMessage } from "./types.js";

/** The injected id→file lookup. One id at a time: `files.info` has no batch form. */
export type LookupSlackFile = (args: { fileId: string }) => Promise<Result<VisibleSlackFile, SlackFileLookupError>>;

/** A block-referenced file the lookup turned into a real file object. */
interface ResolvedBlockFile {
  readonly messageTs: string;
  readonly file: VisibleSlackFile;
}

/** A block-referenced file the lookup could not turn into a file object, with what the provider said. */
interface UnresolvedBlockFile {
  readonly messageTs: string;
  readonly fileId: string;
  readonly reason: FileSkipReason;
  /** The provider's or the projection's own words, so the reader is not left guessing at the cause. */
  readonly detail: string;
}

/** Every block-referenced id, in one lane or the other. Nothing falls between them. */
export interface BlockFileResolution {
  readonly resolved: readonly ResolvedBlockFile[];
  readonly unresolved: readonly UnresolvedBlockFile[];
}

/**
 * Resolve every `slack_file`-only reference across a thread.
 *
 * Serial, and de-duplicated by id: these share the workspace quota, `files.info` is `tier4`, and the same
 * image referenced from two messages is one file. Each message that references it still gets its own entry,
 * because the reader needs to know WHICH message carries the picture.
 *
 * @param messages the projected thread
 * @param lookup the injected `files.info` seam
 * @returns every referenced id, either resolved to a file or accounted for with a reason
 */
export async function resolveBlockFileRefs({
  messages,
  lookup,
}: {
  messages: readonly VisibleSlackMessage[];
  lookup: LookupSlackFile;
}): Promise<BlockFileResolution> {
  const resolved: ResolvedBlockFile[] = [];
  const unresolved: UnresolvedBlockFile[] = [];
  const seen = new Map<string, Result<VisibleSlackFile, SlackFileLookupError>>();
  for (const message of messages) {
    for (const fileId of message.blockFileRefs) {
      const cached = seen.get(fileId);
      const looked = cached ?? (await lookup({ fileId }));
      seen.set(fileId, looked);
      if (looked.isOk()) {
        resolved.push({ file: looked.value, messageTs: message.ts });
      } else {
        unresolved.push({
          detail: looked.error.message,
          fileId,
          messageTs: message.ts,
          reason: "block-lookup-failed",
        });
      }
    }
  }
  return { resolved, unresolved };
}

/**
 * The live `files.info` lookup, over the Slack read seam.
 *
 * A thrown SDK error becomes `err` rather than escaping, for the reason in the module header: a lookup
 * failure must degrade to a stated skip, and it can only do that if it is a value.
 *
 * @param api the Slack read seam, narrowed to the one method this needs
 * @returns the id→file lookup `resolveBlockFileRefs` consumes
 */
export function slackFileLookup({ api }: { api: Pick<SlackApi, "filesInfo"> }): LookupSlackFile {
  return async ({ fileId }) => {
    try {
      const { file } = await api.filesInfo({ fileId });
      // The SAME projector the message's own `files` go through, so a block-discovered file cannot end up
      // with a different notion of "external", "tombstone" or "download URL" from its top-level sibling.
      const projected = projectSlackFile({ raw: file });
      if (projected.isOk()) {
        return ok(projected.value);
      }
      // Re-worded rather than passed through: the projector's sentences say "a message carried …", which is
      // true of its usual caller and false here. A reason that names the wrong source is a small lie in
      // exactly the field a reader consults to find out what went wrong.
      return err(SlackFileLookupErrors.unusableFile({ cause: projected.error, fileId }));
    } catch (error: unknown) {
      return err(SlackFileLookupErrors.lookupFailed({ cause: error, fileId }));
    }
  };
}
