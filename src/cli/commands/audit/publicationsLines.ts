/**
 * What `audit publications` prints: each door's coverage, the findings counted by door, class and field, and the
 * expectations by position — as text lines or one JSON document. Counts only: nothing found and no link ever appears,
 * because the report these read is already the sanitised shape (`../../../live/publicationAudit/types.ts`).
 */
import { safeJsonStringify } from "../../../lib/safeJson.js";
import type { PublicationAuditReport } from "../../../live/publicationAudit/store.js";
import type { PublicationDoorCoverage } from "../../../live/publicationAudit/types.js";

/**
 * The count lines a run prints: each door's coverage, the findings by door and class, the expectations by position.
 * Nothing found and no link appears.
 */
function publicationAuditLines({
  report,
  met,
}: {
  report: PublicationAuditReport;
  met: readonly boolean[];
}): readonly string[] {
  const withheld =
    report.withheldLinks > 0
      ? [`  links withheld because a rule matched the address: ${String(report.withheldLinks)}`]
      : [];
  return [
    `publication audit — read ${report.readAtIso}`,
    ...report.coverage.flatMap((door) => doorCoverageLines({ door })),
    `findings: ${String(report.findings.length)}`,
    ...Object.entries(report.counts).flatMap(([door, byClass]) =>
      Object.entries(byClass).map(([className, count]) => `  ${door} ${className}: ${String(count)}`),
    ),
    ...fieldTallyLines({ findings: report.findings }),
    ...withheld,
    ...expectationLines({ met }),
    `report: ${report.run}`,
  ];
}

/** One door's coverage line, then a line per gap; a door a report records as not swept says so and nothing else. */
function doorCoverageLines({ door }: { door: PublicationDoorCoverage }): readonly string[] {
  if (door.state === "not-swept") {
    return [`  ${door.door}: not swept by this build`];
  }
  return [
    `  ${door.door}: ${door.state} — ${String(door.objects)} object(s), ${String(door.texts)} text(s), ` +
      `${String(door.attachmentsNotSwept)} uploaded file(s) not swept`,
    ...door.gaps.map((gap) => `    gap: ${gap}`),
  ];
}

/** The findings tallied by the field they sat in, sorted by field; nothing when there is no finding. */
function fieldTallyLines({ findings }: { findings: PublicationAuditReport["findings"] }): readonly string[] {
  const byField = new Map<string, number>();
  for (const field of findings.flatMap((finding) => finding.fields)) {
    const before = byField.get(field);
    byField.set(field, before === undefined ? 1 : before + 1);
  }
  if (byField.size === 0) {
    return [];
  }
  const fields = [...byField.entries()].toSorted(([left], [right]) => left.localeCompare(right));
  return [`  by field: ${fields.map(([field, count]) => `${field} ${String(count)}`).join(", ")}`];
}

/** How many expectations were met, naming the missed ones by position; nothing when none was named. */
function expectationLines({ met }: { met: readonly boolean[] }): readonly string[] {
  if (met.length === 0) {
    return [];
  }
  const missed = met.flatMap((wasMet, index) => (wasMet ? [] : [`#${String(index + 1)}`]));
  const tail = missed.length === 0 ? "" : ` (missed: ${missed.join(", ")})`;
  return [`expectations: ${String(met.length - missed.length)} of ${String(met.length)} met${tail}`];
}

/**
 * Print the counts: the JSON document or the text lines. Never a finding.
 *
 * @param out the stdout sink, one line per call
 */
export function printPublicationAudit({
  report,
  met,
  json,
  out,
}: {
  report: PublicationAuditReport;
  met: readonly boolean[];
  json: boolean;
  out: (args: { line: string }) => void;
}): void {
  if (!json) {
    for (const line of publicationAuditLines({ met, report })) {
      out({ line });
    }
    return;
  }
  out({
    line: safeJsonStringify({
      label: "the publication audit counts",
      space: 2,
      value: {
        counts: report.counts,
        coverage: report.coverage,
        expectationsMet: met,
        findings: report.findings.length,
        readAtIso: report.readAtIso,
        report: report.run,
        withheldLinks: report.withheldLinks,
      },
    }),
  });
}
