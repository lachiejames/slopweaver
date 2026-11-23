/**
 * Whether a standing session may respawn itself RIGHT NOW — pure.
 *
 * ## Three gates, and each one closes a failure that actually happened
 *
 * 1. **Is it owed?** A respawn is only a respawn when the session is `stale` — running code or prose the
 *    fleet has already replaced. Respawning a session that is merely a few commits behind burns its context
 *    and the fleet's attention for nothing, which is exactly the overkill `cmux/baseFreshness.ts`'s own
 *    ruling refuses in its neighbouring case.
 * 2. **Is the moment quiet?** The owner's standing instruction for these sessions is that they are respawned
 *    at a quiet moment — no ask mid-dispatch, no recipe slot in flight (`skills/loop/reference/
 *    context-hygiene.md`). A respawn that lands while a worker is mid-answer strands the answer.
 * 3. **Is the successor's run free?** Measured: two hand restarts both booted idle on a pickup
 *    false negative, and the OLD listener then respawned itself on a relay, so TWO loop sessions existed on
 *    one doc for five minutes and Slack load-balanced tags across them. A respawn onto a doc whose run is
 *    held by a live session is refused here rather than left to whoever notices first.
 *
 * The verdict is a value, not a boolean: a refusal carries the sentence explaining it, because the caller is
 * a standing session whose only way to say "I did not respawn, and here is why" is to print it.
 */
import { isListenerDown, type ListenerLiveness } from "../listen/supervise/liveness.js";
import type { StandingFreshnessGrade } from "./freshness.js";

/**
 * How many asks a worker could actually be mid-turn on, from the folded ask lifecycle.
 *
 * ## Why `activeDispatch` and not `activeAsks`
 *
 * The first version of this gate reused `live/ask/burst.ts`'s `activeAsks`, and that was the wrong register.
 * `activeAsks` bounds burst CONCURRENCY and is deliberately generous — it counts `lease-expired` as active so
 * a tag burst cannot proceed against a holder nobody can see. For a respawn gate that is not conservative,
 * it is broken: measured on the live home, the loop's gate read "3 asks in flight" against two
 * `lease-expired` rows and one `captured` row from ten days earlier, while `turn dispatch --sweep` reported
 * zero working. Nothing was running on any of them, and the gate could never have opened again.
 *
 * `activeDispatch` is the register `turn dispatch --sweep` itself keys on, and it answers the question this
 * gate is actually asking. `lifecycle.ts`'s `supersedesDispatch` lists `lease-expired` among the kinds that
 * END a dispatch, so a lease-expired ask carries none; a `captured` row that was never dispatched never had
 * one. Meanwhile the five preserving kinds keep a dispatch standing through `dispatch-unwitnessed`, so a
 * worker whose pickup merely went unwitnessed still counts as in flight — which is the half that must not be
 * under-counted.
 *
 * A gate that only opens once a human tidies up stale rows is the same defect wearing a politer hat, so this
 * deliberately does not depend on anyone closing them.
 *
 * @param lifecycles the folded ask lifecycle, keyed as `foldAskLifecycle` returns it
 * @param isIgnored whether one ask is permanently ignored, injected so this stays pure
 * @returns how many asks still hold a live dispatch
 */
export function asksHoldingWorkers({
  lifecycles,
  isIgnored,
}: {
  readonly lifecycles: readonly {
    readonly activeDispatch?: unknown;
    readonly channel: string;
    readonly messageTs: string;
  }[];
  readonly isIgnored: (args: { readonly channel: string; readonly messageTs: string }) => boolean;
}): number {
  return lifecycles.filter(
    (lifecycle) =>
      lifecycle.activeDispatch !== undefined &&
      !isIgnored({ channel: lifecycle.channel, messageTs: lifecycle.messageTs }),
  ).length;
}

/**
 * Why a successor must not be booted into a worktree that ALREADY EXISTS and is behind its base.
 *
 * ## One class, and why the two halves were answered differently
 *
 * The retired recipe-scheduler was the first instance: a respawn retired the live registration,
 * booted a successor, and left its freshness check reading exactly the same `stale` bin — 76 commits behind —
 * because the successor inherited the same tree. A refusal was added; that refusal then fired on
 * every landing wave and prescribed a stop-then-ff sequence that session could not run on ITSELF, so its half
 * was answered at the source instead — a worktree cut fresh per boot, with nothing left for a refusal to
 * catch. That session and its own respawn target are gone; the CLASS is what this
 * paragraph is for.
 *
 * The loop's was the second, found minutes after the first: `session respawn loop` booted its successor into
 * a worktree a previous, refused attempt had already created, still two commits behind.
 * `cmux/plan.ts` reuses a worktree that exists at the target path — deliberately, since `cmux/worktree.ts`'s
 * own header records the collision a create-anyway would cause — and `cmux spawn`'s base-freshness advisory
 * measures the MAIN CHECKOUT rather than that reused tree, saying so in its own `FORK_NOTE`. So nothing in
 * the chain measured the one tree the successor would actually run from.
 *
 * This one stays a refusal rather than taking that fresh-cut answer, because a loop successor's tree is keyed
 * by a DATED DOC SLUG that a human wrote and may already have work in — a fresh cut per boot is not available
 * to it the way it is to a session whose tree is a scratch checkout.
 *
 * A NEW worktree is cut from the freshly-fetched remote and needs none of this. Only a reused one can be
 * stale, which is why this asks about existence first and drift second.
 *
 * Refuse rather than fast-forward: this cannot know whether something is reading that tree, and rewriting one
 * that is, is the hardlinked-`node_modules` trap `../../worktree/deps.ts` measures. The refusal names the two
 * commands instead.
 *
 * @param path the worktree the successor would be booted into
 * @param exists whether that worktree is already registered, rather than about to be cut from the remote
 * @param behind how many commits the base carries that it does not, or `undefined` when unmeasurable
 * @param base the ref it was measured against, for the command the refusal names
 * @returns the refusal sentence, or `undefined` when booting there is safe
 */
export function reusedWorktreeRefusal({
  path,
  exists,
  behind,
  base,
}: {
  readonly path: string;
  readonly exists: boolean;
  readonly behind: number | undefined;
  readonly base: string;
}): string | undefined {
  if (!exists) {
    return undefined;
  }
  if (behind === undefined) {
    return (
      `the successor's worktree ${path} already exists and its drift could NOT be measured, so whether it is ` +
      "current is unknown. Refusing rather than booting a successor onto a guess. Nothing was retired."
    );
  }
  if (behind === 0) {
    return undefined;
  }
  return (
    `the successor's worktree ${path} already exists and is ${String(behind)} commit(s) behind ${base}, so the ` +
    "successor would boot onto exactly the drift this respawn is meant to clear. A worktree cut fresh is " +
    "forked from the remote; a REUSED one is whatever it was left at. Nothing was retired. Fast-forward it " +
    `first, once nothing is reading it: \`git -C ${path} fetch origin && git -C ${path} merge --ff-only ${base}\`.`
  );
}

/** What a respawn check decided. */
export type RespawnVerdict =
  /** Every gate passed: retire and replace. */
  | { readonly kind: "respawn"; readonly why: string }
  /** Nothing is owed — the session is current enough. */
  | { readonly kind: "not-owed"; readonly why: string }
  /** It is owed, but now is the wrong moment. The caller retries at its next natural pause. */
  | { readonly kind: "busy"; readonly why: string }
  /** It is owed and quiet, but respawning would create a second session on one doc. */
  | { readonly kind: "held"; readonly why: string };

/**
 * Why a grade could not be measured — read only when it could not, and each cause names a different next move.
 *
 * Measured: a supervisor dry-ran `session respawn loop --successor <slug>` eleven seconds after the loop's own
 * respawn to that very successor had disarmed the predecessor (`arms.jsonl`: one arm disarmed, the next armed a
 * minute later). The read was right — nothing was
 * armed — but the one sentence every unmeasured grade printed said "Fix the read, then retry", and a fleet
 * finding was registered against a read that had no defect. A loop between arms, a loop that is dark, and an
 * armed pid no tree could be attributed to are three different facts, and only the last is a read to fix.
 */
export type UnmeasuredCause =
  /** A boot of THIS successor is recorded and unconfirmed, and no listener runs: the loop may be between arms. */
  | {
      readonly kind: "respawn-in-flight";
      readonly successor: string;
      readonly bootedAtIso: string;
      readonly predecessorArmId: string | undefined;
    }
  /** No listener runs, and no boot of this successor awaits confirmation: nothing is running to retire. */
  | { readonly kind: "no-listener" }
  /** A listener runs but no tree came out of it, or the liveness read itself failed: a read to fix. */
  | { readonly kind: "unattributed" };

/**
 * Classify why a loop's grade could not be measured — pure.
 *
 * A running listener wins: if something IS listening and no tree came out of it, the read fell short whatever
 * else is recorded, and "between arms" there would hide exactly the defect the old sentence was right about. A
 * liveness read that reported a problem wins too, because `currentLiveness` reads an unreadable arm record as
 * `unarmed` plus a problem, and that is not evidence that nothing is listening. Only a CLEAN read of no running
 * listener lets the pending record speak, and only a record for the successor this invocation names: the record
 * is durable and never cleared when a confirmation fails, so it proves a boot, never a live successor — which
 * is why its boot instant goes into the sentence.
 *
 * @param listenerLive whether the listener reads as running (`healthy` or `degraded`)
 * @param livenessProblems what the liveness read could not read
 * @param pending the pending loop respawn record, or `undefined` when none stands
 * @param successor the successor this invocation names, when it names one
 * @returns the cause the verdict names
 */
export function loopUnmeasuredCause({
  listenerLive,
  livenessProblems,
  pending,
  successor,
}: {
  readonly listenerLive: boolean;
  readonly livenessProblems: readonly string[];
  readonly pending:
    | {
        readonly successor: string;
        readonly bootedAtIso: string;
        readonly predecessorArmId?: string | undefined;
        readonly confirmedArmId?: string | undefined;
      }
    | undefined;
  readonly successor: string | undefined;
}): UnmeasuredCause {
  if (listenerLive || livenessProblems.length > 0) {
    return { kind: "unattributed" };
  }
  if (pending === undefined || pending.confirmedArmId !== undefined || pending.successor !== successor) {
    return { kind: "no-listener" };
  }
  return {
    bootedAtIso: pending.bootedAtIso,
    kind: "respawn-in-flight",
    predecessorArmId: pending.predecessorArmId,
    successor: pending.successor,
  };
}

/**
 * The refusal sentence for a grade that could not be measured, by its cause.
 *
 * A caller that named no cause gets the read-to-fix sentence, which is exactly what it then is: nothing said why.
 *
 * @param session which standing session, for the sentence
 * @param cause why nothing could be measured, or `undefined` when the caller did not say
 * @returns the sentence the verb prints
 */
function unmeasuredWhy({
  session,
  cause,
}: {
  readonly session: string;
  readonly cause: UnmeasuredCause | undefined;
}): string {
  if (cause === undefined) {
    return unmeasuredWhy({ cause: { kind: "unattributed" }, session });
  }
  switch (cause.kind) {
    case "respawn-in-flight": {
      const predecessor =
        cause.predecessorArmId === undefined
          ? "predecessor arm not recorded"
          : `predecessor arm ${cause.predecessorArmId}`;
      return (
        `${session}: a respawn to ${cause.successor} was booted ${cause.bootedAtIso} and remains unconfirmed ` +
        `(${predecessor}) — no listener is running, so the ${session} may be between arms and there is nothing ` +
        "to measure. Run `slopweaver session respawn loop --confirm` once its arm is up. Nothing was retired."
      );
    }
    case "no-listener":
      return (
        `${session}: no listener is running, so there is no running ${session} to retire and nothing to ` +
        "measure. Nothing was retired."
      );
    case "unattributed":
      return (
        `${session}: its freshness could not be measured at all, so whether a respawn is owed is UNKNOWN — ` +
        "refusing rather than respawning on a guess. Fix the read, then retry."
      );
    default: {
      const unreachable: never = cause;
      return unreachable;
    }
  }
}

/** What the caller measured before asking. */
export interface RespawnRequest {
  /** Which standing session — for the sentences. */
  readonly session: string;
  /** Its folded freshness grade, or `undefined` when nothing could be measured. */
  readonly grade: StandingFreshnessGrade | undefined;
  /** Why the grade is `undefined`; `undefined` itself whenever a grade was measured. */
  readonly unmeasured: UnmeasuredCause | undefined;
  /** How much work is in flight right now — asks mid-dispatch, or non-terminal recipe generations. */
  readonly inFlight: number;
  /** What that in-flight work is CALLED, for the refusal sentence. */
  readonly inFlightNoun: string;
  /**
   * The live session already holding the successor's run, if any. Empty means the run is free — the caller
   * establishes this, since "live" is a cmux question and this module is pure.
   */
  readonly heldBy: string | undefined;
  /** Whether the caller passed `--force`, which overrides gate 1 ONLY. */
  readonly force: boolean;
}

/**
 * Decide whether a standing session may respawn itself now.
 *
 * `--force` overrides only the is-it-owed gate. It deliberately does NOT override the quiet-moment or
 * held-run gates: those two protect work in flight and protect the fleet from two listeners on one doc, and
 * neither is a judgement the caller of a respawn is in a position to overrule — an owner who genuinely wants
 * a busy session killed has `cmux close`, which is honest about what it is doing.
 *
 * @param request everything measured before the decision
 * @returns the verdict, carrying the sentence a standing session prints
 */
export function respawnVerdict({ request }: { readonly request: RespawnRequest }): RespawnVerdict {
  const { force, grade, heldBy, inFlight, inFlightNoun, session, unmeasured } = request;
  if (grade === undefined) {
    return { kind: "busy", why: unmeasuredWhy({ cause: unmeasured, session }) };
  }
  if (grade !== "stale" && !force) {
    return {
      kind: "not-owed",
      why: `${session}: ${grade} — no respawn is owed. Pass --force to respawn anyway.`,
    };
  }
  if (inFlight > 0) {
    return {
      kind: "busy",
      why:
        `${session}: a respawn IS owed (${grade}), but ${String(inFlight)} ${inFlightNoun} ` +
        `${inFlight === 1 ? "is" : "are"} still in flight — retry at your next quiet moment. ` +
        "Nothing was retired.",
    };
  }
  if (heldBy !== undefined) {
    return {
      kind: "held",
      why:
        `${session}: a respawn is owed and the moment is quiet, but the successor's run is already held by a ` +
        `LIVE session (${heldBy}). Respawning would put two sessions on one doc, which is how a tag gets ` +
        "load-balanced across two listeners with only one being watched. Nothing was retired.",
    };
  }
  return {
    kind: "respawn",
    why: force
      ? `${session}: --force — retiring and replacing it regardless of its ${grade} grade.`
      : `${session}: STALE and quiet — retiring it and booting its successor on current main.`,
  };
}

/**
 * What a `--confirm` read of the live listener says about a booted-but-unconfirmed loop respawn.
 *
 * @internal
 */
export type SuccessorArmVerdict =
  /** The live arm is the successor's own: a new arm id, up, and running from the successor's tree. */
  | { readonly kind: "confirmed"; readonly armId: string; readonly pid: number; readonly why: string }
  /** Not yet — and exactly what is still missing, so the caller knows whether to wait or to look. */
  | { readonly kind: "not-yet"; readonly why: string };

/**
 * Whether a confirmation ALREADY on record is still evidence of a live respawn — pure.
 *
 * ## Why a stamped confirmation is not enough on its own
 *
 * Probed: `--confirm` answered "already confirmed" and exited 0 on any
 * record carrying `confirmedArmId`, without asking whether that arm still stood. The record is durable and
 * outlives the boot it names, so a successor whose own arm never went live read as respawned off an earlier
 * successor's confirmation — the loop breakages every seat had to verify by hand. A confirmation is
 * evidence only while the arm it names is the arm live NOW and is not down; anything else is a statement about
 * a respawn that is over, and it is refused rather than re-judged, because re-judging a different live arm
 * against an old record could certify a new boot under the old successor's name.
 *
 * That includes a `listen supervise` re-arm: it mints a fresh arm id (`randomUUID().slice(0, 8)` in
 * `cli/commands/listen/superviseTick.ts`), and nothing on the arm record binds a later arm to the boot this record
 * names, so after a re-arm this reads `stale` until the next respawn writes a record of its own.
 *
 * The arm must also still run from the successor's own tree, as a fresh confirmation must: an arm id is eight hex
 * characters, so the id alone is not the successor's identity.
 *
 * @param record the confirmation on record: the successor it names, the arm it confirmed, and when
 * @param liveness what `listen status` reads right now
 * @param trees the checkout the live arm runs from (`undefined` when unreadable) and the successor's own tree
 * @returns `still-live` when the confirmed arm is the one live now, else `stale` with the sentence to print
 */
export function confirmedRecordVerdict({
  record,
  liveness,
  trees,
}: {
  readonly record: { readonly successor: string; readonly confirmedArmId: string; readonly confirmedAt: string };
  readonly liveness: ListenerLiveness;
  readonly trees: { readonly arm: string | undefined; readonly successor: string };
}): { readonly kind: "still-live"; readonly why: string } | { readonly kind: "stale"; readonly why: string } {
  const onRecord = `the confirmation on record (${record.successor} on arm ${record.confirmedArmId}, at ${record.confirmedAt})`;
  const refusal =
    "so it is not evidence of a current respawn, and it is never re-judged against another arm. A respawn is " +
    "confirmed again only by a new boot's own arm. Not respawned.";
  if (liveness.state === "unarmed") {
    return { kind: "stale", why: `${onRecord} is stale: the listener reads unarmed now, ${refusal}` };
  }
  if (liveness.armId !== record.confirmedArmId) {
    return {
      kind: "stale",
      why: `${onRecord} is stale: the live arm is ${liveness.armId} (${liveness.state}), not ${record.confirmedArmId}, ${refusal}`,
    };
  }
  if (isListenerDown({ liveness })) {
    return {
      kind: "stale",
      why: `${onRecord} is stale: that arm is DOWN (${liveness.state}), ${refusal}`,
    };
  }
  if (trees.arm !== trees.successor) {
    let runsFrom = "a checkout that could not be read";
    if (trees.arm !== undefined) {
      runsFrom = trees.arm;
    }
    return {
      kind: "stale",
      why: `${onRecord} is stale: that arm runs from ${runsFrom}, not ${trees.successor}, ${refusal}`,
    };
  }
  return {
    kind: "still-live",
    why: `already confirmed — ${record.successor} was respawned on arm ${record.confirmedArmId} at ${record.confirmedAt}, and that arm is live (${liveness.state}) now`,
  };
}

/**
 * Judge whether the live listener is the SUCCESSOR's own arm — pure.
 *
 * ## Why "a new arm id" is not enough, and why the tree is the test
 *
 * Measured: a respawn booted a session into the right worktree at
 * the right HEAD, every worktree/branch/directory gate read 4/4, and the session in there was not running the
 * loop at all — it had been sent a table row as its pickup. The predecessor's own doc concluded that the only
 * sound signal is a new `armed` row carrying an arm id that is not the predecessor's; this goes one step
 * further, because a new arm id proves a listener, not WHOSE. The arm's pid is resolved to the checkout it
 * runs `src/cli/index.ts` from (`inspect.ts`'s `standingTreeTargets`), and that checkout must be the tree
 * the successor was booted into. A listener armed from any other tree is a listener, but not this respawn's.
 *
 * Every refusal names what is missing rather than saying "no": the predecessor still armed means the caller
 * is waiting on a `listen disarm`; unarmed means the successor has not armed yet (and a tag arriving now is a
 * no-op by design); a down arm is a death, not a confirmation; an unattributable pid is refused rather than
 * assumed.
 *
 * @param pending the record `session respawn loop` wrote at boot
 * @param liveness what `listen status` reads right now
 * @param armTree the checkout the live arm's pid runs from, already resolved to a real path, or `undefined`
 *   when the pid could not be attributed to one
 * @param successorTree the successor's worktree, resolved to a real path the same way as `armTree`
 * @returns the verdict, carrying the sentence the verb prints
 */
export function successorArmVerdict({
  pending,
  liveness,
  armTree,
  successorTree,
}: {
  readonly pending: { readonly predecessorArmId: string | undefined; readonly successor: string };
  readonly liveness: ListenerLiveness;
  readonly armTree: string | undefined;
  readonly successorTree: string;
}): SuccessorArmVerdict {
  if (liveness.state === "unarmed") {
    return {
      kind: "not-yet",
      why:
        `no listener is armed — the successor for ${pending.successor} has not armed yet, and a tag arriving ` +
        "now is a no-op BY DESIGN. Not respawned.",
    };
  }
  if (liveness.armId === pending.predecessorArmId) {
    return {
      kind: "not-yet",
      why:
        `the live arm ${liveness.armId} is still the PREDECESSOR's — the successor cannot arm until that session ` +
        "runs `slopweaver listen disarm` and stops its listener. Not respawned.",
    };
  }
  if (isListenerDown({ liveness })) {
    return {
      kind: "not-yet",
      why: `arm ${liveness.armId} (pid ${String(liveness.pid)}) is not the predecessor's, but it is DOWN (${liveness.state}). Not respawned.`,
    };
  }
  if (armTree === undefined) {
    return {
      kind: "not-yet",
      why:
        `arm ${liveness.armId} (pid ${String(liveness.pid)}) is live but could not be attributed to any checkout, so ` +
        `whether it is the successor's is UNKNOWN. Refusing to confirm on a guess. Not respawned.`,
    };
  }
  if (armTree !== successorTree) {
    return {
      kind: "not-yet",
      why:
        `arm ${liveness.armId} (pid ${String(liveness.pid)}) runs from ${armTree}, not from the successor's tree ` +
        `${successorTree} — that is a listener, but it is not ${pending.successor}'s. Not respawned.`,
    };
  }
  return {
    armId: liveness.armId,
    kind: "confirmed",
    pid: liveness.pid,
    why:
      `arm ${liveness.armId} (pid ${String(liveness.pid)}) is ${liveness.state} from ${successorTree} — the ` +
      `successor ${pending.successor} is running its own listener. Respawned.`,
  };
}
