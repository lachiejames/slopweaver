/**
 * Proves the SHIPPED `bin/slopweaver atlas vanta sync` resolves its credentials from the secrets store when the
 * environment carries nothing — the exact shape a scheduled `vanta-atlas-sync` slot runs in, where there is
 * no shell to export `VANTA_CLIENT_ID` from. Measured: every such slot had exited 3 ("credentials
 * not configured") because the verb read only `process.env`, and the atlas went stale until a
 * human exported the pair by hand.
 *
 * `HOME` and `PATH` are the only inherited environment, so a passing run proves the store alone suffices.
 * The positive witness needs no network: the test HOLDS the application's token-mint lock, so a verb that
 * resolved credentials gets exactly as far as trying to mint and is refused there — a step a verb that never
 * resolved them cannot reach. The same run with the lock released would go on to `api.vanta.com`, which is
 * why the lock is held for the whole spawn and released in `finally`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireOperationLock } from "../../../../../admit/operationLock.js";
import { vantaMintLockKey } from "../../../../../atlas/vanta/oauth.js";
import type { VantaSyncReport } from "../../../../../atlas/vanta/sync.js";
import { unwrap } from "../../../../../lib/result.js";
import { writeSecretFile } from "../../../../../secrets/store.js";
import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

const STORED_CLIENT_ID = "stored-vanta-client-id";
const STORED_CLIENT_SECRET = "stored-vanta-client-secret";

let isolatedHome: string;
let stateHome: string;
beforeEach(() => {
  isolatedHome = mkdtempSync(join(tmpdir(), "slop-vanta-sync-store-"));
  stateHome = join(isolatedHome, "state");
});
afterEach(() => {
  rmSync(isolatedHome, { force: true, recursive: true });
});

/** Run the shipped binary with a minimal, isolated environment — never the real machine's config/tokens. */
function runVantaSync({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(BIN, ["atlas", "vanta", "sync", "--home", stateHome, ...args], {
      cwd: isolatedHome,
      encoding: "utf8",
      env: { ...accountSandboxChildEnv(), HOME: isolatedHome, PATH: process.env["PATH"]! },
      maxBuffer: 4 * 1024 * 1024,
    });
    return { status: 0, stderr: "", stdout };
  } catch (error: unknown) {
    // A non-zero exit always carries these — execFileSync sets them whenever the subprocess actually ran
    // with `encoding` given; an undefined status would mean it never spawned, a failure this test is not
    // exercising.
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, stderr: e.stderr, stdout: e.stdout };
  }
}

describe("bin/slopweaver atlas vanta sync — credentials from the secrets store", () => {
  it("exits 3 and names the store route when neither the environment nor the store holds the pair", () => {
    const result = runVantaSync({ args: [] });
    expect(result.status).toBe(3);
    expect(result.stdout).toContain("vanta sync: credentials are not configured");
    expect(result.stdout).toContain("slopweaver secrets set vanta-client-id");
  });

  it("gets as far as minting a token from a populated store with an empty environment", () => {
    unwrap(writeSecretFile({ home: stateHome, name: "vanta-client-id", value: STORED_CLIENT_ID }));
    unwrap(writeSecretFile({ home: stateHome, name: "vanta-client-secret", value: STORED_CLIENT_SECRET }));
    const held = unwrap(
      acquireOperationLock({
        home: stateHome,
        key: vantaMintLockKey({ clientId: STORED_CLIENT_ID }),
        nowIso: new Date().toISOString(),
      }),
    );
    let result: { status: number; stdout: string; stderr: string };
    try {
      result = runVantaSync({ args: ["--json"] });
    } finally {
      held.release();
    }
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as VantaSyncReport;
    expect(report.credentialsConfigured).toBe(true);
    expect(report.kinds.length).toBeGreaterThan(0);
    for (const kind of report.kinds) {
      expect(kind.complete).toBe(false);
      expect(kind.reasons.join(" ")).toContain("could not acquire the Vanta token mint lock");
    }
  });
});
