/**
 * A stored row read back as a `CorpusRecord` — the one direction {@link ./project.projectRecord} does not go.
 *
 * ## Why this exists rather than a second rendering
 *
 * `store cite` prints a slice through {@link ../cli/commands/store/citeCore.renderCiteLines}, which takes
 * `CorpusRecord[]`, and a citation is {@link ../retrieval/citeToken.citeToken} of a record's `container`
 * and `sourceId`. Both of those are things the store already holds. So a store-backed read composes with
 * the shipped rendering and the shipped citation path by turning a row back into a record, instead of
 * growing a second set of lines and a second notion of what a record is cited by. Two renderings of one
 * corpus is how a citation ends up pointing at the wrong message while looking well-formed.
 *
 * ## It is LOSSY, and here is exactly what it loses
 *
 * This is not an inverse and must never be described as one. `projectRecord` deliberately drops `raw`
 * (measured 31.3%–64.7% of record bytes, most of it the body a second time — `docs/store/fleet-state-and-measurements.md`) and moves
 * each source's claimed attributes into that source's own columns. So a record read back here carries:
 *
 * - `refs` and the UNCLAIMED attributes, both out of `metadata`, exactly as they were stored;
 * - **no `raw` at all**, ever;
 * - **no claimed attribute** — a Slack record's `channel`, a Linear record's `state`, a GitHub record's
 *   `reviewDecision` live in the per-source tables now, and a caller that wants one reads the row.
 *
 * Nothing that reads a record from here may branch on `raw`, and the field is left ABSENT rather than set
 * to an empty object so that "the store does not carry this" cannot be mistaken for "the payload was
 * empty".
 *
 * ## The one id that has to be un-qualified
 *
 * A GitHub row's stored `source_id` is `owner/repo#<number>` where bronze wrote `#<number>`, because `#n` is
 * unique inside a repository and the store's identity is `(source, source_id)` — the measurement is in
 * `project.ts`'s header. `citeToken` re-qualifies a GitHub id from its container, so handing it the
 * already-qualified id would produce `acme/acme-admin/acme/acme-admin#<number>`. The qualification
 * is therefore undone here, which also makes the round trip `record → row → record` identity-preserving
 * on the three fields a pin is made of.
 *
 * ## Why `kind`, `source` and `visibility` need no cast
 *
 * They are already the corpus's own unions: `content_kind` is built FROM `CORPUS_KINDS`,
 * `content_source` is `CorpusSource` minus `gold`, and `visibility` is `CorpusVisibility`
 * (`src/store/schema/enums.ts`, asserted by `src/__tests__/unit/store/schemaDrift.test.ts`). An assertion
 * here would be ceremony that also hid a real drift the day one of those vocabularies moved.
 */
import type { CorpusAttributeValue, CorpusRecord } from "../corpus/types.js";

import { isRecord } from "../lib/parsers.js";

import type { ContentRow } from "./schema/content.js";

/**
 * The id bronze wrote for a row, which for GitHub is not the id the store addresses it by.
 *
 * @param row the stored content row
 * @param container the container's native id, as `container.native_id` holds it
 * @returns the unqualified source id
 */
function bronzeSourceId({ row, container }: { row: ContentRow; container: string }): string {
  if (row.source !== "github" || container.length === 0 || !row.sourceId.startsWith(container)) {
    return row.sourceId;
  }
  return row.sourceId.slice(container.length);
}

/**
 * The cross-references a row's metadata carries, as the projection wrote them.
 *
 * @param metadata the row's metadata bag
 * @returns every ref that is a string, in stored order
 */
function refsFrom({ metadata }: { metadata: Record<string, unknown> }): readonly string[] {
  const refs = metadata["refs"];
  if (!Array.isArray(refs)) {
    return [];
  }
  return refs.filter((ref): ref is string => typeof ref === "string");
}

/**
 * Whether a value read out of jsonb is one a corpus attribute may hold.
 *
 * Narrowed rather than asserted, and the difference is not ceremony: `metadata` is a jsonb column, so
 * what comes back is whatever was written, and a nested object asserted into this union would travel as
 * a `CorpusAttributeValue` until something read it as a string. Anything outside the union is DROPPED,
 * which is correct by construction — the projection only ever writes a record's own attributes here.
 *
 * @returns whether the value is a string, number, boolean or array of strings
 */
function isAttributeValue(value: unknown): value is CorpusAttributeValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * The unclaimed attributes a row's metadata carries, when it carries any.
 *
 * @param metadata the row's metadata bag
 * @returns the residual attributes, or `undefined` when the projection stored none
 */
function attrsFrom({
  metadata,
}: {
  metadata: Record<string, unknown>;
}): Record<string, CorpusAttributeValue> | undefined {
  const attrs = metadata["attrs"];
  if (!isRecord(attrs)) {
    return undefined;
  }
  const kept: Record<string, CorpusAttributeValue> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (isAttributeValue(value)) {
      kept[key] = value;
    }
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * Read one stored row back as the corpus record the shipped renderers and the citation path take. Pure.
 *
 * @param row the stored content row
 * @param container the container's native id, which the projection stored verbatim. NOT nullable: a
 *   citation is computed from it, so a row whose container did not resolve cannot be cited at all — the
 *   caller counts and reports that row rather than handing this an empty string to cite against
 * @param author the resolved author's display name, or `null` when the row has none
 * @returns the record, carrying everything the store kept and nothing it did not
 */
export function recordFromStoreRow({
  row,
  container,
  author,
}: {
  row: ContentRow;
  container: string;
  author: string | null;
}): CorpusRecord {
  const attrs = attrsFrom({ metadata: row.metadata });
  return {
    container,
    kind: row.kind,
    refs: refsFrom({ metadata: row.metadata }),
    source: row.source,
    sourceId: bronzeSourceId({ container, row }),
    text: row.body,
    tsIso: row.occurredAt.toISOString(),
    url: row.url,
    visibility: row.visibility,
    ...(attrs !== undefined ? { attrs } : {}),
    ...(author !== null && author.length > 0 ? { author } : {}),
    ...(row.title !== null && row.title.length > 0 ? { title: row.title } : {}),
  };
}
