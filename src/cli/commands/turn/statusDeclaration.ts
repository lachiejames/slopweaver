/**
 * What one `turn status` push DECLARES — a plan, a stage, or both — and the progress-log events that
 * declaration becomes. Pure throughout; `./status.ts` owns the gates, the Slack edit and the append. Split
 * from it so that verb stays one a reader can hold.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type {
  ProgressLog,
  ProgressPlanEvent,
  ProgressStageEvent,
  ProgressTimelineEvent,
} from "../../../live/turn/progressLog.js";
import { parsePlanSteps, parseStepFlag } from "../../../live/turn/progressPlan.js";
import { type TurnError, turnErrorLines } from "../../../live/turn/turnErrors.js";
import { str } from "./core.js";

/** What one push declares: a plan, a stage, or both — never neither, which `runTurnStatus` refuses first. */
export interface StatusDeclaration {
  readonly plan: readonly string[] | undefined;
  readonly status: string | undefined;
  readonly step: string | undefined;
}

/**
 * Read what one push declares — `--status`, `--plan`, or both, with `--step` riding on a status. Pure.
 *
 * @param values the parsed flag values
 * @returns the declaration, or every reason it was refused
 */
export function statusDeclaration({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<StatusDeclaration> {
  const rawStatus = str({ key: "status", values });
  const rawPlan = str({ key: "plan", values });
  const step = str({ key: "step", values });
  const status = rawStatus === undefined || rawStatus.trim().length === 0 ? undefined : rawStatus;
  if (status === undefined && rawPlan === undefined) {
    return err(["--status or --plan is required"]);
  }
  if (step !== undefined && status === undefined) {
    return err(["--step files a --status against a plan step, so it needs a --status"]);
  }
  if (rawPlan === undefined) {
    return ok({ plan: undefined, status, step });
  }
  const plan = parsePlanSteps({ raw: rawPlan });
  if (plan.isErr()) {
    return err(turnErrorLines({ error: plan.error }));
  }
  return ok({ plan: plan.value, status, step });
}

/**
 * The events this push appends, in the order they land: the plan first, so a stage written in the same push
 * is filed against the plan it declares. Pure — the instant and the writer are passed in.
 *
 * @param declaration the plan, status and step this push declares
 * @param log the turn's progress log as it stands before this push
 * @param nowIso the push's one instant
 * @param worker this push's visible session — a change of writer is the card's handover
 * @returns the events to append, or why a `--step` names nothing
 */
export function statusPushEvents({
  declaration,
  log,
  nowIso,
  worker,
}: {
  declaration: StatusDeclaration;
  log: Pick<ProgressLog, "timeline">;
  nowIso: string;
  worker: string;
}): Result<readonly ProgressTimelineEvent[], TurnError> {
  const planEvent: readonly ProgressPlanEvent[] =
    declaration.plan === undefined ? [] : [{ kind: "plan", steps: declaration.plan, tsIso: nowIso }];
  const standing = [...log.timeline.filter((event) => event.kind === "plan"), ...planEvent].pop();
  const step: Result<number | undefined, TurnError> =
    declaration.step === undefined
      ? ok(undefined)
      : parseStepFlag({ planLength: standing?.steps.length, raw: declaration.step });
  return step.map((named) => {
    if (declaration.status === undefined) {
      return planEvent;
    }
    const stage: ProgressStageEvent = {
      kind: "stage",
      text: declaration.status,
      tsIso: nowIso,
      worker,
      ...(named === undefined ? {} : { step: named }),
    };
    return [...planEvent, stage];
  });
}

/**
 * What a push's own output line and dry run say it declared.
 *
 * @param declaration the push's declaration
 * @returns the quoted status, the plan's size, or both
 */
export function declarationSummary({ declaration }: { declaration: StatusDeclaration }): string {
  const parts: string[] = [];
  if (declaration.plan !== undefined) {
    parts.push(`a ${String(declaration.plan.length)}-step plan`);
  }
  if (declaration.status !== undefined) {
    parts.push(`"${declaration.status}"`);
  }
  return parts.join(" and ");
}

/**
 * The detail a card write records for this push: the status the worker wrote, else the plan it declared —
 * either way a line that changed what the reader sees, which is what the staleness probe measures.
 *
 * @param declaration the push's declaration
 * @returns the line to record
 */
export function writtenDetail({ declaration }: { declaration: StatusDeclaration }): string {
  if (declaration.status !== undefined) {
    return declaration.status;
  }
  return `planned: ${declaration.plan!.join(" · ")}`;
}
