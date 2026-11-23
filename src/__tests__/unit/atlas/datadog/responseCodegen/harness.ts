/*
 * What the Datadog response-codegen test files share: one pinned specification with a component per shape a
 * test reads, the census a set of answers produces, one generation call over an inline schema, and the
 * `schema:` source cut out of the generated boundary.
 */
import {
  type DatadogOperationCensus,
  type DatadogResponseCensus,
  observeDatadogAnswer,
} from "../../../../../atlas/datadog/responseCensus.js";
import { datadogBoundarySource } from "../../../../../atlas/datadog/responseCodegen.js";

/** A pinned specification with one component per shape a test reads. */
export const DOCUMENT = {
  components: {
    schemas: {
      Free: { type: "object" },
      Mixed: { additionalProperties: { type: "string" }, properties: { a: { type: "string" } }, type: "object" },
      Node: { properties: { child: { $ref: "#/components/schemas/Node" }, name: { type: "string" } }, type: "object" },
      Tags: { additionalProperties: { properties: { n: { type: "integer" } }, type: "object" }, type: "object" },
      Untyped: { additionalProperties: true, type: "object" },
    },
  },
} as const;

/**
 * The census one operation's answers produce.
 *
 * @param answers the 2xx answer texts observed for the one operation, in order
 * @returns the operation's census
 */
export function censusOf({ answers }: { answers: readonly string[] }): DatadogOperationCensus {
  const census: DatadogResponseCensus = { operations: {}, takenAt: "2026-10-23T00:00:00.000Z" };
  for (const text of answers) {
    observeDatadogAnswer({ census, status: 200, surface: "op", text });
  }
  // oxlint-disable-next-line typescript/no-non-null-assertion -- every observation above records under "op"; a guard would add a failure path the old in-file helper never had
  return census.operations["op"]!;
}

/**
 * Generate one operation's boundary from an inline schema.
 *
 * @param answers the answers to measure, or null for an operation that never answered
 * @returns the generation result for the one operation
 */
export function generate({
  schema,
  answers,
}: {
  schema: unknown;
  answers: readonly string[] | null;
}): ReturnType<typeof datadogBoundarySource> {
  return datadogBoundarySource({
    census: answers === null ? null : censusOf({ answers }),
    document: DOCUMENT,
    schema: { node: schema, stack: [] },
    surface: "op",
  });
}

/**
 * The `schema:` source alone, out of the whole `defineDatadogResponseBoundary` call.
 *
 * @param source the generated boundary call text
 * @returns the text of its schema argument
 */
export function schemaOf({ source }: { source: string }): string {
  // oxlint-disable-next-line typescript/no-non-null-assertion -- a source not matching the boundary call shape throws here, exactly as the old in-file helper did
  return /^defineDatadogResponseBoundary\(\{ schema: (.*), source: "[a-z-]+", surface: "op" \}\)$/.exec(source)![1]!;
}
