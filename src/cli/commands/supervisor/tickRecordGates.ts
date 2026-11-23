/**
 * The seven gates every tick record runs over one tick — `supervisor tick-record` and the chair's `supervisor tick
 * close` alike — and the refusal each one prints.
 *
 * Split out of `./tickRecordRun.ts` so the recorder is the I/O and this is the decision: every function
 * here takes documents the shell has ALREADY read, once. That is load-bearing, not tidiness. The recorder
 * used to read each document a second time inside each gate, and with `--reconcile -` the second read of a
 * consumed stdin returned nothing, the gate took its "cannot read" guard, and the tick was recorded as if
 * both gates had passed (`src/__tests__/unit/cli/commands/supervisor/tickRecord/idleCapacityGate.test.ts` pins it
 * with a one-shot stdin).
 *
 * The seven predicates live beside their subjects — `../../../supervisor/voiceUnreadGate.ts` (a word the owner spoke on
 * a call the chair never read), `../../../supervisor/unpickedSteerGate.ts` (a steer the owner spoke over a Queue card that
 * no pass acted on), `../../../supervisor/approvedDraftGate.ts` (a draft the owner approved that no pass sent),
 * `../../../supervisor/outcomes/sweepGate.ts` (an outcome of the owner's left uncovered),
 * `../../../supervisor/loadDispatchGate.ts` (a hold nobody investigated) and `../../../supervisor/idleCapacityGate.ts`
 * (a free machine and a ready doc or ask nobody is on) and `../../../supervisor/recipeFailureGate.ts` (a broken
 * automation's finding nobody is on, whatever the machine says). The voice, steer, approved-draft and
 * recipe-failure refusals' text is `./tickRecordVoice.ts`, `./tickRecordSteers.ts`, `./tickRecordApprovedDrafts.ts`
 * and `./tickRecordRecipeFailures.ts`. Each has its OWN hatch, so
 * opening one can never open another, and EVERY refusing gate prints at once, so a chair fixes the whole draft in
 * one re-draft instead of meeting the refusals one at a time.
 */
import { ceilingLines } from "../../../capacity/ceilingsRender.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import type { CapacityObligation } from "../../../plans/laneShape.js";
import type { ApprovedDraftRead } from "../../../supervisor/approvedDraftGate.js";
import { type IdleCapacityVerdict, judgeIdleCapacity } from "../../../supervisor/idleCapacityGate.js";
import { judgeLoadDispatch, type LoadDispatchVerdict } from "../../../supervisor/loadDispatchGate.js";
import { ALL_OUTCOMES, judgeSweep, type SweepVerdict } from "../../../supervisor/outcomes/sweepGate.js";
import type { UnpickedSteerRead } from "../../../supervisor/unpickedSteerGate.js";
import type { VoiceUnreadVerdict } from "../../../supervisor/voiceUnreadGate.js";
import { approvedDraftRefusal } from "./tickRecordApprovedDrafts.js";
import type { SupervisorTickDraft } from "./tickRecordCore.js";
import { recipeFailureRefusal } from "./tickRecordRecipeFailures.js";
import { steerRefusal } from "./tickRecordSteers.js";
import { voiceRefusalLines } from "./tickRecordVoice.js";

/** Which gate hatches the shell found open — one flag per gate, never one combined flag. */
export interface OpenHatches {
  readonly voice: boolean;
  readonly steers: boolean;
  readonly approvedDrafts: boolean;
  readonly sweep: boolean;
  readonly load: boolean;
  readonly idle: boolean;
  readonly recipeFailures: boolean;
}

/** How many unanswered rows the idle refusal prints before it counts the rest. */
export const IDLE_ROWS_SHOWN = 25;

/**
 * Render the sweep gate's refusal in the owner's own four-line shape, naming every outcome left unanswered.
 *
 * @param outcomes the refused verdict, carrying the outcomes the gate found unanswered
 * @returns the refusal's lines, the hatch's four plus one per outcome and the two ways out
 */
function sweepRefusalLines({ outcomes }: { outcomes: SweepVerdict & { kind: "refused" } }): readonly string[] {
  const named = outcomes.outcomes.map(
    (outcome) =>
      `  ${outcome.id} — ${outcome.title} (the owner's words:${outcome.anchor}); ${String(outcome.unspawned)} ready row(s) unspawned, first is ${outcome.firstRow}`,
  );
  return [
    ...hatchRefusalLines({
      detail: `${String(outcomes.outcomes.length)} outcome(s) were left with nobody on them`,
      hatch: hatchFor({ id: "uncovered-outcome" }),
    }),
    ...named,
    `Either \`slopweaver cmux spawn <slug> --model <model>\` one of those rows and re-run this, or record a ` +
      `hold-rationale judgement whose subject is {"kind":"outcome","id":"<outcome id>"} — or "${ALL_OUTCOMES}" ` +
      "for every one of them — saying why the fleet left it alone this tick.",
  ];
}

/**
 * Run the sweep gate, returning the lines to print when it refuses.
 *
 * @param draft the parsed draft
 * @param reconciliation the reconciliation document, already read
 * @returns the refusal's lines, or `undefined` when the tick may be recorded
 */
function sweepRefusal({
  draft,
  reconciliation,
}: {
  draft: SupervisorTickDraft;
  reconciliation: unknown;
}): readonly string[] | undefined {
  const verdict = judgeSweep({
    actions: draft.actions,
    judgements: draft.judgements,
    reconciliation,
    sources: draft.sources,
  });
  if (verdict.kind === "clean") {
    return undefined;
  }
  if (verdict.kind === "unreadable") {
    return [
      `supervisor tick-record: the sweep gate could not judge this tick — ${verdict.why}.`,
      "It refuses rather than passing, because a check that reports clean on an input it never saw is worse than no check.",
    ];
  }
  return sweepRefusalLines({ outcomes: verdict });
}

/**
 * Render the load-dispatch gate's refusal, naming the hold and both ways past it.
 *
 * @param verdict the refused verdict, carrying which subjects held and the load behind them
 * @returns the refusal's lines — the hatch's four, then the two ways out
 */
function loadRefusalLines({ verdict }: { verdict: LoadDispatchVerdict & { kind: "refused" } }): readonly string[] {
  const subjects = verdict.holdSubjects.length === 0 ? "the machine" : verdict.holdSubjects.join(" and ");
  return [
    ...hatchRefusalLines({
      detail: `this tick read a HOLD on ${subjects} at 1-minute load ${verdict.load1.toFixed(2)} and dispatched nothing into it`,
      hatch: hatchFor({ id: "undispatched-load" }),
    }),
    "Either run `slopweaver machine watch --once` — it takes a reading, writes a finding row if the anomaly " +
      "is real and exits clean if it is not — and re-capture `slopweaver machine capacity --json`, or record " +
      'a hold-rationale judgement whose subject is {"kind":"machine",…} saying why this tick is leaving the ' +
      "hold alone.",
    "Only a SEATED investigation clears this: if that watch reports no seat — the backoff still in force, " +
      "or a `cmux spawn` that failed — it has written the row but answered nothing, so narrate that " +
      "reason rather than running it again.",
  ];
}

/**
 * Run the load-dispatch gate, returning the lines to print when it refuses.
 *
 * @param draft the parsed draft
 * @returns the refusal's lines, or `undefined` when the tick may be recorded
 */
function loadRefusal({ draft }: { draft: SupervisorTickDraft }): readonly string[] | undefined {
  const verdict = judgeLoadDispatch({ judgements: draft.judgements, sources: draft.sources });
  if (verdict.kind === "clean") {
    return undefined;
  }
  if (verdict.kind === "unreadable") {
    // This arm returns BEFORE the gate reads `dispatchCovering` or the judgements, so neither escape the
    // refused arm offers can clear it — review pass r1 `no-supervisor-wedge` walked a pre-291-27 capture
    // running `machine watch --once` and then recording a machine hold-rationale, and being refused
    // identically by both. So it names the escape that DOES work, and its hatch, rather than leaving an
    // agent to infer either.
    return [
      ...hatchRefusalLines({
        detail: `the load-dispatch gate could not judge this tick — ${verdict.why}`,
        hatch: hatchFor({ id: "undispatched-load" }),
      }),
      "Re-capture `slopweaver machine capacity --json` into this tick's capacity file and re-draft: that " +
        "one document carries both the `hold` and the `dispatchCovering` count this gate could not read. " +
        "Neither `machine watch --once` nor a hold-rationale answers THIS arm — the gate refuses before it " +
        "reaches either — because a check that reports clean on an input it never saw is worse than no check.",
    ];
  }
  return loadRefusalLines({ verdict });
}

/**
 * Render the idle-capacity gate's refusal: every unanswered row, up to {@link IDLE_ROWS_SHOWN}, and the three
 * ways past each one.
 *
 * @param verdict the refused verdict
 * @returns the hatch's four lines, the ceilings reading when the tick carried one, one line per shown row, the
 *   overflow line when any, the ways out — naming the binding ceiling a reason must carry — and the
 *   workspace-spawn line when any spawn named a workspace rather than a row
 */
export function idleRefusalLines({
  verdict,
}: {
  verdict: IdleCapacityVerdict & { kind: "refused" };
}): readonly string[] {
  const shown = verdict.rows.slice(0, IDLE_ROWS_SHOWN).map((row) => `  ${row.priority} ${row.id}`);
  const rest = verdict.rows.length - shown.length;
  const overflow =
    rest > 0
      ? [
          `  … and ${String(rest)} more — list them with \`slopweaver handover reconcile --json | jq -r '.ready[] | ` +
            `select((.kind == "doc" or .kind == "ask") and .groomed and (.priority == "p0" or .priority == "p1" or .priority == "p2")) | .id'\`, ` +
            "less any a seat is already on",
        ]
      : [];
  const workspaceLine =
    verdict.workspaceSpawns > 0
      ? [
          `${String(verdict.workspaceSpawns)} spawned action(s) name a workspace ({"kind":"session"}) rather than a row, ` +
            'so they answer no row here — re-record each with subject {"kind":"handover","id":"<slug>"} and the ' +
            "workspace in its label.",
        ]
      : [];
  const { freeDetail, reasonShape, fillLines } = idleShapeOf({ verdict });
  const ceilings = verdict.ceilings === null ? [] : ceilingLines({ reading: verdict.ceilings });
  return [
    ...hatchRefusalLines({
      detail:
        `${freeDetail} and left ${String(verdict.rows.length)} groomed ready p0–p2 doc or ask row(s) with no seat, no spawn ` +
        "and no reason",
      hatch: hatchFor({ id: "idle-capacity" }),
    }),
    ...fillLines,
    ...ceilings,
    ...shown,
    ...overflow,
    "For EACH row, one of: `slopweaver cmux spawn <slug> --model <model>`, recorded as a `spawned` action whose " +
      'subject is {"kind":"handover","id":"<slug>"}; take it off RUN NOW (`slopweaver handover pause <slug> --on ' +
      "<who>`, or close it) and re-run `slopweaver handover reconcile --json` into this tick's --reconcile; or " +
      `${reasonShape}. A \`role: supervisor\` row is NAMED, never spawned.`,
    ...workspaceLine,
  ];
}

/**
 * What freed the capacity, the reason shape that answers a row, and the seat-ceiling lines, for one refusal:
 * the machine-only arm, the ceilings arm (naming the binding ceiling), or the measured-seat arm (naming the
 * machine) — or, when N could not be measured, the line saying so.
 */
function idleShapeOf({ verdict }: { verdict: IdleCapacityVerdict & { kind: "refused" } }): {
  readonly freeDetail: string;
  readonly reasonShape: string;
  readonly fillLines: readonly string[];
} {
  const binding = verdict.bindingCeilingId;
  let freeDetail = `this tick read NO hold (1-minute load ${verdict.load1.toFixed(2)})`;
  let reasonShape =
    'a hold-rationale judgement whose subject is {"kind":"handover","id":"<slug>"} saying why this tick left it';
  if (binding !== null) {
    freeDetail = `this tick read headroom on every ceiling of a route, the lowest ${binding}`;
    reasonShape =
      'a hold-rationale judgement whose subject is {"kind":"handover","id":"<slug>"} AND whose relatedSubjects ' +
      `carries {"kind":"ceiling","id":"${binding}","label":"<why that ceiling does not take this row>"} — a reason ` +
      "naming only the row, or only the ceiling, answers nothing";
  }
  const { workingSeats, workingSeatCeiling, seatsOwed } = verdict;
  let fillLines: readonly string[] = [];
  if (workingSeats !== null && workingSeatCeiling !== null && seatsOwed !== null) {
    freeDetail =
      `this tick read ${String(workingSeats)} working seat(s) against a measured ceiling of ` +
      `${String(workingSeatCeiling)} (\`slopweaver fleet ceiling\`), so the first ${String(seatsOwed)} ready ` +
      "row(s) each needed a spawn or to leave RUN NOW,";
    reasonShape =
      'a hold-rationale judgement whose subject is {"kind":"handover","id":"<slug>"} AND whose relatedSubjects ' +
      'carries {"kind":"ceiling","id":"machine","label":"<what held the machine>"} — the only ceiling that answers ' +
      "here";
    fillLines = [
      "A hold-rationale naming a Claude ceiling cannot answer this arm: below the measured seat ceiling the plans " +
        "are not what binds. A spawn of a lower row does not answer a higher one.",
    ];
  }
  if (verdict.ceilingMeasurementProblem !== null) {
    fillLines = [
      `The working-seat ceiling was not measured (${verdict.ceilingMeasurementProblem}), so every ready row is ` +
        "owed as before and this tick cannot claim it filled to a number.",
    ];
  }
  return { fillLines, freeDetail, reasonShape };
}

/**
 * Run the idle-capacity gate, returning the lines to print when it refuses.
 *
 * @param draft the parsed draft
 * @param reconciliation the reconciliation document, already read
 * @returns the refusal's lines, or `undefined` when the tick may be recorded
 */
function idleRefusal({
  draft,
  reconciliation,
}: {
  draft: SupervisorTickDraft;
  reconciliation: unknown;
}): readonly string[] | undefined {
  const verdict = judgeIdleCapacity({
    actions: draft.actions,
    judgements: draft.judgements,
    reconciliation,
    sources: draft.sources,
  });
  if (verdict.kind === "clean") {
    return undefined;
  }
  if (verdict.kind === "unreadable") {
    return [
      ...hatchRefusalLines({
        detail: `the idle-capacity gate could not judge this tick — ${verdict.why}`,
        hatch: hatchFor({ id: "idle-capacity" }),
      }),
      "Re-capture `slopweaver machine capacity --json` (and `slopweaver fleet ceiling --json` with " +
        "`slopweaver session watch --json-report` when the draft carries a seat ceiling) and re-run " +
        "`slopweaver handover reconcile --json` with this checkout, then re-draft. Neither a spawn nor a hold-rationale answers THIS arm — the gate refuses " +
        "before it reads either.",
    ];
  }
  return idleRefusalLines({ verdict });
}

/**
 * Run every tick-record gate whose hatch is closed over one already-read draft and reconciliation.
 *
 * @param draft the parsed draft
 * @param reconciliation the reconciliation document, read once by the shell
 * @param voice the unread-voice verdict, judged over the call files the shell read once
 * @param steers the steers the owner spoke over Queue cards, read once by the shell and judged here against the draft's own
 *   start, so both recording paths share one deadline
 * @param approvedDrafts the Slack draft register, read once by the shell and judged here against the draft's own start
 * @param open which gate hatches the shell found open
 * @param capacity whether filling idle capacity is still owed (`../../../plans/laneShape.ts`); the idle gate is not
 *   asked when no lane is filling, because then an unseated ready row is the saving, not a hole
 * @returns one refusal block per refusing gate, in gate order (voice, steers, approved drafts, sweep, load, idle,
 *   recipe failures); empty when the tick may be recorded
 */
export function tickRecordRefusals({
  draft,
  reconciliation,
  voice,
  steers,
  approvedDrafts,
  open,
  capacity,
}: {
  draft: SupervisorTickDraft;
  reconciliation: unknown;
  voice: VoiceUnreadVerdict;
  steers: UnpickedSteerRead;
  approvedDrafts: ApprovedDraftRead;
  open: OpenHatches;
  capacity: CapacityObligation;
}): readonly (readonly string[])[] {
  const unread = open.voice || voice.kind === "clean" ? undefined : voiceRefusalLines({ verdict: voice });
  const { startedIso } = draft;
  const unpicked = steerRefusal({ hatchIsOpen: open.steers, read: steers, startedIso });
  const approved = approvedDraftRefusal({ hatchIsOpen: open.approvedDrafts, read: approvedDrafts, startedIso });
  const sweep = open.sweep ? undefined : sweepRefusal({ draft, reconciliation });
  const load = open.load ? undefined : loadRefusal({ draft });
  const idle = open.idle || capacity.kind === "not-owed" ? undefined : idleRefusal({ draft, reconciliation });
  const unseated = open.recipeFailures ? undefined : recipeFailureRefusal({ draft, reconciliation });
  return [unread, unpicked, approved, sweep, load, idle, unseated].filter((block) => block !== undefined);
}
