/**
 * The home's runtime directory (`../../stateRuntime.ts`): one per home and user, owner-only, refused when another
 * user could reach it — and the fleet's two locks taken there, free the instant their holder releases them.
 *
 * `TMPDIR` and the runtime root are this file's own sandbox (`../setup-temp-root.ts`), so every directory made here is
 * removed with it.
 */
import { chmodSync, mkdtempSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireCmuxReviveLock, acquireFleetLock } from "../../fleet/locks.js";
import { unwrap, unwrapErr } from "../../lib/result.js";
import { homeRuntimeDir, RUNTIME_ROOT_VAR, runtimeCmuxDir, runtimeLockDir } from "../../stateRuntime.js";

const NOW = "2026-10-31T09:00:00.000Z";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "runtime-home-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("homeRuntimeDir", () => {
  it("is owner-only, under this user's own root, and the same for two spellings of one home", () => {
    const direct = unwrap(homeRuntimeDir({ home }));
    const linked = join(dirname(home), `${home.split("/").at(-1)!}-link`);
    symlinkSync(home, linked);
    const viaLink = unwrap(homeRuntimeDir({ home: linked }));
    rmSync(linked, { force: true });
    const uid = process.getuid!();
    expect([viaLink, statSync(direct).mode & 0o777, statSync(dirname(direct)).mode & 0o777, dirname(direct)]).toEqual([
      direct,
      0o700,
      0o700,
      join(process.env[RUNTIME_ROOT_VAR]!, `slopweaver-${String(uid)}`),
    ]);
  });

  it("is the same directory, and so the same lock, whatever TMPDIR the process inherited", () => {
    const before = unwrap(homeRuntimeDir({ home }));
    const held = unwrap(acquireFleetLock({ home, nowIso: NOW }));
    const inherited = process.env["TMPDIR"];
    const elsewhere = mkdtempSync(join(tmpdir(), "other-tmpdir-"));
    process.env["TMPDIR"] = elsewhere;
    const after = unwrap(homeRuntimeDir({ home }));
    const second = acquireFleetLock({ home, nowIso: NOW });
    process.env["TMPDIR"] = inherited;
    held.release();
    rmSync(elsewhere, { force: true, recursive: true });
    expect([after, unwrapErr(second).code]).toEqual([before, "LOCK_HELD"]);
  });

  it("gives two homes two directories", () => {
    const other = mkdtempSync(join(tmpdir(), "runtime-other-"));
    const pair = [unwrap(homeRuntimeDir({ home })), unwrap(homeRuntimeDir({ home: other }))];
    rmSync(other, { force: true, recursive: true });
    expect(pair[0]).not.toBe(pair[1]);
  });

  it("names the lock and cmux directories inside it", () => {
    const runtime = unwrap(homeRuntimeDir({ home }));
    expect([unwrap(runtimeLockDir({ home })), unwrap(runtimeCmuxDir({ home }))]).toEqual([
      join(runtime, "operation-locks"),
      join(runtime, "cmux"),
    ]);
  });

  it("refuses a home with no real path rather than hashing whatever string arrived", () => {
    const refused = unwrapErr(homeRuntimeDir({ home: join(home, "missing") }));
    expect([refused.code, refused.message]).toEqual([
      "RUNTIME_DIRECTORY_UNAVAILABLE",
      expect.stringContaining("has no real path"),
    ]);
  });

  it("refuses a user root another user could read", () => {
    const root = dirname(unwrap(homeRuntimeDir({ home })));
    chmodSync(root, 0o755);
    const refused = unwrapErr(homeRuntimeDir({ home }));
    chmodSync(root, 0o700);
    expect(refused.message).toContain("is open to other users (mode 755)");
  });

  it("refuses a runtime root inside the home, so no lock is carried into it", () => {
    const inherited = process.env[RUNTIME_ROOT_VAR];
    process.env[RUNTIME_ROOT_VAR] = home;
    const refused = unwrapErr(acquireFleetLock({ home, nowIso: NOW }));
    process.env[RUNTIME_ROOT_VAR] = inherited;
    expect([refused.code, refused.message]).toEqual([
      "RUNTIME_UNAVAILABLE",
      expect.stringContaining("is inside the home"),
    ]);
  });

  it("refuses a home of the filesystem root, which every runtime root sits inside", () => {
    const refused = unwrapErr(homeRuntimeDir({ home: "/" }));
    expect([refused.code, refused.message]).toEqual([
      "RUNTIME_DIRECTORY_UNAVAILABLE",
      expect.stringContaining("is inside the home /"),
    ]);
  });

  it("refuses a home's directory planted as a link, so no lock is carried into the home", () => {
    const directory = unwrap(homeRuntimeDir({ home }));
    rmSync(directory, { force: true, recursive: true });
    symlinkSync(home, directory);
    const refused = unwrapErr(acquireFleetLock({ home, nowIso: NOW }));
    rmSync(directory, { force: true });
    expect([refused.code, refused.message]).toEqual([
      "RUNTIME_UNAVAILABLE",
      expect.stringContaining(`${directory} is not a directory`),
    ]);
  });
});

describe("the fleet's runtime locks", () => {
  it("hold out a second taker of the same lock and free on release, each lock apart from the other", () => {
    const held = unwrap(acquireFleetLock({ home, nowIso: NOW }));
    const second = unwrapErr(acquireFleetLock({ home, nowIso: NOW }));
    const revive = acquireCmuxReviveLock({ home, nowIso: NOW });
    held.release();
    const again = acquireFleetLock({ home, nowIso: NOW });
    expect([second.code, revive.isOk(), again.isOk()]).toEqual(["LOCK_HELD", true, true]);
    unwrap(revive).release();
    unwrap(again).release();
  });

  it("refuses as RUNTIME_UNAVAILABLE, never LOCK_HELD, when the runtime directory cannot be trusted", () => {
    const refused = unwrapErr(acquireFleetLock({ home: join(home, "missing"), nowIso: NOW }));
    expect(refused.code).toBe("RUNTIME_UNAVAILABLE");
  });
});
