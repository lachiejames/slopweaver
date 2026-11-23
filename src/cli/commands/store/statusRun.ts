/**
 * `slopweaver store status` — what the store holds, whether it is reachable, and how far behind bronze
 * it sits.
 *
 * Its own runner rather than a section of `./run.ts` because it is the one verb in the noun that reads
 * something OTHER than the store: the drift report scans this home's bronze window files and probes the
 * store for their ids, so the verb's dependencies are the union of two trees rather than the query layer
 * alone. The scan itself is `../../../store/bronzeDrift.ts`; every rendered line is pure and lives in
 * `../../../store/bronzeDriftCore.ts`.
 */

import { installedTreeRoot } from "#lib/pluginRoot.js";
import type { CorpusSource } from "../../../corpus/types.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import type { ProtectedPath } from "../../../protectedPaths/registry.js";
import { measureBronzeDrift, type PresenceProbe, storePresenceProbe } from "../../../store/bronzeDrift.js";
import { type BronzeDriftReport, driftLines } from "../../../store/bronzeDriftCore.js";
import { countContent, facetContent, openStore, type StoreClient, storeUrl } from "../../../store/client.js";
import type { StoreError } from "../../../store/errors.js";
import { verifyStore } from "../../../store/lifecycle.js";
import { verifyLines } from "../../../store/lifecycleVerify.js";
import { ownerProtectionFor } from "../../../store/protectedBronze.js";
import { contentSourceEnum } from "../../../store/schema/enums.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

import { facetLines, parseStoreReadArgs, storeTail } from "./core.js";
import { storeCommandErrorLines } from "./errors.js";
import { parseStoreStatusArgs, type StoreStatusArgs } from "./statusCore.js";
import { refuse } from "./verbShell.js";

const STATUS_USAGE =
  "usage: slopweaver store status [--home <dir>] [--json] [--source <s>] [--full] [--check]\n" +
  "  Always reports bronze DRIFT — how many native ids this home's bronze offers that the store does not\n" +
  "  hold — because a store sitting permanently short of bronze used to be invisible. --source bounds the\n" +
  "  scan to one source; --full adds the canonical compact.jsonl, which is the whole corpus and costs\n" +
  "  accordingly; --check exits 1 when anything is missing OR the scan could not be completed, so the\n" +
  "  report doubles as a gate. Without --check a scan failure is a printed line and not an exit code.\n" +
  "  A source whose bronze reaches a no-access path on the owner's protect list (`slopweaver protect list`) is\n" +
  "  NOT SCANNED: one line names the entry, nothing of it is read, no repair line is printed, and it does not\n" +
  "  fail --check. A protect list that cannot be read stops the scan (NOT MEASURED), which --check fails.";

/**
 * Measure bronze-vs-store drift for the sources the invocation asked about.
 *
 * Sources are measured one at a time rather than concurrently: each scan holds a slice of one bronze file
 * in memory and the store probe is an index lookup either way, so overlapping them buys little and makes
 * the transient the product of however many sources exist.
 *
 * A source whose bronze reaches a `no-access` path on the owner's protect list is WITHHELD — recorded, never
 * listed or read — and the scan carries on with the rest. A protect list that could not be read stops the
 * whole scan before any source is touched, because which bronze is off limits is then unknown.
 *
 * @param args the parsed status invocation
 * @param probe what answers which of the scanned ids the store already holds
 * @param protection the owner's protect-list entries, or why they could not be read
 * @returns the reports in enum order and the withheld sources, or the first failure that stopped a measurement
 * @internal exported for its own test, which drives it over a throwaway home with a plain probe.
 */
export async function statusDrift({
  args,
  probe,
  protection,
}: {
  args: StoreStatusArgs;
  probe: PresenceProbe;
  protection: Result<readonly ProtectedPath[], StoreError>;
}): Promise<Result<StatusDrift, StoreError>> {
  if (protection.isErr()) {
    return err(protection.error);
  }
  const { home = slopweaverHome() } = args;
  const sources = args.source === undefined ? contentSourceEnum.enumValues : [args.source];
  const reports: BronzeDriftReport[] = [];
  const withheld: WithheldBronze[] = [];
  for (const source of sources) {
    const report = await measureBronzeDrift({ home, probe, protection: protection.value, scope: args.scope, source });
    if (report.isOk()) {
      reports.push(report.value);
      continue;
    }
    if (report.error.code !== "BRONZE_PROTECTED") {
      return err(report.error);
    }
    const { path, protectedPath, why } = report.error;
    withheld.push({ path, protectedPath, source, why });
  }
  return ok({ reports, withheld });
}

/**
 * One source the scan did not read because its bronze reaches a `no-access` path on the owner's protect list.
 *
 * Its own record rather than a report with zeroes in it: a zero claims a measurement, and the whole point is
 * that none was taken. It never passes through `driftLines`, which is what keeps a repair line off it.
 */
export interface WithheldBronze {
  readonly source: CorpusSource;
  /** The bronze path the scan was about to list. */
  readonly path: string;
  /** The protect-list entry it reaches. */
  readonly protectedPath: string;
  /** The owner's reason, as the protect list records it. */
  readonly why: string;
}

/** What the drift scan answered: the sources it measured, and the ones the protect list withheld. */
export interface StatusDrift {
  readonly reports: readonly BronzeDriftReport[];
  readonly withheld: readonly WithheldBronze[];
}

/**
 * The line a withheld source prints in place of its count.
 *
 * @param withheld the source the protect list withheld
 * @returns the line, which names the entry and its reason and never a repair command
 */
export function withheldLine({ withheld }: { withheld: WithheldBronze }): string {
  // One line whatever the reason holds: a newline in it could otherwise print a line that reads as a repair.
  const why = withheld.why.replace(/\s+/gu, " ");
  return (
    `${withheld.source}: NOT SCANNED — ${withheld.path} reaches ${withheld.protectedPath}, no-access on the ` +
    `owner's protect list (${why}); none of it was read, so there is no count and no repair line`
  );
}

/**
 * What the drift half contributes to the report, whether or not the scan completed.
 *
 * A scan FAILURE is a printed line and never an exit code of its own, for the same reason a missing row
 * is not: `store status` answers "what does the store hold, and is it reachable", and both of those were
 * answered by the time bronze is read. A counterexample is exactly this — one bronze file at mode
 * `000` made a plain `store status` exit 1 where it had always exited 0, on a verb nobody had asked to
 * read bronze at all. Under `--check` the failure DOES gate, because a caller that asked for a gate must
 * never read an unmeasured scan as a clean one.
 *
 * A source the protect list WITHHELD is neither: it prints one line naming the entry, carries no repair
 * command, and does not fail `--check`, because the owner chose it and no session may change it — a gate that
 * failed on it would fail for ever. It stays explicit in the text and in `--json`'s `withheld`, so a pass is
 * never read as a measurement of that source.
 *
 * @param drift what the scan answered, per source
 * @returns the lines to print, the reports and withheld sources `--json` carries, and the failure message
 * @internal exported for its own test only — the exit-code rule above is the thing worth pinning, and
 *   reaching it through the runner would need a live database.
 */
export function driftSection({ drift }: { drift: Result<StatusDrift, StoreError> }): {
  readonly lines: readonly string[];
  readonly reports: readonly BronzeDriftReport[];
  readonly withheld: readonly WithheldBronze[];
  /** The message when the scan could not be completed, so an EMPTY report is never mistaken for a clean one. */
  readonly failure: string | null;
} {
  if (drift.isErr()) {
    const line = `bronze drift: NOT MEASURED — ${drift.error.message}`;
    return { failure: line, lines: [line], reports: [], withheld: [] };
  }
  return {
    failure: null,
    lines: [
      ...drift.value.reports.flatMap((report) => driftLines({ report })),
      ...drift.value.withheld.map((withheld) => withheldLine({ withheld })),
    ],
    reports: drift.value.reports,
    withheld: drift.value.withheld,
  };
}

/**
 * Whether a status run exits non-zero: only under `--check`, and only on a failed scan or a missing row.
 *
 * @param check whether the invocation asked for a gate
 * @param section what the drift half contributed
 * @returns the exit code
 */
export function statusExit({
  check,
  section,
}: {
  check: boolean;
  section: { readonly reports: readonly BronzeDriftReport[]; readonly failure: string | null };
}): number {
  const missing = section.reports.some((report) => report.missing > 0);
  return check && (section.failure !== null || missing) ? EXIT_ERROR : EXIT_OK;
}

/**
 * Count the store, scan bronze beside it, and print both — the half of the verb that has a database open.
 *
 * @param args the parsed status invocation
 * @param client the open store
 * @param state what the schema verification found, printed as a line rather than refused on
 * @returns the process exit code
 */
async function reportStatus({
  args,
  client,
  state,
}: {
  args: StoreStatusArgs;
  client: StoreClient;
  state: Awaited<ReturnType<typeof verifyStore>> extends Result<infer S, StoreError> ? S : never;
}): Promise<number> {
  const query = parseStoreReadArgs({ rest: [] });
  if (query.isErr()) {
    return refuse({ lines: storeCommandErrorLines({ error: query.error }), usage: STATUS_USAGE });
  }
  const counts = await facetContent({ client, facet: "source", query: query.value.query });
  const total = await countContent({ client, query: query.value.query });
  if (counts.isErr() || total.isErr()) {
    logger.error({ msg: counts.isErr() ? counts.error.message : String(total.isErr() && total.error.message) });
    return EXIT_ERROR;
  }
  const { home = slopweaverHome() } = args;
  const protection = ownerProtectionFor({ home });
  const section = driftSection({
    drift: await statusDrift({ args, probe: storePresenceProbe({ client }), protection }),
  });
  const lines = [
    ...facetLines({ counts: counts.value, facet: "source", total: total.value }),
    ...verifyLines({ declaredTables: state.declaredTables, findings: state.findings, state: state.state }),
    ...section.lines,
  ];
  // driftFailure rather than an empty `drift` alone: a --json reader that sees [] and nothing else cannot
  // tell a source with no gap from a source the scan never managed to measure, which is the exact false
  // green this whole verb exists to end.
  const payload = {
    bySource: counts.value,
    drift: section.reports,
    driftFailure: section.failure,
    matched: total.value,
    schema: state,
    withheld: section.withheld,
  };
  if (args.json) {
    logger.out({ line: safeJsonStringify({ label: "store report", value: payload }) });
  } else {
    lines.forEach((line) => {
      logger.out({ line });
    });
  }
  // Drift is REPORTED unconditionally and GATES only on --check. Failing every existing caller of a
  // read-only status verb on a gap it did not ask about would be a wider change than the one that found
  // the gap; `store status --check || <alert>` is the opt-in that makes the same report a check.
  return statusExit({ check: args.check, section });
}

/**
 * Report what the store holds, whether it is reachable, and how far behind bronze it sits.
 *
 * @param argv the full process argv
 * @returns the process exit code, which is 1 when `--check` was given and the scan found a missing row or
 *   could not be completed
 */
export async function runStoreStatus(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: STATUS_USAGE });
    return EXIT_OK;
  }
  const args = parseStoreStatusArgs({ rest });
  if (args.isErr()) {
    return refuse({ lines: args.error, usage: STATUS_USAGE });
  }
  // Status is the one reader that opens RAW: it is how an operator learns WHICH state a database is in, so
  // it reports the migration state as a line rather than refusing on it the way every other verb does.
  const url = storeUrl(args.value.home === undefined ? {} : { home: args.value.home });
  if (url.isErr()) {
    logger.error({ msg: url.error.message });
    return EXIT_ERROR;
  }
  const state = await verifyStore({ cwd: installedTreeRoot({ importMetaUrl: import.meta.url }), url: url.value });
  if (state.isErr()) {
    logger.error({ msg: state.error.message });
    return EXIT_ERROR;
  }
  const client = openStore({ url: url.value });
  try {
    return await reportStatus({ args: args.value, client, state: state.value });
  } finally {
    await client.close();
  }
}

export const storeStatusCommand = defineCommand({ run: runStoreStatus });
