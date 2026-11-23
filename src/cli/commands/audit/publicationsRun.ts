/**
 * Effectful shell for `slopweaver audit publications` — load the privacy policy fail-closed, read back what the fleet
 * published, judge it through the outbound privacy check, write the sanitised report to the state home, and print
 * counts. Its argv contract is `./publicationsArgs.ts`, its output `./publicationsLines.ts`, and the Slack, Linear and
 * Notion doors as production reads them `./publicationsDoors.ts`.
 *
 * Nothing found is printed, ever: not a finding, not a link, not a gap's provider message. The report on disk is the
 * sanitised shape too (`../../../live/publicationAudit/types.ts`), so the run never holds a term past the pure core.
 */
import { randomUUID } from "node:crypto";

import { githubToken, slopweaverHome } from "../../../config.js";
import { type PrivateTerm, privateTermsOrRefusal } from "../../../hygiene/privateTerms.js";
import {
  denylistStatusLine,
  type LineListLoad,
  loadDenylistResult,
  unreadableDenylistMessage,
} from "../../../hygiene/scan.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { GithubExposureSeam } from "../../../live/github/exposureListing.js";
import { productionGithubExposureSeam } from "../../../live/github/exposureRead.js";
import { auditPublishedTexts, countPublicationFindings } from "../../../live/publicationAudit/core.js";
import { publicationExpectationsMet } from "../../../live/publicationAudit/expect.js";
import { readGithubPublications } from "../../../live/publicationAudit/githubReader.js";
import {
  type PublicationAuditReport,
  publicationAuditRunDirectory,
  writePublicationAudit,
} from "../../../live/publicationAudit/store.js";
import { doorCoverage, type PublicationRead } from "../../../live/publicationAudit/types.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import { type AuditPublicationsOptions, parseAuditPublicationsArgs } from "./publicationsArgs.js";
import {
  CREDENTIAL_MISSING,
  productionReadLinear,
  productionReadNotion,
  productionReadSlack,
} from "./publicationsDoors.js";
import { printPublicationAudit } from "./publicationsLines.js";
import { AUDIT_PUBLICATIONS_USAGE } from "./publicationsUsage.js";

/** Injectable edges for a no-network test. */
export interface AuditPublicationsDeps {
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeSeam: (args: { token: string }) => GithubExposureSeam;
  /** Read back the Slack door: inventory, credential and read, composed (`../../../live/publicationAudit/`). */
  readonly readSlack: (args: { home: string }) => Promise<PublicationRead>;
  readonly readLinear: (args: { home: string }) => Promise<PublicationRead>;
  readonly readNotion: (args: { home: string }) => Promise<PublicationRead>;
  /** One `monitor check --only publication-leak --fire` pass over the report just written; its exit code. */
  readonly firePublicationLeak: (args: { home: string; bySession: string }) => Promise<number>;
  readonly denylist: (args: { home: string }) => LineListLoad;
  readonly privateTerms: (args: { home: string }) => Result<readonly PrivateTerm[], string>;
  readonly nowIso: () => string;
  readonly nonce: () => string;
  readonly out: (args: { line: string }) => void;
  readonly writeDiagnostic: (args: { line: string }) => void;
}

/** The policy a run judges with: the private terms and the denylist lines. */
interface AuditPolicy {
  readonly privateTerms: readonly PrivateTerm[];
  readonly denylist: readonly string[];
}

/** A diagnostic with the state home's absolute path, which names the local user, replaced by its variable. */
function homeless({ line, home }: { line: string; home: string }): string {
  return line.replaceAll(home, "$SLOPWEAVER_HOME");
}

/** The state home: `--home` when the caller passed one, this install's otherwise. */
function stateHomeOf({ given, deps }: { given: string | undefined; deps: AuditPublicationsDeps }): string {
  if (given !== undefined) {
    return given;
  }
  return deps.home();
}

/**
 * The policy a run judges with, loaded fail-closed: the private terms and the denylist (absent is empty, which still
 * catches every credential shape; unreadable refuses). Prints the denylist's status line once it has read. A door's
 * credential is not here: a door with none is partial, and the other doors are still read.
 */
function loadAuditPolicy({ home, deps }: { home: string; deps: AuditPublicationsDeps }): Result<AuditPolicy, string> {
  const terms = deps.privateTerms({ home });
  if (terms.isErr()) {
    return err(terms.error);
  }
  const load = deps.denylist({ home });
  if (load.kind === "unreadable") {
    return err(unreadableDenylistMessage({ load }));
  }
  deps.writeDiagnostic({ line: denylistStatusLine({ load }) });
  return ok({ denylist: load.kind === "loaded" ? load.lines : [], privateTerms: terms.value });
}

/** The GitHub door: every thread on the repository, or partial with nothing read when no token is configured. */
async function readGithubDoor({
  home,
  owner,
  repo,
  deps,
}: {
  home: string;
  owner: string;
  repo: string;
  deps: AuditPublicationsDeps;
}): Promise<PublicationRead> {
  const token = deps.token({ home });
  if (token === undefined) {
    const coverage = doorCoverage({
      attachmentsNotSwept: 0,
      door: "github",
      gaps: [CREDENTIAL_MISSING],
      objects: 0,
      texts: 0,
    });
    return { coverage, texts: [] };
  }
  return readGithubPublications({ owner, repo, seam: deps.makeSeam({ token }) });
}

/**
 * Read every door and judge what came back into the sanitised report. Sequentially, in `PUBLICATION_DOORS` order, so
 * each provider's own rate scheduler stays the authority.
 */
async function auditDoors({
  home,
  args,
  policy,
  deps,
}: {
  home: string;
  args: AuditPublicationsOptions;
  policy: AuditPolicy;
  deps: AuditPublicationsDeps;
}): Promise<{ readonly report: PublicationAuditReport; readonly directory: string }> {
  const readAtIso = deps.nowIso();
  const doors: PublicationRead[] = [await readGithubDoor({ deps, home, owner: args.owner, repo: args.repo })];
  doors.push(await deps.readSlack({ home }));
  doors.push(await deps.readLinear({ home }));
  doors.push(await deps.readNotion({ home }));
  const audit = auditPublishedTexts({
    policy: { ...policy, ownRepository: `${args.owner}/${args.repo}` },
    texts: doors.flatMap((door) => door.texts),
  });
  const directory = publicationAuditRunDirectory({ home, nonce: deps.nonce(), readAtIso });
  const report: PublicationAuditReport = {
    counts: countPublicationFindings({ findings: audit.findings }),
    coverage: doors.map((door) => door.coverage),
    findings: audit.findings,
    readAtIso,
    run: directory.homeRelative,
    schemaVersion: 1,
    withheldLinks: audit.withheldLinks,
  };
  return { directory: directory.absolute, report };
}

/**
 * Run `audit publications`.
 *
 * @param rest the argv tail after `audit publications`
 * @param deps credential, seam, policy, clock and output edges
 * @returns 0 for a complete read with no finding and every expectation met; 1 otherwise or on a failed read; 2 for a
 *   usage error
 */
export async function runAuditPublications({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: AuditPublicationsDeps;
}): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "audit", rest, verb: "publications" });
  if (gated !== undefined) {
    return gated;
  }
  const parsed = parseAuditPublicationsArgs({ rest });
  if (parsed.isErr()) {
    for (const line of [...parsed.error, AUDIT_PUBLICATIONS_USAGE]) {
      deps.writeDiagnostic({ line });
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = stateHomeOf({ deps, given: args.home });
  const policy = loadAuditPolicy({ deps, home });
  if (policy.isErr()) {
    deps.writeDiagnostic({ line: homeless({ home, line: policy.error }) });
    return EXIT_ERROR;
  }
  const { directory, report } = await auditDoors({ args, deps, home, policy: policy.value });
  const written = writePublicationAudit({ directory, home, report });
  if (written.isErr()) {
    deps.writeDiagnostic({ line: homeless({ home, line: written.error.message }) });
    return EXIT_ERROR;
  }
  const met = publicationExpectationsMet({ expectations: args.expectations, findings: report.findings });
  printPublicationAudit({ json: args.json, met, out: deps.out, report });
  const verdict = report.coverage.every((door) => door.state === "complete") && report.findings.length === 0;
  if (args.fireAs === undefined) {
    return verdict && met.every(Boolean) ? EXIT_OK : EXIT_ERROR;
  }
  // Fired whatever the verdict: a partial or a firing report is exactly what keeps an open card, or raises one.
  return firedExit({ bySession: args.fireAs, deps, home, met, verdict });
}

/**
 * Run the `publication-leak` pass over the report just written, and say whether the RUN worked and what it saw.
 *
 * 1 when the pass failed (naming how to fire it again) or an expectation was missed. A run that worked over a report
 * that is not clean — a finding, or a door read only in part — exits `EXIT_EXPECTED_EMPTY` (3), never 0: a scheduler
 * stamps a 3 and settles the slot, so the row is not retried into a second card about the same leak, while
 * `verb || alert` still sees the run was not clean. Only a clean, complete report over a working pass exits 0.
 */
async function firedExit({
  bySession,
  home,
  met,
  verdict,
  deps,
}: {
  bySession: string;
  home: string;
  met: readonly boolean[];
  verdict: boolean;
  deps: AuditPublicationsDeps;
}): Promise<number> {
  const code = await deps.firePublicationLeak({ bySession, home });
  if (code !== EXIT_OK) {
    deps.writeDiagnostic({
      line: `audit publications: the publication-leak pass exited ${String(code)}; the report stands, fire it again with \`slopweaver monitor check --only publication-leak --fire\``,
    });
    return EXIT_ERROR;
  }
  if (!met.every(Boolean)) {
    return EXIT_ERROR;
  }
  return verdict ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/**
 * Production edges.
 *
 * @returns the credential, the doored read seam, the policy readers, the wall clock and the output sinks
 */
export function productionAuditPublicationsDeps(): AuditPublicationsDeps {
  return {
    denylist: ({ home }) => loadDenylistResult({ home }),
    home: slopweaverHome,
    makeSeam: ({ token }) => productionGithubExposureSeam({ token }),
    nonce: () => randomUUID().slice(0, 8),
    nowIso: () => new Date().toISOString(),
    firePublicationLeak: async ({ home, bySession }) => {
      const { runMonitorCheck } = await import("../monitor/check.js");
      const { hostedPassDeps, productionMonitorDeps } = await import("../monitor/deps.js");
      // The audit owns stdout (`--json` among it), so the hosted pass reports on stderr.
      return runMonitorCheck({
        deps: hostedPassDeps({ deps: productionMonitorDeps() }),
        rest: ["--only", "publication-leak", "--fire", "--by-session", bySession, "--home", home],
      });
    },
    out: ({ line }) => {
      logger.out({ line });
    },
    privateTerms: ({ home }) => privateTermsOrRefusal({ home }),
    readLinear: ({ home }) => productionReadLinear({ home }),
    readNotion: ({ home }) => productionReadNotion({ home }),
    readSlack: ({ home }) => productionReadSlack({ home }),
    token: ({ home }) => githubToken({ home }),
    writeDiagnostic: ({ line }) => {
      logger.warn({ msg: line });
    },
  };
}

/** `slopweaver audit publications`. */
export const auditPublicationsCommand = defineCommand({
  run: (argv) =>
    runAuditPublications({
      deps: productionAuditPublicationsDeps(),
      rest: verbTail({ argv, verbs: ["publications"] }),
    }),
});
