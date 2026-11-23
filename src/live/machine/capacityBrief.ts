/**
 * `slopweaver machine capacity --brief` — the reading the sweep contract's step 8 acts on, and nothing else.
 *
 * The chair runs this verb every tick, and the whole `--json` document is about 22,000 characters: every ranked
 * process, every cpu hog, every watched daemon, every ceiling window and every covering investigation. Measured
 * over a run of chair ticks, the verb carried 49,055 tokens a tick in the chair's context, and the chair
 * re-ran it through `grep`/`head` to find the handful of fields its contract names. Reproduce:
 * `slopweaver transcripts draw --session <session-id> --from-tick <n> --to-tick <m> --verb "slopweaver machine capacity"`.
 *
 * Both projections here are taken from the SAME report and ceilings the full renderings read, so nothing is
 * re-graded: a brief reading and a full one taken together can never disagree about a hold. The full `--json`
 * stays the capture `supervisor tick-draft`, the dispatch gate and the tick record gates parse; the reduced
 * `ceilings` below would not satisfy their schema, by design.
 */
import type { CeilingsReading } from "../../capacity/ceilings.js";
import { unusedNowClause } from "../../capacity/ceilingsRender.js";
import type { MachineCapacityReport } from "./capacity.js";
import type { DispatchBlock } from "./capacityRender.js";
import { volumeFreeGb } from "./diskFootprint.js";
import { type SpawnBackoffReport, spawnBackoffLine } from "./spawnBackoff.js";

/** The `--json --brief` document: the fields step 8 folds, holds on, or offers a kill from. */
export interface BriefMachineCapacityJson {
  readonly hold: boolean;
  readonly holdSubjects: MachineCapacityReport["holdSubjects"];
  readonly alert: boolean;
  /** The verdict line, which already names the subject that held and the culprit's kill command. */
  readonly verdict: string;
  readonly culprit: MachineCapacityReport["culprit"];
  /** The top foreign hog by name and size only — the briefing folds its GB, never its pid or session. */
  readonly topForeign: { readonly label: string; readonly footprintGb: number } | undefined;
  readonly segmentsPct: number | undefined;
  readonly swapfileCount: number | undefined;
  readonly swapUsedGb: number | undefined;
  readonly load: MachineCapacityReport["load"];
  readonly diskFreeGb: number | undefined;
  readonly diskHoldFreeGb: number;
  /** The dispatch register's standing without its investigation list; `covering` is what answers a hold. */
  readonly dispatch: Omit<DispatchBlock, "investigations">;
  readonly spawnBackoff: SpawnBackoffReport;
  /** The ceiling the fill stops at, the route a seat would take, and the briefing's one `unused now` clause. */
  readonly ceilings: {
    readonly lowest: CeilingsReading["lowest"];
    readonly selectedRoute: CeilingsReading["selectedRoute"];
    readonly problems: CeilingsReading["problems"];
    readonly unusedNow: string;
  };
}

/**
 * Project a capacity reading onto the fields the sweep contract's step 8 reads — `--json --brief`.
 *
 * @param report the graded machine report the full document is built from
 * @param dispatch what the dispatch register said at the reading, read by the shell
 * @param ceilings the plan and machine ceilings read beside the report
 * @param spawnBackoff the fleet spawn backoff read beside the report
 * @returns the reduced document, every value taken from the same reading the full one renders
 */
export function briefCapacityJson({
  report,
  dispatch,
  ceilings,
  spawnBackoff,
}: {
  readonly report: MachineCapacityReport;
  readonly dispatch: DispatchBlock;
  readonly ceilings: CeilingsReading;
  readonly spawnBackoff: SpawnBackoffReport;
}): BriefMachineCapacityJson {
  const { investigations: _investigations, ...standing } = dispatch;
  let topForeign: BriefMachineCapacityJson["topForeign"];
  if (report.topForeign !== undefined) {
    topForeign = { footprintGb: report.topForeign.footprintGb, label: report.topForeign.label };
  }
  return {
    alert: report.alert,
    ceilings: {
      lowest: ceilings.lowest,
      problems: ceilings.problems,
      selectedRoute: ceilings.selectedRoute,
      unusedNow: unusedNowClause({ reading: ceilings }),
    },
    culprit: report.culprit,
    diskFreeGb: volumeFreeGb({ volume: report.disk?.volume }),
    diskHoldFreeGb: report.diskHoldFreeGb,
    dispatch: standing,
    hold: report.hold,
    holdSubjects: report.holdSubjects,
    load: report.load,
    segmentsPct: report.compressor?.segmentsPct,
    spawnBackoff,
    swapUsedGb: report.swap?.usedGb,
    swapfileCount: report.swapfileCount,
    topForeign,
    verdict: report.verdict,
  };
}

/**
 * The `--brief` text: the `unused now` clause, the spawn-backoff line while it is closing the door, and the
 * verdict — never the ceiling table, the process rows or the cpu lines.
 *
 * @param report the graded machine report
 * @param ceilings the ceilings read beside it
 * @param spawnBackoff the fleet spawn backoff read beside it
 * @returns two or three lines, the verdict last as in the full rendering
 */
export function renderBriefMachineCapacityLines({
  report,
  ceilings,
  spawnBackoff,
}: {
  readonly report: MachineCapacityReport;
  readonly ceilings: CeilingsReading;
  readonly spawnBackoff: SpawnBackoffReport;
}): readonly string[] {
  const backoff = spawnBackoffLine({ report: spawnBackoff });
  return [unusedNowClause({ reading: ceilings }), ...(backoff === undefined ? [] : [backoff]), report.verdict];
}
