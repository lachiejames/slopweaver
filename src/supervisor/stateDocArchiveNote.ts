/**
 * The archive-note chain `slopweaver supervisor state-archive` writes into a state doc's preamble — the one
 * sentence per archive, each reading `(archived by handoff-<n>). Nothing was deleted.`, that the next archive
 * anchors on. Split from `./stateDocEdit.ts`, which moves the block and renders the archive file; this module
 * only places the note.
 *
 * Pure: no I/O and no clock.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type StateDocEditError, StateDocEditErrors } from "./stateDocBlock.js";

/**
 * The sentence every archive note ends in, for any seat. A preamble carrying none has never been archived, so
 * its first archive SEEDS the chain rather than extending one. A preamble carrying some other seat's note but
 * not the predecessor's is a broken chain, and that still refuses.
 */
const ANY_ARCHIVE_NOTE = /\(archived by handoff-\d+\)\. Nothing was deleted\./;

/**
 * Chain the new archive note onto the preamble, straight after the predecessor's own.
 *
 * The anchor is the sentence the predecessor wrote when IT archived its own predecessor, so the chain is the
 * doc's own convention rather than a literal this repository carries. It must occur exactly once, and
 * everything after it — the restore history — is preserved by construction, because the note is inserted
 * rather than appended. The one exception is a doc never archived at all — no seat's note anywhere in the
 * preamble, which is every fresh install's doc — where the note seeds the chain as the preamble's last paragraph.
 *
 * @param preamble the doc above the archived block, trailing blank lines already dropped
 * @param predecessor the archived seat's handoff number
 * @param successor the archiving seat's handoff number
 * @param description the one-line account of the archived shift
 * @param archiveDisplayPath the path the note names, inside backticks
 * @param movedFrom the 1-based lines the block occupied
 * @returns the preamble with the note in it, ending in one blank line, or the refusal
 */
export function chainArchiveNote({
  preamble,
  predecessor,
  successor,
  description,
  archiveDisplayPath,
  movedFrom,
}: {
  preamble: string;
  predecessor: string;
  successor: string;
  description: string;
  archiveDisplayPath: string;
  movedFrom: { readonly first: number; readonly last: number };
}): Result<string, StateDocEditError> {
  const anchor = `(archived by handoff-${predecessor}). Nothing was deleted.`;
  const matches = preamble.split(anchor).length - 1;
  const note =
    `The handoff-${predecessor} block (lines ${String(movedFrom.first)}-${String(movedFrom.last)}, ${description})` +
    ` is in \`${archiveDisplayPath}\` (archived by handoff-${successor}). Nothing was deleted.`;
  const seeding = matches === 0 && !ANY_ARCHIVE_NOTE.test(preamble);
  if (!seeding && matches !== 1) {
    return err(StateDocEditErrors.archiveNoteNotFound({ anchor, matches }));
  }
  const head = seeding ? seedArchiveNote({ note, preamble }) : preamble.replace(anchor, `${anchor} ${note}`);
  // The next archive anchors on this successor's sentence, so the head must carry it exactly once — a
  // description or path quoting it, or a stray copy already in the preamble, would leave that archive refused.
  const successorAnchor = `(archived by handoff-${successor}). Nothing was deleted.`;
  const successorMatches = head.split(successorAnchor).length - 1;
  if (successorMatches !== 1) {
    return err(
      StateDocEditErrors.inputRejected({
        reason: `the finished preamble would carry ${String(successorMatches)} copies of "${successorAnchor}", so the next archive could not chain after it — exactly one is required`,
      }),
    );
  }
  return ok(`${head}\n\n`);
}

/**
 * Start the archive-note chain on a doc that has never been archived: the note goes in as the preamble's last
 * paragraph, so the next archive finds this successor's sentence exactly once and chains after it.
 *
 * @param preamble the doc above the archived block, trailing blank lines already dropped
 * @param note the note sentence, ending in this successor's `(archived by handoff-<n>). Nothing was deleted.`
 * @returns the preamble with the note as its last paragraph, or the note alone when the preamble is empty
 */
function seedArchiveNote({ preamble, note }: { preamble: string; note: string }): string {
  if (preamble.length === 0) {
    return note;
  }
  return `${preamble}\n\n${note}`;
}
