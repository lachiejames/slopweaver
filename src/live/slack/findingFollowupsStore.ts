/**
 * Persistence for the `slack finding-followups` document: one file, replaced atomically on every `--write`, exactly as
 * `./awaitingStore.ts` keeps its sibling — a snapshot the seated chase session reads, never a log.
 */

import type { IngestError } from "../../lib/ingestError.js";
import type { Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { type FindingFollowupsDocument, renderFindingFollowupsJson } from "./findingFollowupsDocument.js";

/**
 * Atomically replace `live/slack/finding-followups.json` under the given home with this document.
 *
 * @param document the document to persist
 * @param home the state home to write under
 * @returns the path written, or the typed filesystem error that stopped it, the previous file still standing
 */
export function writeFindingFollowupsDocument({
  document,
  home,
}: {
  document: FindingFollowupsDocument;
  home: string;
}): Result<{ readonly path: string }, IngestError> {
  const path = stateHomePaths({ home }).live.slack.findingFollowupsJson;
  const contents = `${renderFindingFollowupsJson({ document })}\n`;
  return safeFs({
    execute: () => {
      writeFileAtomic({ contents, path });
      return { path };
    },
    operation: "writeFindingFollowupsDocument",
    path,
  });
}
