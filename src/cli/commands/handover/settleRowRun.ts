/**
 * `slopweaver handover settle` — the other end of an ask row.
 *
 * An ask ends exactly three ways and each carries a witness, which is what stops a session closing one by
 * asserting it is closed — see `../../../handover/rowKind.ts` for why a decline is treated differently from
 * the other two, and why that difference is enforced as an ANCHOR requirement rather than as a claim to have
 * verified whose hand set it.
 *
 * Split from `./askRowRun.js` (the file-size ratchet), which now holds only `register`; reading the flags into a plan
 * is `./settleRowPlan.ts`, split the same way. The seam is the verb:
 * the two share their argument parser and their mirror write, and nothing else — `settle` reads the run
 * journal, asks the closing gates and may reap a dead run, none of which `register` has any use for.
 *
 * A row a talk relay registered about an open hand card also says what happens to that card — done, re-cut or
 * kept with a reason — and `./settleCardRun.ts` performs it BEFORE the row is written. The whole settle runs
 * under a per-slug settle lock, so two settles of one row with different dispositions cannot both land; the row's
 * own rewrite (`./settleRowWrite.ts`) is read and written inside the one lock every row writer takes
 * (`./boardRowLock.ts`), so a steer, priority or pause landing on the row at the same moment is never written over.
 *
 * An `answered` settle whose witness is a bare pull request URL, on a row whose stored words ask for proof, reads
 * that body live before any card or row write, and refuses naming what it lacks (`./proofWitnessGate.ts`, the acme-admin-17564 settlement).
 */

import { slopweaverHome } from "../../../config.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { currentSessionIds } from "../../../handover/runOwner.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import { parseHandoverSettleArgs, SETTLE_USAGE } from "./askRowArgs.js";
import { checksReadGateRefuses } from "./checksReadGate.js";
import { acquireClosingLock } from "./closingLock.js";
import { lessonsGateRefuses } from "./lessonsGate.js";
import { nowIso } from "./lifecycleRunCore.js";
import { mirrorAfterWrite } from "./mirrorAfterWrite.js";
import { type PullBodyRead, proofWitnessReceipt } from "./proofWitnessGate.js";
import { filedInto, type PlannedSettleCard, planSettleCard } from "./settleCardRun.js";
import {
  reportRunResidue,
  type SettledAs,
  type SettleOut,
  type SettlePrecondition,
  settledReceiptLines,
} from "./settleResidueRun.js";
import { settlePlan } from "./settleRowPlan.js";
import { type SettlementInputs, settleCardThenRow } from "./settleRowWrite.js";
import { printSettleRefusal, readSettleRow } from "./settleTarget.js";
import { uncardedPageGateRefuses } from "./uncardedPageGate.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** A settle the flags asked for, with the caller's precondition when it brought one. */
type SettleRequest = Exclude<ReturnType<typeof settlePlan>, { readonly refusal: string }> & {
  readonly precondition: SettlePrecondition | undefined;
  readonly readPullBody: PullBodyRead | undefined;
};

/**
 * Every gate asked at the moment a row stops being open, in order.
 *
 * They are asked BEFORE the settlement is written, so a refusal leaves the row exactly as it was — a
 * half-settled row whose lesson question is still open, or that still owes a checks read, would be worse
 * than either whole state. `./checksReadGate.ts` holds the reason an unread raise is a
 * gate here rather than a habit. `./uncardedPageGate.ts` refuses when the witness or the row's own artifact is a page that never reached the owner's Queue.
 *
 * @param row the doc being settled, whose journal every gate reads
 * @param values the parsed flags, whose `--lessons` is what the lessons gate is answering
 * @param witness the settlement's witness, which the uncarded-page gate reads for a page beside the artifact
 * @param out the settle's own report channel, which the lessons gate's lines go to as well
 * @returns true when the caller must stop, having already printed why
 */
async function closingGatesRefuse({
  home,
  out,
  row,
  values,
  witness,
}: {
  home: string;
  out: SettleOut;
  row: HandoverDoc;
  values: Readonly<Record<string, unknown>>;
  witness: string;
}): Promise<boolean> {
  const slug = row.slug;
  const lessons = typeof values["lessons"] === "string" ? values["lessons"] : undefined;
  const runsDir = stateHomePaths({ home }).runs;
  if (await lessonsGateRefuses({ home, lessons, nowIso: nowIso(), out, runsDir, slug, verb: "settle" })) {
    return true;
  }
  if (checksReadGateRefuses({ home, runsDir, slug, verb: "settle" })) {
    return true;
  }
  return uncardedPageGateRefuses({
    candidate: { kind: "settlement", witness },
    doc: row,
    home,
    runsDir,
    verb: "settle",
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
  });
}

/**
 * Settle an ask row.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverSettle(argv: readonly string[]): Promise<number> {
  return settleAskRow({ argv, out: logger.out });
}

/**
 * Settle an ask row, writing its receipt through `out` — the in-process half a caller with its own stdout uses.
 *
 * `github landing --register` settles a row whose pull request has ended (`../github/landingClosureRun.ts`), and
 * under `--json` stdout is that verb's document, so the receipt must go where the caller says. Refusals still go
 * to stderr, which no caller owns.
 *
 * @param argv the full argv, `[node, cli, "handover", "settle", …]`
 * @param out where the success receipt and the run residue lines go
 * @param precondition the caller's own refusal, asked under the lock of the row as it is about to be written over
 * @param readPullBody the live read of a bare pull request witness's body, for the proof gate; GitHub when absent
 * @returns the verb's exit code
 */
export async function settleAskRow({
  argv,
  out,
  precondition,
  readPullBody,
}: {
  argv: readonly string[];
  out: SettleOut;
  precondition?: SettlePrecondition;
  readPullBody?: PullBodyRead;
}): Promise<number> {
  // The deepest shell, so every caller importing this rather than `runHandoverSettle` crosses the gate too.
  const gated = refuseRunnerOnStandingRuling({ noun: "handover", rest: argv.slice(VERB_ARG_OFFSET), verb: "settle" });
  if (gated !== undefined) {
    return gated;
  }
  return settleRow({ argv, out, precondition, readPullBody });
}

/** One settle, past the ruling gate {@link settleAskRow} asks first; its parameters are that function's. */
async function settleRow({
  argv,
  out,
  precondition,
  readPullBody,
}: {
  argv: readonly string[];
  out: SettleOut;
  precondition: SettlePrecondition | undefined;
  readPullBody: PullBodyRead | undefined;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    out({ line: SETTLE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverSettleArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: SETTLE_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const plan = settlePlan({ positionals: parsed.value.positionals, values });
  if ("refusal" in plan) {
    logger.error({ msg: `handover settle: ${plan.refusal}` });
    logger.error({ msg: SETTLE_USAGE });
    return EXIT_USAGE;
  }
  const home = typeof values["home"] === "string" ? values["home"] : slopweaverHome();
  // One closer of a row at a time: the board read, the card's re-check, the gates and the row write are one critical
  // section, and a `page publish` on this run waits outside it (`./closingLock.ts`).
  const lock = acquireClosingLock({ home, nowIso: nowIso(), slug: plan.slug });
  if (lock.isErr()) {
    logger.error({
      msg: `handover settle: another settle, finish or page publish of ${plan.slug} is running — ${lock.error}`,
    });
    return EXIT_ERROR;
  }
  try {
    const settled = await settleUnderLock({ home, out, plan: { ...plan, precondition, readPullBody }, values });
    if (typeof settled === "number") {
      return settled;
    }
    // Still under the lock: a released run's close appends `finished`, so a `page publish` landing between the gate
    // and that append would close the run on an artifact the gate never saw.
    return await reportSettled({ home, out, plan, settled });
  } finally {
    lock.value.release();
  }
}

/**
 * Print a written settlement's receipt, mirror the row, then report — or end — the run behind it.
 *
 * @param plan the settle's plan, whose settlement decides the ending of a cycle nobody holds
 * @param settled the receipt lines and the row path the write produced
 * @returns the verb's exit code — an error when the mirror failed, else the run residue's own
 */
async function reportSettled({
  home,
  out,
  plan,
  settled,
}: {
  home: string;
  out: SettleOut;
  plan: SettledAs & { slug: string };
  settled: { receipt: readonly string[]; path: string };
}): Promise<number> {
  settled.receipt.forEach((line) => {
    out({ line });
  });
  const mirrorFailed = await mirrorAfterWrite({ home, path: settled.path, verb: "settle" });
  const settledAs = { reason: plan.reason, settlement: plan.settlement, witness: plan.witness };
  const residue = await reportRunResidue({ home, out, settled: settledAs, slug: plan.slug });
  return mirrorFailed ? EXIT_ERROR : residue;
}

/**
 * The row's card plan, printing the refusal when there is none.
 *
 * @param at the clock the settle writes at
 * @param by who the card's settling names
 * @param target the row read under the lock, and the board docs beside it
 * @returns the plan and its anchor receipt, or the exit code of the refusal already printed
 */
function planCard({
  at,
  by,
  home,
  plan,
  target,
}: {
  at: string;
  by: string;
  home: string;
  plan: SettleRequest;
  target: { readonly row: { readonly anchor: string | undefined }; readonly docs: readonly HandoverDoc[] };
}): PlannedSettleCard | number {
  const { slug, settlement, witness, disposition } = plan;
  const filedFrom = filedInto({ docs: target.docs, slug });
  const anchor = target.row.anchor;
  const planned = planSettleCard({
    anchor,
    bySession: by,
    disposition,
    filedFrom,
    home,
    nowIso: at,
    settlement,
    slug,
    witness,
  });
  if (planned.isErr()) {
    return printSettleRefusal({ lines: [planned.error.message] });
  }
  return planned.value;
}

/**
 * The settle's critical section, under the per-slug settle lock: read the row, plan the card, ask the gates, perform the
 * card, write the row — in that order, every check before the first write.
 *
 * @param plan what the flags asked for
 * @param values the parsed flags
 * @param out the settle's report channel, handed to the closing gates
 * @returns the written row's path and the receipt to print, or the exit code of the refusal already printed
 */
async function settleUnderLock({
  home,
  out,
  plan,
  values,
}: {
  home: string;
  out: SettleOut;
  plan: SettleRequest;
  values: Readonly<Record<string, unknown>>;
}): Promise<{ readonly path: string; readonly receipt: readonly string[] } | number> {
  const { slug, settlement, witness, reason, precondition, readPullBody } = plan;
  const dir = typeof values["dir"] === "string" ? values["dir"] : undefined;
  const target = readSettleRow({ dir, home, settlement, slug, witness });
  if (typeof target === "number") {
    return target;
  }
  const at = nowIso();
  const by = settleBySession();
  const planned = planCard({ at, by, home, plan, target });
  if (typeof planned === "number") {
    return planned;
  }
  const { card, receiptLines: anchorReceipt } = planned;
  if (await closingGatesRefuse({ home, out, row: target.row, values, witness })) {
    return EXIT_ERROR;
  }
  // The last AWAITED check: a bare pull request URL the owner's words asked proof of is read live (`./proofWitnessGate.ts`).
  // After the card plan and the closing gates, so a settle they refuse never reads; before `settleCardThenRow`, so the
  // caller's precondition still runs over the row's bytes with nothing awaited between it and the write.
  const proof = { env: process.env, home, readBody: readPullBody, row: target.row, settlement, witness };
  const proofReceipt = await proofWitnessReceipt(proof);
  if (proofReceipt === undefined) {
    return EXIT_ERROR;
  }
  const inputs: SettlementInputs = {
    card,
    home,
    precondition,
    reason,
    row: target.row,
    settledIso: at,
    settlement,
    witness,
  };
  if (!settleCardThenRow({ bySession: by, inputs, slug })) {
    return EXIT_ERROR;
  }
  return {
    path: target.row.path,
    receipt: [...settledReceiptLines({ plan: card, settlement, slug, witness }), ...anchorReceipt, ...proofReceipt],
  };
}

/**
 * Who a card's `done` settling names: this session, when the environment says which it is.
 *
 * @returns the session id, or `handover-settle` when none is named
 */
function settleBySession(): string {
  const [id] = currentSessionIds({ env: process.env });
  if (id === undefined) {
    return "handover-settle";
  }
  return id;
}
