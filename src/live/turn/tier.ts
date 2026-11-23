/**
 * Executing a routing decision's chosen tier through one host-neutral contract.
 *
 * The visible supervisor already decided WHICH tier a message earns (`RoutingDecision.tier`, from
 * `judgement.ts`); this module is what carries that decision through to a result, whichever tier it named —
 * without ever owning a Slack write or the final composition itself. `TierDeps` is the injected seam: `inline`
 * needs nothing, `read-only-subagent` needs the {@link ReadOnlySubagentAdapter}, `fresh-visible-session` needs
 * a visible-session launcher — the real one wired to `cmux/spawn.ts` by the host-integration handover that
 * follows this one, a plain fake in every test here.
 *
 * ## The lease, and why it is provisional (P3 finding #6, HIGH)
 *
 * A hard per-session turn cap alone is not a fix — it just defers a session that never terminates until a LATER
 * consumer has already frozen around the gap, leaving lifecycle stuck at `dispatched` forever or getting
 * auto-relaunched, duplicating spend. The provisional fix here is an elapsed-lease model: a
 * `fresh-visible-session` request carries a `leaseExpiresAt` (wall-clock; {@link DEFAULT_LEASE_HOURS} is
 * roughly one working session), and {@link executeTier} refuses to dispatch a request whose lease has
 * already expired — returning `lease-expired` rather than spawning a session nobody will ever check on
 * again. Recovery (the ask-lifecycle handover) later re-checks an ALREADY-dispatched entry's own lease the
 * same way, via the same {@link isLeaseExpired} — reused, not reimplemented — and treats a `dispatched` ask
 * past its lease as a candidate for visible-supervisor re-judgement, never an automatic relaunch.
 *
 * **Replace {@link DEFAULT_LEASE_HOURS} the moment the owner gives a real metric; do not treat 2 hours as
 * considered.** Wall-clock is not the eventual answer — token/dollar framing has no existing number either,
 * and wall-clock is at least observable without new instrumentation, which is the whole case for it now.
 */
import type { VisibleSessionHost } from "../../supervisor/session.js";
import type { AskIdentity } from "../ask/identity.js";
import type { RoutingDecision } from "./judgement.js";
import type { ExecutionEvidence, ReadOnlySubagentAdapter, ReadOnlyTask } from "./subagent.js";

/** The three ways a routing decision's work can actually get done. Mirrors `judgement.ts`'s own union. */
export type ExecutionTier = "inline" | "read-only-subagent" | "fresh-visible-session";

/** The `respond` arm of a `RoutingDecision` — the only arm a tier is ever executed for. */
export type RespondDecision = Extract<RoutingDecision, { readonly response: "respond" }>;

/**
 * A fresh visible session's real cmux locator — an ADDRESS to poll later, never a claim about progress.
 *
 * Carries the UUIDs as well as the `workspace:N`/`surface:N` refs, and the UUIDs are the ones anything
 * actually addresses through. Measured: cmux resolves a ref that names nothing by silently
 * falling back to the FOCUSED surface, so a stale ref — and refs go stale, because cmux renumbers them as
 * workspaces close — can address a completely different session while answering `ok`. The refs are kept
 * because they are what a human reads in the sidebar and what every log line here already quotes.
 */
export interface FreshVisibleSessionRef {
  readonly host: VisibleSessionHost;
  readonly workspaceRef: string;
  readonly surfaceRef: string;
  readonly workspaceId: string;
  readonly surfaceId: string;
  /**
   * Where the session was actually booted — the plan's own `cwd`.
   *
   * Recorded because a reader looking for a dispatched session on the machine looks for a directory, and
   * `askSessionPlan` deliberately boots into THE DISPATCHER'S OWN CHECKOUT rather than a per-ask worktree.
   * Measured: two sessions independently concluded a live dispatch did not exist, both by
   * sweeping live `claude` processes for a cwd named after the ask — a directory that by design never
   * exists. Optional because records written before this field was added carry no cwd, and a missing one is
   * a fact about the record's age, not about the session.
   */
  readonly cwd?: string | undefined;
  /**
   * The harness display name this session was registered under — `cmux/planNames.ts`'s `dispatchSessionName`, the
   * value the boot line's `claude --name` carried, and the key its session-ledger entry uses.
   *
   * Recorded because a supervisor addressing a live session addresses it BY NAME (`ListAgents`/`SendMessage`),
   * and until this existed a record offered only a workspace ref — so a worker and the reviewer of its own
   * answer, booted two minutes apart in the same checkout, could only be told apart by START TIME. Measured:
   * a correction meant for a worker most likely landed on the reviewer instead, which is the one
   * session nobody may write a word to. Optional for the same reason {@link cwd} is: a record written before
   * workers were named carries none, and that is a fact about the record's age.
   */
  readonly sessionName?: string | undefined;
}

/** What one tier execution needs to run, by kind. */
export type TierRequest =
  | { readonly kind: "inline"; readonly ask: AskIdentity; readonly decision: RespondDecision }
  | {
      readonly kind: "read-only-subagent";
      readonly ask: AskIdentity;
      readonly task: ReadOnlyTask;
      readonly leaseExpiresAt: string;
    }
  | {
      readonly kind: "fresh-visible-session";
      readonly ask: AskIdentity;
      readonly briefPath: string;
      readonly leaseExpiresAt: string;
    };

/** What one tier execution produced. */
export type TierResult =
  | { readonly kind: "returned"; readonly tier: "inline" | "read-only-subagent"; readonly evidence: ExecutionEvidence }
  | { readonly kind: "dispatched"; readonly tier: "fresh-visible-session"; readonly session: FreshVisibleSessionRef }
  | { readonly kind: "lease-expired"; readonly ask: AskIdentity }
  | { readonly kind: "failed"; readonly tier: ExecutionTier; readonly reason: string };

/** Roughly one working session — provisional. See this module's own header for why, and its replacement. */
export const DEFAULT_LEASE_HOURS = 2;

/**
 * A fresh lease's expiry, from "now".
 *
 * @param nowIso the clock, as an ISO instant
 * @returns the ISO instant `DEFAULT_LEASE_HOURS` after `nowIso`
 */
export function leaseExpiryFromNow({ nowIso }: { nowIso: string }): string {
  return new Date(Date.parse(nowIso) + DEFAULT_LEASE_HOURS * 60 * 60 * 1000).toISOString();
}

/**
 * Whether a lease has already expired as of `nowIso`. Reused by the ask-lifecycle handover's own recovery
 * sweep against an already-`dispatched` entry — one primitive, not reimplemented per caller.
 *
 * Fails CLOSED on an unparseable instant, deliberately: `Date.parse` returns `NaN` for a string that merely
 * LOOKS like ISO 8601 but isn't a form it supports (a decimal comma instead of a period, for one, verified
 * against this exact regression) — and `NaN >= NaN` is `false`, which would read a corrupt or malformed
 * `leaseExpiresAt` as "still active" and dispatch a session with no real bound at all, the exact failure
 * this whole mechanism exists to prevent. Treating anything unparseable as already-expired is the safe
 * direction: it forces a re-judgement rather than silently granting an unbounded lease.
 *
 * @param leaseExpiresAt the lease's own expiry instant
 * @param nowIso the clock, as an ISO instant
 * @returns whether `nowIso` has reached or passed `leaseExpiresAt`, or either could not be parsed at all
 */
export function isLeaseExpired({ leaseExpiresAt, nowIso }: { leaseExpiresAt: string; nowIso: string }): boolean {
  const expiry = Date.parse(leaseExpiresAt);
  const now = Date.parse(nowIso);
  if (Number.isNaN(expiry) || Number.isNaN(now)) {
    return true;
  }
  return now >= expiry;
}

/**
 * The lease a running dispatch is actually judged against — its own, or the one its first answer re-armed,
 * whichever ends LATER.
 *
 * A worker that posts its plan and keeps building (`../ask/lifecycleEvents.ts`'s `FirstAnsweredEvent`) gets
 * one fresh {@link DEFAULT_LEASE_HOURS} from the post, stored on the first-answer event rather than written
 * over the dispatch, because the dispatch's own `leaseExpiresAt` is the generation token. The LATER of the two
 * wins so a plan posted by an earlier generation can never shorten a re-dispatch's own fresh lease. Every
 * CLOCK reader goes through this; every GENERATION binding keeps reading the dispatch's own field.
 *
 * An unparseable first-answer lease is ignored rather than trusted, which keeps {@link isLeaseExpired}'s
 * fail-closed posture: the dispatch's own lease still bounds the turn.
 *
 * @param activeDispatch the dispatch still holding the ask
 * @param firstAnswer the first answer that dispatch already posted, when one stands
 * @returns the ISO instant the turn's lease runs out
 */
export function effectiveLeaseExpiresAt({
  activeDispatch,
  firstAnswer,
}: {
  activeDispatch: { readonly leaseExpiresAt: string };
  firstAnswer?: { readonly leaseExpiresAt: string } | undefined;
}): string {
  if (firstAnswer === undefined) {
    return activeDispatch.leaseExpiresAt;
  }
  const rearmed = Date.parse(firstAnswer.leaseExpiresAt);
  const own = Date.parse(activeDispatch.leaseExpiresAt);
  if (Number.isNaN(rearmed) || Number.isNaN(own) || rearmed <= own) {
    return activeDispatch.leaseExpiresAt;
  }
  return firstAnswer.leaseExpiresAt;
}

/** The outcome of attempting to open a fresh visible session — the one real effect this module injects. */
export type VisibleSessionLaunchOutcome = { readonly session: FreshVisibleSessionRef } | { readonly reason: string };

/** The effects `executeTier` needs, injected so every tier is testable against a plain fake. */
export interface TierDeps {
  /** The `read-only-subagent` tier's own seam — see `subagent.ts`'s header for why this has no real default. */
  readonly subagent: ReadOnlySubagentAdapter;
  /** Open a fresh visible session for the given ask and brief. The real one is wired by host-integration. */
  readonly launchVisibleSession: (args: {
    ask: AskIdentity;
    briefPath: string;
  }) => Promise<VisibleSessionLaunchOutcome>;
  readonly nowIso: () => string;
}

/** The `inline` arm's own trivial evidence — nothing was investigated, so there is nothing to observe but why. */
function inlineEvidence({ decision }: { decision: RespondDecision }): ExecutionEvidence {
  return { observations: [{ author: "system", source: "routing-decision", text: decision.rationale }] };
}

/**
 * Execute one tier request, whichever kind it names, through one host-neutral contract.
 *
 * @param request the tier request to execute
 * @param deps the injected effects — a plain fake in every test, the real wiring in host-integration
 * @returns the result — evidence, a dispatched session, a lease already expired, or a stated failure
 */
export async function executeTier({ request, deps }: { request: TierRequest; deps: TierDeps }): Promise<TierResult> {
  if (request.kind === "inline") {
    return { evidence: inlineEvidence({ decision: request.decision }), kind: "returned", tier: "inline" };
  }
  if (request.kind === "read-only-subagent") {
    if (isLeaseExpired({ leaseExpiresAt: request.leaseExpiresAt, nowIso: deps.nowIso() })) {
      return { ask: request.ask, kind: "lease-expired" };
    }
    const outcome = await deps.subagent(request.task);
    if (outcome.kind === "failed") {
      return { kind: "failed", reason: outcome.reason, tier: "read-only-subagent" };
    }
    return { evidence: outcome.evidence, kind: "returned", tier: "read-only-subagent" };
  }
  if (isLeaseExpired({ leaseExpiresAt: request.leaseExpiresAt, nowIso: deps.nowIso() })) {
    return { ask: request.ask, kind: "lease-expired" };
  }
  const outcome = await deps.launchVisibleSession({ ask: request.ask, briefPath: request.briefPath });
  if ("reason" in outcome) {
    return { kind: "failed", reason: outcome.reason, tier: "fresh-visible-session" };
  }
  return { kind: "dispatched", session: outcome.session, tier: "fresh-visible-session" };
}
