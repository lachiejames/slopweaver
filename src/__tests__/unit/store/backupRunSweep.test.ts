/**
 * The sweep of stranded stagings as `runSweepOnly` drives it for ONE destination, and the credentials leg: an earlier
 * staging the destination never got is sent without a new dump, an unreadable manifest is named, and
 * `stageSecretsLeg` seals or refuses. The sweep primitive on its own is in `backupRunSweepStranded.test.ts`; a list
 * of destinations is `backupRunDestinations.test.ts`.
 */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, unwrap, unwrapErr } from "../../../lib/result.js";
import { KeyWrapErrors } from "../../../store/backup/keyWrapErrors.js";
import { openDestinationBackup } from "../../../store/backup/keyWrapStore.js";
import { LocalDestinationErrors } from "../../../store/backup/localDestinationErrors.js";
import { keyFingerprint } from "../../../store/backup/objectCrypto.js";
import { BACKUP_FILES, FILES_MANIFEST } from "../../../store/backup/plan.js";
import { readReceipt } from "../../../store/backup/receipts.js";
import { decryptSecretsBundle } from "../../../store/backup/secretsCrypto.js";
import { stageSecretsLeg } from "../../../store/backup/stageSecrets.js";
import { stagingRoot } from "../../../store/backup/staging.js";
import { StagingSweepErrors } from "../../../store/backup/sweepErrors.js";

import { idsOf, oneNight, sentReport, sweepOnce } from "./backupRunNights.js";
import {
  besideHome,
  FAKE_STACK,
  KEY,
  removeSandboxHomes,
  sandboxHome,
  sha256Of,
  storedPlaintext,
} from "./backupRunWorld.js";
import { directoryTransport } from "./directoryTransport.js";

/** A master password at the 26-character floor. */
const PASSWORD = "abcdefghijklmnopqrstuvwxyz";

/** Where the test key's wrap lands. */
const WRAP_NAME = `slopweaver/keys/${keyFingerprint({ key: KEY })}.wrap`;

afterEach(() => {
  removeSandboxHomes();
});

/**
 * Whether the staging holds a receipt for the destination beside the home.
 *
 * @param home the sandbox home
 * @param directory the staging directory
 * @returns whether a parsed receipt is there
 */
function receipted({ home, directory }: { home: string; directory: string }): boolean {
  return readReceipt({ directory, id: idsOf({ roots: [besideHome({ home })] })[0]! }) !== null;
}

describe("the sweep of stranded stagings", () => {
  it("sends an earlier staging the destination never got, and leaves its receipt behind", async () => {
    const home = sandboxHome();
    const destination = besideHome({ home });
    const stranded = unwrap(await oneNight({ home, key: null, nowIso: "2026-09-20T05:49:58.043Z" }));
    expect(receipted({ directory: stranded.directory, home })).toBe(false);
    const swept = unwrap(await sweepOnce({ home, keepLocal: 5 }));
    expect(swept.sweep.recovered.map((staging) => staging.directory)).toEqual([stranded.directory]);
    expect(swept.sweep.recovered.map((staging) => staging.prefix)).toEqual(["slopweaver/2026-09-20T05-49-58-043Z/"]);
    // A staging this build wrote lists its dump's chunks, so the sweep sends those and never the dump whole.
    expect(swept.sweep.recovered[0]!.objects.map((object) => object.name)).toEqual([
      "slopweaver/2026-09-20T05-49-58-043Z/files.json",
      "slopweaver/2026-09-20T05-49-58-043Z/storage.tar",
      "slopweaver/2026-09-20T05-49-58-043Z/manifest.json",
    ]);
    // Its retained frozen copies went too, so its files half restores.
    expect(swept.sweep.recovered[0]!.filesMissing).toEqual([]);
    expect(receipted({ directory: stranded.directory, home })).toBe(true);
    expect(swept.released).toEqual(["2026-09-20T05-49-58-043Z"]);
    const chunk = `slopweaver/chunks/identity/${sha256Of({ bytes: Buffer.from("PGDMP fake dump bytes") })}`;
    expect((await storedPlaintext({ objectName: chunk, root: destination })).toString("utf8")).toBe(
      "PGDMP fake dump bytes",
    );
  });

  it("names a staging whose manifest this schema refuses, and sends nothing of it", async () => {
    const home = sandboxHome();
    // The real shape on this install: `2026-09-20T05-49-58-043Z/manifest.json` predates the credentials leg
    // and carries no `secrets` key at all, which `parseBackupManifest` is `.strict()` about on purpose.
    const dead = join(stagingRoot({ home }), "2026-09-19T17-30-46-828Z");
    mkdirSync(dead, { recursive: true });
    writeFileSync(join(dead, FILES_MANIFEST), '{"files":[]}\n');
    writeFileSync(join(dead, BACKUP_FILES.dump), "PGDMP fake dump bytes");
    writeFileSync(join(dead, BACKUP_FILES.storage), "fake tar bytes");
    writeFileSync(
      join(dead, BACKUP_FILES.manifest),
      JSON.stringify({
        createdAtIso: "2026-09-19T17:30:46.828Z",
        database: "postgres",
        dump: { bytes: 21, sha256: "0".repeat(64) },
        extensions: [],
        pgDumpVersion: "pg_dump (PostgreSQL) 17.6",
        project: "slopweaver",
        schemas: ["public"],
        storage: { bytes: 14, sha256: "1".repeat(64) },
        version: 1,
      }),
    );
    const tonight = unwrap(await sweepOnce({ home }));
    expect(tonight.sweep.unrecoverable).toHaveLength(1);
    expect(tonight.sweep.unrecoverable[0]!.directory).toBe(dead);
    expect(tonight.sweep.unrecoverable[0]!.error.code).toBe("STAGING_MANIFEST_UNREADABLE");
    expect(tonight.sweep.unrecoverable[0]!.error).toEqual(
      StagingSweepErrors.unreadableManifest({
        directory: dead,
        problems: ["secrets: Invalid input: expected object, received undefined"],
      }),
    );
    expect(tonight.sweep.unrecoverable[0]!.error.message).toContain("not recoverable and not restorable");
    expect(receipted({ directory: dead, home })).toBe(false);
    // A staging the sweep could not send is still one the destination does not hold, so the pruner keeps it.
    expect(tonight.pruned).toEqual([]);
    expect(existsSync(join(dead, BACKUP_FILES.dump))).toBe(true);
  });

  it("leaves a staging with no files.json alone — it is unfinished, not stranded", async () => {
    const home = sandboxHome();
    const half = join(stagingRoot({ home }), "2026-09-20T22-00-00-000Z");
    mkdirSync(half, { recursive: true });
    writeFileSync(join(half, BACKUP_FILES.manifest), "{}\n");
    const tonight = unwrap(await sweepOnce({ home }));
    expect(tonight.sweep.unfinished).toEqual([half]);
    expect(tonight.pruned).toEqual([]);
    expect(existsSync(join(half, BACKUP_FILES.manifest))).toBe(true);
    expect(tonight.sweep.recovered).toEqual([]);
    expect(tonight.sweep.unrecoverable).toEqual([]);
  });
});

describe("stageSecretsLeg", () => {
  it("answers null, not a failure, when this machine has set no master password", () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    expect(unwrap(stageSecretsLeg({ deps: FAKE_STACK, directory, home, masterPassword: null }))).toBe(null);
    expect(existsSync(join(directory, BACKUP_FILES.secrets))).toBe(false);
  });

  it("seals secrets.enc at 0600 under the password it is handed, and reports the digest of what it wrote", () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    mkdirSync(join(home, "secrets"), { recursive: true });
    writeFileSync(join(home, "secrets", "slack-bot-token"), "xoxb-not-a-real-token-0000\n");
    const artefact = unwrap(stageSecretsLeg({ deps: FAKE_STACK, directory, home, masterPassword: PASSWORD }))!;
    const path = join(directory, BACKUP_FILES.secrets);
    expect(artefact.bytes).toBe(statSync(path).size);
    expect(artefact.sha256).toBe(createHash("sha256").update(readFileSync(path)).digest("hex"));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).not.toContain("xoxb-not-a-real-token-0000");
    // Opens under exactly the password handed in — the bundle names each file and base64s its content.
    expect(unwrap(decryptSecretsBundle({ armoured: readFileSync(path), passphrase: PASSWORD })).toString()).toContain(
      `"contentB64":"${Buffer.from("xoxb-not-a-real-token-0000\n").toString("base64")}"`,
    );
  });

  it("refuses the whole leg when a secret is there and cannot be read", () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    mkdirSync(join(home, "secrets"), { recursive: true });
    const unreadable = join(home, "secrets", "slack-bot-token");
    writeFileSync(unreadable, "xoxb-not-a-real-token-0000\n");
    chmodSync(unreadable, 0o000);
    const failed = unwrapErr(stageSecretsLeg({ deps: FAKE_STACK, directory, home, masterPassword: PASSWORD }));
    chmodSync(unreadable, 0o600);
    expect(failed[0]).toContain("could not read or write");
    expect(failed[0]).toContain("slack-bot-token");
  });
});

describe("runSweepOnly", () => {
  it("sends a staging the destination never got without taking a dump, then prunes to the kept copy", async () => {
    const home = sandboxHome();
    const transport = directoryTransport({ root: besideHome({ home }) });
    const staged = unwrap(await oneNight({ home, localOnly: true, nowIso: "2026-09-23T23:54:47.061Z" }));
    const report = unwrap(await sweepOnce({ home, transport }));
    expect(report.sweep.recovered.map((staging) => [staging.directory, staging.prefix])).toEqual([
      [staged.directory, "slopweaver/2026-09-23T23-54-47-061Z/"],
    ]);
    expect(report.pruned).toEqual([]);
    expect(receipted({ directory: staged.directory, home })).toBe(true);
    expect(transport.uploaded.filter((name) => name.includes("/chunks/"))).toEqual([
      `slopweaver/chunks/identity/${sha256Of({ bytes: Buffer.from("PGDMP fake dump bytes") })}`,
    ]);
    // The staging sealed its Vault leg under the key, so the sweep carries `vault.enc` as well.
    expect(transport.uploaded.filter((name) => name.endsWith(BACKUP_FILES.vault))).toEqual([
      "slopweaver/2026-09-23T23-54-47-061Z/vault.enc",
    ]);
  });

  it("reports nothing sent on a home that has never staged a backup", async () => {
    const home = sandboxHome();
    const transport = directoryTransport({ root: besideHome({ home }) });
    const report = unwrap(await sweepOnce({ home, transport }));
    expect(report).toEqual({
      keyWrap: { state: "no-master-password" },
      pruned: [],
      released: [],
      sweep: { recovered: [], unfinished: [], unrecoverable: [] },
    });
    expect(transport.uploaded).toEqual([]);
  });

  it("writes the key wrap even on a home that has never staged a backup", async () => {
    const home = sandboxHome();
    const transport = directoryTransport({ root: besideHome({ home }) });
    const report = unwrap(await sweepOnce({ home, masterPassword: PASSWORD, transport }));
    expect(report.keyWrap).toEqual({ objectName: WRAP_NAME, state: "written" });
    expect(transport.uploaded).toEqual([WRAP_NAME]);
  });

  it("refuses a password under the floor and sweeps nothing", async () => {
    const home = sandboxHome();
    const transport = directoryTransport({ root: besideHome({ home }) });
    unwrap(await oneNight({ home, localOnly: true, nowIso: "2026-09-23T23:54:47.061Z" }));
    const refused = unwrapErr(await sweepOnce({ home, masterPassword: "too-short", transport }));
    expect(refused[0]).toContain("is 9 characters, and it must be at least 26");
    expect(transport.uploaded).toEqual([]);
  });
});

describe("the key wrap beside every backup", () => {
  it("lands the wrap BEFORE any object of the backup, and seals secrets.enc under the same password", async () => {
    const home = sandboxHome();
    const transport = directoryTransport({ root: besideHome({ home }) });
    const report = unwrap(
      await oneNight({ home, masterPassword: PASSWORD, nowIso: "2026-11-07T03:00:00.000Z", transport }),
    );
    expect(unwrap(sentReport({ report })).keyWrap).toEqual({ objectName: WRAP_NAME, state: "written" });
    expect(transport.uploaded[0]).toBe(WRAP_NAME);
    expect(transport.uploaded).toContain("slopweaver/2026-11-07T03-00-00-000Z/secrets.enc");
    const opened = unwrap(
      await openDestinationBackup({
        password: PASSWORD,
        prefix: "slopweaver/2026-11-07T03-00-00-000Z/",
        project: "slopweaver",
        transport,
      }),
    );
    expect(opened.key.equals(KEY)).toBe(true);
  });

  it("leaves a wrap already there byte for byte on the next night, opening it rather than rewriting it", async () => {
    const home = sandboxHome();
    const destination = besideHome({ home });
    const transport = directoryTransport({ root: destination });
    unwrap(await oneNight({ home, masterPassword: PASSWORD, nowIso: "2026-11-07T03:00:00.000Z", transport }));
    const first = readFileSync(join(destination, WRAP_NAME));
    const second = unwrap(
      await oneNight({ home, masterPassword: PASSWORD, nowIso: "2026-11-08T03:00:00.000Z", transport }),
    );
    expect(unwrap(sentReport({ report: second })).keyWrap).toEqual({ objectName: WRAP_NAME, state: "present" });
    expect(readFileSync(join(destination, WRAP_NAME)).equals(first)).toBe(true);
    expect(transport.uploaded.filter((name) => name === WRAP_NAME)).toEqual([WRAP_NAME]);
  });

  it("refuses a destination whose password does not open the wrap already there, replacing nothing and sending nothing", async () => {
    const home = sandboxHome();
    const destination = besideHome({ home });
    const transport = directoryTransport({ root: destination });
    unwrap(await sweepOnce({ home, masterPassword: PASSWORD, transport }));
    const before = readFileSync(join(destination, WRAP_NAME));
    const report = unwrap(
      await oneNight({ home, masterPassword: "z".repeat(26), nowIso: "2026-11-08T03:00:00.000Z", transport }),
    );
    expect(unwrapErr(sentReport({ report }))).toEqual([
      `the backup key's wrap ${WRAP_NAME} is not proven to open, so no backup object was sent: ` +
        KeyWrapErrors.wrongPassword({ objectName: WRAP_NAME }).message,
    ]);
    expect(readFileSync(join(destination, WRAP_NAME)).equals(before)).toBe(true);
    expect(transport.uploaded).toEqual([WRAP_NAME]);
  });

  it("names a wrap it wrote but could not read back as unproven, and sends no backup object after it", async () => {
    const home = sandboxHome();
    const destination = besideHome({ home });
    const inner = directoryTransport({ root: destination });
    const readFailed = LocalDestinationErrors.readFailed({
      cause: new Error("fixture read failure"),
      objectName: WRAP_NAME,
      root: destination,
    });
    const transport = { ...inner, download: async () => err(readFailed) };
    const report = unwrap(
      await oneNight({ home, masterPassword: PASSWORD, nowIso: "2026-11-08T03:00:00.000Z", transport }),
    );
    expect(unwrapErr(sentReport({ report }))).toEqual([
      `the backup key's wrap ${WRAP_NAME} is not proven to open, so no backup object was sent: ` +
        KeyWrapErrors.transportFailed({ detail: readFailed.message, objectName: WRAP_NAME }).message,
    ]);
    expect(inner.uploaded).toEqual([WRAP_NAME]);
  });

  it("returns a destination that throws while the wrap is checked as a reason line, and sends nothing", async () => {
    const home = sandboxHome();
    const inner = directoryTransport({ root: besideHome({ home }) });
    const transport = {
      ...inner,
      list: async (): Promise<never> => {
        throw new Error("fixture list exploded");
      },
    };
    const refused = unwrapErr(await sweepOnce({ home, masterPassword: PASSWORD, transport }));
    expect(refused).toEqual([
      `the backup key's wrap ${WRAP_NAME} is not proven to open, so no backup object was sent: ` +
        KeyWrapErrors.transportFailed({
          detail: "the destination threw: fixture list exploded",
          objectName: WRAP_NAME,
        }).message,
    ]);
    expect(inner.uploaded).toEqual([]);
  });

  it("still returns a reason line when the destination throws a value that cannot be printed", async () => {
    const home = sandboxHome();
    const inner = directoryTransport({ root: besideHome({ home }) });
    const transport = {
      ...inner,
      list: async (): Promise<never> => {
        throw Object.create(null);
      },
    };
    const refused = unwrapErr(await sweepOnce({ home, masterPassword: PASSWORD, transport }));
    expect(refused).toEqual([
      `the backup key's wrap ${WRAP_NAME} is not proven to open, so no backup object was sent: ` +
        KeyWrapErrors.transportFailed({
          detail: "the destination threw: [object Object]",
          objectName: WRAP_NAME,
        }).message,
    ]);
    expect(inner.uploaded).toEqual([]);
  });

  it("names the wrap it checked when a key of the wrong length cannot be wrapped, and sends nothing", async () => {
    const home = sandboxHome();
    const transport = directoryTransport({ root: besideHome({ home }) });
    const shortKey = Buffer.alloc(16, 7);
    const shortWrap = `slopweaver/keys/${keyFingerprint({ key: shortKey })}.wrap`;
    const refused = unwrapErr(await sweepOnce({ home, key: shortKey, masterPassword: PASSWORD, transport }));
    expect(refused).toEqual([
      `the backup key's wrap ${shortWrap} is not proven to open, so no backup object was sent: ` +
        KeyWrapErrors.keyInvalid({ bytes: 16 }).message,
    ]);
    expect(transport.uploaded).toEqual([]);
  });

  it("says so, and writes no wrap, when no master password is set", async () => {
    const home = sandboxHome();
    const transport = directoryTransport({ root: besideHome({ home }) });
    const report = unwrap(await oneNight({ home, nowIso: "2026-11-07T03:00:00.000Z", transport }));
    expect(unwrap(sentReport({ report })).keyWrap).toEqual({ state: "no-master-password" });
    expect(transport.uploaded.filter((name) => name.includes("/keys/"))).toEqual([]);
  });

  it("reports no destination at all on a run that reached none, and still seals the credentials leg", async () => {
    const home = sandboxHome();
    const report = unwrap(
      await oneNight({ home, localOnly: true, masterPassword: PASSWORD, nowIso: "2026-11-07T03:00:00.000Z" }),
    );
    expect(report.destinations).toEqual([]);
    expect(report.manifest.secrets).not.toBe(null);
  });
});
