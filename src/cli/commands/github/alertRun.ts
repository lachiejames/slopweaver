/** Effectful shell for the governed GitHub code-scanning alert read and dismissal. */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { githubToken, slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  type CodeScanningAlert,
  type GithubAlertApi,
  makeGithubAlertApi,
} from "../../../outbound/github/codeScanning.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  alertDoorRequest,
  type GithubAlertArgs,
  type GithubAlertDismissArgs,
  type GithubAlertListArgs,
  githubDismissedReasonOf,
  parseGithubAlertArgs,
} from "./alertCore.js";
import { GITHUB_ALERT_USAGE } from "./alertUsage.js";
import { type GithubVerbError, githubVerbErrorLines } from "./errors.js";

const VERB_ARG_OFFSET = 4;

/** Injectable edges for a no-network unit test. */
export interface GithubAlertDeps {
  readonly doorLedger: DoorLedgerPort;
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubAlertApi;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** Where an alert hangs, when GitHub reports a path for it — a fixed or dismissed alert may report neither. */
function alertLocation({ alert }: { alert: CodeScanningAlert }): string | undefined {
  if (alert.location.path === undefined) {
    return undefined;
  }
  return alert.location.startLine === undefined
    ? alert.location.path
    : `${alert.location.path}:${String(alert.location.startLine)}`;
}

/** An alert's state as the list prints it — `unknown` when GitHub's response omitted the field. */
function alertStateWord({ alert }: { alert: CodeScanningAlert }): string {
  const state = alert.state;
  if (state === undefined) {
    return "unknown";
  }
  return state;
}

/** The severity a triager reads first: the security severity level when the rule carries one, else its plain severity. */
function alertSeverity({ alert }: { alert: CodeScanningAlert }): string | undefined {
  const securityLevel = alert.rule.securitySeverityLevel;
  if (securityLevel === undefined) {
    return alert.rule.severity;
  }
  return securityLevel;
}

/** The state home: `--home` when given, else the resolved default. */
function stateHomeOf({ args, deps }: { args: GithubAlertArgs; deps: GithubAlertDeps }): string {
  if (args.home === undefined) {
    return deps.home();
  }
  return args.home;
}

/** One alert as a single scannable line: number, state, rule id, severity and where it fired. */
function alertLine({ alert }: { alert: CodeScanningAlert }): string {
  const parts: readonly (string | undefined)[] = [
    `#${String(alert.number)}`,
    alertStateWord({ alert }),
    alert.rule.id,
    alertSeverity({ alert }),
    alertLocation({ alert }),
    alert.htmlUrl,
  ];
  return parts.filter((part) => part !== undefined && part.length > 0).join("  ");
}

/** Run `list` — a pure read, so it never reaches the door. */
async function runList({ deps, args }: { deps: GithubAlertDeps; args: GithubAlertListArgs }): Promise<number> {
  const token = deps.token({ home: stateHomeOf({ args, deps }) });
  if (token === undefined) {
    deps.writeDiagnostic("no GitHub token configured; run `slopweaver connect github`");
    return EXIT_ERROR;
  }
  const api = deps.makeApi({ home: stateHomeOf({ args, deps }), token });
  const ref = args.pr === undefined ? undefined : `refs/pull/${String(args.pr)}/head`;
  const page = await api.list({ owner: args.owner, ref, repo: args.repo, state: args.state });
  if (page.isErr()) {
    deps.writeDiagnostic(page.error.message);
    return EXIT_ERROR;
  }
  if (args.json) {
    deps.out(JSON.stringify({ alerts: page.value.alerts, truncated: page.value.truncated }, undefined, 2));
    return EXIT_OK;
  }
  if (page.value.alerts.length === 0) {
    deps.out(`no code-scanning alerts on ${args.owner}/${args.repo}`);
  } else {
    page.value.alerts.forEach((alert) => {
      deps.out(alertLine({ alert }));
    });
  }
  if (page.value.truncated) {
    deps.writeDiagnostic(`${args.owner}/${args.repo} carries more alerts than this read covers; list is partial`);
  }
  return EXIT_OK;
}

/** Print the alert's rule, location and its dismissal — the same shape for a dry run and a real one. */
function reportDismissal({
  deps,
  args,
  alert,
  outcome,
}: {
  deps: GithubAlertDeps;
  args: GithubAlertDismissArgs;
  alert: CodeScanningAlert;
  outcome: string;
}): void {
  if (args.json) {
    deps.out(JSON.stringify({ alert, outcome, reason: args.reason }, undefined, 2));
    return;
  }
  const parts: readonly (string | undefined)[] = [
    outcome,
    `#${String(alert.number)}`,
    alert.rule.id,
    alertLocation({ alert }),
    `reason=${args.reason}`,
    `comment="${args.comment}"`,
    alert.htmlUrl,
  ];
  deps.out(parts.filter((part) => part !== undefined && part.length > 0).join("  "));
}

/** Read the alert first — the independent re-verification `github alert dismiss` exists to force. */
async function readAlert({
  api,
  args,
}: {
  api: GithubAlertApi;
  args: GithubAlertDismissArgs;
}): Promise<Result<CodeScanningAlert>> {
  const read = await api.get({ alertNumber: args.number, owner: args.owner, repo: args.repo });
  return read.isErr() ? err([read.error.message]) : ok(read.value);
}

/** Send the one irreversible dismissal through the door and report exactly what GitHub confirmed. */
async function sendDismissal({
  deps,
  args,
  home,
  api,
}: {
  deps: GithubAlertDeps;
  args: GithubAlertDismissArgs;
  home: string;
  api: GithubAlertApi;
}): Promise<number> {
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: async () => {
      const dismissed = await api.dismiss({
        alertNumber: args.number,
        comment: args.comment,
        owner: args.owner,
        reason: githubDismissedReasonOf({ reason: args.reason }),
        repo: args.repo,
      });
      return dismissed.isErr() ? err([dismissed.error.message]) : ok(dismissed.value);
    },
    request: alertDoorRequest({ args, home }),
  });
  if (!through.performed) {
    for (const line of notPerformedLines({ command: "slopweaver github alert dismiss", through })) {
      deps.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  if (through.result.isErr()) {
    through.result.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    return EXIT_ERROR;
  }
  reportDismissal({ alert: through.result.value, args, deps, outcome: "dismissed" });
  return EXIT_OK;
}

/** Run `dismiss`: read the live alert first, then either print the plan or send the write once. */
async function runDismiss({
  deps,
  args,
  home,
}: {
  deps: GithubAlertDeps;
  args: GithubAlertDismissArgs;
  home: string;
}): Promise<number> {
  const token = deps.token({ home });
  if (token === undefined) {
    deps.writeDiagnostic("no GitHub token configured; run `slopweaver connect github`");
    return EXIT_ERROR;
  }
  const api = deps.makeApi({ home, token });
  const current = await readAlert({ api, args });
  if (current.isErr()) {
    current.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    return EXIT_ERROR;
  }
  if (args.dryRun) {
    reportDismissal({ alert: current.value, args, deps, outcome: "would dismiss" });
    return EXIT_OK;
  }
  return sendDismissal({ api, args, deps, home });
}

/**
 * Run the alert operation.
 *
 * @param argv the full process argv; this verb's arguments begin after node, CLI, "github" and "alert"
 * @param deps credential, client and output seams
 * @returns the process exit code
 */
export async function runGithubAlert({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: GithubAlertDeps;
}): Promise<number> {
  const parsed: Result<GithubAlertArgs, GithubVerbError> = parseGithubAlertArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    for (const problem of githubVerbErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(GITHUB_ALERT_USAGE);
    return EXIT_USAGE;
  }
  return parsed.value.subVerb === "list"
    ? runList({ args: parsed.value, deps })
    : runDismiss({ args: parsed.value, deps, home: stateHomeOf({ args: parsed.value, deps }) });
}

/**
 * Production GitHub and output seams.
 *
 * @returns credential, sanctioned write-client and output edges for the alert command
 */
export function productionGithubAlertDeps(): GithubAlertDeps {
  return {
    doorLedger: doorLedgerPort(),
    home: slopweaverHome,
    makeApi: ({ home, token }) => makeGithubAlertApi({ privacy: githubWritePrivacy({ home }), token }),
    out: (line) => {
      logger.out({ line });
    },
    token: ({ home }) => githubToken({ home }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
  };
}

/** `slopweaver github alert`. */
export const githubAlertCommand = defineCommand({
  run: (argv) => runGithubAlert({ argv, deps: productionGithubAlertDeps() }),
});
