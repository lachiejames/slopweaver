/**
 * A workspace seats a recipe failure finding only while a registered agent host runs in it, and a finding slug two
 * docs claim is named rather than collapsed.
 *
 * ## A host, not a process
 *
 * `./reconcileRows.ts`'s `workedFromCmux` maps every listed workspace to its row (`./seatBinding.ts`), and cmux
 * keeps listing a workspace after its agent exits — a bare shell, and after a reboot every restored tab
 * (`skills/supervisor/reference/reboot.md`). So a dead seat on a `recipe-failing-*` row read as worked, kept the
 * row out of `ready` and `held`, and let every later tick pass `../../../supervisor/recipeFailureGate.ts` over a
 * broken integration nobody was repairing. `../../../cmux/liveness.ts`'s
 * `alive` is not the answer either: it means "anything but a shell", and a `vim` or a dev server an exited agent
 * left behind passes it. So a workspace on such a row counts only when a pid in its cmux process
 * tree is an interactive Claude Code session registered in `<claude home>/sessions/<pid>.json` AND still the
 * process that record describes — its `ps` start equal to the record's `procStart`, so a pid a dead session's
 * leftover file shares with a `vim` proves nothing (the rule `cmux reseat` and `fleet resume` bind
 * by, `../../../fleet/liveSeat.ts`). A tree, a registry file or a `ps` listing that will not read, or a tree with no
 * such pid in it, seats nothing: the row is RUN NOW again and the gate refuses it. A seat on another host
 * registers no pid there, so the chair names it in a `hold-rationale`.
 *
 * Scoped to those rows on purpose: one process-tree read per seat on a broken integration, where the whole fleet
 * would be one per workspace on every reconcile.
 *
 * ## Two docs, one slug
 *
 * Reconciliation is keyed by row id, so one seat on a slug two docs claim seats both and drops both from `held`
 * (`../../../handover/reconcile.ts`'s duplicate-slug residue). `handover register` never writes such a pair, but a
 * hand-written doc can, so {@link duplicateRecipeFailureSlugs} lists every finding slug claimed more than once and
 * the gate refuses the tick until one is renamed or archived — the board-wide resolution stays that residue's.
 */
import { join } from "node:path";
import type { CmuxProcess, CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { isLiveSeat, liveSeatsFromScan } from "../../../fleet/liveSeat.js";
import { readProcessStarts } from "../../../fleet/processStarts.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import { type SessionScan, scanSessions } from "../../../sessions/liveSessionStore.js";
import { type SessionItem } from "../../../sessions/session.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { RECIPE_FAILURE_PREFIX } from "../../../supervisor/recipeFailureGate.js";
import { seatRowOf } from "./seatBinding.js";
import { seatNameOf } from "./seatName.js";

/** The two reads a seat is proven by, injected so the proof is testable with plain fakes. */
export interface RecipeFailureSeatReads {
  /** Every pid cmux attributes to one workspace's surfaces, or why the tree did not read. */
  readonly treePids: (options: { workspaceId: string }) => Promise<Result<readonly number[], string>>;
  /** Every pid running the interactive Claude Code session its registry file records — {@link hostPidsFrom}. */
  readonly hostPids: () => Result<ReadonlySet<number>, string>;
}

/**
 * Every pid anywhere in a process tree, depth-first.
 *
 * @param processes the tree cmux attributes to a workspace
 * @returns the pids
 */
export function pidsOfTree({ processes }: { processes: readonly CmuxProcess[] }): readonly number[] {
  return processes.flatMap((process) => [process.pid, ...pidsOfTree({ processes: process.children })]);
}

/**
 * The workspaces seated on a recipe failure finding — the ones whose seat must be proven. A workspace qualifies when
 * the ONE seat reading `workedFromCmux` maps it by (`./seatBinding.ts`'s `seatRowOf`) names such a row, so a seat a
 * ledger binding places on one cannot skip the proof, OR when its directory alone names one, so a ledger binding to
 * some other row never lets a recipe failure worktree skip it either.
 *
 * @param rowIds every board row id a seat may stand on
 * @param sessions the folded session ledger, most recently opened first
 * @param workspaces the cmux listing
 * @returns the workspace ids to prove a host in
 */
export function recipeFailureWorkspaceIds({
  rowIds,
  sessions,
  workspaces,
}: {
  rowIds: ReadonlySet<string>;
  sessions: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[];
}): readonly string[] {
  return workspaces
    .filter(
      (workspace) =>
        seatRowOf({ rowIds, sessions, workspace })?.startsWith(RECIPE_FAILURE_PREFIX) === true ||
        seatNameOf({ directory: workspace.currentDirectory }).startsWith(RECIPE_FAILURE_PREFIX),
    )
    .map((workspace) => workspace.workspaceId);
}

/**
 * The listing with every recipe failure workspace no host was proven in dropped, so it seats nothing.
 *
 * @param rowIds every board row id a seat may stand on
 * @param sessions the folded session ledger, most recently opened first
 * @param workspaces the cmux listing
 * @param hosted the workspace ids a registered host pid was found in
 * @returns the listing a reconcile may read as worked
 */
export function withProvenRecipeFailureSeats({
  hosted,
  rowIds,
  sessions,
  workspaces,
}: {
  hosted: ReadonlySet<string>;
  rowIds: ReadonlySet<string>;
  sessions: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[];
}): readonly CmuxWorkspaceSummary[] {
  const owed = new Set(recipeFailureWorkspaceIds({ rowIds, sessions, workspaces }));
  return workspaces.filter((workspace) => !owed.has(workspace.workspaceId) || hosted.has(workspace.workspaceId));
}

/**
 * The pids of the interactive Claude Code sessions running NOW — each record's own process, never one that inherited
 * its pid from a session that died and left its file behind (`../../../fleet/liveSeat.ts`). A refused registry file
 * fails the whole read, since it may be the very session a tree holds.
 *
 * @param scan what the registry scan found, the files it refused included
 * @param starts each running pid's start stamp
 * @returns the host pids, or why the registry cannot say
 */
export function hostPidsFrom({
  scan,
  starts,
}: {
  scan: SessionScan;
  starts: ReadonlyMap<number, string>;
}): Result<ReadonlySet<number>, string> {
  return liveSeatsFromScan({ scan, starts }).map(
    (records) => new Set(records.filter((record) => isLiveSeat({ record, starts })).map((record) => record.pid)),
  );
}

/** The production reads: one cmux connection per tree, and Claude Code's own session registry bound to `ps`. */
function realSeatReads(): RecipeFailureSeatReads {
  return {
    hostPids: () => {
      const read = readProcessStarts();
      // Nothing displays this: an unreadable read only seats nothing, so the tick gate refuses the row instead.
      if ("why" in read) {
        return err(read.why);
      }
      return hostPidsFrom({
        scan: scanSessions({ sessionsDir: join(claudeHomeDir(), "sessions") }),
        starts: read.starts,
      });
    },
    treePids: ({ workspaceId }) =>
      withCmuxSessionHost({
        body: async ({ host }) => {
          const tree = await host.processTree({ workspaceId });
          return tree.isErr() ? err(tree.error.message) : ok(pidsOfTree({ processes: tree.value }));
        },
      }),
  };
}

/**
 * Prove a registered host in each recipe failure workspace, and drop the ones it could not be proven in.
 *
 * @param rowIds every board row id a seat may stand on
 * @param sessions the folded session ledger, most recently opened first
 * @param workspaces the cmux listing, or `undefined` when cmux could not be read
 * @param reads the tree and registry reads, the real ones unless a caller injects others
 * @returns the listing a reconcile may read as worked, or `undefined` when there was none
 */
export async function provenRecipeFailureSeats({
  reads = realSeatReads(),
  rowIds,
  sessions,
  workspaces,
}: {
  reads?: RecipeFailureSeatReads;
  rowIds: ReadonlySet<string>;
  sessions: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[] | undefined;
}): Promise<readonly CmuxWorkspaceSummary[] | undefined> {
  if (workspaces === undefined) {
    return undefined;
  }
  const candidates = recipeFailureWorkspaceIds({ rowIds, sessions, workspaces });
  const hosted = new Set<string>();
  const hosts = candidates.length === 0 ? ok(new Set<number>()) : reads.hostPids();
  if (hosts.isOk()) {
    for (const workspaceId of candidates) {
      const pids = await reads.treePids({ workspaceId });
      if (pids.isOk() && pids.value.some((pid) => hosts.value.has(pid))) {
        hosted.add(workspaceId);
      }
    }
  }
  return withProvenRecipeFailureSeats({ hosted, rowIds, sessions, workspaces });
}

/**
 * Every recipe failure finding slug more than one live board doc claims, sorted so two reads diff.
 *
 * @param docs every doc the board scan found
 * @returns the slugs claimed twice or more
 */
export function duplicateRecipeFailureSlugs({ docs }: { docs: readonly HandoverDoc[] }): readonly string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const doc of docs.filter((each) => each.slug.startsWith(RECIPE_FAILURE_PREFIX))) {
    if (seen.has(doc.slug)) {
      twice.add(doc.slug);
    }
    seen.add(doc.slug);
  }
  return [...twice].toSorted();
}
