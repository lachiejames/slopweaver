import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  runUnitSequence,
  spawnInherited,
  UNIT_SHARD_TIMED_OUT,
  UNIT_SHARD_TIMEOUT_MS,
  unitSequenceShards,
} from "../../../testLanes/unitSequence.js";

const SHARD_ONE = ["yarn", "test:unit", "--shard=1/6", "--reporter=default", "--reporter=blob", "--maxWorkers=4"];

describe("unitSequenceShards — the lap's shape, one argv per shard", () => {
  it("is CI's six shard commands in order, each at the lap's 4 forks", () => {
    const shards = unitSequenceShards();
    expect(shards.length).toBe(6);
    expect(shards[0]).toEqual(SHARD_ONE);
    expect(shards.map((argv) => argv[2])).toEqual([
      "--shard=1/6",
      "--shard=2/6",
      "--shard=3/6",
      "--shard=4/6",
      "--shard=5/6",
      "--shard=6/6",
    ]);
    expect(shards.every((argv) => argv.at(-1) === "--maxWorkers=4")).toBe(true);
  });
});

describe("runUnitSequence — six shards, then the merge", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  /** A repository root holding one stale blob, as an earlier run would leave. */
  function rootWithStaleBlob(): string {
    const cwd = mkdtempSync(join(tmpdir(), "unit-sequence-"));
    dirs.push(cwd);
    mkdirSync(join(cwd, ".vitest-reports"));
    writeFileSync(join(cwd, ".vitest-reports", "blob-1-4.json"), "{}");
    return cwd;
  }

  it("runs every shard in order over a cleared report directory, then answers the merge's status", () => {
    const cwd = rootWithStaleBlob();
    const ran: string[] = [];
    const lines: string[] = [];
    const status = runUnitSequence({
      cwd,
      merge: () => {
        ran.push("merge");
        return 7;
      },
      run: (argv) => {
        ran.push(`${argv[2]!} stale=${String(existsSync(join(cwd, ".vitest-reports", "blob-1-4.json")))}`);
        return 0;
      },
      write: (line) => lines.push(line),
    });
    expect(status).toBe(7);
    expect(ran).toEqual([
      "--shard=1/6 stale=false",
      "--shard=2/6 stale=false",
      "--shard=3/6 stale=false",
      "--shard=4/6 stale=false",
      "--shard=5/6 stale=false",
      "--shard=6/6 stale=false",
      "merge",
    ]);
    expect(lines).toEqual([]);
  });

  it("stops at the first red shard, runs no merge, and names the command", () => {
    const cwd = rootWithStaleBlob();
    const ran: string[] = [];
    const lines: string[] = [];
    const status = runUnitSequence({
      cwd,
      merge: () => {
        ran.push("merge");
        return 0;
      },
      run: (argv) => {
        ran.push(argv[2]!);
        return argv[2] === "--shard=3/6" ? 1 : 0;
      },
      write: (line) => lines.push(line),
    });
    expect(status).toBe(1);
    expect(ran).toEqual(["--shard=1/6", "--shard=2/6", "--shard=3/6"]);
    expect(lines).toEqual([
      "unit sequence: `yarn test:unit --shard=3/6 --reporter=default --reporter=blob --maxWorkers=4` exited 1, so no later shard and no merge ran",
    ]);
  });
});

describe("spawnInherited", () => {
  it("answers 1 for an empty argv rather than spawning nothing", () => {
    const lines: string[] = [];
    expect(spawnInherited({ argv: [], cwd: tmpdir(), write: (line) => lines.push(line) })).toBe(1);
    expect(lines).toEqual([]);
  });

  it("bounds a shard at ten times the slowest one measured, and answers 124 past it", () => {
    expect([UNIT_SHARD_TIMEOUT_MS, UNIT_SHARD_TIMED_OUT]).toEqual([1_800_000, 124]);
  });
});

describe("yarn validate's unit step", () => {
  it("runs the sequence, never an unsharded `yarn test:unit`", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
    const text = readFileSync(join(root, "package.json"), "utf8");
    const validate = /"validate": "([^"]*)"/.exec(text)![1]!;
    expect(validate.split(" && ")).toEqual([
      "yarn lint",
      "yarn typecheck",
      "tsx src/testLanes/unitSequence.entry.ts",
      "yarn test:subprocess",
      "yarn coverage:ratchet",
    ]);
  });
});
