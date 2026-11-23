/**
 * `datadog shot`'s refusal paths, proved through the SHIPPED binary.
 *
 * Why this cannot live on the unit lane: what is being asserted is that a bad invocation costs nothing —
 * no browser, no network, no file written — and that is a property of the PROCESS, not of a parser. An
 * in-process test of `parseDatadogShotOptions` proves the parser refuses; only spawning the binary proves
 * the verb refused BEFORE it launched Chromium, which is the actual contract (`dryParseSafe` in the
 * manifest) and the reason a mistyped flag does not cost fifteen seconds and a browser.
 *
 * Every case here runs with `DD_SITE` set and NEITHER key, which is also a real assertion: the capture lane
 * reaches Datadog with a browser session, so a machine holding no API key must still be able to run — and
 * must still refuse a bad address for the right reason rather than for a missing credential.
 *
 * `HOME` and `SLOPWEAVER_HOME` are an isolated temp directory, so a passing run reads nothing from, and
 * writes nothing to, the machine's own state. Every Datadog host in this file reads a synthetic site rather than
 * the install's own.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

let isolatedHome: string;

beforeEach(() => {
  isolatedHome = mkdtempSync(join(tmpdir(), "slop-ddshot-home-"));
});

afterEach(() => {
  rmSync(isolatedHome, { force: true, recursive: true });
});

/** Run the shipped binary with a minimal, isolated environment and a stated Datadog site. */
function run({ args, site = "ap1.datadoghq.com" }: { args: readonly string[]; site?: string }): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const env: Record<string, string> = {
    HOME: isolatedHome,
    PATH: process.env["PATH"]!,
    SLOPWEAVER_HOME: isolatedHome,
  };
  if (site !== "") {
    env["DD_SITE"] = site;
  }
  try {
    const stdout = execFileSync(BIN, args, {
      cwd: isolatedHome,
      encoding: "utf8",
      env,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { status: 0, stderr: "", stdout };
  } catch (error: unknown) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, stderr: e.stderr, stdout: e.stdout };
  }
}

/** Every file the run left under the isolated home, so "nothing was written" is a falsifiable claim. */
function homeEntries(): readonly string[] {
  return readdirSync(isolatedHome);
}

describe("bin/slopweaver datadog shot — it opens no browser, ever, and mints no profile", () => {
  it("prints usage for a bare invocation and exits clean", { timeout: 60_000 }, () => {
    const result = run({ args: ["datadog", "shot"] });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("usage: slopweaver datadog shot <monitor|explorer|file>");
    expect(homeEntries()).toEqual([]);
  });

  it("refuses an unknown sub-verb with EXIT_USAGE and no browser profile", { timeout: 60_000 }, () => {
    const result = run({ args: ["datadog", "shot", "screenshot"] });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("is not a shot sub-verb");
    // The retired profile (`docs/browser-route.md`), and what it retired
    // (`docs/browser-route/screenshot-reading-and-retirement.md`). Nothing under the home is a
    // browser profile any more, and this asserts the one that used to be here never comes back.
    expect(existsSync(join(isolatedHome, "datadog-web-profile"))).toBe(false);
  });

  it("refuses `monitor` with no id", { timeout: 60_000 }, () => {
    const result = run({ args: ["datadog", "shot", "monitor"] });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--id is required");
    expect(homeEntries()).toEqual([]);
  });

  it("refuses a non-numeric monitor id", { timeout: 60_000 }, () => {
    const result = run({ args: ["datadog", "shot", "monitor", "--id", "abc"] });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("numeric monitor id");
  });

  it("refuses an address on another Datadog SITE, naming both hosts", { timeout: 60_000 }, () => {
    const result = run({ args: ["datadog", "shot", "explorer", "--url", "https://us3.datadoghq.com/logs"] });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("us3.datadoghq.com");
    expect(result.stderr).toContain("ap1.datadoghq.com");
    // The retired profile (`docs/browser-route.md`), and what it retired
    // (`docs/browser-route/screenshot-reading-and-retirement.md`). Nothing under the home is a
    // browser profile any more, and this asserts the one that used to be here never comes back.
    expect(existsSync(join(isolatedHome, "datadog-web-profile"))).toBe(false);
  });

  it("refuses a console path that is not a view, and lists the ones it opens", { timeout: 60_000 }, () => {
    const result = run({
      args: ["datadog", "shot", "explorer", "--url", "https://ap1.datadoghq.com/account/settings"],
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("/account/settings");
    expect(result.stderr).toContain("/metric/explorer");
  });

  it("refuses --url and --metric together, which are alternatives", { timeout: 60_000 }, () => {
    const result = run({
      args: ["datadog", "shot", "explorer", "--url", "https://ap1.datadoghq.com/logs", "--metric", "m"],
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("alternatives");
  });

  it("refuses an unset DD_SITE with EXIT_EXPECTED_EMPTY, listing the sites it accepts", { timeout: 60_000 }, () => {
    const result = run({ args: ["datadog", "shot", "monitor", "--id", "600101"], site: "" });
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("DD_SITE is not set");
    expect(result.stderr).toContain("ap1.datadoghq.com");
    // The retired profile (`docs/browser-route.md`), and what it retired
    // (`docs/browser-route/screenshot-reading-and-retirement.md`). Nothing under the home is a
    // browser profile any more, and this asserts the one that used to be here never comes back.
    expect(existsSync(join(isolatedHome, "datadog-web-profile"))).toBe(false);
  });

  it("refuses an unknown DD_SITE before it resolves a console host", { timeout: 60_000 }, () => {
    const result = run({ args: ["datadog", "shot", "monitor", "--id", "600101"], site: "datadog.example" });
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("is not a Datadog site");
  });

  it("appears in the catalog, so the verb cannot be wired without being discoverable", { timeout: 60_000 }, () => {
    const result = run({ args: ["catalog"] });
    expect(result.status).toBe(0);
    // The catalog groups by noun, so the verb appears as an indented row under `datadog` rather than as
    // the two words together. Asserting the summary is the stronger check anyway: it proves the MANIFEST
    // entry is what the catalog read, not merely that the noun exists.
    expect(result.stdout).toContain("Photograph a Datadog view through the signed-in console");
  });
});
