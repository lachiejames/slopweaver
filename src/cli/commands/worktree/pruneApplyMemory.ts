/**
 * `worktree prune`'s apply memory: what earlier applies attempted, so a kept tree is tried after every fresh
 * one. The order's reason is `worktree/pruneOrder.ts`'s; this file is where the record lives and how it is
 * read, merged and written.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { listWorktrees } from "../../../cmux/worktree.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { stateHomePaths } from "../../../stateHome.js";
import { type ApplyMemory, memoryKey, nextApplyMemory } from "../../../worktree/pruneOrder.js";
import { jsonOrUndefined } from "./pruneScanPass.js";

/**
 * Where an apply records what it attempted.
 *
 * @param home the `$SLOPWEAVER_HOME` the record lives under
 * @returns the absolute path of the record
 */
function applyMemoryPath({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).worktreeBundles, "apply-memory.json");
}

const applyMemorySchema = z.object({
  kept: z.array(z.object({ attemptedAtMs: z.number(), path: z.string(), repoRoot: z.string() })),
  repos: z.array(z.object({ lastAttemptMs: z.number(), repoRoot: z.string() })),
});

/** What a home that never ran an apply remembers. */
const NOTHING_ATTEMPTED: ApplyMemory = { kept: [], repos: [] };

/**
 * What earlier applies attempted. An absent file is a home that never applied; an unreadable or malformed
 * one is said out loud and read as nothing attempted, which only costs one run of the rotation.
 *
 * @returns the memory, empty when there is none or it could not be read
 */
export function readApplyMemory({ home }: { home: string }): ApplyMemory {
  const path = applyMemoryPath({ home });
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return NOTHING_ATTEMPTED;
    }
    logger.error({ msg: `worktree prune: could not read ${path} — this apply orders every tree as never attempted` });
    return NOTHING_ATTEMPTED;
  }
  const parsed = applyMemorySchema.safeParse(jsonOrUndefined({ label: "worktree prune apply memory", text }));
  if (!parsed.success) {
    logger.error({
      msg: `worktree prune: ${path} is not an apply memory — this apply orders every tree as never attempted`,
    });
    return NOTHING_ATTEMPTED;
  }
  return parsed.data;
}

/**
 * Replace the apply memory whole.
 *
 * NEVER throws, for the reason `writeScanCursors` gives: the memory orders the next apply, and a write that
 * fails before an attempt must not stop the attempt. What is lost is the ordering, reported here.
 *
 * @param memory every kept attempt and each repository's latest attempt
 * @returns whether the memory was written; a failure is reported on stderr
 */
export function writeApplyMemory({ home, memory }: { home: string; memory: ApplyMemory }): boolean {
  try {
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: "worktree prune apply memory", value: memory })}\n`,
      path: applyMemoryPath({ home }),
    });
    return true;
  } catch (error) {
    logger.error({
      msg: `worktree prune: the apply memory could not be written — the next apply may retry a kept tree early — ${String(error)}`,
    });
    return false;
  }
}

/**
 * Forget every kept attempt whose tree git no longer registers, judged AFTER the stale records are cleared.
 *
 * Each attempt re-normalises the memory against the registrations the scan listed, and those still hold a
 * tree whose directory had gone until `clearStaleRecords` ran. With no attempt after that clear, such a tree
 * stayed kept, ordered behind every fresh one on every later apply, for good. A repository
 * whose list cannot be read NOW is left out of `listed`, so everything it had is carried, never forgotten.
 *
 * @param previous the memory as the rotation left it
 * @param repos the repositories whose registrations to re-read
 * @param list one repository's registered worktree paths, read now; throws when git cannot answer
 * @returns the memory with every tree git no longer registers dropped
 */
export function forgetUnregistered({
  previous,
  repos,
  list,
}: {
  previous: ApplyMemory;
  repos: ReadonlySet<string>;
  list: (args: { repoRoot: string }) => readonly string[];
}): ApplyMemory {
  const listed = new Set<string>();
  const registered = new Set<string>();
  for (const repoRoot of repos) {
    try {
      list({ repoRoot }).forEach((path) => registered.add(memoryKey({ path, repoRoot })));
      listed.add(repoRoot);
    } catch (error) {
      logger.error({
        msg: `worktree prune: ${repoRoot} could not be re-listed — its kept attempts carry — ${String(error)}`,
      });
    }
  }
  return nextApplyMemory({ attempted: [], listed, previous, registered });
}

/**
 * Re-list each repository now its stale records are cleared, and persist the memory without the gone trees.
 *
 * @param repos the repositories whose registrations to re-read
 */
export function forgetGoneTrees({ home, repos }: { home: string; repos: ReadonlySet<string> }): void {
  writeApplyMemory({
    home,
    memory: forgetUnregistered({
      list: ({ repoRoot }) => listWorktrees({ repoRoot }).map((worktree) => worktree.path),
      previous: readApplyMemory({ home }),
      repos,
    }),
  });
}
