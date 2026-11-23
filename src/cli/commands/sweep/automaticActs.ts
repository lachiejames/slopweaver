/**
 * The loop `sweep board --close-shipped` and `--queue`'s own-card retirement act through: one register verb per row,
 * serial, capped, journalled on the sweep ledger and the autonomy ledger, and STOPPED by an unwritten ledger.
 *
 * ## Why a refused verb does not stop the pass, when an unwritten ledger does
 *
 * `--settle-ended` (`./endedSettle.ts`) stops at its first refused settle, because its refusals are faults every
 * later row would meet too. A refused CLOSE is usually the row's own: the uncarded-page gate refusing a row whose run
 * published a page that never reached the owner's Queue, or a run a seat is still on. Stopping there would let one such row
 * hold every later SHIPPED row on the board, every morning. So a refused verb leaves THAT row, printed, and the pass
 * moves on; an unwritten ledger row is the rail itself failing — the act landed with no findable record — and the pass
 * stops on it, printing the act it could not record.
 *
 * ## A non-zero exit is not proof nothing was written
 *
 * `handover settle` writes the row, then mirrors it and reports the run's residue, and either of those can fail
 * after the write (a released run journal readable but not appendable, for one). So the loop
 * snapshots the row's own files before each verb and reads them again after any non-zero exit: unchanged is a
 * refusal and the row is left; changed is an act that LANDED and then failed, so it is journalled like any other
 * and the pass stops non-zero on it; unreadable is unknown, so the act is printed and the pass stops non-zero. A
 * concurrent writer changing the same files in that window reads as landed — a ledger row too many, never one too few.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { autonomyLedgerPort } from "../../../autonomy/port.js";
import { buildAutonomyAction } from "../../../autonomy/row.js";
import type { AutonomyActionRow } from "../../../autonomy/types.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { SweepAct, SweepCandidate } from "../../../sweep/classify.js";
import { actId, type SweepJournalReason, type SweepJournalRow } from "../../../sweep/journalRow.js";
import { appendSweepRow, sweepLedgerPath } from "../../../sweep/journalStore.js";

import type { RegisterVerbCall } from "./registerVerbCall.js";

/** The most rows one pass acts on, per kind of act. A pass that finds more prints the rest for the next one. */
export const AUTOMATIC_ACT_CAP = 25;

/** One act the pass will perform, fully built before any of them runs. */
export interface AutomaticAct {
  /** The row acted on, as the pass classified it. */
  readonly candidate: SweepCandidate;
  /** Which register verb the act is, as the ledger records it. */
  readonly act: Exclude<SweepAct, "none">;
  /** The register verb, and the line the ledger records for it. */
  readonly call: RegisterVerbCall;
  /** The evidence the act is taken on — the ledger's witness. */
  readonly witness: string;
  /** Why the ledger says the sweep acted: the candidate's verdict, or a maintenance reason. */
  readonly reason: SweepJournalReason;
}

/** What one kind of act is, as both ledgers record it. */
export interface AutomaticActKind {
  /** The verb and flag that acted, which the ledgers record as the session. */
  readonly session: string;
  /** The flag alone, which every diagnostic line names after the verb's own `sweep board:` prefix. */
  readonly flag: string;
  /** The autonomy ledger's kind. */
  readonly kind: string;
  /** What the act was, in one line to the owner. */
  readonly said: string;
  /** Why it was obvious enough to do unasked. */
  readonly why: string;
}

/** The seams the loop writes through. */
export interface AutomaticActDeps {
  /** Run one register verb in process, re-judged at the write, answering its exit code. */
  readonly runVerb: (args: { act: AutomaticAct }) => Promise<number>;
  /** A fingerprint of every file the act's verb writes, read before it runs and again after a non-zero exit. */
  readonly observe: (args: { act: AutomaticAct }) => Result<string, { readonly message: string }>;
  /** Append one sweep ledger row. */
  readonly appendLedger: (args: { row: SweepJournalRow }) => Result<void, { readonly message: string }>;
  /** Append one autonomy row, answering the failure's message, or undefined when it was written. */
  readonly recordAutonomy: (args: { row: AutonomyActionRow }) => Promise<string | undefined>;
  readonly nowIso: () => string;
  readonly writeDiagnostic: (line: string) => void;
}

/** What a pass of acts did: the rows acted on, in order, and how many verbs ran. */
export interface AutomaticActOutcome {
  readonly acted: readonly string[];
  /** Every verb that ran — a verb exiting non-zero may still have written, so the caller re-reads after ANY. */
  readonly attempted: number;
  /** True when an act landed that neither ledger recorded, so the pass stopped on it — a failed run. */
  readonly stopped: boolean;
}

/**
 * The autonomy action id for one act — derived from the kind and slug, so a retried record of it is the same id.
 *
 * @param kind the act's autonomy kind
 * @param slug the row acted on
 * @returns a register-valid id
 */
function autonomyActionId({ kind, slug }: { kind: string; slug: string }): string {
  return `sweep-${createHash("sha256").update(`${kind}\n${slug}`).digest("hex").slice(0, 16)}`;
}

/**
 * Record one act on the autonomy ledger, printing — never throwing — a row that would not write.
 *
 * @returns true when the autonomy row was written
 */
async function recordAutonomy({
  act,
  atIso,
  deps,
  kind,
}: {
  act: AutomaticAct;
  atIso: string;
  deps: AutomaticActDeps;
  kind: AutomaticActKind;
}): Promise<boolean> {
  const slug = act.candidate.slug;
  const built = buildAutonomyAction({
    actionId: autonomyActionId({ kind: kind.kind, slug }),
    bySession: kind.session,
    doneIso: atIso,
    kind: kind.kind,
    run: slug,
    said: kind.said,
    steer: undefined,
    subject: slug,
    why: kind.why,
    witness: `${act.call.line} — ${act.witness}`,
  });
  if (built.isErr()) {
    deps.writeDiagnostic(
      `sweep board: ${kind.flag} acted on ${slug}, but its autonomy row would not build: ${built.error.message}`,
    );
    return false;
  }
  const failure = await deps.recordAutonomy({ row: built.value });
  if (failure !== undefined) {
    deps.writeDiagnostic(`sweep board: ${kind.flag} acted on ${slug}, but its autonomy row did not write: ${failure}`);
    return false;
  }
  return true;
}

/** How one act ended: recorded on both ledgers, or not, or refused, or landed and then failed, or not known. */
type ActEnding = "journalled" | "unrecorded" | "left" | "faulted" | "unknown";

/**
 * What a non-zero exit did, read off the row's own files: nothing (`left`), a write (`landed`), or not knowable.
 */
function nonZeroEnding({
  act,
  before,
  code,
  deps,
  kind,
}: {
  act: AutomaticAct;
  before: Result<string, { readonly message: string }>;
  code: number;
  deps: AutomaticActDeps;
  kind: AutomaticActKind;
}): "left" | "landed" | "unknown" {
  const slug = act.candidate.slug;
  const verb = `\`handover ${act.act}\` exited ${String(code)}`;
  const after = deps.observe({ act });
  const unread = [before, after].flatMap((read) => (read.isErr() ? [read.error.message] : []));
  if (before.isErr() || after.isErr()) {
    deps.writeDiagnostic(
      `sweep board: ${kind.flag} cannot tell whether ${slug} was written: ${verb}, and its files would not read (${unread.join("; ")}) — the act was: ${act.call.line}`,
    );
    return "unknown";
  }
  if (before.value === after.value) {
    deps.writeDiagnostic(`sweep board: ${kind.flag} left ${slug}: ${verb}, its own lines above name why`);
    return "left";
  }
  deps.writeDiagnostic(`sweep board: ${kind.flag} wrote ${slug} and then failed: ${verb} after its write`);
  return "landed";
}

/**
 * Perform one act, then journal it on both ledgers — including one whose verb wrote and then exited non-zero.
 *
 * @returns `journalled` when acted on and recorded on both, `unrecorded` when a ledger write failed after the act,
 *   `left` when the verb refused and wrote nothing, `faulted` when it wrote, failed and was journalled, `unknown`
 *   when whether it wrote could not be read
 */
async function performOne({
  act,
  deps,
  kind,
}: {
  act: AutomaticAct;
  deps: AutomaticActDeps;
  kind: AutomaticActKind;
}): Promise<ActEnding> {
  const slug = act.candidate.slug;
  const before = deps.observe({ act });
  const code = await deps.runVerb({ act });
  let faulted = false;
  if (code !== 0) {
    const ending = nonZeroEnding({ act, before, code, deps, kind });
    if (ending !== "landed") {
      return ending;
    }
    faulted = true;
  }
  const atIso = deps.nowIso();
  const row: SweepJournalRow = {
    act: act.act,
    atIso,
    id: actId({ atIso, slug }),
    path: act.candidate.path,
    session: kind.session,
    slug,
    verbLine: act.call.line,
    verdict: act.reason,
    witness: act.witness,
  };
  const journalled = deps.appendLedger({ row });
  if (journalled.isErr()) {
    // The act already landed, so this row is the only surviving record of what was taken and why.
    deps.writeDiagnostic(`sweep board: ${kind.flag} acted on ${slug}, but ${journalled.error.message} — the act was:`);
    deps.writeDiagnostic(`  ${row.id} ${row.verdict}/${row.act} ${row.slug} — ${row.witness}`);
    return "unrecorded";
  }
  if (!(await recordAutonomy({ act, atIso, deps, kind }))) {
    return "unrecorded";
  }
  return faulted ? "faulted" : "journalled";
}

/** The line a stopping ending prints, or undefined for an ending the pass carries on past. */
function stopLine({ ending, kind }: { ending: ActEnding; kind: AutomaticActKind }): string | undefined {
  if (ending === "unrecorded") {
    return `sweep board: ${kind.flag} stopped — an act it could not record is printed above`;
  }
  if (ending === "faulted") {
    return `sweep board: ${kind.flag} stopped — an act wrote and then failed; it is journalled, and its own lines above name the failure`;
  }
  if (ending === "unknown") {
    return `sweep board: ${kind.flag} stopped — an act may have written with no record; it is printed above`;
  }
  return undefined;
}

/**
 * Perform every act, one at a time, up to {@link AUTOMATIC_ACT_CAP}.
 *
 * @param acts the acts, in the order the pass found them
 * @param kind what these acts are, as both ledgers record them
 * @param deps the writes
 * @returns the rows acted on and how many verbs ran
 */
export async function performAutomaticActs({
  acts,
  kind,
  deps,
}: {
  acts: readonly AutomaticAct[];
  kind: AutomaticActKind;
  deps: AutomaticActDeps;
}): Promise<AutomaticActOutcome> {
  const acted: string[] = [];
  let attempted = 0;
  let stopped = false;
  for (const [index, act] of acts.entries()) {
    if (index >= AUTOMATIC_ACT_CAP) {
      deps.writeDiagnostic(
        `sweep board: ${kind.flag} reached its cap of ${String(AUTOMATIC_ACT_CAP)} — ${act.candidate.slug} is the next pass's`,
      );
      continue;
    }
    attempted += 1;
    const ending = await performOne({ act, deps, kind });
    if (ending !== "left" && ending !== "unknown") {
      acted.push(act.candidate.slug);
    }
    const stop = stopLine({ ending, kind });
    if (stop !== undefined) {
      deps.writeDiagnostic(stop);
      stopped = true;
      break;
    }
  }
  deps.writeDiagnostic(
    `sweep board: ${kind.flag} acted on ${String(acted.length)} of ${String(acts.length)} row(s) — slopweaver sweep list names each`,
  );
  return { acted, attempted, stopped };
}

/**
 * A fingerprint of every named file's bytes, an absent file reading as absent — so a write, a creation, a move or a
 * removal each changes it.
 *
 * @param paths the row's doc and run journal
 * @returns the sha256 over every file in order, or the read that failed for a reason other than absence
 */
export function rowFingerprint({ paths }: { paths: readonly string[] }): Result<string, { readonly message: string }> {
  const hash = createHash("sha256");
  for (const path of paths) {
    try {
      hash.update(`${path}\n`).update(readFileSync(path)).update("\n");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        hash.update(`${path}\nabsent\n`);
        continue;
      }
      return err({ message: `${path} would not read: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return ok(hash.digest("hex"));
}

/**
 * The real ledgers over one home, around the caller's own verb. Every line goes to stderr, so `--json` keeps stdout to
 * the findings.
 *
 * @param home the state home both ledgers live under
 * @param runVerb the register verb, re-judged at the write, with its receipt sent to stderr
 * @returns the production dependencies for {@link performAutomaticActs}
 */
export function productionAutomaticActDeps({
  home,
  runVerb,
}: {
  home: string;
  runVerb: (args: { act: AutomaticAct; out: (args: { line: string }) => void }) => Promise<number>;
}): AutomaticActDeps {
  const toStderr = ({ line }: { line: string }): void => {
    logger.error({ msg: line });
  };
  return {
    appendLedger: ({ row }) => appendSweepRow({ path: sweepLedgerPath({ home }), row }).map(() => undefined),
    nowIso: () => new Date().toISOString(),
    observe: ({ act }) =>
      rowFingerprint({
        paths: [act.candidate.path, join(stateHomePaths({ home }).runs, `${act.candidate.slug}.jsonl`)],
      }),
    recordAutonomy: async ({ row }) => {
      const written = await autonomyLedgerPort().appendRecord({ home, record: row });
      return written.isErr() ? written.error.message : undefined;
    },
    runVerb: ({ act }) => runVerb({ act, out: toStderr }),
    writeDiagnostic: (line) => {
      toStderr({ line });
    },
  };
}
