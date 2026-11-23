/**
 * The backup key's Keychain rules over a plain fake `security` runner: which exit means absent or locked, what
 * a malformed value is, and why creation refuses rather than replacing a key that every earlier backup needs.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  addItemCommand,
  backupKeyFromOutcome,
  createBackupKey,
  readBackupKey,
  requireBackupKey,
  type SecurityOutcome,
  type SecurityRunner,
} from "../../../store/backup/backupKeychain.js";
import { BackupKeyErrors } from "../../../store/backup/backupKeyErrors.js";
import { keyFingerprint } from "../../../store/backup/objectCrypto.js";

const SERVICE = "slopweaver-backup-key-test";
const KEY = Buffer.alloc(32, 5);
const OTHER = Buffer.alloc(32, 8);

/** One call the fake `security` saw. */
interface SeenCall {
  readonly argv: readonly string[];
  readonly input?: string;
}

/**
 * The base64 value an `add-generic-password` line carries after `-w`.
 *
 * @param input the `security -i` stdin
 * @returns the quoted value
 */
function writtenValue({ input }: { input: string }): string {
  return /-w "([^"]+)"/.exec(input)![1]!;
}

/**
 * A fake `security`: answers reads from what it holds, and stores the key an `-i` add line carries.
 *
 * @param held the base64 value already in the Keychain, if any
 * @param readStatus an exit to force on every read
 * @param writeStatus an exit to force on the write
 * @param storeOnWrite what the write stores, overriding the key it was sent
 * @returns the runner and the calls it saw
 */
function fakeSecurity({
  held,
  readStatus,
  writeStatus = 0,
  storeOnWrite,
}: {
  held?: string;
  readStatus?: number;
  writeStatus?: number;
  storeOnWrite?: string;
}): { run: SecurityRunner; calls: SeenCall[] } {
  const calls: SeenCall[] = [];
  let value = held;
  const run: SecurityRunner = (call) => {
    calls.push(call);
    if (call.argv[0] === "-i") {
      if (writeStatus === 0) {
        value = writtenValue({ input: call.input! });
        if (storeOnWrite !== undefined) {
          value = storeOnWrite;
        }
      }
      return { status: writeStatus, stdout: "" };
    }
    if (readStatus !== undefined) {
      return { status: readStatus, stdout: "" };
    }
    if (value === undefined) {
      return { status: 44, stdout: "" };
    }
    return { status: 0, stdout: `${value}\n` };
  };
  return { calls, run };
}

describe("backupKeyFromOutcome", () => {
  const judge = (outcome: SecurityOutcome) => backupKeyFromOutcome({ outcome, service: SERVICE });

  it("reads exit 44 as absent and exit 36 as locked", () => {
    expect(unwrap(judge({ status: 44, stdout: "" }))).toEqual({ kind: "absent" });
    expect(unwrap(judge({ status: 36, stdout: "" }))).toEqual({ kind: "locked" });
  });

  it("names any other non-zero exit as a failed read", () => {
    const failed = unwrapErr(judge({ status: 51, stdout: "" }));
    expect(failed.code).toBe("BACKUP_KEY_READ_FAILED");
    expect(failed.message).toContain("51");
  });

  it("returns a present key with its fingerprint", () => {
    const read = unwrap(judge({ status: 0, stdout: `${KEY.toString("base64")}\n` }));
    expect(read).toEqual({ fingerprint: keyFingerprint({ key: KEY }), key: KEY, kind: "present" });
  });

  it.each([
    ["a short key", Buffer.alloc(16, 1).toString("base64")],
    ["a long key", Buffer.alloc(33, 1).toString("base64")],
    ["non-canonical base64", `${KEY.toString("base64").slice(0, -1)}!`],
    ["an empty value", ""],
  ])("refuses %s as malformed", (_label, stdout) => {
    expect(unwrapErr(judge({ status: 0, stdout })).code).toBe("BACKUP_KEY_MALFORMED");
  });
});

describe("requireBackupKey", () => {
  it("turns absent and locked into the errors that stop a backup", () => {
    expect(unwrapErr(requireBackupKey({ run: fakeSecurity({}).run, service: SERVICE }))).toEqual(
      BackupKeyErrors.absent({ service: SERVICE }),
    );
    expect(unwrapErr(requireBackupKey({ run: fakeSecurity({ readStatus: 36 }).run, service: SERVICE })).code).toBe(
      "BACKUP_KEY_LOCKED",
    );
  });

  it("asks for the named service with -w and nothing interactive", () => {
    const fake = fakeSecurity({ held: KEY.toString("base64") });
    expect(unwrap(requireBackupKey({ run: fake.run, service: SERVICE })).fingerprint).toBe(
      keyFingerprint({ key: KEY }),
    );
    expect(fake.calls.map((call) => [call.argv[0], call.argv[2], call.argv.at(-1)])).toEqual([
      ["find-generic-password", SERVICE, "-w"],
    ]);
  });
});

describe("createBackupKey", () => {
  it("writes a fresh key through security -i, reads it back and returns its fingerprint", () => {
    const fake = fakeSecurity({});
    const created = unwrap(createBackupKey({ random: () => KEY, run: fake.run, service: SERVICE }));
    expect(created).toEqual({ fingerprint: keyFingerprint({ key: KEY }) });
    expect(fake.calls.map((call) => call.argv[0])).toEqual(["find-generic-password", "-i", "find-generic-password"]);
    expect(writtenValue({ input: fake.calls[1]!.input! })).toBe(KEY.toString("base64"));
    expect(fake.calls[1]!.input).not.toContain(" -U");
    expect(unwrap(readBackupKey({ run: fake.run, service: SERVICE }))).toEqual({
      fingerprint: keyFingerprint({ key: KEY }),
      key: KEY,
      kind: "present",
    });
  });

  it("refuses when a key exists and never writes", () => {
    const fake = fakeSecurity({ held: KEY.toString("base64") });
    expect(unwrapErr(createBackupKey({ random: () => OTHER, run: fake.run, service: SERVICE })).code).toBe(
      "BACKUP_KEY_EXISTS",
    );
    expect(fake.calls.map((call) => call.argv[0])).toEqual(["find-generic-password"]);
  });

  it("refuses on a locked Keychain and never writes", () => {
    const fake = fakeSecurity({ readStatus: 36 });
    expect(unwrapErr(createBackupKey({ random: () => KEY, run: fake.run, service: SERVICE })).code).toBe(
      "BACKUP_KEY_LOCKED",
    );
    expect(fake.calls.map((call) => call.argv[0])).toEqual(["find-generic-password"]);
  });

  it("names a failed write with its exit", () => {
    const failed = unwrapErr(
      createBackupKey({ random: () => KEY, run: fakeSecurity({ writeStatus: 45 }).run, service: SERVICE }),
    );
    expect(failed.code).toBe("BACKUP_KEY_WRITE_FAILED");
    expect(failed.message).toContain("45");
  });

  it("names a read-back that is not the key it wrote, carrying neither key's bytes", () => {
    const fake = fakeSecurity({ storeOnWrite: OTHER.toString("base64") });
    const failed = unwrapErr(createBackupKey({ random: () => KEY, run: fake.run, service: SERVICE }));
    expect(failed.code).toBe("BACKUP_KEY_READBACK_MISMATCH");
    expect(failed.message).not.toContain(KEY.toString("base64"));
    expect(failed.message).not.toContain(OTHER.toString("base64"));
  });
});

describe("addItemCommand", () => {
  it("emits one quoted add line with the trusted reader and no update flag", () => {
    expect(addItemCommand({ account: 'a"b', encoded: "QUJD", service: "svc" })).toBe(
      'add-generic-password -s "svc" -a "a\\"b" -T /usr/bin/security -w "QUJD"\n',
    );
  });
});
