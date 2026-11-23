/**
 * The shared world of the `backupRun*.test.ts` files — a sandbox home, a fixed backup key, a stack that writes
 * known bytes, and the helpers that plant and open encrypted objects in a destination directory. Every effect
 * is a seam handed in; nothing here reaches Docker, the Keychain or a clock.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ok, unwrap } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { encryptingTransport } from "../../../store/backup/encryptingTransport.js";
import { walkBackedUpFiles } from "../../../store/backup/files.js";
import {
  LocalDestinationErrors,
  type LocalObjectWriteFailedError,
} from "../../../store/backup/localDestinationErrors.js";
import {
  decryptObjectFile,
  encryptObjectFile,
  keyFingerprint,
  OBJECT_SCHEME,
} from "../../../store/backup/objectCrypto.js";
import { BACKUP_FILES, blobObjectName, SUPABASE_PROJECT_ID } from "../../../store/backup/plan.js";
import type { BackupDeps } from "../../../store/backup/run.js";
import { digestFile } from "../../../store/backup/stack.js";
import type { BackupTransport } from "../../../store/backup/transport.js";

const homes: string[] = [];

/**
 * A throwaway home holding one bronze window and one lessons file, removed after each test. It sits one level
 * inside its own temp directory so the destination can sit BESIDE it: a destination inside the home is refused.
 *
 * @returns the sandbox home
 */
export function sandboxHome(): string {
  const parent = mkdtempSync(join(tmpdir(), "store-backup-"));
  homes.push(parent);
  const home = join(parent, "home");
  const paths = stateHomePaths({ home });
  const slackBronze = join(paths.corpus.bronze, "slack");
  mkdirSync(slackBronze, { recursive: true });
  writeFileSync(join(slackBronze, "6d_2026-09-08.jsonl"), '{"id":"a"}\n');
  mkdirSync(dirname(paths.knowledgeLessonsJsonl), { recursive: true });
  writeFileSync(paths.knowledgeLessonsJsonl, '{"lesson":"x"}\n');
  return home;
}

/**
 * The destination a test writes to: beside the sandbox home, inside the same removed temp directory.
 *
 * @param home the sandbox home
 * @returns the destination root
 */
export function besideHome({ home }: { home: string }): string {
  return join(dirname(home), "destination");
}

/**
 * Removes every sandbox home made since the last call; each test file runs it from its own `afterEach`.
 *
 * @returns nothing
 */
export function removeSandboxHomes(): void {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
}

/** The fixed backup key every test encrypts under — never the real Keychain's. */
export const KEY = Buffer.alloc(32, 7);

/** What a receipt records about how the destination's objects were encrypted under {@link KEY}. */
export const ENCRYPTION = { keyFingerprint: keyFingerprint({ key: KEY }), scheme: OBJECT_SCHEME } as const;

/** What the fake Vault leg seals: fixed bytes standing in for `vault.enc`. */
export const FAKE_VAULT_BYTES = Buffer.from("fake sealed vault bytes");

/** A stack whose dump, tar and sealed Vault are known strings, over a home holding two backed-up files. */
export const FAKE_STACK: BackupDeps = {
  digestFile,
  walkBackedUpFiles: ({ home, protection }) => walkBackedUpFiles({ home, protection }),
  dumpDatabase: ({ path }) => {
    writeFileSync(path, "PGDMP fake dump bytes");
    return ok(undefined);
  },
  listExtensions: () => ok([{ name: "pg_trgm", schema: "public" }]),
  pgDumpVersion: () => ok("pg_dump (PostgreSQL) 17.6"),
  sealVault: async ({ directory, key }) => {
    writeFileSync(join(directory, BACKUP_FILES.vault), FAKE_VAULT_BYTES);
    return ok({
      bytes: FAKE_VAULT_BYTES.length,
      keyFingerprint: keyFingerprint({ key }),
      rows: 0,
      sha256: sha256Of({ bytes: FAKE_VAULT_BYTES }),
    });
  },
  tarStorage: ({ path }) => {
    writeFileSync(path, "fake tar bytes");
    return ok(undefined);
  },
};

/**
 * The digest a blob is named for, computed the same way the walk and the transport compute it.
 *
 * @param bytes the blob's plaintext
 * @returns the hex sha256
 */
export function sha256Of({ bytes }: { bytes: Buffer }): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The object one file's bytes land under, so a test names it the way the code does.
 *
 * @param bytes the file's plaintext
 * @returns the blob's object name
 */
export function blobFor({ bytes }: { bytes: Buffer }): string {
  return blobObjectName({ project: SUPABASE_PROJECT_ID, sha256: sha256Of({ bytes }) });
}

/**
 * The plaintext one stored object opens to under {@link KEY}, decrypted through a scratch file removed after.
 *
 * @param root the destination directory
 * @returns the verified plaintext bytes
 */
export async function storedPlaintext({ root, objectName }: { root: string; objectName: string }): Promise<Buffer> {
  const scratch = mkdtempSync(join(tmpdir(), "stored-object-"));
  try {
    const target = join(scratch, "plaintext");
    unwrap(await decryptObjectFile({ key: KEY, objectName, source: join(root, objectName), target }));
    return readFileSync(target);
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}

/**
 * Put one object into the destination by hand, encrypted under {@link KEY} exactly as a backup would write it,
 * replacing whatever was stored under that name.
 *
 * @param root the destination directory
 * @param bytes the plaintext it holds
 * @returns nothing
 */
export async function plantObject({
  root,
  objectName,
  bytes,
}: {
  root: string;
  objectName: string;
  bytes: Buffer;
}): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), "planted-object-"));
  try {
    const source = join(scratch, "plaintext");
    writeFileSync(source, bytes);
    const target = join(root, objectName);
    mkdirSync(join(target, ".."), { recursive: true });
    rmSync(target, { force: true });
    unwrap(await encryptObjectFile({ key: KEY, objectName, source, target }));
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}

/**
 * The address `store backup` prints for one backup, and `--from` reads back: `<root>/<project>/<instant>`.
 *
 * @param root the destination directory
 * @param instant the backup's directory name
 * @returns the address
 */
export function backupAddress({ root, instant }: { root: string; instant: string }): string {
  return join(root, SUPABASE_PROJECT_ID, instant);
}

/**
 * A plain destination wrapped in the object cipher under {@link KEY}, as a run and a restore each build it: what
 * it writes lands as ciphertext, and what it reads comes back as verified plaintext.
 *
 * @param inner the plain destination
 * @returns the encrypting transport
 */
export function underKey({ inner }: { inner: BackupTransport }): BackupTransport {
  return encryptingTransport({ inner, key: KEY }).transport;
}

/**
 * The failure a destination reports for one write, naming the local file the upload was reading from, so a
 * test can tell which copy — the frozen one — an upload sent.
 *
 * @param root the destination directory
 * @param objectName the object the write was for
 * @param path the local file the upload read
 * @returns the destination's write failure
 */
export function writeFailure({
  root,
  objectName,
  path,
}: {
  root: string;
  objectName: string;
  path: string;
}): LocalObjectWriteFailedError {
  return LocalDestinationErrors.writeFailed({ cause: new Error(`503 while sending ${path}`), objectName, root });
}

/** The store URL every run is handed; the fake stack never dials it. */
export const STORE_URL = "postgresql://postgres:pw@127.0.0.1:55322/postgres";
