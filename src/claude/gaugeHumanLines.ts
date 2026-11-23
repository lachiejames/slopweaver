/**
 * Every line `claude gauge` prints to stdout without `--json`, in print order, each already folded onto one
 * physical line. Pure: the shell (`../cli/commands/claude/run.ts`) probes and writes, this decides what is written.
 *
 * Folded because `supervisor tick open` lifts the `PLAN`, `CHAIR` and `REACT NOW` lines out of this output by their
 * opening words, and a cached account address or a probe's reason carrying a line break would otherwise print a
 * forged one (`#lib/lineBreaks.ts`).
 */
import { foldLineBreaks } from "#lib/lineBreaks.js";
import type { ClaudeThresholds } from "../plans/thresholds.js";

import { renderBalanceLines } from "./balance.js";
import {
  type ChairProbe,
  type ChairUnread,
  chairBudgetLines,
  chairPlansOf,
  chairReadingLine,
} from "./chairBudgetAlert.js";
import type { ClaudePlanGauge } from "./contracts.js";
import { fleetBudgetAlert } from "./fleetAlert.js";
import {
  type ClaudeAliasAccountCell,
  type ClaudeGaugeOutcome,
  probeCostWarningLines,
  renderGaugeLines,
} from "./gaugeRender.js";
import { acceptanceShortfall, renderAcceptance } from "./loadBalance.js";
import type { GaugeChair } from "./seatBoot.js";

/**
 * The chair's block: its boot line, its paused plan's reading when the sweep skipped that plan, and its own
 * nearing wall directly under them, so the plan it spends and the warning about that plan are read together
 * (a dead supervisor is a dead fleet).
 *
 * @param chair which plan the pinned chair booted on
 * @param chairProbe the chair's plan probed beside a sweep that skipped it as paused — its reading, or why none
 * @param gauges every readable plan's reading
 * @param sweptUnread every swept plan whose probe failed
 * @param thresholds the install's Claude thresholds
 * @returns the block's lines, in print order
 */
function chairSection({
  chair,
  chairProbe,
  gauges,
  sweptUnread,
  thresholds,
}: {
  chair: GaugeChair;
  chairProbe: ChairProbe;
  gauges: readonly ClaudePlanGauge[];
  sweptUnread: readonly ChairUnread[];
  thresholds: ClaudeThresholds;
}): readonly string[] {
  const warnings = chairBudgetLines({
    chair: { plans: chairPlansOf({ sessions: chair.sessions }) },
    gauges,
    sweptUnread,
    thresholds,
    ...chairProbe,
  });
  const { chairReading } = chairProbe;
  const pausedChair = chairReading === undefined ? [] : [chairReadingLine({ chairReading })];
  return [...chair.lines, ...pausedChair, ...warnings];
}

/**
 * The human read: the table, one `PLAN` line per configured plan, the chair's block, the balance block and the
 * fold line.
 *
 * The balance block is a FLEET measurement, so a narrowed sweep prints none. Over a single requested plan every
 * spread grades `unmeasurable`, and that sentence says the fleet is unread — which would be false whenever the
 * caller merely asked about one plan of a fully readable fleet.
 *
 * @param cells each plan's decided account cell, which names the account beside each alias
 * @param chair which plan the pinned chair booted on, which draws the `*` and the lines under the legend
 * @param chairProbe the chair's plan probed beside a sweep that skipped it as paused, for its warning only
 * @param configured how many UNPAUSED plans are configured, which the owner's acceptance test measures against — every
 *   configured plan, and a plan the owner deliberately took out is not one of them
 * @param fleetWide whether the sweep covered every configured plan
 * @param gauges every readable plan's reading, in configured order
 * @param outcomes every probed plan's outcome, whose probe cost draws a `PROBE COST` line when not basically zero
 * @param planLines one `PLAN` line per configured plan, every window with its own reset — the table shows readable
 *   plans only, and these name a paused or unreadable one too
 * @param reserved the plan held back for the browser, which draws the `B`
 * @param sweptUnread every swept plan whose probe failed, so a chair seated on one is told its wall is unknown
 * @param targets where the router would send the next spawn of each budget
 * @param thresholds the install's Claude thresholds, off the same register read as the plans
 * @returns every stdout line, in print order, each one physical line
 */
export function gaugeHumanLines({
  cells,
  chair,
  chairProbe,
  configured,
  fleetWide,
  gauges,
  outcomes,
  planLines,
  reserved,
  sweptUnread,
  targets,
  thresholds,
}: {
  cells: readonly ClaudeAliasAccountCell[];
  chair: GaugeChair;
  chairProbe: ChairProbe;
  configured: number;
  fleetWide: boolean;
  gauges: readonly ClaudePlanGauge[];
  outcomes: readonly ClaudeGaugeOutcome[];
  planLines: readonly string[];
  reserved?: string | undefined;
  sweptUnread: readonly ChairUnread[];
  targets: { chairLevelWith?: readonly string[]; nextAllModels?: string; nextChair?: string; nextFable?: string };
  thresholds: ClaudeThresholds;
}): readonly string[] {
  const marks = {
    ...(chair.active === undefined ? {} : { active: chair.active }),
    ...(reserved === undefined ? {} : { reserved }),
  };
  // The owner's own success criterion, printed beside the spread rather than left in a module nothing calls.
  const balance = fleetWide
    ? [
        ...renderBalanceLines({ configured, gauges, thresholds, ...targets }),
        renderAcceptance({ shortfall: acceptanceShortfall({ configured, gauges, thresholds }) }),
        "",
      ]
    : [];
  // Printed on EVERY read, not only a failing one: the fold line is what a sweep tick pastes into the
  // briefing, and a line that appears only when something is wrong is a line nobody has a habit of reading.
  const alert = fleetBudgetAlert({ configured, gauges, thresholds });
  const lines = [
    ...renderGaugeLines({ cells, gauges, thresholds, ...marks }),
    "",
    ...planLines,
    // Directly under the PLAN lines it qualifies: a probe past the ceiling is no longer the free read the cap lets through.
    ...probeCostWarningLines({ outcomes }),
    "",
    ...chairSection({ chair, chairProbe, gauges, sweptUnread, thresholds }),
    ...balance,
    alert.fold,
    ...alert.reactNow,
  ];
  return lines.map((line) => foldLineBreaks({ text: line }));
}
