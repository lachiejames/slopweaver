/**
 * The text `slopweaver cmux usage` prints: each plan's summed spend, then each session under it, model facts before
 * tokens. A fact the app did not have reads `unknown` or `not-reported`, never `0`, and a total with a missing or
 * main-loop-only turn behind it says it is a floor. Codex's context occupancy is printed labelled as what it is, how
 * full the window is, and is never read as spend.
 */

import type { PlanUsageSummary, UsagePlanName, UsageView } from "../../../sessionHarness/appUsage.js";
import type {
  AppSessionTokens,
  AppSessionUsage,
  AppTurnUsage,
  AppUsageRate,
} from "../../../sessionHarness/usageWire.js";

function planLabel({ plan, planPath }: { plan: UsagePlanName; planPath: string }): string {
  if (plan.kind === "registered") {
    return plan.alias;
  }
  return `unregistered (${planPath})`;
}

/** One vendor's tokens, each category by its own name, on one line. */
function tokensText({ tokens }: { tokens: AppSessionTokens }): string {
  if (tokens.vendor === "claude") {
    return `input ${String(tokens.inputTokens)} · output ${String(tokens.outputTokens)} · cache read ${String(tokens.cacheReadInputTokens)} · cache write ${String(tokens.cacheWriteInputTokens)} · total ${String(tokens.totalTokens)}`;
  }
  return `uncached input ${String(tokens.uncachedInputTokens)} · cached input ${String(tokens.cachedInputTokens)} · cache write ${String(tokens.cacheWriteInputTokens)} · output ${String(tokens.outputTokens)} · reasoning ${String(tokens.reasoningOutputTokens)} · total ${String(tokens.totalTokens)}`;
}

function turnText({ usage }: { usage: AppTurnUsage }): string {
  if (usage.kind === "reported") {
    return `reported ${usage.scope}, total ${String(usage.tokens.totalTokens)}`;
  }
  if (usage.kind === "unreadable") {
    return `unreadable (${usage.reason})`;
  }
  return "not-reported";
}

/**
 * A session's rate, or which input it lacks.
 *
 * @param rate the rate the app computed
 * @returns tokens per hour, or the named reason there is none
 */
export function rateText({ rate }: { rate: AppUsageRate }): string {
  if (rate.kind === "reported") {
    return `${String(Math.round(rate.totalTokensPerHour))} tokens/hour since ready`;
  }
  return `rate ${rate.kind}`;
}

function floorText({ usage }: { usage: AppSessionUsage }): string | undefined {
  const parts: string[] = [];
  if (usage.missingTurns > 0) {
    parts.push(`${String(usage.missingTurns)} turn(s) not reported`);
  }
  if (usage.partialTurns > 0) {
    parts.push(`${String(usage.partialTurns)} turn(s) main loop only`);
  }
  if (usage.turnOpen) {
    parts.push("a turn under way, counted at its end");
  }
  if (parts.length === 0) {
    return undefined;
  }
  return `a floor: ${parts.join(", ")}`;
}

function modelText({ usage }: { usage: AppSessionUsage }): string {
  const asked = usage.askedModel === undefined ? "asked none" : `asked ${usage.askedModel}`;
  const ran = usage.resolvedModel === undefined ? "ran unknown" : `ran ${usage.resolvedModel}`;
  const charged = usage.chargedModels.length === 0 ? "charged none yet" : `charged ${usage.chargedModels.join(", ")}`;
  const flag = usage.modelMismatch ? " · OFF THE MODEL ASKED" : "";
  return `model: ${asked} · ${ran} · ${charged}${flag}`;
}

/**
 * One session's lines, indented under its plan: model facts, then tokens, then the last turn, rate and occupancy.
 *
 * @param usage the session
 * @returns the lines, in print order
 */
export function sessionLines({ usage }: { usage: AppSessionUsage }): readonly string[] {
  const lines = [
    `  ${usage.ledgerKey} · ${usage.title} · ${usage.vendor} · ${usage.state}`,
    `    ${modelText({ usage })}`,
  ];
  const floor = floorText({ usage });
  const turns = `${String(usage.reportedTurns)} turn(s) counted`;
  if (usage.total === undefined) {
    lines.push(`    tokens: not-reported · ${turns}${floor === undefined ? "" : ` · ${floor}`}`);
  } else {
    lines.push(
      `    tokens: ${tokensText({ tokens: usage.total })} · ${turns}${floor === undefined ? "" : ` · ${floor}`}`,
    );
  }
  const lastTurn =
    usage.lastTurn === undefined
      ? "none yet"
      : `${turnText({ usage: usage.lastTurn.usage })} at ${usage.lastTurn.atIso}`;
  lines.push(`    last turn: ${lastTurn} · ${rateText({ rate: usage.rate })}`);
  if (usage.context !== undefined) {
    const { usedTokens, sizeTokens, atIso } = usage.context;
    lines.push(`    context occupancy; not spend: ${String(usedTokens)} of ${String(sizeTokens)} at ${atIso}`);
  }
  return lines;
}

/**
 * One plan's summary line.
 *
 * @param summary the plan's sessions, summed
 * @returns the line
 */
export function planLine({ summary }: { summary: PlanUsageSummary }): string {
  const counts = `${String(summary.sessionCount)} session(s), ${String(summary.reportingSessionCount)} reporting, ${String(summary.incompleteSessionCount)} incomplete, ${String(summary.mismatchCount)} off the model asked`;
  let total = "total not-reported";
  if (summary.total !== undefined) {
    const floor = summary.incompleteSessionCount > 0 ? " (a floor)" : "";
    total = `total ${String(summary.total.totalTokens)}${floor}`;
  }
  return `plan ${planLabel({ plan: summary.plan, planPath: summary.planPath })} · ${summary.vendor} · ${counts} · ${total}`;
}

/**
 * The whole report as text: each plan's line, then its sessions.
 *
 * @param view the report, plans named and summed
 * @returns the lines, in print order
 */
export function usageLines({ view }: { view: UsageView }): readonly string[] {
  if (view.sessions.length === 0) {
    return [`no sessions hosted in this run of the app (read ${view.atIso})`];
  }
  const lines = [`usage read ${view.atIso}, this run of the app only; spend lands at each turn's end`];
  for (const summary of view.plans) {
    lines.push(planLine({ summary }));
    for (const { usage } of view.sessions) {
      if (usage.vendor === summary.vendor && usage.planPath === summary.planPath) {
        lines.push(...sessionLines({ usage }));
      }
    }
  }
  return lines;
}
