/**
 * Effectful shell for the governed code-scanning default-setup read, disable and enable — `enable`'s preview,
 * approval and read-back live in `./codeScanningEnableRun.ts`.
 */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { githubToken, slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  type DefaultSetupAcknowledgement,
  type GithubDefaultSetupApi,
  makeGithubDefaultSetupApi,
} from "../../../outbound/github/defaultSetup.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  codeScanningDoorRequest,
  enforcedRefusal,
  type GithubCodeScanningArgs,
  type GithubCodeScanningDisableArgs,
  isEnforced,
  parseGithubCodeScanningArgs,
  patchFailureLines,
  planDefaultSetupDisable,
} from "./codeScanningCore.js";
import { runCodeScanningEnable } from "./codeScanningEnableRun.js";
import {
  type CodeScanningObserved as Observed,
  observeCodeScanning as observe,
  reportCodeScanning as report,
} from "./codeScanningObserve.js";
import { GITHUB_CODE_SCANNING_USAGE } from "./codeScanningUsage.js";

const VERB_ARG_OFFSET = 4;

/** Injectable edges for a no-network unit test. */
export interface GithubCodeScanningDeps {
  readonly doorLedger: DoorLedgerPort;
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubDefaultSetupApi;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** After a failed PATCH, read the state back and report what it IS — never what the error implies. */
async function reportAfterFailedPatch({
  deps,
  args,
  api,
  observed,
}: {
  deps: GithubCodeScanningDeps;
  args: GithubCodeScanningDisableArgs;
  api: GithubDefaultSetupApi;
  observed: Observed;
}): Promise<number> {
  const after = await observe({ api, args });
  if (after.isErr()) {
    deps.writeDiagnostic(
      "the read-back failed too, so whether the PATCH landed is unknown — run `github code-scanning show` before retrying",
    );
    return EXIT_ERROR;
  }
  const disabled = after.value.setup.state === "not-configured";
  report({
    args,
    deps,
    extra: { before: observed.setup },
    observed: after.value,
    outcome: disabled ? "disabled despite the error" : "unchanged",
  });
  return disabled ? EXIT_OK : EXIT_ERROR;
}

/** Send the PATCH once through the door, then read the state back — the only proof of the outcome. */
async function sendDisable({
  deps,
  args,
  home,
  api,
  observed,
}: {
  deps: GithubCodeScanningDeps;
  args: GithubCodeScanningDisableArgs;
  home: string;
  api: GithubDefaultSetupApi;
  observed: Observed;
}): Promise<number> {
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: async (): Promise<Result<DefaultSetupAcknowledgement>> => {
      const sent = await api.disableDefaultSetup({ owner: args.owner, repo: args.repo });
      return sent.isErr() ? err(patchFailureLines({ error: sent.error })) : ok(sent.value);
    },
    request: codeScanningDoorRequest({ args, home }),
  });
  if (!through.performed) {
    const refusal = notPerformedLines({
      command: "slopweaver github code-scanning disable",
      through,
    });
    for (const line of refusal) {
      deps.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  if (through.result.isErr()) {
    through.result.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    return reportAfterFailedPatch({ api, args, deps, observed });
  }
  return reportAfterAcknowledgedPatch({ acknowledgement: through.result.value, api, args, deps, observed });
}

/** GitHub acknowledged the PATCH; the read-back, not the status code, decides what happened. */
async function reportAfterAcknowledgedPatch({
  acknowledgement,
  api,
  args,
  deps,
  observed,
}: {
  acknowledgement: DefaultSetupAcknowledgement;
  api: GithubDefaultSetupApi;
  args: GithubCodeScanningDisableArgs;
  deps: GithubCodeScanningDeps;
  observed: Observed;
}): Promise<number> {
  const after = await observe({ api, args });
  if (after.isErr()) {
    after.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(
      `GitHub acknowledged the disable (HTTP ${String(acknowledgement.status)}) but the read-back failed; ` +
        "run `github code-scanning show` to confirm",
    );
    return EXIT_ERROR;
  }
  const extra = { acknowledgement, before: observed.setup };
  if (after.value.setup.state === "not-configured") {
    report({ args, deps, extra, observed: after.value, outcome: "disabled" });
    return EXIT_OK;
  }
  if (acknowledgement.status === 202) {
    report({ args, deps, extra, observed: after.value, outcome: "accepted, not yet applied" });
    deps.writeDiagnostic("GitHub queued the change (HTTP 202); re-read with `github code-scanning show`");
    return EXIT_DEFERRED;
  }
  report({ args, deps, extra, observed: after.value, outcome: "NOT confirmed" });
  deps.writeDiagnostic(
    `GitHub answered HTTP ${String(acknowledgement.status)} but default setup still reads ` +
      `${String(after.value.setup.state)} — a configuration this token cannot see may be enforcing it`,
  );
  return EXIT_ERROR;
}

/** Run `disable`: decide from two fresh reads, then print the plan or send the write once. */
async function runDisable({
  deps,
  args,
  home,
  api,
  observed,
}: {
  deps: GithubCodeScanningDeps;
  args: GithubCodeScanningDisableArgs;
  home: string;
  api: GithubDefaultSetupApi;
  observed: Observed;
}): Promise<number> {
  const plan = planDefaultSetupDisable({ configuration: observed.configuration, setup: observed.setup });
  switch (plan.kind) {
    case "already-disabled":
      report({ args, deps, observed, outcome: "already disabled" });
      return EXIT_OK;
    case "blocked-enforced":
      report({ args, deps, observed, outcome: "refused" });
      deps.writeDiagnostic(enforcedRefusal({ args }));
      return EXIT_ERROR;
    case "unknown-state":
      report({ args, deps, observed, outcome: "refused" });
      deps.writeDiagnostic(`${args.owner}/${args.repo}: GitHub reported no default-setup state; nothing sent`);
      return EXIT_ERROR;
    case "disable":
      if (args.dryRun) {
        report({ args, deps, observed, outcome: "would disable" });
        return EXIT_OK;
      }
      return sendDisable({ api, args, deps, home, observed });
    default: {
      const unreachable: never = plan;
      return unreachable;
    }
  }
}

/** The `--home` the caller named, else the configured state home. */
function stateHome({ args, deps }: { args: GithubCodeScanningArgs; deps: GithubCodeScanningDeps }): string {
  if (args.home !== undefined) {
    return args.home;
  }
  return deps.home();
}

/**
 * Run the code-scanning operation.
 *
 * @param argv the full process argv; this verb's arguments begin after node, CLI, "github" and "code-scanning"
 * @param deps credential, client and output seams
 * @returns the process exit code
 */
export async function runGithubCodeScanning({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: GithubCodeScanningDeps;
}): Promise<number> {
  const parsed = parseGithubCodeScanningArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(GITHUB_CODE_SCANNING_USAGE);
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = stateHome({ args, deps });
  const token = deps.token({ home });
  if (token === undefined) {
    deps.writeDiagnostic("no GitHub token configured; run `slopweaver connect github`");
    return EXIT_ERROR;
  }
  const api = deps.makeApi({ home, token });
  const observed = await observe({ api, args });
  if (observed.isErr()) {
    observed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    return EXIT_ERROR;
  }
  if (args.subVerb === "disable") {
    return runDisable({ api, args, deps, home, observed: observed.value });
  }
  if (args.subVerb === "enable") {
    const seams = { api, home, ledger: deps.doorLedger, out: deps.out, writeDiagnostic: deps.writeDiagnostic };
    return runCodeScanningEnable({ args, observed: observed.value, seams });
  }
  const enforced =
    observed.value.configuration.kind === "read" && isEnforced({ configuration: observed.value.configuration.value });
  report({ args, deps, observed: observed.value, outcome: enforced ? "enforced from above" : "read" });
  return EXIT_OK;
}

/**
 * Production GitHub and output seams.
 *
 * @returns credential, sanctioned write-client and output edges for the code-scanning command
 */
export function productionGithubCodeScanningDeps(): GithubCodeScanningDeps {
  return {
    doorLedger: doorLedgerPort(),
    home: slopweaverHome,
    makeApi: ({ home, token }) => makeGithubDefaultSetupApi({ privacy: githubWritePrivacy({ home }), token }),
    out: (line) => {
      logger.out({ line });
    },
    token: ({ home }) => githubToken({ home }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
  };
}

/** `slopweaver github code-scanning`. */
export const githubCodeScanningCommand = defineCommand({
  run: (argv) => runGithubCodeScanning({ argv, deps: productionGithubCodeScanningDeps() }),
});
