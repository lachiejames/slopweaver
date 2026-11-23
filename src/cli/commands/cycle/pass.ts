/**
 * One whole reconcile pass — the reads, the live verify leg and the assembled report — in the one place
 * every caller of it goes through.
 *
 * ## Why this is its own module rather than the verb's body
 *
 * `slopweaver cycle reconcile` was the first caller and `slopweaver session-start`'s cycle leg is the
 * second. Copying this sequence into the second one is the exact failure a past change was caught committing:
 * `journalEvidence` and `archivedDependencies` were duplicated out of the handover verb by the
 * change that introduced a second board reader, and the fix was to give the board ONE reader. The same
 * discipline applies here before the second caller exists rather than after.
 *
 * The clock does not enter here. Every caller supplies `nowIso`, so a run over a frozen fixture judges its
 * own time.
 */

import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { listBronzeFiles } from "../../../corpus/bronzeStorage.js";
import { structureFile } from "../../../corpus/corpusPaths.js";
import { type PullRequestState, staleCandidates } from "../../../cycle/classify.js";
import { type CycleWindow, currentCycles, earliestCycleStart } from "../../../cycle/currentCycle.js";
import { type CycleError, CycleErrors } from "../../../cycle/errors.js";
import type { CycleIssue } from "../../../cycle/issue.js";
import { type CycleProject, withLiveUpdates } from "../../../cycle/projectHistory.js";
import { projectUpdateProposals } from "../../../cycle/projectUpdate.js";
import { buildReport } from "../../../cycle/report.js";
import { CYCLE_STANDING_BOUNDS, type CycleReconcileReport } from "../../../cycle/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { IdentityRosterPort } from "../../../silver/identityRoster.js";
import { selectOwner } from "./owner.js";
import { readCycleWindows, readLinearScan, readPullRequestStates, readReleaseInstants } from "./read.js";
import { verifyUnresolvedPullRequests } from "./verify.js";
import { verifyOverdueProjects } from "./verifyProjects.js";

/** How each attached pull request ended, from the corpus and — when asked — from a live read. */
async function resolvePullRequests({
  home,
  mine,
  windows,
  nowIso,
  verify,
}: {
  home: string;
  mine: readonly CycleIssue[];
  windows: readonly CycleWindow[];
  nowIso: string;
  verify: boolean;
}): Promise<{ states: ReadonlyMap<string, PullRequestState>; couldNotSee: readonly string[] }> {
  const fromCorpus = await readPullRequestStates({ home });
  if (!verify) {
    return { couldNotSee: CYCLE_STANDING_BOUNDS, states: fromCorpus };
  }
  // The verify leg reads live, so it is pointed at EXACTLY the tickets the card can mention, never at
  // every issue ever assigned — which is how its bound got spent on tickets nobody would see.
  const cycles = currentCycles({ nowIso, windows });
  const cycleStartsAt = earliestCycleStart({ cycles });
  const candidates =
    cycleStartsAt === undefined
      ? []
      : staleCandidates({ cycleStartsAt, currentCycleIds: new Set(cycles.keys()), issues: mine });
  const verified = await verifyUnresolvedPullRequests({ home, issues: candidates, known: fromCorpus });
  return {
    couldNotSee: [
      ...CYCLE_STANDING_BOUNDS,
      `--verify read ${String(verified.attempted)} pull request(s) live; ${String(verified.stillUnknown.length)} could still not be resolved`,
    ],
    states: new Map([...fromCorpus, ...verified.states]),
  };
}

/**
 * The projects whose update history is re-read live, and the histories that came back.
 *
 * Pointed at EXACTLY the projects the card would otherwise name, by taking the candidate set from a pure
 * pass over bronze rather than re-deriving "overdue" here. The set verified and the set shown are then the
 * same function's output run twice, so they cannot drift apart.
 *
 * The patched rows are handed back to that same pure function, which means an already-updated project is
 * DROPPED by the ordinary overdue test rather than annotated. That distinction is the point: an annotated
 * row still carries `post` among its one-word replies, and one word is all it takes to post a duplicate.
 * The at-most-once guard (`projectUpdateIntentId`) keys an answer by the proposal's overdue window when the
 * form names it, so a stale proposal — which names the very window already answered — collides with that
 * answer. But the guard is this home's ledger and only as good as a form that carries the window; one posted
 * from another home, or by hand, left nothing for it to collide with. Dropping needs neither.
 */
async function resolveProjectUpdates({
  home,
  issues,
  nowIso,
  ownerLinearId,
  projects,
  verify,
}: {
  home: string;
  issues: readonly CycleIssue[];
  nowIso: string;
  ownerLinearId: string;
  projects: readonly CycleProject[];
  verify: boolean;
}): Promise<{ projects: readonly CycleProject[]; couldNotSee: readonly string[] }> {
  if (!verify) {
    return { couldNotSee: [], projects };
  }
  const proposed = projectUpdateProposals({ issues, leadId: ownerLinearId, nowIso, projects });
  const idByUrl = new Map(projects.map((project) => [project.url, project.id]));
  const targets = proposed.flatMap((proposal) => {
    const id = idByUrl.get(proposal.url);
    return id === undefined ? [] : [{ id, url: proposal.url }];
  });
  if (targets.length === 0) {
    return { couldNotSee: [], projects };
  }
  const verified = await verifyOverdueProjects({ home, targets });
  return {
    couldNotSee: [
      `--verify re-read ${String(verified.attempted)} project(s) live; ${String(verified.stillUnknown.length)} could still not be read and stay on the corpus's own account`,
    ],
    projects: withLiveUpdates({ projects, seen: verified.seen }),
  };
}

/**
 * The first bronze source this pass reads that the owner's protect list refuses, or that exists and will not list.
 * The readers list STRICTLY too, so a directory that breaks mid-pass throws rather than reading as empty; this asks
 * first so the common case is a typed refusal. Without it an unreadable GitHub directory read as no pull requests
 * and no releases, and a `--write` published that partial report over a good one.
 *
 * @param home the state home whose bronze is read
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the typed refusal, or undefined when every source lists
 */
function unreadableBronze({
  home,
  protection,
}: {
  home: string;
  protection: OwnerProtectionResolver | undefined;
}): CycleError | undefined {
  for (const source of ["linear", "github"] as const) {
    const listed = listBronzeFiles({ home, protection, source, strict: true });
    if (listed.isErr()) {
      if (listed.error.code === "BRONZE_LIST_PROTECTED") {
        return CycleErrors.corpusProtected({ message: listed.error.message, source });
      }
      return CycleErrors.corpusUnreadable({ cause: listed.error.message, source });
    }
  }
  return undefined;
}

/**
 * The gap lines for bronze records the scans could not read, so a report that is missing them says so rather
 * than publishing looking whole (a Codex review, r1-02c).
 *
 * @param linear issue, project, project-update or cut-off Linear lines no parser accepted
 * @param releases release or cut-off GitHub lines the release scan could not read
 * @returns one line per source with a gap, none when every record read
 */
function unreadableRecords({ linear, releases }: { linear: number; releases: number }): readonly string[] {
  const gaps: string[] = [];
  if (linear > 0) {
    gaps.push(
      `${String(linear)} Linear issue, project or project-update record(s) in bronze could not be read, so this card may be missing them`,
    );
  }
  if (releases > 0) {
    gaps.push(
      `${String(releases)} GitHub release record(s) in bronze could not be read, so a ticket held for release may already have shipped`,
    );
  }
  return gaps;
}

/**
 * The owner, selected from the store's identity roster row, once every bronze source the pass reads has listed; or
 * the typed reason either could not answer.
 */
async function rosterOwner({
  home,
  identityRoster,
  protection,
}: {
  home: string;
  identityRoster: IdentityRosterPort;
  protection: OwnerProtectionResolver | undefined;
}): Promise<ReturnType<typeof selectOwner>> {
  const unlisted = unreadableBronze({ home, protection });
  if (unlisted !== undefined) {
    return err(unlisted);
  }
  const roster = await identityRoster.read({ home });
  if (roster.isErr()) {
    return err(CycleErrors.identityRosterUnreadable({ cause: roster.error }));
  }
  return selectOwner({ records: roster.value.records });
}

/**
 * Run one reconcile pass over a home.
 *
 * @param home the state home to read
 * @param nowIso the instant the answer is about, supplied rather than read
 * @param verify whether the unresolved pull requests and overdue projects are re-read live through the door
 * @param identityRoster the door the store's identity roster is read through, once, for the owner
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the assembled report, or the typed reason the pass could not run
 */
export async function reconcilePass({
  home,
  identityRoster,
  nowIso,
  protection,
  verify,
}: {
  home: string;
  identityRoster: IdentityRosterPort;
  nowIso: string;
  protection?: OwnerProtectionResolver | undefined;
  verify: boolean;
}): Promise<Result<CycleReconcileReport, CycleError>> {
  const owner = await rosterOwner({ home, identityRoster, protection });
  if (owner.isErr()) {
    return err(owner.error);
  }
  const structuresPath = structureFile({ home, source: "linear" });
  const windows = await readCycleWindows({ path: structuresPath });
  if (windows.length === 0) {
    return err(CycleErrors.noCycleStructure({ path: structuresPath }));
  }
  const { issues, projects, unreadable } = await readLinearScan({ home });
  if (issues.length === 0 && projects.length === 0) {
    return err(CycleErrors.noLinearCorpus({ home }));
  }
  const mine = issues.filter((issue) => issue.assigneeId === owner.value.linearId);
  const resolved = await resolvePullRequests({ home, mine, nowIso, verify, windows });
  const releases = await readReleaseInstants({ home });
  const live = await resolveProjectUpdates({
    home,
    issues,
    nowIso,
    ownerLinearId: owner.value.linearId,
    projects,
    verify,
  });
  return ok(
    buildReport({
      couldNotSee: [
        ...unreadableRecords({ linear: unreadable, releases: releases.unreadable }),
        ...resolved.couldNotSee,
        ...live.couldNotSee,
      ],
      home,
      issues,
      nowIso,
      ownerLinearId: owner.value.linearId,
      ownerName: owner.value.name,
      projects: live.projects,
      pullRequests: resolved.states,
      releases: releases.instants,
      windows,
    }),
  );
}
