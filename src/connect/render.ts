/**
 * Render a {@link ConnectCheckReport} for humans (a line-based report, like `doctor`) or for the slash
 * command (`--json` — the report object verbatim, already value-free + stable-keyed). Pure: no I/O, no
 * clock; the report never carries a token/email/payload, so both renderings are transcript-safe.
 */
import type { CapabilityStatus, ConnectCheckReport } from "./types.js";

/** The status glyph for the text report — a stable ASCII marker per verdict. */
const STATUS_MARK: Record<CapabilityStatus, string> = { missing: "✗", ok: "✓", warning: "!" };

/**
 * What the verdict line names. `slopweaver connect` itself passes no heading, so the line names the check it
 * ran; only a verb reusing this report in its own voice (`slopweaver listen`) names one.
 */
function verdictHeading({ heading, source }: { heading: string | undefined; source: string }): string {
  if (heading === undefined) {
    return `connect ${source}`;
  }
  return heading;
}

/**
 * Render the human report lines: a headline verdict, then one line per capability, then any warnings/errors.
 *
 * @param report the finalised preflight report
 * @param heading what the verdict line names — `connect <source>` by default. `slopweaver listen` passes its
 *   own, so a credential refusal reads in ONE voice across the CLI rather than growing a second report style
 *   for every verb that has to say "a token is missing"
 * @returns the report lines, in display order
 */
export function renderConnectText({
  report,
  heading,
}: {
  report: ConnectCheckReport;
  heading?: string;
}): readonly string[] {
  const headline = report.ok ? "OK" : "NOT READY";
  const lines = [`${verdictHeading({ heading, source: report.source })}: ${headline}`];
  if (report.fixture !== undefined) {
    lines.push(`  (fixture: ${report.fixture.scenario} — no credential or network was checked)`);
  }
  for (const cap of report.capabilities) {
    lines.push(`  ${STATUS_MARK[cap.status]} ${cap.id}: ${cap.detail}`);
  }
  for (const warning of report.warnings) {
    lines.push(`  ! ${warning}`);
  }
  for (const error of report.errors) {
    lines.push(`  ✗ ${error}`);
  }
  return lines;
}

/**
 * Render the machine-readable report the slash command branches on. Stable key order (via the typed
 * object), value-free.
 *
 * @param report the finalised preflight report
 * @returns the JSON string
 */
export function renderConnectJson({ report }: { report: ConnectCheckReport }): string {
  return JSON.stringify(
    {
      capabilities: report.capabilities,
      errors: report.errors,
      ...(report.fixture !== undefined ? { fixture: report.fixture } : {}),
      ok: report.ok,
      source: report.source,
      tokenPresent: report.tokenPresent,
      warnings: report.warnings,
    },
    null,
    2,
  );
}
