/**
 * The write half of the live copy's snapshot store (`./liveSnapshotStore.ts`, which holds the layout and every read):
 * one conversation's whole body held under its own hash, then the manifest naming it, then the body it replaced
 * removed. The manifest is written last, so a manifest never names half-written bytes.
 */
import { createHash } from "node:crypto";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic, writeFileAtomicStream } from "#lib/writeAtomic.js";
import { CHATGPT_CONVERSATION_ID } from "./exportSchema.js";
import { type ChatgptSnapshotError, ChatgptSnapshotErrors } from "./liveSnapshotStore.errors.js";
import { conversationDir, type LiveSnapshotManifest, readLiveManifest, snapshotsDir } from "./liveSnapshotStore.js";

/**
 * Hold one conversation's whole body as its current snapshot: the body under its own hash, then the manifest naming
 * it, then the body it replaced removed. The caller has already parsed `elementText` through the export's reader;
 * this writes exactly those bytes.
 *
 * @param root the live copy's root, `CorpusPaths.chatgptLive`
 * @param conversationId the conversation, already checked against the body's own id
 * @param elementText the conversation's JSON, exactly as the web session answered it
 * @param bodyUpdatedIso when the body says it last moved
 * @param listedUpdatedIso when the listing said it last moved
 * @param fetchedAtIso when the body was read
 * @returns the manifest now current, or the refusal
 */
export function writeLiveSnapshot({
  root,
  conversationId,
  elementText,
  bodyUpdatedIso,
  listedUpdatedIso,
  fetchedAtIso,
}: {
  root: string;
  conversationId: string;
  elementText: string;
  bodyUpdatedIso: string | null;
  listedUpdatedIso: string | null;
  fetchedAtIso: string;
}): Result<LiveSnapshotManifest, ChatgptSnapshotError> {
  const directory = conversationDir({ conversationId, root });
  if (!CHATGPT_CONVERSATION_ID.test(conversationId)) {
    return err(ChatgptSnapshotErrors.writeFailed({ detail: "not a conversation id", path: snapshotsDir({ root }) }));
  }
  const previous = readLiveManifest({ conversationId, root });
  if (previous.isErr()) {
    return err(previous.error);
  }
  const chunks = ["[", elementText, "]\n"];
  const hash = createHash("sha256");
  chunks.forEach((chunk) => hash.update(chunk));
  const bodyHash = hash.digest("hex");
  const manifest: LiveSnapshotManifest = {
    bodyHash,
    bodyUpdatedIso,
    bytes: chunks.reduce((total, chunk) => total + Buffer.byteLength(chunk), 0),
    conversationId,
    fetchedAtIso,
    listedUpdatedIso,
    schemaVersion: 1,
  };
  const bodyPath = join(directory, `${bodyHash}.json`);
  const manifestPath = join(directory, "manifest.json");
  try {
    writeFileAtomicStream({
      dirMode: 0o700,
      fileMode: 0o600,
      path: bodyPath,
      produce: ({ write }) => {
        for (const text of chunks) {
          write({ text });
        }
      },
    });
    writeFileAtomic({ contents: `${JSON.stringify(manifest)}\n`, dirMode: 0o700, fileMode: 0o600, path: manifestPath });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return err(ChatgptSnapshotErrors.writeFailed({ detail, path: directory }));
  }
  removeReplacedBody({ bodyHash, conversationId, directory, replaced: previous.value?.bodyHash, root });
  return ok(manifest);
}

/**
 * Remove the body a write superseded, but only while the manifest still names the body this write put there: a
 * second writer of the same conversation may have published since, even the very body being removed. The residue is
 * the instant between that re-read and the unlink, which `chatgpt live-sync`'s one-run-at-a-time lock closes for the
 * only writer there is.
 */
function removeReplacedBody({
  root,
  conversationId,
  directory,
  bodyHash,
  replaced,
}: {
  root: string;
  conversationId: string;
  directory: string;
  bodyHash: string;
  replaced: string | undefined;
}): void {
  if (replaced === undefined || replaced === bodyHash) {
    return;
  }
  const now = readLiveManifest({ conversationId, root });
  if (now.isErr() || now.value?.bodyHash !== bodyHash) {
    return;
  }
  try {
    unlinkSync(join(directory, `${replaced}.json`));
  } catch {
    // An unnamed body left behind is ignored by every read; removing it is housekeeping, never correctness.
  }
}
