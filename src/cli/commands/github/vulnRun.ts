/** Effectful shell for `slopweaver github vuln` — a Dependabot read, and a pure form compile. */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SurfaceReport } from "../../../appSurfaces/derive.js";
import { githubToken, slopweaverHome } from "../../../config.js";
import { workingTreeFilesOf } from "../../../lib/gitRepo.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonParse, safeJsonStringify } from "../../../lib/safeJson.js";
import type { DependabotAlert, GithubDependabotApi } from "../../../outbound/github/dependabot.js";
import { makeGithubDependabotApi } from "../../../outbound/github/dependabot.js";
import { prFormOfVulnerabilityFix } from "../../../outbound/github/vulnerabilityForm.js";
import { vulnerabilityFixFormSchema } from "../../../outbound/github/vulnerabilitySchema.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { prFormWriteSchema } from "../../../outbound/github/writeSchema.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { githubVerbErrorLines } from "./errors.js";
import { GITHUB_VULN_USAGE } from "./prUsage.js";
import {
  type GithubVulnArgs,
  type GithubVulnBodyArgs,
  type GithubVulnGetArgs,
  type GithubVulnListArgs,
  type GithubVulnSurfacesArgs,
  parseGithubVulnArgs,
} from "./vulnCore.js";

const VERB_ARG_OFFSET = 4;

/** Injectable edges for a no-network unit test. */
export interface GithubVulnDeps {
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubDependabotApi;
  readonly readInput: (args: { source: string }) => string;
  readonly writeOutput: (args: { path: string; text: string }) => void;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** Every path the checkout's working tree tracks, repo-relative — `git ls-files` in production. */
  readonly listCheckout: (args: { checkout: string }) => readonly string[];
  /** One file's text in the checkout, or `undefined` when it cannot be read. */
  readonly readCheckoutFile: (args: { checkout: string; path: string }) => string | undefined;
  /** The derivation itself, loaded lazily so `list` and `get` never load the TypeScript compiler. */
  readonly deriveSurfaces: (args: {
    packageName: string;
    tracked: readonly string[];
    read: (path: string) => string | undefined;
    everywhereAt: number;
  }) => Promise<SurfaceReport>;
}

/**
 * Worst first: highest CVSS, ties broken by alert number so the order is stable across reads.
 *
 * Every alert carries a score — GitHub's own schema declares it required, and
 * `../../../corpus/github/dependabot.ts` records why that is taken at face value here rather than defended
 * against — so there is no scoreless case to rank, and none is invented.
 *
 * @param alerts the alerts to rank
 * @returns the alerts, worst first, in a new array
 */
export function rankAlerts({ alerts }: { alerts: readonly DependabotAlert[] }): readonly DependabotAlert[] {
  return alerts.toSorted(
    (left, right) => right.advisory.cvssScore - left.advisory.cvssScore || left.number - right.number,
  );
}

/** An alert's state, or `unknown` when GitHub reported none for it. */
function alertStateWord({ alert }: { alert: DependabotAlert }): string {
  if (alert.state === undefined) {
    return "unknown";
  }
  return alert.state;
}

/**
 * One alert as a single scannable line: number, state, severity, score, package and its own citation.
 *
 * @param alert the alert to render
 * @returns the line
 */
export function alertLine({ alert }: { alert: DependabotAlert }): string {
  const parts: readonly (string | undefined)[] = [
    `#${String(alert.number)}`,
    alertStateWord({ alert }),
    alert.advisory.severity,
    alert.advisory.cvssScore.toFixed(1),
    alert.dependency.packageName,
    alert.dependency.relationship,
    alert.advisory.ghsaId,
    alert.htmlUrl,
  ];
  return parts.filter((part) => part !== undefined && part.length > 0).join("  ");
}

/** The state home: `--home` when given, else the resolved default. */
function stateHomeOf({ args, deps }: { args: GithubVulnListArgs | GithubVulnGetArgs; deps: GithubVulnDeps }): string {
  if (args.home === undefined) {
    return deps.home();
  }
  return args.home;
}

/** Resolve the token, or report the one thing to do about its absence. */
function resolveToken({ deps, home }: { deps: GithubVulnDeps; home: string }): string | undefined {
  const token = deps.token({ home });
  if (token === undefined) {
    deps.writeDiagnostic("no GitHub token configured; run `slopweaver connect github`");
  }
  return token;
}

/** Run `list` — a pure read, so it never reaches the door. */
async function runList({ deps, args }: { deps: GithubVulnDeps; args: GithubVulnListArgs }): Promise<number> {
  const token = resolveToken({ deps, home: stateHomeOf({ args, deps }) });
  if (token === undefined) {
    return EXIT_ERROR;
  }
  const api = deps.makeApi({ home: stateHomeOf({ args, deps }), token });
  const page = await api.list({ owner: args.owner, repo: args.repo, severity: args.severity, state: args.state });
  if (page.isErr()) {
    deps.writeDiagnostic(page.error.message);
    return EXIT_ERROR;
  }
  const ranked = rankAlerts({ alerts: page.value.alerts });
  if (args.json) {
    deps.out(
      safeJsonStringify({
        label: "the vuln list report",
        space: 2,
        value: { alerts: ranked, truncated: page.value.truncated },
      }),
    );
  } else if (ranked.length === 0) {
    deps.out(`no Dependabot alerts on ${args.owner}/${args.repo} at this filter`);
  } else {
    ranked.forEach((alert) => {
      deps.out(alertLine({ alert }));
    });
  }
  if (page.value.truncated) {
    deps.writeDiagnostic(
      `${args.owner}/${args.repo} carries more Dependabot alerts than this read covers; the list is PARTIAL`,
    );
  }
  return EXIT_OK;
}

/**
 * The report as the lines a reviewer reads: the answer first, then each feature with the screens it sits on,
 * then where the code imports the package and what the walk could not see.
 *
 * @param report what the derivation found
 * @returns the lines, in print order
 */
export function surfaceReportLines({ report }: { report: SurfaceReport }): readonly string[] {
  const head = `${report.packageName}: ${String(report.features.length)} feature(s) in ${String(report.surfaces.length)} place(s), from ${String(report.seeds.length)} importing module(s); ${String(report.modulesScanned)} modules scanned`;
  const answer =
    report.blastRadius.kind === "surfaces"
      ? `blast radius: surfaces (everywhere at ${String(report.everywhereAt)} direct importers or features)`
      : `blast radius: ${report.blastRadius.kind} — ${report.blastRadius.why}`;
  const features = report.features.flatMap((feature) => [
    `${feature.name} (${feature.module})${feature.through.length === 0 ? "" : `, via ${feature.through.join(", ")}`}`,
    ...feature.surfaces.map((where) => `  ${where}`),
    `  cover: ${feature.cover.length === 0 ? "none — no unit or component test imports it" : feature.cover.join(", ")}`,
  ]);
  const seeds = report.seeds.map((seed) => `  ${seed}`);
  const deadEnds = report.deadEnds.map((deadEnd) => `  ${deadEnd.module} — ${deadEnd.why}`);
  const stems = report.unresolved.top.map((stem) => `${stem.specifier} ×${String(stem.count)}`).join(", ");
  return [
    head,
    answer,
    "",
    ...features,
    "",
    "imported directly by:",
    ...seeds,
    ...(deadEnds.length === 0 ? [] : ["", "reaches no place on the app:", ...deadEnds]),
    "",
    `residue: ${String(report.unresolved.total)} local code specifier(s) named nothing tracked${stems.length === 0 ? "" : ` (most: ${stems})`}; end-to-end specs import no app code, so cover is unit and component tests only`,
  ];
}

/** Run `surfaces` — a local walk of one checkout; no token, no network. */
async function runSurfaces({ deps, args }: { deps: GithubVulnDeps; args: GithubVulnSurfacesArgs }): Promise<number> {
  let tracked: readonly string[];
  try {
    tracked = deps.listCheckout({ checkout: args.checkout });
  } catch (cause) {
    deps.writeDiagnostic(
      `could not list ${args.checkout}: ${cause instanceof Error ? cause.message : "git ls-files failed"}`,
    );
    return EXIT_ERROR;
  }
  const report = await deps.deriveSurfaces({
    everywhereAt: args.everywhereAt,
    packageName: args.packageName,
    read: (path) => deps.readCheckoutFile({ checkout: args.checkout, path }),
    tracked,
  });
  if (args.json) {
    deps.out(safeJsonStringify({ label: "the surfaces report", space: 2, value: report }));
  } else {
    surfaceReportLines({ report }).forEach((line) => {
      deps.out(line);
    });
  }
  return EXIT_OK;
}

/** Run `get` — one alert in full, the same read `list` makes, printed whole. */
async function runGet({ deps, args }: { deps: GithubVulnDeps; args: GithubVulnGetArgs }): Promise<number> {
  const token = resolveToken({ deps, home: stateHomeOf({ args, deps }) });
  if (token === undefined) {
    return EXIT_ERROR;
  }
  const api = deps.makeApi({ home: stateHomeOf({ args, deps }), token });
  const alert = await api.get({ alertNumber: args.number, owner: args.owner, repo: args.repo });
  if (alert.isErr()) {
    deps.writeDiagnostic(alert.error.message);
    return EXIT_ERROR;
  }
  deps.out(safeJsonStringify({ label: "the alert", space: 2, value: alert.value }));
  return EXIT_OK;
}

/** The form text, from `--form` inline or `--file` (either of which may be `-` for stdin). */
function readFormText({ deps, args }: { deps: GithubVulnDeps; args: GithubVulnBodyArgs }): string {
  if (args.source.from === "file") {
    return deps.readInput({ source: args.source.path });
  }
  if (args.source.text === "-") {
    return deps.readInput({ source: "-" });
  }
  return args.source.text;
}

/**
 * The form as parsed JSON, or the exit code to stop on once the reason has been reported.
 *
 * Two failures with two meanings: a form that cannot be READ (a missing `--file`, a dead stdin) is an I/O
 * failure and exits `EXIT_ERROR`; a form that was read but is not valid JSON, or is past the parse ceiling, is
 * a caller mistake and exits `EXIT_USAGE`. `safeJsonParse` THROWS on a refusal and on malformed JSON, so both
 * throws are turned into a diagnostic here rather than propagating out of a CLI verb as a stack trace.
 */
function readFormJson({ deps, args }: { deps: GithubVulnDeps; args: GithubVulnBodyArgs }): { json: unknown } | number {
  let text: string;
  try {
    text = readFormText({ args, deps });
  } catch (cause) {
    deps.writeDiagnostic(cause instanceof Error ? cause.message : "the vulnerability-fix form could not be read");
    return EXIT_ERROR;
  }
  try {
    return { json: safeJsonParse({ label: "the vulnerability-fix form", text }) };
  } catch (cause) {
    deps.writeDiagnostic(cause instanceof Error ? cause.message : "the vulnerability-fix form is not valid JSON");
    return EXIT_USAGE;
  }
}

/**
 * Run `body` — compile a vulnerability-fix form into the pull-request form the door renders.
 *
 * Pure after the read: no token, no network. The compiled form is validated against `prFormWriteSchema` before
 * it is printed, so an over-length cell fails HERE, where the author can still fix it, rather than at the
 * door after a push.
 */
function runBody({ deps, args }: { deps: GithubVulnDeps; args: GithubVulnBodyArgs }): number {
  const parsedJson = readFormJson({ args, deps });
  if (typeof parsedJson === "number") {
    return parsedJson;
  }
  const form = vulnerabilityFixFormSchema.safeParse(parsedJson.json);
  if (!form.success) {
    form.error.issues.forEach((issue) => {
      deps.writeDiagnostic(`${issue.path.join(".")}: ${issue.message}`);
    });
    return EXIT_USAGE;
  }
  const prForm = prFormOfVulnerabilityFix({ form: form.data });
  const checked = prFormWriteSchema.safeParse(prForm);
  if (!checked.success) {
    deps.writeDiagnostic("the compiled pull-request form does not pass the PR form schema:");
    checked.error.issues.forEach((issue) => {
      deps.writeDiagnostic(`  ${issue.path.join(".")}: ${issue.message}`);
    });
    return EXIT_ERROR;
  }
  const text = safeJsonStringify({ label: "the compiled pull-request form", space: 2, value: prForm });
  if (args.out === undefined) {
    deps.out(text);
  } else {
    deps.writeOutput({ path: args.out, text });
    deps.out(`wrote the pull-request form to ${args.out}`);
  }
  return EXIT_OK;
}

/**
 * Run the vuln operation.
 *
 * @param argv the full process argv; this verb's arguments begin after node, CLI, "github" and "vuln"
 * @param deps credential, client and output seams
 * @returns the process exit code
 */
export async function runGithubVuln({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: GithubVulnDeps;
}): Promise<number> {
  const parsed = parseGithubVulnArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    for (const problem of githubVerbErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(GITHUB_VULN_USAGE);
    return EXIT_USAGE;
  }
  const args: GithubVulnArgs = parsed.value;
  if (args.subVerb === "list") {
    return runList({ args, deps });
  }
  if (args.subVerb === "get") {
    return runGet({ args, deps });
  }
  if (args.subVerb === "surfaces") {
    return runSurfaces({ args, deps });
  }
  return runBody({ args, deps });
}

/**
 * Production GitHub and output seams.
 *
 * @returns credential, sanctioned client and output edges for the vuln command
 */
export function productionGithubVulnDeps(): GithubVulnDeps {
  return {
    deriveSurfaces: (args) => import("../../../appSurfaces/derive.js").then((m) => m.deriveSurfaces(args)),
    home: slopweaverHome,
    listCheckout: ({ checkout }) => workingTreeFilesOf({ root: checkout }),
    makeApi: ({ home, token }) => makeGithubDependabotApi({ privacy: githubWritePrivacy({ home }), token }),
    out: (line) => {
      logger.out({ line });
    },
    readCheckoutFile: ({ checkout, path }) => {
      try {
        return readFileSync(join(checkout, path), "utf8");
      } catch {
        return undefined;
      }
    },
    readInput: ({ source }) => readFileSync(source === "-" ? 0 : source, "utf8"),
    token: ({ home }) => githubToken({ home }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOutput: ({ path, text }) => {
      writeFileSync(path, text, "utf8");
    },
  };
}

/** `slopweaver github vuln`. */
export const githubVulnCommand = defineCommand({
  run: (argv) => runGithubVuln({ argv, deps: productionGithubVulnDeps() }),
});
