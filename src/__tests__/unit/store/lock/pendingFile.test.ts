/**
 * The lock's pending-password file: where each stack's minted password is parked, and the durable writes, syncs
 * and removal around it.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import {
  ancestorsOf,
  clearPendingInPlace,
  pendingPath,
  syncPendingInPlace,
  syncSecretsChain,
  writePendingInPlace,
} from "../../../../store/lock/pendingFile.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway home. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "pending-"));
  dirs.push(dir);
  return dir;
}

describe("writePendingInPlace", () => {
  it("writes the password 0600 at its own path, replaces an older one, and leaves no sibling file", () => {
    const root = home();
    const path = join(root, "store-lock", "pending-login");
    writePendingInPlace({ password: "first", path });
    writePendingInPlace({ password: "second", path });
    expect(readFileSync(path, "utf8")).toBe("second\n");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(root, "store-lock"))).toEqual(["pending-login"]);
  });

  it("writes into a store-lock directory an earlier run left behind, empty", () => {
    const root = home();
    mkdirSync(join(root, "store-lock"));
    const path = join(root, "store-lock", "pending-login-acme");
    writePendingInPlace({ password: "p", path });
    expect(readFileSync(path, "utf8")).toBe("p\n");
  });

  it("creates every missing directory on the way to the file", () => {
    const path = join(home(), "fresh", "store-lock", "pending-login");
    writePendingInPlace({ password: "p", path });
    expect(readFileSync(path, "utf8")).toBe("p\n");
  });
});

describe("pendingPath", () => {
  it("parks each stack's password in its own file under store-lock", () => {
    expect(pendingPath({ home: "/h", projectId: "acme" })).toBe("/h/store-lock/pending-login-acme");
    expect(pendingPath({ home: "/h", projectId: "acme-other" })).toBe("/h/store-lock/pending-login-acme-other");
  });

  it("encodes a stack id so it can never name another directory", () => {
    expect(pendingPath({ home: "/h", projectId: "../x/y" })).toBe("/h/store-lock/pending-login-..%2Fx%2Fy");
  });
});

describe("ancestorsOf", () => {
  it("names every directory above a path, deepest first, through the root", () => {
    expect(ancestorsOf({ path: "/a/b/c/store-lock/pending-login" })).toEqual([
      "/a/b/c/store-lock",
      "/a/b/c",
      "/a/b",
      "/a",
      "/",
    ]);
  });

  it("names only the root for a file directly under it", () => {
    expect(ancestorsOf({ path: "/pending-login" })).toEqual(["/"]);
  });
});

describe("syncPendingInPlace", () => {
  it("syncs a parked password in place, leaving its bytes and mode exactly as they were", () => {
    const root = home();
    const path = join(root, "store-lock", "pending-login");
    writePendingInPlace({ password: "parked", path });
    syncPendingInPlace({ path });
    expect(readFileSync(path, "utf8")).toBe("parked\n");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(root, "store-lock"))).toEqual(["pending-login"]);
  });

  it("throws when no parked password is there, so the role is never changed", () => {
    expect(() => syncPendingInPlace({ path: join(home(), "store-lock", "pending-login") })).toThrow("ENOENT");
  });
});

describe("clearPendingInPlace", () => {
  it("removes one stack's parked password and leaves another stack's", () => {
    const root = home();
    writePendingInPlace({ password: "a", path: pendingPath({ home: root, projectId: "acme" }) });
    writePendingInPlace({ password: "b", path: pendingPath({ home: root, projectId: "acme-other" }) });
    clearPendingInPlace({ home: root, projectId: "acme" });
    expect(existsSync(pendingPath({ home: root, projectId: "acme" }))).toBe(false);
    expect(readdirSync(join(root, "store-lock"))).toEqual(["pending-login-acme-other"]);
  });
});

describe("syncSecretsChain", () => {
  it("syncs every directory above a written secret", () => {
    const path = join(home(), "secrets", "store-url");
    writePendingInPlace({ password: "url", path });
    expect(unwrap(syncSecretsChain({ path }))).toBe(undefined);
  });

  it("names the step when the secret is not there", () => {
    const error = unwrapErr(syncSecretsChain({ path: join(home(), "secrets", "store-url") }));
    expect(error.code).toBe("SECRET_WRITE_FAILED");
    expect(error.message).toContain("syncing store-url's directories");
  });
});
