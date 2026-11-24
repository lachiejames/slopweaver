/**
 * The write half of the live copy's snapshot store (`./liveSnapshotStore.ts`, which holds the layout and every read):
 * one conversation's whole body held under its own hash, then the manifest naming it, then the body it replaced
 * removed. The manifest is written last, so a manifest never names half-written bytes, and the owner's protect list
 * is judged over the conversation's whole directory before any of it (`../corpusAccessGuard.ts`).
 */
import { createHash } from "node:crypto";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic, writeFileAtomicStream } from "#lib/writeAtomic.js";
import type { OwnerProtectionResolver } from "../bronzeProtection.js";
import { preflightCorpusAccesses } from "../corpusAccessGuard.js";
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
 * @param home the Slopweaver home whose protect registry applies, beside the account's own
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the manifest now current, or the refusal
 */
export function writeLiveSnapshot({
  root,
  conversationId,
  elementText,
  bodyUpdatedIso,
  listedUpdatedIso,
  fetchedAtIso,
  home,
  protection,
}: {
  root: string;
  conversationId: string;
  elementText: string;
  bodyUpdatedIso: string | null;
  listedUpdatedIso: string | null;
  fetchedAtIso: string;
  home: string;
  protection?: OwnerProtectionResolver | undefined;
}): Result<LiveSnapshotManifest, ChatgptSnapshotError> {
  const directory = conversationDir({ conversationId, root });
  if (!CHATGPT_CONVERSATION_ID.test(conversationId)) {
    return err(ChatgptSnapshotErrors.writeFailed({ detail: "not a conversation id", path: snapshotsDir({ root }) }));
  }
  // The manifest read, the new body, the manifest and the replaced body all sit in this one directory.
  const judged = preflightCorpusAccesses({
    accesses: [{ access: "tree-write", path: directory }],
    home,
    operation: { target: directory, verb: "hold the live snapshot in" },
    protection,
  });
  if (judged.isErr()) {
    return err(ChatgptSnapshotErrors.protectedPath({ lines: judged.error }));
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
  const written = writeBodyThenManifest({ chunks, directory, manifest });
  if (written.isErr()) {
    return err(written.error);
  }
  removeReplacedBody({ bodyHash, conversationId, directory, replaced: previous.value?.bodyHash, root });
  return ok(manifest);
}

/**
 * Write the body under its own hash, then the manifest naming it, both private, so a manifest never names half-written
 * bytes.
 *
 * @param chunks the body's text, in order
 * @param directory the conversation's snapshot directory
 * @param manifest the manifest to publish once the body is down
 * @returns nothing, or the refusal naming the directory
 */
function writeBodyThenManifest({
  chunks,
  directory,
  manifest,
}: {
  chunks: readonly string[];
  directory: string;
  manifest: LiveSnapshotManifest;
}): Result<void, ChatgptSnapshotError> {
  try {
    writeFileAtomicStream({
      dirMode: 0o700,
      fileMode: 0o600,
      path: join(directory, `${manifest.bodyHash}.json`),
      produce: ({ write }) => {
        for (const text of chunks) {
          write({ text });
        }
      },
    });
    const contents = `${JSON.stringify(manifest)}\n`;
    writeFileAtomic({ contents, dirMode: 0o700, fileMode: 0o600, path: join(directory, "manifest.json") });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return err(ChatgptSnapshotErrors.writeFailed({ detail, path: directory }));
  }
  return ok(undefined);
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
