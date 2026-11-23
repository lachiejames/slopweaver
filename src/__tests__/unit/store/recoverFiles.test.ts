/**
 * `store recover`'s disk edge, round-tripped through throwaway directories: what is absent is moved in, what is
 * byte-identical is skipped, what differs — a symlink included — is LEFT in staging, credentials land at 0600
 * with their plaintext staging copy removed, and the marker a re-run resumes from reads back as it was written.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  clearStaging,
  installStagedFiles,
  makeRecoverStaging,
  readRecoverMarker,
  recoverStagingDirectory,
  writeRecoverMarker,
} from "../../../store/backup/recoverFiles.js";
import type { RecoverMarker } from "../../../store/backup/recoverPlan.js";
import { installStagedSecrets } from "../../../store/backup/recoverSecrets.js";
import { stagingRoot } from "../../../store/backup/staging.js";

/** The home's own `store-url`, as `yarn store:start` wrote it: the lock's login on the stack's default database. */
const HOME_STORE_URL = "postgresql://slopweaver_lock:lock-pass@127.0.0.1:55322/postgres";

/** The same login, host and port, naming the recovered database. */
const RECOVERED_STORE_URL = "postgresql://slopweaver_lock:lock-pass@127.0.0.1:55322/store_recovered";

const minted: string[] = [];

afterEach(() => {
  minted.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/**
 * A throwaway directory removed after the test that minted it.
 *
 * @returns its absolute path
 */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "recover-files-"));
  minted.push(dir);
  return dir;
}

/**
 * Write a file, making its parent.
 *
 * @param path where
 * @param contents what
 */
function put({ path, contents }: { path: string; contents: string }): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

describe("recoverStagingDirectory", () => {
  it("names one directory per backup under the staging root", () => {
    expect(recoverStagingDirectory({ home: "/h", prefix: "slopweaver/2026-09-29T17-12-51-910Z/" })).toBe(
      join(stagingRoot({ home: "/h" }), "recover", "slopweaver_2026-09-29T17-12-51-910Z"),
    );
  });
});

describe("makeRecoverStaging", () => {
  it("refuses a planted recover link and makes nothing in its target", () => {
    const home = join(scratch(), "home");
    const target = scratch();
    mkdirSync(stagingRoot({ home }), { recursive: true });
    const link = join(stagingRoot({ home }), "recover");
    symlinkSync(target, link);

    const refused = unwrapErr(makeRecoverStaging({ home, prefix: "slopweaver/2026-11-04T00-00-00-000Z/" }));

    expect(refused.code).toBe("RECOVER_STEP_FAILED");
    expect(refused.message).toContain(`${link} is a link or not a directory`);
    expect(readdirSync(target)).toEqual([]);
  });
});

describe("clearStaging", () => {
  it("removes a link planted at a staging child, never what it points at", () => {
    const staging = scratch();
    const target = scratch();
    put({ contents: "keep", path: join(target, "victim") });
    const link = join(staging, "secrets");
    symlinkSync(target, link);

    clearStaging({ path: link });

    expect(existsSync(link)).toBe(false);
    expect(readFileSync(join(target, "victim"), "utf8")).toBe("keep");
  });
});

describe("installStagedFiles", () => {
  it("moves what the home lacks, skips what it holds identically, and removes the emptied staging", () => {
    const staged = join(scratch(), "files");
    const home = scratch();
    put({ contents: "board", path: join(staged, "handovers", "a.md") });
    put({ contents: "same", path: join(staged, "profile.json") });
    put({ contents: "same", path: join(home, "profile.json") });

    const report = unwrap(installStagedFiles({ home, staged }));

    expect(report).toEqual({ conflicts: [], identical: 1, replaced: [], written: 1 });
    expect(readFileSync(join(home, "handovers", "a.md"), "utf8")).toBe("board");
    expect(existsSync(staged)).toBe(false);
  });

  it("never overwrites a file that differs, and leaves the staged copy for a person to compare", () => {
    const staged = join(scratch(), "files");
    const home = scratch();
    put({ contents: "from the backup", path: join(staged, "profile.json") });
    put({ contents: "already here", path: join(home, "profile.json") });

    const report = unwrap(installStagedFiles({ home, staged }));

    expect(report).toEqual({ conflicts: ["profile.json"], identical: 0, replaced: [], written: 0 });
    expect(readFileSync(join(home, "profile.json"), "utf8")).toBe("already here");
    expect(readFileSync(join(staged, "profile.json"), "utf8")).toBe("from the backup");
  });

  it("never writes through a symlink the home holds", () => {
    const staged = join(scratch(), "files");
    const home = scratch();
    const elsewhere = join(scratch(), "target.json");
    put({ contents: "from the backup", path: join(staged, "profile.json") });
    put({ contents: "outside the home", path: elsewhere });
    symlinkSync(elsewhere, join(home, "profile.json"));

    const report = unwrap(installStagedFiles({ home, staged }));

    expect(report.conflicts).toEqual(["profile.json"]);
    expect(readFileSync(elsewhere, "utf8")).toBe("outside the home");
    expect(lstatSync(join(home, "profile.json")).isSymbolicLink()).toBe(true);
  });

  it("refuses a file a directory link in the home would carry into the backup destination", () => {
    const staged = join(scratch(), "files");
    const home = scratch();
    const destination = scratch();
    const collateral = join(destination, "collateral");
    mkdirSync(collateral);
    put({ contents: "board", path: join(staged, "handovers", "a.md") });
    symlinkSync(collateral, join(home, "handovers"));

    const refused = unwrapErr(installStagedFiles({ destination, home, staged }));

    expect(refused.code).toBe("RECOVER_STEP_FAILED");
    expect(refused.message).toContain(`inside the backup destination ${destination}; nothing was written`);
    expect(existsSync(join(collateral, "a.md"))).toBe(false);
    expect(readFileSync(join(staged, "handovers", "a.md"), "utf8")).toBe("board");
  });

  it("installs through a home link that points outside the destination", () => {
    const staged = join(scratch(), "files");
    const home = scratch();
    const external = scratch();
    put({ contents: "board", path: join(staged, "handovers", "a.md") });
    symlinkSync(external, join(home, "handovers"));

    const report = unwrap(installStagedFiles({ destination: scratch(), home, staged }));

    expect(report).toEqual({ conflicts: [], identical: 0, replaced: [], written: 1 });
    expect(readFileSync(join(external, "a.md"), "utf8")).toBe("board");
  });

  it("installs nothing from a staging directory that does not exist", () => {
    const home = scratch();

    expect(unwrap(installStagedFiles({ home, staged: join(home, "absent") }))).toEqual({
      conflicts: [],
      identical: 0,
      replaced: [],
      written: 0,
    });
  });
});

describe("installStagedSecrets", () => {
  it("writes each credential at 0600 in a 0700 directory and removes its plaintext staging copy", () => {
    const staged = join(scratch(), "secrets");
    const home = scratch();
    put({ contents: "xoxb-fixture", path: join(staged, "slack-bot-token") });

    const report = unwrap(
      installStagedSecrets({
        derived: [
          {
            name: "store-url",
            replaceDatabaseOnly: true,
            value: "postgresql://postgres:postgres@127.0.0.1:55322/store_recovered",
          },
        ],
        home,
        names: ["slack-bot-token"],
        staged,
      }),
    );

    expect(report).toEqual({ conflicts: [], identical: 0, replaced: [], written: 2 });
    expect(readFileSync(join(home, "secrets", "slack-bot-token"), "utf8")).toBe("xoxb-fixture");
    expect(readFileSync(join(home, "secrets", "store-url"), "utf8")).toBe(
      "postgresql://postgres:postgres@127.0.0.1:55322/store_recovered",
    );
    expect(statSync(join(home, "secrets", "slack-bot-token")).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, "secrets")).mode & 0o777).toBe(0o700);
    expect(existsSync(join(staged, "slack-bot-token"))).toBe(false);
  });

  it("skips an identical credential and leaves a differing one staged, the home's untouched", () => {
    const staged = join(scratch(), "secrets");
    const home = scratch();
    put({ contents: "same", path: join(staged, "linear-api-key") });
    put({ contents: "from the backup", path: join(staged, "slack-bot-token") });
    put({ contents: "same", path: join(home, "secrets", "linear-api-key") });
    put({ contents: "minted on this machine", path: join(home, "secrets", "slack-bot-token") });

    const report = unwrap(
      installStagedSecrets({ derived: [], home, names: ["linear-api-key", "slack-bot-token"], staged }),
    );

    expect(report).toEqual({ conflicts: ["secrets/slack-bot-token"], identical: 1, replaced: [], written: 0 });
    expect(readFileSync(join(home, "secrets", "slack-bot-token"), "utf8")).toBe("minted on this machine");
    expect(existsSync(join(staged, "slack-bot-token"))).toBe(true);
    expect(existsSync(join(staged, "linear-api-key"))).toBe(false);
  });

  it("repoints the home's own store-url at the recovered database when that is the only difference", () => {
    const staged = join(scratch(), "secrets");
    const home = scratch();
    put({ contents: HOME_STORE_URL, path: join(home, "secrets", "store-url") });

    const report = unwrap(
      installStagedSecrets({
        derived: [{ name: "store-url", replaceDatabaseOnly: true, value: RECOVERED_STORE_URL }],
        home,
        names: [],
        staged,
      }),
    );

    expect(report).toEqual({
      conflicts: [],
      identical: 0,
      replaced: [{ newDatabase: "store_recovered", oldDatabase: "postgres", path: "secrets/store-url" }],
      written: 0,
    });
    expect(readFileSync(join(home, "secrets", "store-url"), "utf8")).toBe(RECOVERED_STORE_URL);
    expect(statSync(join(home, "secrets", "store-url")).mode & 0o777).toBe(0o600);
    expect(existsSync(join(staged, "store-url"))).toBe(false);
  });

  it("reads the replaced store-url as identical on a re-run, replacing nothing twice", () => {
    const staged = join(scratch(), "secrets");
    const home = scratch();
    put({ contents: HOME_STORE_URL, path: join(home, "secrets", "store-url") });
    const derived = [{ name: "store-url", replaceDatabaseOnly: true, value: RECOVERED_STORE_URL }];
    unwrap(installStagedSecrets({ derived, home, names: [], staged }));

    const again = unwrap(installStagedSecrets({ derived, home, names: [], staged }));

    expect(again).toEqual({ conflicts: [], identical: 1, replaced: [], written: 0 });
  });

  it.each([
    ["the password", "postgresql://slopweaver_lock:other-pass@127.0.0.1:55322/postgres"],
    ["the host", "postgresql://slopweaver_lock:lock-pass@localhost:55322/postgres"],
    ["the port", "postgresql://slopweaver_lock:lock-pass@127.0.0.1:54322/postgres"],
  ])("stages a derived store-url whose %s differs too, at 0600, and leaves the home's", (_field, present) => {
    const staged = join(scratch(), "secrets");
    const home = scratch();
    put({ contents: present, path: join(home, "secrets", "store-url") });

    const report = unwrap(
      installStagedSecrets({
        derived: [{ name: "store-url", replaceDatabaseOnly: true, value: RECOVERED_STORE_URL }],
        home,
        names: [],
        staged,
      }),
    );

    expect(report).toEqual({ conflicts: ["secrets/store-url"], identical: 0, replaced: [], written: 0 });
    expect(readFileSync(join(home, "secrets", "store-url"), "utf8")).toBe(present);
    expect(readFileSync(join(staged, "store-url"), "utf8")).toBe(RECOVERED_STORE_URL);
    expect(statSync(join(staged, "store-url")).mode & 0o777).toBe(0o600);
  });

  it("never lets a store-url derived from the environment replace the home's, even by database alone", () => {
    const staged = join(scratch(), "secrets");
    const home = scratch();
    put({ contents: HOME_STORE_URL, path: join(home, "secrets", "store-url") });

    const report = unwrap(
      installStagedSecrets({
        derived: [{ name: "store-url", replaceDatabaseOnly: false, value: RECOVERED_STORE_URL }],
        home,
        names: [],
        staged,
      }),
    );

    expect(report).toEqual({ conflicts: ["secrets/store-url"], identical: 0, replaced: [], written: 0 });
    expect(readFileSync(join(home, "secrets", "store-url"), "utf8")).toBe(HOME_STORE_URL);
  });

  it("never lets a store-url a bundle staged replace the home's, even by database alone", () => {
    const staged = join(scratch(), "secrets");
    const home = scratch();
    put({ contents: RECOVERED_STORE_URL, path: join(staged, "store-url") });
    put({ contents: HOME_STORE_URL, path: join(home, "secrets", "store-url") });

    const report = unwrap(installStagedSecrets({ derived: [], home, names: ["store-url"], staged }));

    expect(report).toEqual({ conflicts: ["secrets/store-url"], identical: 0, replaced: [], written: 0 });
    expect(readFileSync(join(home, "secrets", "store-url"), "utf8")).toBe(HOME_STORE_URL);
  });

  it("never replaces through a link standing at the home's store-url", () => {
    const staged = join(scratch(), "secrets");
    const home = scratch();
    const elsewhere = join(scratch(), "store-url");
    put({ contents: HOME_STORE_URL, path: elsewhere });
    mkdirSync(join(home, "secrets"), { recursive: true });
    symlinkSync(elsewhere, join(home, "secrets", "store-url"));

    const report = unwrap(
      installStagedSecrets({
        derived: [{ name: "store-url", replaceDatabaseOnly: true, value: RECOVERED_STORE_URL }],
        home,
        names: [],
        staged,
      }),
    );

    expect(report.conflicts).toEqual(["secrets/store-url"]);
    expect(report.replaced).toEqual([]);
    expect(readFileSync(elsewhere, "utf8")).toBe(HOME_STORE_URL);
    expect(lstatSync(join(home, "secrets", "store-url")).isSymbolicLink()).toBe(true);
  });

  it("never stages a typed master password the home holds differently, but still names the conflict", () => {
    const staged = join(scratch(), "secrets");
    const home = scratch();
    put({ contents: "q".repeat(26), path: join(home, "secrets", "backup-passphrase") });

    const report = unwrap(
      installStagedSecrets({
        derived: [{ name: "backup-passphrase", replaceDatabaseOnly: false, value: "p".repeat(26) }],
        home,
        names: [],
        staged,
      }),
    );

    expect(report).toEqual({
      conflicts: ["secrets/backup-passphrase (NOT staged: the password typed differs from the one this home holds)"],
      identical: 0,
      replaced: [],
      written: 0,
    });
    expect(readFileSync(join(home, "secrets", "backup-passphrase"), "utf8")).toBe("q".repeat(26));
    expect(existsSync(join(staged, "backup-passphrase"))).toBe(false);
  });

  it("writes a typed master password the home lacks as its own file alone, at 0600", () => {
    const staged = join(scratch(), "secrets");
    const home = scratch();

    const report = unwrap(
      installStagedSecrets({
        derived: [{ name: "backup-passphrase", replaceDatabaseOnly: false, value: "p".repeat(26) }],
        home,
        names: [],
        staged,
      }),
    );

    expect(report).toEqual({ conflicts: [], identical: 0, replaced: [], written: 1 });
    expect(readdirSync(join(home, "secrets"))).toEqual(["backup-passphrase"]);
    expect(readFileSync(join(home, "secrets", "backup-passphrase"), "utf8")).toBe("p".repeat(26));
    expect(statSync(join(home, "secrets", "backup-passphrase")).mode & 0o777).toBe(0o600);
  });

  it("names a staged credential that is missing rather than writing half the set", () => {
    const home = scratch();

    const result = installStagedSecrets({ derived: [], home, names: ["absent"], staged: join(home, "nowhere") });

    expect(unwrapErr(result)).toMatchObject({ code: "RECOVER_STEP_FAILED", step: "installing the credentials" });
  });
});

describe("the recovery marker", () => {
  it("reads back exactly what was written, at 0600", () => {
    const path = join(scratch(), "marker.json");
    const marker: RecoverMarker = {
      database: "store_recovered",
      databaseRestoredAtIso: "2026-09-30T02:00:00.000Z",
      filesRestoredAtIso: null,
      prefix: "slopweaver/2026-09-29T17-12-51-910Z/",
      secretsInstalledAtIso: null,
    };

    unwrap(writeRecoverMarker({ marker, path }));

    expect(readRecoverMarker({ path })).toEqual(marker);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("reads as nothing when absent or not JSON", () => {
    const dir = scratch();
    put({ contents: "{not json", path: join(dir, "bad.json") });

    expect(readRecoverMarker({ path: join(dir, "absent.json") })).toBe(null);
    expect(readRecoverMarker({ path: join(dir, "bad.json") })).toBe(null);
  });
});
