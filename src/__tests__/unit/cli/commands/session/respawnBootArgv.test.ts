/**
 * `loopRespawnBootArgv` — the line a loop respawn boots its successor with, run through `cmux spawn`'s own argv and
 * pin resolution. The respawn names no `--driver`, so the plan register picks the host; a Codex-only install
 * defaults to codex, and a boot line carrying `--effort` would be refused there before any seat started.
 */
import { describe, expect, it } from "vitest";

import { resolveSpawnArgv } from "../../../../../cli/commands/cmux/spawnArgv.js";
import { resolveSpawnPins } from "../../../../../cli/commands/cmux/spawnPins.js";
import { loopRespawnBootArgv } from "../../../../../cli/commands/session/respawnBoot.js";

/** Resolve the respawn's boot line to the pins `cmux spawn` would boot with on one defaulted host. */
function pinsFor({ defaultDriver }: { defaultDriver: "claude" | "codex" }): ReturnType<typeof resolveSpawnPins> {
  const settled = resolveSpawnArgv({ argv: loopRespawnBootArgv({ namedHome: undefined, successor: "loop-next" }) });
  // A refusal is a number, whose destructured fields are undefined, so resolveSpawnPins below reddens on one.
  const { argvPins, parsed } = settled as Exclude<typeof settled, number>;
  return resolveSpawnPins({ argvPins, defaultDriver, parsed });
}

describe("loopRespawnBootArgv", () => {
  it("boots on codex when the register defaults the host to codex, rather than being refused for an --effort", () => {
    expect(pinsFor({ defaultDriver: "codex" })).toEqual({ driver: "codex" });
  });

  it("still boots an Opus seat at high effort when the register defaults the host to claude", () => {
    expect(pinsFor({ defaultDriver: "claude" })).toEqual({ driver: "claude", effort: "high" });
  });

  it("carries a named --home through to the spawn", () => {
    expect(loopRespawnBootArgv({ namedHome: "/tmp/home", successor: "loop-next" })).toEqual([
      "node",
      "slopweaver",
      "cmux",
      "spawn",
      "loop-next",
      "--model",
      "opus",
      "--home",
      "/tmp/home",
    ]);
  });
});
