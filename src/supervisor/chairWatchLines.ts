/**
 * One `supervisor chair-watch` report as the lines a terminal prints: the status line first, then short sections —
 * the reasons, the plans, the usage watch, the notes and the overrides — each omitted when it has nothing to say.
 * Concise on purpose (AGENTS.md rule 7): the status line alone is the answer, and `--json` carries everything.
 *
 * Pure: a report in, lines out. It renders only what the report carries, so it names no address or store path.
 */
import type { ChairSuccessorTarget } from "./chairSuccessor.js";
import type { ChairWatchReport } from "./chairWatch.js";

/**
 * Where the successor lands, as a phrase naming its model host and, when routing named one, its plan.
 *
 * @param target the host the successor boots on
 * @param alias the plan routing picks, when it named one
 * @returns e.g. `on plan-two (claude)`
 */
function successorPhrase({ target, alias }: { target: ChairSuccessorTarget; alias: string | undefined }): string {
  if (target.kind === "none") {
    return `none can take it — ${target.why}`;
  }
  if (target.kind === "codex") {
    return "on the codex host";
  }
  if (alias === undefined) {
    return "on whichever claude plan routing picks at spawn";
  }
  return `on ${alias} (claude)`;
}

/**
 * The status line.
 *
 * @param report the watch report
 * @returns the one line that answers whether the chair stays
 */
function chairWatchStatusLine({ report }: { report: ChairWatchReport }): string {
  const count = `${String(report.reasons.length)} reason(s)`;
  const successor =
    report.successor === undefined
      ? ""
      : `; successor ${successorPhrase({ alias: report.successor.alias, target: report.successor.target })}`;
  if (report.status === "hand-off") {
    return `chair-watch: HAND-OFF — ${count}${successor}`;
  }
  if (report.status === "held") {
    const hold = report.hold === undefined ? "" : ` since ${report.hold.sinceIso}: ${report.hold.reason}`;
    return `chair-watch: HELD — ${count} to hand off, held by the owner${hold}`;
  }
  if (report.status === "unsupported") {
    const host = report.chair.kind === "codex" ? "a Codex thread" : "a cmux tab";
    return `chair-watch: UNSUPPORTED — ${count} to hand off, but the chair is ${host}, which the control plane cannot hand off from`;
  }
  if (report.status === "unmeasured") {
    if (report.chair.kind === "unresolved") {
      return `chair-watch: UNMEASURED — the chair did not resolve: ${report.chair.why}`;
    }
    return "chair-watch: UNMEASURED — the chair's cadence could not be judged; the notes say why";
  }
  return "chair-watch: STAY — no measured reason to hand off";
}

/**
 * The usage section.
 *
 * @param report the watch report
 * @returns the section's lines, empty when the watch read nothing and no gap was named
 */
function usageLines({ report }: { report: ChairWatchReport }): readonly string[] {
  const { usage } = report;
  if (usage.sessions.length === 0 && usage.plans.length === 0 && usage.gaps.length === 0) {
    return [];
  }
  const mismatched = usage.sessions.filter((session) => session.mismatch !== undefined).length;
  const sessions = usage.sessions.map((session) => {
    const plan = session.plan === undefined ? "" : ` on ${session.plan}`;
    const rate = session.tokensPerHour === undefined ? "" : `, ${String(Math.round(session.tokensPerHour))} tokens/h`;
    let models = "";
    if (session.mismatch !== undefined) {
      models = `, MISMATCH ${session.mismatch}`;
    } else if (session.ranModel !== undefined) {
      models = `, ${session.ranModel}`;
    }
    return `  ${session.sessionId}${plan}${models}${rate}`;
  });
  const plans = usage.plans.map((plan) => {
    const host = plan.modelHostReading === undefined ? "" : `; model host ${plan.modelHostReading}`;
    return `  ${plan.alias}: ${String(plan.appTokens)} tokens in the app${host}`;
  });
  return [
    `usage: ${String(usage.sessions.length)} session(s), ${String(mismatched)} on a model they did not ask for`,
    ...sessions,
    ...plans,
    ...usage.gaps.map((gap) => `  gap: ${gap}`),
  ];
}

/**
 * Every line one report prints.
 *
 * @param report the watch report
 * @returns the status line, then each non-empty section
 */
export function chairWatchLines({ report }: { report: ChairWatchReport }): readonly string[] {
  return [
    chairWatchStatusLine({ report }),
    ...sectionLines({ lines: report.reasons.map((reason) => `  - ${reason}`), title: "reasons" }),
    ...sectionLines({
      lines: report.readings.map((reading) => {
        const chair = reading.chair ? " (chair)" : "";
        return `  ${reading.alias}${chair}: ${reading.state} — ${reading.reading}`;
      }),
      title: "plans",
    }),
    ...usageLines({ report }),
    ...sectionLines({ lines: report.notes.map((note) => `  - ${note}`), title: "notes" }),
    ...sectionLines({ lines: report.overrides.map((override) => `  ${override}`), title: "overrides" }),
  ];
}

/**
 * One titled section, or nothing when it has no lines.
 *
 * @param title the section's heading word
 * @param lines its lines, already indented
 * @returns the heading and the lines, or none
 */
function sectionLines({ title, lines }: { title: string; lines: readonly string[] }): readonly string[] {
  if (lines.length === 0) {
    return [];
  }
  return [`${title}:`, ...lines];
}
