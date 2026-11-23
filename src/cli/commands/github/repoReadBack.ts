/**
 * The send and the read-back behind `github repo`'s three irreversible writes. Split from
 * `./repoAdministrationRun.ts`, which previews, gates through the door and reports; this module performs the one
 * write and decides whether it happened.
 *
 * Success is only ever a read-back keyed on the repository's immutable id: a rename reads the new address, an
 * archive reads `archived`, and a transfer, which GitHub completes asynchronously, polls the destination a bounded
 * number of times and reports an accepted-but-unconfirmed move as exactly that.
 */

import { formatIngestError } from "../../../lib/ingestError.js";
import { err, ok } from "../../../lib/result.js";
import type {
  GithubRepoAdministrationApi,
  RepoAdministrationState,
} from "../../../outbound/github/repoAdministration.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import type { GithubRepoAdministrationPlan } from "./repoPlan.js";

/** How long a transfer's read-back waits for the destination: `attempts` reads, `intervalMs` apart. */
export interface GithubRepoTransferWait {
  readonly attempts: number;
  readonly intervalMs: number;
  readonly sleep: (args: { ms: number }) => Promise<void>;
}

/** The two seams a send and its read-back need. */
interface ReadBackSeams {
  readonly api: GithubRepoAdministrationApi;
  readonly wait: GithubRepoTransferWait;
}

/** The HTTP status GitHub answers for an address that holds no repository (yet). */
const HTTP_NOT_FOUND = 404;

/**
 * Read one address, mapping a provider failure into this directory's union.
 *
 * @param api the administration client
 * @param owner the address's owner login
 * @param repo the address's repository name
 * @returns the live state there, or the provider's refusal
 */
export async function readState({
  api,
  owner,
  repo,
}: {
  api: GithubRepoAdministrationApi;
  owner: string;
  repo: string;
}): Promise<GithubVerbResult<RepoAdministrationState>> {
  const read = await api.read({ owner, repo });
  if (read.isErr()) {
    return err(
      GithubVerbErrors.upstreamRefused({
        operation: `read ${owner}/${repo}`,
        reasons: [formatIngestError({ error: read.error })],
      }),
    );
  }
  return ok(read.value);
}

/** Poll the transfer's destination until the same repository answers there, or the bound runs out. */
async function confirmTransfer({
  plan,
  seams,
  newOwner,
}: {
  plan: GithubRepoAdministrationPlan;
  seams: ReadBackSeams;
  newOwner: string;
}): Promise<GithubVerbResult<RepoAdministrationState>> {
  const source = plan.current.fullName;
  for (let attempt = 1; attempt <= seams.wait.attempts; attempt += 1) {
    const read = await seams.api.read({ owner: newOwner, repo: plan.current.name });
    if (read.isOk()) {
      const landed =
        read.value.id === plan.current.id && read.value.fullName.toLowerCase() === plan.targetFullName.toLowerCase();
      if (landed) {
        return ok(read.value);
      }
      return err(GithubVerbErrors.repoTransferUnconfirmed({ attempts: attempt, source, target: plan.targetFullName }));
    }
    const notThereYet = read.error.kind === "http" && read.error.status === HTTP_NOT_FOUND;
    if (!notThereYet) {
      return err(
        GithubVerbErrors.upstreamRefused({
          operation: `read back ${plan.targetFullName}`,
          reasons: [formatIngestError({ error: read.error })],
        }),
      );
    }
    if (attempt < seams.wait.attempts) {
      await seams.wait.sleep({ ms: seams.wait.intervalMs });
    }
  }
  return err(
    GithubVerbErrors.repoTransferUnconfirmed({
      attempts: seams.wait.attempts,
      source,
      target: plan.targetFullName,
    }),
  );
}

/** Read the renamed address back and require the same repository under exactly the new name. */
async function confirmRename({
  plan,
  seams,
  newName,
}: {
  plan: GithubRepoAdministrationPlan;
  seams: ReadBackSeams;
  newName: string;
}): Promise<GithubVerbResult<RepoAdministrationState>> {
  const read = await readState({ api: seams.api, owner: plan.current.ownerLogin, repo: newName });
  if (read.isErr()) {
    return read;
  }
  if (read.value.id === plan.current.id && read.value.fullName === plan.targetFullName) {
    return read;
  }
  return err(GithubVerbErrors.repoRenameUnconfirmed({ source: plan.current.fullName, target: plan.targetFullName }));
}

/** Read the archived repository back and require the same repository, archived. */
async function confirmArchive({
  plan,
  seams,
}: {
  plan: GithubRepoAdministrationPlan;
  seams: ReadBackSeams;
}): Promise<GithubVerbResult<RepoAdministrationState>> {
  const read = await readState({ api: seams.api, owner: plan.current.ownerLogin, repo: plan.current.name });
  if (read.isErr()) {
    return read;
  }
  if (read.value.id === plan.current.id && read.value.archived) {
    return read;
  }
  return err(GithubVerbErrors.repoArchiveUnconfirmed({ fullName: plan.current.fullName }));
}

/**
 * Send the one write, then confirm it by read-back. The send's own response is never read as the outcome.
 *
 * @param plan the previewed write, rebuilt from a fresh read
 * @param seams the administration client and the transfer's bounded wait
 * @returns the repository as the read-back found it, or the refusal or unconfirmed outcome
 */
export async function sendAndConfirm({
  plan,
  seams,
}: {
  plan: GithubRepoAdministrationPlan;
  seams: ReadBackSeams;
}): Promise<GithubVerbResult<RepoAdministrationState>> {
  const { ownerLogin: owner, name: repo } = plan.current;
  const { action } = plan;
  switch (action.kind) {
    case "rename": {
      const sent = await seams.api.rename({ newName: action.newName, owner, repo });
      if (sent.isErr()) {
        return err(
          GithubVerbErrors.upstreamRefused({
            operation: "rename",
            reasons: [formatIngestError({ error: sent.error })],
          }),
        );
      }
      return confirmRename({ newName: action.newName, plan, seams });
    }
    case "transfer": {
      const sent = await seams.api.transfer({ newOwner: action.newOwner, owner, repo });
      if (sent.isErr()) {
        return err(
          GithubVerbErrors.upstreamRefused({
            operation: "transfer",
            reasons: [formatIngestError({ error: sent.error })],
          }),
        );
      }
      return confirmTransfer({ newOwner: action.newOwner, plan, seams });
    }
    case "archive": {
      const sent = await seams.api.archive({ owner, repo });
      if (sent.isErr()) {
        return err(
          GithubVerbErrors.upstreamRefused({
            operation: "archive",
            reasons: [formatIngestError({ error: sent.error })],
          }),
        );
      }
      return confirmArchive({ plan, seams });
    }
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}
