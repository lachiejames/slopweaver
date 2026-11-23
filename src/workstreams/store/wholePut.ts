/**
 * A whole-register write: the schema-version-2 document `workstreams list --json` printed, edited and handed back to
 * `workstreams put`, turned into ONE `applyBatch` — never a loop of puts.
 *
 * ## Fenced by the document's own baseline
 *
 * The document carries the `baseline` it was read at (`./projection.ts`), and that is the only one used: there is no
 * flag and no fresh read substituted for it, so a stale document is refused whichever way it arrives. A document with
 * no baseline is judged against the EMPTY register's, so a hand-written one can seed an empty store and never
 * overwrite a populated one.
 *
 * The baseline is compared against a read; that read's revisions then go to the batch's `wholeRegister` and its
 * register-document compare, so a change between the read and the commit refuses as well — and `workstreams put`
 * reports that refusal as `WORKSTREAM_BASELINE_STALE` against a fresh read, even when only a revision moved.
 *
 * ## What the batch carries
 *
 * Every workstream in the document whose authored content differs from what the store holds is written at the
 * revision just read (`null`, a create, for a new id); every id the store holds and the document omits is deleted at
 * its revision; the register document is settled to the document's `meta` at its revision or absence. Unchanged
 * workstreams are not rewritten, so a revision moves only when its content did.
 *
 * Pure.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { stableStringify } from "#lib/stableStringify.js";
import { slackChannelOf } from "../slackChannel.js";
import { EMPTY_REGISTER_BASELINE, REGISTER_BASELINE_PATTERN, snapshotBaseline } from "./baseline.js";
import { canonicalAggregate } from "./canonical.js";

import { decodeAggregate, decodeWorkstreamMeta, typedWorkstreamDetail } from "./decode.js";
import { type WorkstreamStoreError, WorkstreamStoreErrors } from "./errors.js";
import type { WorkstreamBatchRequest } from "./judge.js";
import { authoredAggregate } from "./projection.js";
import type { WorkstreamAggregate, WorkstreamRegisterMeta, WorkstreamRegisterSnapshot } from "./types.js";

/** A document `workstreams put` takes: what a person wants the whole register to be, and what they read it at. */
export interface WholeRegisterDocument {
  /** The baseline the document was read at; the empty register's when it carried none. */
  readonly baseline: string;
  readonly meta: WorkstreamRegisterMeta | null;
  readonly workstreams: readonly WorkstreamAggregate[];
}

/** The one batch a document becomes: a store batch whose register-document settlement is always stated. */
export type WholeRegisterBatch = WorkstreamBatchRequest & Required<Pick<WorkstreamBatchRequest, "meta">>;

/** The keys an authored aggregate has, exactly; anything else on a workstream but `derived` is refused. */
const AGGREGATE_KEYS = new Set([
  "detail",
  "entries",
  "id",
  "kind",
  "links",
  "milestones",
  "name",
  "outcome",
  "status",
  "workspace",
]);

/**
 * The document's outer shape. The list's own read-only fields (`lanes`, `priorities`, `people`) may ride along, so the
 * list's output is accepted back unedited; anything else at the top is refused.
 */
const documentSchema = z.strictObject({
  baseline: z.string().regex(REGISTER_BASELINE_PATTERN, "a baseline is wsb1. and 64 lowercase hex").optional(),
  lanes: z.unknown().optional(),
  meta: z.unknown().nullable(),
  people: z.unknown().optional(),
  priorities: z.unknown().optional(),
  schemaVersion: z.literal(2),
  workstreams: z.array(z.record(z.string(), z.unknown())),
});

/**
 * One workstream of the document as its authored aggregate, `derived` dropped.
 *
 * @param at its index, to name in each problem
 * @returns the aggregate, or every problem with its shape
 */
function workstreamOf({
  at,
  value,
}: {
  at: number;
  value: Readonly<Record<string, unknown>>;
}): Result<WorkstreamAggregate> {
  const { derived: _derived, ...authored } = value;
  const unknownKeys = Object.keys(authored)
    .filter((key) => !AGGREGATE_KEYS.has(key))
    .map((key) => `workstreams.${String(at)}.${key}: not a field of a workstream`);
  // The type is proven here; the store's own judge refuses every rule beyond it on write.
  const decoded = decodeAggregate({ value: authored });
  if (decoded.isErr()) {
    return err([...unknownKeys, ...decoded.error.map((problem) => `workstreams.${String(at)}: ${problem}`)]);
  }
  if (unknownKeys.length > 0) {
    return err(unknownKeys);
  }
  return ok(decoded.value);
}

/**
 * Every Slack conversation a workstream's entries and feedback link into that the register document does not name.
 * A citation never shows a channel id, because the owner knows channels only by name, so a link into a conversation the
 * `channels` map lacks is refused rather than drawn as an id.
 *
 * @param channels the register document's map of conversation id to the words the owner knows it by
 * @returns one problem per unnamed conversation, in document order, once each
 */
function unnamedChannelProblems({
  channels,
  workstreams,
}: {
  channels: Readonly<Record<string, string>>;
  workstreams: readonly WorkstreamAggregate[];
}): readonly string[] {
  const hrefs = workstreams.flatMap((aggregate) => {
    const typed = typedWorkstreamDetail({ aggregate });
    let feedback: readonly { readonly href: string | null }[] = [];
    if (typed.kind !== "local" && typed.kind !== "closing") {
      feedback = typed.detail.feedback;
    }
    return [...aggregate.entries, ...feedback].flatMap((one) => (one.href === null ? [] : [one.href]));
  });
  const unnamed = hrefs.flatMap((href) => {
    const channel = slackChannelOf({ href });
    return channel === undefined || Object.hasOwn(channels, channel) ? [] : [channel];
  });
  return [...new Set(unnamed)].map(
    (channel) => `a link points into Slack channel ${channel}, which channels does not name`,
  );
}

/**
 * Parse a whole-register document.
 *
 * @param value the parsed JSON a person handed `workstreams put`
 * @returns the document, or `WORKSTREAM_INVALID` naming every problem, a Slack link into a conversation the
 *   register document does not name among them — nothing is written on any
 */
export function parseWholeRegisterDocument({
  value,
}: {
  value: unknown;
}): Result<WholeRegisterDocument, WorkstreamStoreError> {
  const parsed = documentSchema.safeParse(value);
  if (!parsed.success) {
    return err(
      WorkstreamStoreErrors.invalid({
        problems: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      }),
    );
  }
  const problems: string[] = [];
  const workstreams: WorkstreamAggregate[] = [];
  parsed.data.workstreams.forEach((one, at) => {
    const decoded = workstreamOf({ at, value: one });
    if (decoded.isErr()) {
      problems.push(...decoded.error);
      return;
    }
    workstreams.push(decoded.value);
  });
  let meta: WorkstreamRegisterMeta | null = null;
  if (parsed.data.meta !== null) {
    const decoded = decodeWorkstreamMeta({ value: parsed.data.meta });
    if (decoded.isErr()) {
      problems.push(...decoded.error);
    } else {
      meta = decoded.value;
    }
  }
  if (problems.length === 0) {
    let channels: Readonly<Record<string, string>> = {};
    if (meta !== null) {
      channels = meta.channels;
    }
    problems.push(...unnamedChannelProblems({ channels, workstreams }));
  }
  if (problems.length > 0) {
    return err(WorkstreamStoreErrors.invalid({ problems }));
  }
  let baseline = EMPTY_REGISTER_BASELINE;
  if (parsed.data.baseline !== undefined) {
    baseline = parsed.data.baseline;
  }
  return ok({ baseline, meta, workstreams });
}

/**
 * The canonical serialisation of an aggregate's authored content, to tell a changed workstream from an unchanged one.
 *
 * @returns the text
 */
function contentOf({ aggregate }: { aggregate: WorkstreamAggregate }): string {
  return stableStringify({ value: canonicalAggregate({ aggregate: authoredAggregate({ stored: aggregate }) }) });
}

/**
 * The one batch that makes the register the document, judged against one read of the store.
 *
 * @param document what the person wants the register to be, and the baseline they read it at
 * @param snapshot what the store holds now, revisions included
 * @returns the batch, or `WORKSTREAM_BASELINE_STALE` when the register is not what the document was read at
 */
export function wholeRegisterBatch({
  document,
  snapshot,
}: {
  document: WholeRegisterDocument;
  snapshot: WorkstreamRegisterSnapshot;
}): Result<WholeRegisterBatch, WorkstreamStoreError> {
  const actual = snapshotBaseline({ snapshot });
  if (actual !== document.baseline) {
    return err(WorkstreamStoreErrors.baselineStale({ actual, expected: document.baseline }));
  }
  const stored = new Map(snapshot.workstreams.map((one) => [one.id, one]));
  const kept = new Set(document.workstreams.map((one) => one.id));
  const writes = document.workstreams.flatMap((aggregate): WorkstreamBatchRequest["writes"] => {
    const current = stored.get(aggregate.id);
    if (current === undefined) {
      return [{ aggregate, expectedRevision: null }];
    }
    if (contentOf({ aggregate: current }) === contentOf({ aggregate })) {
      return [];
    }
    return [{ aggregate, expectedRevision: current.revision }];
  });
  const deletes = snapshot.workstreams
    .filter((one) => !kept.has(one.id))
    .map((one) => ({ expectedRevision: one.revision, workstreamId: one.id }));
  let metaRevision: number | null = null;
  if (snapshot.meta !== null) {
    metaRevision = snapshot.meta.revision;
  }
  return ok({
    deletes,
    meta: { document: document.meta, expectedRevision: metaRevision },
    wholeRegister: Object.fromEntries(snapshot.workstreams.map((one) => [one.id, one.revision])),
    writes,
  });
}
