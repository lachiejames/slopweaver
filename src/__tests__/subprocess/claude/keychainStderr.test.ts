/**
 * The Claude keychain read's PRODUCTION reader keeps `security`'s stderr off the terminal.
 *
 * Found on a first boot over an empty `$SLOPWEAVER_HOME`: two
 * `plans add --provider claude`, then `slopweaver claude signin --status`, printed
 * `security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.` once per plan,
 * above a status that already said each store needed a sign-in. An absent item is an ordinary answer to
 * `readCredentialDocument` (it returns `undefined`), so the line was the child's inherited stderr, not a fault.
 *
 * This cannot live on the unit lane: the unit seam replaces the whole `execFileSync` call, so no injected reader
 * fails when the `stdio` option is removed. Here the real reader runs in a child process with a fake `security`
 * first on `PATH`, which writes a marker on stderr and exits 44 (the item-absent status). The witness is
 * positive first — the fake ran, once per read — and only then is the marker's ABSENCE from the child's stderr
 * evidence of anything.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const KEYCHAIN = join(repoRoot, "src", "claude", "keychain.ts");

/** The TypeScript loader, handed to `node` directly — `../lib/stdoutDataChannel.test.ts` § TSX_LOADER. */
const TSX_LOADER = import.meta.resolve("tsx");

/** What the fake `security` writes on stderr — unique, so its absence cannot be a coincidence of wording. */
const MARKER = "FAKE-SECURITY-STDERR-7f3c";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A directory holding a fake `security` that counts its runs, writes {@link MARKER} on stderr, and exits 44.
 *
 * @returns the directory to put first on `PATH`, and the file each run appends one line to
 */
function fakeSecurity(): { bin: string; runs: string } {
  const root = mkdtempSync(join(tmpdir(), "sw-keychain-"));
  dirs.push(root);
  const bin = join(root, "bin");
  mkdirSync(bin);
  const runs = join(root, "runs.txt");
  const fake = join(bin, "security");
  writeFileSync(
    fake,
    [
      "#!/usr/bin/env node",
      `require("node:fs").appendFileSync(${JSON.stringify(runs)}, "run\\n");`,
      `process.stderr.write(${JSON.stringify(`security: ${MARKER}\n`)});`,
      "process.exit(44);",
    ].join("\n"),
    "utf8",
  );
  chmodSync(fake, 0o755);
  return { bin, runs };
}

describe("readCredentialDocument's production reader", () => {
  it("answers undefined for an absent item and keeps security's stderr off the terminal", () => {
    const { bin, runs } = fakeSecurity();
    const script = join(dirname(runs), "read.mts");
    writeFileSync(
      script,
      [
        `import { readCredentialDocument } from ${JSON.stringify(KEYCHAIN)};`,
        `const first = readCredentialDocument({ storeDir: "/nonexistent/plan-one" });`,
        `const second = readCredentialDocument({ storeDir: "/nonexistent/plan-two" });`,
        `process.stdout.write(JSON.stringify([first === undefined, second === undefined]));`,
      ].join("\n"),
      "utf8",
    );
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env["PATH"]!}` };
    delete env["NODE_OPTIONS"];
    const child = spawnSync(process.execPath, ["--import", TSX_LOADER, script], {
      encoding: "utf8",
      env,
      killSignal: "SIGKILL",
      timeout: 30_000,
    });

    expect(child.status).toBe(0);
    expect(readFileSync(runs, "utf8")).toBe("run\nrun\n");
    expect(child.stdout).toBe("[true,true]");
    expect(child.stderr).not.toContain(MARKER);
  });
});
