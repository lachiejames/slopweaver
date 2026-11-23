/**
 * The session harness: the box one session runs in, as the verbs see it.
 *
 * The name is "session harness": a harness per session plus a control plane in the desktop app. This contract is stage 1's seam: every verb reaches a session through it, and cmux is its
 * first implementation (`./cmuxHarness.ts`), so nothing changes for the fleet yet. A vendor's own interface
 * (Claude's Agent SDK, Codex's app-server) becomes a second implementation behind the same contract.
 *
 * The vocabulary is deliberately the session's, never the host's: no workspace, surface, pane or screen.
 * `docs/session-harness.md` carries the dependency direction and what this slice leaves to later rows.
 */
import type { Result } from "#lib/result.js";
import type { SessionHarnessError } from "./errors.js";

/**
 * How a message reaches a session that may be mid-turn — the sender's choice, the same three outcomes on
 * either vendor (the briefing's "interrupt or queue" section):
 *
 * - `now` interrupts the running turn, then delivers.
 * - `turn` lands once the current tools finish — Claude's SDK default priority, Codex's steer.
 * - `later` waits for the turn to end before it is delivered at all.
 *
 * An implementation that cannot honour one REFUSES it (`DELIVERY_UNSUPPORTED`) rather than degrading it.
 */
export type SessionDelivery = "now" | "turn" | "later";

/** One session the harness can reach, as a list or a resolve reports it. */
export interface HarnessSession {
  /** The stable identifier every write addresses. */
  readonly id: string;
  /** The caller-facing name, which may be renumbered across a restart — resolve it before writing. */
  readonly handle: string;
  /** The group the session is listed under (cmux's window). */
  readonly groupId: string;
  /** The session's working directory. */
  readonly directory: string;
  readonly description: string | undefined;
  readonly title: string | undefined;
  /** The last text the harness itself accepted for this session, possibly truncated by the implementation. */
  readonly latestSubmittedMessage: string | undefined;
  readonly latestSubmittedAtIso: string | undefined;
  readonly latestConversationMessage: string | undefined;
  /** Whether the session is the pinned one — the supervisor, when its title says so too. */
  readonly pinned: boolean;
  /** Whether the session is the one currently in front of the owner. */
  readonly selected: boolean;
}

/** A resolved session, plus the one endpoint inside it a caller chose, when it chose one. */
export interface HarnessTarget {
  readonly session: HarnessSession;
  readonly endpointId?: string;
}

/**
 * What a message's delivery was observed to do: accepted (`submitted`), held behind a running turn
 * (`queued`), unobservable (`unknown`), left unsent in the input (`stranded`), or sent only after one rescue
 * (`resubmitted`).
 *
 * @internal
 */
export type HarnessMessageDisposition = "submitted" | "queued" | "unknown" | "stranded" | "resubmitted";

/** What one message did, beyond the harness having accepted the call. */
export interface HarnessMessageOutcome {
  readonly disposition: HarnessMessageDisposition;
  /** Whether a running turn was found and interrupted before delivery. */
  readonly interrupted: boolean;
  /**
   * One line saying what the session's input held when the harness last looked, when it looked — the line a
   * caller prints on a `stranded` disposition, which deliberately does not carry the text itself.
   */
  readonly inputDetail?: string;
}

/** Why a close was held rather than forced: the session was busy, had a queued message, or could not be proven idle. */
export type HarnessCloseHold = "busy" | "queued" | "unreadable" | "unproven";

/**
 * How a close ended when the harness did not fail it.
 *
 * @internal
 */
export type HarnessCloseOutcome =
  { readonly kind: "closed"; readonly forced: boolean } | { readonly kind: "held"; readonly reason: HarnessCloseHold };

/**
 * How a park may close the session: `force` only for one whose close the caller has already settled (its own
 * seat, or one a hatch let through), `bounded` forcing past the host's confirmation only on a proven-idle prompt —
 * the same two words `../handover/parkPolicy.ts`'s `parkCloseMode` decides between.
 */
export type HarnessParkMode = "force" | "bounded";

/**
 * How a park ended when the harness did not fail it: parked (and whether it took force), or held open with why.
 * Both carry the session as the harness re-resolved it, so a caller reports the handle the session has NOW — a cmux
 * restart between picking the seat and parking it renumbers the ref and keeps the id.
 *
 * @internal
 */
export type HarnessParkOutcome =
  | { readonly kind: "parked"; readonly forced: boolean; readonly session: HarnessSession }
  | { readonly kind: "held"; readonly reason: HarnessCloseHold; readonly session: HarnessSession };

/** The seam every verb reaches a session through. */
export interface SessionHarness {
  /**
   * Park a session: close it at rest so a later `resume` reopens its work. Distinct from {@link close} because a
   * park is a control-plane act the ledger records, and because its caller may already have settled the force.
   *
   * @param options the resolved target and how the close may be forced
   * @returns parked (with the session as closed), held with why, or the typed failure
   */
  readonly park: (options: {
    target: HarnessTarget;
    mode: HarnessParkMode;
  }) => Promise<Result<HarnessParkOutcome, SessionHarnessError>>;
  /**
   * Every session the harness can reach, in the implementation's own order.
   *
   * @returns the sessions, or the typed failure
   */
  readonly list: () => Promise<Result<readonly HarnessSession[], SessionHarnessError>>;
  /**
   * Turn a handle (or an id) into the session it names TODAY, refusing loudly when it names none.
   *
   * @param options the handle, and the endpoint inside the session when the caller chose one
   * @returns the target to write to, or `SESSION_NOT_FOUND` / the typed failure
   */
  readonly resolve: (options: {
    handle: string;
    endpointId?: string;
  }) => Promise<Result<HarnessTarget, SessionHarnessError>>;
  /**
   * Deliver one message to a session, the way the sender chose.
   *
   * @param options the resolved target, the text, and the delivery
   * @returns what the delivery was observed to do, or the typed failure
   */
  readonly message: (options: {
    target: HarnessTarget;
    text: string;
    delivery: SessionDelivery;
  }) => Promise<Result<HarnessMessageOutcome, SessionHarnessError>>;
  /**
   * Interrupt whatever turn the session is running, without waiting for it to take effect.
   *
   * @param options the resolved target
   * @returns nothing on success, or the typed failure
   */
  readonly interrupt: (options: { target: HarnessTarget }) => Promise<Result<void, SessionHarnessError>>;
  /**
   * Close a session, holding it open rather than killing work the harness cannot prove finished.
   *
   * @param options the resolved target
   * @returns closed (and whether it took force), held with why, or the typed failure
   */
  readonly close: (options: { target: HarnessTarget }) => Promise<Result<HarnessCloseOutcome, SessionHarnessError>>;
  /**
   * Press the session's own Stop control, the way its owner would, and wait for the stop that press started. Only a
   * harness that draws a control per session has one; any other refuses rather than closing by another path.
   *
   * @param options the resolved target
   * @returns nothing once the stop finished, or the typed failure
   */
  readonly pressStop: (options: { target: HarnessTarget }) => Promise<Result<void, SessionHarnessError>>;
}
