/**
 * The wrap at a real local destination: written in plaintext beside the backups, chosen by the backup's own
 * manifest header, and the one way a destination backup opens with the master password.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { encryptingTransport } from "../../../store/backup/encryptingTransport.js";
import { backupKeyWrapObjectName, wrapBackupKey } from "../../../store/backup/keyWrap.js";
import {
  destinationHasKeyWrap,
  ensureBackupKeyWrap,
  openDestinationBackup,
  writeBackupKeyWrap,
} from "../../../store/backup/keyWrapStore.js";
import { localDirectoryTransport } from "../../../store/backup/localDirectoryTransport.js";
import { keyFingerprint } from "../../../store/backup/objectCrypto.js";
import { newestBackupPrefix } from "../../../store/backup/rehearsalSource.js";

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const PASSWORD = "abcdefghijklmnopqrstuvwxyz";
const PROJECT = "slopweaver";
const PREFIX = "slopweaver/2026-11-07T03-00-00-000Z/";

const dirs: string[] = [];

/**
 * A fresh directory removed after the test.
 *
 * @returns its path
 */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-key-wrap-store-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/**
 * A destination holding one backup's manifest, encrypted under `key`.
 *
 * @param key the key the manifest is written under
 * @returns the destination root and its plain transport
 */
async function destinationWithManifest({ key }: { key: Buffer }): Promise<{
  root: string;
  transport: ReturnType<typeof localDirectoryTransport>;
}> {
  const root = scratch();
  const transport = localDirectoryTransport({ root, rootPolicy: "create" });
  const local = join(scratch(), "manifest.json");
  writeFileSync(local, '{"version":3}');
  unwrap(
    await encryptingTransport({ inner: transport, key }).transport.upload({
      objectName: `${PREFIX}manifest.json`,
      path: local,
    }),
  );
  return { root, transport };
}

/**
 * Each test key's wrap under {@link PASSWORD}, sealed ONCE for every case whose subject is reading a wrap rather
 * than writing one. A seal is one scrypt at N=2^17 (~230ms a case measured here); every `writeBackupKeyWrap` case
 * still seals through the writer, and so does the one write-then-open round trip.
 */
const sealedWraps = new Map<Buffer, Buffer>();

beforeAll(() => {
  for (const key of [KEY, OTHER_KEY]) {
    sealedWraps.set(key, unwrap(wrapBackupKey({ key, password: PASSWORD })));
  }
});

/**
 * Put one key's shared wrap at the destination exactly where, and byte for byte as, `writeBackupKeyWrap` puts it.
 *
 * @param key which test key's wrap
 * @param transport the PLAIN destination
 */
async function plantWrap({
  key,
  transport,
}: {
  key: Buffer;
  transport: ReturnType<typeof localDirectoryTransport>;
}): Promise<void> {
  const local = join(scratch(), "key.wrap");
  writeFileSync(local, sealedWraps.get(key)!);
  unwrap(
    await transport.upload({
      objectName: backupKeyWrapObjectName({ fingerprint: keyFingerprint({ key }), project: PROJECT }),
      path: local,
    }),
  );
}

describe("writeBackupKeyWrap", () => {
  it("writes the wrap in plaintext at <project>/keys/<fingerprint>.wrap", async () => {
    const { root, transport } = await destinationWithManifest({ key: KEY });
    const stored = unwrap(await writeBackupKeyWrap({ key: KEY, password: PASSWORD, project: PROJECT, transport }));
    const fingerprint = keyFingerprint({ key: KEY });
    expect(stored.name).toBe(`slopweaver/keys/${fingerprint}.wrap`);
    expect(
      readFileSync(join(root, PROJECT, "keys", `${fingerprint}.wrap`))
        .subarray(0, 23)
        .toString("utf8"),
    ).toBe("SLOPWEAVER-BACKUP-KEY-1");
  });

  it("keeps two keys' wraps side by side", async () => {
    const { transport } = await destinationWithManifest({ key: KEY });
    unwrap(await writeBackupKeyWrap({ key: KEY, password: PASSWORD, project: PROJECT, transport }));
    unwrap(await writeBackupKeyWrap({ key: OTHER_KEY, password: PASSWORD, project: PROJECT, transport }));
    expect(unwrap(await transport.list({ prefix: "slopweaver/keys/" }))).toEqual(
      [keyFingerprint({ key: KEY }), keyFingerprint({ key: OTHER_KEY })]
        .toSorted()
        .map((fp) => `slopweaver/keys/${fp}.wrap`),
    );
  });

  it("refuses a short password and writes nothing", async () => {
    const { root, transport } = await destinationWithManifest({ key: KEY });
    const refused = unwrapErr(await writeBackupKeyWrap({ key: KEY, password: "short", project: PROJECT, transport }));
    expect(refused.code).toBe("KEY_WRAP_PASSWORD_TOO_SHORT");
    expect(existsSync(join(root, PROJECT, "keys"))).toBe(false);
  });

  it("is never read as a backup by the newest-backup listing", async () => {
    const { transport } = await destinationWithManifest({ key: KEY });
    unwrap(await writeBackupKeyWrap({ key: KEY, password: PASSWORD, project: PROJECT, transport }));
    const names = unwrap(await transport.list({ prefix: `${PROJECT}/` }));
    expect(names.some((name) => name.startsWith("slopweaver/keys/"))).toBe(true);
    expect(newestBackupPrefix({ objectNames: names, project: PROJECT })).toBe(PREFIX);
  });
});

describe("ensureBackupKeyWrap", () => {
  it("returns a scratch directory it cannot make as a failure naming the wrap, and writes nothing", async () => {
    const { root, transport } = await destinationWithManifest({ key: KEY });
    const objectName = `slopweaver/keys/${keyFingerprint({ key: KEY })}.wrap`;
    const sandboxTmp = process.env["TMPDIR"];
    process.env["TMPDIR"] = join(root, "no-such-temp-directory");
    const refused = await (async () => {
      try {
        return unwrapErr(await ensureBackupKeyWrap({ key: KEY, password: PASSWORD, project: PROJECT, transport }));
      } finally {
        process.env["TMPDIR"] = sandboxTmp;
      }
    })();
    expect(refused.code).toBe("KEY_WRAP_TRANSPORT_FAILED");
    expect(refused.message).toContain(objectName);
    expect(refused.message).toContain("no private scratch directory could be made");
    expect(existsSync(join(root, PROJECT, "keys"))).toBe(false);
  });

  it("returns a downloaded wrap that vanished before it was read as a failure naming the wrap, not a throw", async () => {
    const { transport: inner } = await destinationWithManifest({ key: KEY });
    const objectName = `slopweaver/keys/${keyFingerprint({ key: KEY })}.wrap`;
    await plantWrap({ key: KEY, transport: inner });
    const transport = { ...inner, download: async () => ok(undefined) };
    const refused = unwrapErr(await ensureBackupKeyWrap({ key: KEY, password: PASSWORD, project: PROJECT, transport }));
    expect(refused.code).toBe("KEY_WRAP_TRANSPORT_FAILED");
    expect(refused.message).toContain(objectName);
    expect(refused.message).toContain("a scratch file could not be used");
  });
});

describe("destinationHasKeyWrap", () => {
  it("says whether this key's wrap is there", async () => {
    const { transport } = await destinationWithManifest({ key: KEY });
    const fingerprint = keyFingerprint({ key: KEY });
    expect(unwrap(await destinationHasKeyWrap({ fingerprint, project: PROJECT, transport }))).toBe(false);
    await plantWrap({ key: KEY, transport });
    expect(unwrap(await destinationHasKeyWrap({ fingerprint, project: PROJECT, transport }))).toBe(true);
  });

  it("counts a wrap filed in another case as there, so a write never replaces it on a case-insensitive volume", async () => {
    const { root, transport } = await destinationWithManifest({ key: KEY });
    const fingerprint = keyFingerprint({ key: KEY });
    mkdirSync(join(root, PROJECT, "keys"), { recursive: true });
    writeFileSync(join(root, PROJECT, "keys", `${fingerprint.toUpperCase()}.wrap`), "planted");
    expect(fingerprint.toUpperCase()).not.toBe(fingerprint);
    expect(unwrap(await destinationHasKeyWrap({ fingerprint, project: PROJECT, transport }))).toBe(true);
  });

  it("does not count another key's wrap", async () => {
    const { transport } = await destinationWithManifest({ key: KEY });
    await plantWrap({ key: OTHER_KEY, transport });
    const fingerprint = keyFingerprint({ key: KEY });
    expect(unwrap(await destinationHasKeyWrap({ fingerprint, project: PROJECT, transport }))).toBe(false);
  });
});

describe("openDestinationBackup", () => {
  it("opens the backup with the password alone and reads its manifest back", async () => {
    const { transport } = await destinationWithManifest({ key: KEY });
    unwrap(await writeBackupKeyWrap({ key: KEY, password: PASSWORD, project: PROJECT, transport }));
    const opened = unwrap(
      await openDestinationBackup({ password: PASSWORD, prefix: PREFIX, project: PROJECT, transport }),
    );
    expect(opened.fingerprint).toBe(keyFingerprint({ key: KEY }));
    expect(opened.key.equals(KEY)).toBe(true);
    const target = join(scratch(), "manifest.json");
    unwrap(await opened.destination.transport.download({ objectName: `${PREFIX}manifest.json`, path: target }));
    expect(readFileSync(target, "utf8")).toBe('{"version":3}');
  });

  it("picks the wrap the manifest's header names when two keys are wrapped", async () => {
    const { transport } = await destinationWithManifest({ key: OTHER_KEY });
    await plantWrap({ key: KEY, transport });
    await plantWrap({ key: OTHER_KEY, transport });
    const opened = unwrap(
      await openDestinationBackup({ password: PASSWORD, prefix: PREFIX, project: PROJECT, transport }),
    );
    expect(opened.key.equals(OTHER_KEY)).toBe(true);
  });

  it("refuses a destination holding no wrap for that key, naming the verb that writes one", async () => {
    const { transport } = await destinationWithManifest({ key: KEY });
    const refused = unwrapErr(
      await openDestinationBackup({ password: PASSWORD, prefix: PREFIX, project: PROJECT, transport }),
    );
    expect(refused.code).toBe("KEY_WRAP_ABSENT");
    expect(refused.message).toContain("slopweaver store backup --create-master-password");
  });

  it("refuses a wrong password", async () => {
    const { transport } = await destinationWithManifest({ key: KEY });
    await plantWrap({ key: KEY, transport });
    const refused = unwrapErr(
      await openDestinationBackup({ password: "z".repeat(26), prefix: PREFIX, project: PROJECT, transport }),
    );
    expect(refused.code).toBe("KEY_WRAP_WRONG_PASSWORD");
  });
});
