/**
 * The ways a `sweep board --write` read can be partial, each worded for the refusal that leaves the previous
 * document standing (`skills/automation/reference/hygiene-documents.md`): a published board is the whole
 * board or nothing.
 */

import { lstatSync } from "node:fs";
import { join } from "node:path";

import { type JournalEvidence } from "../../../handover/assemble.js";
import { type HandoverDoc } from "../../../handover/doc.js";

/**
 * Whether a path may be on disk: only a missing entry answers no. A probe that could not look — a directory it
 * may not traverse, say — answers yes, and so does a link whose target is gone (`lstat`, never `stat`), so an
 * unreadable blocker is never taken for an absent one.
 *
 * @returns false only when the filesystem says nothing is there
 */
function mayBeOnDisk({ path }: { path: string }): boolean {
  try {
    return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return true;
  }
}

/**
 * The sub-reads a board is assembled over that failed: a row whose text did not read a second time for the
 * supersession pass (gone between the scan and that read), a run journal holding a line the reader could not
 * decode, a `blockedBy` whose archived doc is on disk yet did not read, and an archive file the top-up generation
 * pass could not read. A blocker with no file anywhere is a board fact the rows already carry, not a failed read,
 * so only a file that may be there and did not read counts.
 *
 * @param archived the archived blockers that did read
 * @param texts the slugs whose text the supersession pass could not read
 * @param generations the archive files the generation pass could not read, or the archive itself
 * @returns one reason per kind of failed sub-read, empty when every one read
 */
export function unreadableSubReads({
  docs,
  archived,
  journals,
  handoverDir,
  texts,
  generations,
}: {
  docs: readonly HandoverDoc[];
  archived: readonly HandoverDoc[];
  journals: ReadonlyMap<string, JournalEvidence>;
  handoverDir: string;
  texts: readonly string[];
  generations: readonly string[];
}): readonly string[] {
  const reasons: string[] = [];
  if (texts.length > 0) {
    reasons.push(`${String(texts.length)} row(s) did not read a second time for supersession: ${texts.join(", ")}`);
  }
  if (generations.length > 0) {
    reasons.push(
      `${String(generations.length)} archive read(s) failed for the top-up generation pass: ${generations.join(", ")}`,
    );
  }
  const badJournals = [...journals].filter(([, journal]) => journal.unreadableLines.length > 0).map(([slug]) => slug);
  if (badJournals.length > 0) {
    reasons.push(
      `${String(badJournals.length)} run journal(s) held a line that could not be read: ${badJournals.join(", ")}`,
    );
  }
  const known = new Set([...docs, ...archived].map((doc) => doc.slug));
  const badArchived = [...new Set(docs.flatMap((doc) => doc.blockedBy))].filter(
    (slug) => !known.has(slug) && mayBeOnDisk({ path: join(handoverDir, "archive", `${slug}.md`) }),
  );
  if (badArchived.length > 0) {
    reasons.push(
      `${String(badArchived.length)} archived blocker(s) may be on disk and could not be read: ${badArchived.join(", ")}`,
    );
  }
  return reasons;
}

/**
 * Why this run's selection is not the WHOLE board, so publishing it would replace a good document with part of one.
 *
 * The published document is what the "Nothing stale" card reads as the board's state, so a partial read — a
 * handover file that would not read, a probe the deadline cut, a filtered selection, or another directory
 * read in place of this home's own board — publishes nothing
 * and fails the run, which also keeps the standing row's slot unstamped.
 *
 * @param unreadable the handover files the scan could not read
 * @param subReads each failed sub-read the board was assembled over, already worded
 * @param unresolved the rows whose probes the deadline cut short
 * @param filtered whether `--verdict` or `--priority` narrowed the selection
 * @param elsewhere whether `--dir` pointed the scan away from this home's own handovers directory
 * @returns one reason per way the read was partial, empty when it was whole
 */
export function partialReadReasons({
  unreadable,
  subReads,
  unresolved,
  filtered,
  elsewhere,
}: {
  unreadable: readonly string[];
  subReads: readonly string[];
  unresolved: number;
  filtered: boolean;
  elsewhere: boolean;
}): readonly string[] {
  const before =
    unreadable.length > 0
      ? [`${String(unreadable.length)} handover file(s) could not be read: ${unreadable.join(", ")}`]
      : [];
  const after = [
    ...(unresolved > 0 ? [`the deadline left ${String(unresolved)} row(s)' probes unevaluated`] : []),
    ...(filtered ? ["--verdict or --priority narrowed the selection, and the document is the whole board"] : []),
    ...(elsewhere
      ? ["--dir read a directory other than this home's handovers, and the document is this home's board"]
      : []),
  ];
  return before.concat(subReads, after);
}
