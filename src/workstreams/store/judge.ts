/**
 * Every judgement a proposed write gets before the store is touched — one aggregate, the register document, and a
 * batch of both — in one module, so the port and the in-memory fake the tests drive refuse exactly the same writes.
 *
 * A `workstream` link's target counts as known here; whether it exists is the store's to prove under lock, against the
 * register the write leaves (`./aggregateWrite.ts`, `./batchWrite.ts`).
 *
 * Pure.
 */
import { err, ok, type Result } from "#lib/result.js";

import { byCodeUnit, canonicalAggregate } from "./canonical.js";
import { aggregateShapeProblems, decodeWorkstreamDetail, decodeWorkstreamMeta } from "./decode.js";
import { KEBAB_ID } from "./linkTarget.js";
import { STORE_INTEGER_MAX, STORE_KEY_MAX_CHARACTERS, unstorableStrings, writeRevisionProblem } from "./storable.js";
import {
  WORKSTREAM_ENTRY_KINDS,
  WORKSTREAM_KINDS,
  WORKSTREAM_LINK_KINDS,
  WORKSTREAM_STATUSES,
  WORKSTREAM_WORKSPACES,
  type WorkstreamAggregate,
  type WorkstreamRegisterMeta,
} from "./types.js";
import { aggregateProblems } from "./validation.js";

/** One workstream a batch writes: revision `null` creates it, a number updates it iff the row still carries it. */
export interface WorkstreamBatchWrite {
  readonly aggregate: WorkstreamAggregate;
  readonly expectedRevision: number | null;
}

/** One workstream a batch deletes, iff it is at the revision and nothing the batch leaves links to it. */
export interface WorkstreamBatchDelete {
  readonly workstreamId: string;
  readonly expectedRevision: number;
}

/**
 * What a batch settles the register document to, by compare-and-set on its revision, `null` meaning no row:
 *
 * | `expectedRevision` | `document` | the batch                                   |
 * | ------------------ | ---------- | ------------------------------------------- |
 * | `null`             | `null`     | asserts there is no document, writing none  |
 * | `null`             | a document | creates it                                  |
 * | a revision         | a document | updates it iff it is still at that revision |
 * | a revision         | `null`     | deletes it iff it is still at that revision |
 *
 * So every transition a whole register can make — absent or present, to absent or present — is compared inside the
 * batch's transaction.
 */
interface WorkstreamBatchMeta {
  readonly document: WorkstreamRegisterMeta | null;
  readonly expectedRevision: number | null;
}

/**
 * Several workstreams and the register document, written in one transaction or not at all.
 *
 * `wholeRegister`, when given, is every workstream id the writer read and the revision it read it at: the write
 * refuses unless the store holds exactly that set at exactly those revisions. A whole-register batch must also state
 * `meta`, so the register document is compared with the rows and the compare covers the WHOLE register.
 */
export interface WorkstreamBatchRequest {
  readonly writes: readonly WorkstreamBatchWrite[];
  readonly deletes: readonly WorkstreamBatchDelete[];
  readonly meta?: WorkstreamBatchMeta;
  readonly wholeRegister?: Readonly<Record<string, number>>;
}

/**
 * Every value outside the closed set its column's enum type holds. The type system keeps a typed caller inside these,
 * but a value decoded from anywhere else is unchecked, and Postgres refusing one surfaces as an outage rather than as
 * an invalid write — and the in-memory store holds no enum to refuse it at all.
 *
 * @returns one problem per value outside its set, in field order
 */
function enumProblems({ aggregate }: { aggregate: WorkstreamAggregate }): readonly string[] {
  const { entries, id, kind, links, status, workspace } = aggregate;
  const checks: readonly { readonly allowed: readonly string[]; readonly field: string; readonly value: string }[] = [
    { allowed: WORKSTREAM_KINDS, field: "kind", value: kind },
    { allowed: WORKSTREAM_WORKSPACES, field: "workspace", value: workspace },
    ...(status === null ? [] : [{ allowed: WORKSTREAM_STATUSES, field: "status", value: status }]),
    ...entries.map((entry) => ({
      allowed: WORKSTREAM_ENTRY_KINDS,
      field: `entry ${entry.id} kind`,
      value: entry.kind,
    })),
    ...links.map((link) => ({ allowed: WORKSTREAM_LINK_KINDS, field: `link ${link.id} kind`, value: link.kind })),
  ];
  return checks
    .filter((check) => !check.allowed.includes(check.value))
    .map((check) => `${id} ${check.field} ${JSON.stringify(check.value)} is not one of ${check.allowed.join(", ")}`);
}

/**
 * Every indexed text longer than the store's longest key (`./storable.ts`), which Postgres refuses on insert as an
 * outage and the in-memory store would keep. Each is named by where it sits, never quoted.
 *
 * @returns one problem per text past the bound, in field order
 */
function keyProblems({ aggregate }: { aggregate: WorkstreamAggregate }): readonly string[] {
  const { id, links, milestones } = aggregate;
  const keys: readonly { readonly field: string; readonly value: string }[] = [
    { field: "the workstream id", value: id },
    ...milestones.flatMap((one) => [
      { field: `the milestone id at position ${String(one.position)}`, value: one.id },
      ...one.after.map((after, index) => ({
        field: `after id ${String(index)} of the milestone at position ${String(one.position)}`,
        value: after,
      })),
    ]),
    ...links.map((link) => ({ field: `the target of link ${link.id}`, value: link.target })),
  ];
  return keys
    .filter((key) => key.value.length > STORE_KEY_MAX_CHARACTERS)
    .map(
      (key) =>
        `${key.field} is ${String(key.value.length)} characters, past the store's longest key of ${String(STORE_KEY_MAX_CHARACTERS)}`,
    );
}

/**
 * Judge one proposed aggregate: decode its detail, apply every rule of the register, and put it in canonical order
 * (`./canonical.ts`), the order a read returns, so a write reads back exactly.
 *
 * @returns the decoded aggregate in canonical order, or every problem
 */
export function judgeProposedAggregate({ aggregate }: { aggregate: WorkstreamAggregate }): Result<WorkstreamAggregate> {
  // First, and alone: every rule below reads the declared types, so a mistyped field is judged by nothing else.
  const shape = aggregateShapeProblems({ value: aggregate });
  if (shape.length > 0) {
    return err(shape);
  }
  // Then, alone too: the decoders below branch on the enums, and an unknown one is no variant they can judge; the
  // rules below would quote an over-long key in every message they write.
  const outside = [...enumProblems({ aggregate }), ...keyProblems({ aggregate })];
  if (outside.length > 0) {
    return err(outside);
  }
  const targets = aggregate.links.filter((link) => link.kind === "workstream").map((link) => link.target);
  const detail = decodeWorkstreamDetail({ kind: aggregate.kind, owner: aggregate.id, value: aggregate.detail });
  const problems = [
    ...aggregateProblems({ aggregate, knownWorkstreamIds: new Set([aggregate.id, ...targets]) }),
    ...(detail.isErr() ? detail.error : []),
  ];
  if (problems.length > 0 || detail.isErr()) {
    return err(problems);
  }
  return ok(canonicalAggregate({ aggregate: { ...aggregate, detail: detail.value } }));
}

/**
 * Judge a proposed write of one aggregate, its revision included.
 *
 * @returns the aggregate to write, or every problem
 */
export function judgeAggregateWrite({
  aggregate,
  expectedRevision,
}: WorkstreamBatchWrite): Result<WorkstreamAggregate> {
  const judged = judgeProposedAggregate({ aggregate });
  if (judged.isErr()) {
    return judged;
  }
  const revision = writeRevisionProblem({ expectedRevision, what: aggregate.id });
  if (revision !== undefined) {
    return err([revision]);
  }
  return judged;
}

/**
 * The problems with one delete: its id must be one a stored row could carry — a workstream id no longer than the
 * store's longest key, which also keeps U+0000 out of the statement that binds it — and so must its revision. An id
 * no row could carry would otherwise reach PostgreSQL and come back as an outage. Such an id
 * is never quoted.
 *
 * @returns every problem, empty when a stored row could match it
 */
function deleteProblems({ expectedRevision, workstreamId }: WorkstreamBatchDelete): readonly string[] {
  if (workstreamId.length > STORE_KEY_MAX_CHARACTERS) {
    return [
      `a delete names a workstream id of ${String(workstreamId.length)} characters, past the store's longest key of ${String(STORE_KEY_MAX_CHARACTERS)}`,
    ];
  }
  if (!KEBAB_ID.test(workstreamId)) {
    return [`a delete names ${JSON.stringify(workstreamId)}, which is not a workstream id`];
  }
  const problem = revisionProblem({ revision: expectedRevision, what: `the delete of ${workstreamId}` });
  return problem === undefined ? [] : [problem];
}

/**
 * Judge a proposed delete of one workstream: its id and its revision must be ones a stored row could carry, so the
 * store and the in-memory one refuse the same deletes before either is asked.
 *
 * @returns the delete, or every problem with it
 */
export function judgeRemove({ expectedRevision, workstreamId }: WorkstreamBatchDelete): Result<WorkstreamBatchDelete> {
  const problems = deleteProblems({ expectedRevision, workstreamId });
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({ expectedRevision, workstreamId });
}

/**
 * Judge a proposed write of the register document, its revision included.
 *
 * @returns the decoded document, or every problem
 */
export function judgeMetaWrite({
  document,
  expectedRevision,
}: {
  document: WorkstreamRegisterMeta;
  expectedRevision: number | null;
}): Result<WorkstreamRegisterMeta> {
  const decoded = decodeWorkstreamMeta({ value: document });
  if (decoded.isErr()) {
    return decoded;
  }
  const revision = writeRevisionProblem({ expectedRevision, what: "the register document" });
  const problems = [
    ...unstorableStrings({ path: "the register document", value: decoded.value }).map(
      (path) => `${path} carries U+0000 or a lone surrogate`,
    ),
    ...(revision === undefined ? [] : [revision]),
  ];
  if (problems.length > 0) {
    return err(problems);
  }
  return decoded;
}

/**
 * The problems with a stated revision a delete or a whole-register baseline names: a real revision starts at 1 and
 * fits the store's `integer` column.
 *
 * @param what the subject, to open the line
 * @returns the problem, or `undefined` when the revision could be stored
 */
function revisionProblem({ revision, what }: { revision: number; what: string }): string | undefined {
  if (!Number.isInteger(revision) || revision < 1 || revision > STORE_INTEGER_MAX) {
    return `${what} names revision ${String(revision)}, which no stored workstream carries`;
  }
  return undefined;
}

/**
 * The problems with a whole-register baseline: every key a workstream id, every value a revision a row could carry.
 *
 * @returns one problem per bad key or revision
 */
function baselineProblems({ baseline }: { baseline: Readonly<Record<string, number>> }): readonly string[] {
  return Object.entries(baseline).flatMap(([id, revision]) => {
    const problems: string[] = [];
    if (!KEBAB_ID.test(id)) {
      problems.push(`the whole-register baseline names ${id}, which is not a workstream id`);
    }
    const problem = revisionProblem({ revision, what: `the whole-register baseline's ${id}` });
    if (problem !== undefined) {
      problems.push(problem);
    }
    return problems;
  });
}

/**
 * The ids a batch names more than once, across its writes and its deletes together.
 *
 * @returns each repeated id once, sorted
 */
function repeatedIds({ request }: { request: WorkstreamBatchRequest }): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of [
    ...request.writes.map((one) => one.aggregate.id),
    ...request.deletes.map((one) => one.workstreamId),
  ]) {
    if (seen.has(id)) {
      repeated.add(id);
    }
    seen.add(id);
  }
  return [...repeated].toSorted();
}

/**
 * What a batch's shape alone refuses: nothing to do (asserting the document absent changes nothing), and a
 * whole-register compare that leaves the register document out.
 *
 * @returns each problem, empty when the shape holds
 */
function batchShapeProblems({ request }: { request: WorkstreamBatchRequest }): readonly string[] {
  const problems: string[] = [];
  const metaChanges =
    request.meta !== undefined && (request.meta.document !== null || request.meta.expectedRevision !== null);
  if (request.writes.length === 0 && request.deletes.length === 0 && !metaChanges) {
    problems.push("the batch writes, deletes and changes nothing");
  }
  if (request.wholeRegister !== undefined && request.meta === undefined) {
    problems.push(
      "a whole-register batch states the register document it expects — its revision, or null for none — so the compare covers it too",
    );
  }
  return problems;
}

/**
 * Every write of a batch judged as {@link judgeAggregateWrite} would, each refusal appended to `problems`.
 *
 * @param problems the batch's problems so far, which this appends to
 * @returns each write whose aggregate was accepted, decoded and canonical
 */
function judgedWrites({
  problems,
  request,
}: {
  problems: string[];
  request: WorkstreamBatchRequest;
}): readonly WorkstreamBatchWrite[] {
  const writes: WorkstreamBatchWrite[] = [];
  for (const write of request.writes) {
    const judged = judgeAggregateWrite(write);
    if (judged.isErr()) {
      problems.push(...judged.error);
    } else {
      writes.push({ aggregate: judged.value, expectedRevision: write.expectedRevision });
    }
  }
  return writes;
}

/**
 * A batch's register document judged as {@link judgeMetaWrite} would — or, settling it to none, its revision judged
 * as a delete's — a refusal appended to `problems`.
 *
 * @param problems the batch's problems so far, which this appends to
 * @returns the settlement with any document decoded and canonical, or nothing when it was refused
 */
function judgedMeta({
  meta,
  problems,
}: {
  meta: WorkstreamBatchMeta;
  problems: string[];
}): WorkstreamBatchMeta | undefined {
  if (meta.document === null) {
    const revision =
      meta.expectedRevision === null
        ? undefined
        : revisionProblem({ revision: meta.expectedRevision, what: "the register document's delete" });
    if (revision !== undefined) {
      problems.push(revision);
      return undefined;
    }
    return { document: null, expectedRevision: meta.expectedRevision };
  }
  const judged = judgeMetaWrite({ document: meta.document, expectedRevision: meta.expectedRevision });
  if (judged.isErr()) {
    problems.push(...judged.error);
    return undefined;
  }
  return { document: judged.value, expectedRevision: meta.expectedRevision };
}

/**
 * Judge a whole batch before the store is touched: every write and the document as {@link judgeAggregateWrite} and
 * {@link judgeMetaWrite} would, each id named once across writes and deletes, every delete and baseline revision one a
 * row could carry, the register document stated whenever the whole register is, and something to do — asserting the
 * document absent changes nothing.
 *
 * @returns the batch with each write's aggregate and the document decoded and canonical, or every problem
 */
export function judgeBatch({ request }: { request: WorkstreamBatchRequest }): Result<WorkstreamBatchRequest> {
  const problems: string[] = [...batchShapeProblems({ request })];
  problems.push(...repeatedIds({ request }).map((id) => `the batch names ${id} more than once`));
  const writes = judgedWrites({ problems, request });
  for (const one of request.deletes) {
    problems.push(...deleteProblems(one));
  }
  if (request.wholeRegister !== undefined) {
    problems.push(...baselineProblems({ baseline: request.wholeRegister }));
  }
  const meta = request.meta === undefined ? undefined : judgedMeta({ meta: request.meta, problems });
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    deletes: request.deletes.toSorted((a, b) => byCodeUnit({ a: a.workstreamId, b: b.workstreamId })),
    writes: writes.toSorted((a, b) => byCodeUnit({ a: a.aggregate.id, b: b.aggregate.id })),
    ...(meta === undefined ? {} : { meta }),
    ...(request.wholeRegister === undefined ? {} : { wholeRegister: request.wholeRegister }),
  });
}
