/**
 * The usage half of `supervisor chair-watch`: each session the desktop app hosts, the model it asked for against the
 * model that ran and its rate of use, and each plan's tokens across every session on it — beside, never added to,
 * the model host's own recorded reading of that plan.
 *
 * The app's report names a session's plan by its STORE (`../sessionHarness/appUsage.ts`), which the register resolves
 * to an alias; a store no plan holds reads `unregistered` and the path itself is never carried out: a watch report
 * names no store path. Nor does it carry a session's title, which is the owner's words.
 *
 * Pure: the report, the register rows and the readings arrive already read.
 */
import { type UsagePlanEntry, usageViewOf } from "../sessionHarness/appUsage.js";
import type { AppSessionUsage, AppUsageReport } from "../sessionHarness/usageWire.js";
import type { ChairWatchReading, ChairWatchSessionUsage, ChairWatchUsage } from "./chairWatch.js";

/** How a plan no register row holds is named in the watch. */
const UNREGISTERED_PLAN = "unregistered";

/** The usage report, or why the app could not give one. */
export type ChairWatchAppUsageRead =
  { readonly kind: "report"; readonly report: AppUsageReport } | { readonly kind: "failed"; readonly why: string };

/**
 * The model a session ran on, as the vendor said it: the resolved model, else every model a turn was charged to.
 *
 * @param usage the session
 * @returns the model, or `undefined` when the vendor has said neither yet
 */
function ranModelOf({ usage }: { usage: AppSessionUsage }): string | undefined {
  if (usage.resolvedModel !== undefined) {
    return usage.resolvedModel;
  }
  if (usage.chargedModels.length === 0) {
    return undefined;
  }
  return usage.chargedModels.join(", ");
}

/**
 * The mismatch line for a session that ran a model it did not ask for, naming both.
 *
 * @param usage the session
 * @param ranModel the model it ran on, when the vendor has said
 * @returns e.g. `asked for fable, ran opus`, or `undefined` when the app reported no mismatch
 */
function mismatchOf({ usage, ranModel }: { usage: AppSessionUsage; ranModel: string | undefined }): string | undefined {
  if (!usage.modelMismatch) {
    return undefined;
  }
  const ran = [...new Set([...(ranModel === undefined ? [] : [ranModel]), ...usage.chargedModels])].join(", ");
  if (usage.askedModel === undefined) {
    return `asked for no pinned model, ran ${ran}`;
  }
  return `asked for ${usage.askedModel}, ran ${ran}`;
}

/**
 * One session as the watch reports it.
 *
 * @param usage the app's report of the session
 * @param alias the registered plan it spends, when one holds its store
 * @returns the session's asked and ran models, the mismatch when they differ, and its rate when reported
 */
function sessionUsageOf({
  usage,
  alias,
}: {
  usage: AppSessionUsage;
  alias: string | undefined;
}): ChairWatchSessionUsage {
  const ranModel = ranModelOf({ usage });
  const mismatch = mismatchOf({ ranModel, usage });
  return {
    sessionId: usage.sessionId,
    ...(alias === undefined ? {} : { plan: alias }),
    ...(usage.askedModel === undefined ? {} : { askedModel: usage.askedModel }),
    ...(ranModel === undefined ? {} : { ranModel }),
    ...(mismatch === undefined ? {} : { mismatch }),
    ...(usage.rate.kind === "reported" ? { tokensPerHour: usage.rate.totalTokensPerHour } : {}),
  };
}

/**
 * The usage watch over one app report.
 *
 * @param app the app's usage report, or why there is none
 * @param plans the register's rows, enough to resolve a session's store to its alias; empty when unread
 * @param readings the plan readings the watch judged on, whose phrase rides beside each plan's app total
 * @param registerGap why the register could not resolve stores, when it could not
 * @returns each session, each plan's app total beside its model host's reading, and every gap
 */
export function chairWatchUsageOf({
  app,
  plans,
  readings,
  registerGap,
}: {
  app: ChairWatchAppUsageRead;
  plans: readonly UsagePlanEntry[];
  readings: readonly ChairWatchReading[];
  registerGap: string | undefined;
}): ChairWatchUsage {
  const gaps = registerGap === undefined ? [] : [registerGap];
  if (app.kind === "failed") {
    return { gaps: [...gaps, `the app's usage could not be read: ${app.why}`], plans: [], sessions: [] };
  }
  const view = usageViewOf({ plans, report: app.report });
  const sessions = view.sessions.map(({ usage, plan }) =>
    sessionUsageOf({ alias: plan.kind === "registered" ? plan.alias : undefined, usage }),
  );
  const totals = view.plans.map((summary) => {
    const alias = summary.plan.kind === "registered" ? summary.plan.alias : UNREGISTERED_PLAN;
    const host = readings.find((reading) => reading.alias === alias && reading.vendor === summary.vendor);
    return {
      alias,
      appTokens: summary.total === undefined ? 0 : summary.total.totalTokens,
      ...(host === undefined ? {} : { modelHostReading: `${host.state}: ${host.reading}` }),
    };
  });
  return { gaps, plans: totals, sessions };
}
