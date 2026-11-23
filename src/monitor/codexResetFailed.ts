/**
 * `codex-reset-failed` — the fleet's own claim of a Codex usage-limit reset did not leave the plan able to take
 * work. The one floating note the reset claim ever raises.
 *
 * The fleet takes a plan up to the 99 percent bar and then does the reset itself, so the reset is abstracted away
 * from the owner — so a claim that refilled its plan says nothing, and the handover that built the
 * claim adds the one exception: a note only when the claim itself fails. `codex reset --at-limit` runs in the
 * chair's tick and this monitor is fired straight after it (`../supervisor/scratch/fleetReadings.ts`).
 *
 * **What counts as failed** is `../codex/resetResult.ts`'s `settledFailure`, the same judgement the verb's own exit
 * uses, read back off the journal: the provider answered `noCredit` or `nothingToReset`, or answered `reset` /
 * `alreadyRedeemed` while the store's re-read could not be taken or still reads at its limit. Only a MEASURED
 * attempt is judged — one whose intent journalled the store before the call — so a row written before claims
 * carried readings never raises a note it cannot explain. An attempt still open has no answer yet; the next run
 * settles it under the same key, so it is never a failure on its own.
 *
 * **It goes when it stops being true**: the plan's next measured claim refills it, or the window the failed claim
 * was spent on has reset by itself, which ends the cap the claim was for — but never sooner than a day after the
 * failed answer, so a claim that failed moments before its window's own reset still raises its note.
 *
 * Pure: the journal arrives already read.
 */
import { createHash } from "node:crypto";

import type { CodexResetIntentRow, CodexResetJournalRow } from "../codex/resetConsume.js";
import type { CodexResetReading } from "../codex/resetEvidence.js";
import { settledFailure } from "../codex/resetResult.js";
import { CODEX_PAUSE_WINDOWS, MAX_BELIEVABLE_PERCENT } from "../codex/routingCapacity.js";

import type { MonitorReading, MonitorSubject } from "./types.js";

/** How many hex characters of the failed attempts' digest the note's step key carries — enough to tell two sets apart. */
const KEY_CHARS = 12;

/** How long a failed claim's note stands at least, whenever the cap it was spent on ends. */
const FAILED_NOTE_MIN_MS = 24 * 60 * 60 * 1000;

/** One plan's failed claim: the plan, the attempt's key, and why it failed. */
interface FailedClaim {
  readonly alias: string;
  readonly idempotencyKey: string;
  readonly why: string;
}

/**
 * The instant the cap a claim was spent on ends by itself: the latest reset among the routing windows the `before`
 * reading found at the pause bar it recorded, or undefined when it names none. Only the windows routing pauses on
 * count — another window at the bar, or one past the believable 100%, is not the cap the claim was for. The bar is the one the claim was judged by, never today's, so a later `plans set-thresholds` cannot
 * strand or clear a note it did not cause.
 *
 * @param before the store as read straight before the claim
 * @returns the instant in epoch milliseconds, or undefined
 */
function capEndsAt({ before }: { before: CodexResetReading }): number | undefined {
  const readAtMs = Date.parse(before.readAtIso);
  const ends = before.windows
    .filter(
      (window) =>
        CODEX_PAUSE_WINDOWS.includes(window.label) &&
        window.usedPercent >= before.pauseAtPercent &&
        window.usedPercent <= MAX_BELIEVABLE_PERCENT,
    )
    .map((window) => window.resetAtIso)
    .filter((iso): iso is string => iso !== undefined)
    // Compared as instants, never as strings: an ISO text with an offset does not sort chronologically.
    .map((iso) => Date.parse(iso))
    // Only a window whose reset was still AHEAD of the read counts, as routing judges it — one already rolled over
    // when the claim was made is not the window it was spent on.
    .filter((ms) => !Number.isNaN(ms) && ms > readAtMs);
  return ends.length === 0 ? undefined : Math.max(...ends);
}

/**
 * The newest ANSWERED measured attempt on each alias, in first-claimed order. An attempt still open, or one closed
 * without sending, has no answer to judge, so neither hides the failure before it.
 *
 * @param rows the whole journal, oldest first
 * @returns one intent per alias that ever journalled a `before` reading and a provider answer for it
 */
function newestMeasuredIntents({ rows }: { rows: readonly CodexResetJournalRow[] }): readonly CodexResetIntentRow[] {
  const answered = new Set(
    rows.filter((row) => row.kind === "outcome").map((row) => `${row.alias}\n${row.idempotencyKey}`),
  );
  const newest = new Map<string, CodexResetIntentRow>();
  for (const row of rows) {
    if (row.kind === "intent" && row.before !== undefined && answered.has(`${row.alias}\n${row.idempotencyKey}`)) {
      newest.set(row.alias, row);
    }
  }
  return [...newest.values()];
}

/**
 * The failed claim an alias's newest attempt is, or undefined when the attempt is open, closed, refilled its plan, or
 * was spent on a cap that has since ended and failed over a day ago.
 *
 * @param intent the alias's newest measured attempt
 * @param nowIso the instant of the pass
 * @param rows the whole journal
 * @returns the failure, or undefined
 */
function failedClaim({
  intent,
  nowIso,
  rows,
}: {
  intent: CodexResetIntentRow;
  nowIso: string;
  rows: readonly CodexResetJournalRow[];
}): FailedClaim | undefined {
  const answer = rows.find(
    (row) => row.kind === "outcome" && row.alias === intent.alias && row.idempotencyKey === intent.idempotencyKey,
  );
  if (answer?.kind !== "outcome") {
    return undefined;
  }
  const endsMs = capEndsAt({ before: intent.before! });
  const nowMs = Date.parse(nowIso);
  const floorMs = Date.parse(answer.atIso) + FAILED_NOTE_MIN_MS;
  if (endsMs !== undefined && endsMs <= nowMs && floorMs <= nowMs) {
    return undefined;
  }
  const why = settledFailure({
    result: {
      after: answer.after,
      alias: intent.alias,
      idempotencyKey: intent.idempotencyKey,
      kind: "settled",
      outcome: answer.outcome,
    },
  });
  if (why === undefined) {
    return undefined;
  }
  return { alias: intent.alias, idempotencyKey: intent.idempotencyKey, why: `claimed at ${answer.atIso}, ${why}` };
}

/**
 * The ONE subject every failed claim shares. One note, not one per plan: a failed claim asks nothing of the owner, so
 * the pass's one-card rule holds (`./pass.ts` § readingShapeRefusal), and the key moves whenever the set of failed
 * attempts does, so a fresh failure is a fresh note.
 *
 * @param failures each plan's failed claim, in first-claimed order
 * @returns the subject
 */
function failedSetSubject({ failures }: { failures: readonly FailedClaim[] }): MonitorSubject {
  const digest = createHash("sha256")
    .update(failures.map((failure) => failure.idempotencyKey).join("\n"))
    .digest("hex");
  return {
    id: failures.map((failure) => failure.alias).join(", "),
    key: `failed-${digest.slice(0, KEY_CHARS)}`,
    label: failures.map((failure) => `${failure.alias}: ${failure.why}`).join("; "),
  };
}

/**
 * Judge the reset claims journal.
 *
 * @param nowIso the instant of the pass, against which a spent cap has ended
 * @param rows the journal as read, or the reason it could not be
 * @returns firing, as one subject, on every plan whose newest measured claim failed, clear when none did, unmeasurable on no journal
 */
export function evaluateCodexResetFailed({
  nowIso,
  rows,
}: {
  nowIso: string;
  rows:
    | { readonly kind: "read"; readonly rows: readonly CodexResetJournalRow[] }
    | { readonly kind: "unreadable"; readonly why: string };
}): MonitorReading {
  if (rows.kind === "unreadable") {
    return {
      because: `the reset claims journal could not be read (${rows.why}), so whether a claim failed is unknown`,
      monitorId: "codex-reset-failed",
      state: "unmeasurable",
    };
  }
  const journal = rows.rows;
  const failures = newestMeasuredIntents({ rows: journal })
    .map((intent) => failedClaim({ intent, nowIso, rows: journal }))
    .filter((failure): failure is FailedClaim => failure !== undefined);
  if (failures.length === 0) {
    return { monitorId: "codex-reset-failed", state: "clear" };
  }
  return { monitorId: "codex-reset-failed", state: "firing", subjects: [failedSetSubject({ failures })] };
}
