/**
 * A board row's state, DERIVED from its one register instead of read off a second copy in its front-matter.
 *
 * The rule: state is derived, and the second copy is deleted.
 *
 * ## The defect, stated as what it actually is
 *
 * It is not "the board is stale". `../handover/boardEvidence.ts` already places a settled ask in `DONE`
 * regardless of `status:`, so `handover list` reads those rows correctly. The defect is that **two readers of
 * one row give different answers**: every cheaper reader filters on the `status:` LINE — `../reflect/board.ts`'s
 * `liveDocs`, `../sessions/closeDone.ts`, `../cli/commands/cmux/spawnPreflight.ts`, `../measurement/workstream.ts`
 * — and that line was never written by anything.
 *
 * MEASURED on the live board, and the growth is the argument: **60 settled asks read `status: ready`** (25 a
 * day earlier), out of 249 settled rows in 1,431. Reproduce with
 * `grep -l '^settlement:' ~/.slopweaver/handovers/*.md | xargs grep -l '^status: ready' | wc -l`. The
 * fallback below is what carries the other side of the same board: **422 of those 1,431 rows have no journal
 * at all**, so a derivation that only read events would take every one of them off it.
 *
 * The row this module was built for is its own witness. `board-state-cannot-be-forgotten` was settled by
 * running exactly the verb its own "How this ends" specified, and came out of that carrying
 * `settlement: answered` beside `status: ready` — the defect produced by correctly following the documented
 * procedure on the row that documented it. That `status: ready` was deliberately left standing: hand-splicing
 * it to `done` is the unguarded edit this work removes, so it is closed by the derivation rather than by an
 * edit.
 *
 * ## The safety property, which is what makes this landable on 1,319 live rows with no migration
 *
 * **The derivation is MONOTONE toward terminal.** A row's authored `status:` is still the answer wherever the
 * register is silent, so every row reads exactly as it does today unless the journal carries an ending the
 * front-matter never got. It can move a row from live to terminal; it can never move one from terminal back
 * to live. That is why no row on disk has to be rewritten for this to be correct, why the 422 journal-less
 * rows are the ordinary case rather than a migration, and why a journal with an unreadable line degrades to
 * today's answer rather than to a wrong one.
 *
 * The authored line therefore stops being STATE and becomes what it always was in practice: the row's
 * declared intent, changed deliberately by a human, with everything that happens afterwards recorded as an
 * event. Deleting the lines themselves is the migration step, and it belongs with the store decision, which is made before a database schema is built.
 *
 * ## What this reads from where, today
 *
 * `status:` and `statusSummary:` are DERIVED — nothing has ever written them, which is why they were two of
 * the four fields with no writer at all. `artifact:` is derived event-first, because the `artifact` event is
 * the only recorded value in this register a later one may CORRECT rather than only extend. `ruling:` is
 * derived event-first too — by DECISION time rather than append
 * order, which is the one place it differs from `artifact`, and `./ruling.ts` says why. `settlement:` is
 * still read off front-matter: `handover settle` writes it there, and moving that write into the register
 * means migrating six more readers (`./askRow.ts`, `./settleEnding.ts`, `./findingGate.ts`,
 * `../supervisor/intake.ts` among them) — a change with its own blast radius that belongs beside the store
 * decision, not stapled to this one. Reading it HERE is still the fix that matters: it is what lets a settled
 * row read `done` on every surface without anybody editing the line that says `ready`.
 *
 * Pure: takes an already-parsed doc and an already-read journal. No filesystem, no clock.
 */

import type { DocStatus, HandoverDoc } from "./doc.js";
import { rulingsSinceLatestAsk } from "./heldQuestion.js";
import { currentCycle, type RunEvent } from "./ledger.js";
import type { AskSettlement } from "./rowKind.js";
import {
  latestFindingRuling,
  latestRuling,
  type RulingEvidence,
  type RulingIdentity,
  rulingIdentityOf,
} from "./ruling.js";

/** One row's state as the register gives it, with every value's provenance attached. */
export interface DerivedRowState {
  /** What `status:` would say if it were derived — the answer every reader should use instead of the line. */
  readonly status: DocStatus;
  /** The one-line summary of where the row got to, from the closing event when there was one. */
  readonly statusSummary: string | undefined;
  readonly settlement: AskSettlement | undefined;
  readonly settlementWitness: string | undefined;
  readonly settlementReason: string | undefined;
  /** Where the row's answer was published — the LAST `artifact` event wins, superseding every earlier one. */
  readonly artifact: string | undefined;
  /**
   * What the owner decided about this row — the LATEST decision, whatever recorded it.
   *
   * The front-matter pair is the fallback, exactly as `status:` is, so the 90 rows `handover rule` wrote
   * before the event kind existed read unchanged. `./ruling.ts`'s `latestRuling` says why decision time
   * rather than append order decides which one is current, and why that differs from `artifact`.
   */
  readonly ruling: RulingEvidence | undefined;
  /**
   * Every ruling the journal holds, each dated by its decision instant, in journal order. {@link ruling} is the
   * latest; when a row left the owner's Queue is the EARLIEST one answering its ask, so a correcting ruling after it never
   * re-dates the removal (`ruledBeforeSettleIso` publishes it).
   */
  readonly datedRulings: readonly RulingIdentity[];
  /**
   * The journal's latest question — when it was asked, and the rulings that could answer it, which are those
   * journalled after its latest restatement when one restated it — absent when the journal never asked one
   * (`./heldQuestion.ts`, `rulingsSinceLatestAsk`).
   */
  readonly latestAsk?: { readonly askedIso: string; readonly rulings: readonly RulingIdentity[] };
  /**
   * What a TEAM-FACING door may act on — the latest ruling recorded because the owner ruled on this finding.
   *
   * Deliberately not {@link DerivedRowState.ruling}. A backfilled ruling is a true record of a decision and
   * is not an answer to the question `../handover/findingGate.ts` asks, so reading one field for both would
   * let a migration open a door the owner never opened — and would let a reconstruction with a later decision
   * instant CLOSE one the owner did.
   */
  readonly findingRuling: RulingEvidence | undefined;
  /**
   * Which fields came from a journal EVENT rather than from a front-matter line — `artifact` and `ruling`.
   *
   * Not decoration: a derivation that silently agreed with the authored line in every case would report clean
   * while doing nothing, so this is the falsifiable witness this module's tests assert on.
   */
  readonly fromRegister: readonly string[];
  /**
   * What decided {@link DerivedRowState.status} — the answer to "why does this row read terminal when its own
   * file says `ready`", which is the question the 60 measured rows made someone ask.
   */
  readonly statusFrom: "settlement" | "closed-event" | "abandoned-event" | "authored";
}

/**
 * The terminal that speaks about the WORK, and the two scopes are different on purpose.
 *
 * `closed` is a ROW terminal, so it is looked for across the WHOLE journal: the case it exists for is a row
 * whose probes already pass and which nobody ever opened a run on — `handover list`'s `LOOKS SHIPPED`
 * section, 392 rows of which had no journal at all — and `currentCycle` on such a row is EMPTY, so a
 * cycle-scoped read would have ignored the one event recording that it shipped.
 *
 * `abandoned` is a CYCLE terminal, read only from the last `started`, because giving up is a judgement a
 * session makes about the cycle it is in: a row abandoned in July and restarted in September is not
 * abandoned. That is the same scope `../handover/boardTypes.ts`'s `runDisposition` uses.
 *
 * `orphaned` is deliberately absent from both — it says the SESSION died, never that the work stopped, so a
 * reaped row stays exactly as runnable as it was.
 */
function terminalOf({
  events,
}: {
  events: readonly RunEvent[];
}):
  | { readonly kind: "closed"; readonly summary: string }
  | { readonly kind: "abandoned"; readonly why: string }
  | undefined {
  const shipped = events.filter((event) => event.kind === "closed");
  const last = shipped[shipped.length - 1];
  if (last !== undefined) {
    return { kind: "closed", summary: last.summary };
  }
  let terminal: { readonly kind: "abandoned"; readonly why: string } | undefined;
  for (const event of currentCycle({ events })) {
    if (event.kind === "abandoned") {
      terminal = { kind: "abandoned", why: event.why };
    }
  }
  return terminal;
}

/** The status a settlement implies: an ask actioned is `done`, an ask the owner talked away is `rejected`. */
function statusOfSettlement({ settlement }: { settlement: AskSettlement }): DocStatus {
  return settlement === "declined" ? "rejected" : "done";
}

/**
 * Derive one row's state from its register, falling back to its authored front-matter wherever the register
 * is silent.
 *
 * The precedence, and every step is a case the board measured:
 *
 * 1. **A settlement** — the row-level terminal. `filed`/`answered` are `done` because the owner's ask WAS actioned,
 *    which is the number the register exists to report; `declined` is `rejected` because an ask talked away
 *    and an ask actioned must never be counted together.
 * 2. **A `closed` event**, anywhere in the journal — the work shipped, said by the verb that knew it.
 * 3. **An `abandoned` event** in the current cycle — a session considered the work and gave it up.
 * 4. **The authored `status:` line** — the row's declared intent, and still the answer for the 392 rows with
 *    no journal at all and every row nobody has closed yet.
 *
 * `orphaned` appears nowhere above, on purpose: it is a statement about a dead SESSION and carries no
 * judgement about the work, so a reaped row stays exactly as runnable as it was. The two scopes in step 2
 * and step 3 are not a slip — {@link terminalOf} says why each is what it is.
 *
 * @param doc the row as its front-matter declares it
 * @param events its journal's events, in order — an empty list is the no-journal case, not an error
 * @returns the derived state, with `fromRegister` naming every field the journal decided
 */
export function derivedRowState({ doc, events }: { doc: HandoverDoc; events: readonly RunEvent[] }): DerivedRowState {
  const terminal = terminalOf({ events });
  const published = events.filter((event) => event.kind === "artifact");
  const lastArtifact = published[published.length - 1];
  const ruling = latestRuling({ doc, events });
  const latestAsk = rulingsSinceLatestAsk({ events });

  const fromRegister = [
    ...(lastArtifact === undefined ? [] : ["artifact"]),
    // Named only when an EVENT decided it. A ruling read off the front-matter pair is the fallback, and
    // claiming the register decided it would make this witness agree with itself while doing nothing.
    ...(ruling?.from === "register" ? ["ruling"] : []),
  ];

  const base = {
    artifact: lastArtifact === undefined ? doc.artifact : lastArtifact.url,
    datedRulings: events.flatMap((event) => (event.kind === "ruling" ? [rulingIdentityOf({ event })] : [])),
    findingRuling: latestFindingRuling({ doc, events }),
    fromRegister,
    ruling,
    settlement: doc.settlement,
    settlementReason: doc.settlementReason,
    settlementWitness: doc.settlementWitness,
    ...(latestAsk === undefined ? {} : { latestAsk }),
  };

  if (doc.settlement !== undefined) {
    return {
      ...base,
      status: statusOfSettlement({ settlement: doc.settlement }),
      statusFrom: "settlement",
      statusSummary: doc.statusSummary,
    };
  }
  if (terminal?.kind === "closed") {
    return { ...base, status: "done", statusFrom: "closed-event", statusSummary: terminal.summary };
  }
  if (terminal?.kind === "abandoned") {
    return { ...base, status: "cancelled", statusFrom: "abandoned-event", statusSummary: terminal.why };
  }
  return { ...base, status: doc.status, statusFrom: "authored", statusSummary: doc.statusSummary };
}

/**
 * The derived artifact a board row PUBLISHES, less the front matter's bare `artifact: null` "none yet" line,
 * which parses as that string — 6,118 live rows carry it. Only that placeholder is dropped, read
 * off its raw form: a quoted `"null"` or an `artifact` event reading `null` is a real record, so it publishes
 * and a Queue card refuses it by name.
 *
 * @param doc the row as parsed, which alone knows whether its line was the bare placeholder
 * @returns the address to publish, or `undefined` for a row with none
 */
export function publishedArtifactOf({
  derived,
  doc,
}: {
  derived: DerivedRowState;
  doc: HandoverDoc;
}): string | undefined {
  const placeholder = doc.artifactIsPlaceholder === true && !derived.fromRegister.includes("artifact");
  return placeholder ? undefined : derived.artifact;
}
