/**
 * What `slopweaver cmux usage` makes of the desktop app's usage report: each session's spend named by the plan it
 * spends, and each plan's sessions summed. Pure: the verb reads the socket and the plans register, this folds them.
 *
 * A session names its plan by the plan's STORE (`planPath`, `desktop/src/sessionUsage.ts` `planPathOf`), never by an
 * alias the app would have to be told, so the register resolves it here: a registered plan of the same vendor whose
 * `storeDir` is that path. A path no plan holds reads `unregistered`, never a guessed alias. Tokens are summed per plan
 * only, and a plan is one vendor's, so no two vendors' categories are ever added together.
 */
import type { RegisteredPlan } from "../plans/types.js";
import type { SessionPlanChoice } from "../sessions/planChoice.js";
import type { AppSessionTokens, AppSessionUsage, AppUsageReport } from "./usageWire.js";

/** A plan as the register names it, enough to resolve a session's store to its alias. */
export type UsagePlanEntry = Pick<RegisteredPlan, "alias" | "provider" | "storeDir">;

/** Which registered plan a session's store is, or that none is. */
export type UsagePlanName = { readonly kind: "registered"; readonly alias: string } | { readonly kind: "unregistered" };

/** One plan's sessions in this run of the app, summed. */
export interface PlanUsageSummary {
  readonly vendor: AppSessionUsage["vendor"];
  readonly planPath: string;
  readonly plan: UsagePlanName;
  readonly sessionCount: number;
  /** Sessions with at least one turn counted. */
  readonly reportingSessionCount: number;
  /** Sessions whose total is a floor: a turn missing, counted main-loop only, or under way. */
  readonly incompleteSessionCount: number;
  /** Sessions that ran on a model they did not ask for. */
  readonly mismatchCount: number;
  /** Every reporting session's total, summed; absent while none has reported. */
  readonly total?: AppSessionTokens;
}

/** One session's recorded plan choice, off its session ledger row, keyed by the id the app names it by. */
export interface RecordedPlanChoice {
  readonly sessionId: string;
  readonly planChoice: SessionPlanChoice;
}

/** The report, each session's plan named, and its plans summed. */
export interface UsageView {
  readonly atIso: string;
  readonly sessions: readonly {
    readonly usage: AppSessionUsage;
    readonly plan: UsagePlanName;
    /** The plan choice its ledger row recorded when the session started, when the row carries one. */
    readonly planChoice?: SessionPlanChoice;
  }[];
  readonly plans: readonly PlanUsageSummary[];
}

/**
 * Which registered plan a store is.
 *
 * @param vendor the vendor whose plan it must be: a Claude store is never a Codex plan
 * @param planPath the store the session named
 * @param plans the register's plans
 * @returns the plan's alias, or unregistered when no plan of that vendor holds that store
 */
export function planNameOf({
  vendor,
  planPath,
  plans,
}: {
  vendor: AppSessionUsage["vendor"];
  planPath: string;
  plans: readonly UsagePlanEntry[];
}): UsagePlanName {
  const match = plans.find((plan) => plan.provider === vendor && plan.storeDir === planPath);
  if (match === undefined) {
    return { kind: "unregistered" };
  }
  return { alias: match.alias, kind: "registered" };
}

/**
 * Two totals of one vendor, summed category by category.
 *
 * @param left the running sum
 * @param right the session being added
 * @returns the sum, or `undefined` when the two are different vendors' and so have none
 */
export function sumTokens({
  left,
  right,
}: {
  left: AppSessionTokens;
  right: AppSessionTokens;
}): AppSessionTokens | undefined {
  if (left.vendor === "claude" && right.vendor === "claude") {
    return {
      cacheReadInputTokens: left.cacheReadInputTokens + right.cacheReadInputTokens,
      cacheWriteInputTokens: left.cacheWriteInputTokens + right.cacheWriteInputTokens,
      inputTokens: left.inputTokens + right.inputTokens,
      outputTokens: left.outputTokens + right.outputTokens,
      totalTokens: left.totalTokens + right.totalTokens,
      vendor: "claude",
    };
  }
  if (left.vendor === "codex" && right.vendor === "codex") {
    return {
      cacheWriteInputTokens: left.cacheWriteInputTokens + right.cacheWriteInputTokens,
      cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
      outputTokens: left.outputTokens + right.outputTokens,
      reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
      totalTokens: left.totalTokens + right.totalTokens,
      uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
      vendor: "codex",
    };
  }
  return undefined;
}

/**
 * Whether a session's total is a floor rather than the whole of its spend.
 *
 * @param usage the session
 * @returns true when a turn went unreported, was counted main-loop only, or is under way and not reported yet
 */
export function isIncomplete({ usage }: { usage: AppSessionUsage }): boolean {
  return usage.missingTurns > 0 || usage.partialTurns > 0 || usage.turnOpen;
}

function summaryWith({ summary, usage }: { summary: PlanUsageSummary; usage: AppSessionUsage }): PlanUsageSummary {
  let { total } = summary;
  if (usage.total !== undefined) {
    // One plan is one vendor's, keyed below, so a sum of two of its sessions always exists.
    total = total === undefined ? usage.total : sumTokens({ left: total, right: usage.total })!;
  }
  return {
    ...summary,
    incompleteSessionCount: summary.incompleteSessionCount + (isIncomplete({ usage }) ? 1 : 0),
    mismatchCount: summary.mismatchCount + (usage.modelMismatch ? 1 : 0),
    reportingSessionCount: summary.reportingSessionCount + (usage.reportedTurns > 0 ? 1 : 0),
    sessionCount: summary.sessionCount + 1,
    ...(total === undefined ? {} : { total }),
  };
}

/**
 * Every ledger row's recorded plan choice, by the session id the row was opened under.
 *
 * @param items the folded session ledger
 * @returns one entry per row carrying both a session id and a choice
 */
export function recordedPlanChoices({
  items,
}: {
  items: readonly { readonly sessionId?: string | undefined; readonly planChoice?: SessionPlanChoice | undefined }[];
}): readonly RecordedPlanChoice[] {
  return items.flatMap((item) => {
    const { planChoice, sessionId } = item;
    if (planChoice === undefined || sessionId === undefined) {
      return [];
    }
    return [{ planChoice, sessionId }];
  });
}

/**
 * The report with each session's plan named and each plan summed, plans in the order a session first named them.
 *
 * @param report what the app answered
 * @param plans the register's plans; empty when the install has registered none
 * @param recorded each ledger row's recorded plan choice by session id — the app's session id is the row's
 *   `sessionId` — or absent when the ledger was not read
 * @returns the view the verb prints
 */
export function usageViewOf({
  report,
  plans,
  recorded,
}: {
  report: AppUsageReport;
  plans: readonly UsagePlanEntry[];
  recorded?: readonly RecordedPlanChoice[];
}): UsageView {
  const summaries = new Map<string, PlanUsageSummary>();
  const sessions = report.sessions.map((usage) => {
    const plan = planNameOf({ planPath: usage.planPath, plans, vendor: usage.vendor });
    const key = `${usage.vendor}\u0000${usage.planPath}`;
    if (!summaries.has(key)) {
      summaries.set(key, {
        incompleteSessionCount: 0,
        mismatchCount: 0,
        plan,
        planPath: usage.planPath,
        reportingSessionCount: 0,
        sessionCount: 0,
        vendor: usage.vendor,
      });
    }
    summaries.set(key, summaryWith({ summary: summaries.get(key)!, usage }));
    const choice = recorded?.find((row) => row.sessionId === usage.sessionId)?.planChoice;
    return { plan, usage, ...(choice === undefined ? {} : { planChoice: choice }) };
  });
  return { atIso: report.atIso, plans: [...summaries.values()], sessions };
}
