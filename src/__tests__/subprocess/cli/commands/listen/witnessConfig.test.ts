/**
 * Broken witness configuration stops a `--follow` listener and never a one-shot one, proved through the SHIPPED
 * binary (witnessing runs under `--follow` only, so a one-shot turn must not die on its config).
 *
 * The profile names a peer bot the (absent) member directory cannot resolve. No token is written, so neither
 * run can connect: `--follow` must refuse on the witness as a fault (exit 1) before the token branch, and the
 * one-shot run must reach that token branch and report a prerequisite absent (exit 3), naming no witness.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

let isolatedHome: string;

beforeEach(() => {
  isolatedHome = mkdtempSync(join(tmpdir(), "slop-witnesscfg-"));
  writeFileSync(
    join(isolatedHome, "profile.json"),
    JSON.stringify({
      displayName: "Ada Owner",
      gitNamespace: "ada-gh",
      id: "owner-1",
      schemaVersion: 1,
      slackBot: { witnessBotHandles: ["peerbot"] },
      sources: [],
    }),
    "utf8",
  );
});

afterEach(() => {
  rmSync(isolatedHome, { force: true, recursive: true });
});

/** Run `listen` against the isolated home, keeping the two streams apart. */
function listen({ extra }: { extra: readonly string[] }): { status: number; stderr: string } {
  const spawned = spawnSync(BIN, ["listen", "--home", isolatedHome, ...extra], {
    encoding: "utf8",
    env: { ...accountSandboxChildEnv(), HOME: isolatedHome, PATH: process.env["PATH"]!, SLOPWEAVER_HOME: isolatedHome },
  });
  return { status: spawned.status!, stderr: spawned.stderr };
}

describe("listen with a witness handle that does not resolve", () => {
  it("refuses a --follow listener as a fault, naming the witness", () => {
    const result = listen({ extra: ["--follow"] });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("listen: will not start");
    expect(result.stderr).toContain("peerbot");
  });

  it("leaves a one-shot listener to its own prerequisites", () => {
    const result = listen({ extra: ["--once"] });

    expect(result.status).toBe(3);
    expect(result.stderr).not.toContain("will not start");
  });
});
