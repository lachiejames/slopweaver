/**
 * The PURE core of `slopweaver atlas vanta test-entities`: flag parsing, the list of tests a sweep reads,
 * and the rendering and grading of what the sweep found. No fs, no clock, no network — `testEntitiesRun.ts`
 * does every read.
 *
 * ## What a zero from this verb does and does not prove
 *
 * The verb reads Vanta LIVE, one test at a time, so a test it read and found empty is a measured zero for
 * that test. But the LIST of tests a sweep walks is the stored `test` kind, which is as old as the last
 * `atlas vanta sync`: a test Vanta added since is not in it, and a test the sync marked stale is not
 * walked. So every rendering names how many tests were read, how many failed, how many stored tests were
 * left out and when the list was stored — and a zero is only ever stated with that boundary beside it.
 *
 * ## What the API does not say, stated so nobody reads it in
 *
 * `TestResourceEntity` carries `deactivatedReason` and `lastUpdatedDate`, and nothing naming who
 * deactivated an entity or when. `lastUpdatedDate` is the last change of any kind, so it is printed under
 * that name and never as a deactivation date.
 */
import {
  VANTA_TEST_ENTITY_STATUSES,
  type VantaTestEntityDto,
  type VantaTestEntityStatus,
} from "../../../atlas/vanta/controlEvidenceApiSchemas.js";
import type { VantaKindFile } from "../../../atlas/vanta/model.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValue, flagValueOr, parseFlagTail, positiveIntFlag } from "../../optionParsers.js";

/** How many entity rows a run prints when `--limit` is absent. */
const DEFAULT_ROW_LIMIT = 200;

/**
 * A validated `vanta test-entities` invocation.
 *
 * @internal
 */
export interface VantaTestEntitiesOptions {
  readonly home: string;
  readonly json: boolean;
  readonly status: VantaTestEntityStatus;
  /** One test to read, or `null` to sweep every test the stored `test` kind holds. */
  readonly testId: string | null;
  /** The most entity rows printed; the counts always cover every row read. */
  readonly limit: number;
  readonly clientIdFile: string | null;
  readonly clientSecretFile: string | null;
}

/**
 * Every flag the verb accepts, so `vantaVerbFlagTruth.test.ts` can probe the real parser with each one.
 *
 * @internal
 */
export const VANTA_TEST_ENTITIES_FLAG_NAMES: readonly string[] = [
  "--client-id-file",
  "--client-secret-file",
  "--home",
  "--json",
  "--limit",
  "--status",
  "--test",
];

/** Narrow a raw `--status` value to the spec's enum, or `null` when it is not one of its members. */
function asEntityStatus({ raw }: { raw: string }): VantaTestEntityStatus | null {
  for (const status of VANTA_TEST_ENTITY_STATUSES) {
    if (status === raw) {
      return status;
    }
  }
  return null;
}

/**
 * Parse the tail of `vanta test-entities`.
 *
 * @param rest the argv tail after the verb
 * @param defaultHome the home to use when `--home` is absent
 * @returns the validated options, or every rejection at once
 */
export function parseVantaTestEntitiesOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<VantaTestEntitiesOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: {
      boolean: ["json"],
      value: ["home", "status", "test", "limit", "client-id-file", "client-secret-file"],
    },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const problems: string[] = [];
  const rawStatus = flagValue({ name: "status", parsed: parsed.value });
  const status = rawStatus === null ? null : asEntityStatus({ raw: rawStatus });
  if (status === null) {
    problems.push(
      `--status is required and must be one of ${VANTA_TEST_ENTITY_STATUSES.join("|")} — Vanta's own ` +
        "entityStatus values; it answers FAILING when none is sent, so this verb never leaves it implicit",
    );
  }
  const testId = flagValue({ name: "test", parsed: parsed.value });
  if (testId === "") {
    problems.push("--test was given an empty value — pass a test id, or omit it to sweep every stored test");
  }
  const limit = positiveIntFlag({ fallback: DEFAULT_ROW_LIMIT, name: "limit", problems, values: parsed.value.values });
  if (status === null || problems.length > 0) {
    return err(problems);
  }
  return ok({
    clientIdFile: flagValue({ name: "client-id-file", parsed: parsed.value }),
    clientSecretFile: flagValue({ name: "client-secret-file", parsed: parsed.value }),
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: parsed.value.flags.has("json"),
    limit,
    status,
    testId,
  });
}

/**
 * One test a sweep reads, with the name the stored generation holds for it.
 *
 * @internal
 */
export interface VantaSweepTarget {
  readonly testId: string;
  /** The test's name as last synced, or `null` when the stored detail carries none. */
  readonly testName: string | null;
}

/**
 * The tests a sweep walks, taken from the stored `test` kind.
 *
 * @internal
 */
export interface VantaSweepPlan {
  readonly targets: readonly VantaSweepTarget[];
  /** Stored tests left out because the last sync no longer saw them through the Manage API. */
  readonly notWalked: number;
  /** When the stored list was written — the age of the denominator. */
  readonly storedAt: string;
}

/** The `name` a stored Manage API test detail carries, read without trusting its shape. */
function storedTestName({ detail }: { detail: unknown }): string | null {
  if (typeof detail !== "object" || detail === null || !("name" in detail)) {
    return null;
  }
  const name: unknown = detail.name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

/**
 * Reduce the stored `test` kind to the tests a sweep reads: every entity the last sync observed through
 * the Manage API, in stored order. Anything else is counted, never silently dropped.
 *
 * @param file the stored `test` kind file
 * @returns the plan
 */
export function sweepPlanFromKindFile({ file }: { file: VantaKindFile }): VantaSweepPlan {
  const targets: VantaSweepTarget[] = [];
  let notWalked = 0;
  for (const entity of file.entities) {
    const channel = entity.channels["manage-api"];
    if (channel?.state !== "observed") {
      notWalked += 1;
      continue;
    }
    targets.push({ testId: entity.providerId, testName: storedTestName({ detail: channel.detail }) });
  }
  return { notWalked, storedAt: file.updatedAt, targets };
}

/**
 * What reading one test answered.
 *
 * @internal
 */
export type VantaTestRead =
  | { readonly target: VantaSweepTarget; readonly kind: "read"; readonly entities: readonly VantaTestEntityDto[] }
  | { readonly target: VantaSweepTarget; readonly kind: "failed"; readonly reasons: readonly string[] };

/**
 * A finished read — one named test, or a sweep of the stored list.
 *
 * @internal
 */
export interface VantaTestEntitySweep {
  readonly status: VantaTestEntityStatus;
  /** `null` for a single named test; the stored list's plan for a sweep. */
  readonly plan: VantaSweepPlan | null;
  readonly reads: readonly VantaTestRead[];
}

/** The counts every rendering leads with. */
function sweepCounts({ sweep }: { sweep: VantaTestEntitySweep }): {
  readonly read: number;
  readonly failed: number;
  readonly entities: number;
} {
  let read = 0;
  let failed = 0;
  let entities = 0;
  for (const outcome of sweep.reads) {
    if (outcome.kind === "read") {
      read += 1;
      entities += outcome.entities.length;
    } else {
      failed += 1;
    }
  }
  return { entities, failed, read };
}

/** The sentence that bounds the answer: what was walked, out of what, and how old that list is. */
function scopeLine({ sweep }: { sweep: VantaTestEntitySweep }): string {
  const { read, failed } = sweepCounts({ sweep });
  if (sweep.plan === null) {
    return failed === 0 ? "scope: the one named test, read live" : "scope: the one named test, whose read FAILED";
  }
  return (
    `scope: read ${String(read)} of the ${String(sweep.plan.targets.length)} tests the stored list holds ` +
    `(stored ${sweep.plan.storedAt}), ${String(failed)} failed, ${String(sweep.plan.notWalked)} stored ` +
    "test(s) not walked because the last sync marked them stale"
  );
}

/** What a zero does and does not prove, given how much of the list was actually read. */
function zeroLine({ sweep }: { sweep: VantaTestEntitySweep }): string {
  const { failed } = sweepCounts({ sweep });
  if (failed > 0) {
    return `a zero here is NOT a none: ${String(failed)} test(s) could not be read, and their entities are unknown`;
  }
  if (sweep.plan === null) {
    return "a measured zero for this test at this moment";
  }
  return (
    "a measured zero across every walked test — a test added after the stored list was written, or one not " +
    "walked, is outside it"
  );
}

/** The reason line, which says so when Vanta recorded none rather than printing an empty reason. */
function reasonLine({ entity }: { entity: VantaTestEntityDto }): string {
  if (entity.deactivatedReason === null) {
    return "    reason: (none recorded)";
  }
  return `    reason: ${entity.deactivatedReason}`;
}

/** The dates line; either date Vanta left null prints as `(none)`. */
function datesLine({ entity }: { entity: VantaTestEntityDto }): string {
  const dates = [entity.lastUpdatedDate, entity.createdDate].map((date) => {
    if (date === null) {
      return "(none)";
    }
    return date;
  });
  return `    Vanta's last-updated date: ${dates.join(" · created: ")}`;
}

/** A test's heading, which says so when the stored generation holds no name for it. */
function testHeading({ target }: { target: VantaSweepTarget }): string {
  if (target.testName === null) {
    return `${target.testId} · (no stored name)`;
  }
  return `${target.testId} · ${target.testName}`;
}

/** The three lines one entity prints as. */
function entityLines({ entity }: { entity: VantaTestEntityDto }): readonly string[] {
  return [
    `  ${entity.displayName} (${entity.id}) · ${entity.responseType}`,
    reasonLine({ entity }),
    datesLine({ entity }),
  ];
}

/** Each read test's heading and entity rows, stopping once `limit` rows are printed. */
function entityRowLines({ sweep, limit }: { sweep: VantaTestEntitySweep; limit: number }): {
  readonly lines: readonly string[];
  readonly printed: number;
} {
  const lines: string[] = [];
  let printed = 0;
  for (const outcome of sweep.reads) {
    if (outcome.kind !== "read" || outcome.entities.length === 0) {
      continue;
    }
    lines.push("", testHeading({ target: outcome.target }));
    const shown = outcome.entities.slice(0, Math.max(0, limit - printed));
    printed += shown.length;
    for (const entity of shown) {
      lines.push(...entityLines({ entity }));
    }
  }
  return { lines, printed };
}

/** Every test whose read failed, with its reasons — empty when none did. */
function failureLines({ sweep }: { sweep: VantaTestEntitySweep }): readonly string[] {
  const failures = sweep.reads.flatMap((outcome) => (outcome.kind === "failed" ? [outcome] : []));
  if (failures.length === 0) {
    return [];
  }
  return [
    "",
    `FAILED to read ${String(failures.length)} test(s):`,
    ...failures.map((failure) => `  ${failure.target.testId}: ${failure.reasons.join(" · ")}`),
  ];
}

/**
 * The human lines for a finished read: the counts, the scope, each entity row up to `limit`, each failed
 * test, and what a zero does or does not prove.
 *
 * @param sweep what was read
 * @param limit the most entity rows printed
 * @returns the lines, in display order
 */
export function renderVantaTestEntitySweep({
  sweep,
  limit,
}: {
  sweep: VantaTestEntitySweep;
  limit: number;
}): readonly string[] {
  const { entities } = sweepCounts({ sweep });
  const lines = [`vanta test-entities --status ${sweep.status}: ${String(entities)} entit(ies)`, scopeLine({ sweep })];
  if (entities === 0) {
    lines.push(zeroLine({ sweep }));
  }
  const rows = entityRowLines({ limit, sweep });
  lines.push(...rows.lines);
  if (rows.printed < entities) {
    lines.push("", `${String(entities - rows.printed)} more entit(ies) not printed — raise --limit to see them`);
  }
  lines.push(...failureLines({ sweep }));
  lines.push(
    "",
    "who deactivated an entity, and when, is not in this API: lastUpdatedDate is the last change of any kind",
  );
  return lines;
}

/**
 * The machine-readable form: the same counts and scope, the entity rows up to `limit`, every failure.
 *
 * @param sweep what was read
 * @param limit the most entity rows included
 * @returns a JSON-serialisable document
 */
export function vantaTestEntitySweepDocument({
  sweep,
  limit,
}: {
  sweep: VantaTestEntitySweep;
  limit: number;
}): Readonly<Record<string, unknown>> {
  const counts = sweepCounts({ sweep });
  const rows = sweep.reads
    .flatMap((outcome) =>
      outcome.kind === "read"
        ? outcome.entities.map((entity) => ({
            ...entity,
            testId: outcome.target.testId,
            testName: outcome.target.testName,
          }))
        : [],
    )
    .slice(0, limit);
  return {
    entities: rows,
    entityCount: counts.entities,
    failed: sweep.reads.flatMap((outcome) =>
      outcome.kind === "failed" ? [{ reasons: outcome.reasons, testId: outcome.target.testId }] : [],
    ),
    printed: rows.length,
    scope: scopeLine({ sweep }),
    status: sweep.status,
    testsFailed: counts.failed,
    testsRead: counts.read,
    zero: counts.entities === 0 ? zeroLine({ sweep }) : null,
  };
}

/**
 * The exit code a finished read earns: any test that could not be read makes the answer partial.
 *
 * @param sweep what was read
 * @param exitOk the code for a read with no failed test
 * @param exitError the code for a partial read
 * @returns the exit code
 */
export function exitCodeForVantaTestEntitySweep({
  sweep,
  exitOk,
  exitError,
}: {
  sweep: VantaTestEntitySweep;
  exitOk: number;
  exitError: number;
}): number {
  return sweepCounts({ sweep }).failed === 0 ? exitOk : exitError;
}
