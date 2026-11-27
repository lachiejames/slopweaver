/*
 * The register `./ciOffloadContract.ts` proves: every command CI must still run, in the worker job that runs it.
 * Its own module because it is a list whose length IS its content, and the gate reading it is not.
 */
import { UNIT_SHARD_COUNT, unitShardCommand, unitShardJob } from "../testLanes/unitShards.js";

/**
 * The REQUIRED job, whose success must imply every offloaded lap succeeded. It is also the job that merges the
 * unit shards' reports and runs the measured coverage floor, after its verdict: a separate merge job waited for
 * a fresh runner of its own between the shards and this one.
 */
export const OFFLOAD_JOB = "build";

/**
 * The commands CI must still run, each in the worker job that runs it, with why the machine no longer does.
 *
 * `yarn lint` rather than `yarn lint:local` is the whole point of the first entry: the local
 * lane runs only the five gates CI cannot see the subject of, so CI running the local lane would mean 62 of
 * 67 gates ran nowhere at all. Order matters within one job — `coverage:ratchet` reads the report
 * `test:unit:merge` writes from the shards' blobs.
 *
 * `directory` is the step's `working-directory`, pinned for a nested Yarn project: `yarn build` names a different
 * build in `desktop/` and `site/` than at the root, so without it a bare root `yarn build` in either job would
 * satisfy the contract while the nested project never built (`site` is a worker too). An entry without one runs at the root, and a step carrying any `working-directory` does not match it.
 */
export const OFFLOADED_COMMANDS: readonly {
  readonly command: string;
  readonly directory?: string;
  readonly job: string;
  readonly why: string;
}[] = [
  {
    command: "yarn lint",
    job: "lint",
    why: "the full lane: 62 of the 67 gates, everything the opt-in local lane does not flag offRepoState",
  },
  {
    command: "yarn typecheck",
    job: "typecheck",
    why: "off the developer machine by the owner's rule; CI is the only place it runs",
  },
  ...Array.from({ length: UNIT_SHARD_COUNT }, (_unused, position) => ({
    command: unitShardCommand({ index: position + 1 }),
    job: unitShardJob({ index: position + 1 }),
    why: "one shard of the unit lane, which no longer runs on the developer machine at all",
  })),
  {
    command: "yarn test:unit:merge",
    job: OFFLOAD_JOB,
    why: "rebuilds the WHOLE lane's coverage from every shard's report, refusing an inexact set",
  },
  {
    command: "yarn coverage:ratchet",
    job: OFFLOAD_JOB,
    why: "the MEASURED coverage half, which needs the merged report",
  },
  { command: "yarn test:subprocess", job: "subprocess", why: "no longer runs on the developer machine at all" },
  {
    command: "yarn test:e2e",
    job: "desktop-e2e",
    why: "the console's browser lane over the built console and a seeded throwaway home; a change of only prose under docs/ passes it as not applicable, never skips it",
  },
  {
    command: "yarn build",
    job: "compile",
    why: "would run NOWHERE without this entry — no workflow, no hook, not `yarn validate` — while the required check is named `build`",
  },
  {
    command: "yarn build",
    directory: "desktop",
    job: "desktop",
    why: "the desktop shell's own `tsc`, the only typecheck its main process and preload get",
  },
  {
    command: "yarn test:nextra-patch",
    directory: "site",
    job: "site",
    why: "the witness that the installed Nextra is the patched one, with no Twoslash transformer for a TypeScript bump to break",
  },
  {
    command: "yarn build",
    directory: "site",
    job: "site",
    why: "the console's `next build`, its only typecheck — outside `build`, a red console left the required check green",
  },
];

/**
 * Every job that runs an {@link OFFLOADED_COMMANDS} entry, in the order the register first names it — the
 * workers and `build` itself, which merges the unit shards' reports after its verdict.
 *
 * @returns each command-owning job name once
 */
export function commandJobs(): readonly string[] {
  return [...new Set(OFFLOADED_COMMANDS.map((entry) => entry.job))];
}

/**
 * The worker jobs whose results `build`'s verdict reads, in {@link commandJobs} order: every command-owning job
 * but {@link OFFLOAD_JOB}, which cannot need itself.
 *
 * @returns each worker job name once
 */
export function workerJobs(): readonly string[] {
  return commandJobs().filter((job) => job !== OFFLOAD_JOB);
}
