/**
 * `resolveSpawnTarget` — every case here is a refusal reached BEFORE the verb reads a register, touches git or
 * opens cmux, so it needs neither a store nor a live `cmux` binary.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveSpawnTarget } from "../../../../../cli/commands/cmux/spawnTarget.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const READY_DOC = [
  "---",
  "slug: a-doc",
  "summary: a thing",
  "status: ready",
  "repo: /tmp/nowhere",
  "---",
  "",
  "body",
].join("\n");

/** Build an argv the router would hand the verb: `[node, cli, cmux, spawn, …rest]`. */
function spawnArgv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "cmux", "spawn", ...rest];
}

describe("resolveSpawnTarget — refusals ahead of any register read", () => {
  it("refuses a spawn that names no handover slug, as a usage error", async () => {
    const target = await resolveSpawnTarget({ argv: spawnArgv({ rest: [] }) });
    expect(target).toBe(EXIT_USAGE);
  });

  it("refuses an unknown flag, as a usage error", async () => {
    const target = await resolveSpawnTarget({ argv: spawnArgv({ rest: ["--no-such-flag", "a-doc"] }) });
    expect(target).toBe(EXIT_USAGE);
  });

  // A READY doc the board really holds, so every doc refusal declines and only the argv can refuse. An omitted
  // --driver reads the register, which this sandbox cannot (no store): were these argv refusals behind that read,
  // each would come back as the store's EXIT_ERROR — the well-formed spawn below is that falsifier (Codex review
  // r1, `r1-spawn-order`).
  it("refuses a bad --effort and a --timeout-seconds with no --wait as usage errors, ahead of the register", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spawn-target-docs-"));
    try {
      writeFileSync(join(dir, "a-doc.md"), READY_DOC, "utf8");
      const targets = await Promise.all(
        [["--effort", "nonsense"], ["--timeout-seconds", "10"], []].map((extra) =>
          resolveSpawnTarget({ argv: spawnArgv({ rest: ["a-doc", "--dir", dir, "--model", "sonnet", ...extra] }) }),
        ),
      );
      expect(targets).toEqual([EXIT_USAGE, EXIT_USAGE, EXIT_ERROR]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
