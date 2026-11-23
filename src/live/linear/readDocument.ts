/** One Linear document's node, read now — what a document comment anchors itself against. */

import { LinearDocument } from "@linear/sdk";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type LinearLiveError, LinearLiveErrors } from "./errors.js";
import type { LinearReadRequest } from "./read.js";

/** The SDK's own document query, which selects `id`, `documentContentId` and `content` among the rest. */
const DOCUMENT_QUERY = String(LinearDocument.DocumentDocument);

/**
 * Read one Linear document's node by id or slug id — what a document comment needs to anchor itself: the
 * canonical `id`, the `documentContentId` a comment attaches to and the current `content` a quoted passage must
 * be found in.
 *
 * @param id the document's id or slug id
 * @param request the shared safe GraphQL transport
 * @returns the provider's document node untouched, or a named read failure
 */
export async function readLinearDocument({
  id,
  request,
}: {
  id: string;
  request: LinearReadRequest;
}): Promise<Result<Record<string, unknown>, LinearLiveError>> {
  const response = await request({ query: DOCUMENT_QUERY, variables: { id } });
  if (response.isErr()) {
    return err(response.error);
  }
  const node = isRecord(response.value) ? response.value["document"] : undefined;
  if (!isRecord(node)) {
    return err(LinearLiveErrors.notFound({ identity: id, kind: "document" }));
  }
  return ok(node);
}
