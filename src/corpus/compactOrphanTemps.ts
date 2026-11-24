/**
 * The sweep a compaction runs before staging its own canonical file: unlink every staged write of that file
 * whose writer pid no longer runs. A signal ends a writer with no unwinding, so `writeFileAtomicStream`'s
 * discard never runs and the temp outlives it. Why this lives beside compaction, and the measurement that
 * motivated it, is point 4 of `./compact.ts`'s header.
 */

import { readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { atomicTempWriterPid } from "#lib/writeAtomic.js";
import { holderIsAlive } from "../admit/lockHolder.js";
import { safeFs } from "../lib/safeBoundary.js";
import type { CorpusJudge } from "./bronzeProtection.js";

/** What the pre-staging sweep of dead writers' temp files did. Never part of the before/after measure. */
export interface OrphanTempSweep {
  readonly removed: number;
  readonly bytes: number;
  /** One line per temp that could not be unlinked — no record is at stake, so it warns and never fails. */
  readonly failures: readonly string[];
}

/** One directory entry the sweep weighs: its basename and its size. */
interface DirEntryStat {
  readonly name: string;
  readonly bytes: number;
}

/** Whether a pid names a running process — {@link holderIsAlive} in production, a plain fake in a test. */
export type PidAlive = (args: { pid: number }) => boolean;

/**
 * The entries that are staged writes of `target` whose writer no longer runs. Pure over the injected
 * `isAlive`, so which files a sweep would delete is testable without a process table or a disk.
 *
 * @param entries the canonical file's sibling directory entries
 * @param target the canonical file's basename
 * @param isAlive answers whether a writer pid still runs; a pid it reads alive is never selected
 * @returns the dead writers' staged files, in `entries` order
 */
export function orphanStagingFiles({
  entries,
  target,
  isAlive,
}: {
  entries: readonly DirEntryStat[];
  target: string;
  isAlive: PidAlive;
}): readonly DirEntryStat[] {
  return entries.filter((entry) => {
    const pid = atomicTempWriterPid({ name: entry.name, target });
    return pid !== undefined && !isAlive({ pid });
  });
}

/**
 * The default liveness probe: the pid alone decides, so a recycled pid reads alive and its file is kept.
 *
 * @returns true while any process holds the pid, including one this user cannot signal
 */
export const pidRuns: PidAlive = ({ pid }) => holderIsAlive({ pid, start: undefined });

/**
 * Unlink the staged writes of `canonicalPath` that dead writers left. Effectful: a directory listing, a
 * `stat` per candidate, an `unlink` per orphan. A missing directory is a source nothing has written yet, so
 * there is nothing to sweep.
 *
 * @param canonicalPath the canonical file whose staged siblings are weighed
 * @param isAlive answers whether a writer pid still runs; a pid it reads alive is never unlinked
 * @param judge the compaction's protect-list judge; an orphan it refuses to let be written is kept, with its line
 * @returns how many orphans were removed, their bytes, and one warning line per orphan that would not go
 */
export function sweepOrphanTemps({
  canonicalPath,
  isAlive,
  judge,
}: {
  canonicalPath: string;
  isAlive: PidAlive;
  judge: CorpusJudge;
}): OrphanTempSweep {
  const directory = dirname(canonicalPath);
  const target = basename(canonicalPath);
  const entries = stagedEntries({ directory, target });
  let removed = 0;
  let bytes = 0;
  const failureGroups: (readonly string[])[] = [];
  for (const orphan of orphanStagingFiles({ entries, isAlive, target })) {
    const lines = removeOrphan({ judge, path: join(directory, orphan.name) });
    if (lines.length === 0) {
      removed += 1;
      bytes += orphan.bytes;
    } else {
      failureGroups.push(lines);
    }
  }
  return { bytes, failures: failureGroups.flat(), removed };
}

/**
 * Every staged write of `target` in `directory`, with its size; a missing directory or an entry that will not stat
 * is left out, since a source nothing has written yet has nothing to sweep.
 *
 * @param directory the canonical file's folder
 * @param target the canonical file's basename
 * @returns the staged entries, in listing order
 */
function stagedEntries({ directory, target }: { directory: string; target: string }): DirEntryStat[] {
  const listed = safeFs({ execute: () => readdirSync(directory), operation: "compact.sweepList", path: directory });
  if (listed.isErr()) {
    return [];
  }
  const entries: DirEntryStat[] = [];
  for (const name of listed.value.filter((entry) => atomicTempWriterPid({ name: entry, target }) !== undefined)) {
    const path = join(directory, name);
    const statted = safeFs({ execute: () => statSync(path).size, operation: "compact.sweepStat", path });
    if (statted.isOk()) {
      entries.push({ bytes: statted.value, name });
    }
  }
  return entries;
}

/**
 * Unlink one dead writer's staged file, unless the protect list refuses it.
 *
 * @param path the staged file
 * @param judge the compaction's protect-list judge, asked about the file as a write
 * @returns no lines when the file went, else the judge's refusal or the one unlink failure line
 */
function removeOrphan({ path, judge }: { path: string; judge: CorpusJudge }): readonly string[] {
  const judged = judge({ access: "write", path });
  if (judged.isErr()) {
    return judged.error;
  }
  const unlinked = safeFs({
    execute: () => {
      unlinkSync(path);
    },
    operation: "compact.sweepUnlink",
    path,
  });
  return unlinked.isErr() ? [`could not remove a dead writer's staged file ${path}: ${unlinked.error.message}`] : [];
}
