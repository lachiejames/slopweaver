/**
 * Resolving the API key, and — the part that matters — saying WHICH absence it found.
 *
 * A missing key and an unreadable one send a reader to two different places, and this atlas exits 0 on the
 * first and non-zero on the second. Collapsing them is how an install with a key already written gets told
 * to write one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveWorkosApiKey, WORKOS_API_KEY_ENV, WORKOS_API_KEY_SECRET } from "../../../../atlas/workos/credential.js";
import { unwrap } from "../../../../lib/result.js";

const homes: string[] = [];

/** A throwaway state home, removed after each test. */
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-workos-cred-"));
  homes.push(home);
  return home;
}

/** Write the secret file the store route reads. */
function writeSecret({ home, value }: { home: string; value: string }): void {
  mkdirSync(join(home, "secrets"), { recursive: true });
  writeFileSync(join(home, "secrets", WORKOS_API_KEY_SECRET), value, "utf8");
}

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

describe("resolveWorkosApiKey", () => {
  it("prefers the environment over the secrets store", () => {
    const home = tempHome();
    writeSecret({ home, value: "sk_from_file" });
    const resolved = resolveWorkosApiKey({ env: { [WORKOS_API_KEY_ENV]: "sk_from_env" }, home });
    expect(resolved.isOk()).toBe(true);
    expect(unwrap(resolved)).toBe("sk_from_env");
  });

  it("falls back to the secrets store, which is what a scheduled run stands on", () => {
    const home = tempHome();
    writeSecret({ home, value: "sk_from_file\n" });
    const resolved = resolveWorkosApiKey({ env: {}, home });
    expect(resolved.isOk()).toBe(true);
    expect(unwrap(resolved)).toBe("sk_from_file");
  });

  it("ignores a blank environment value rather than authenticating with it", () => {
    const home = tempHome();
    writeSecret({ home, value: "sk_from_file" });
    const resolved = resolveWorkosApiKey({ env: { [WORKOS_API_KEY_ENV]: "   " }, home });
    expect(unwrap(resolved)).toBe("sk_from_file");
  });

  it("reports CREDENTIAL_MISSING naming both places it looked", () => {
    const home = tempHome();
    const resolved = resolveWorkosApiKey({ env: {}, home });
    expect(resolved.isErr()).toBe(true);
    const error = resolved._unsafeUnwrapErr();
    expect(error.code).toBe("CREDENTIAL_MISSING");
    expect(error.message).toContain(`$${WORKOS_API_KEY_ENV}`);
    expect(error.message).toContain("slopweaver secrets set workos-api-key");
  });

  it("reports an EMPTY file as unreadable rather than as missing", () => {
    const home = tempHome();
    writeSecret({ home, value: "   " });
    const resolved = resolveWorkosApiKey({ env: {}, home });
    expect(resolved.isErr()).toBe(true);
    expect(resolved._unsafeUnwrapErr().code).toBe("CREDENTIAL_UNREADABLE");
  });
});
