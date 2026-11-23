/**
 * The kind census the Datadog atlas's `DATADOG_KINDS` list rests on, as a command that can be run again.
 *
 * ```bash
 * yarn tsx tools/datadogKindCensus.ts
 * ```
 *
 * ## Why this is a committed tool rather than a number in a comment
 *
 * `.claude/rules/typescript-patterns.md`: a comment citing a measurement carries the command that
 * reproduces it. `model.ts` states that its list was 116 when it landed and that widening it to every kind
 * the registry carries recovered 50 rows across 28 kinds — including 23 `shape-index` operations that would
 * have had no file to be published into. Without this file that citation would be prose nobody could check.
 *
 * ## What it reports
 *
 * The registry's kinds against the model's declared list, in both directions, and the row count and
 * disposition breakdown of anything in one and not the other. A clean run prints zero on both differences;
 * a non-zero `in the registry, not declared` is exactly the condition `sync.ts` refuses to publish under,
 * because a row with no kind file is a row the atlas would silently drop.
 *
 * It also reports the PARAMETERLESS entity operations — those whose path carries no `{brace}` parameter, so
 * a live pass can issue them with nothing but the two keys. That number is the one `descriptor.ts` cites
 * when it says what the `api` surface still needs, and it is the tractable half of the live work.
 */
import { DATADOG_SURFACES } from "../src/atlas/datadog/generated/surfaces.js";
import { DATADOG_KINDS } from "../src/atlas/datadog/model.js";
import type { DatadogDisposition } from "../src/atlas/datadog/surfaceRow.js";

/**
 * How many rows carry each disposition, over a subset of the registry.
 *
 * @param rows the rows to fold
 * @returns the counts, with every disposition present so a zero never goes missing
 */
function dispositions({ rows }: { rows: readonly { disposition: DatadogDisposition }[] }): Record<string, number> {
  const counts: Record<DatadogDisposition, number> = { entity: 0, excluded: 0, "probe-only": 0, "shape-index": 0 };
  for (const row of rows) {
    counts[row.disposition] += 1;
  }
  return counts;
}

const declared = new Set<string>(DATADOG_KINDS);
const registryKinds = [...new Set(DATADOG_SURFACES.map((row) => row.kind))].toSorted();
const undeclared = registryKinds.filter((kind) => !declared.has(kind));
const unbacked = [...declared].filter((kind) => !registryKinds.includes(kind)).toSorted();
const undeclaredRows = DATADOG_SURFACES.filter((row) => undeclared.includes(row.kind));
const entityRows = DATADOG_SURFACES.filter((row) => row.disposition === "entity");
const parameterless = entityRows.filter((row) => !row.path.includes("{"));

process.stdout.write(
  [
    `registry rows: ${String(DATADOG_SURFACES.length)}`,
    `registry kinds: ${String(registryKinds.length)}`,
    `DATADOG_KINDS: ${String(DATADOG_KINDS.length)}`,
    `in the registry, not declared: ${String(undeclared.length)} kind(s), ${String(undeclaredRows.length)} row(s)`,
    undeclared.length === 0 ? "" : `  ${undeclared.join(", ")}`,
    undeclared.length === 0 ? "" : `  dispositions: ${JSON.stringify(dispositions({ rows: undeclaredRows }))}`,
    `declared, with no registry row: ${String(unbacked.length)} kind(s)`,
    unbacked.length === 0 ? "" : `  ${unbacked.join(", ")}`,
    `whole-registry dispositions: ${JSON.stringify(dispositions({ rows: DATADOG_SURFACES }))}`,
    `entity operations taking no path parameter: ${String(parameterless.length)} of ${String(entityRows.length)}`,
    "",
  ]
    .filter((line, index, all) => line.length > 0 || index === all.length - 1)
    .join("\n"),
);
