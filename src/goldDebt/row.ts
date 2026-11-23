/**
 * Building one line of the gold-debt ledger — the pure write side, with `./decode.ts` reading a line back and
 * telling the two row shapes apart.
 *
 * No filesystem, no clock, no network: every instant is passed in, exactly like `../autonomy/row.ts`, so
 * every check here is testable without a seam.
 *
 * ## Why every rule runs in the builder rather than at the CLI edge
 *
 * A caller that is not the CLI cannot skip one, and {@link ./decode.js validateGoldDebtRecord} runs the same
 * builders over a decoded line rather than re-stating their invariants. A parser that only type-checked its
 * fields would admit rows the writer could never produce.
 */
import { err, ok, type Result } from "../lib/result.js";

import { type GoldDebtError, GoldDebtErrors } from "./errors.js";
import { parsePullRequestUrl } from "./pull.js";
import {
  GOLD_DEBT_GRADES,
  GOLD_DEBT_RUN_MAX,
  GOLD_DEBT_RUN_PATTERN,
  GOLD_DEBT_SESSION_MAX,
  GOLD_DEBT_SHA_MAX,
  GOLD_DEBT_SHA_MIN,
  GOLD_DEBT_SHA_PATTERN,
  GOLD_DEBT_TEXT_MAX,
  GOLD_DEBT_TITLE_MAX,
  GOLD_DEBT_VERDICTS,
  type GoldDebtGrade,
  type GoldDebtRow,
  type GoldDebtSettlementRow,
  type GoldDebtVerdict,
} from "./types.js";

/**
 * An ISO-8601 instant, in the one spelling `../autonomy/row.ts` fixed and for the same reason: `Date` also
 * parses `2026.09.12 00:00:00 GMT`, and a scan over an open set of spellings cannot be made total.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,30})?(?:Z|[+-]\d{2}:\d{2})$/u;

/** A non-empty trimmed string, or the reason it is not one. */
function requireText({
  field,
  value,
  max,
}: {
  field: string;
  value: string;
  max: number;
}): Result<string, GoldDebtError> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return err(GoldDebtErrors.invalidField({ field, why: "is empty" }));
  }
  if (trimmed.length > max) {
    return err(
      GoldDebtErrors.invalidField({
        field,
        why: `is ${String(trimmed.length)} characters, over the ${String(max)} allowed`,
      }),
    );
  }
  return ok(trimmed);
}

/** An ISO-8601 instant in the one accepted spelling, or the reason it is not one. */
function requireInstant({ field, value }: { field: string; value: string }): Result<string, GoldDebtError> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return err(GoldDebtErrors.invalidField({ field, why: "is empty" }));
  }
  if (!ISO_INSTANT.test(trimmed) || Number.isNaN(new Date(trimmed).getTime())) {
    return err(
      GoldDebtErrors.invalidField({
        field,
        why: `is "${trimmed}", which is not an ISO-8601 instant a clock can parse, as in \`2026-09-18T17:31:52Z\``,
      }),
    );
  }
  return ok(trimmed);
}

// A single-parameter type predicate rather than the repo.s named-object form, because TypeScript error
// TS1230 forbids destructuring in a type-predicate signature — the compiler.s decision, which is why
// `named-object-params` exempts it. The same comment governs {@link isGoldDebtVerdict} below.

/**
 * Whether a string is a grade that leaves gold owed.
 *
 * @param grade the candidate grade
 * @returns true for `silver` and `bronze`, false for everything else including `gold`
 */
export function isGoldDebtGrade(grade: string): grade is GoldDebtGrade {
  return GOLD_DEBT_GRADES.some((known) => known === grade);
}

/**
 * Whether a string is a settlement verdict.
 *
 * @param verdict the candidate verdict
 * @returns true for `gathered` and `moot`
 */
export function isGoldDebtVerdict(verdict: string): verdict is GoldDebtVerdict {
  return GOLD_DEBT_VERDICTS.some((known) => known === verdict);
}

/** Attach `title` and `run` when they carry something, refusing either if present and unusable. */
function withDebtOptionals({
  base,
  title,
  run,
}: {
  base: GoldDebtRow;
  title: string | undefined;
  run: string | undefined;
}): Result<GoldDebtRow, GoldDebtError> {
  let row = base;
  if (title !== undefined) {
    const named = requireText({ field: "title", max: GOLD_DEBT_TITLE_MAX, value: title });
    if (named.isErr()) {
      return err(named.error);
    }
    row = { ...row, title: named.value };
  }
  if (run === undefined) {
    return ok(row);
  }
  const slug = requireText({ field: "run", max: GOLD_DEBT_RUN_MAX, value: run });
  if (slug.isErr()) {
    return err(slug.error);
  }
  if (!GOLD_DEBT_RUN_PATTERN.test(slug.value)) {
    return err(
      GoldDebtErrors.invalidField({
        field: "run",
        why: `is "${slug.value}" — a board row slug is letters and digits separated by single hyphens or dots`,
      }),
    );
  }
  return ok({ ...row, run: slug.value });
}

/**
 * Build a validated gold-debt row.
 *
 * @param pullRequest the merged pull request's absolute URL — the row's identity
 * @param grade what it merged at
 * @param mergedIso the instant the pull request landed, which is what orders the open list
 * @param wouldBe what gold proof would be, quoted from the pull request's own statement
 * @param blockedOn the condition that has to pass before that proof is gatherable
 * @param recordedIso when this row is being written
 * @param bySession which session is writing it
 * @returns the validated row, or the first rule that refused it
 */
export function buildGoldDebt({
  pullRequest,
  grade,
  mergedIso,
  wouldBe,
  blockedOn,
  recordedIso,
  bySession,
  title,
  run,
}: {
  pullRequest: string;
  grade: string;
  mergedIso: string;
  wouldBe: string;
  blockedOn: string;
  recordedIso: string;
  bySession: string;
  title: string | undefined;
  run: string | undefined;
}): Result<GoldDebtRow, GoldDebtError> {
  const url = pullRequest.trim();
  if (parsePullRequestUrl({ url }) === undefined) {
    return err(GoldDebtErrors.unresolvablePullRequest({ pullRequest: url }));
  }
  if (!isGoldDebtGrade(grade)) {
    return err(GoldDebtErrors.invalidGrade({ grade }));
  }
  const core = debtCore({ blockedOn, bySession, grade, mergedIso, recordedIso, url, wouldBe });
  if (core.isErr()) {
    return err(core.error);
  }
  return withDebtOptionals({ base: core.value, run, title });
}

/**
 * Every REQUIRED field of a debt, validated together and returned as the row's core.
 *
 * Split out of {@link buildGoldDebt} so each half stays readable: the caller owns the two checks that decide
 * whether there is a debt at all — a pull request nobody can open, a grade that owes nothing — and this owns
 * the five that shape the row once there is.
 */
function debtCore({
  url,
  grade,
  mergedIso,
  recordedIso,
  wouldBe,
  blockedOn,
  bySession,
}: {
  url: string;
  grade: GoldDebtGrade;
  mergedIso: string;
  recordedIso: string;
  wouldBe: string;
  blockedOn: string;
  bySession: string;
}): Result<GoldDebtRow, GoldDebtError> {
  const merged = requireInstant({ field: "mergedIso", value: mergedIso });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const recorded = requireInstant({ field: "recordedIso", value: recordedIso });
  if (recorded.isErr()) {
    return err(recorded.error);
  }
  const gold = requireText({ field: "wouldBe", max: GOLD_DEBT_TEXT_MAX, value: wouldBe });
  if (gold.isErr()) {
    return err(gold.error);
  }
  const blocker = requireText({ field: "blockedOn", max: GOLD_DEBT_TEXT_MAX, value: blockedOn });
  if (blocker.isErr()) {
    return err(blocker.error);
  }
  const session = requireText({ field: "bySession", max: GOLD_DEBT_SESSION_MAX, value: bySession });
  if (session.isErr()) {
    return err(session.error);
  }
  return ok({
    blockedOn: blocker.value,
    bySession: session.value,
    grade,
    mergedIso: merged.value,
    pullRequest: url,
    recordedIso: recorded.value,
    wouldBe: gold.value,
  });
}

/** Attach `proofCommit` when it carries something, refusing one that is not a git object name. */
function withProofCommit({
  base,
  proofCommit,
}: {
  base: GoldDebtSettlementRow;
  proofCommit: string | undefined;
}): Result<GoldDebtSettlementRow, GoldDebtError> {
  if (proofCommit === undefined) {
    return ok(base);
  }
  const sha = proofCommit.trim().toLowerCase();
  const shaped = sha.length >= GOLD_DEBT_SHA_MIN && sha.length <= GOLD_DEBT_SHA_MAX && GOLD_DEBT_SHA_PATTERN.test(sha);
  if (!shaped) {
    return err(
      GoldDebtErrors.invalidField({
        field: "proofCommit",
        why:
          `is "${proofCommit.trim()}" — a commit the evidence was gathered against is hex, ` +
          `${String(GOLD_DEBT_SHA_MIN)}-${String(GOLD_DEBT_SHA_MAX)} characters`,
      }),
    );
  }
  return ok({ ...base, proofCommit: sha });
}

/**
 * Build a validated settlement row.
 *
 * The `regrade` rule is the one that is not merely a shape check: a `gathered` settlement must say what the
 * merged pull request now reads and what was run to make it read that way, because the owner's word is that
 * the re-grade is OPEN. A `moot` settlement has nothing to re-grade and must not carry one, so a session
 * cannot satisfy the rule with a sentence meaning "n/a".
 *
 * @param pullRequest the debt's pull-request URL
 * @param settledIso the instant the evidence was gathered or written off
 * @param verdict whether the evidence was gathered or the debt can never be paid
 * @param evidence what was gathered and where, or why it can never be
 * @param bySession which session is recording it
 * @param regrade what the merged pull request now says, and what was run — required on `gathered`
 * @returns the validated row, or the first rule that refused it
 */
export function buildGoldDebtSettlement({
  pullRequest,
  settledIso,
  verdict,
  evidence,
  bySession,
  regrade,
  proofCommit,
}: {
  pullRequest: string;
  settledIso: string;
  verdict: string;
  evidence: string;
  bySession: string;
  regrade: string | undefined;
  proofCommit: string | undefined;
}): Result<GoldDebtSettlementRow, GoldDebtError> {
  const url = pullRequest.trim();
  if (parsePullRequestUrl({ url }) === undefined) {
    return err(GoldDebtErrors.unresolvablePullRequest({ pullRequest: url }));
  }
  if (!isGoldDebtVerdict(verdict)) {
    return err(
      GoldDebtErrors.invalidField({
        field: "verdict",
        why: `is "${verdict}" — a settlement is \`gathered\` (the proof exists now) or \`moot\` (it never can)`,
      }),
    );
  }
  const when = requireInstant({ field: "settledIso", value: settledIso });
  if (when.isErr()) {
    return err(when.error);
  }
  const shown = requireText({ field: "evidence", max: GOLD_DEBT_TEXT_MAX, value: evidence });
  if (shown.isErr()) {
    return err(shown.error);
  }
  const session = requireText({ field: "bySession", max: GOLD_DEBT_SESSION_MAX, value: bySession });
  if (session.isErr()) {
    return err(session.error);
  }
  const base: GoldDebtSettlementRow = {
    bySession: session.value,
    evidence: shown.value,
    pullRequest: url,
    settledIso: when.value,
    verdict,
  };
  const regraded = withRegrade({ base, regrade, verdict });
  if (regraded.isErr()) {
    return err(regraded.error);
  }
  return withProofCommit({ base: regraded.value, proofCommit });
}

/** Apply the `regrade` rule: required on a `gathered` settlement, refused on a `moot` one. */
function withRegrade({
  base,
  regrade,
  verdict,
}: {
  base: GoldDebtSettlementRow;
  regrade: string | undefined;
  verdict: GoldDebtVerdict;
}): Result<GoldDebtSettlementRow, GoldDebtError> {
  const written = regrade === undefined ? "" : regrade.trim();
  if (verdict === "moot") {
    if (written.length > 0) {
      return err(
        GoldDebtErrors.invalidField({
          field: "regrade",
          why:
            "sits on a `moot` settlement, which pays nothing — there is no proof to re-grade the pull " +
            "request to, so say what happened in `evidence` instead",
        }),
      );
    }
    return ok(base);
  }
  if (written.length === 0) {
    return err(
      GoldDebtErrors.invalidField({
        field: "regrade",
        why:
          "is empty on a `gathered` settlement — the owner's word is that the merged pull request is " +
          "re-graded post-hoc OPENLY, so say what it now reads and what you ran to make it read that way",
      }),
    );
  }
  const text = requireText({ field: "regrade", max: GOLD_DEBT_TEXT_MAX, value: written });
  if (text.isErr()) {
    return err(text.error);
  }
  return ok({ ...base, regrade: text.value });
}
