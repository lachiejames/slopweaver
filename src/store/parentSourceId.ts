/**
 * The rules that turn a stored content id into the stored id of the row it replies to.
 *
 * Pure, and shared by the two writers of `content.parent_source_id`: the projection (`./project.ts`) over a
 * bronze record, and the backfill (`./resolveEdges.ts`) over rows already stored. One module both import is
 * what keeps "a reload from bronze and a backfill from the store are the same shape of work" true, rather
 * than a second copy of these rules drifting in SQL.
 */

/**
 * The suffix that makes a stored id a CHILD's id, per source, and whether that source chunks.
 *
 * A closed per-source list rather than "the text before the first colon", and the difference is not
 * style. MEASURED against the live store: the first-colon rule turns Linear's
 * `project:<uuid>`, `initiative:<uuid>`, `document:<uuid>`, `projectUpdate:<uuid>`, `milestone:<uuid>`
 * and `need:<uuid>` into the bare words `project`, `initiative`, `document`, `projectUpdate`,
 * `milestone` and `need`, and GitHub's `<repo>#<n>:state` into the pull request's own number — thousands
 * of Linear rows and most of tens of thousands of GitHub pull requests claiming a parent that is a word, not a row. Every
 * one of them would have been stored as a dangling edge indistinguishable from a real parent outside the
 * ingested window, which is the one distinction {@link ./schema/content} keeps this column to make.
 *
 * `chunked` is the second rule: a source that splits one document across rows addresses them
 * `<id>:chunk:<n>`, and chunk n>0's parent is chunk 0 rather than a bare `<id>` no row carries. Notion
 * chunks about three in four of its pages this way and Slack chunks its huddle transcripts.
 *
 * What each rule found, live — reproduce with `slopweaver store edges --json`:
 *
 * | source | rule               | edges              | dangling share |
 * | ------ | ------------------ | ------------------ | -------------- |
 * | slack  | `:reply:`          | hundreds of thousands | about 2%    |
 * | slack  | `:file:`           | tens of thousands  | about half     |
 * | slack  | `:chunk:` (huddle) | hundreds           | none           |
 * | github | `:comment:`        | about a hundred thousand | under 1% |
 * | github | `:review:`         | tens of thousands  | under 1%       |
 * | notion | `:chunk:`          | about a hundred thousand | one row  |
 * | notion | `:comment:`        | over a thousand    | over half      |
 * | linear | `:comment:`        | tens of thousands  | under 2%       |
 *
 * Slack's `:file:` lane is the one with a large dangling share, and it is the column earning its keep
 * rather than a broken rule: a file record is captured by the files lane whether or not the message that
 * carries it fell inside an ingested window, so about half of them name a real parent this store does not
 * hold yet. Storing the key means the next ingest of that message resolves them; storing only a uuid
 * would have thrown the question away.
 */
const PARENT_RULES: Readonly<Record<string, { readonly chunked: boolean; readonly markers: readonly string[] }>> = {
  github: { chunked: false, markers: [":comment:", ":review:"] },
  linear: { chunked: false, markers: [":comment:"] },
  notion: { chunked: true, markers: [":comment:"] },
  slack: { chunked: true, markers: [":reply:", ":file:"] },
};

/** How a chunked source addresses part n of one document. */
const CHUNK_MARKER = ":chunk:";

/**
 * The text before a marker's first occurrence, when the marker is there and something precedes it.
 *
 * @param value the stored id to split
 * @param marker the child suffix to split at
 * @returns the parent's id, or `null` when this id carries no such suffix
 */
function beforeMarker({ value, marker }: { value: string; marker: string }): string | null {
  const at = value.indexOf(marker);
  if (at <= 0) {
    return null;
  }
  return value.slice(0, at);
}

/**
 * Chunk zero of the document a later chunk belongs to.
 *
 * @param sourceId the stored id of a chunk
 * @returns chunk zero's id, or `null` when this id is not a chunk after the first
 */
function siblingChunkZero({ sourceId }: { sourceId: string }): string | null {
  const at = sourceId.lastIndexOf(CHUNK_MARKER);
  if (at <= 0) {
    return null;
  }
  const ordinal = sourceId.slice(at + CHUNK_MARKER.length);
  if (!/^\d+$/.test(ordinal) || Number(ordinal) === 0) {
    return null;
  }
  return `${sourceId.slice(0, at)}${CHUNK_MARKER}0`;
}

/**
 * The parent this id names through its own suffix, under its source's rules.
 *
 * @param source the record's source
 * @param sourceId the id as the store addresses it
 * @returns the parent's stored id, or `null` when nothing in the rules matches
 */
function ruledParent({ source, sourceId }: { source: string; sourceId: string }): string | null {
  const rule = PARENT_RULES[source];
  if (rule === undefined) {
    return null;
  }
  for (const marker of rule.markers) {
    const before = beforeMarker({ marker, value: sourceId });
    if (before !== null) {
      return before;
    }
  }
  if (rule.chunked) {
    return siblingChunkZero({ sourceId });
  }
  return null;
}

/**
 * The row a Linear comment names as its own parent comment, promoted to a stored id.
 *
 * Linear is the one source whose nesting is not in the id: a reply to a comment is addressed
 * `<ISSUE>:comment:<its own uuid>` and names its parent in `attrs.parentComment`. Tens of thousands of rows carried
 * that uuid as a bare string in `metadata` (measured) — it is the half of this edge that sits as bare strings inside an unindexed JSONB column, and it is the half this function moves.
 *
 * @param source the record's source
 * @param sourceId the id as the store addresses it
 * @param parentComment the uuid Linear gave for the comment this one replies to
 * @returns the parent comment's stored id, or `null` when this is not a nested Linear comment
 */
function nestedLinearComment({
  source,
  sourceId,
  parentComment,
}: {
  source: string;
  sourceId: string;
  parentComment: string | null;
}): string | null {
  if (source !== "linear" || parentComment === null || parentComment.length === 0) {
    return null;
  }
  const issue = beforeMarker({ marker: ":comment:", value: sourceId });
  if (issue === null) {
    return null;
  }
  return `${issue}:comment:${parentComment}`;
}

/**
 * The stored id of the row this one is a reply to, or `null` when it starts its own thread.
 *
 * Pure, and deliberately taking the STORED id rather than a `CorpusRecord`, so the projection and the
 * backfill over rows already in the database call the same function with the same rules. `project.ts`'s
 * own header is where that requirement comes from — "a reload from bronze and a backfill from the store
 * are the same shape of work" — and a second copy of these rules written in SQL for the backfill is
 * exactly the drift it warns about.
 *
 * It resolves nothing: the answer is a `(source, source_id)` half, and turning it into
 * `content.parent_id` is a later pass's job, because a reply is routinely ingested before its parent.
 *
 * **`parentComment` therefore stays in `metadata.attrs` rather than being claimed**, which is the one
 * place `project.ts`'s usual rule — a column claims its attribute so the fact lives in exactly one place —
 * is deliberately not applied. The backfill re-derives from the STORED row, so every input to these rules
 * has to survive in that row; claiming it was tried and is a data-loss bug, because the next pass after a
 * re-ingest would read a null `parentComment`, derive the ISSUE, and overwrite a correct nested edge with
 * a less specific one while `parent_id` still pointed at the comment. The derived key is not a duplicate
 * of this attribute — it is a function of it that no longer has a way of being recomputed once it is gone.
 *
 * @param source the record's source, which selects the rules
 * @param sourceId the id as the store addresses it — `project.ts`'s `storedSourceId`, not bronze's own
 * @param parentComment Linear's `attrs.parentComment` uuid when the record carries one
 * @returns the parent's stored id, or `null` when this row has no parent in this store's vocabulary
 */
export function parentSourceId({
  source,
  sourceId,
  parentComment,
}: {
  source: string;
  sourceId: string;
  parentComment: string | null;
}): string | null {
  const nested = nestedLinearComment({ parentComment, source, sourceId });
  if (nested !== null && nested !== sourceId) {
    return nested;
  }
  // A nested comment that names ITSELF as its parent is a provider-shaped data error, and the useful
  // answer is the issue it sits under rather than nothing: dropping the row would take it out of its own
  // thread, which is the read this column exists to serve. So a self-edge falls through to the id rule.
  const ruled = ruledParent({ source, sourceId });
  if (ruled === null || ruled.length === 0 || ruled === sourceId) {
    return null;
  }
  return ruled;
}
