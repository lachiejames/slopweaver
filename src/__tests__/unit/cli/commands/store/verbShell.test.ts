/**
 * The shell the three `store` backup verbs share, tested where it decides something.
 *
 * The destination resolves against a sandbox home on every case; the remembered case writes the secret into
 * it, which wins over nothing only because no test here exports `SLOPWEAVER_BACKUP_DIRECTORY`. What is under
 * test is the fold — destination into one transport, the key into one reader — and the two exit codes a
 * refusal and a failure return. The Keychain itself is never read here.
 */
import {
  existsSync,
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
import { dirname, isAbsolute, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { reportCopyMasterPassword } from "../../../../../cli/commands/store/backupMasterPassword.js";
import {
  allErrors,
  destinationReader,
  fail,
  refuse,
  resolveDestination,
  resolvedHome,
} from "../../../../../cli/commands/store/verbShell.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stagingRoot } from "../../../../../store/backup/staging.js";

const minted: string[] = [];

afterEach(() => {
  minted.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/**
 * A throwaway home with a `secrets/` directory, removed after the test that minted it.
 *
 * @returns its absolute path
 */
function sandboxHome(): string {
  const parent = mkdtempSync(join(tmpdir(), "store-verb-shell-"));
  minted.push(parent);
  const home = join(parent, "home");
  mkdirSync(join(home, "secrets"), { recursive: true });
  return home;
}

/**
 * A destination beside the sandbox home — inside it is refused.
 *
 * @param home the sandbox home
 * @param name the destination's own directory name
 * @returns the destination root
 */
function besideHome({ home, name }: { home: string; name: string }): string {
  return join(dirname(home), name);
}

describe("resolvedHome", () => {
  it("takes the flag's home when one was passed", () => {
    expect(resolvedHome({ home: "/somewhere/else" })).toBe("/somewhere/else");
  });

  it("falls back to an absolute state home of its own when the flag was absent", () => {
    // Not asserted against the environment variable: `home-safety` refuses a test-tree read of it, because
    // the ambient-home sandbox is installed in a `beforeAll` and a read would reach the operator's real home.
    // What is checkable here without one is that the absent case resolves SOMETHING absolute rather than
    // leaking the word `undefined` into a path, and that a passed home still wins over it.
    const resolved = resolvedHome({ home: undefined });
    expect(isAbsolute(resolved)).toBe(true);
    expect(resolved).not.toContain("undefined");
    expect(resolvedHome({ home: "/somewhere/else" })).not.toBe(resolved);
  });
});

describe("resolveDestination", () => {
  it("builds a transport over the named directory without creating it on a probe", () => {
    const home = sandboxHome();
    const root = besideHome({ home, name: "not-yet" });
    const resolved = unwrap(resolveDestination({ home, override: root }));
    expect([resolved.root, resolved.origin, existsSync(root)]).toEqual([root, "flag", false]);
    expect(Object.keys(resolved.transport).toSorted()).toEqual([
      "download",
      "holds",
      "list",
      "objectSizes",
      "probe",
      "remove",
      "upload",
    ]);
  });

  it("makes the directory 0700 for a writing run", () => {
    const home = sandboxHome();
    const root = join(besideHome({ home, name: "made" }), "here");
    unwrap(resolveDestination({ create: true, home, override: root }));
    expect(statSync(root).mode & 0o777).toBe(0o700);
  });

  it("reads the remembered destination from the home's secrets", () => {
    const home = sandboxHome();
    const root = besideHome({ home, name: "remembered" });
    writeFileSync(join(home, "secrets", "store-backup-directory"), `${root}\n`, { mode: 0o600 });
    const resolved = unwrap(resolveDestination({ home, override: null }));
    expect([resolved.root, resolved.origin]).toEqual([root, "remembered"]);
  });

  it("refuses a destination equal to the home, or inside it, before making anything", () => {
    const home = sandboxHome();
    const inside = join(home, "dest");
    expect(unwrapErr(resolveDestination({ create: true, home, override: home })).join("\n")).toContain(
      "the Slopweaver home",
    );
    const refused = unwrapErr(resolveDestination({ create: true, home, override: inside }));
    expect(refused).toEqual([
      `the backup destination ${inside} and the Slopweaver home ${home} sit one inside the other — this run writes plaintext there, and the destination holds only encrypted objects; name a destination outside it`,
    ]);
    expect(existsSync(inside)).toBe(false);
  });

  it("refuses a destination the home's staging tree is linked into, though the home itself sits beside it", () => {
    const home = sandboxHome();
    const destination = besideHome({ home, name: "dest" });
    mkdirSync(destination);
    const linkAt = dirname(stagingRoot({ home }));
    mkdirSync(dirname(linkAt), { recursive: true });
    symlinkSync(destination, linkAt);
    const refused = unwrapErr(resolveDestination({ create: true, home, override: destination }));
    expect(refused).toEqual([
      `the backup destination ${destination} and the backup staging root ${stagingRoot({ home })} sit one inside the other — this run writes plaintext there, and the destination holds only encrypted objects; name a destination outside it`,
    ]);
    // Refused before the mkdir that would follow the link: the destination gained no `store` directory.
    expect(readdirSync(destination)).toEqual([]);
  });

  it("refuses before making the staging root, and removes a destination it made only to refuse", () => {
    const home = sandboxHome();
    const inside = join(home, "fresh-destination");
    expect(existsSync(stagingRoot({ home }))).toBe(false);
    expect(unwrapErr(resolveDestination({ create: true, home, override: inside })).join("\n")).toContain(
      "the Slopweaver home",
    );
    expect(existsSync(inside)).toBe(false);
    expect(existsSync(stagingRoot({ home }))).toBe(false);
  });

  it("makes the staging root once a destination beside the home is clear", () => {
    const home = sandboxHome();
    const destination = besideHome({ home, name: "dest" });
    expect(resolveDestination({ create: true, home, override: destination }).isOk()).toBe(true);
    expect(statSync(stagingRoot({ home })).isDirectory()).toBe(true);
  });

  it("refuses a relative destination", () => {
    const lines = unwrapErr(resolveDestination({ home: sandboxHome(), override: "relative/dir" }));
    expect(lines.join("\n")).toContain("relative/dir");
  });
});

describe("destinationReader", () => {
  it("refuses to open a destination when the Keychain holds no backup key", () => {
    const lines = unwrapErr(destinationReader({ key: null })({ root: "/Volumes/Backup" }));
    expect(lines).toEqual([
      "/Volumes/Backup holds objects encrypted under the backup key, and the login Keychain holds no backup key to open them",
    ]);
  });

  it("opens what the encrypting transport wrote under the same key", async () => {
    const home = sandboxHome();
    const root = join(home, "dest");
    const key = Buffer.alloc(32, 7);
    const source = join(home, "plain.txt");
    writeFileSync(source, "a backed-up line");
    const reader = unwrap(destinationReader({ key })({ root }));
    unwrap(await reader.upload({ objectName: "p/o", path: source }));
    expect(readFileSync(join(root, "p", "o")).includes("a backed-up line")).toBe(false);
    const back = join(home, "back.txt");
    unwrap(await reader.download({ objectName: "p/o", path: back }));
    expect(readFileSync(back, "utf8")).toBe("a backed-up line");
  });
});

describe("refuse and fail", () => {
  it("returns the usage exit code, which is not the error one", () => {
    expect(refuse({ lines: ["--from is required"], usage: "usage: slopweaver store restore …" })).toBe(EXIT_USAGE);
    expect(EXIT_USAGE).not.toBe(EXIT_ERROR);
  });

  it("returns the error exit code for a run that got past its parse", () => {
    expect(fail({ lines: ["the dump did not verify"] })).toBe(EXIT_ERROR);
  });
});

describe("allErrors", () => {
  it("collects every failing resolution's lines in order, skipping the ones that resolved", () => {
    const lines = allErrors({ results: [err(["no destination"]), ok("key"), err(["no password", "and why"])] });

    expect(lines).toEqual(["no destination", "no password", "and why"]);
  });

  it("is empty when every resolution succeeded", () => {
    expect(allErrors({ results: [ok(1), ok(null)] })).toEqual([]);
  });
});

describe("store backup --copy-master-password", () => {
  it("refuses a home with no master password set, before anything reaches the clipboard", () => {
    const home = sandboxHome();

    expect(reportCopyMasterPassword({ home, json: false })).toBe(EXIT_ERROR);
    expect(readdirSync(join(home, "secrets"))).toEqual([]);
  });
});
