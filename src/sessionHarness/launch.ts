/**
 * The session harness's launch half: `open` a session for a run, or `resume` one for a run already under way.
 *
 * Its own interface rather than two more members of {@link ./sessionHarness.SessionHarness}, because launching needs
 * effects the other operations never do — a worktree, the credential gate, a boot witness — so a verb that only
 * messages or closes a session holds a harness that cannot launch one, and the compiler says so. An implementation
 * offers both (`./cmuxLaunch.ts` is cmux's).
 *
 * `open` and `resume` both open a visible session in the run's directory and send it one initial message, and the
 * ledger row records which one opened it (`./recordingHarness.ts`). A cmux `resume` opens a fresh session that picks
 * the run back up from its journal. An app `resume` whose run still holds an open app row continues THAT session's
 * own vendor transcript in a new card (`./appLaunch.ts`), and the ledger records it `resumed` on the same row.
 *
 * The delivery and boot evidence reuse the spawn path's own witness vocabulary (`witnessed`, `resubmitted`,
 * `unwitnessed`, and which source saw it): those name what was observed, not where.
 */
import type { Result } from "#lib/result.js";
import type { LaunchTemplate } from "../cmux/launchTemplate.js";
import type { SessionRole } from "../cmux/role.js";
import type { PickupDelivery } from "../cmux/spawn.js";
import type { Witness } from "../cmux/witness.js";
import type { VisibleSessionHost } from "../supervisor/session.js";
import type { HarnessLaunchOperation, SessionLaunchFailedError } from "./errors.js";

/** Everything decided about one session before it is launched, in the session's vocabulary rather than a host's. */
export interface HarnessLaunchSpec {
  /** The ledger's label for the session: the handover slug, or a dispatch's coordinates. */
  readonly ledgerKey: string;
  /** The handover slug it is for, when it is for one. */
  readonly slug?: string;
  /** Which model CLI the session runs. */
  readonly host: VisibleSessionHost;
  /** The main checkout a new directory would be created from. */
  readonly repoRoot: string;
  /** The branch the session's directory holds, or will hold. */
  readonly branch: string;
  /** The branch a brand-new {@link branch} forks from, or `undefined` for trunk. */
  readonly baseBranch: string | undefined;
  /** The directory the session runs in. */
  readonly directory: string;
  /** Whether {@link directory} already exists as a worktree. */
  readonly directoryExists: boolean;
  /** The raw id the host keeps the session under. */
  readonly launchKey: string;
  /** The short human title a list shows. */
  readonly title: string;
  /** The name the session registers itself under, or `undefined` to let it derive one from its directory. */
  readonly registeredName: string | undefined;
  /** When the launch was decided, ISO 8601. */
  readonly openedAtIso: string;
  /** Who the session is answering, as a display handle, when there is one person. */
  readonly respondingToHandle: string | undefined;
  /** The one message sent once the session is up. */
  readonly initialMessage: string;
  /** The credential store a pinned seat boots against. */
  readonly credentialStoreDir?: string;
  /** The setup token file a routed seat opens. */
  readonly credentialTokenPath?: string;
  /** The `$CODEX_HOME` a routed Codex seat boots against. */
  readonly codexHome?: string;
  /** The model the session boots on, or `undefined` to inherit the saved default. */
  readonly model: string | undefined;
  /** How hard it thinks, when pinned. */
  readonly effort?: string;
  /** What the session loads at launch. */
  readonly template: LaunchTemplate;
  /** What kind of session it is. */
  readonly role?: SessionRole | undefined;
}

/** A session a launch opened, booted and sent its initial message to. */
export interface HarnessOpenedSession {
  /** The stable id every later act on the session addresses. */
  readonly sessionId: string;
  /** The caller-facing name, which a host restart may renumber. */
  readonly handle: string;
  /** The endpoint inside the session the message went to, by id. */
  readonly endpointId: string;
  /** That endpoint's caller-facing name. */
  readonly endpointHandle: string;
  /** The exact initial message sent, resolved immediately before the send. */
  readonly initialMessage: string;
  /** How the initial message's arrival was witnessed. */
  readonly delivery: PickupDelivery;
  /** Which witness saw the session come up. */
  readonly bootEvidence: Witness;
  /**
   * The launch continued the session its open ledger row already records, under that row's id and on its own vendor
   * transcript, so the ledger records it `resumed` on that row rather than a new `spawned` one. Absent for a new one.
   */
  readonly resumed?: true;
}

/**
 * Whether a failed launch left a session open that a caller must neither close nor relaunch beside: the initial
 * message went into a live session, and only a reader of that session can say what became of it.
 *
 * @param failure the launch's failure
 * @returns true for a stranded or unproven initial message
 */
export function launchLeftSessionOpen({ failure }: { failure: SessionLaunchFailedError }): boolean {
  return failure.initialMessageStranded === true || failure.initialMessageUnproven === true;
}

/**
 * An initial message resolved immediately before the send, and the act it was resolved FOR. The act travels with
 * the text because both come from one read of the state: a run journal that moved during the boot turns an `open`
 * into a `resume` line, and the ledger row records the act the session was actually told to perform, never the one
 * the caller guessed before the boot.
 */
export interface ResolvedInitialMessage {
  readonly text: string;
  readonly operation: HarnessLaunchOperation;
}

/** Re-resolve the initial message immediately before it is sent, when it depends on state the boot may have moved. */
export type InitialMessageResolver = () => Result<ResolvedInitialMessage, string>;

/** The two launch acts, both answering the same shape. */
export interface SessionLauncher {
  /**
   * Open a run's first session.
   *
   * @param options the spec, and the resolver for a state-dependent initial message
   * @returns the opened session, or why the launch failed and what it left
   */
  readonly open: (options: {
    spec: HarnessLaunchSpec;
    resolveInitialMessage?: InitialMessageResolver;
  }) => Promise<Result<HarnessOpenedSession, SessionLaunchFailedError>>;
  /**
   * Open a fresh session for a run already under way — after a park, or for a run whose seat was lost.
   *
   * @param options the spec, and the resolver for a state-dependent initial message
   * @returns the opened session, or why the launch failed and what it left
   */
  readonly resume: (options: {
    spec: HarnessLaunchSpec;
    resolveInitialMessage?: InitialMessageResolver;
  }) => Promise<Result<HarnessOpenedSession, SessionLaunchFailedError>>;
}
