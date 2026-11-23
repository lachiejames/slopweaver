/**
 * The token pass's one effectful edge over the transcript corpus: which transcripts to walk, and walking them.
 *
 * Unlike `./compactionStore.ts` this walk INCLUDES subagent transcripts (`<session>/subagents/*.jsonl`), which
 * `../transcripts/source.ts`'s `listSessions` leaves out on purpose. A session is a window the owner runs; a subagent
 * is not one, but it draws from the same plan — MEASURED, 880 subagent transcripts took 9.9% of
 * the fleet's draw, which a session-only walk reports as zero.
 *
 * A file that will not open is a named problem, never a quiet gap; only an unlistable projects directory is
 * fatal. Nothing here holds a transcript whole.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "../lib/result.js";
import type { TranscriptSourceError } from "../transcripts/errors.js";
import { listSessions, transcriptLines } from "../transcripts/source.js";
import { advanceSpendFold, emptySpendFold, finishSpendFold, type TranscriptSpend } from "./spendFold.js";

/** What one pass over the corpus found. */
export interface SpendScan {
  readonly transcripts: readonly TranscriptSpend[];
  /** Every file that could not be opened or was read only in part, named. Empty on a complete pass. */
  readonly problems: readonly string[];
}

/**
 * A session's subagent transcripts written since the instant, or none when it has no subagents directory.
 *
 * @param sessionPath the session transcript whose `subagents` directory is read
 * @param sinceMs only a subagent transcript written at or after this instant is returned
 * @returns the paths
 */
function subagentPaths({ sessionPath, sinceMs }: { sessionPath: string; sinceMs: number }): readonly string[] {
  const dir = join(sessionPath.slice(0, -".jsonl".length), "subagents");
  let names: readonly string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  } catch {
    // No `subagents` directory is the ordinary case: most sessions never spawn one.
    return [];
  }
  return names
    .map((name) => join(dir, name))
    .filter((path) => {
      try {
        return statSync(path).mtimeMs >= sinceMs;
      } catch {
        return false;
      }
    });
}

/** Fold one transcript, or name why it could not be read. */
function foldOne({
  path,
  problems,
  botHandles,
}: {
  path: string;
  problems: string[];
  botHandles: readonly string[];
}): TranscriptSpend | undefined {
  const opened = transcriptLines({ path });
  if (opened.isErr()) {
    problems.push(opened.error.message);
    return undefined;
  }
  const fold = emptySpendFold();
  for (const raw of opened.value.lines) {
    if ("oversized" in raw) {
      continue;
    }
    advanceSpendFold({ fold, line: raw.line });
  }
  opened.value.problems.forEach((problem) => problems.push(`${path}: ${problem}`));
  return finishSpendFold({ botHandles, fold, path });
}

/**
 * Walk every session and subagent transcript written since an instant.
 *
 * A session last written BEFORE the instant is skipped with its subagents, which cannot have been written
 * after the session that spawned them went quiet.
 *
 * @param projectsDir `~/.claude/projects`, or a fixture
 * @param sinceMs only transcripts written at or after this instant are walked
 * @param botHandles the install's own bot handles, which mark a bot seat by its working directory
 * @returns every transcript's contribution, or why the corpus could not be listed
 */
export function scanSpend({
  projectsDir,
  sinceMs,
  botHandles,
}: {
  projectsDir: string;
  sinceMs: number;
  botHandles: readonly string[];
}): Result<SpendScan, TranscriptSourceError> {
  const listed = listSessions({ projectsDir });
  if (listed.isErr()) {
    return err(listed.error);
  }
  const problems: string[] = [];
  const transcripts: TranscriptSpend[] = [];
  for (const session of listed.value.filter((entry) => entry.lastWriteMs >= sinceMs)) {
    for (const path of [session.path, ...subagentPaths({ sessionPath: session.path, sinceMs })]) {
      const folded = foldOne({ botHandles, path, problems });
      if (folded !== undefined) {
        transcripts.push(folded);
      }
    }
  }
  return ok({ problems, transcripts });
}
