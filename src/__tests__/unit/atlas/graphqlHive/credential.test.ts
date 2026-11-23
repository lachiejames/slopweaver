import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { HIVE_TOKEN_ENV, HIVE_TOKEN_SECRET, resolveHiveToken } from "../../../../atlas/graphqlHive/credential.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const homes: string[] = [];

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/** A throwaway home this file owns, removed after each test. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-hive-cred-"));
  homes.push(home);
  return home;
}

/** Write the secret file the store route reads. */
function writeToken({ home, value }: { home: string; value: string }): void {
  mkdirSync(join(home, "secrets"), { recursive: true });
  writeFileSync(join(home, "secrets", HIVE_TOKEN_SECRET), value);
}

describe("resolveHiveToken", () => {
  it("takes the environment first", () => {
    const home = scratchHome();
    writeToken({ home, value: "from-file" });
    expect(unwrap(resolveHiveToken({ env: { [HIVE_TOKEN_ENV]: "from-env" }, home }))).toBe("from-env");
  });

  it("falls back to the secrets store, which is what a scheduled run with no shell stands on", () => {
    const home = scratchHome();
    writeToken({ home, value: "from-file" });
    expect(unwrap(resolveHiveToken({ env: {}, home }))).toBe("from-file");
  });

  it("trims the newline a shell pipe leaves on the file", () => {
    const home = scratchHome();
    writeToken({ home, value: "from-file\n" });
    expect(unwrap(resolveHiveToken({ env: {}, home }))).toBe("from-file");
  });

  it("ignores a blank environment value rather than sending an empty bearer", () => {
    const home = scratchHome();
    writeToken({ home, value: "from-file" });
    expect(unwrap(resolveHiveToken({ env: { [HIVE_TOKEN_ENV]: "   " }, home }))).toBe("from-file");
  });

  it("reports nothing configured, naming every place it looked", () => {
    const home = scratchHome();
    const failure = unwrapErr(resolveHiveToken({ env: {}, home }));
    expect(failure.code).toBe("CREDENTIAL_MISSING");
  });

  it("names the console step that mints a token, so an unconfigured install knows what to do", () => {
    const home = scratchHome();
    expect(unwrapErr(resolveHiveToken({ env: {}, home })).message).toContain("Access Tokens");
  });

  it("distinguishes an EMPTY token file from no file, so a written-but-blank secret is not 'unconfigured'", () => {
    const home = scratchHome();
    writeToken({ home, value: "" });
    expect(unwrapErr(resolveHiveToken({ env: {}, home })).code).toBe("CREDENTIAL_UNREADABLE");
  });
});
