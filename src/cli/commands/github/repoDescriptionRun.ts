/**
 * The governed description write behind `github repo --description`: read the live description, report a no-op or a
 * dry run, else send it once through the door and confirm it by read-back. Dispatched from `./repoRun.ts`.
 */

import { DEFAULT_GATES } from "../../../admit/door.js";
import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { err, ok } from "../../../lib/result.js";
import type { GithubRepoDescriptionApi, RepoDescription } from "../../../outbound/github/repoDescription.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { GithubVerbErrors, type GithubVerbResult, githubVerbErrorLines } from "./errors.js";
import { type GithubRepoArgs, repoDescriptionDoorRequest } from "./repoCore.js";

/** The edges one description write needs. */
export interface RepoDescriptionSeams {
  readonly api: GithubRepoDescriptionApi;
  readonly home: string;
  readonly ledger: DoorLedgerPort;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** Convert a neverthrow provider result into the command's small ordinary Result. */
async function readDescription({
  api,
  args,
}: {
  api: GithubRepoDescriptionApi;
  args: GithubRepoArgs;
}): Promise<GithubVerbResult<RepoDescription>> {
  const read = await api.read({ owner: args.owner, repo: args.repo });
  if (read.isErr()) {
    return err(GithubVerbErrors.upstreamRefused({ operation: "read description", reasons: [read.error.message] }));
  }
  return ok(read.value);
}

/** Send the description once and confirm it by read-back. */
async function setAndConfirm({
  api,
  args,
}: {
  api: GithubRepoDescriptionApi;
  args: GithubRepoArgs;
}): Promise<GithubVerbResult<RepoDescription>> {
  const set = await api.setDescription({ description: args.description, owner: args.owner, repo: args.repo });
  if (set.isErr()) {
    return err(GithubVerbErrors.upstreamRefused({ operation: "set description", reasons: [set.error.message] }));
  }
  const after = await readDescription({ api, args });
  if (after.isErr()) {
    return after;
  }
  return after.value.description === args.description
    ? after
    : err(GithubVerbErrors.descriptionUnconfirmed({ owner: args.owner, repo: args.repo }));
}

/** Print one result in the selected output mode. */
function report({
  seams,
  args,
  state,
  outcome,
}: {
  seams: RepoDescriptionSeams;
  args: GithubRepoArgs;
  state: RepoDescription;
  outcome: string;
}): void {
  seams.out(
    args.json
      ? JSON.stringify({ description: state.description, outcome, repo: `${args.owner}/${args.repo}` }, undefined, 2)
      : `${outcome} ${args.owner}/${args.repo}  ${state.htmlUrl}`,
  );
}

/**
 * The description write: read, no-op or dry-run, else send through the door and confirm by read-back.
 *
 * @param args the parsed repository and the description it should carry
 * @param seams the description client, door ledger and output edges
 * @returns the process exit code
 */
export async function runRepoDescription({
  args,
  seams,
}: {
  args: GithubRepoArgs;
  seams: RepoDescriptionSeams;
}): Promise<number> {
  const { api, home } = seams;
  const current = await readDescription({ api, args });
  if (current.isErr()) {
    githubVerbErrorLines({ error: current.error }).forEach((problem) => {
      seams.writeDiagnostic(problem);
    });
    return EXIT_ERROR;
  }
  if (current.value.description === args.description) {
    report({ args, outcome: "already set", seams, state: current.value });
    return EXIT_OK;
  }
  if (args.dryRun) {
    report({ args, outcome: "would set", seams, state: current.value });
    return EXIT_OK;
  }
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: seams.ledger,
    perform: () => setAndConfirm({ api, args }),
    request: repoDescriptionDoorRequest({ args, home }),
  });
  if (!through.performed) {
    for (const line of notPerformedLines({ command: "slopweaver github repo", through })) {
      seams.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  if (through.result.isErr()) {
    githubVerbErrorLines({ error: through.result.error }).forEach((problem) => {
      seams.writeDiagnostic(problem);
    });
    return EXIT_ERROR;
  }
  report({ args, outcome: "set", seams, state: through.result.value });
  return EXIT_OK;
}
