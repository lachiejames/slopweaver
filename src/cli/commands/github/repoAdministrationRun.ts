/**
 * Effectful shell for `github repo`'s three irreversible writes: rename, transfer to another owner, archive.
 *
 * Each previews by default — the live state, the exact change and a digest — and sends only when `--approve`
 * quotes the digest of the plan rebuilt from a fresh read at write time, through the door's approval gate
 * (`./repoApproval.ts`). The send and the read-back that alone decides success are `./repoReadBack.ts`.
 */

import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import type { GithubRepoAdministrationApi } from "../../../outbound/github/repoAdministration.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { type GithubVerbError, githubVerbErrorLines } from "./errors.js";
import { githubRepoWriteApprovalGate } from "./repoApproval.js";
import { type GithubRepoAdministrationArgs, repoAdministrationDoorRequest } from "./repoCore.js";
import {
  type GithubRepoAdministrationPlan,
  githubRepoPlanView,
  githubRepoWriteDigest,
  isAlreadyDone,
  planRepoAdministration,
} from "./repoPlan.js";
import { type GithubRepoTransferWait, readState, sendAndConfirm } from "./repoReadBack.js";

/** The seams one administration write needs, resolved by `./repoRun.ts`. */
export interface RepoAdministrationSeams {
  readonly api: GithubRepoAdministrationApi;
  readonly home: string;
  readonly ledger: DoorLedgerPort;
  readonly wait: GithubRepoTransferWait;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The command that previews this exact write, for the preview's apply line and the gate's correction line.
 *
 * @returns the invocation, without `--approve`
 */
function previewCommandOf({ args }: { args: GithubRepoAdministrationArgs }): string {
  const base = `slopweaver github repo --repo ${args.owner}/${args.repo}`;
  switch (args.action.kind) {
    case "rename":
      return `${base} --rename-to ${args.action.newName}`;
    case "transfer":
      return `${base} --transfer-to ${args.action.newOwner}`;
    case "archive":
      return `${base} --archive`;
    default: {
      const unreachable: never = args.action;
      return unreachable;
    }
  }
}

/** One human line describing the change, for every output of the text mode. */
function changeLine({ plan }: { plan: GithubRepoAdministrationPlan }): string {
  const { current } = plan;
  const where = `${current.fullName} (id ${String(current.id)}, ${current.archived ? "archived" : "not archived"})`;
  if (plan.action.kind === "archive") {
    return `archive ${where}`;
  }
  return `${plan.action.kind} ${where} -> ${plan.targetFullName}`;
}

/** Print one outcome in the selected output mode. */
function report({
  args,
  seams,
  plan,
  fields,
  text,
}: {
  args: GithubRepoAdministrationArgs;
  seams: RepoAdministrationSeams;
  plan: GithubRepoAdministrationPlan;
  fields: Readonly<Record<string, unknown>>;
  text: readonly string[];
}): void {
  if (args.json) {
    seams.out(JSON.stringify({ ...githubRepoPlanView({ plan }), ...fields }, undefined, 2));
    return;
  }
  for (const line of text) {
    seams.out(line);
  }
}

/** Print every line of a typed failure as a diagnostic. */
function diagnose({ seams, error }: { seams: RepoAdministrationSeams; error: GithubVerbError }): void {
  for (const line of githubVerbErrorLines({ error })) {
    seams.writeDiagnostic(line);
  }
}

/**
 * Preview, or with a matching `--approve` send, one rename, transfer or archive.
 *
 * @param args the parsed administration invocation
 * @param seams the client, door ledger, transfer wait and output edges
 * @returns the process exit code
 */
export async function runRepoAdministration({
  args,
  seams,
}: {
  args: GithubRepoAdministrationArgs;
  seams: RepoAdministrationSeams;
}): Promise<number> {
  const current = await readState({ api: seams.api, owner: args.owner, repo: args.repo });
  if (current.isErr()) {
    diagnose({ error: current.error, seams });
    return EXIT_ERROR;
  }
  const plan = planRepoAdministration({ action: args.action, current: current.value, source: args });
  if (isAlreadyDone({ plan })) {
    report({
      args,
      fields: { outcome: "already done", sent: false },
      plan,
      seams,
      text: [`already done: ${changeLine({ plan })}`],
    });
    return EXIT_OK;
  }
  const digest = githubRepoWriteDigest({ plan });
  const preview = previewCommandOf({ args });
  if (args.approve === undefined) {
    report({
      args,
      fields: { digest, outcome: "preview", sent: false },
      plan,
      seams,
      text: [`preview: ${changeLine({ plan })}`, `  digest ${digest}`, `  apply:  ${preview} --approve ${digest}`],
    });
    return EXIT_OK;
  }
  return applyThroughDoor({ approve: args.approve, args, digest, plan, preview, seams });
}

/** Send the write through the door's approval gate, and report the read-back that confirms it. */
async function applyThroughDoor({
  args,
  seams,
  plan,
  digest,
  preview,
  approve,
}: {
  args: GithubRepoAdministrationArgs;
  seams: RepoAdministrationSeams;
  plan: GithubRepoAdministrationPlan;
  digest: string;
  preview: string;
  approve: string;
}): Promise<number> {
  const through = await throughDoor({
    gates: [githubRepoWriteApprovalGate({ expected: digest, preview, supplied: approve })],
    home: seams.home,
    ledger: seams.ledger,
    perform: () => sendAndConfirm({ plan, seams }),
    request: repoAdministrationDoorRequest({
      digest,
      home: seams.home,
      kind: args.action.kind,
      view: githubRepoPlanView({ plan }),
    }),
  });
  if (!through.performed) {
    for (const line of notPerformedLines({ command: preview, through })) {
      seams.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  if (through.result.isErr()) {
    diagnose({ error: through.result.error, seams });
    return EXIT_ERROR;
  }
  const confirmed = through.result.value;
  report({
    args,
    fields: { confirmed: true, digest, outcome: "confirmed", repository: confirmed, sent: true },
    plan,
    seams,
    text: [`confirmed: ${changeLine({ plan })}  ${confirmed.htmlUrl}`],
  });
  return EXIT_OK;
}
