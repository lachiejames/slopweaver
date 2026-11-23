/**
 * The key-wrap step each destination's write opens with: nothing written with no master password, the wrap written
 * once and found present after, and a destination that throws reported as this step's refusal rather than a throw.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { backupKeyWrapObjectName } from "../../../store/backup/keyWrap.js";
import { keyWrapFor } from "../../../store/backup/keyWrapStep.js";
import { keyFingerprint } from "../../../store/backup/objectCrypto.js";
import { SUPABASE_PROJECT_ID } from "../../../store/backup/plan.js";
import type { BackupTransport } from "../../../store/backup/transport.js";

import { directoryTransport } from "./directoryTransport.js";

const KEY = Buffer.alloc(32, 7);
const PASSWORD = "fixture-master-password-long-enough-to-pass";
const WRAP = backupKeyWrapObjectName({ fingerprint: keyFingerprint({ key: KEY }), project: SUPABASE_PROJECT_ID });

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => {
    rmSync(root, { force: true, recursive: true });
  });
});

/**
 * A throwaway destination folder.
 *
 * @returns its path
 */
function destinationRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "key-wrap-step-"));
  roots.push(root);
  return root;
}

/**
 * A destination whose every call throws, breaking the transport's own contract.
 *
 * @param root the folder the rest of the fixture names
 * @returns the transport
 */
function throwingTransport({ root }: { root: string }): BackupTransport {
  const boom = async (): Promise<never> => {
    throw new Error("fixture drive exploded");
  };
  return { ...directoryTransport({ root }), download: boom, list: boom, objectSizes: boom, upload: boom };
}

describe("keyWrapFor", () => {
  it("writes nothing and says so when no master password is set", async () => {
    const destination = directoryTransport({ root: destinationRoot() });
    const status = unwrap(await keyWrapFor({ destination, key: KEY, masterPassword: null }));
    expect(status).toEqual({ state: "no-master-password" });
    expect(destination.uploaded).toEqual([]);
  });

  it("writes the wrap at one destination, then finds it present without writing again", async () => {
    const destination = directoryTransport({ root: destinationRoot() });
    const first = unwrap(await keyWrapFor({ destination, key: KEY, masterPassword: PASSWORD }));
    const second = unwrap(await keyWrapFor({ destination, key: KEY, masterPassword: PASSWORD }));
    expect(first).toEqual({ objectName: WRAP, state: "written" });
    expect(second).toEqual({ objectName: WRAP, state: "present" });
    expect(destination.uploaded).toEqual([WRAP]);
  });

  it("turns a destination that throws into this step's refusal, naming the wrap it checked", async () => {
    const destination = throwingTransport({ root: destinationRoot() });
    const refused = unwrapErr(await keyWrapFor({ destination, key: KEY, masterPassword: PASSWORD }));
    expect(refused.code).toBe("BACKUP_STEP_FAILED");
    expect(refused.message).toContain(`the backup key's wrap ${WRAP} is not proven to open`);
    expect(refused.message).toContain("fixture drive exploded");
  });
});
