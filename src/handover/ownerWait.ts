/**
 * Whether a board row is ACTUALLY waiting on the owner's word — the one derivation every surface reads
 * instead of each spelling its own.
 *
 * ## The defect, measured
 *
 * A console that is unreadable to the owner is one that lists rows as waiting on them that are not.
 * MEASURED against a board of 2,687 rows, 41 carrying an open recorded question — every one
 * of those 41 rendered as "waiting on your word", and **21 of them were not**:
 *
 * - **8** carried a `ruling` event recorded at or after the open question. The owner had already ruled; the row was
 *   waiting on a SESSION to execute the ruling. One such question opened with a completed outcome (an option
 *   chosen and landed on main), still printed as a thing the owner owed an answer to five days later.
 * - **4** carried a front-matter `settlement:` — the ask was settled and the row still asked the owner.
 * - **13** sat at `status: paused`, which is not runnable.
 *
 * Reproduce: `slopweaver handover list --json` and count the rows whose `ownerWait` kind is anything but the
 * last arm above among those carrying a `question`.
 *
 * ## Why this is one function rather than a rule each surface applies
 *
 * Four surfaces independently wrote `row.question !== undefined` and each called the result "waiting on your
 * word", two of them in `site/components/console/Queue.tsx`. `docs/console.md`'s rule is what decides where the fix goes: a
 * surface may choose what to SHOW, and none of them may choose what is TRUE. So the verdict is computed
 * here, published on every `handover list --json` row, and read.
 *
 * ## No clock, deliberately
 *
 * Every arm carries INSTANTS and never a duration. `./paused.ts` records the owner's ruling that a pause
 * carries no time limit and no deadline, and a row paused on a person must never grow a day-count, because
 * a day-count reads as a countdown. What a renderer does with an instant is the renderer's decision; this
 * module hands it the fact and no arithmetic.
 *
 * Pure: an already-composed disposition and an already-derived row state in, a verdict out. No filesystem,
 * no clock, and no `Result` — there is no failure of fact here to report, only a classification.
 */

import type { RunDisposition } from "./boardTypes.js";
import type { DerivedRowState } from "./derivedRowState.js";
import { isTerminalDocStatus } from "./doc.js";
import { type RulingIdentity, rulingWords } from "./ruling.js";

/**
 * The kind of the one arm a surface may render as needing the owner. The console restates it beside its closed list
 * of kinds (`site/components/live/readBoardWaits.ts`), and `site/__tests__/unit/ownerWaitMirror.test.ts` binds the two.
 */
export const OWNER_WAIT_KIND = "owner" as const;

/**
 * What a row is really waiting on, when it carries a recorded question at all.
 *
 * A discriminated union rather than a boolean, because the three arms that are not the owner's are three different things to
 * tell a reader and collapsing them would leave the console saying only that a row it used to list is gone.
 */
export type OwnerWait =
  /** No open question: this row never entered the queue. */
  | { readonly kind: "not-waiting" }
  /**
   * The ask is SETTLED, or the work terminal, while a question sits open on the journal. `statusFrom` says
   * which register decided it, so "why is this not on my list" is answerable without opening the doc.
   */
  | {
      readonly kind: "settled";
      readonly askedIso: string;
      readonly statusFrom: DerivedRowState["statusFrom"];
    }
  /** The owner already ruled — after the question was asked. The row waits on a session, not on them. */
  | {
      readonly kind: "already-ruled";
      readonly askedIso: string;
      readonly ruledIso: string;
      readonly words: string;
    }
  /** Paused. Not runnable, so not the owner's next word — and carrying no elapsed time, by owner ruling. */
  | { readonly kind: "not-runnable"; readonly askedIso: string }
  /** The owner's, and the only arm a surface may render as needing them. */
  | { readonly kind: typeof OWNER_WAIT_KIND; readonly askedIso: string };

/** Every verdict's discriminant, which is what the board's JSON document publishes. */
export type OwnerWaitKind = OwnerWait["kind"];

/**
 * Whether a published verdict is the owner's arm — the one test every reader of a board row's `ownerWait` takes.
 *
 * @param ownerWait the verdict's kind as published on the board row
 * @returns true when the row waits on the owner's word
 */
export function waitsOnOwner({ ownerWait }: { ownerWait: string }): boolean {
  return ownerWait === OWNER_WAIT_KIND;
}

/**
 * A ruling that can say WHEN it was decided, with the owner's words beside it.
 *
 * The `authored` arm of `RulingEvidence` — the `ruling:`/`rulingAnchor:` front-matter pair `handover rule`
 * wrote before the event kind existed — carries no instant and never will (`./ruling.ts` says why the union
 * has two arms rather than one record with optional fields). So a row whose only ruling is authored cannot
 * be shown to have been ruled SINCE its question, and stays the owner's: claiming otherwise would take a live ask
 * off their list on the strength of a decision that might predate it by a month.
 *
 * The words are returned WITH the instant rather than read again at the call site, so the verdict cannot
 * end up quoting one ruling and dating another.
 *
 * @param ruling the row's latest ruling, as the derivation gives it
 * @returns its identity, or `undefined` when the evidence cannot date itself
 */
export function datedRulingOf({ ruling }: { ruling: DerivedRowState["ruling"] }): RulingIdentity | undefined {
  if (ruling === undefined) {
    return undefined;
  }
  if (ruling.from === "authored") {
    return undefined;
  }
  return { anchor: ruling.event.anchor, decidedIso: ruling.decidedIso, words: rulingWords({ evidence: ruling }) };
}

/**
 * The ruling that answers the question a waiting run holds NOW, or `undefined` when none does — the one pick the
 * board and `talk restore` both read, so they cannot disagree about which ruling took a row off the owner's list.
 *
 * With no restatement it is the row's standing ruling, when that was decided at or after the ask. Once a
 * correction, reshape or offer has restated the question, every ruling journalled before its line was the input the
 * restatement was made FROM, so the candidates are only the rulings after it (`./heldQuestion.ts`,
 * `rulingsAfterRestatement`) — by journal POSITION, so a ruling decided or stamped before the restatement but
 * appended after it still answers it, and the latest of them by decision instant, never shadowed by a
 * later-decided ruling the restatement already read.
 *
 * @param run the waiting run's ask instant and, when a line restated it, the rulings journalled since
 * @param standing the row's standing ruling, latest by decision instant, when it can date itself
 * @returns the answering ruling, or `undefined` when the row still waits on the owner
 */
export function answeringRuling({
  run,
  standing,
}: {
  run: Pick<Extract<RunDisposition, { kind: "waiting-on-owner" }>, "askedIso" | "ruledAfterRestatement">;
  standing: RulingIdentity | undefined;
}): RulingIdentity | undefined {
  let candidates: readonly RulingIdentity[] = [];
  if (run.ruledAfterRestatement !== undefined) {
    candidates = run.ruledAfterRestatement;
  } else if (standing !== undefined) {
    candidates = [standing];
  }
  let answer: RulingIdentity | undefined;
  for (const ruling of candidates) {
    const since = decidedSince({ askedIso: run.askedIso, decidedIso: ruling.decidedIso });
    if (since && (answer === undefined || Date.parse(ruling.decidedIso) >= Date.parse(answer.decidedIso))) {
      answer = ruling;
    }
  }
  return answer;
}

/**
 * Whether a decision lands at or after the moment a question was asked.
 *
 * An unparseable instant on either side answers NO rather than yes. A journal is a hand-editable file, and
 * `NaN` compares false against everything, so a single bad line must not be able to take a row the owner is really
 * waiting on off their list — the safe direction here is to keep asking.
 *
 * @param decidedIso when the owner decided
 * @param askedIso when the question was recorded
 * @returns whether the decision is the later of the two, ties included
 */
function decidedSince({ decidedIso, askedIso }: { decidedIso: string; askedIso: string }): boolean {
  const decided = Date.parse(decidedIso);
  const asked = Date.parse(askedIso);
  if (Number.isNaN(decided) || Number.isNaN(asked)) {
    return false;
  }
  return decided >= asked;
}

/**
 * Classify what a row is really waiting on.
 *
 * The precedence runs most-terminal first, and each step is one of the measured buckets above: a settled or
 * terminal row is not a question at all; a row the owner has ruled on since asking is waiting on whoever executes
 * the ruling; a paused row is not runnable; everything left is the owner's.
 *
 * A row with no run can still be the owner's: a registered ask carrying its whole shape, which the board placed in
 * `WAITING ON OWNER` off its own front-matter (`./registeredAsk.ts`). The caller passes that ask only when the
 * board did, so this verdict and the section cannot disagree — and `registeredAskOf` has already excluded a
 * settled, paused or ruled row, so it is the owner's and nothing else.
 *
 * @param run the row's composed run disposition — where a RUN's open question and its instant live
 * @param derived the row's derived state, whose `status` and `ruling` are both register-first
 * @param registered the registered ask the board placed in `WAITING ON OWNER`, absent on every other row
 * @returns the verdict, with the instants a renderer needs and no arithmetic over them
 */
export function ownerWaitOf({
  run,
  derived,
  registered,
}: {
  run: RunDisposition;
  derived: DerivedRowState;
  registered?: { readonly askedIso: string } | undefined;
}): OwnerWait {
  if (run.kind !== "waiting-on-owner") {
    if (registered !== undefined) {
      return { askedIso: registered.askedIso, kind: OWNER_WAIT_KIND };
    }
    return { kind: "not-waiting" };
  }
  const askedIso = run.askedIso;
  if (isTerminalDocStatus(derived.status)) {
    return { askedIso, kind: "settled", statusFrom: derived.statusFrom };
  }
  const answer = answeringRuling({ run, standing: datedRulingOf({ ruling: derived.ruling }) });
  if (answer !== undefined) {
    return { askedIso, kind: "already-ruled", ruledIso: answer.decidedIso, words: answer.words };
  }
  if (derived.status === "paused") {
    return { askedIso, kind: "not-runnable" };
  }
  return { askedIso, kind: OWNER_WAIT_KIND };
}
