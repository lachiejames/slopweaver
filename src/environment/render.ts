/**
 * The `environment:` section of `doctor`'s report and its closing verdict line — pure renderers over the
 * graded probes, so the report reads the same whichever caller printed it.
 */
import { DEEP_FLAG, type EnvironmentProbe, type ProbeVerdict } from "./facts.js";
import { probeTally } from "./probes.js";

/** The tag each verdict leads its line with. */
const VERDICT_TAG: Readonly<Record<ProbeVerdict, string>> = {
  fatal: "[FATAL]",
  ok: "[ok]",
  unchecked: "[unchecked]",
  warning: "[warning]",
};

/**
 * Render the environment section: one line per probe, and under every non-ok one its fix and what
 * continuing without it costs.
 *
 * @param probes the graded probes, in display order
 * @param deep whether the costed probes ran, so the header can say which ones did not
 * @returns the section's lines, or none when there are no probes to render
 */
export function environmentSection({
  probes,
  deep,
}: {
  probes: readonly EnvironmentProbe[];
  deep: boolean;
}): readonly string[] {
  if (probes.length === 0) {
    return [];
  }
  const header = deep
    ? "environment (every probe, including gh login, the cmux socket and zsh startup):"
    : `environment (free probes only — \`doctor ${DEEP_FLAG}\` also checks gh login, the cmux socket and zsh startup):`;
  const lines = [header];
  for (const probe of probes) {
    const scope = probe.scope === "dev-environment" ? " (developer health, not a Slopweaver requirement)" : "";
    lines.push(`  ${VERDICT_TAG[probe.verdict]} ${probe.id}${scope} — ${probe.says}`);
    if (probe.fix !== null) {
      lines.push(`      fix: ${probe.fix}`);
    }
    if (probe.withoutFix !== null) {
      lines.push(`      continuing without it: ${probe.withoutFix}`);
    }
  }
  return lines;
}

/**
 * The report's last line: `ok` only when nothing is fatal, and the fatal probes named when something is.
 *
 * @param probes the graded probes
 * @returns the closing line
 */
export function verdictLine({ probes }: { probes: readonly EnvironmentProbe[] }): string {
  const tally = probeTally({ probes });
  if (tally.fatal > 0) {
    const names = probes.filter((probe) => probe.verdict === "fatal").map((probe) => probe.id);
    return `FATAL — Slopweaver cannot run on this machine until ${names.join(", ")} ${names.length === 1 ? "is" : "are"} fixed`;
  }
  if (tally.warnings > 0) {
    return `ok — ${String(tally.warnings)} warning(s) above`;
  }
  return "ok";
}
