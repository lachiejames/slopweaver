/**
 * The whole unit lane on ONE machine, run the way the local lap runs it: the six CI shard commands in sequence,
 * each at {@link UNIT_LANE_MAX_WORKERS} forks, then the merge that rebuilds the lane's one coverage report. This
 * is what `yarn validate` runs in place of an unsharded `yarn test:unit`.
 *
 * MEASURED: an unsharded `yarn test:unit` took 9 non-isolated forks on a 10-core, 16 GiB machine and swapped it
 * (`./unitWorkers.ts` carries the numbers), while this exact shape — the same argv the lap builds — went green
 * there in three laps of one night with swap 3.9 of 5 → 4.3 of 6 GB across the last one's six shards. A shard
 * fork runs about a twenty-fourth of the tree, a whole-tree fork at the same width a quarter, and with
 * `isolate: false` a fork keeps what every file it ran imported, so the shards are the measured shape and a
 * whole-tree run is not.
 *
 * The first red shard stops the sequence, as the lap stops at its first red step: its blob is not a lane, and a
 * merge over fewer than six reports is refused by `blobSetFindings` anyway. Unlike the lap there is no retry,
 * since a person at a terminal reruns it.
 */

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { UNIT_BLOB_DIRECTORY, UNIT_SHARD_COUNT, unitShardCommand } from "./unitShards.js";
import { UNIT_LANE_MAX_WORKERS } from "./unitWorkers.js";

/**
 * Every shard's argv, in index order: CI's own shard command with the lap's width appended, the same words
 * the lap's plan builds for each `unit-<n>` step.
 *
 * @returns one argv per shard, `yarn` first
 */
export function unitSequenceShards(): readonly (readonly string[])[] {
  return Array.from({ length: UNIT_SHARD_COUNT }, (_unused, at) => [
    ...unitShardCommand({ index: at + 1 })
      .split(" ")
      .filter((word) => word.length > 0),
    `--maxWorkers=${String(UNIT_LANE_MAX_WORKERS)}`,
  ]);
}

/**
 * Run the six shards in sequence over a cleared report directory, stopping at the first red, then merge.
 *
 * @param cwd the repository root, whose `.vitest-reports` is cleared so no earlier run's blob merges in
 * @param run runs one argv with inherited output and answers its exit status
 * @param merge merges the six reports into the lane's coverage, answering its exit status
 * @param write prints one line to stderr
 * @returns the first red shard's status, else the merge's
 */
export function runUnitSequence({
  cwd,
  run,
  merge,
  write,
}: {
  cwd: string;
  run: (argv: readonly string[]) => number;
  merge: () => number;
  write: (line: string) => void;
}): number {
  rmSync(join(cwd, UNIT_BLOB_DIRECTORY), { force: true, recursive: true });
  for (const argv of unitSequenceShards()) {
    const status = run(argv);
    if (status !== 0) {
      write(`unit sequence: \`${argv.join(" ")}\` exited ${String(status)}, so no later shard and no merge ran`);
      return status;
    }
  }
  return merge();
}

/**
 * The longest one shard may run before it is killed: past ten times the slowest measured shard (140 s at 4
 * forks, `./unitWorkers.ts`), so only a child stalled on a prompt nobody can see ever reaches it.
 */
export const UNIT_SHARD_TIMEOUT_MS = 30 * 60 * 1000;

/** The status a timed-out shard answers, the shell's own `timeout` convention. */
export const UNIT_SHARD_TIMED_OUT = 124;

/**
 * Run one argv in the repository root with inherited output, killed past {@link UNIT_SHARD_TIMEOUT_MS}.
 *
 * @param argv the program and its arguments
 * @param cwd the repository root
 * @param write prints the timeout's own line, so a killed shard is never read as a red one
 * @returns the exit status, {@link UNIT_SHARD_TIMED_OUT} on a timeout, or 1 when the child did not exit normally
 */
export function spawnInherited({
  argv,
  cwd,
  write,
}: {
  argv: readonly string[];
  cwd: string;
  write: (line: string) => void;
}): number {
  const [program, ...args] = argv;
  if (program === undefined) {
    return 1;
  }
  const child = spawnSync(program, args, { cwd, stdio: "inherit", timeout: UNIT_SHARD_TIMEOUT_MS });
  const timedOut = child.error !== undefined && "code" in child.error && child.error.code === "ETIMEDOUT";
  if (timedOut) {
    write(
      `unit sequence: \`${argv.join(" ")}\` ran past ${String(UNIT_SHARD_TIMEOUT_MS / 60_000)} minutes and was killed`,
    );
    return UNIT_SHARD_TIMED_OUT;
  }
  if (child.status === null) {
    return 1;
  }
  return child.status;
}
