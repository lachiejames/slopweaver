/**
 * Persistence for the `slack awaiting` document: one file, replaced atomically on every `--write`, exactly as
 * `./owedStore.ts` keeps its sibling — a snapshot the seated chase session reads, never a log.
 */

import type { IngestError } from "../../lib/ingestError.js";
import type { Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { renderSlackAwaitingJson, type SlackAwaitingDocument } from "./awaitingDocument.js";

/**
 * Atomically replace `live/slack/awaiting.json` under the given home with this document.
 *
 * @param document the document to persist
 * @param home the state home to write under
 * @returns the path written, or the typed filesystem error that stopped it, the previous file still standing
 */
export function writeSlackAwaitingDocument({
  document,
  home,
}: {
  document: SlackAwaitingDocument;
  home: string;
}): Result<{ readonly path: string }, IngestError> {
  const path = stateHomePaths({ home }).live.slack.awaitingJson;
  const contents = `${renderSlackAwaitingJson({ document })}\n`;
  return safeFs({
    execute: () => {
      writeFileAtomic({ contents, path });
      return { path };
    },
    operation: "writeSlackAwaitingDocument",
    path,
  });
}
