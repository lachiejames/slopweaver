/**
 * The ONE in-place revision the store-backed autonomy ledger allows: writing an act's bare GitHub references as
 * `owner/repo#N`, with the original prose quoted in the act's own witness.
 *
 * ## Why an append-only ledger takes an edit at all
 *
 * The internal finding door can write an act whose `why` carries a bare `#<number>`, and `briefing check`
 * refuses every chair page on it. Appending cannot repair that — the act still renders — and re-recording
 * under its id is an `ACTION_ID_CONFLICT`, because `why` is an identity field (`./query.ts`). `autonomy adopt`
 * repairs only the pre-import register FILE. So a stored act would have no path back onto the page.
 *
 * ## What it may change, and how it stays honest
 *
 * The same discipline `./adopt.ts` holds a field substitution to, and narrower:
 *
 * - **Only bare GitHub references in `why` and `said`**, qualified against a repository the CALLER names, by
 *   `../briefing/qualifyActRefs.ts` — the outbound resolver's own rules. No other byte of any field moves.
 * - **The original is on the owner's page**: each changed field is JSON-quoted in a clause appended to the witness, so
 *   the revision is visible where the act is read rather than only in a backup. A witness that would then pass
 *   `AUTONOMY_WITNESS_MAX` refuses the repair rather than truncating the evidence.
 * - **It refuses rather than writing a no-op or a half-fix**: an act with nothing to qualify is
 *   `NOTHING_TO_QUALIFY`, and an act that would still render a reference as text is `BARE_REFERENCE`.
 * - **A compare-and-swap, never an update by id**: the write lands only if the stored record still equals the
 *   one read, so a concurrent change is `AUTONOMY_REVISION_LOST` instead of being overwritten.
 * - A steer is never reached: only an `action` row is read, and the owner's word is not this verb's to rewrite.
 */
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { qualifyActProse, qualifyGithubRefs } from "../briefing/qualifyActRefs.js";
import type { RepoRef } from "../outbound/linkify/bareRefs.js";
import { validateAutonomyRecord } from "./decode.js";
import { type AutonomyError, AutonomyErrors } from "./errors.js";
import { isSteerRecord } from "./row.js";
import { type AutonomyStoreError, AutonomyStoreErrors } from "./storeErrors.js";
import { type AutonomyRevisableSeams, decodeStored, type StoredAutonomyRow, withReadyRows } from "./storePort.js";

/** What a qualification did, or would do: the act, each field before and after, and the witness it ends with. */
export interface AutonomyQualification {
  readonly actionId: string;
  readonly changed: readonly { readonly field: "why" | "said"; readonly before: string; readonly after: string }[];
  readonly witness: string;
  /** True once the store holds the revision; false on a dry run. */
  readonly applied: boolean;
}

/**
 * The witness clause naming the revision and quoting every original, appended to what the act already carried.
 *
 * Quoted with `JSON.stringify` and terminated, for `./adopt.ts`'s `substitutionClauses` reason: an original is
 * arbitrary prose, and two clauses run together are a trace present but illegible.
 *
 * @param witness the act's witness as stored
 * @param repo the repository the references were qualified against
 * @param nowIso when the revision was made
 * @param changed each field this revision rewrote, with what it held before
 * @returns the witness the revised act carries
 */
export function qualifiedWitness({
  witness,
  repo,
  nowIso,
  changed,
}: {
  witness: string;
  repo: RepoRef;
  nowIso: string;
  changed: readonly { readonly field: "why" | "said"; readonly original: string }[];
}): string {
  const originals = changed.map(({ field, original }) => ` Original ${field}: ${JSON.stringify(original)}.`).join("");
  return (
    `${witness} Bare references qualified against ${repo.owner}/${repo.repo} by \`slopweaver autonomy ` +
    `qualify\` at ${nowIso}.${originals}`
  );
}

/** One prose field as STORED, before and after qualification. */
interface RawRewrite {
  readonly field: "why" | "said";
  readonly before: string;
  readonly after: string;
}

/**
 * The stored record's own `why` and `said` strings qualified byte for byte, never the decoded act's.
 *
 * The decoder rebuilds an act through validators that TRIM its text, so rewriting from the decoded act would
 * also strip whitespace the stored row carries — bytes outside the references this verb may change. The decoded
 * act decides WHETHER the repair is allowed (`qualifyActProse`); this decides what is written.
 *
 * @param stored the record as read
 * @param repo the repository the caller named
 * @returns every field that changed, or undefined when the stored prose is not text
 */
function rawRewrites({
  stored,
  repo,
}: {
  stored: Readonly<Record<string, unknown>>;
  repo: RepoRef;
}): readonly RawRewrite[] | undefined {
  const rewrites: RawRewrite[] = [];
  for (const field of ["why", "said"] as const) {
    const before = stored[field];
    if (before === undefined && field === "said") {
      continue;
    }
    if (typeof before !== "string") {
      return undefined;
    }
    const after = qualifyGithubRefs({ context: { repos: [repo] }, text: before }).text;
    if (after !== before) {
      rewrites.push({ after, before, field });
    }
  }
  return rewrites;
}

/**
 * The revised act's stored record: the record as read, with only the rewritten fields and the witness replaced,
 * validated. The STORED object is patched rather than the decoded act rebuilt, so a field the decoder does not
 * declare is carried through exactly as `./adopt.ts` carries one.
 */
function revisedRecord({
  stored,
  rewrites,
  witness,
}: {
  stored: Readonly<Record<string, unknown>>;
  rewrites: readonly RawRewrite[];
  witness: string;
}): Result<Readonly<Record<string, unknown>>, AutonomyError> {
  const patched: Record<string, unknown> = { ...stored, witness };
  for (const { field, after } of rewrites) {
    patched[field] = after;
  }
  return validateAutonomyRecord({ value: patched }).map(() => patched);
}

/** What one qualification would write: its report, the record it compares against, the revision and its `why`. */
interface PlannedRevision {
  readonly report: Omit<AutonomyQualification, "applied">;
  readonly expected: Readonly<Record<string, unknown>>;
  readonly record: Readonly<Record<string, unknown>>;
  readonly why: string;
}

/**
 * The pure core of a qualification: judge one stored act and plan its revision, writing nothing.
 *
 * The decoded act decides WHETHER the repair is allowed; the stored strings decide what is written.
 */
function planRevision({
  stored,
  actionId,
  repo,
  nowIso,
}: {
  stored: StoredAutonomyRow;
  actionId: string;
  repo: RepoRef;
  nowIso: string;
}): Result<PlannedRevision, AutonomyError | AutonomyStoreError> {
  const unreadable = ({ why }: { why: string }): Result<never, AutonomyStoreError> =>
    err(AutonomyStoreErrors.rowUnreadable({ importKey: stored.importKey, why }));
  const decoded = decodeStored({ stored });
  if (decoded.isErr()) {
    return err(decoded.error);
  }
  const expected = stored.record;
  if (!isRecord(expected)) {
    return unreadable({ why: "the stored record is not an object" });
  }
  if (isSteerRecord(decoded.value)) {
    return unreadable({ why: "an action row decodes as a steer" });
  }
  const qualified = qualifyActProse({ action: decoded.value, context: { repos: [repo] } });
  if (qualified.isErr()) {
    return err(qualified.error);
  }
  const rewrites = rawRewrites({ repo, stored: expected });
  const storedWitness = expected["witness"];
  const storedWhy = expected["why"];
  if (rewrites === undefined || typeof storedWitness !== "string" || typeof storedWhy !== "string") {
    return unreadable({ why: "the stored prose is not text" });
  }
  if (qualified.value.changed.length === 0 || rewrites.length === 0) {
    return err(AutonomyErrors.nothingToQualify({ actionId }));
  }
  const changed = rewrites.map(({ field, before }) => ({ field, original: before }));
  const witness = qualifiedWitness({ changed, nowIso, repo, witness: storedWitness });
  const whyRewrite = rewrites.find(({ field }) => field === "why");
  const why = whyRewrite === undefined ? storedWhy : whyRewrite.after;
  return revisedRecord({ rewrites, stored: expected, witness }).map((record) => ({
    expected,
    record,
    report: { actionId, changed: rewrites, witness },
    why,
  }));
}

/**
 * Qualify one stored act's bare GitHub references against a named repository, and — with `apply` — write the
 * revision in place.
 *
 * @param seams the store's effects, whose connection offers the compare-and-swap
 * @param home the state home whose store holds the ledger
 * @param actionId the act to repair
 * @param repo the repository its bare references belong to, named by the caller
 * @param nowIso when the revision is made, for its witness clause
 * @param apply false for the dry run that reports and writes nothing
 * @returns what was (or would be) changed, or the refusal
 */
export async function qualifyStoredAct({
  seams,
  home,
  actionId,
  repo,
  nowIso,
  apply,
}: {
  seams: AutonomyRevisableSeams;
  home: string;
  actionId: string;
  repo: RepoRef;
  nowIso: string;
  apply: boolean;
}): Promise<Result<AutonomyQualification, AutonomyError | AutonomyStoreError>> {
  return withReadyRows({
    body: async (rows): Promise<Result<AutonomyQualification, AutonomyError | AutonomyStoreError>> => {
      const held = await rows.readAction({ actionId });
      if (held.isErr()) {
        return err(held.error);
      }
      if (held.value === undefined) {
        return err(AutonomyErrors.unknownAction({ actionId }));
      }
      const plan = planRevision({ actionId, nowIso, repo, stored: held.value });
      if (plan.isErr()) {
        return err(plan.error);
      }
      const { report, expected, record, why } = plan.value;
      if (!apply) {
        return ok({ ...report, applied: false });
      }
      const revised = await rows.revise({ actionId, expected, row: { record, why, witness: report.witness } });
      if (revised.isErr()) {
        return err(revised.error);
      }
      if (!revised.value) {
        return err(AutonomyStoreErrors.revisionLost({ actionId }));
      }
      return ok({ ...report, applied: true });
    },
    home,
    seams,
  });
}
