/**
 * The live copy of the owner's ChatGPT history on disk: one snapshot per conversation, each the whole conversation as
 * the web session answered it, held where `refresh` reads it beside every held export (`conversationInput.ts`).
 *
 * ```text
 * <CorpusPaths.chatgptLive>/snapshots/<conversation id>/
 *   manifest.json   which body is current, its size and hash, and the instants it was listed and read at
 *   <sha256>.json   the body: a JSON array of ONE conversation, so it reads through the export's own element reader
 * ```
 *
 * **The manifest is written last** (`liveSnapshotWrite.ts`, the one writer). A body is written whole under its own hash, then the manifest naming it replaces
 * the old one atomically, then the body it replaced is removed. A crash leaves at worst an unnamed body beside a
 * manifest still naming the previous one, which every read ignores, so a manifest never names half-written bytes. A
 * first write that dies before its manifest leaves a directory with no manifest at all: it holds no snapshot, reads
 * as not held, and the next live sync reads that chat again. Only a GENUINELY absent manifest reads that way.
 *
 * **A snapshot that does not stand refuses the whole live copy.** A manifest that will not read, a body missing,
 * resized or rehashed, or a directory naming another conversation is never passed over: that snapshot may be its
 * conversation's latest version, and passing it over would let an older export copy stand in for it.
 *
 * Every body is hashed on every read, the cost of that refusal: there is no verified index here, unlike the export
 * path's (`heldVerification.ts`), because the ingest reads every body whole straight after anyway.
 *
 * Not backed up: like the raw exports, the live copy sits outside the encrypted backup's file roots
 * (`store/backup/plan.ts`); the projected bronze it writes is backed up.
 */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { isAbsentError } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";
import { hashFile } from "./exportIntegrity.js";
import { parseSmallJson } from "./exportReceipts.js";
import { CHATGPT_CONVERSATION_ID } from "./exportSchema.js";
import { type ChatgptSnapshotError, ChatgptSnapshotErrors } from "./liveSnapshotStore.errors.js";

/** A manifest is a few hundred bytes; one past this is not one this writes. */
const MAX_MANIFEST_BYTES = 4096;

const SHA256_HEX = /^[0-9a-f]{64}$/;

const manifestSchema = z.strictObject({
  bodyHash: z.string().regex(SHA256_HEX),
  /** When the conversation last moved, as its own body says; `null` when it carries no instant. */
  bodyUpdatedIso: z.string().nullable(),
  bytes: z.number().int().nonnegative(),
  conversationId: z.string().regex(CHATGPT_CONVERSATION_ID),
  fetchedAtIso: z.string(),
  /** When the listing said the conversation last moved; `null` when it was read without one. */
  listedUpdatedIso: z.string().nullable(),
  schemaVersion: z.literal(1),
});

/** What one conversation's manifest records. */
export type LiveSnapshotManifest = z.infer<typeof manifestSchema>;

/** One held snapshot: its manifest, and the body file it names. */
export interface HeldLiveSnapshot {
  readonly manifest: LiveSnapshotManifest;
  readonly file: string;
}

/**
 * Where every conversation's directory sits.
 *
 * @param root the live copy's root
 * @returns the directory holding one directory per conversation
 */
export function snapshotsDir({ root }: { root: string }): string {
  return join(root, "snapshots");
}

/**
 * One conversation's directory.
 *
 * @param root the live copy's root
 * @param conversationId whose directory
 * @returns the directory holding its manifest and body
 */
export function conversationDir({ root, conversationId }: { root: string; conversationId: string }): string {
  return join(snapshotsDir({ root }), conversationId);
}

/** The manifest at a path, or the line saying why it does not stand. */
function readManifestAt({ path }: { path: string }): { manifest: LiveSnapshotManifest } | { problem: string } {
  let text: string;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) {
      return { problem: `${path} is not a manifest this writes` };
    }
    text = readFileSync(path, "utf8");
  } catch (error: unknown) {
    return { problem: `${path} will not read (${error instanceof Error ? error.message : String(error)})` };
  }
  const parsed = manifestSchema.safeParse(parseSmallJson({ text }));
  if (!parsed.success) {
    return { problem: `${path} is not a manifest this writes` };
  }
  return { manifest: parsed.data };
}

/**
 * One conversation's current manifest, so a live sync can tell whether the listing moved past what is held.
 *
 * @param root the live copy's root, `CorpusPaths.chatgptLive`
 * @param conversationId whose snapshot to look up
 * @returns the manifest, `undefined` when none is held, or the refusal when one is held and does not read
 */
export function readLiveManifest({
  root,
  conversationId,
}: {
  root: string;
  conversationId: string;
}): Result<LiveSnapshotManifest | undefined, ChatgptSnapshotError> {
  const path = join(conversationDir({ conversationId, root }), "manifest.json");
  try {
    lstatSync(path);
  } catch (error: unknown) {
    if (isAbsentError({ error, path })) {
      return ok(undefined);
    }
    const detail = error instanceof Error ? error.message : String(error);
    return err(ChatgptSnapshotErrors.unreadable({ problems: [`${path} will not read (${detail})`], root }));
  }
  const read = readManifestAt({ path });
  if ("problem" in read) {
    return err(ChatgptSnapshotErrors.unreadable({ problems: [read.problem], root }));
  }
  return ok(read.manifest);
}

/** Whether a path is a directory, genuinely absent, or neither — the line naming why, for the last. */
function directoryState({ path }: { path: string }): "directory" | "absent" | { problem: string } {
  try {
    return lstatSync(path).isDirectory() ? "directory" : { problem: `${path} is not a directory` };
  } catch (error: unknown) {
    if (isAbsentError({ error, path })) {
      return "absent";
    }
    return { problem: `${path} will not read (${error instanceof Error ? error.message : String(error)})` };
  }
}

/**
 * Every conversation directory name under the live copy, sorted — empty only when the live copy is genuinely not
 * there. Anything else that stops the listing (a permission, a link, a file where a directory belongs) refuses, since
 * an unreadable live copy may hold any conversation's latest version.
 */
function heldNames({ root }: { root: string }): Result<readonly string[], ChatgptSnapshotError> {
  const directory = snapshotsDir({ root });
  for (const path of [root, directory]) {
    const state = directoryState({ path });
    if (state === "absent") {
      return ok([]);
    }
    if (state !== "directory") {
      return err(ChatgptSnapshotErrors.unreadable({ problems: [state.problem], root }));
    }
  }
  try {
    return ok(readdirSync(directory).toSorted());
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return err(ChatgptSnapshotErrors.unreadable({ problems: [`${directory} will not list (${detail})`], root }));
  }
}

/**
 * Whether a conversation directory holds no manifest at all: what a write leaves when it dies after its body landed
 * and before the manifest naming it did. The manifest is what commits a snapshot, so such a directory holds no
 * snapshot. It reads as not held, the next live sync reads that chat again, and its write publishes over the residue.
 * Only genuine absence counts; a manifest that cannot be stat'ed for any other reason is a problem, not residue.
 *
 * @returns true when manifest.json is genuinely absent, false when something is there, or the line naming the fault
 */
function manifestAbsent({ directory }: { directory: string }): { absent: boolean } | { problem: string } {
  const path = join(directory, "manifest.json");
  try {
    lstatSync(path);
  } catch (error: unknown) {
    if (isAbsentError({ error, path })) {
      return { absent: true };
    }
    return { problem: `${path} will not read (${error instanceof Error ? error.message : String(error)})` };
  }
  return { absent: false };
}

/**
 * Why the body a manifest names does not stand by a stat alone, or `undefined` when it is a file of the size named.
 *
 * @returns the line naming the fault, or `undefined`
 */
function bodySizeProblem({
  directory,
  manifest,
}: {
  directory: string;
  manifest: LiveSnapshotManifest;
}): string | undefined {
  const file = join(directory, `${manifest.bodyHash}.json`);
  try {
    const stat = lstatSync(file);
    if (!stat.isFile()) {
      return `${file} is not a file`;
    }
    if (stat.size !== manifest.bytes) {
      return `${file} no longer holds the bytes its manifest names`;
    }
    return undefined;
  } catch {
    return `${file}, which its manifest names, will not read`;
  }
}

/** Why one held conversation directory does not stand, its snapshot when it does, or nothing when it holds none. */
function checkConversation({
  root,
  name,
}: {
  root: string;
  name: string;
}): { snapshot: HeldLiveSnapshot } | { problem: string } | { uncommitted: true } {
  const directory = conversationDir({ conversationId: name, root });
  if (!CHATGPT_CONVERSATION_ID.test(name)) {
    return { problem: `${directory} is not named for a conversation` };
  }
  let isDirectory: boolean;
  try {
    isDirectory = lstatSync(directory).isDirectory();
  } catch (error: unknown) {
    return { problem: `${directory} will not read (${error instanceof Error ? error.message : String(error)})` };
  }
  if (!isDirectory) {
    return { problem: `${directory} is not a directory` };
  }
  const absent = manifestAbsent({ directory });
  if ("problem" in absent) {
    return absent;
  }
  if (absent.absent) {
    return { uncommitted: true };
  }
  const read = readManifestAt({ path: join(directory, "manifest.json") });
  if ("problem" in read) {
    return read;
  }
  const { manifest } = read;
  if (manifest.conversationId !== name) {
    return { problem: `${directory}'s manifest names conversation ${manifest.conversationId}` };
  }
  const file = join(directory, `${manifest.bodyHash}.json`);
  let bytes: number;
  const hash = createHash("sha256");
  try {
    if (!lstatSync(file).isFile()) {
      return { problem: `${file} is not a file` };
    }
    bytes = hashFile({ hash, path: file });
  } catch {
    return { problem: `${file}, which its manifest names, will not read` };
  }
  if (bytes !== manifest.bytes || hash.digest("hex") !== manifest.bodyHash) {
    return { problem: `${file} no longer holds the bytes its manifest names` };
  }
  return { snapshot: { file, manifest } };
}

/** One held directory's manifest, read without hashing its body; why it does not stand; or nothing when uncommitted. */
function heldManifestOf({
  root,
  name,
}: {
  root: string;
  name: string;
}): { manifest: LiveSnapshotManifest } | { problem: string } | { uncommitted: true } {
  const directory = conversationDir({ conversationId: name, root });
  if (!CHATGPT_CONVERSATION_ID.test(name)) {
    return { problem: `${directory} is not named for a conversation` };
  }
  const absent = manifestAbsent({ directory });
  if ("problem" in absent) {
    return absent;
  }
  if (absent.absent) {
    return { uncommitted: true };
  }
  const read = readManifestAt({ path: join(directory, "manifest.json") });
  if ("problem" in read) {
    return read;
  }
  if (read.manifest.conversationId !== name) {
    return { problem: `${directory}'s manifest names another conversation` };
  }
  const body = bodySizeProblem({ directory, manifest: read.manifest });
  if (body !== undefined) {
    return { problem: body };
  }
  return read;
}

/**
 * Every held conversation's manifest, by conversation id, read without hashing any body: what a live sync weighs the
 * listing against, and what the resync roster reads. A manifest that does not read refuses, exactly as
 * {@link heldLiveSnapshots} would, and so does one whose body is missing, not a file, or not the size it names: a
 * manifest is never trusted as holding a chat its body does not. Only the hash goes unchecked here, so a body corrupted
 * at the same size passes this and is refused by {@link heldLiveSnapshots} when refresh reads it.
 *
 * @param root the live copy's root, `CorpusPaths.chatgptLive`
 * @returns the manifests, empty when none is held, or the refusal naming every one that does not read
 */
export function heldLiveManifests({
  root,
}: {
  root: string;
}): Result<ReadonlyMap<string, LiveSnapshotManifest>, ChatgptSnapshotError> {
  const names = heldNames({ root });
  if (names.isErr()) {
    return err(names.error);
  }
  const manifests = new Map<string, LiveSnapshotManifest>();
  const problems: string[] = [];
  for (const name of names.value) {
    const held = heldManifestOf({ name, root });
    if ("problem" in held) {
      problems.push(held.problem);
    } else if ("manifest" in held) {
      manifests.set(name, held.manifest);
    }
  }
  if (problems.length > 0) {
    return err(ChatgptSnapshotErrors.unreadable({ problems, root }));
  }
  return ok(manifests);
}

/**
 * Every held snapshot, each checked against its manifest, in conversation-id order.
 *
 * @param root the live copy's root, `CorpusPaths.chatgptLive`
 * @returns the snapshots, empty when none is held, or the refusal naming every one that does not stand
 */
export function heldLiveSnapshots({
  root,
}: {
  root: string;
}): Result<readonly HeldLiveSnapshot[], ChatgptSnapshotError> {
  const names = heldNames({ root });
  if (names.isErr()) {
    return err(names.error);
  }
  const snapshots: HeldLiveSnapshot[] = [];
  const problems: string[] = [];
  for (const name of names.value) {
    const checked = checkConversation({ name, root });
    if ("problem" in checked) {
      problems.push(checked.problem);
    } else if ("snapshot" in checked) {
      snapshots.push(checked.snapshot);
    }
  }
  if (problems.length > 0) {
    return err(ChatgptSnapshotErrors.unreadable({ problems, root }));
  }
  return ok(snapshots);
}
