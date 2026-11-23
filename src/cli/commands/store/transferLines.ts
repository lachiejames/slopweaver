/**
 * What `store export` and `store import` print: one line per part in registry order, then the digest, and
 * for an import the plan against the live store, every question it raises and what an approval staged — the
 * same facts as one `--json` document. Pure.
 */
import { contentDigest, type PartReading } from "../../../store/transfer/bundleRead.js";
import type { ImportPlan, ImportQuestion } from "../../../store/transfer/compare.js";
import type { StageImportOutcome } from "../../../store/transfer/importStore.js";

/** The `--json` document both verbs print. */
export interface TransferReport {
  readonly verb: "export" | "import";
  readonly dir: string;
  readonly manifested: boolean;
  readonly parts: readonly PartReading[];
  readonly digest: string;
  /** An import's comparison with the live store; `null` for an export. */
  readonly plan: ImportPlan | null;
  /** What an approved import staged; `null` for an export or a plan nobody approved. */
  readonly stage: StageImportOutcome | null;
  /** Store rows this run wrote: a staging's, else `0` — an export writes files, and a plan writes nothing. */
  readonly writes: number;
}

/**
 * The report for a set of part readings.
 *
 * @param verb which verb ran
 * @param dir the export it wrote or read
 * @param manifested whether the export carried, or was written with, a manifest
 * @param parts every part's reading, in registry order
 * @param plan an import's comparison with the live store, `null` for an export
 * @param stage what an approved import staged, `null` when nothing was approved
 * @returns the report, its digest computed over the parts and its writes taken from the staging
 */
export function transferReport({
  verb,
  dir,
  manifested,
  parts,
  plan,
  stage,
}: {
  verb: "export" | "import";
  dir: string;
  manifested: boolean;
  parts: readonly PartReading[];
  plan: ImportPlan | null;
  stage: StageImportOutcome | null;
}): TransferReport {
  const writes = stage === null ? 0 : stage.writes;
  return { digest: contentDigest({ parts }), dir, manifested, parts, plan, stage, verb, writes };
}

/** The closing line of an import: what was staged, or that it only planned. */
function stageLine({ stage }: { stage: StageImportOutcome | null }): string {
  if (stage === null) {
    return "  planned only: compared with the live store, and nothing was written";
  }
  if (stage.outcome === "already-staged") {
    return `  already staged as batch ${stage.batchId}: 0 rows written; nothing is live`;
  }
  return `  staged batch ${stage.batchId}: ${String(stage.items)} item(s), ${String(stage.questions)} question(s), ${String(stage.writes)} row(s) written; nothing is live`;
}

/** One question as the lines a person answers it from. */
function questionLines({ question }: { question: ImportQuestion }): readonly string[] {
  const head = `  ${question.id}  ${question.kind}  ${question.part} ${question.key}`;
  const imported = `      imported: ${question.imported}`;
  const answers = `      answers: ${question.actions.join(" | ")}`;
  if (question.live === null) {
    return [head, imported, answers];
  }
  return [head, imported, `      current:  ${question.live}`, answers];
}

/** The plan as lines: each part's counts, then every question. */
function planLines({ plan }: { plan: ImportPlan }): readonly string[] {
  const width = Math.max(...plan.parts.map((part) => part.kind.length));
  const rows = plan.parts.map((part) => {
    const name = part.kind.padEnd(width);
    if (part.status === "unavailable") {
      return `  ${name}  not in this export — the store's rows are left as they are`;
    }
    return `  ${name}  ${String(part.new).padStart(6)} new  ${String(part.identical).padStart(6)} identical  ${String(part.conflicting).padStart(6)} conflicting  (${part.role})`;
  });
  const asked =
    plan.questions.length === 0
      ? ["  no questions: nothing in this export needs a decision before it is restored"]
      : [`  ${String(plan.questions.length)} question(s) to answer before anything takes effect:`];
  const unmet =
    plan.unmet.length === 0
      ? []
      : [
          `  ${String(plan.unmet.length)} need(s) nothing live or written provides, so this export will not apply as planned:`,
          ...plan.unmet.map((one) => `    ${one.part} ${one.key} needs ${one.needs}`),
        ];
  return [
    "  against the live store:",
    ...rows,
    ...asked,
    ...plan.questions.flatMap((question) => questionLines({ question })),
    ...unmet,
    `  plan ${plan.digest}`,
  ];
}

/**
 * The report as lines a person reads.
 *
 * @param report what the run found
 * @returns the heading, one line per part, the digest, an import's plan, and what was written
 */
export function transferLines({ report }: { report: TransferReport }): readonly string[] {
  const width = Math.max(...report.parts.map((part) => part.kind.length));
  const heading =
    report.verb === "export"
      ? `store export: wrote ${report.dir}`
      : `store import: ${report.dir} (${report.manifested ? "every part matches its manifest" : "no manifest — read as an unmanifested export"})`;
  const rows = report.parts.map((part) => {
    const name = part.kind.padEnd(width);
    if (part.status === "unavailable") {
      return `  ${name}  unavailable — this export holds no such file`;
    }
    return `  ${name}  ${String(part.rows).padStart(6)} row(s)  ${String(part.bytes).padStart(10)} bytes  sha256:${part.sha256.slice(0, 12)}`;
  });
  if (report.plan === null) {
    const closing =
      "  re-read with the import's own reader before publishing; nothing in the store or the home changed";
    return [heading, ...rows, `  digest ${report.digest}`, closing];
  }
  return [
    heading,
    ...rows,
    `  digest ${report.digest}`,
    ...planLines({ plan: report.plan }),
    stageLine({ stage: report.stage }),
  ];
}
