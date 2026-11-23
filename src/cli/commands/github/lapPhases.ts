/**
 * The phases of `slopweaver github lap`, each over the seams in `./lapDeps.ts`: the preflight reads, posting
 * through the door with a read-back, one run of the lanes under the lock (`./lapLanes.ts`), and landing.
 * `./lapRun.ts` sequences them; every decision they act on is `./lapCore.ts`'s or `./lapVerdict.ts`'s.
 *
 * Landing takes the hold FIRST, then refetches both refs and requires them unmoved, then merges, releasing the
 * hold whatever happens. The hold is advisory — it serialises Slopweaver's own landings, not a write from
 * GitHub's UI — so the race it closes is the cooperative one, and `merge --admin` refusing a moved base is the
 * last word.
 */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import type { GithubProtectionReadError } from "../../../corpus/github/protectionRead.js";
import type { BranchProtection } from "../../../corpus/github/write.js";
import type { RequiredCheckSources } from "../../../corpus/github/writeStatus.js";
import type { IngestError } from "../../../lib/ingestError.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { GithubLapApi } from "../../../outbound/github/lapApi.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import type { GithubLapArgs } from "./lapCore.js";
import type { GithubLapDeps, LapLockHandle, LapRefs, LapSession } from "./lapDeps.js";
import { type LapError, LapErrors } from "./lapErrors.js";
import { type LapTarget, lapLanes, underLapLock } from "./lapLanes.js";
import type { LapStatus, LapStepOutcome } from "./lapStatuses.js";
import { type LapPreflightFacts, lapDoorRequest, lapPreflightVerdict } from "./lapVerdict.js";

/** What a passed preflight hands on. */
export interface LapPreflight {
  readonly refs: LapRefs;
  readonly baseRef: string;
  readonly notes: readonly string[];
}

/**
 * Print each diagnostic line.
 *
 * @returns nothing; each line goes to the diagnostic channel
 */
export function diagnose({ deps, lines }: { deps: GithubLapDeps; lines: readonly string[] }): void {
  for (const line of lines) {
    deps.writeDiagnostic(line);
  }
}

/**
 * One failed preflight read as the lap's own error: a protection read GitHub DENIED is its own refusal, so it
 * never reads like the plan-gated 403 the lap proceeds past; anything else is a read that failed.
 *
 * @returns the lap error naming what failed
 */
function preflightReadError({ failure }: { failure: GithubProtectionReadError | IngestError }): LapError {
  if ("branch" in failure && failure.code === "PROTECTION_PERMISSION_DENIED") {
    return LapErrors.protectionPermissionDenied({ denial: failure.message });
  }
  return LapErrors.refused({ reason: `a preflight read failed: ${failure.message}` });
}

/**
 * Whether the base enforces itself on administrators, `undefined` where nothing protects it — for either reason.
 *
 * @returns the protection's own flag, or `undefined` for a branch with no protection to enforce
 */
function enforceAdminsOf({ protection }: { protection: BranchProtection }): boolean | undefined {
  switch (protection.kind) {
    case "protected":
      return protection.enforceAdmins;
    case "unprotected":
    case "plan-unavailable":
      return undefined;
    default: {
      const unhandled: never = protection;
      return unhandled;
    }
  }
}

/**
 * The contexts a base requires, empty for both states in which it requires none.
 *
 * @returns each required context and its pinned app
 */
function requiredOf({ sources }: { sources: RequiredCheckSources }): LapPreflightFacts["required"] {
  switch (sources.kind) {
    case "required":
      return sources.sources;
    case "unprotected":
    case "plan-unavailable":
      return [];
    default: {
      const unhandled: never = sources;
      return unhandled;
    }
  }
}

/**
 * The three GitHub reads the verdict needs beyond the pull request, or every one that failed.
 *
 * @returns whether the token is an admin, the base's protection and whether it enforces itself on admins, and
 *   what it requires
 */
export async function protectionFacts({
  api,
  args,
  baseRef,
}: {
  api: GithubLapApi;
  args: GithubLapArgs;
  baseRef: string;
}): Promise<
  Result<Pick<LapPreflightFacts, "enforceAdmins" | "isAdmin" | "protection" | "required">, readonly LapError[]>
> {
  const repo = { owner: args.owner, repo: args.repo };
  const isAdmin = await api.isAdmin(repo);
  const protection = await api.protection({ ...repo, branch: baseRef });
  const required = await api.requiredSources({ ...repo, branch: baseRef });
  if (isAdmin.isErr() || protection.isErr() || required.isErr()) {
    const failed = [isAdmin, protection, required].flatMap((read) => (read.isErr() ? [read.error] : []));
    return err(failed.map((failure) => preflightReadError({ failure })));
  }
  return ok({
    enforceAdmins: enforceAdminsOf({ protection: protection.value }),
    isAdmin: isAdmin.value,
    protection: protection.value.kind,
    required: requiredOf({ sources: required.value }),
  });
}

/**
 * Everything the preflight reads and judges, under the machine's lock in its `preflight` phase, before any post or
 * lane.
 *
 * @returns the fetched refs and the notes to print, or every reason the lap will not run
 */
export async function preflight({
  api,
  args,
  deps,
}: {
  api: GithubLapApi;
  args: GithubLapArgs;
  deps: GithubLapDeps;
}): Promise<Result<LapPreflight, readonly LapError[]>> {
  const pr = await api.read({ number: args.number, owner: args.owner, repo: args.repo });
  if (pr.isErr()) {
    return err([LapErrors.refused({ reason: `could not read the pull request: ${pr.error.message}` })]);
  }
  const refs = await deps.fetchRefs({ baseRef: pr.value.baseRef, number: args.number });
  if (refs.isErr()) {
    return err([refs.error]);
  }
  if (refs.value.headSha !== pr.value.headSha) {
    const reason = `the head moved between two reads (${pr.value.headSha}, then ${refs.value.headSha}); run the lap again`;
    return err([LapErrors.refused({ reason })]);
  }
  const contains = deps.isAncestor({ ancestor: refs.value.baseTip, descendant: refs.value.headSha });
  const differing = deps.planSourcesDiffering({ headSha: refs.value.headSha });
  const facts = await protectionFacts({ api, args, baseRef: pr.value.baseRef });
  if (contains.isErr() || differing.isErr() || facts.isErr()) {
    return err([contains, differing, facts].flatMap((read) => (read.isErr() ? [read.error].flat() : [])));
  }
  const verdict = lapPreflightVerdict({
    facts: {
      ...facts.value,
      baseRef: pr.value.baseRef,
      baseTip: refs.value.baseTip,
      headContainsBase: contains.value,
      headSha: refs.value.headSha,
      planSourcesDiffering: differing.value,
      prState: pr.value.state,
    },
  });
  if (verdict.refusals.length > 0) {
    return err(verdict.refusals.map((reason) => LapErrors.refused({ reason })));
  }
  return ok({ baseRef: pr.value.baseRef, notes: verdict.notes, refs: refs.value });
}

/**
 * Ask the landing itself whether it would refuse, before the lap's first step: `github merge --admin --dry-run`
 * at the head, in a fresh tree, through the same checks the real merge makes. It runs under the lock's `preflight`
 * phase, so no second lap starts while that tree is built. A precondition no lap can fix (a
 * native stack member, a draft, a missing Codex loop) refuses here, rather than after an hour of lanes. The
 * contexts the lap has not posted yet are a note under the dry run, never a refusal: posting them is the lap's own
 * job. Without it, a stack member laps green and is then refused at the merge on a membership that was already
 * true before its first lane.
 *
 * @returns nothing on a landing that would go through, or the one reason it would not
 */
export async function preflightLanding({ session }: { session: LapSession }): Promise<Result<void, LapError>> {
  const { args, baseRef, deps, home, refs } = session;
  const tree = await deps.checkout({ sha: refs.headSha });
  if (tree.isErr()) {
    return err(
      LapErrors.refused({
        reason: `the landing could not be checked before the lap: no tree could be made to measure it in: ${tree.error.message}`,
      }),
    );
  }
  try {
    const exit = await deps.landingPreconditions({ args, baseRef, home, tree: tree.value.value });
    if (exit !== EXIT_OK) {
      return err(
        LapErrors.refused({
          reason: `the landing would refuse: \`github merge --admin --dry-run\` exited ${String(exit)}; its refusal is printed above, and no lap can clear it`,
        }),
      );
    }
    return ok(undefined);
  } finally {
    await tree.value.dispose();
  }
}

/**
 * The pauses before the second, third and fourth read of ONE confirmation, so four reads per confirmation: a lap
 * confirms twice, its pending statuses and then its verdict, and each gets its own four. GitHub's commit-status
 * list can lag the POST it just accepted: three laps in one day stopped before any lane on `"integration" was not
 * read back as pending`, and a hand rerun cleared each.
 */
const LAP_READBACK_WAITS_MS: readonly number[] = [2_000, 4_000, 8_000];

/**
 * Read the head's statuses back until every posted one is there, pausing between reads; a POST is never re-sent.
 * Only a LAGGING read is read again. A read that FAILS stops at once: its client (`commitStatusesVia`) already
 * retries a transient failure itself, so retrying it here too would compound the two budgets.
 */
async function confirmPosted({
  session,
  statuses,
}: {
  session: LapSession;
  statuses: readonly LapStatus[];
}): Promise<Result<readonly LapStatus[], LapError>> {
  const { api, args, deps, refs } = session;
  const attempts = LAP_READBACK_WAITS_MS.length + 1;
  for (let attempt = 1; ; attempt += 1) {
    const read = await api.statuses({ owner: args.owner, repo: args.repo, sha: refs.headSha });
    if (read.isErr()) {
      return err(LapErrors.postFailed({ what: `the read-back failed: ${read.error.message}` }));
    }
    const unconfirmed = statuses.filter(
      (status) =>
        !read.value.some(
          (found) =>
            found.context === status.context &&
            found.state === status.state &&
            found.description === status.description,
        ),
    );
    if (unconfirmed.length === 0) {
      return ok(statuses);
    }
    if (attempt === attempts) {
      const missing = unconfirmed.map((status) => `"${status.context}" was not read back as ${status.state}`);
      return err(LapErrors.postFailed({ what: `${missing.join("; ")} after ${String(attempts)} read-back attempts` }));
    }
    await deps.wait({ ms: LAP_READBACK_WAITS_MS[attempt - 1]! });
  }
}

/** Post every status, then confirm each by read-back: right state, right description. */
async function postAndConfirm({
  session,
  statuses,
}: {
  session: LapSession;
  statuses: readonly LapStatus[];
}): Promise<Result<readonly LapStatus[], LapError>> {
  const { api, args, refs } = session;
  for (const status of statuses) {
    const posted = await api.postStatus({ ...status, owner: args.owner, repo: args.repo, sha: refs.headSha });
    if (posted.isErr()) {
      return err(LapErrors.postFailed({ what: `posting "${status.context}" failed: ${posted.error.message}` }));
    }
  }
  return confirmPosted({ session, statuses });
}

/**
 * Post statuses on the head through the door, printing each one confirmed or every reason it was not.
 *
 * @returns whether every status was posted and read back
 */
export async function post({
  session,
  statuses,
}: {
  session: LapSession;
  statuses: readonly LapStatus[];
}): Promise<boolean> {
  const { args, deps, home, refs } = session;
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => postAndConfirm({ session, statuses }),
    request: lapDoorRequest({ args, headSha: refs.headSha, home }),
  });
  if (!through.performed) {
    diagnose({ deps, lines: notPerformedLines({ command: "slopweaver github lap", through }) });
    return false;
  }
  if (through.result.isErr()) {
    diagnose({ deps, lines: [`github lap: ${through.result.error.message}`] });
    return false;
  }
  for (const status of through.result.value) {
    deps.out(`github lap: posted ${status.context} ${status.state} — ${status.description}`);
  }
  return true;
}

/**
 * A single pull request's target: its own head, posted on through the door.
 *
 * @returns the target `lapInside` runs a one-pull-request lap over
 */
function headTarget({ session }: { session: LapSession }): LapTarget {
  return {
    baseTip: session.refs.baseTip,
    batch: undefined,
    note: undefined,
    post: ({ statuses }) => post({ session, statuses }),
    tested: session.refs.headSha,
  };
}

/**
 * Advance the machine's lock to `running` on the head, post `pending`, run the lanes over the head and tear
 * everything down whatever happened.
 *
 * @param lock the lock this invocation took before its preflight
 * @returns every step that ran, or every reason none could
 */
export async function lapInside({
  session,
  lock,
}: {
  session: LapSession;
  lock: LapLockHandle;
}): Promise<Result<readonly LapStepOutcome[], readonly LapError[]>> {
  const { args, deps, refs } = session;
  const startedIso = deps.now().toISOString();
  const subject = `${args.owner}/${args.repo}#${String(args.number)}@${refs.headSha}`;
  return underLapLock({
    lock,
    run: () => lapLanes({ session, startedIso, subject, target: headTarget({ session }) }),
    startedIso,
    subject,
  });
}

/**
 * Land under the hold: take it, refetch and require both refs unmoved, merge, release whatever happened. The
 * merge measures in a fresh tree at the lapped head rather than the seat's own checkout, so the Codex loop it
 * reads is the pull request's — every checkout holding that head — and never the lapping seat's branch. MEASURED:
 * a green lap was refused `codex-loop-incomplete` on a pass the LAPPING seat's branch had
 * recorded with no tree ("measured in tree:" in the lap's output named the seat's checkout).
 *
 * RESIDUE, stated: the standing-hold read and `github hold` are two reads of one file, not one atomic act, so a
 * process that hides the hold document for the first and restores it for the second defeats the check. That
 * process can delete or rewrite the hold outright anyway; the hold is advisory by mechanism,
 * and the check guards against a hold another SESSION placed through the verbs, never against the store being
 * edited underneath them.
 *
 * @returns the hold's or the merge's own exit code, or an error exit when a ref moved or no tree could be made
 */
export async function land({ session }: { session: LapSession }): Promise<number> {
  const { args, baseRef, deps, home, refs } = session;
  const standing = deps.standingHold({ args, home });
  if (standing.kind === "held") {
    deps.writeDiagnostic(
      `github lap: not landing — ${args.owner}/${args.repo}'s merge queue is already held by ${standing.holder}, and a hold the lap did not place is never the lap's to release; land once it is released`,
    );
    return EXIT_ERROR;
  }
  if (standing.kind === "unreadable") {
    deps.writeDiagnostic(
      `github lap: not landing — the merge hold at ${standing.path} could not be read (${standing.why}), so a hold already standing there cannot be ruled out; repair or remove that file, then land`,
    );
    return EXIT_ERROR;
  }
  const held = await deps.hold({ args, home });
  if (held !== EXIT_OK) {
    deps.writeDiagnostic("github lap: not landing — the hold could not be taken");
    return held;
  }
  try {
    const after = await deps.fetchRefs({ baseRef, number: args.number });
    const unmoved = after.isOk() && after.value.baseTip === refs.baseTip && after.value.headSha === refs.headSha;
    if (!unmoved) {
      deps.writeDiagnostic(
        "github lap: not landing — the base or the head moved while the lap ran, so the tree it tested is not the tree that would land; rebase, push and lap again",
      );
      return EXIT_ERROR;
    }
    const tree = await deps.checkout({ sha: refs.headSha });
    if (tree.isErr()) {
      deps.writeDiagnostic(
        `github lap: not landing — no tree could be made to measure the merge in: ${tree.error.message}`,
      );
      return EXIT_ERROR;
    }
    try {
      return await deps.merge({ args, baseRef, home, tree: tree.value.value });
    } finally {
      await tree.value.dispose();
    }
  } finally {
    await deps.release({ args, home });
  }
}
