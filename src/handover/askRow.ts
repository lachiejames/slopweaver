/**
 * What makes an ASK row well-formed — the integrity rules behind the owner's ruling that a thing
 * they asked for lands on the board with a terminal state, in the same register as everything else.
 *
 * ## The defect this is guarding against is not a typo
 *
 * It is an agent closing one of the owner's asks by asserting that it is closed. The measured failure was the
 * opposite direction — asks that nothing ever registered — but a register whose rows can be settled on an
 * agent's own say-so fixes the visible half and leaves the expensive half, because a silently `answered` ask
 * reads exactly like an actioned one on every surface that counts them.
 *
 * So every settlement carries a WITNESS and the witness is what the rules below are about. `filed` names the
 * doc slug the ask became, and `../devLint/registerHygiene.ts`-style board reading can check that doc exists.
 * `answered` names the permalink the answer was posted at. `declined` — the one an agent may not decide —
 * names both a reason in the owner's own words and an anchor pointing at where they gave it.
 *
 * ## Why a decline is not enforced by checking WHO is calling
 *
 * Because nothing here authenticates a human. `.claude/rules/cross-session-messages.md` is unambiguous: the
 * wire carries no id to bind to, a user turn in a session is attributable rather than proof, and a gate
 * claiming to have verified the owner's hand would be a lie dressed as a control. What is enforceable is
 * that a decline is ATTRIBUTABLE and that an unanchored one is a defect the board prints — which is exactly
 * the property that stops an ask being talked away quietly.
 *
 * Pure: every rule reads an already-parsed doc. No filesystem, no clock.
 */

import { absentAs } from "#lib/absent.js";
import { slackTsFromPermalink, slackTsToIso } from "#lib/slackTs.js";
import { askShapeProblems, missingShapeFields, shapeCompleteness, stakesFrom } from "./askShape.js";
import type { DerivedRowState } from "./derivedRowState.js";
import type { HandoverDoc } from "./doc.js";
import { type AskSettlement, AUTHORED_ROW_KINDS, declineNeedsAnchor, ROW_ORIGINS } from "./rowKind.js";

/** The fields that only ever make sense on an ask row, with the name a refusal message uses for each. */
const ASK_ONLY_FIELDS: readonly { readonly name: string; readonly read: (doc: HandoverDoc) => unknown }[] = [
  { name: "askedIso", read: (doc) => doc.askedIso },
  { name: "settlement", read: (doc) => doc.settlement },
  { name: "settlementWitness", read: (doc) => doc.settlementWitness },
  { name: "settlementReason", read: (doc) => doc.settlementReason },
  { name: "origin", read: (doc) => doc.origin },
  { name: "observedBy", read: (doc) => doc.observedBy },
  { name: "evidence", read: (doc) => (doc.evidence.length === 0 ? undefined : doc.evidence) },
  { name: "ruling", read: (doc) => doc.ruling },
  { name: "rulingAnchor", read: (doc) => doc.rulingAnchor },
  { name: "bearsOn", read: (doc) => doc.bearsOn },
  { name: "problem", read: (doc) => doc.problem },
  { name: "options", read: (doc) => (doc.options.length === 0 ? undefined : doc.options) },
  { name: "lean", read: (doc) => doc.lean },
  { name: "examples", read: (doc) => (doc.examples.length === 0 ? undefined : doc.examples) },
  { name: "exampleGap", read: (doc) => doc.exampleGap },
  { name: "risk", read: (doc) => doc.risk },
  { name: "blastRadius", read: (doc) => doc.blastRadius },
  { name: "stillReal", read: (doc) => doc.stillReal },
  { name: "stillRealIso", read: (doc) => doc.stillRealIso },
];

/**
 * Where a `finding` row stands with the owner — the state the team-facing doors gate on.
 *
 * `not-a-finding` is every ask the owner made themselves: nothing to gate, because the ask IS their ruling.
 * `unruled` is a finding the owner has not yet seen or spoken on: if a session observes two watcher deaths and
 * registers them, a team-facing pull request must not go up carrying the owner's name before the owner knows
 * the row exists. `ruled` means the owner's words are on the row with an anchor. `declined` is settled against
 * the finding: the owner saw it and said no, so an outward action is refused exactly as firmly as an unruled
 * one.
 *
 * ## A BACKFILLED ruling is a record, never a permission
 *
 * A ruling is a register event, and one of those may be RECONSTRUCTED from an
 * `answered` event a session wrote about some other question. That is a true record of what the owner decided
 * and it is not what this gate asks: this gate asks whether the owner saw THIS finding and said what may reach
 * the team. So the answer is read off {@link DerivedRowState.findingRuling}, which skips reconstructions
 * whatever their decision instant — a backfill can therefore neither open a door the owner never opened nor
 * close one they did. No keyword inference anywhere: the distinction is a field on the line.
 *
 * @param doc the row to read
 * @param derived the row's state as `./derivedRowState.ts` derives it — the whole value, so this can never
 *   fall back to reading the document for a ruling the register already answered
 * @returns the state, never a boolean — a door prints WHICH state it refused on
 */
export function findingRulingState({
  doc,
  derived,
}: {
  doc: HandoverDoc;
  derived: DerivedRowState;
}): "not-a-finding" | "unruled" | "ruled" | "declined" {
  if (doc.origin !== "finding") {
    return "not-a-finding";
  }
  if (doc.settlement === "declined") {
    return "declined";
  }
  return derived.findingRuling === undefined ? "unruled" : "ruled";
}

/**
 * Every defect in how a row declares where it came from and whether the owner has ruled on it.
 *
 * A finding with no `observedBy` or no `evidence` is the exact row this feature exists to prevent — one
 * that reads as the owner's ask with nothing on it to say otherwise — so both are required, not advisory. A
 * ruling and its anchor come as a pair: words with nowhere to check them are a claim, an anchor with no words
 * says nothing about what the owner allowed.
 */
function findingProblems({
  doc,
  declaredOrigin,
}: {
  doc: HandoverDoc;
  declaredOrigin: string | undefined;
}): readonly string[] {
  const problems: string[] = [];
  if (declaredOrigin !== undefined && !ROW_ORIGINS.some((origin) => origin === declaredOrigin)) {
    problems.push(`origin: "${declaredOrigin}" is not an origin a row may declare — use ${ROW_ORIGINS.join(" or ")}`);
  }
  if (doc.origin === "finding") {
    if (doc.observedBy === undefined) {
      problems.push("a finding row declares no observedBy — which session saw it is what makes its origin checkable");
    }
    if (doc.evidence.length === 0) {
      problems.push("a finding row declares no evidence — what was observed is the whole reason the row exists");
    }
  } else if (doc.observedBy !== undefined || doc.evidence.length > 0 || doc.ruling !== undefined) {
    problems.push(
      "observedBy, evidence and ruling are only meaningful with `origin: finding` — declare it or remove them",
    );
  }
  if ((doc.ruling === undefined) !== (doc.rulingAnchor === undefined)) {
    problems.push("ruling and rulingAnchor come as a pair — the owner's words, and where they said them");
  }
  return problems;
}

/**
 * Every defect in how an ask row declares its SHAPE — the problem, the options and the lean.
 *
 * A recorded ask the owner has to parse is a defect. Two states are reported and a third is not:
 *
 * - **`partial`** is reported, because it is a row being written wrongly right now: a card cannot render two
 *   thirds of a shape without either inventing the third or looking like a shaped card that is merely short.
 * - **The caps** are reported off `../handover/askShape.ts`, the one place they live, so a row that got past
 *   the verb (a hand edit, an older build) is still visible on the board rather than only at the write.
 * - **`none` is NOT reported.** MEASURED over `slopweaver handover list --json`: 2,700 board
 *   rows, 43 holding an open recorded question, all 43 free text. Making their absence a defect would print
 *   43 problems about work nobody is doing and bury the ones about work somebody is. The queue drawer marks
 *   an unshaped ask where it is actually read instead.
 */
function shapeProblems({ doc }: { doc: HandoverDoc }): readonly string[] {
  const completeness = shapeCompleteness({ lean: doc.lean, options: doc.options, problem: doc.problem });
  const stakes = stakesFrom({ blastRadius: doc.blastRadius, risk: doc.risk, stillReal: doc.stillReal });
  // A row shaped before the stakes existed carries none, and that is the legacy arm rather than a defect —
  // the card says so where it draws them. Some of the three, or any without a shape beside them, is a row
  // being written wrongly right now.
  const noStakes = stakes.missing.length === ALL_STAKES;
  if (!noStakes && (stakes.stakes === undefined || completeness !== "whole")) {
    return [
      "this ask declares part of its stakes — risk, blastRadius and stillReal come together, and only beside " +
        "a whole shape, because a risk with no decision beside it describes nothing the owner can take",
    ];
  }
  if (stakes.stakes !== undefined && doc.stillRealIso === undefined) {
    return ["this ask states a still-real check with no stillRealIso — the card cannot say how old the check is"];
  }
  if (completeness === "none") {
    return [];
  }
  if (completeness === "partial") {
    const missing = missingShapeFields({ lean: doc.lean, options: doc.options, problem: doc.problem });
    return [
      `this ask declares part of a shape and is missing ${missing.join(", ")} — an ask carries the whole ` +
        "shape or none of it, because half a card is not a decision the owner can take",
    ];
  }
  if (doc.problem === undefined || doc.lean === undefined) {
    return [];
  }
  return askShapeProblems({
    shape: { lean: doc.lean, options: doc.options, problem: doc.problem, stakes: stakes.stakes },
  });
}

/** How many stakes fields there are — all three absent is the legacy arm, not a partial one. */
const ALL_STAKES = 3;

/** Whether a string parses as a real instant — the same question `askedIso` has to answer to be rankable. */
function isInstant({ value }: { value: string }): boolean {
  return !Number.isNaN(Date.parse(value));
}

/** How far `askedIso` may sit from the instant its anchor names before the row is reporting a made-up time. */
const ANCHOR_DRIFT_TOLERANCE_MS = 60_000;

/**
 * The one defect a well-formed instant can still carry: disagreeing with the message it claims to be from.
 *
 * `isInstant` above catches a typo and nothing else — the measured failure wrote an instant for
 * a Slack `ts` that parses perfectly and is 80 minutes wrong. Nothing on the board could tell,
 * because nothing compared the two halves of the row that were both about the same moment. This does: when
 * the anchor is a Slack permalink, the permalink CARRIES the `ts`, so the true instant is derivable and the
 * declared one is checkable against it. That is the whole gate — a row whose anchor is not a Slack link is
 * simply not checkable this way and is left alone rather than guessed at.
 *
 * The tolerance is a minute rather than zero because `askedIso` legitimately records when the owner SAID it while
 * the anchor may point at the message that captured it moments later, and because `slackTsToIso` floors to
 * whole seconds. Eighty minutes is not within a minute of anything.
 */
function anchorInstantProblems({ doc }: { doc: HandoverDoc }): readonly string[] {
  const anchor = doc.anchor;
  const askedIso = doc.askedIso;
  if (anchor === undefined || askedIso === undefined) {
    return [];
  }
  const ts = slackTsFromPermalink({ permalink: anchor });
  const anchorIso = ts === undefined ? undefined : slackTsToIso({ ts });
  const declaredMs = Date.parse(askedIso);
  if (anchorIso === undefined || Number.isNaN(declaredMs)) {
    return [];
  }
  const driftMs = Math.abs(declaredMs - Date.parse(anchorIso));
  if (driftMs <= ANCHOR_DRIFT_TOLERANCE_MS) {
    return [];
  }
  const driftMinutes = Math.round(driftMs / 60_000);
  return [
    `askedIso: "${askedIso}" is ${String(driftMinutes)} minute(s) from the instant its anchor names ` +
      `(${anchorIso}, from ts ${ts!}) — derive it with \`slopweaver slack when ${ts!}\` rather than by hand`,
  ];
}

/** Every defect in how an ask row declares its own terminal state. */
function settlementProblems({ doc }: { doc: HandoverDoc }): readonly string[] {
  const settlement = doc.settlement;
  if (settlement === undefined) {
    return [];
  }
  const problems: string[] = [];
  if (doc.settlementWitness === undefined) {
    problems.push(
      `settlement: ${settlement} declares no settlementWitness — a settled ask names the doc slug, the ` +
        "permalink or the anchor behind it, so nobody has to take a session's word for it",
    );
  }
  if (declineNeedsAnchor({ settlement }) && doc.settlementReason === undefined) {
    problems.push(
      "settlement: declined declares no settlementReason — only the owner declines an ask, and a decline " +
        "carries why, in the owner's words",
    );
  }
  return problems;
}

/**
 * Every defect in one row's ask-specific front-matter, empty for an ordinary doc row.
 *
 * `declaredKind` is the RAW value rather than the parsed one because `asRowKind` deliberately swallows an
 * unrecognised kind into `doc` — the safe direction for a typo, since the row stays on the board — and that
 * swallowing must still be reported. Without it, `kind: Ask` would silently produce a doc row and the ask
 * would drop, which is the exact class of silent loss this register exists to end.
 *
 * @param doc the parsed row
 * @param declaredKind the raw `kind:` value the front-matter carried, absent when it declared none
 * @param declaredOrigin the raw `origin:` value, absent when it declared none — same swallowing, same reason
 * @returns one sentence per defect, in the order they should print
 */
export function askRowProblems({
  doc,
  declaredKind,
  declaredOrigin,
}: {
  doc: HandoverDoc;
  declaredKind: string | undefined;
  declaredOrigin: string | undefined;
}): readonly string[] {
  const problems: string[] = [];
  if (declaredKind !== undefined && !AUTHORED_ROW_KINDS.some((kind) => kind === declaredKind)) {
    problems.push(`kind: "${declaredKind}" is not a kind a row may declare — use ${AUTHORED_ROW_KINDS.join(" or ")}`);
  }
  if (doc.kind !== "ask") {
    const misplaced = ASK_ONLY_FIELDS.filter((field) => field.read(doc) !== undefined).map((field) => field.name);
    if (misplaced.length > 0) {
      problems.push(
        `${misplaced.join(", ")} ${misplaced.length === 1 ? "is" : "are"} only meaningful on an ask row — ` +
          "declare `kind: ask` or remove them",
      );
    }
    return problems;
  }
  if (doc.askedIso === undefined) {
    problems.push("an ask row declares no askedIso — when the owner said it is what makes the delay measurable");
  } else if (!isInstant({ value: doc.askedIso })) {
    problems.push(`askedIso: "${doc.askedIso}" is not an instant`);
  }
  return [
    ...problems,
    ...anchorInstantProblems({ doc }),
    ...settlementProblems({ doc }),
    ...findingProblems({ declaredOrigin, doc }),
    ...shapeProblems({ doc }),
  ];
}

/**
 * Whether this row is an ask nobody has settled yet — the state the reconciliation counts and reports.
 *
 * @param doc the row to test
 * @returns true only for an ask row with no terminal state
 */
export function isOpenAsk({ doc }: { doc: HandoverDoc }): boolean {
  return doc.kind === "ask" && settledAskOf({ doc }) === undefined;
}

/**
 * THE settlement read. Every door and every ranking asks this rather than reading `settlement:` for itself.
 *
 * ## Why one function rather than four field reads
 *
 * MEASURED: a review-ask row was settled `answered`, so
 * `cmux spawn` refused it, while `handover reconcile` ranked it as the board's ONE starving row and its one
 * stale ask — because its run journal read `abandoned`, which put the row in `CONTRADICTION` rather than a
 * closed section, and reconcile ranks every section that is not closed. Two registers, two answers, and the
 * fill scan believed the one that said there was work. Reproduce on any board with
 * `slopweaver handover reconcile --json` against a row carrying `settlement:` and an abandoned journal.
 *
 * A run's ending says what happened to a CYCLE. A settlement says whether the ask was actioned. Only the
 * second decides whether there is work left, so it is the only one a ranking may consult — and it is read
 * here, once, in the shape both the refusal and the ranking take.
 *
 * @param doc the row to read
 * @returns its settlement and witness, or `undefined` for any row still open to work
 */
export function settledAskOf({
  doc,
}: {
  doc: HandoverDoc;
}): { readonly settlement: AskSettlement; readonly witness: string | undefined } | undefined {
  const settlement = doc.settlement;
  if (doc.kind !== "ask" || settlement === undefined) {
    return undefined;
  }
  return { settlement, witness: doc.settlementWitness };
}

/**
 * Why a settled ask must not be executed, or `undefined` for any row an execution door may open.
 *
 * ## Why this is derived rather than declared
 *
 * A settled ask keeps `status: ready` in its own front-matter, and that is deliberate rather than a gap
 * `settle` forgot to close. Whether an ask is terminal is decided by `settlement:`, so writing a terminal
 * `status:` beside it would be a second source of the same fact — the exact reasoning `./doc.ts` gives for
 * refusing to let a doc DECLARE `blocked` when `blockedBy:` already derives it, and the first time the two
 * disagreed nobody could say which was right. `settlement:` stays the one authority and every door asks it.
 *
 * ## The door that was open
 *
 * MEASURED: an engineering-card row was settled `answered` — its card was live and its pull request closed —
 * and was spawned again the next evening as a cmux workspace, which verified through the door and did nothing. `../cli/commands/cmux/run.ts` refused only
 * `isTerminalDocStatus(doc.status)` and `../cli/commands/handover/lifecycle.ts` only `blockerFor`, and
 * neither reads `settlement:` at all, so a row the BOARD had already placed under `DONE` was startable and
 * spawnable by name. The board was right and the doors were not asking it.
 *
 * @param doc the row an execution door was pointed at
 * @returns the sentence refusing it, or `undefined` when it may proceed
 */
export function settledAskRefusal({ doc }: { doc: HandoverDoc }): string | undefined {
  const settled = settledAskOf({ doc });
  if (settled === undefined) {
    return undefined;
  }
  const witness = absentAs({ value: settled.witness, whenAbsent: "no witness declared" });
  return (
    `${doc.slug} is an ask already settled ${settled.settlement} (witness: ${witness}) — ` +
    "a settled ask is not work to pick up; register a new row if there is more to do"
  );
}
