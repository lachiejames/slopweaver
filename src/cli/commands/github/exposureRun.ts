/**
 * Effectful shell for `slopweaver github exposure` — resolve the credential, run the inventory or the sweep, print
 * its counts, and (for a sweep) write the findings to the state home.
 */

import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

import { githubToken, slopweaverHome } from "../../../config.js";
import { FORBIDDEN_IDENTIFIER_RULES } from "../../../hygiene/forbiddenIdentifiers.js";
import { repositoryContentIdentifierScanner } from "../../../hygiene/ownRepository.js";
import {
  denylistStatusLine,
  type LineListLoad,
  loadDenylistResult,
  unreadableDenylistMessage,
} from "../../../hygiene/scan.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import {
  GITHUB_EXPOSURE_UPLOADS_FILE,
  githubExposureRunDirectory,
  writeGithubExposureSweep,
} from "../../../live/github/exposureFindingsStore.js";
import { inventoryGithubExposure } from "../../../live/github/exposureInventory.js";
import type { GithubExposureSeam } from "../../../live/github/exposureListing.js";
import { productionGithubExposureSeam } from "../../../live/github/exposureRead.js";
import { githubExposureComplete, githubExposureLines } from "../../../live/github/exposureReport.js";
import { githubExposureScanner } from "../../../live/github/exposureScan.js";
import { type GithubExposureSweep, sweepGithubExposure } from "../../../live/github/exposureSweep.js";
import {
  githubExposureFindingsByRule,
  githubExposureSweepComplete,
  githubExposureSweepLines,
} from "../../../live/github/exposureSweepReport.js";
import { githubExposureUploadCounts } from "../../../live/github/exposureUploads.js";
import type { StreamJobLog } from "../../../live/github/jobLogRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import { type GithubExposureArgs, type GithubExposureArgsError, parseGithubExposureArgs } from "./exposureCore.js";
import { githubExposureUsage } from "./exposureUsage.js";
import { productionRunLogSeams } from "./runLogSeams.js";

const VERB_ARG_OFFSET = 4;

/** Injectable edges for a no-network test. */
export interface GithubExposureDeps {
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeSeam: (args: { token: string }) => GithubExposureSeam;
  /** The run-log verb's log stream, for the sweep's job-log stage. */
  readonly makeStreamLog: (args: { token: string }) => StreamJobLog;
  readonly nowIso: () => string;
  /** The private denylist, read from the state home. */
  readonly denylist: (args: { home: string }) => LineListLoad;
  /** A per-run suffix for the sweep's report directory. */
  readonly nonce: () => string;
  /** The running account's home directory: the one home path the sweep reports. */
  readonly ownHome: () => string;
  readonly out: (args: { line: string }) => void;
  readonly writeDiagnostic: (args: { line: string }) => void;
}

/** The state home `--home` names, or the configured one when it names none. */
function stateHomeFor({ args, deps }: { args: GithubExposureArgs; deps: GithubExposureDeps }): string {
  if (args.home !== undefined) {
    return args.home;
  }
  return deps.home();
}

/** An argument refusal as diagnostic lines: each flag problem on its own line, as the parser reported them. */
function argsErrorLines({ error }: { error: GithubExposureArgsError }): readonly string[] {
  if (error.code === "BAD_FLAGS") {
    return error.problems;
  }
  return [error.message];
}

/** A diagnostic with the state home's absolute path, which names the local user, replaced by its variable. */
function homeless({ line, home }: { line: string; home: string }): string {
  return line.replaceAll(home, "$SLOPWEAVER_HOME");
}

/** Run and print the inventory. */
async function runInventory({
  args,
  deps,
  seam,
}: {
  args: GithubExposureArgs;
  deps: GithubExposureDeps;
  seam: GithubExposureSeam;
}): Promise<number> {
  const inventory = await inventoryGithubExposure({ nowIso: deps.nowIso, owner: args.owner, repo: args.repo, seam });
  if (inventory.isErr()) {
    deps.writeDiagnostic({ line: `could not read ${args.owner}/${args.repo}: ${inventory.error.message}` });
    return EXIT_ERROR;
  }
  const complete = githubExposureComplete({ inventory: inventory.value });
  if (args.json) {
    deps.out({
      line: safeJsonStringify({ label: "the exposure inventory", space: 2, value: { complete, ...inventory.value } }),
    });
  } else {
    for (const line of githubExposureLines({ inventory: inventory.value })) {
      deps.out({ line });
    }
  }
  return complete ? EXIT_OK : EXIT_ERROR;
}

/** Run the sweep, write its findings to the state home, and print its counts. */
async function runSweep({
  args,
  deps,
  seam,
  streamLog,
  home,
}: {
  args: GithubExposureArgs;
  deps: GithubExposureDeps;
  seam: GithubExposureSeam;
  streamLog: StreamJobLog;
  home: string;
}): Promise<number> {
  const load = deps.denylist({ home });
  if (load.kind === "unreadable") {
    deps.writeDiagnostic({ line: homeless({ home, line: unreadableDenylistMessage({ load }) }) });
    return EXIT_ERROR;
  }
  deps.writeDiagnostic({ line: denylistStatusLine({ load }) });
  const scanner = githubExposureScanner({
    denylist: load.kind === "loaded" ? load.lines : [],
    identifiers: repositoryContentIdentifierScanner({ rules: FORBIDDEN_IDENTIFIER_RULES }),
    ownHome: deps.ownHome(),
  });
  const swept = await sweepGithubExposure({
    nowIso: deps.nowIso,
    owner: args.owner,
    repo: args.repo,
    scanner,
    seam,
    streamLog,
  });
  if (swept.isErr()) {
    deps.writeDiagnostic({ line: `could not read ${args.owner}/${args.repo}: ${swept.error.message}` });
    return EXIT_ERROR;
  }
  const sweep = swept.value;
  const complete = githubExposureSweepComplete({ sweep });
  const directory = githubExposureRunDirectory({
    home,
    nonce: deps.nonce(),
    readAtIso: sweep.readAtIso,
    repository: sweep.repository,
  });
  const written = writeGithubExposureSweep({ complete, directory: directory.absolute, sweep });
  if (written.isErr()) {
    deps.writeDiagnostic({ line: homeless({ home, line: written.error.message }) });
    return EXIT_ERROR;
  }
  printSweep({ complete, deps, json: args.json, report: directory.homeRelative, sweep });
  return complete && sweep.findings.length === 0 ? EXIT_OK : EXIT_ERROR;
}

/** Print the sweep's counts, never a finding: the JSON document or the text lines. */
function printSweep({
  sweep,
  complete,
  report,
  json,
  deps,
}: {
  sweep: GithubExposureSweep;
  complete: boolean;
  report: string;
  json: boolean;
  deps: GithubExposureDeps;
}): void {
  if (!json) {
    for (const line of githubExposureSweepLines({ reportPath: report, sweep })) {
      deps.out({ line });
    }
    return;
  }
  const uploads = githubExposureUploadCounts({ uploads: sweep.uploads });
  deps.out({
    line: safeJsonStringify({
      label: "the exposure sweep report",
      space: 2,
      value: {
        calls: sweep.calls,
        complete,
        findings: sweep.findings.length,
        findingsByRule: Object.fromEntries(githubExposureFindingsByRule({ sweep })),
        readAtIso: sweep.readAtIso,
        report,
        repository: sweep.repository,
        surfaces: sweep.surfaces,
        uploadBytesRead: false,
        uploadLinks: uploads.links,
        uploads: uploads.uploads,
        uploadsFile: `${report}/${GITHUB_EXPOSURE_UPLOADS_FILE}`,
      },
    }),
  });
}

/**
 * Run `github exposure`.
 *
 * @param argv the full process argv; this verb's arguments begin after node, CLI, "github" and "exposure"
 * @param deps credential, seam, clock, denylist and output edges
 * @returns 0 for a complete inventory or a complete, clean sweep; 1 otherwise or on a failed read; 2 for a usage
 *   error
 */
export async function runGithubExposure({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: GithubExposureDeps;
}): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "github", rest: argv.slice(VERB_ARG_OFFSET), verb: "exposure" });
  if (gated !== undefined) {
    return gated;
  }
  const parsed = parseGithubExposureArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    for (const line of [...argsErrorLines({ error: parsed.error }), githubExposureUsage()]) {
      deps.writeDiagnostic({ line });
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = stateHomeFor({ args, deps });
  const token = deps.token({ home });
  if (token === undefined) {
    deps.writeDiagnostic({ line: "no GitHub token configured; run `slopweaver connect github`" });
    return EXIT_ERROR;
  }
  const seam = deps.makeSeam({ token });
  if (args.subVerb === "sweep") {
    return runSweep({ args, deps, home, seam, streamLog: deps.makeStreamLog({ token }) });
  }
  return runInventory({ args, deps, seam });
}

/**
 * Production edges.
 *
 * @returns the credential, the doored read seam, the wall clock, the denylist reader and the output sinks
 */
export function productionGithubExposureDeps(): GithubExposureDeps {
  return {
    denylist: ({ home }) => loadDenylistResult({ home }),
    home: slopweaverHome,
    makeSeam: ({ token }) => productionGithubExposureSeam({ token }),
    makeStreamLog: ({ token }) => productionRunLogSeams({ token }).streamLog,
    nonce: () => randomUUID().slice(0, 8),
    nowIso: () => new Date().toISOString(),
    ownHome: () => homedir(),
    out: ({ line }) => {
      logger.out({ line });
    },
    token: ({ home }) => githubToken({ home }),
    writeDiagnostic: ({ line }) => {
      logger.warn({ msg: line });
    },
  };
}

/** `slopweaver github exposure`. */
export const githubExposureCommand = defineCommand({
  run: (argv) => runGithubExposure({ argv, deps: productionGithubExposureDeps() }),
});
