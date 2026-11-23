/**
 * Turning findings into the three shapes a caller needs: a human report, machine JSON, and a Claude Code hook
 * payload. Pure — the caller decides which stream each goes to.
 *
 * All three render from the SAME finding array, so a hook can never report something `memory check` would not.
 */
import type { MemoryFinding } from "./types.js";

/** The hook events this checker is wired to. Both accept `additionalContext`; neither can block. */
export type MemoryHookEvent = "PostToolUse" | "SessionStart";

/** One finding as a single line: `[check] file:line - message`. */
function findingLine({ finding }: { finding: MemoryFinding }): string {
  const at = finding.line === null ? finding.file : `${finding.file}:${String(finding.line)}`;
  return `  [${finding.check}] ${at} — ${finding.message}`;
}

/**
 * The human report.
 *
 * @param findings the findings, already in canonical order
 * @returns the lines to print, one per finding under a count header
 */
export function renderMemoryHuman({ findings }: { findings: readonly MemoryFinding[] }): readonly string[] {
  if (findings.length === 0) {
    return ["memory: clean"];
  }
  return [`memory: ${String(findings.length)} problem(s)`, ...findings.map((finding) => findingLine({ finding }))];
}

/**
 * The machine shape, for `--json`.
 *
 * @param findings the findings, already in canonical order
 * @returns pretty-printed JSON, safe to pipe
 */
export function renderMemoryJson({ findings }: { findings: readonly MemoryFinding[] }): string {
  return JSON.stringify(findings, null, 2);
}

/**
 * The Claude Code hook payload, or `null` when there is nothing to say.
 *
 * `null` rather than an empty object is deliberate: a hook that prints nothing on a clean corpus costs the
 * session no context at all, and silence is the correct output for "no problem".
 *
 * @param findings the findings, already in canonical order
 * @param event which hook is reporting — the payload must echo its own event name
 * @param problems failures outside the corpus checker that this same hook must surface
 * @returns one compact JSON object for stdout, or `null` to print nothing
 */
export function renderMemoryHookOutput({
  findings,
  event,
  problems = [],
}: {
  findings: readonly MemoryFinding[];
  event: MemoryHookEvent;
  problems?: readonly string[];
}): string | null {
  if (findings.length === 0 && problems.length === 0) {
    return null;
  }
  const corpusReport =
    findings.length === 0
      ? []
      : [
          "The memory corpus has integrity problems. Fix these before moving on:",
          "",
          ...renderMemoryHuman({ findings }),
        ];
  const directiveReport =
    problems.length === 0
      ? []
      : [
          "The current-owner directive fast path failed. Fix this before relying on the next live turn:",
          "",
          ...problems.map((problem) => `  ${problem}`),
        ];
  const report = [
    ...corpusReport,
    ...(corpusReport.length > 0 && directiveReport.length > 0 ? [""] : []),
    ...directiveReport,
  ].join("\n");
  return JSON.stringify({ hookSpecificOutput: { additionalContext: report, hookEventName: event } });
}
