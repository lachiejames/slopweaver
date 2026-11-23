/**
 * Effectful shell for `github code-scanning enable`: preview by default, send once only on a matching
 * `--approve`, and judge the outcome by a read-back of default setup alone.
 *
 * Split from `./codeScanningRun.ts`, which owns `show`, `disable`, credential resolution and the two shared
 * reads; the pure decision, digest and approval gate are `./codeScanningEnablePlan.ts`. GitHub's 200/202 is
 * kept as an acknowledgement beside the before and after states, never as proof: only `state: configured`
 * read back after the send is `enabled`. The read-back is default setup ALONE, so confirming the write never
 * depends on a second configuration read succeeding.
 */

import { DEFAULT_GATES } from "../../../admit/door.js";
import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { formatIngestError } from "../../../lib/ingestError.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { DefaultSetupAcknowledgement, GithubDefaultSetupApi } from "../../../outbound/github/defaultSetup.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { type GithubCodeScanningEnableArgs, patchFailureLines } from "./codeScanningCore.js";
import {
  decideDefaultSetupEnable,
  type EnablePlan,
  enableApprovalGate,
  enableDoorRequest,
  enablePlanView,
  enableWriteDigest,
} from "./codeScanningEnablePlan.js";
import { type CodeScanningObserved as Observed, reportCodeScanning as report } from "./codeScanningObserve.js";

/** The seams `enable` needs, resolved by `./codeScanningRun.ts`. */
export interface CodeScanningEnableSeams {
  readonly api: GithubDefaultSetupApi;
  readonly home: string;
  readonly ledger: DoorLedgerPort;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** The refusal line each decision that sends nothing earns. */
const REFUSALS = {
  "blocked-enforced":
    "an ENFORCED security configuration is attached (named above); it can silently undo a repository-level " +
    "enable, so a read-back could not be trusted — an organisation admin sets default setup through that " +
    "configuration instead; nothing sent",
  "unknown-configuration":
    "the attached security configuration could not be read, so an enforced one cannot be ruled out — read it " +
    "with a token that can (`github code-scanning show`), or have an organisation admin confirm none applies; " +
    "nothing sent",
  "unknown-state": "GitHub reported no default-setup state; nothing sent",
} as const;

/** The command that previews this exact write, for the apply line and the gate's correction line. */
function previewCommandOf({ args }: { args: GithubCodeScanningEnableArgs }): string {
  return `slopweaver github code-scanning enable --repo ${args.owner}/${args.repo}`;
}

/** Print one outcome over the plan: the two reads as `show` prints them, the identity, then any further lines. */
function reportPlan({
  args,
  seams,
  plan,
  observed,
  outcome,
  fields,
  lines = [],
}: {
  args: GithubCodeScanningEnableArgs;
  seams: CodeScanningEnableSeams;
  plan: EnablePlan;
  observed: Observed;
  outcome: string;
  fields: Readonly<Record<string, unknown>>;
  lines?: readonly string[];
}): void {
  report({ args, deps: seams, extra: { ...enablePlanView({ plan }), ...fields }, observed, outcome });
  if (args.json) {
    return;
  }
  const { repository } = plan;
  seams.out(
    `  repository: ${repository.fullName} id=${String(repository.id)}${repository.archived ? " ARCHIVED" : ""}`,
  );
  for (const line of lines) {
    seams.out(line);
  }
}

/**
 * Run `enable` over the two fresh reads: decide, then read the repository identity and preview or send once.
 *
 * @param args the parsed enable
 * @param seams the client, door ledger and output edges
 * @param observed the default setup and configuration just read
 * @returns the process exit code
 */
export async function runCodeScanningEnable({
  args,
  seams,
  observed,
}: {
  args: GithubCodeScanningEnableArgs;
  seams: CodeScanningEnableSeams;
  observed: Observed;
}): Promise<number> {
  const decision = decideDefaultSetupEnable({ configuration: observed.configuration, setup: observed.setup });
  if (decision.kind === "already-enabled") {
    report({ args, deps: seams, extra: { sent: false }, observed, outcome: "already enabled" });
    return EXIT_OK;
  }
  if (decision.kind !== "eligible") {
    report({ args, deps: seams, extra: { sent: false }, observed, outcome: "refused" });
    seams.writeDiagnostic(`${args.owner}/${args.repo}: ${REFUSALS[decision.kind]}`);
    return EXIT_ERROR;
  }
  const repository = await seams.api.repository({ owner: args.owner, repo: args.repo });
  if (repository.isErr()) {
    seams.writeDiagnostic(formatIngestError({ error: repository.error }));
    return EXIT_ERROR;
  }
  const plan: EnablePlan = {
    before: observed.setup,
    configuration: decision.configuration,
    repository: repository.value,
    source: { owner: args.owner, repo: args.repo },
  };
  const digest = enableWriteDigest({ plan });
  const command = previewCommandOf({ args });
  if (args.approve === undefined) {
    reportPlan({
      args,
      fields: { digest, sent: false },
      lines: [
        `  patch ${JSON.stringify(enablePlanView({ plan })["patch"])} (not-configured -> configured)`,
        `  digest ${digest}`,
        `  apply:  ${command} --approve ${digest}`,
      ],
      observed,
      outcome: "preview",
      plan,
      seams,
    });
    return EXIT_OK;
  }
  return sendThroughDoor({ approve: args.approve, args, command, digest, observed, plan, seams });
}

/** Send the PATCH once through the approval gate, then read default setup back — the only proof. */
async function sendThroughDoor({
  args,
  seams,
  plan,
  observed,
  digest,
  command,
  approve,
}: {
  args: GithubCodeScanningEnableArgs;
  seams: CodeScanningEnableSeams;
  plan: EnablePlan;
  observed: Observed;
  digest: string;
  command: string;
  approve: string;
}): Promise<number> {
  const through = await throughDoor({
    gates: [...DEFAULT_GATES, enableApprovalGate({ expected: digest, preview: command, supplied: approve })],
    home: seams.home,
    ledger: seams.ledger,
    perform: async (): Promise<Result<DefaultSetupAcknowledgement>> => {
      const sent = await seams.api.enableDefaultSetup({ owner: args.owner, repo: args.repo });
      return sent.isErr() ? err(patchFailureLines({ error: sent.error })) : ok(sent.value);
    },
    request: enableDoorRequest({ digest, home: seams.home, view: enablePlanView({ plan }) }),
  });
  if (!through.performed) {
    for (const line of notPerformedLines({ command, through })) {
      seams.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  if (through.result.isOk()) {
    return reportAfterSend({ acknowledgement: through.result.value, args, digest, observed, plan, seams });
  }
  for (const problem of through.result.error) {
    seams.writeDiagnostic(problem);
  }
  return reportAfterSend({ acknowledgement: undefined, args, digest, observed, plan, seams });
}

/**
 * Read default setup back and report what it IS. `acknowledgement` is undefined when the PATCH failed: neither
 * a dropped connection nor a 5xx proves it was not applied, so the read-back decides that too.
 */
async function reportAfterSend({
  args,
  seams,
  plan,
  observed,
  digest,
  acknowledgement,
}: {
  args: GithubCodeScanningEnableArgs;
  seams: CodeScanningEnableSeams;
  plan: EnablePlan;
  observed: Observed;
  digest: string;
  acknowledgement: DefaultSetupAcknowledgement | undefined;
}): Promise<number> {
  const after = await seams.api.defaultSetup({ owner: args.owner, repo: args.repo });
  if (after.isErr()) {
    seams.writeDiagnostic(formatIngestError({ error: after.error }));
    seams.writeDiagnostic(
      "the read-back failed, so whether default setup is now on is unknown — run " +
        `\`slopweaver github code-scanning show --repo ${args.owner}/${args.repo}\` before retrying`,
    );
    return EXIT_ERROR;
  }
  const state = after.value.state;
  const reported = {
    args,
    fields: { acknowledgement, after: after.value, digest, sent: true },
    observed: { ...observed, setup: after.value },
    plan,
    seams,
  };
  if (state === "configured") {
    reportPlan({ ...reported, outcome: acknowledgement === undefined ? "enabled despite the error" : "enabled" });
    return EXIT_OK;
  }
  if (acknowledgement === undefined) {
    reportPlan({ ...reported, outcome: "unchanged" });
    return EXIT_ERROR;
  }
  if (acknowledgement.status === 202) {
    reportPlan({ ...reported, outcome: "accepted, not yet applied" });
    seams.writeDiagnostic("GitHub queued the change (HTTP 202); re-read with `github code-scanning show`");
    return EXIT_DEFERRED;
  }
  reportPlan({ ...reported, outcome: "NOT confirmed" });
  seams.writeDiagnostic(
    `GitHub answered HTTP ${String(acknowledgement.status)} but default setup still reads ${String(state)} — ` +
      "a configuration this token cannot see may be overriding it",
  );
  return EXIT_ERROR;
}
