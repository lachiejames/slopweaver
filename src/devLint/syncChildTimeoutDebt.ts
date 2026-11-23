/**
 * The sync-child-timeout gate's debt list — every file whose synchronous child-process calls the criterion
 * still refuses, with how many. Its own module, as `noPython` and `boundarySchema` keep theirs, so the gate
 * stays readable and a diff that lowers an entry touches nothing else.
 *
 * A debt list, not an allowlist: every entry is a real unbounded call waiting on a MEASURED ceiling — a build,
 * an archive extraction, a backup rehearsal, a test lane — where a guessed bound would kill a legitimate slow
 * run. A shape the criterion should not match is fixed by sharpening the criterion, never by an entry here.
 * The gate fails when a file holds more calls than its entry, fewer, or when the list is malformed, so it only
 * shrinks. Re-measure with `yarn tsx src/devLint/syncChildTimeout.entry.ts` against an emptied list.
 */

/** One file's standing debt: how many calls the criterion refused there when the entry was last tightened. */
export interface SyncChildTimeoutDebt {
  readonly path: string;
  readonly count: number;
}

/** Today's debt, one row per path, in path order. 17 calls in 14 files, down from 74. */
export const SYNC_CHILD_TIMEOUT_DEBT: readonly SyncChildTimeoutDebt[] = [
  // `swiftc` compiling the desktop permission helper: a cold build's ceiling is unmeasured.
  { count: 1, path: "desktop/src/makeSystemAudioPermission.ts" },
  // The dev build a ref move runs; its sibling in `src/worktree/shell.ts` is bounded, this one is not yet measured.
  { count: 1, path: "src/checkouts/refMoveBuildRun.ts" },
  // The console refresh script a checkout sync runs.
  { count: 1, path: "src/cli/commands/checkout/syncRun.ts" },
  // The desktop app's install tooling.
  { count: 1, path: "src/cli/commands/desktop/installSeams.ts" },
  // esbuild and its smoke run.
  { count: 2, path: "src/cli/commands/dev/build.ts" },
  // An arbitrary verb run under the profiler, whose duration is the measurement.
  { count: 1, path: "src/cli/commands/dev/profile.ts" },
  // `unzip` listing and extracting a ChatGPT export, whose size is the export's.
  { count: 3, path: "src/corpus/chatgpt/archive.ts" },
  // A whole-history `git log`; a guessed bound would turn a large history into the empty-map fallback.
  { count: 1, path: "src/corpus/self/eventTime.ts" },
  // knip over the whole tree.
  { count: 1, path: "src/devLint/internalExports.ts" },
  // drizzle migration generation; its seam leaves `timeout` optional and its caller supplies none.
  { count: 1, path: "src/store/generate.ts" },
  // The Vitest merge lane, whose duration is the suite's own.
  { count: 1, path: "src/testLanes/unitMerge.ts" },
];
