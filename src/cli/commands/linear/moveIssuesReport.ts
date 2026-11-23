/** Every line `slopweaver linear move-issues` prints, from the plan `./moveIssuesCore.ts` computes. Pure. */

import type {
  IssueMoveApplication,
  IssueMovePlan,
  IssueMoveRefusal,
  IssueMoveRow,
  PlannedIssueMove,
} from "./moveIssuesCore.js";

/**
 * One refusal as a reader sees it. Pure.
 *
 * @param refusal the reason
 * @returns its line fragment, code first
 */
function refusalText({ refusal }: { refusal: IssueMoveRefusal }): string {
  switch (refusal.code) {
    case "ISSUE_NOT_RETURNED":
      return "ISSUE_NOT_RETURNED: Linear returned no issue by this identifier";
    case "ALREADY_DESTINATION":
      return `ALREADY_DESTINATION: already in ${refusal.teamKey}`;
    case "ARCHIVED":
      return `ARCHIVED: archived ${refusal.archivedAt}`;
    case "HAS_PROJECT":
      return `HAS_PROJECT: in project ${refusal.projectId}; detach it or move it by hand`;
    case "HAS_LABELS":
      return `HAS_LABELS: carries ${String(refusal.labelIds.length)} label(s) a move would drop`;
    case "FOREIGN_ASSIGNEE":
      return `FOREIGN_ASSIGNEE: assigned to ${refusal.assigneeId}, not the token's own user`;
    case "SAME_TEAM_CHILDREN":
      return `SAME_TEAM_CHILDREN: ${refusal.identifiers.join(", ")} would move with it; move them first`;
    case "SOURCE_STATE_NOT_READ":
      return `SOURCE_STATE_NOT_READ: state ${refusal.stateId} is not in its team's states`;
    case "DESTINATION_STATE_MISSING":
      return `DESTINATION_STATE_MISSING: the destination has no state named "${refusal.stateName}"`;
    case "DESTINATION_STATE_AMBIGUOUS":
      return `DESTINATION_STATE_AMBIGUOUS: ${String(refusal.stateIds.length)} destination states are named "${refusal.stateName}"`;
    case "DESTINATION_STATE_TYPE_DIFFERS":
      return `DESTINATION_STATE_TYPE_DIFFERS: "${refusal.stateName}" is ${refusal.sourceType} here and ${refusal.destinationType} in the destination`;
    default: {
      const unhandled: never = refusal;
      return unhandled;
    }
  }
}

/** One row's plan line. Pure. */
function rowLine({ row, destinationKey }: { row: IssueMoveRow; destinationKey: string }): string {
  if (row.kind === "refused") {
    const title = row.title === undefined ? "" : ` "${row.title}"`;
    return `refused  ${row.identifier}${title}: ${row.reasons.map((refusal) => refusalText({ refusal })).join("; ")}`;
  }
  const cycle = row.cycleId === null ? "no cycle to leave" : `leaves cycle ${row.cycleId}`;
  return `move     ${row.identifier} "${row.title}" → ${destinationKey}, keeps state "${row.sourceStateName}", ${cycle}`;
}

/** One planned row's apply line. Pure. */
function applicationLine({ row, application }: { row: PlannedIssueMove; application: IssueMoveApplication }): string {
  if (application.status === "failed") {
    const said = application.diagnostics.length > 0 ? `: ${application.diagnostics.join(" / ")}` : "";
    return `failed   ${row.identifier} (linear issue exited ${String(application.exitCode)})${said}`;
  }
  if (application.status === "landed") {
    return `landed   ${row.identifier}`;
  }
  return `not attempted ${row.identifier}`;
}

/** The preview's closing line, or nothing when no row would move. Pure. */
function previewLines({ plan }: { plan: IssueMovePlan }): readonly string[] {
  if (plan.moveCount === 0) {
    return [];
  }
  if (plan.refusalCount > 0) {
    return ["nothing applied: --apply moves only a plan with no refusal"];
  }
  return ["preview only: re-run with --apply to move them"];
}

/**
 * The text report: one line per named issue, the counts, and under `--apply` what each planned row did. Pure.
 *
 * @param plan the computed plan
 * @param applications what each planned row did, keyed by identifier; absent for a preview
 * @returns the report lines
 */
export function moveIssuesTextLines({
  plan,
  applications,
}: {
  plan: IssueMovePlan;
  applications: ReadonlyMap<string, IssueMoveApplication> | undefined;
}): readonly string[] {
  const lines = plan.rows.map((row) => rowLine({ destinationKey: plan.destination.key, row }));
  lines.push(`${String(plan.moveCount)} would move into ${plan.destination.key}, ${String(plan.refusalCount)} refused`);
  if (applications === undefined) {
    return [...lines, ...previewLines({ plan })];
  }
  for (const row of plan.rows) {
    const application = applications.get(row.identifier);
    if (row.kind === "move" && application !== undefined) {
      lines.push(applicationLine({ application, row }));
    }
  }
  lines.push("a fields-only write cannot read back its fields: re-run without --apply to see what stands now");
  return lines;
}

/**
 * The `--json` report: one document, inner `linear issue` output captured inside it rather than around it. Pure.
 *
 * @param plan the computed plan
 * @param applications what each planned row did, keyed by identifier; absent for a preview
 * @returns the document's text
 */
export function moveIssuesJson({
  plan,
  applications,
}: {
  plan: IssueMovePlan;
  applications: ReadonlyMap<string, IssueMoveApplication> | undefined;
}): string {
  // A field with no value is left OUT of the document — a refused row Linear never returned has no title, and a
  // preview row has no application — rather than carried as a placeholder.
  const rows = plan.rows.map((row) => {
    if (row.kind === "refused") {
      return { identifier: row.identifier, kind: row.kind, reasons: row.reasons, title: row.title };
    }
    return {
      application: applications?.get(row.identifier),
      cycleId: row.cycleId,
      destinationStateId: row.destinationStateId,
      identifier: row.identifier,
      issueId: row.issueId,
      kind: row.kind,
      stateName: row.sourceStateName,
      title: row.title,
    };
  });
  return JSON.stringify({
    applied: applications !== undefined,
    destination: plan.destination,
    moveCount: plan.moveCount,
    refusalCount: plan.refusalCount,
    rows,
  });
}
