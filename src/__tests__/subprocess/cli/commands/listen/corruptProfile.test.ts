/**
 * `listen` will not start on a `profile.json` that is there but corrupt, proved through the SHIPPED binary.
 *
 * Why this cannot live on the unit lane: the property is an ORDERING inside the verb — the corrupt profile is
 * refused as a fault (exit 1) before the token branch would report a prerequisite absent (exit 3), and before
 * anything connects. Only spawning the binary proves the file on disk reaches that refusal. Both tokens are
 * written as obviously-fake secrets so the refusal is the profile's alone, never a missing credential's.
 *
 * `HOME` and `SLOPWEAVER_HOME` are an isolated temp directory, so a passing run reads nothing from, and
 * writes nothing to, the machine's own state.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

let isolatedHome: string;

beforeEach(() => {
  isolatedHome = mkdtempSync(join(tmpdir(), "slop-corruptprofile-"));
});

afterEach(() => {
  rmSync(isolatedHome, { force: true, recursive: true });
});

/** Write both Slack tokens as fake secrets, so the only thing that can stop the listener is the profile. */
function seedTokens(): void {
  mkdirSync(join(isolatedHome, "secrets"), { recursive: true });
  writeFileSync(join(isolatedHome, "secrets", "slack-app-token"), "xapp-fake", { encoding: "utf8", mode: 0o600 });
  writeFileSync(join(isolatedHome, "secrets", "slack-bot-token"), "xoxb-fake", { encoding: "utf8", mode: 0o600 });
}

/** Run `listen` against the isolated home, keeping the two streams apart. */
function listen({ extra = [] }: { extra?: readonly string[] } = {}): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const spawned = spawnSync(BIN, ["listen", "--home", isolatedHome, ...extra], {
    encoding: "utf8",
    env: { HOME: isolatedHome, PATH: process.env["PATH"]!, SLOPWEAVER_HOME: isolatedHome },
  });
  return { status: spawned.status!, stderr: spawned.stderr, stdout: spawned.stdout };
}

describe("listen on a corrupt profile.json", () => {
  it("refuses to start as a fault, naming the file, with both tokens good", () => {
    seedTokens();
    writeFileSync(join(isolatedHome, "profile.json"), "{ not json", "utf8");

    const result = listen();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`listen: will not start — the profile at ${join(isolatedHome, "profile.json")}`);
    expect(result.stdout).toContain("✗ profile:");
    expect(result.stdout).not.toContain("connecting to Slack");
  });

  it("is a fault even when a token is ALSO missing, never a prerequisite absent", () => {
    writeFileSync(join(isolatedHome, "profile.json"), "{ not json", "utf8");

    const result = listen();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("listen: will not start");
  });

  it("reports the corrupt profile under --check as NOT READY", () => {
    seedTokens();
    writeFileSync(join(isolatedHome, "profile.json"), JSON.stringify({ schemaVersion: "one" }), "utf8");

    const result = listen({ extra: ["--check"] });

    expect(result.status).toBe(3);
    expect(result.stdout).toContain("listen: NOT READY");
    expect(result.stdout).toContain("✗ profile:");
  });

  it("still reports an absent profile as ok under --check", () => {
    seedTokens();

    const result = listen({ extra: ["--check"] });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("✓ profile: no profile.json");
  });
});
