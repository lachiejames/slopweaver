/**
 * How `handover reconcile` reads for a person: the headline, the intake sentence, the ranked top band, then only the
 * findings that are not empty. Pure — the reconciliation in, lines out; `./reconcileRun.ts` prints them and keeps
 * `--json` beside the verb.
 *
 * By default each row is ONE line, its label cut to {@link ROW_LABEL_MAX_CHARS}, and each finding at most
 * {@link MAX_LINES_PER_FINDING} lines with the rest counted; `--full` prints every label whole and every finding
 * uncapped. MEASURED on one install: 9,539 characters over 27 lines, the longest 1,637, because a
 * board row's label is its whole summary (repro: `slopweaver handover reconcile` against `--full`).
 */
import { collapseWhitespace, fitOnOneLine } from "#lib/oneLineSummary.js";

import { type BoardRow } from "../../../handover/rank.js";
import { emptyBandLine, type Reconciliation } from "../../../handover/reconcile.js";
import { type IntakeReport, intakeClause, registerCommandFor } from "../../../supervisor/intake.js";
import { type OutcomeReport } from "../../../supervisor/outcomes/coverage.js";
import { typedRegisterCommandFor } from "../../../supervisor/typedIntake.js";
import { relayMarkCommand, type VoiceRelayIntake, voiceRelayClause } from "../../../talk/relayIntake.js";
import { type BoardHolds, heldLines } from "./reconcileRows.js";

/** Where the in-flight picture came from, so the report can say when it is the fallback. */
export type FleetSource = "cmux" | "open-runs";

/**
 * The most lines any one finding prints by default before it collapses to a count.
 *
 * Five. A reconciliation that printed one line per session became a fifteen-line wall on the live fleet the
 * day this landed, which is the shape doctrine rule 7 refuses — and the whole point of this verb is that its
 * output is short enough to be read every tick. `--full` and `--json` carry every row.
 */
const MAX_LINES_PER_FINDING = 5;

/** How many characters of a row's label its one default line carries. */
const ROW_LABEL_MAX_CHARS = 120;

/** A row's label as the read prints it: whole on one line under `--full`, else cut to fit. */
function labelText({ label, full }: { label: string; full: boolean }): string {
  if (full) {
    return collapseWhitespace({ text: label });
  }
  return fitOnOneLine({ maxChars: ROW_LABEL_MAX_CHARS, text: label });
}

/**
 * The line saying how many printed labels were cut, or none — a cut label's tail can carry the decision (a
 * "… OWNER SAID DO NOT START" can sit past the cut), so a cut is never silent.
 */
function cutLabelLines({ labels, full }: { labels: readonly string[]; full: boolean }): readonly string[] {
  const cut = labels.filter((label) => labelText({ full, label }) !== collapseWhitespace({ text: label })).length;
  if (cut === 0) {
    return [];
  }
  return [
    `(${String(cut)} label(s) above cut to ${String(ROW_LABEL_MAX_CHARS)} characters, ending in … — --full prints them whole)`,
  ];
}

/** At most {@link MAX_LINES_PER_FINDING} lines, then one saying how many were left out — every line under `--full`. */
function capped({ lines, full }: { lines: readonly string[]; full: boolean }): readonly string[] {
  const hidden = lines.length - MAX_LINES_PER_FINDING;
  if (full || hidden <= 0) {
    return lines;
  }
  return [
    ...lines.slice(0, MAX_LINES_PER_FINDING),
    `  … and ${String(hidden)} more (--full or --json for all of them)`,
  ];
}

/** One ranked row, as a line. */
function rowLine({ row, rank, full }: { row: BoardRow; rank: number; full: boolean }): string {
  const waiting = row.openedIso === undefined ? "" : `, waiting ${String(row.waitingHours)}h`;
  return `  ${String(rank).padStart(3)}. [${row.priority} ${row.kind}${waiting}] ${row.id} — ${labelText({ full, label: row.label })}`;
}

/**
 * One line per outcome the owner kept on their Workstreams register — the comparison the owner asked for, in register
 * order.
 *
 * Every outcome prints, including the covered ones, because a reader has to be able to tell "all of them are
 * attended" from "the report only lists problems and found none it knows how to look for". With none kept it says
 * so, and an entry left out for citing nothing checkable is named rather than dropped.
 */
function outcomeLines({ report, unanchored }: { report: OutcomeReport; unanchored: readonly string[] }): string[] {
  const heading =
    report.outcomes.length === 0
      ? "the owner's kept outcomes: none yet — one appears when the owner keeps a proposal on the Workstreams page"
      : `the owner's kept outcomes (${String(report.outcomes.length - report.uncovered.length)} of ` +
        `${String(report.outcomes.length)} have somebody on them):`;
  return [
    "",
    heading,
    ...unanchored.map((id) => `  UNANCHORED ${id} — its timeline cites nothing checkable, so coverage leaves it out`),
    ...report.outcomes.map(
      (outcome) =>
        `  ${outcome.live.length > 0 ? "on " : "NOBODY"} ${outcome.id} — ` +
        `${String(outcome.live.length)} live, ${String(outcome.unspawned.length)} ready row(s) unspawned ` +
        `of ${String(outcome.rows)}`,
    ),
  ];
}

/**
 * The whole intake sentence: owner turns typed into the chair with no row behind them, then voice relays that
 * never reached the chair at all. The second half is empty on a clean install, so the field reads as before.
 *
 * @returns one or two sentences, the owner-turn one first
 */
export function fullIntakeClause({ intake, voice }: { intake: IntakeReport; voice: VoiceRelayIntake }): string {
  return [intakeClause({ report: intake }), voiceRelayClause({ report: voice })]
    .filter((part) => part.length > 0)
    .join(" ");
}

/** One undelivered relay, as a line naming what happened to it and how to clear it. */
function voiceRelayLines({ voice }: { voice: VoiceRelayIntake }): readonly string[] {
  if (voice.kind === "unavailable") {
    return [];
  }
  return voice.relays.map((relay) => {
    const what = relay.delivery === null ? "no delivery attempted" : `${relay.delivery.kind}: ${relay.delivery.detail}`;
    const row = relay.rowPresent ? "" : " (NO board row carries it)";
    return `voice relay not in your chat: ${relay.slug}${row} — ${what}; ${relayMarkCommand({ relay })}`;
  });
}

/** Each unwitnessed typed console turn, by pointer and instant, with the line that registers it. Never its words. */
function typedTurnLines({ intake }: { intake: IntakeReport }): readonly string[] {
  if (intake.kind !== "read" || intake.typed?.kind !== "read") {
    return [];
  }
  return intake.typed.finding.unwitnessed.map(
    (turn) => `unwitnessed typed console turn at ${turn.timestamp}: ${typedRegisterCommandFor({ turn })}`,
  );
}

/** Every non-empty finding, capped, in the order a reader acts on them. */
function findingLines({
  result,
  ranked,
  intake,
  voice,
  full,
}: {
  result: Reconciliation;
  ranked: readonly BoardRow[];
  intake: IntakeReport;
  voice: VoiceRelayIntake;
  full: boolean;
}): readonly string[] {
  const findings: (readonly string[])[] = [
    result.misaligned.map(
      (item) =>
        `misaligned: ${item.session} is on ${item.row.id}, ranked ${String(item.rank)} of ${String(ranked.length)}`,
    ),
    result.unprioritised.map(
      (item) => `unplaced: ${item.session} is on ${item.row.id}, whose priority nobody has stated`,
    ),
    result.unregistered.map((session) => `unregistered: ${session} is on nothing the board claims`),
    result.starving.map((row) => `ready, nobody on it: ${row.id}`),
    result.staleAsks.map(
      (row) =>
        `stale ask: ${row.id} has been waiting ${String(row.waitingHours)}h — ${labelText({ full, label: row.label })}`,
    ),
    intake.kind === "read"
      ? intake.finding.unwitnessed.map(
          (turn) => `unwitnessed owner turn at ${turn.timestamp}: ${registerCommandFor({ turn })}`,
        )
      : [],
    typedTurnLines({ intake }),
    voiceRelayLines({ voice }),
  ];
  return findings.flatMap((lines) => capped({ full, lines }));
}

/**
 * Every line the human read prints: the headline first, then only what is not empty.
 *
 * @param unanchored register entries left out of coverage because they cite nothing checkable
 * @param scopeFlags the `--dir` and `--home` this run was given, which every printed command carries
 * @param full whether to print every label whole and every finding uncapped
 * @returns the lines, in print order
 */
export function renderReconciliationLines({
  result,
  ranked,
  source,
  intake,
  outcomes,
  holds,
  voice,
  scopeFlags,
  unanchored,
  full,
}: {
  result: Reconciliation;
  ranked: readonly BoardRow[];
  source: FleetSource;
  intake: IntakeReport;
  outcomes: OutcomeReport;
  unanchored: readonly string[];
  holds: BoardHolds;
  voice: VoiceRelayIntake;
  scopeFlags: readonly string[];
  full: boolean;
}): readonly string[] {
  const fallback =
    source === "open-runs" ? ["(cmux could not be read — this is the board's own open runs, not the live fleet.)"] : [];
  const band =
    result.top.length === 0
      ? [emptyBandLine({ rankedCount: ranked.length, result })]
      : [
          `top ${String(result.top.length)} startable row(s), of ${String(ranked.length)} ranked ` +
            `(${String(result.held.length)} held):`,
          ...result.top.map((row, index) => rowLine({ full, rank: index + 1, row })),
        ];
  return [
    result.headline,
    fullIntakeClause({ intake, voice }),
    ...fallback,
    ...heldLines({ holds, maxTrunkRows: full ? undefined : MAX_LINES_PER_FINDING, scopeFlags }),
    "",
    ...band,
    ...findingLines({ full, intake, ranked, result, voice }),
    ...cutLabelLines({
      full,
      labels: [...result.top, ...result.staleAsks.slice(0, MAX_LINES_PER_FINDING)].map((row) => row.label),
    }),
    ...outcomeLines({ report: outcomes, unanchored }),
  ];
}
