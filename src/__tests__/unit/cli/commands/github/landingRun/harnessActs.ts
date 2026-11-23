/**
 * The act seams of the `runGithubLanding` harness: the CodeRabbit nudge, the child verbs a run hands argv to, and
 * the stores it reads and writes.
 */
import type { GithubLandingDeps } from "../../../../../../cli/commands/github/landingRun.js";
import { err, ok } from "../../../../../../lib/result.js";
import { CodeRabbitNudgeJournalErrors } from "../../../../../../review/codeRabbitNudgeJournal.js";
import type { ReadRecord } from "../../../../../../review/readJournal.js";
import { STORE_OUTAGE } from "./fixtures.js";
import type { HarnessOptions } from "./harness.js";
import type { HarnessRecord } from "./harnessTypes.js";

/**
 * Prints one child's line where the verb routed it: diagnostics when it ran quiet, stdout otherwise. The real children
 * print a readable block of their own; a fake that printed nothing could never catch the stdout contamination the
 * `quiet` seam exists to stop.
 */
function say({ line, quiet, record }: { line: string; quiet: boolean; record: HarnessRecord }): void {
  if (quiet) {
    record.diagnostics.push(line);
  } else {
    record.out.push(line);
  }
}

/**
 * The CodeRabbit nudge seams: the heads already re-requested, the re-request itself, and the reservation before it.
 *
 * @returns the nudge half of the landing verb's dependencies
 */
export function nudgeSeams({
  options,
  record,
}: {
  options: HarnessOptions;
  record: HarnessRecord;
}): Pick<GithubLandingDeps, "nudgedHeads" | "requestCodeRabbitReview" | "reserveNudge"> {
  const {
    commentExit = 0,
    nudgedHeads = new Set<string>(),
    nudgedHeadsUnreadable = false,
    reserveAnswer = "reserved",
  } = options;
  return {
    nudgedHeads: () =>
      nudgedHeadsUnreadable
        ? err(CodeRabbitNudgeJournalErrors.unreadable({ cause: "EACCES", path: "/home/nudges" }))
        : ok(nudgedHeads),
    requestCodeRabbitReview: ({ rest, quiet }) => {
      record.commented.push(rest.join(" "));
      say({ line: `comment create: ${rest.join(" ")}`, quiet, record });
      return Promise.resolve(commentExit);
    },
    reserveNudge: ({ record: nudge }) => {
      record.reserved.push(`${nudge.repoSlug}#${String(nudge.number)}@${nudge.headOid}`);
      return ok(reserveAnswer);
    },
  };
}

/**
 * The child-verb seams: `github enqueue`, `handover register` and `handover settle`, each answering its exit code.
 *
 * @returns the child-verb half of the landing verb's dependencies
 */
export function childSeams({
  options,
  record,
}: {
  options: HarnessOptions;
  record: HarnessRecord;
}): Pick<GithubLandingDeps, "press" | "registerRow" | "settleRow"> {
  const { pressExit = 0, registerExit = 0, settleExit = 0 } = options;
  return {
    press: ({ rest, quiet }) => {
      record.pressed.push(rest.join(" "));
      say({ line: `enqueue: ${rest.join(" ")}`, quiet, record });
      return Promise.resolve(pressExit);
    },
    registerRow: ({ argv }) => {
      record.registered.push([...argv]);
      return Promise.resolve(registerExit);
    },
    settleRow: ({ argv, quiet }) => {
      record.settled.push([...argv]);
      say({ line: `handover settle: ${argv[4]!} is settled answered`, quiet, record });
      return Promise.resolve(settleExit);
    },
  };
}

/**
 * The store seams: the press and cadence registers, the autonomy ledger, the reviewer register and the readings
 * ledger, each read or written as the case seeds it.
 *
 * @returns the store half of the landing verb's dependencies
 */
export function ledgerSeams({
  options,
  record,
}: {
  options: HarnessOptions;
  record: HarnessRecord;
}): Pick<
  GithubLandingDeps,
  | "appendReviewerAsks"
  | "ledgerActs"
  | "presses"
  | "reads"
  | "recordAutonomy"
  | "recordPress"
  | "recordRead"
  | "recordReading"
> {
  const {
    autonomyRefusal,
    ledger = [ok([])],
    presses = new Map<string, { atIso: string; headOid: string }>(),
  } = options;
  const { pressesUnreadable = false, readingRefusal, reads = new Map<string, ReadRecord>() } = options;
  const { readsUnreadable = false, recordPressFails = false, recordReadFails = false } = options;
  let ledgerReads = 0;
  return {
    appendReviewerAsks: ({ nowIso, rows }) => {
      record.askAppends.push({ nowIso, rows });
      return ok(rows.length);
    },
    ledgerActs: () => {
      const answer = ledger[Math.min(ledgerReads, ledger.length - 1)]!;
      ledgerReads += 1;
      return Promise.resolve(answer);
    },
    presses: () => Promise.resolve(pressesUnreadable ? err(STORE_OUTAGE.presses) : ok(presses)),
    reads: () => Promise.resolve(readsUnreadable ? err(STORE_OUTAGE.reads) : ok(reads)),
    recordAutonomy: ({ row }) => {
      record.autonomyRows.push(row);
      return Promise.resolve(autonomyRefusal);
    },
    recordPress: ({ repoSlug, number, headOid }) => {
      record.recorded.push(`${repoSlug}#${String(number)}@${headOid}`);
      return Promise.resolve(recordPressFails ? STORE_OUTAGE.presses.message : undefined);
    },
    recordRead: ({ record: read }) => {
      record.readsRecorded.push(read);
      return Promise.resolve(recordReadFails ? err(STORE_OUTAGE.reads) : ok(read));
    },
    recordReading: ({ by, document, observedAtIso }) => {
      record.readingsRecorded.push({ by, document, observedAtIso });
      return readingRefusal === undefined ? ok(`row-${String(record.readingsRecorded.length)}`) : err(readingRefusal);
    },
  };
}
