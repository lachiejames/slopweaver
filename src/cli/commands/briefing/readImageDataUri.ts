/**
 * The one reader that turns an image `path` a form carries into the `data:` URI the briefing schema checks —
 * shared by `briefing render`, which embeds it, and `briefing sweep-block`, which validates a proposed form
 * the same way before it writes one.
 */
import { readFileSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";

import { mimeOfPath } from "../../../outbound/briefing/images.js";
import { type BriefingCommandError, BriefingCommandErrors } from "./errors.js";

/**
 * Read one image off disk as a `data:` URI.
 *
 * Size is deliberately NOT checked here — `../../../outbound/briefing/schema.ts`'s `imageSchema` checks every
 * image's decoded byte length uniformly, whether it arrived via `path` or was embedded directly as `data`, so
 * this is the one place that check would otherwise be restated.
 *
 * @param path the image path a composer wrote into the form
 * @returns the `data:` URI to embed, or a refusal naming the path and what went wrong
 */
export function readImageDataUri({ path }: { path: string }): Result<string, BriefingCommandError> {
  const mime = mimeOfPath({ path });
  if (mime === undefined) {
    return err(BriefingCommandErrors.imageExtensionUnsupported({ path }));
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error: unknown) {
    return err(BriefingCommandErrors.fileUnreadable({ cause: error, path, what: "file" }));
  }
  return ok(`data:${mime};base64,${bytes.toString("base64")}`);
}
