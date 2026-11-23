/**
 * Decoding one line of the gold-debt ledger back into a record — the pure read side beside `./row.ts`'s builders.
 *
 * ## How the two row shapes are told apart, and why it is not "has a verdict"
 *
 * The register carries debts and their settlements in ONE file, in the order they happened, because that
 * order is what a ledger is for — a debt, then how it ended. A second file would parse more simply and lose
 * the property: a copy of `gold-debt.jsonl` alone would carry no outcomes.
 *
 * They are told apart by the presence of `settledIso`, and then VALIDATED COMPLETELY as whichever arm was
 * picked. A settlement is REFUSED if it carries any debt-only field, and each arm requires every one of its
 * own — so the two shapes are disjoint and a hybrid line fails as corrupt rather than decoding as the wrong
 * kind. `verdict` alone would be the wrong discriminator for the same reason `steer` is in the autonomy
 * register: a field that reads like an outcome is not the field that IS one.
 */

import { duplicateTopLevelKey } from "../autonomy/duplicateKey.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { type GoldDebtError, GoldDebtErrors } from "./errors.js";
import { buildGoldDebt, buildGoldDebtSettlement } from "./row.js";
import type { GoldDebtRecord, GoldDebtSettlementRow } from "./types.js";

/** The fields only a debt row may carry. A settlement naming one of these is a hybrid, and is refused. */
const DEBT_ONLY_FIELDS: readonly string[] = ["grade", "mergedIso", "wouldBe", "blockedOn", "recordedIso", "title"];

/** The fields every debt row must carry as strings. */
const DEBT_REQUIRED_FIELDS: readonly string[] = [
  "pullRequest",
  "grade",
  "mergedIso",
  "wouldBe",
  "blockedOn",
  "recordedIso",
  "bySession",
];

// A single-parameter type predicate rather than the repo's named-object form, because TypeScript error
// TS1230 forbids destructuring in a type-predicate signature — the compiler's decision, which is why
// `named-object-params` exempts it.

/**
 * Whether a decoded record settles a debt rather than declaring one.
 *
 * Reads `settledIso`, which only the settlement arm carries and which the debt arm refuses.
 *
 * @param record either record the register may carry
 * @returns true when it is a settlement
 */
export function isSettlementRecord(record: GoldDebtRecord): record is GoldDebtSettlementRow {
  // `Object.hasOwn`, never `in`: `in` walks the prototype chain, so a polluted `Object.prototype.settledIso`
  // would make every open debt in the register read as paid — the exact opposite of what it is for.
  return Object.hasOwn(record, "settledIso");
}

/**
 * One field of a decoded record, read ONLY if the record owns it.
 *
 * Every read below goes through this rather than indexing directly, for `../autonomy/row.ts`'s measured
 * reason: a polluted `Object.prototype.regrade` would make every settlement ever read claim the pull request
 * was re-graded when none of them was.
 */
function ownField({ decoded, field }: { decoded: Readonly<Record<string, unknown>>; field: string }): unknown {
  return Object.hasOwn(decoded, field) ? decoded[field] : undefined;
}

/** The value of an own field when it is a string, otherwise undefined. */
function ownText({
  decoded,
  field,
}: {
  decoded: Readonly<Record<string, unknown>>;
  field: string;
}): string | undefined {
  const value = ownField({ decoded, field });
  return typeof value === "string" ? value : undefined;
}

/** Decode the debt arm completely, or say what it was missing. */
function parseDebt({ decoded }: { decoded: Readonly<Record<string, unknown>> }): Result<GoldDebtRecord, GoldDebtError> {
  const missing = DEBT_REQUIRED_FIELDS.find((field) => ownText({ decoded, field }) === undefined);
  if (missing !== undefined) {
    return err(
      GoldDebtErrors.invalidField({
        field: missing,
        why:
          `is not a string — a debt must carry ${DEBT_REQUIRED_FIELDS.join(", ")} as strings ` +
          "(a settlement carries settledIso instead)",
      }),
    );
  }
  const title = ownField({ decoded, field: "title" });
  const run = ownField({ decoded, field: "run" });
  const optionalsBad =
    (title !== undefined && typeof title !== "string") || (run !== undefined && typeof run !== "string");
  if (optionalsBad) {
    return err(GoldDebtErrors.invalidField({ field: "title/run", why: "must be strings when a debt carries them" }));
  }
  return buildGoldDebt({
    blockedOn: String(ownField({ decoded, field: "blockedOn" })),
    bySession: String(ownField({ decoded, field: "bySession" })),
    grade: String(ownField({ decoded, field: "grade" })),
    mergedIso: String(ownField({ decoded, field: "mergedIso" })),
    pullRequest: String(ownField({ decoded, field: "pullRequest" })),
    recordedIso: String(ownField({ decoded, field: "recordedIso" })),
    run: ownText({ decoded, field: "run" }),
    title: ownText({ decoded, field: "title" }),
    wouldBe: String(ownField({ decoded, field: "wouldBe" })),
  });
}

/** Decode the settlement arm completely, refusing any field only a debt may carry. */
function parseSettlement({
  decoded,
}: {
  decoded: Readonly<Record<string, unknown>>;
}): Result<GoldDebtRecord, GoldDebtError> {
  const strayed = DEBT_ONLY_FIELDS.filter((field) => ownField({ decoded, field }) !== undefined);
  if (strayed.length > 0) {
    return err(
      GoldDebtErrors.invalidField({
        field: strayed.join(", "),
        why:
          "may not sit beside settledIso — that is a hybrid of the two shapes, so it is not clear whether " +
          "it declares a debt or settles one",
      }),
    );
  }
  const pullRequest = ownText({ decoded, field: "pullRequest" });
  const settledIso = ownText({ decoded, field: "settledIso" });
  const verdict = ownText({ decoded, field: "verdict" });
  const evidence = ownText({ decoded, field: "evidence" });
  const bySession = ownText({ decoded, field: "bySession" });
  const shaped =
    pullRequest !== undefined &&
    settledIso !== undefined &&
    verdict !== undefined &&
    evidence !== undefined &&
    bySession !== undefined;
  if (!shaped) {
    return err(
      GoldDebtErrors.invalidField({
        field: "settlement",
        why: "must carry pullRequest, settledIso, verdict, evidence and bySession as strings",
      }),
    );
  }
  const regrade = ownField({ decoded, field: "regrade" });
  const proofCommit = ownField({ decoded, field: "proofCommit" });
  const optionalsBad =
    (regrade !== undefined && typeof regrade !== "string") ||
    (proofCommit !== undefined && typeof proofCommit !== "string");
  if (optionalsBad) {
    return err(
      GoldDebtErrors.invalidField({
        field: "regrade/proofCommit",
        why: "must be strings when a settlement carries them",
      }),
    );
  }
  return buildGoldDebtSettlement({
    bySession,
    evidence,
    proofCommit: ownText({ decoded, field: "proofCommit" }),
    pullRequest,
    regrade: ownText({ decoded, field: "regrade" }),
    settledIso,
    verdict,
  });
}

/**
 * Validate one value as a record, re-running every builder rule over it.
 *
 * Line-free on purpose, so `./store.ts`'s append gets an error about the FIELD rather than about a line
 * number it does not have. That append is the caller that matters: `GoldDebtRecord` is a TYPE, and a type
 * cannot say that `wouldBe` is non-empty or that `pullRequest` is a URL a reader can open, so an in-repo
 * caller building a record literal could otherwise put a line into the file that the next read refuses as
 * corrupt — taking the whole register down with it.
 *
 * @param value the value to validate
 * @returns the record, or the first rule that refused it
 */
export function validateGoldDebtRecord({ value }: { value: unknown }): Result<GoldDebtRecord, GoldDebtError> {
  if (!isRecord(value)) {
    return err(GoldDebtErrors.invalidField({ field: "record", why: "is not an object" }));
  }
  if (ownField({ decoded: value, field: "settledIso" }) !== undefined) {
    return parseSettlement({ decoded: value });
  }
  return parseDebt({ decoded: value });
}

/**
 * Decode one stored line back into whichever record it is.
 *
 * Re-validated rather than trusted, because the register is a plain append-only file a human is expected to
 * be able to read and, one day, will be tempted to edit.
 *
 * @param line one line of the register
 * @param lineNumber the 1-based line number, carried into a corruption error so the file can be inspected
 * @returns the record, or a corruption error naming the line
 */
export function parseGoldDebtLine({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): Result<GoldDebtRecord, GoldDebtError> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return err(GoldDebtErrors.corruptRow({ lineNumber, why: "the line is not valid JSON" }));
  }
  const duplicate = duplicateTopLevelKey({ text: line });
  if (duplicate !== undefined) {
    return err(
      GoldDebtErrors.corruptRow({
        lineNumber,
        why: `the field \`${duplicate}\` is written twice, and only the second spelling would survive the decode`,
      }),
    );
  }
  const validated = validateGoldDebtRecord({ value: decoded });
  if (validated.isErr()) {
    return err(GoldDebtErrors.corruptRow({ lineNumber, why: validated.error.message }));
  }
  return ok(validated.value);
}
