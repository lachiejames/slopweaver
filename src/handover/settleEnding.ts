/**
 * What `handover settle` has NOT ended, and the lines that say so.
 *
 * ## The defect, measured
 *
 * `settle` ends an ASK ROW: it splices `settlement:` into that row's own front-matter and touches nothing
 * else. `finish` ends a RUN. The two are different endings and a session that lands its work, settles the
 * row and stops leaves its run cycle OPEN forever — `session close-done`'s `doneEvidenceOf` gates all three
 * of its done-anchors behind `run.phase === "closed"` on purpose (`../sessions/closeDone.ts`, measured on a
 * workspace where a settled ask was still holding a merge lane), so the workspace is never
 * reaped and its slot is never reused. Before this module, `settle` printed one success line and said
 * nothing at all about the run it had left open.
 *
 * The two cycles `settle` does close are the ones nobody can `finish`: one whose holder is DEAD —
 * {@link settleReapedLines} says why the ending is the reaper's `orphaned` — and one PARKED or released with nobody
 * holding it, whose ending the settlement decides ({@link releasedCycleEnding}).
 *
 * Reproduce the whole thing against a throwaway home, no fixtures:
 *
 * ```
 * H=$(mktemp -d); mkdir -p "$H/handovers" "$H/runs"
 * slopweaver handover register --home "$H" --ask x --slug r --asked-iso "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
 * slopweaver handover start r --home "$H"
 * slopweaver handover settle r --home "$H" --as answered --witness w --lessons none
 * cat "$H/runs/r.jsonl"   # started, launched, lessons — and no `finished`
 * ```
 *
 * ## The token collision is in the PROSE, not in the mechanism
 *
 * The finding this module was written under reported that `settle` reads the run journal's `answered` event
 * as an existing settlement and no-ops. It does not: `settleTarget` reads `settlement:` off the parsed doc
 * and the journal is never consulted for it — the repro above settles cleanly on a run that has had
 * `handover answer` called on it. What is real is that the `AskSettlement` token `answered` and the
 * `RunEvent` kind `answered` (`./rowKind.ts`, `./ledger.ts`) are disjoint types printed with the same word,
 * so `<slug> is already answered` reads as either. Both tokens are written into state on disk — every row's
 * front-matter, every journal — so the fix is to disambiguate what the verbs SAY rather than to rename what
 * they have already written.
 *
 * Pure: a parsed doc and a derived run state in, lines out. No filesystem, no clock.
 */

import { absentAs } from "#lib/absent.js";
import type { HandoverDoc } from "./doc.js";
import { type RunEvent, type RunState, runStateOf } from "./ledger.js";
import type { AskSettlement } from "./rowKind.js";
import { runOwnership } from "./runOwner.js";

/**
 * What a settled ask's RUN still owes, so `settle` can never read as the whole ending.
 *
 * `never-started` and `run-closed` are both silent: a row settled as bookkeeping never opened a cycle, and a
 * run that already ended owes nothing. The two loud ones are the states `close-done` refuses to reap.
 */
export type SettleRunResidue =
  /** No cycle was ever opened on this slug — the row was filed or declined as bookkeeping. */
  | { readonly kind: "never-started" }
  /** The current cycle ended in `finished`, `abandoned` or `orphaned`. Nothing is owed. */
  | { readonly kind: "run-closed" }
  /** A cycle is open. `handover finish` is what ends it. */
  | { readonly kind: "open" }
  /** A cycle is open AND holds a question nobody answered. `answer` then `finish`; settle clears neither. */
  | { readonly kind: "waiting-on-owner"; readonly question: string };

/**
 * What the run behind a just-settled row still owes.
 *
 * The `entries` test is what separates a journal that ended from one that never began: `runStateOf` reports
 * `closed` for both, exactly as `../sessions/closeDone.ts` documents, and only one of them has a cycle in it.
 *
 * @param run the slug's derived run state
 * @returns the residue, whose two loud kinds are the states `session close-done` refuses to reap
 */
export function settleRunResidue({ run }: { run: RunState }): SettleRunResidue {
  if (run.phase === "waiting-on-owner") {
    return {
      kind: "waiting-on-owner",
      question: absentAs({ value: run.openQuestion, whenAbsent: "the question is not on the journal" }),
    };
  }
  if (run.phase === "open") {
    return { kind: "open" };
  }
  return run.entries > 0 ? { kind: "run-closed" } : { kind: "never-started" };
}

/**
 * What `settle` prints after writing the settlement, naming the next verb rather than leaving a session to
 * infer one from silence.
 *
 * @param slug the row that was just settled, so every command printed is copy-pasteable
 * @returns the lines, empty when the run owes nothing
 */
export function settleRunResidueLines({
  slug,
  residue,
}: {
  slug: string;
  residue: SettleRunResidue;
}): readonly string[] {
  if (residue.kind === "never-started" || residue.kind === "run-closed") {
    return [];
  }
  const ending = [
    `  NEXT: settle ended the ask ROW. The RUN for ${slug} is still open, so \`session close-done\` cannot`,
    `  reap this workspace — end it with \`slopweaver handover finish ${slug}\` or \`slopweaver handover`,
    `  abandon ${slug} --why "<what stopped it>"\`.`,
  ];
  if (residue.kind === "open") {
    return ending;
  }
  return [
    `  The run is WAITING ON THE OWNER: "${residue.question}"`,
    `  Record the owner's answer with \`slopweaver handover answer ${slug} --answer "<their words>"\` first — settle`,
    "  clears neither the question nor the run.",
    ...ending,
  ];
}

/**
 * What `settle` prints when it closed the run itself, because the session holding it is dead.
 *
 * ## Why settle writes this one ending and no other
 *
 * MEASURED (`a-landed-ask-still-reads-ready-so-the-fill-scan-spawns-done-work`): five atlas asks
 * were settled `answered` on merged pull requests while each run journal still ended at `launched`, because
 * the session that held each run was gone. The NEXT lines above were addressed to nobody — `finish` and
 * `abandon` need the holder or a claim — so every later SessionStart brief told a fresh session the run was
 * held by a DEAD session and to `claim` it: an instruction to take over landed work.
 * `slopweaver handover reap --dry-run` still named all five, among 108 open cycles held by dead sessions.
 *
 * The ending is the reaper's `orphaned`, decided by the reaper's own `planReap` — never a `finished` written
 * on a dead session's behalf. `finished` is a claim a live session makes about its cycle, behind the lessons
 * and finished-cycle gates; `orphaned` says only that the session died, which is the one thing known here.
 * A `live` or `unknown` holder is never reaped, exactly as `./reap.ts` refuses: a settling session that still
 * holds its own run is `live`, so it gets the NEXT lines rather than having its run closed under it.
 *
 * @param slug the row that was just settled
 * @param deadSessionId the session the journal named as the cycle's writer
 * @param lastEventIso the instant of the cycle's last event before the reap
 * @returns the lines, naming the event written and the verb that writes the same one board-wide
 */
export function settleReapedLines({
  slug,
  deadSessionId,
  lastEventIso,
}: {
  slug: string;
  deadSessionId: string;
  lastEventIso: string;
}): readonly string[] {
  return [
    `  The RUN for ${slug} was held by session ${deadSessionId}, which is DEAD (last event ${lastEventIso}) and can`,
    "  never finish it — so settle appended the `orphaned` ending `slopweaver handover reap` writes. Nothing is",
    "  left to claim.",
  ];
}

/**
 * The ending `settle` writes on an open cycle nobody HOLDS — one whose writer parked or released it.
 *
 * ## Why settle writes it
 *
 * MEASURED: two incident rows were settled
 * while each run sat `parked` on a question, so `handover list` printed both under CONTRADICTION for good. A
 * `parked` line RELEASES its writer on purpose (`./runRelease.ts`), so the reaper skips the cycle as naming no
 * writer, and the NEXT lines named `finish` and `abandon` — both of which refuse a released run (`mayMutate`).
 * The lines were addressed to nobody, exactly as they were for a dead holder before {@link settleReapedLines}.
 * Repro: `slopweaver handover reap --dry-run --json` names each such slug "the cycle names no writer".
 *
 * ## Why this ending, and not the reaper's
 *
 * The park kept the cycle open so a reseat could pick the checkpoint up; a settled row has nothing left to
 * reseat. `orphaned` would say a session died, which nobody measured. The SETTLEMENT is a witnessed judgement
 * about the work, so the ending is the one `./consistency.ts` agrees with for the status it derives: `finished`
 * under a `done` row (`answered`, `filed`), `abandoned` under a `rejected` one (`declined`) — the opposite of
 * either reads as a fresh contradiction.
 *
 * @param settlement how the row was just settled
 * @param witness the settlement's witness, carried into a decline's reason
 * @param reason the decline's own reason, when one was given
 * @param atIso the instant the ending is written at
 * @returns the event to append
 */
export function releasedCycleEnding({
  settlement,
  witness,
  reason,
  atIso,
}: {
  settlement: AskSettlement;
  witness: string;
  reason: string | undefined;
  atIso: string;
}): Extract<RunEvent, { kind: "finished" | "abandoned" }> {
  if (settlement !== "declined") {
    return { atIso, kind: "finished", residue: [] };
  }
  const why = reason === undefined ? "" : ` — ${reason}`;
  return { atIso, kind: "abandoned", why: `the row was settled declined (witness: ${witness})${why}` };
}

/** The released cycle a settle decided to end, as it stood at the read the decision came from. */
export interface ReleasedCycle {
  readonly releasedBy: string;
  readonly releasedAtIso: string;
  /** Every decoded event in the JOURNAL then, not the cycle's — any append at all moves it. */
  readonly journalEvents: number;
}

/**
 * The released cycle in `events`, or `undefined` when its run is held, unowned, or ended.
 *
 * @param events the journal's decoded events, in order
 * @returns who released it, when, and how many events the whole journal held then
 */
export function releasedCycleOf({ events }: { events: readonly RunEvent[] }): ReleasedCycle | undefined {
  const ownership = runOwnership({ events, sessionId: undefined });
  if (ownership.kind !== "released" || runStateOf({ events }).phase === "closed") {
    return undefined;
  }
  return {
    journalEvents: events.length,
    releasedAtIso: ownership.releasedAtIso,
    releasedBy: ownership.writer.sessionId,
  };
}

/**
 * Why a decided {@link ReleasedCycle} no longer describes the journal — judged inside `applyRowEvent`, over the
 * read its own transition checks use, exactly as `./staleHolder.ts` judges a reap.
 *
 * A claim or resume landing after the decision makes the cycle somebody's again, and an ending written over it
 * would close a live run. The COUNT catches a release, claim and re-release by the same session. It
 * counts the whole journal rather than the cycle: a claim, a fresh `started` and a re-park at the same instant
 * rebuild a cycle of the same length, the same holder and the same release time, while the claim sits in front
 * of it. Settle reads only after writing its own settlement, so nothing it writes lands in between.
 *
 * @param decided the cycle as the settle saw it
 * @param events the journal as the append is about to see it
 * @param unreadable its undecodable line numbers — any of them could be the claim this would close over
 * @returns the refusal, or `undefined` when the cycle is still the released one decided about
 */
export function releasedCycleMoved({
  decided,
  events,
  unreadable,
}: {
  decided: ReleasedCycle;
  events: readonly RunEvent[];
  unreadable: readonly number[];
}): string | undefined {
  if (unreadable.length > 0) {
    return `the journal has undecodable line(s) ${unreadable.join(", ")}, so whether anyone claimed the run cannot be checked`;
  }
  const now = releasedCycleOf({ events });
  if (now === undefined) {
    return "the run is no longer released and open — somebody claimed or ended it since settle looked";
  }
  if (now.releasedBy !== decided.releasedBy || now.releasedAtIso !== decided.releasedAtIso) {
    return `the run was released again since (by ${now.releasedBy} at ${now.releasedAtIso}); settle decided about an earlier release`;
  }
  if (now.journalEvents !== decided.journalEvents) {
    return `the journal now holds ${String(now.journalEvents)} event(s), not the ${String(decided.journalEvents)} settle decided over`;
  }
  return undefined;
}

/**
 * What `settle` prints when it ended a cycle nobody held.
 *
 * @param slug the row that was just settled
 * @param ending the kind it appended
 * @param releasedBy the session that parked or released the cycle
 * @param releasedAtIso when it did
 * @returns the lines, naming the event written and why no holder could
 */
export function settleReleasedLines({
  slug,
  ending,
  releasedBy,
  releasedAtIso,
}: {
  slug: string;
  ending: "finished" | "abandoned";
  releasedBy: string;
  releasedAtIso: string;
}): readonly string[] {
  return [
    `  The RUN for ${slug} was parked or released by session ${releasedBy} at ${releasedAtIso} and nobody holds`,
    `  it, so no session could follow a NEXT line — settle appended the \`${ending}\` ending this settlement`,
    "  implies. Nothing is left to reseat.",
  ];
}

/**
 * Why a second `settle` on the same row is refused, in words that cannot be read as the run's own `answered`
 * event.
 *
 * A settlement is written once, so the second call reaches a row that already carries one — and the old
 * refusal, `<slug> is already answered`, is the exact sentence a session gets when it has just run
 * `handover answer` on the same slug for an unrelated reason. Naming the field, the witness and the run's
 * separate ending is what makes the two distinguishable at the only place they ever collide.
 *
 * @param doc the row `settle` was pointed at, already carrying a `settlement:`
 * @returns the refusal lines, or `undefined` when the row is unsettled and may be settled now
 */
export function alreadySettledRefusalLines({ doc }: { doc: HandoverDoc }): readonly string[] | undefined {
  const settlement = doc.settlement;
  if (settlement === undefined) {
    return undefined;
  }
  return [
    `${doc.slug} already carries \`settlement: ${settlement}\` (witness: ${absentAs({ value: doc.settlementWitness, whenAbsent: "none recorded" })})`,
    "  — a settlement is written once, and this is the ASK ROW's settlement, not the run's `answered` event.",
    `  The RUN is a separate ending that the first settle may already have closed — \`slopweaver handover resume ${doc.slug}\` shows whether it is still open.`,
  ];
}
