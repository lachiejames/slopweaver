/**
 * `slopweaver google audit-log` — read Cloud Audit Logs across a GCP organisation, READ-ONLY, into a local
 * generation, and count what was exercised.
 *
 * ## Why this verb exists
 *
 * The read serves a look at every GCP call ever made: a breakdown of how GCP is actually used and what might break in
 * future if the proposed IAM changes were applied.
 * Raw gcloud is
 * refused from a session (`classifyRawCommand`), so the read is a verb, and an atlas-shaped one the rest of the
 * fleet keeps: state under `$SLOPWEAVER_HOME/atlas/gcp-audit/`, never git. The read-only rail is the closed
 * request union in `src/gcpAudit/transport.ts`; the credential is the owner's ADC, which `google adc` reads.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { GoogleAuth } from "googleapis-common";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";

import { type GcpAuditSummary, type GcpCallRow, startCount } from "../../../gcpAudit/aggregate.js";
import { assessPlan, type GcpPlanAssessment, parsePlan } from "../../../gcpAudit/assess.js";
import { type GcpAuditError, GcpAuditErrors } from "../../../gcpAudit/errors.js";
import { runGcpAuditPull } from "../../../gcpAudit/pull.js";
import {
  type GcpAuditManifest,
  generationIdFor,
  latestGeneration,
  openGeneration,
  publishGeneration,
  readManifest,
  readRoles,
  streamEntries,
} from "../../../gcpAudit/store.js";
import { type GcpAuditSend, gcpAuditSender } from "../../../gcpAudit/transport.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";

import {
  type GoogleAuditLogPullArgs,
  type GoogleAuditLogSummaryArgs,
  parseGoogleAuditLogArgs,
} from "./auditLogArgs.js";
import { GOOGLE_AUDIT_LOG_USAGE } from "./auditLogUsage.js";

/** The scope every Google Cloud client library asks for under ADC; gcloud will not narrow it for a user login. */
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/** The effects `google audit-log` performs, injectable so a test drives the verb with plain fakes. */
export interface GoogleAuditLogDeps {
  readonly sender: (args: { quotaProject: string }) => GcpAuditSend;
  readonly nowIso: () => string;
  readonly suffix: () => string;
  readonly readText: (args: { path: string }) => Result<string>;
  readonly out: (line: string) => void;
  readonly error: (line: string) => void;
}

/** The ends of the window a pull's entries cover, honest about what Cloud Logging still holds. */
function windowLine({ manifest, summary }: { manifest: GcpAuditManifest; summary: GcpAuditSummary }): string {
  const scope = manifest.principals === "all" ? "every principal" : manifest.principals.join(", ");
  return (
    `${String(summary.unique)} distinct audit entr(ies) by ${scope}, ${manifest.since} → ${manifest.pulledAtIso} ` +
    `(pulled ${manifest.pulledAtIso}, generation ${manifest.generation}); coverage ${manifest.coverage}` +
    (manifest.gaps.length === 0 ? "" : `: ${manifest.gaps.join("; ")}`)
  );
}

/** The retention the generation's buckets carry, one `<bucket id> <days>d ×<containers>` per distinct pair. */
function retentionLine({ manifest }: { manifest: GcpAuditManifest }): string {
  const retention = new Map<string, number>();
  for (const bucket of manifest.buckets) {
    const id = bucket.name.split("/").at(-1)!;
    if (bucket.retentionDays !== null) {
      const key = `${id} ${String(bucket.retentionDays)}d`;
      const before = retention.get(key);
      retention.set(key, before === undefined ? 1 : before + 1);
    }
  }
  return `retention observed: ${[...retention.entries()].map(([what, count]) => `${what} ×${String(count)}`).join(", ")}`;
}

/** Which services the org records DATA_READ for — UNKNOWN, never "nothing", when the policy read was refused. */
function dataAccessLine({ manifest }: { manifest: GcpAuditManifest }): string {
  if (manifest.refusals.policies.length > 0) {
    return "data-access DATA_READ logging configured at the org for: UNKNOWN — the org's allow policy was refused";
  }
  const dataAccess = manifest.auditConfigs.filter((config) => config.logTypes.includes("DATA_READ"));
  const services = dataAccess.length === 0 ? "nothing" : dataAccess.map((config) => config.service).join(", ");
  return `data-access DATA_READ logging configured at the org for: ${services}`;
}

/** One call row. */
function callLine({ call }: { call: GcpCallRow }): string {
  return `  ${call.principal} · ${call.serviceName} · ${call.methodName} — ${String(call.count)}, ${String(call.failed)} failed, ${call.firstSeen} → ${call.lastSeen}, ${call.agents.join("/")} in ${String(call.origins.length)} container(s)`;
}

/** The plan's reading: its tally, then each would-break finding, then each use it could not assess. */
function planLines({ assessment }: { assessment: GcpPlanAssessment }): readonly string[] {
  return [
    `plan: ${String(assessment.kept)} exercised permission use(s) kept, ${String(assessment.wouldBreak.length)} would break, ${String(assessment.unassessable.length)} unassessable`,
    ...assessment.wouldBreak.map(
      (finding) =>
        `  WOULD BREAK ${finding.use.principal} ${finding.use.permission} in ${finding.use.origin} — ${String(finding.use.count)} use(s), last ${finding.use.lastSeen} (${finding.reason}, ${finding.certainty}; ${finding.use.methods.join(", ")})`,
    ),
    ...assessment.unassessable.map(
      (item) => `  UNASSESSABLE ${item.use.principal} ${item.use.permission} in ${item.use.origin} — ${item.why}`,
    ),
  ];
}

/**
 * The human report.
 *
 * @param manifest the generation's manifest
 * @param summary the count
 * @param assessment the plan's reading, when a plan was given
 * @returns the lines to print
 */
export function summaryLines({
  manifest,
  summary,
  assessment,
}: {
  manifest: GcpAuditManifest;
  summary: GcpAuditSummary;
  assessment: GcpPlanAssessment | null;
}): readonly string[] {
  const { containers } = manifest;
  return [
    windowLine({ manifest, summary }),
    `searched ${String(containers.organizations)} org, ${String(containers.folders)} folder(s), ${String(containers.projects)} project(s)`,
    ...Object.entries(summary.byKind)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([kind, facts]) => `  ${kind}: ${String(facts.count)} entr(ies), ${facts.firstSeen} → ${facts.lastSeen}`),
    retentionLine({ manifest }),
    dataAccessLine({ manifest }),
    "calls (principal · service · method — count, failed, first → last, from):",
    ...summary.calls.map((call) => callLine({ call })),
    ...(assessment === null ? [] : planLines({ assessment })),
  ];
}

/**
 * Print a typed failure and pick its exit.
 *
 * @param error the failure
 * @param deps the effects
 * @returns the exit code
 */
function failed({ error, deps }: { error: GcpAuditError; deps: GoogleAuditLogDeps }): number {
  deps.error(`google audit-log: ${error.message}`);
  return error.code === "INPUT_INVALID" || error.code === "PLAN_INVALID" ? EXIT_USAGE : EXIT_ERROR;
}

/**
 * Run `pull`.
 *
 * @param args the parsed invocation
 * @param deps the effects
 * @returns 0 complete, 3 partial, 1 failure, 2 a bad input
 */
async function runPull({ args, deps }: { args: GoogleAuditLogPullArgs; deps: GoogleAuditLogDeps }): Promise<number> {
  const home = resolveHome({ named: args.home });
  const generation = generationIdFor({ nowIso: deps.nowIso(), suffix: deps.suffix() });
  const pulled = await runGcpAuditPull({
    deps: {
      generation,
      nowIso: deps.nowIso,
      open: ({ generation: id }) => openGeneration({ generation: id, home }),
      progress: (line) => {
        deps.out(line);
      },
      publish: ({ manifest, roles }) => publishGeneration({ home, manifest, roles }),
      send: deps.sender({ quotaProject: args.quotaProject }),
    },
    input: {
      org: args.org,
      principals: args.principals,
      quotaProject: args.quotaProject,
      roles: args.roles,
      since: args.since,
    },
  });
  if (pulled.isErr()) {
    return failed({ deps, error: pulled.error });
  }
  const manifest = pulled.value;
  deps.out(
    `published generation ${manifest.generation}: ${String(manifest.entriesWritten)} entr(ies), coverage ${manifest.coverage}`,
  );
  for (const gap of manifest.gaps) {
    deps.out(`  gap: ${gap}`);
  }
  deps.out(`read it: slopweaver google audit-log summary --generation ${manifest.generation}`);
  return manifest.coverage === "complete" ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/**
 * Run `summary`.
 *
 * @param args the parsed invocation
 * @param deps the effects
 * @returns 0 complete, 3 partial, 1 failure, 2 a bad plan
 */
function runSummary({ args, deps }: { args: GoogleAuditLogSummaryArgs; deps: GoogleAuditLogDeps }): number {
  const home = resolveHome({ named: args.home });
  const report = readSummaryReport({ args, deps, home });
  if (report.isErr()) {
    return failed({ deps, error: report.error });
  }
  const { assessment, manifest, summary } = report.value;
  if (args.json) {
    deps.out(
      safeJsonStringify({
        label: "google audit-log summary",
        value: { assessment, manifest, summary },
      }),
    );
  } else {
    for (const line of summaryLines({ assessment, manifest, summary })) {
      deps.out(line);
    }
  }
  return manifest.coverage === "complete" ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/** What `summary` reports: the generation's manifest, its count, and the plan's reading when one was given. */
interface SummaryReport {
  readonly manifest: GcpAuditManifest;
  readonly summary: GcpAuditSummary;
  /** Null when no `--plan` was given, which is also how `--json` writes it. */
  readonly assessment: GcpPlanAssessment | null;
}

/**
 * Read the generation `summary` names, count it, and read `--plan` against it when one was given.
 *
 * @param args the parsed invocation
 * @param deps the effects; a stored line that did not parse is reported on the error channel and not counted
 * @param home the state home
 * @returns the report, or the failure that stopped it
 */
function readSummaryReport({
  args,
  deps,
  home,
}: {
  args: GoogleAuditLogSummaryArgs;
  deps: GoogleAuditLogDeps;
  home: string;
}): Result<SummaryReport, GcpAuditError> {
  const generation = args.generation === undefined ? latestGeneration({ home }) : ok(args.generation);
  if (generation.isErr()) {
    return err(generation.error);
  }
  const manifest = readManifest({ generation: generation.value, home });
  if (manifest.isErr()) {
    return err(manifest.error);
  }
  const counter = startCount();
  const streamed = streamEntries({ generation: generation.value, home, onEntry: counter.add });
  if (streamed.isErr()) {
    return err(streamed.error);
  }
  if (streamed.value.unreadable > 0) {
    deps.error(
      `google audit-log: ${String(streamed.value.unreadable)} stored line(s) did not parse and were not counted`,
    );
  }
  const summary = counter.result();
  if (args.plan === undefined) {
    return ok({ assessment: null, manifest: manifest.value, summary });
  }
  return readAssessment({
    deps,
    generation: generation.value,
    home,
    org: manifest.value.org,
    plan: args.plan,
    summary,
  }).map((assessment) => ({ assessment, manifest: manifest.value, summary }));
}

/**
 * Read a plan file and assess it against the count, over the generation's role cache. An unreadable file is a
 * caller mistake, so it is `INPUT_INVALID` and exits as usage.
 *
 * @param plan the `--plan` path
 * @param generation the generation whose role cache resolves the plan's kept roles
 * @param org the organisation the generation read
 * @param summary the count whose permission uses are assessed
 * @returns the assessment, or the failure that stopped it
 */
function readAssessment({
  deps,
  plan,
  home,
  generation,
  org,
  summary,
}: {
  deps: GoogleAuditLogDeps;
  plan: string;
  home: string;
  generation: string;
  org: string;
  summary: GcpAuditSummary;
}): Result<GcpPlanAssessment, GcpAuditError> {
  const text = deps.readText({ path: plan });
  if (text.isErr()) {
    return err(GcpAuditErrors.inputInvalid({ why: `cannot read --plan ${plan}: ${text.error.join("; ")}` }));
  }
  return parsePlan({ value: safeJsonParse({ label: plan, text: text.value }) }).andThen((parsed) =>
    readRoles({ generation, home }).map((roles) => assessPlan({ org, plan: parsed, roles, uses: summary.uses })),
  );
}

/**
 * Run `google audit-log` over injected effects.
 *
 * @param rest the argv tail after `google audit-log`
 * @param deps the effects
 * @returns the exit code
 */
export async function runGoogleAuditLogWithDeps({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GoogleAuditLogDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.out(GOOGLE_AUDIT_LOG_USAGE);
    return EXIT_OK;
  }
  const parsed = parseGoogleAuditLogArgs({ rest });
  if (parsed.isErr()) {
    [...parsed.error, GOOGLE_AUDIT_LOG_USAGE].forEach((line) => {
      deps.error(line);
    });
    return EXIT_USAGE;
  }
  return parsed.value.action === "pull"
    ? runPull({ args: parsed.value, deps })
    : runSummary({ args: parsed.value, deps });
}

/**
 * The production effects.
 *
 * @returns a sender over a fresh ADC `GoogleAuth`, the wall clock, random suffixes, file reads and the logger
 */
export function productionGoogleAuditLogDeps(): GoogleAuditLogDeps {
  return {
    error: (line) => {
      logger.error({ msg: line });
    },
    nowIso: () => new Date().toISOString(),
    out: (line) => {
      logger.out({ line });
    },
    readText: ({ path }) => {
      try {
        return ok(readFileSync(path, "utf8"));
      } catch (error: unknown) {
        return err([String(error)]);
      }
    },
    sender: ({ quotaProject }) =>
      gcpAuditSender({ auth: new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] }), quotaProject }),
    suffix: () => randomBytes(4).toString("hex"),
  };
}

/** `slopweaver google audit-log` — the tail starts at index 4, after `google audit-log`. */
export const googleAuditLogCommand = defineCommand({
  run: (argv) => runGoogleAuditLogWithDeps({ deps: productionGoogleAuditLogDeps(), rest: argv.slice(4) }),
});
