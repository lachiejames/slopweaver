/**
 * The SHIPPED binary, `talk relay --heard-stdin`, carrying a stretch of the owner's words no argv value could — the seam
 * the unit lane cannot reach.
 *
 * The console's route used to hand the owner's words to the verb as the one value after `--heard`, and an argv value is
 * bounded by `getconf ARG_MAX` together with the whole inherited environment. A review broke that
 * with a 900,000-byte stretch beside a 200,000-byte environment: the spawn throws E2BIG before the verb runs, so
 * not one word is recorded. This spawns that exact case and reads every word back off the turn record.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unwrap } from "#lib/result.js";
import { readTurn } from "../../../../../talk/relayStore.js";
import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const TURN = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

let scratch: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "slop-relay-stdin-"));
  mkdirSync(join(scratch, "home"));
  mkdirSync(join(scratch, "handovers"));
});
afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

describe("bin/slopweaver talk relay --heard-stdin", () => {
  it("keeps every word of a 900,000-byte stretch beside a 200,000-byte environment, which argv could not carry", () => {
    const heard = "語".repeat(300_000);
    const home = join(scratch, "home");
    const ran = spawnSync(
      BIN,
      ["talk", "relay", "--turn", TURN, "--heard-stdin", "--words-alone"].concat([
        "--home",
        home,
        "--dir",
        join(scratch, "handovers"),
        "--json",
      ]),
      {
        cwd: scratch,
        encoding: "utf8",
        // Two halves, because Linux refuses any ONE environment string past 128 KiB (MAX_ARG_STRLEN) on its own.
        env: {
          ...accountSandboxChildEnv(),
          HOME: scratch,
          LARGE_INHERITED_A: "x".repeat(100_000),
          LARGE_INHERITED_B: "x".repeat(100_000),
          PATH: process.env["PATH"]!,
        },
        input: heard,
        maxBuffer: 16 * 1024 * 1024,
      },
    );

    expect([ran.status, ran.error]).toEqual([0, undefined]);
    const record = unwrap(readTurn({ home, turnId: TURN }));
    expect([record.heard.length, record.heard === heard, record.heardTruncated]).toEqual([300_000, true, false]);
  });
});
