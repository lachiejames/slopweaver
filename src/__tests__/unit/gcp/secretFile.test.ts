/**
 * The two local file edges for a secret, round-tripped through a temp directory: a read that refuses a symlink,
 * a directory and an oversized file, and a write that only ever creates a new owner-only file.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSecretFile, writeSecretFile } from "../../../gcp/secretFile.js";
import { SECRET_PAYLOAD_MAX_BYTES } from "../../../gcp/secretPayload.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gcp-secret-file-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("readSecretFile", () => {
  it("reads the exact bytes, a trailing newline included", () => {
    const path = join(dir, "payload");
    writeFileSync(path, "value\n");
    expect(new TextDecoder().decode(unwrap(readSecretFile({ path })))).toBe("value\n");
  });

  it("refuses a symlink, a directory, an oversized file and a missing path", () => {
    const target = join(dir, "target");
    writeFileSync(target, "value");
    const link = join(dir, "link");
    symlinkSync(target, link);
    const sub = join(dir, "sub");
    mkdirSync(sub);
    const big = join(dir, "big");
    writeFileSync(big, Buffer.alloc(SECRET_PAYLOAD_MAX_BYTES + 1));
    expect([
      unwrapErr(readSecretFile({ path: link })).code,
      unwrapErr(readSecretFile({ path: sub })).message,
      unwrapErr(readSecretFile({ path: big })).message,
      unwrapErr(readSecretFile({ path: join(dir, "absent") })).code,
    ]).toEqual([
      "SECRET_FILE_FAILED",
      `${sub}: not a regular file`,
      `${big}: 65537 bytes, over Secret Manager's 65536`,
      "SECRET_FILE_FAILED",
    ]);
  });
});

describe("writeSecretFile", () => {
  it("creates a new 0600 file holding the bytes", () => {
    const path = join(dir, "out");
    expect(writeSecretFile({ bytes: new TextEncoder().encode("s3cret"), path }).isOk()).toBe(true);
    expect([readFileSync(path, "utf8"), statSync(path).mode & 0o777]).toEqual(["s3cret", 0o600]);
  });

  it("refuses an existing path and leaves it exactly as it was", () => {
    const path = join(dir, "existing");
    writeFileSync(path, "keep me");
    expect(unwrapErr(writeSecretFile({ bytes: new TextEncoder().encode("new"), path })).message).toBe(
      `${path}: the path already exists — the door never overwrites a file`,
    );
    expect(readFileSync(path, "utf8")).toBe("keep me");
  });

  it("never follows a symlink planted at the path", () => {
    const target = join(dir, "target");
    writeFileSync(target, "keep me");
    const link = join(dir, "link");
    symlinkSync(target, link);
    expect(unwrapErr(writeSecretFile({ bytes: new TextEncoder().encode("new"), path: link })).code).toBe(
      "SECRET_FILE_FAILED",
    );
    expect(readFileSync(target, "utf8")).toBe("keep me");
  });
});
