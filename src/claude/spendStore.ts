/**
 * Where a Claude plan's spend readings are kept: the readings ledger (`../readings/store.ts`), one document per read,
 * under the producer {@link CLAUDE_SPEND_PRODUCER}. The plan is a field of the document, so every plan shares one
 * producer line and an alias is data rather than a slug.
 *
 * Only a successful strict read is ever recorded (`../cli/commands/claude/spendRun.ts`): a throttle, a drifted field
 * or an absent block records nothing, and the recorder itself refuses — as the reader-back does — a reading that can
 * cover sends yet lacks a figure (`missingSpendFigures`, `./spendStatus.ts`), so a good reading is never overwritten by a zero, and simply ages out
 * (`./spendPolicy.ts`). A recorded document that does not hold the shape this build writes REFUSES rather than being
 * passed over, because a plan whose newest reading was skipped would read as one with an older, smaller spend.
 */
import { z } from "zod";

import { parseIsoMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";

import { readingsErrorMessageWithoutStorePath } from "../readings/errors.js";
import { readingsInWindow, recordReading } from "../readings/store.js";
import type { ReadingReceipt } from "../readings/types.js";
import { type ClaudeSpendError, ClaudeSpendErrors } from "./spendErrors.js";
import { CLAUDE_SPEND_FRESH_MS, type ClaudeSpendReading } from "./spendPolicy.js";
import { missingSpendFigures } from "./spendStatus.js";

/** The readings-ledger producer every spend reading is recorded under. */
export const CLAUDE_SPEND_PRODUCER = "claude spend";

/**
 * The series' upper bound on the OBSERVED instant: none at all — the largest instant a JS `Date` holds (ECMA-262
 * § 21.4.1.1, 8.64e15 ms), so no recorded reading can be dated past it. A four-digit year was not enough: an
 * extended-year instant parses too.
 */
const LAST_REPRESENTABLE_ISO = new Date(8.64e15).toISOString();

/** A minor-unit amount as recorded, or `null` when the provider sent none. */
const recordedAmount = z.number().nonnegative().nullable();

const readingDocument = z.strictObject({
  alias: z.string().min(1),
  currency: z.string().min(1).nullable(),
  decimalPlaces: z.number().int().nonnegative().nullable(),
  isEnabled: z.boolean(),
  monthlyLimitMinor: recordedAmount,
  observedAtIso: z.string().min(1),
  spendLimitReached: z.boolean(),
  usedMinor: recordedAmount,
});

/**
 * One recorded document read back as a spend reading.
 *
 * @param document the parsed document the ledger holds
 * @returns the reading, or why the document is not one this build wrote
 */
export function parseClaudeSpendReading({
  document,
}: {
  document: unknown;
}): Result<ClaudeSpendReading, ClaudeSpendError> {
  const parsed = readingDocument.safeParse(document);
  if (!parsed.success) {
    return err(ClaudeSpendErrors.readingUnreadable({ detail: parsed.error.message }));
  }
  const missing = missingSpendFigures({ value: parsed.data });
  if (missing.length > 0) {
    return err(
      ClaudeSpendErrors.readingUnreadable({ detail: ClaudeSpendErrors.amountAbsent({ fields: missing }).message }),
    );
  }
  return ok(parsed.data);
}

/**
 * Record one plan's spend reading in the readings ledger.
 *
 * @param home the state home
 * @param reading the reading, its alias and observed instant included
 * @param nowIso the append instant
 * @returns the receipt, or why the ledger refused it
 */
export function recordClaudeSpendReading({
  home,
  nowIso,
  reading,
}: {
  home: string;
  reading: ClaudeSpendReading;
  nowIso: string;
}): Result<ReadingReceipt, ClaudeSpendError> {
  const missing = missingSpendFigures({ value: reading });
  if (missing.length > 0) {
    return err(ClaudeSpendErrors.amountAbsent({ fields: missing }));
  }
  const recorded = recordReading({
    by: "slopweaver claude spend",
    document: safeJsonStringify({ label: "a claude spend reading", value: reading }),
    home,
    nowIso,
    observedAtIso: reading.observedAtIso,
    producer: CLAUDE_SPEND_PRODUCER,
  });
  if (recorded.isErr()) {
    return err(
      ClaudeSpendErrors.readingUnreadable({ detail: readingsErrorMessageWithoutStorePath({ error: recorded.error }) }),
    );
  }
  return ok(recorded.value);
}

/**
 * The newest spend reading recorded for one plan inside the freshness bound before `nowIso` — the only readings a
 * verdict can use, so nothing older is opened.
 *
 * @param alias the plan
 * @param home the state home
 * @param nowIso the instant the reading is wanted for
 * @returns the reading, undefined when none was recorded in the last hour, or why the ledger could not be read
 */
export function latestClaudeSpendReading({
  alias,
  home,
  nowIso,
}: {
  alias: string;
  home: string;
  nowIso: string;
}): Result<ClaudeSpendReading | undefined, ClaudeSpendError> {
  const nowMs = parseIsoMs({ tsIso: nowIso });
  if (nowMs === undefined) {
    return err(ClaudeSpendErrors.readingUnreadable({ detail: `now ${JSON.stringify(nowIso)} is not an instant` }));
  }
  const fromIso = new Date(nowMs - CLAUDE_SPEND_FRESH_MS).toISOString();
  // Observed-after-now readings are READ, never windowed out: one is the latest reading on a clock that cannot be
  // trusted, which the verdict holds as NOT MEASURED — dropping it would hand the verdict the older reading before it,
  // which may sit under the limit. What was RECORDED after now stays unread, below, so a
  // replay at a frozen instant still sees nothing from after it.
  const series = readingsInWindow({ fromIso, home, producer: CLAUDE_SPEND_PRODUCER, toIso: LAST_REPRESENTABLE_ISO });
  if (series.isErr()) {
    return err(
      ClaudeSpendErrors.readingUnreadable({ detail: readingsErrorMessageWithoutStorePath({ error: series.error }) }),
    );
  }
  // Ranked on the instant observed, then the instant recorded: the series is oldest-observed first, but two readings
  // observed at the same instant arrive newest-RECORDED first, so taking the last one seen would let an older, lower
  // reading mask the one recorded after it — which the seat gate would then pass under the owner's limit. The store records each row of one producer at a distinct millisecond, so the pair never ties.
  let newest: { reading: ClaudeSpendReading; observedMs: number; recordedMs: number } | undefined;
  for (const { document, record } of series.value) {
    const reading = parseClaudeSpendReading({ document });
    if (reading.isErr()) {
      return err(reading.error);
    }
    const recordedMs = parseIsoMs({ tsIso: record.recordedAtIso })!;
    if (reading.value.alias !== alias || recordedMs > nowMs) {
      continue;
    }
    const observedMs = parseIsoMs({ tsIso: record.observedAtIso })!;
    const isLater =
      newest === undefined ||
      observedMs > newest.observedMs ||
      (observedMs === newest.observedMs && recordedMs > newest.recordedMs);
    if (isLater) {
      newest = { observedMs, reading: reading.value, recordedMs };
    }
  }
  return ok(newest?.reading);
}
