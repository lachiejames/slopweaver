/**
 * The private-terms lock over a throwaway directory: taken with an owner token, refused while a live pid holds it,
 * a dead holder's lock cleared, a live lock taken while a stale one was being judged left in place, and release
 * never removing a lock another process holds.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { releasePrivateTermsLock, takePrivateTermsLock } from "../../../hygiene/privateTermsLock.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function lockPathIn(): string {
  const directory = mkdtempSync(join(tmpdir(), "private-terms-lock-"));
  directories.push(directory);
  return join(directory, "private-terms.tsv.lock");
}

describe("takePrivateTermsLock", () => {
  it("writes this process's pid and a token, and release removes exactly that lock", () => {
    const path = lockPathIn();
    const lock = unwrap(takePrivateTermsLock({ path, pidAlive: () => false }));
    expect(readFileSync(path, "utf8")).toBe(lock.token);
    expect(lock.token.startsWith(`${String(process.pid)} `)).toBe(true);
    // Staged then linked into place: the staged copy is gone once the lock is held.
    expect(readdirSync(join(path, ".."))).toStrictEqual(["private-terms.tsv.lock"]);
    releasePrivateTermsLock({ lock });
    expect(existsSync(path)).toBe(false);
  });

  it("refuses while a live pid holds it, leaving that lock in place and nothing staged", () => {
    const path = lockPathIn();
    writeFileSync(path, "4242\n");
    const refusal = unwrapErr(takePrivateTermsLock({ path, pidAlive: () => true }));
    expect(refusal).toStrictEqual({ kind: "held", why: "pid 4242 holds it and is running" });
    expect(readFileSync(path, "utf8")).toBe("4242\n");
    expect(readdirSync(join(path, ".."))).toStrictEqual(["private-terms.tsv.lock"]);
  });

  it("clears a dead holder's lock and takes it, leaving nothing aside", () => {
    const path = lockPathIn();
    writeFileSync(path, "4242 0123456789ab\n");
    const lock = unwrap(takePrivateTermsLock({ path, pidAlive: () => false }));
    expect(readFileSync(path, "utf8")).toBe(lock.token);
    releasePrivateTermsLock({ lock });
    expect(readdirSync(join(path, ".."))).toStrictEqual([]);
  });

  it("leaves a live lock another process took while this one judged the stale lock dead", () => {
    const path = lockPathIn();
    writeFileSync(path, "4242\n");
    const theirs = "5151 fedcba987654\n";
    // The liveness check runs between reading the dead lock and clearing it: in that window another process clears
    // the same dead lock and takes its own, exactly the interleaving that once let both believe they held it.
    const otherTakesItFirst = (): boolean => {
      rmSync(path);
      writeFileSync(path, theirs);
      return false;
    };
    const refusal = unwrapErr(takePrivateTermsLock({ path, pidAlive: otherTakesItFirst }));
    expect(refusal).toStrictEqual({ kind: "held", why: "another edit took it as a stale one was being cleared" });
    expect(readFileSync(path, "utf8")).toBe(theirs);
    expect(readdirSync(join(path, ".."))).toStrictEqual(["private-terms.tsv.lock"]);
  });
});

describe("releasePrivateTermsLock", () => {
  it("never removes a lock whose bytes are not this holder's token", () => {
    const path = lockPathIn();
    const lock = unwrap(takePrivateTermsLock({ path, pidAlive: () => false }));
    writeFileSync(path, "5151 fedcba987654\n");
    releasePrivateTermsLock({ lock });
    expect(readFileSync(path, "utf8")).toBe("5151 fedcba987654\n");
  });

  it("does nothing when the lock is already gone", () => {
    const path = lockPathIn();
    const lock = unwrap(takePrivateTermsLock({ path, pidAlive: () => false }));
    rmSync(path);
    releasePrivateTermsLock({ lock });
    expect(existsSync(path)).toBe(false);
  });
});
