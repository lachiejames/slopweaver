/**
 * Persistence for the `gmail triage` document: one file, replaced atomically on every `--write`, the way
 * `../slack/awaitingStore.ts` keeps its sibling — a snapshot the seated inbox-triage session reads, never a log.
 *
 * It holds sender addresses and subjects, never a body or a snippet — still mail content, so it is written `0600` in
 * a `0700` directory exactly as the attachments beside it are (`docs/security/mail-boundary.md`). The directory is
 * TIGHTENED on every write, not only made that way: `mkdir`'s mode reaches a directory it creates and nothing else.
 */
import { chmodSync } from "node:fs";
import { dirname } from "node:path";
import type { IngestError } from "../../lib/ingestError.js";
import type { Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { ensureDirectory, writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import type { GmailTriageDocument } from "./triage.js";
import { renderGmailTriageJson } from "./triageRender.js";

/**
 * Atomically replace `live/gmail/triage.json` under the given home with this document.
 *
 * @param document the document to persist
 * @param home the state home to write under
 * @returns the path written, or the typed filesystem error that stopped it, the previous file still standing
 */
export function writeGmailTriageDocument({
  document,
  home,
}: {
  document: GmailTriageDocument;
  home: string;
}): Result<{ readonly path: string }, IngestError> {
  const path = stateHomePaths({ home }).live.gmail.triageJson;
  const contents = `${renderGmailTriageJson({ document })}\n`;
  return safeFs({
    execute: () => {
      ensureDirectory({ directory: dirname(path) });
      chmodSync(dirname(path), 0o700);
      writeFileAtomic({ contents, fileMode: 0o600, path });
      return { path };
    },
    operation: "writeGmailTriageDocument",
    path,
  });
}
