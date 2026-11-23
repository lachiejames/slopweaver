import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { VANTA_ATLAS_REGISTRATION } from "../../../../../atlas/vanta/registration.js";
import { VANTA_SHOT_USAGE, vantaShotCommand } from "../../../../../cli/commands/vanta/shotRun.js";

const ARGV = ["node", "slopweaver", "atlas", "vanta", "shot"];

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "vanta-shot-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("VANTA_SHOT_USAGE", () => {
  it("is the shot row's registered usage behind the verb's own prefix, and reads exactly `usage: slopweaver atlas vanta shot --control <id> [--control <id>...] [--tenant <slug>] [--json] [--home <dir>]`", () => {
    const shot = VANTA_ATLAS_REGISTRATION.verbs.find((row) => row.verb === "shot")!;

    expect(VANTA_SHOT_USAGE).toBe(`usage: slopweaver atlas vanta ${shot.usage[0]!}`);
    expect(VANTA_SHOT_USAGE).toBe(
      "usage: slopweaver atlas vanta shot --control <id> [--control <id>...] [--tenant <slug>] [--json] [--home <dir>]",
    );
  });
});

describe("vantaShotCommand", () => {
  it("answers 0 for --help", async () => {
    expect(await vantaShotCommand([...ARGV, "--help"])).toBe(0);
  });

  it("answers the usage code 2 when no --control is named, over an atlas that was never synced", async () => {
    expect(await vantaShotCommand([...ARGV, "--home", home])).toBe(2);
  });

  it("answers 1 when a --control is named but the never-synced atlas holds no controls to place it against", async () => {
    expect(await vantaShotCommand([...ARGV, "--control", "DCH-1", "--home", home])).toBe(1);
  });
});
