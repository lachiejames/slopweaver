/**
 * The one effectful edge of the compaction measurement: which transcripts to walk, and walking them.
 *
 * Both halves already exist in `../transcripts/source.ts` and are reused rather than rebuilt —
 * {@link listSessions} for the inventory (newest first, each carrying `lastWriteMs`, subagent transcripts
 * deliberately excluded) and {@link transcriptLines} for a bounded, chunked pass over one file's raw lines.
 * Nothing here holds a transcript whole: `du -sh ~/.claude/projects` reported 4.1 GB over 2,817 files, which is precisely the shape the `whole-file-json` gate exists to refuse.
 *
 * ## A file that will not open is a COUNT, never a gap
 *
 * A transcript can vanish mid-walk — sessions end while this runs — and a project directory can be
 * unreadable. Each becomes a named problem on {@link CompactionScan.problems}, so a pass that read less
 * than the whole corpus says so rather than reporting a smaller number as if it were the answer. Only the
 * projects directory being unlistable is fatal, because then there is nothing to be partial about.
 */
import { err, ok, type Result } from "../lib/result.js";
import type { TranscriptSourceError } from "../transcripts/errors.js";
import { listSessions, transcriptLines } from "../transcripts/source.js";
import {
  advanceCompactionFold,
  emptyCompactionFold,
  finishCompactionFold,
  type TranscriptCompaction,
} from "./compactionFold.js";

/** What one pass over the corpus found. */
export interface CompactionScan {
  /** One entry per transcript that was walked to the end. */
  readonly transcripts: readonly TranscriptCompaction[];
  /** How many transcripts the inventory held inside the window, walked or not. */
  readonly considered: number;
  /** Every file that could not be opened or was read only in part, named. Empty on a complete pass. */
  readonly problems: readonly string[];
  /** The oldest transcript write this pass looked at, so the document can state its own reach. */
  readonly oldestWriteMs: number;
}

/**
 * Walk every transcript written since an instant, folding each into what compaction cost it.
 *
 * @param projectsDir `~/.claude/projects`
 * @param sinceMs only transcripts written at or after this instant are walked
 * @returns what the pass measured, or the reason the corpus could not be listed at all
 */
export function scanCompactions({
  projectsDir,
  sinceMs,
}: {
  projectsDir: string;
  sinceMs: number;
}): Result<CompactionScan, TranscriptSourceError> {
  const listed = listSessions({ projectsDir });
  if (listed.isErr()) {
    return err(listed.error);
  }
  const inWindow = listed.value.filter((session) => session.lastWriteMs >= sinceMs);
  const transcripts: TranscriptCompaction[] = [];
  const problems: string[] = [];
  let oldestWriteMs = Number.MAX_SAFE_INTEGER;
  for (const session of inWindow) {
    oldestWriteMs = Math.min(oldestWriteMs, session.lastWriteMs);
    const opened = transcriptLines({ path: session.path });
    if (opened.isErr()) {
      problems.push(opened.error.message);
      continue;
    }
    const stream = opened.value;
    const fold = emptyCompactionFold();
    for (const raw of stream.lines) {
      if ("oversized" in raw) {
        continue;
      }
      advanceCompactionFold({ fold, line: raw.line });
    }
    stream.problems.forEach((problem) => problems.push(`${session.sessionId}: ${problem}`));
    transcripts.push(finishCompactionFold({ fold }));
  }
  return ok({
    considered: inWindow.length,
    oldestWriteMs: inWindow.length === 0 ? sinceMs : oldestWriteMs,
    problems,
    transcripts,
  });
}
