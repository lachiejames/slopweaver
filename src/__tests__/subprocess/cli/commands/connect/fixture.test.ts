/**
 * Proves the SHIPPED `bin/slopweaver connect` binary — not just the injected shell — honors the fixture
 * selector: it never constructs a real SDK client on the fixture path, and a stray env var alone (without
 * the harness gate) never diverts the live path onto one. `HOME` and `PATH` are the only inherited
 * environment; every other real config/token on this machine is deliberately absent, so a passing run
 * proves the fixture path needs none of it.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

let isolatedHome: string;
beforeEach(() => {
  isolatedHome = mkdtempSync(join(tmpdir(), "slop-connect-fixture-home-"));
});
afterEach(() => {
  rmSync(isolatedHome, { force: true, recursive: true });
});

/** Run the shipped binary with a minimal, isolated environment — never the real machine's config/tokens. */
function runConnect({
  args,
  extraEnv = {},
}: {
  args: readonly string[];
  extraEnv?: Readonly<Record<string, string>>;
}): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(BIN, args, {
      cwd: isolatedHome,
      encoding: "utf8",
      // The sandbox spreads LAST, so a caller's `extraEnv` can never drop the account-home preload.
      env: { HOME: isolatedHome, PATH: process.env["PATH"]!, ...extraEnv, ...accountSandboxChildEnv() },
      maxBuffer: 4 * 1024 * 1024,
    });
    return { status: 0, stderr: "", stdout };
  } catch (error: unknown) {
    // A non-zero exit here always carries these — execFileSync sets them whenever the subprocess actually
    // ran with `encoding` given; an undefined status/stdout/stderr would mean it never spawned at all, a
    // different failure this test isn't exercising.
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, stderr: e.stderr, stdout: e.stdout };
  }
}

describe("bin/slopweaver connect — fixture selector", () => {
  it("answers all-ready without any real credential, tagged with the fixture marker", { timeout: 30_000 }, () => {
    const result = runConnect({
      args: ["connect", "github", "--check", "--json"],
      extraEnv: { SLOPWEAVER_CONNECT_FIXTURE: "all-ready", SLOPWEAVER_ONBOARD_HARNESS: "1" },
    });
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as { ok: boolean; fixture?: { scenario: string } };
    expect(report.ok).toBe(true);
    expect(report.fixture).toEqual({ scenario: "all-ready" });
  });

  it("answers notion-hard-gap as not-ready, still tagged with the fixture marker", { timeout: 30_000 }, () => {
    const result = runConnect({
      args: ["connect", "notion", "--check", "--json"],
      extraEnv: { SLOPWEAVER_CONNECT_FIXTURE: "notion-hard-gap", SLOPWEAVER_ONBOARD_HARNESS: "1" },
    });
    expect(result.status).toBe(3);
    const report = JSON.parse(result.stdout) as { ok: boolean; fixture?: { scenario: string } };
    expect(report.ok).toBe(false);
    expect(report.fixture).toEqual({ scenario: "notion-hard-gap" });
  });

  it("refuses a scenario named without the harness gate, rather than answering from it", { timeout: 30_000 }, () => {
    const result = runConnect({
      args: ["connect", "github", "--check", "--json"],
      extraEnv: { SLOPWEAVER_CONNECT_FIXTURE: "all-ready" },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("refusing rather than guessing which mode was meant");
    expect(result.stdout).toBe("");
  });

  it("answers Outlook's all-ready fixture through its own classifier, never Notion's", { timeout: 30_000 }, () => {
    const result = runConnect({
      args: ["connect", "outlook", "--check", "--json"],
      extraEnv: { SLOPWEAVER_CONNECT_FIXTURE: "all-ready", SLOPWEAVER_ONBOARD_HARNESS: "1" },
    });
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as { source: string; capabilities: readonly { id: string }[] };
    expect(report.source).toBe("outlook");
    expect(report.capabilities.map((capability) => capability.id)).toEqual([
      "registration",
      "auth",
      "scope:read",
      "scope:manage",
      "scope:send",
      "read-probe",
    ]);
  });

  it("on a fresh home, the live Outlook path names both missing halves and makes no call", { timeout: 30_000 }, () => {
    const result = runConnect({ args: ["connect", "outlook", "--check", "--json", "--home", isolatedHome] });
    expect(result.status).toBe(3);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      fixture?: { scenario: string };
      capabilities: readonly { id: string; status: string }[];
    };
    expect(report.ok).toBe(false);
    expect(report.fixture).toBeUndefined();
    expect(report.capabilities).toEqual([
      expect.objectContaining({ id: "registration", status: "missing" }),
      expect.objectContaining({ id: "auth", status: "missing" }),
    ]);
  });

  it("with neither fixture env var, runs the live path and never carries a fixture marker", { timeout: 30_000 }, () => {
    const result = runConnect({ args: ["connect", "github", "--check", "--json"] });
    const report = JSON.parse(result.stdout) as { fixture?: { scenario: string } };
    expect(report.fixture).toBeUndefined();
  });
});
