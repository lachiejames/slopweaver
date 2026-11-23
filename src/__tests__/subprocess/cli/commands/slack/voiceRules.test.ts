/**
 * `slack voice-rules` through the SHIPPED binary — the production-wiring witness the unit lane cannot give.
 *
 * Every unit test of this verb injects `loadBrief`, so all of them would still pass if
 * `productionSlackVoiceRulesDeps` were wired to the old rules-only reader and never read the configured
 * response shape at all. That is exactly the defect this file exists to catch: the shape reaching a composing
 * session is the whole point of the change, and only spawning the binary against a real `profile.json` proves
 * the shipped wiring reads it.
 *
 * `HOME` and `SLOPWEAVER_HOME` are an isolated temp directory, so a passing run reads nothing from, and
 * writes nothing to, the machine's own state. The fixture prose is neutral, never the operator's own voice.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

/** A well-formed response-shape memory, with neutral fixture prose. */
const SHAPE_MEMORY = [
  "---",
  "name: fixture-response-shape",
  "description: how a fixture reply should read",
  "metadata:",
  "  type: feedback",
  "---",
  "",
  "**One short line by default.**",
  "",
  "Then the outcome, never the pipeline.",
  "",
].join("\n");

let isolatedHome: string;

beforeEach(() => {
  isolatedHome = mkdtempSync(join(tmpdir(), "slop-voicerules-home-"));
});

afterEach(() => {
  rmSync(isolatedHome, { force: true, recursive: true });
});

/** Run the shipped binary with a minimal, isolated environment. */
function run({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  const env: Record<string, string> = {
    HOME: isolatedHome,
    PATH: process.env["PATH"]!,
    SLOPWEAVER_HOME: isolatedHome,
  };
  try {
    const stdout = execFileSync(BIN, args, { cwd: isolatedHome, encoding: "utf8", env, maxBuffer: 4 * 1024 * 1024 });
    return { status: 0, stderr: "", stdout };
  } catch (error: unknown) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, stderr: e.stderr, stdout: e.stdout };
  }
}

/** Write a `profile.json` into the isolated home carrying the given `slackMe.voice` block. */
function writeProfile({ voice }: { voice: Record<string, unknown> }): void {
  writeFileSync(
    join(isolatedHome, "profile.json"),
    JSON.stringify({
      displayName: "Fixture",
      gitNamespace: "",
      id: "fixture",
      schemaVersion: 1,
      slackMe: { voice },
      sources: [],
    }),
    "utf8",
  );
}

/** Write the fixture shape memory into the isolated home and return its absolute path. */
function writeShapeMemory({ text = SHAPE_MEMORY }: { text?: string } = {}): string {
  const path = join(isolatedHome, "response-shape.md");
  writeFileSync(path, text, "utf8");
  return path;
}

describe("bin/slopweaver slack voice-rules — the shipped wiring reads the configured response shape", () => {
  it("prints the configured shape prose verbatim, above the enforced rules", { timeout: 60_000 }, () => {
    const shapeMemoryFile = writeShapeMemory();
    writeProfile({ voice: { exact: [{ kind: "word", value: "delve" }], shapeMemoryFile } });

    const result = run({ args: ["slack", "voice-rules"] });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("**One short line by default.**");
    expect(result.stdout).toContain("Then the outcome, never the pipeline.");
    expect(result.stdout.indexOf("**One short line by default.**")).toBeLessThan(
      result.stdout.indexOf("VOICE RULES (ENFORCED)"),
    );
  });

  it("carries the shape into the --json document as one stdout payload", { timeout: 60_000 }, () => {
    const shapeMemoryFile = writeShapeMemory();
    writeProfile({ voice: { exact: [], shapeMemoryFile } });

    const result = run({ args: ["slack", "voice-rules", "--json"] });

    expect(result.status).toBe(0);
    const parsed: unknown = JSON.parse(result.stdout);
    expect(parsed).toEqual({
      enforcement: { paragraphSpacing: "enforced", rules: "enforced", shape: "advisory" },
      paragraphSpacing: false,
      rules: [],
      shape: "**One short line by default.**\n\nThen the outcome, never the pipeline.",
    });
  });

  it("says plainly that nothing is configured on a home with no profile at all", { timeout: 60_000 }, () => {
    const result = run({ args: ["slack", "voice-rules"] });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("RESPONSE SHAPE — none configured for this installation");
  });

  it("EXITS 1 with no brief on stdout when the configured shape file is missing", { timeout: 60_000 }, () => {
    writeProfile({ voice: { exact: [], shapeMemoryFile: join(isolatedHome, "gone.md") } });

    const result = run({ args: ["slack", "voice-rules"] });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("voice-rules could not read the configured voice state");
  });

  it("leaves the configured files byte-identical, because it is a read", { timeout: 60_000 }, () => {
    const shapeMemoryFile = writeShapeMemory();
    writeProfile({ voice: { exact: [], shapeMemoryFile } });
    const profileBefore = readFileSync(join(isolatedHome, "profile.json"), "utf8");

    run({ args: ["slack", "voice-rules"] });

    expect(readFileSync(shapeMemoryFile, "utf8")).toBe(SHAPE_MEMORY);
    expect(readFileSync(join(isolatedHome, "profile.json"), "utf8")).toBe(profileBefore);
  });
});
