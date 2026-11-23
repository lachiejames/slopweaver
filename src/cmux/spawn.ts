/**
 * Executing a {@link VisibleSessionPlan}: create the worktree if none exists, open the workspace, boot the host
 * with the DEV plugin checkout explicitly named, then WAIT AND VERIFY before sending anything else — and
 * verify AGAIN after the pickup command itself is sent.
 *
 * Measured live: a spawn reported success (`ok: true`) while the pickup command never
 * landed at all — the boot poll saw the welcome banner render and treated that as "booted", but Claude's own
 * stdin was not yet ready to accept a paste at that exact instant, so the paste was silently dropped. Reading
 * the screen back BEFORE sending is not the same claim as the text having actually arrived, so this module
 * reads it back AFTER sending too — a spawn either confirms the pickup command landed, or reports `ok: false`
 * honestly. Neither verify step is skippable by construction.
 *
 * ## What changed when the client moved onto the socket
 *
 * Both verifications used to have exactly ONE witness: a screen read. That witness produced a false positive
 * once and false NEGATIVES twice (`recipe-scheduler-per-recipe-concurrency` Finding 2 — under
 * concurrent load every tick threw `Failed to read terminal text`, so a genuinely-live dispatch was reported
 * failed). Both verifications now ask cmux's own event stream and its own delivery record FIRST and the
 * rendering LAST — see `witness.ts` for the ordering and why it is not cosmetic. The screen read is retained
 * as the last fallback rather than retired outright, because it is the only witness that still answers when
 * the event stream is unreachable.
 *
 * ## Why the pickup is WAITED FOR, TYPED ONCE, and never typed again
 *
 * Better witnesses answered "did it land?" and left "make it land" unsolved. Boot is witnessed by
 * `agent.hook.SessionStart`, which proves the process started — measured across ten real spawns,
 * the session's first `UserPromptSubmit` follows 4.4-7.7 s LATER, so the pickup line was being sent into a
 * host seconds away from having a prompt. That is what `waitForReadyPrompt` in {@link ./pickupDelivery.js}
 * closes, bounded and never a refusal.
 *
 * The answer to a FAILED WITNESS is not a second send. That was tried, and measured it is the
 * damage rather than the fix: both sends land, neither is witnessed, and the duplicate fires when the child's
 * first turn ends — see {@link ./pickupWitnessWindow.sendPickupOnceThenWitness} for the two live
 * incidents and the asymmetry that settles it.
 *
 * ## Why the composer is nevertheless SUBMITTED again, and why that is not a second send
 *
 * "Never send it twice" left one state with no remedy at all, and that state once cost two
 * consecutive acme-admin spawns and a reviewer that sat fourteen minutes: the line is TYPED INTO THE COMPOSER
 * AND NEVER SUBMITTED. `sendLine` pastes and then presses Enter; when the Enter does not take, the text
 * survives in the input and the submit does not, so cmux reports no `latest_submitted_message`, no
 * `UserPromptSubmit` hook fires, and every witness here correctly answers "no" — about a session that is
 * holding the whole instruction and waiting for one keystroke.
 *
 * `./pickupWitnessWindow.ts`'s `resubmitPickupThenWitness` sends that keystroke and nothing else. Its header carries the live
 * measurement of both halves: a bare Enter submits a stranded composer, and a bare Enter on a busy session
 * whose composer is empty does nothing at all. That is what makes it safe to fire unconditionally — the
 * double-send failure it must not reproduce is a line that already landed, and for that line this step is a no-op.
 *
 * ## Why no spawn returns with its pickup still in the box
 *
 * None of the chain's witnesses reads the composer itself, so a spawn could return `ok` — witnessed or merely
 * unwitnessed — with the line still TYPED there: measured: three seats sat seventy minutes that way.
 * {@link ./pickupComposerConfirm.confirmPickupLeftComposer} reads the box on the styled grid before a spawn
 * returns, presses Enter while it still holds the line — a later Enter takes on a booting seat where an earlier
 * one did not — and REFUSES naming the workspace when the line is still there once `MAX_PICKUP_ENTERS` are spent.
 *
 * ## Why the box is read from the first tick, and why an empty one is not a success
 *
 * MEASURED under cmux 0.65.2: `sendLine`'s own Enter left the box `typed` on 4 seats of 4, and a
 * bare Enter 2.2 s later took every time; eight seats idled that day while `cmux spawn` exited 0. So
 * `./pickupWitnessWindow.ts`'s `pollForPickupWitness` reads the composer on every tick the chain answers nothing and presses on a box
 * positively seen holding the line, one shared `MAX_PICKUP_ENTERS` with the gate. And a delivery nothing saw
 * submitted, over a box READ empty, is refused `pickupSubmissionUnproven` naming the workspace — the seat may be
 * idle with no pickup, and only its screen can say; an unreadable box stays the honest `unwitnessed` success.
 *
 * Delivery therefore ends in one of SIX states: witnessed, `resubmitted` (a later Enter, then witnessed — by
 * a chain source, or by the box emptying), `unwitnessed` (sent, nothing saw it, and the box could not be read
 * — see {@link PickupDelivery}), a send the client itself refused, a pickup still typed in the composer after
 * its Enter budget, or one nothing saw submitted over a box read empty.
 *
 * ## Why a claude boot is judged on its composer, and a failed one is closed and booted once more
 *
 * MEASURED: two spawns under load 37 timed out on "no positive signal" and left their
 * tabs standing at blank Claude prompts no ledger row named, and nothing ever counted them. A `claude` boot is now
 * a success only on Claude's composer read off the styled grid — or, when every grid read failed, on the boot
 * witness alone, the loaded-surface case (`./claudeBootComposer.ts`). A boot that READ and showed no composer,
 * or printed `No conversation found with session ID`, is FAILED: its tab is closed and the boot runs ONCE more in
 * a fresh tab, never into the shell left behind, and a second failure closes that tab too and says both. A failed tab
 * that will not close is refused with its refs, and no second tab is opened beside it.
 *
 * ## Why a spawn writes the sidebar at all
 *
 * A workspace's sidebar row otherwise shows the truncated first line of its latest message until the session
 * says something about itself — measured across the whole fleet, every row read as
 * `<task-notification> <task-id>bt71utmoq…` or a `Read /Users/…/handovers/…` echo. The spawner already knows
 * the doc and the workspace, so it publishes the row's identity itself — a title over a bare row, the role
 * colour and the `workspace:N` ref pill — see {@link publishOpeningSidebar}. It publishes no checklist and no
 * status lane, and neither does the session: the owner reads a seat's state off Queue cards and floating notes,
 * never the sidebar.
 *
 * ## A control-socket write can EPIPE, and used to strand the spawn where it failed
 *
 * Four times in one night, `deps.client`'s underlying connection hit `cmux control socket
 * unavailable at ~/.local/state/cmux/cmux-501.sock: write EPIPE` mid-spawn — cmux itself was healthy every
 * time (`list` answered immediately), and a fresh CLI invocation succeeded on the very next attempt, so the
 * failure is a transient write, not a dead daemon. Every write this module makes through `deps.client` can hit
 * it — {@link bootCmuxWorkspace}'s `createWorkspace` (leaving a worktree with no workspace at all) and its
 * boot `sendLine` (leaving a workspace with no booted host), and {@link deliverPickupCommand}'s pickup
 * `sendLine` (leaving a booted host with no pickup command — the state a sweep once had to hand-deliver one
 * into). `cmux/socket.ts`'s `openCmuxSocket` marks itself PERMANENTLY dead once this happens — every
 * subsequent call on that same connection replays the same cached failure — which is exactly why "an
 * immediate retry succeeded every time" meant a fresh connection, not a second try on the broken one.
 *
 * `cmux/client.ts`'s `realCmuxClient` now wraps every call in `socket.ts`'s `withSocketRetry`: a
 * `SOCKET_UNAVAILABLE` failure closes the dead connection, waits a short backoff, and opens a fresh one,
 * bounded and retried before this module ever sees an error — so a single transient EPIPE no longer strands a
 * spawn at whichever write happened to hit it. This module's own job when a failure still reaches it (the
 * retry budget spent, or a different failure entirely) is to say so honestly: {@link refused} and the
 * empty-ref return in {@link bootCmuxWorkspace} report a `SpawnFailure` naming exactly what exists — a bare
 * worktree, or a workspace with no boot, or a booted host with no pickup — and `cli/commands/cmux/run.ts`'s
 * `reportSpawnFailure` turns that into "the worktree is kept, retry this exact command" rather than the
 * empty-placeholder read-screen hint it used to print when nothing had opened at all.
 *
 * A create that TIMES OUT is the exception to "nothing opened": cmux may finish it after the socket gave up,
 * which has left two empty Terminals. `./workspaceCreateRecovery.ts` adopts the one it made, and a
 * failure after that still names the workspace ref when one was found.
 *
 * This is deliberately NOT a second pickup-send retry layered on top of
 * {@link ./pickupWitnessWindow.sendPickupOnceThenWitness} — see that function's own header for why resending
 * on an UNWITNESSED delivery is the damage, not the fix
 * (measured: two duplicate pickups). The two are different failures: `sendLine` returning `err`
 * here means the write is CONFIRMED never to have reached cmux (which `withSocketRetry` already retried), so
 * there is nothing ambiguous left to protect against by resending again.
 */
import type { ClaudeAmbientCredential } from "../claude/ambientCredential.js";
import type { CodexQuotaKind } from "../codex/quotaTypes.js";
import { err, ok, type Result } from "../lib/result.js";
import { bootLine, type PluginDirResolver } from "./bootLine.js";
import type { CmuxClient } from "./client.js";
import { type ClaudeBootDecision, failedBootClause } from "./composerProbe.js";
import type { CmuxEvent } from "./events.js";
import { publishOpeningSidebar } from "./openingSidebar.js";
import { deliverPickupCommand } from "./pickupDelivery.js";
import type { VisibleSessionPlan } from "./plan.js";
import type { CmuxCli } from "./sidebar.js";
import { bootEventWitness, pollForBootWitness, readScreenOrUndefined } from "./spawnPolling.js";
import { ttyLineOverflow } from "./ttyLineLimit.js";
import type { Witness } from "./witness.js";
import { createOrAdoptWorkspace, type HoldWorkspaceCreate } from "./workspaceCreateRecovery.js";
import { composeWorkspaceDescription } from "./workspaceDescription.js";

/**
 * How the pickup line's delivery ended — the distinction that replaced "delivered, or failed".
 *
 * `unwitnessed` is the third answer this seam had no way to give, and giving it is the whole point: the line
 * WAS accepted by `sendLine`, so it is in the surface's input, and every witness simply failed to see it
 * inside `MAX_SEND_VERIFY_POLLS` (`./pickupWitnessWindow.ts`). That is not the same claim as "it never arrived", and a caller that
 * collapses the two either re-sends a line that already landed or reports a live worker dead.
 *
 * A send that `sendLine` itself REFUSED is not this — it stays the error arm, because nothing landed.
 *
 * It is said only of a box that could not be READ: an unwitnessed delivery over a box read
 * empty is refused `pickupSubmissionUnproven` instead (see this module's header).
 *
 * `resubmitted` is the fourth answer and the one this module's re-submit exists to be able to give: the line
 * was typed once, a bare Enter after `sendLine`'s — early on a box read typed, or blind after a window that
 * could not read it — SUBMITTED it, never re-typed, and a witness then confirmed it. The same answer, witnessed `by: "composer"`,
 * is what a spawn reports when the box was still holding the line — whatever the chain said — and one of
 * {@link ./pickupComposerConfirm.confirmPickupLeftComposer}'s own Enters emptied it. It is a success, and every
 * caller that branches on `kind === "unwitnessed"` treats it as one without having to learn about it.
 */
export type PickupDelivery =
  | { readonly kind: "witnessed"; readonly witness: Witness }
  | { readonly kind: "resubmitted"; readonly witness: Witness }
  | { readonly kind: "unwitnessed" };

/** The effects a spawn performs, injected so the ORDER they happen in is testable against a fake. */
export interface SpawnDeps {
  readonly client: CmuxClient;
  /** Create the worktree {@link VisibleSessionPlan.cwd} describes. Only called when `plan.worktreeExists` is false. */
  readonly ensureWorktree: (args: { plan: VisibleSessionPlan }) => void;
  /**
   * One pacing tick — shared by the boot-poll loop AND the gap {@link ./client.js}'s `sendLine` needs
   * between a paste and its follow-up Enter. Both are "give cmux a moment"; splitting them into two knobs
   * would only invite the two to drift. Real production code sleeps; a test resolves immediately.
   */
  readonly wait: () => Promise<void>;
  /**
   * Which checkout this session's `claude --plugin-dir` should name, or `undefined` to let it load the
   * marketplace install — decided per PLAN rather than once per deps, because the scheduler tick builds its
   * deps before it knows which slot it is about to open, and a constant chosen there was the shape that
   * pointed a session at the spawner's own tree. `./pluginDir.ts` carries the ruling and the measurement.
   */
  readonly resolvePluginDir: PluginDirResolver;
  /**
   * Every cmux event seen since these deps were created. The FIRST witness both verifications consult — see
   * this module's header. A caller with no subscription open returns an empty list and the chain simply falls
   * through to the next source, so the witness is additive and never load-bearing on its own.
   */
  readonly observedEvents: () => readonly CmuxEvent[];
  /**
   * The seam {@link publishOpeningSidebar} writes through — the `cmux` binary in production, because the
   * sidebar family has no socket method at all (`sidebar.ts`'s own header carries the measurement), and a
   * recorder in a test.
   */
  readonly sidebarCli: CmuxCli;
  /**
   * The pre-spawn credential gate, applied before ANY worktree or workspace effect: it reads the live gauge
   * of the account this plan would boot on, fills in {@link VisibleSessionPlan.credentialStoreDir} when
   * nothing pinned one, and refuses when the session would boot into a wall.
   *
   * REQUIRED rather than optional, and a member of the deps rather than a call each verb makes, because
   * forgetting it is the exact defect this seam closes — routing lived inside `cmux spawn` and four other
   * spawn paths silently skipped it (`claude/spawnStore.ts` carries the measurement). A new spawn path
   * cannot now be written without answering this question.
   *
   * Real production code probes; a test returns the plan unchanged. `ambient` is the credential the session will
   * really present when its launcher, not this shell, decides its environment (the app harness's scrubbed worker,
   * `../sessionHarness/appCredentialContext.ts`); absent, the gate reads this process's own.
   */
  readonly gateCredentialStore: (args: {
    readonly plan: VisibleSessionPlan;
    readonly ambient?: ClaudeAmbientCredential;
  }) => Promise<Result<VisibleSessionPlan, string>>;
  /**
   * The browser door on a Codex seat (`codex/browserDoor.ts`), applied once the worktree exists and before
   * any workspace: the seat's own directory is part of what Codex loads, so it cannot be read earlier. `err`
   * carries the refusal to print (a fresh worktree is left standing, like any later boot failure), and a
   * Claude plan always passes. REQUIRED for the credential gate's reason — a spawn path cannot skip it.
   *
   * Real production code probes the seat's Codex home from its worktree; a test passes a plain function.
   */
  readonly gateCodexBrowserSurface: (args: { readonly plan: VisibleSessionPlan }) => Result<void, string>;
  /**
   * Serialises every create under one directory and description, so a lost create's reconciliation never adopts a
   * concurrent spawn's workspace (`./workspaceCreateRecovery.ts`). REQUIRED, never defaulted: a spawn path without it
   * would be exactly the unserialised create the reconciliation cannot tell apart.
   */
  readonly holdWorkspaceCreate: HoldWorkspaceCreate;
  /**
   * The read that decides a `claude` boot once the boot witness has answered or run out: Claude's composer on the
   * surface, or the reason there is none (`./claudeBootComposer.ts`). REQUIRED for the credential gate's reason — a
   * spawn path that skips it reports a blank tab booted, the empty-seat case.
   *
   * Real production code reads the styled grid; a test passes a plain function.
   */
  readonly witnessClaudeBoot: (args: {
    readonly workspace: SpawnWorkspace;
    readonly bootWitnessed: boolean;
    readonly before: string | undefined;
  }) => Promise<ClaudeBootDecision>;
  /** Release the socket connection and any event subscription these deps hold. */
  readonly close: () => void;
}

/** One opened workspace, before any pickup command is delivered. */
type OpenedWorkspace = {
  readonly workspaceRef: string;
  readonly workspaceId: string;
  readonly surfaceRef: string;
  readonly surfaceId: string;
  /** How boot was confirmed, so a caller can report which witness answered rather than only that one did. */
  readonly bootWitness: Witness;
};

/**
 * Why a spawn could not finish, with no workspace identity attached — what {@link deliverPickupCommand}
 * knows on its own, before a caller pairs it with the refs it was already holding.
 */
export type SpawnFailureDetail = {
  readonly reason: string;
  /**
   * Set only when the failure was a Codex usage-exhaustion banner caught on the freshly-booted surface —
   * distinct from every other failure reason, so a caller can close the dead workspace and record the
   * exhaustion (`codex/quotaCache.ts`) instead of treating this like an ordinary boot/delivery fault.
   */
  readonly quotaKind?: CodexQuotaKind;
  /**
   * Set only when the pickup line is still TYPED in the composer after its Enter budget
   * (`./pickupComposerConfirm.ts`) — the line WAS sent and the seat is open, so a caller must leave the
   * workspace standing for `cmux submit` rather than close it as a send that never left.
   */
  readonly strandedInComposer?: true;
  /**
   * Set only when the pickup was sent, NOTHING saw it submitted across both witness windows, and the composer
   * was positively read NOT holding it — the seat may be idle at an empty prompt, or a queued pickup no witness
   * sees may be about to run (`sendPickupOnceThenWitness`'s measurement). Either way the seat is open
   * and holds whatever happened, so a caller leaves it standing and never sends the line again on its own.
   */
  readonly pickupSubmissionUnproven?: true;
};

/**
 * Whether a failed delivery left a seat open that a caller must not close or reseat: the line was sent into a
 * live session, and only a reader of that screen can say what became of it.
 *
 * @param failure the delivery's failure detail
 * @returns true for a pickup stranded in the composer, or one whose submission nothing could prove
 */
export function spawnFailureKeepsWorkspaceOpen({ failure }: { failure: SpawnFailureDetail }): boolean {
  return failure.strandedInComposer === true || failure.pickupSubmissionUnproven === true;
}

/**
 * A workspace that opened but could not finish booting or pickup delivery. Its `workspaceId` is carried beside
 * the ref because a seat left open is recorded in the session ledger, and the id is what survives a cmux restart;
 * it is absent only on a failure from before cmux named a workspace, which leaves no seat behind.
 */
export type SpawnFailure = SpawnFailureDetail &
  Pick<SpawnWorkspace, "surfaceRef" | "workspaceRef"> & { readonly workspaceId?: string | undefined };

/** The boot half's result, deliberately carrying no claim that pickup was sent. */
export type BootOutcome = Result<OpenedWorkspace, SpawnFailure>;

/** A workspace that opened, booted and had its pickup delivered — the success arm of {@link SpawnOutcome}. */
export type SpawnedSession = OpenedWorkspace & { readonly pickupCommand: string; readonly delivery: PickupDelivery };

/** One complete spawn's result, including the exact pickup command sent and how its delivery ended. */
export type SpawnOutcome = Result<SpawnedSession, SpawnFailure>;

/** The latest pickup decision, resolved only after the visible session has finished booting. */
export type PickupCommandResolution = Result<string, string>;

/**
 * One workspace's addressing, threaded through every step below.
 *
 * Both the ids AND the refs, because they answer different questions: every call cmux is asked keys on the
 * ids (a ref that names nothing silently addresses the focused surface instead — see `client.ts`'s
 * {@link ../cmux/client.CmuxTarget}), while the refs are what the session ledger records and what a human
 * pastes into a `read-screen`.
 */
export interface SpawnWorkspace {
  readonly workspaceRef: string;
  readonly workspaceId: string;
  readonly surfaceRef: string;
  readonly surfaceId: string;
}

/** A refused {@link SpawnOutcome} for one already-opened workspace, naming why. */
function refused({ workspace, reason }: { workspace: SpawnWorkspace; reason: string }): SpawnFailure {
  const { surfaceRef, workspaceId, workspaceRef } = workspace;
  return { reason, surfaceRef, workspaceId, workspaceRef };
}

/**
 * Create the worktree the plan names (when it does not exist yet) and open the cmux workspace in it.
 *
 * Split out of {@link bootCmuxWorkspace} so that function stays under the max-function-lines ratchet once the
 * pre-spawn credential gate joined it. The Codex browser door sits between the worktree and the workspace.
 *
 * @param deps the effects to run it through
 * @param plan the already-gated plan, carrying the store this session will boot against
 * @returns the opened workspace's ids and refs, or the reason it could not be opened
 */
async function openWorkspaceFor({
  deps,
  plan,
}: {
  deps: SpawnDeps;
  plan: VisibleSessionPlan;
}): Promise<Result<SpawnWorkspace, SpawnFailure>> {
  if (!plan.worktreeExists) {
    deps.ensureWorktree({ plan });
  }
  // Rule 3, once the worktree exists and before a tab does: its own branch's trusted `.codex/config.toml` is
  // part of what a Codex seat loads, so the directory is read as the seat will run in it (Codex review r4).
  const browserGated = deps.gateCodexBrowserSurface({ plan });
  if (browserGated.isErr()) {
    return err({ reason: browserGated.error, surfaceRef: "", workspaceRef: "" });
  }
  const description = composeWorkspaceDescription({ plan });
  const opened = await createOrAdoptWorkspace({ cwd: plan.cwd, deps, description, name: plan.workspaceTitle });
  return opened.mapErr(({ reason, workspaceId, workspaceRef }) => ({
    reason,
    surfaceRef: "",
    workspaceId,
    workspaceRef,
  }));
}

/**
 * Open the worktree/workspace and boot the host, verifying it actually came up — but send no pickup command.
 *
 * Split out of the single-shot {@link spawnCmuxSession} so a caller that needs to durably RECORD the opened
 * workspace's refs before anything is sent into it can do so in between this call and
 * {@link deliverPickupCommand} — see `live/turn/dispatch.ts`'s module header for why a fast fresh agent
 * reading a dispatch record before it exists is a real, previously unclosed race.
 *
 * @param plan the already-decided plan from {@link ./plan.js}
 * @param deps the effects to run it through
 * @returns the opened workspace's refs, or the reason boot could not be witnessed
 */
export async function bootCmuxWorkspace({
  plan,
  deps,
}: {
  plan: VisibleSessionPlan;
  deps: SpawnDeps;
}): Promise<BootOutcome> {
  // FIRST, before a worktree or a workspace exists: which account would this session boot on, and may it?
  // A refusal here leaves no directory and no cmux tab behind, which is the same placement the Codex quota
  // fast-fail uses and the reason the gate is a dep rather than something each caller remembers to call.
  const gated = await deps.gateCredentialStore({ plan });
  if (gated.isErr()) {
    return err({ reason: gated.error, surfaceRef: "", workspaceRef: "" });
  }
  const booting = gated.value;
  const line = bootLine({ deps, plan: booting });
  const overflow = ttyLineOverflow({ line });
  if (overflow !== null) {
    return err({ reason: `the boot line cannot be typed whole: ${overflow}`, surfaceRef: "", workspaceRef: "" });
  }
  const first = await bootOnce({ deps, line, plan: booting });
  if (first.isOk()) {
    return ok(first.value);
  }
  const firstFailed = first.error.failedBoot;
  if (firstFailed === undefined) {
    return err(first.error.failure);
  }
  // A failed claude boot is closed, never left as an empty seat, and booted ONCE more in a fresh tab — a fresh
  // `claude` launch is a fresh session id by construction, so nothing is resumed. A tab that will not
  // close stops the retry: a second tab beside it would hide the empty seat this exists to remove.
  const firstClosed = await closeFailedBoot({ deps, failed: firstFailed });
  if (firstClosed.isErr()) {
    return err({ ...firstClosed.error, reason: `${firstClosed.error.reason}; no second boot was tried beside it` });
  }
  return retryFailedBoot({ deps, firstClosed: firstClosed.value, line, plan: { ...booting, worktreeExists: true } });
}

/**
 * The one retry after a failed `claude` boot whose tab was closed: boot again in a fresh tab, and close that one too
 * if it also fails, naming both.
 *
 * @param plan the gated plan, its worktree already standing
 * @param line the same boot line, already checked to fit the tty
 * @param firstClosed the clause saying how the first boot failed and that its tab was closed
 * @returns the booted workspace, or the refusal naming both attempts
 */
async function retryFailedBoot({
  deps,
  plan,
  line,
  firstClosed,
}: {
  deps: SpawnDeps;
  plan: VisibleSessionPlan;
  line: string;
  firstClosed: string;
}): Promise<BootOutcome> {
  const second = await bootOnce({ deps, line, plan });
  if (second.isOk()) {
    return ok(second.value);
  }
  const secondFailed = second.error.failedBoot;
  if (secondFailed === undefined) {
    return err({ ...second.error.failure, reason: `${firstClosed}; then ${second.error.failure.reason}` });
  }
  const secondClosed = await closeFailedBoot({ deps, failed: secondFailed });
  if (secondClosed.isErr()) {
    return err({ ...secondClosed.error, reason: `${firstClosed}; then ${secondClosed.error.reason}` });
  }
  return err({
    reason: `claude failed to boot twice — ${firstClosed}; then ${secondClosed.value} — so no seat stands for this spawn; run the same command again once the machine has headroom`,
    surfaceRef: "",
    workspaceRef: "",
  });
}

/** One boot attempt's failure, and — for a `claude` boot that ran and came up with no composer — the tab to close. */
type BootAttemptFailure = {
  readonly failure: SpawnFailure;
  readonly failedBoot?: { readonly workspace: SpawnWorkspace; readonly clause: string };
};

/**
 * Judge a `claude` boot on its composer once the preliminary witness has answered or run out.
 *
 * A boot no grid read reached is failed only when nothing vouched for it, and the event stream is read once more
 * before that verdict stands: a `SessionStart` that landed after the last boot poll would otherwise close a seat that
 * booted.
 *
 * @param before the screen read before the boot line was typed, or `undefined` when unreadable
 * @param witness the preliminary witness, or `undefined` when none answered inside its bound
 * @returns the booted workspace, or the failed boot naming its tab
 */
async function judgeClaudeBoot({
  deps,
  workspace,
  before,
  witness,
}: {
  deps: SpawnDeps;
  workspace: SpawnWorkspace;
  before: string | undefined;
  witness: Witness | undefined;
}): Promise<Result<OpenedWorkspace, BootAttemptFailure>> {
  const decision = await deps.witnessClaudeBoot({ before, bootWitnessed: witness !== undefined, workspace });
  if (decision.kind === "failed") {
    const late = decision.reason === "never-read" ? bootEventWitness({ deps, workspace }) : undefined;
    if (late !== undefined) {
      return ok({ ...workspace, bootWitness: late });
    }
    const clause = failedBootClause({ reason: decision.reason });
    return err({ failedBoot: { clause, workspace }, failure: refused({ reason: clause, workspace }) });
  }
  // `openWorkspaceFor` builds the workspace from exactly these four refs, so the spread carries nothing else. With no
  // event or banner, the composer read is the one witness that saw the boot.
  if (witness === undefined) {
    return ok({ ...workspace, bootWitness: { by: "composer", confirmed: true } });
  }
  return ok({ ...workspace, bootWitness: witness });
}

/**
 * Open one workspace and boot the host in it, judging a `claude` boot on its composer (`./claudeBootComposer.ts`)
 * and any other host on its boot witness alone.
 *
 * @param line the boot line, already checked to fit the tty
 * @returns the booted workspace, or why it is not one
 */
async function bootOnce({
  deps,
  plan,
  line,
}: {
  deps: SpawnDeps;
  plan: VisibleSessionPlan;
  line: string;
}): Promise<Result<OpenedWorkspace, BootAttemptFailure>> {
  const opened = await openWorkspaceFor({ deps, plan });
  if (opened.isErr()) {
    return err({ failure: opened.error });
  }
  const workspace = opened.value;
  publishOpeningSidebar({
    cli: deps.sidebarCli,
    fallbackTitle: plan.workspaceTitle,
    role: plan.role ?? "session",
    workspace,
  });
  const before = await readScreenOrUndefined({ client: deps.client, workspace });
  const sent = await deps.client.sendLine({
    target: { surfaceId: workspace.surfaceId, workspaceId: workspace.workspaceId },
    text: line,
    wait: deps.wait,
  });
  if (sent.isErr()) {
    return err({ failure: refused({ reason: `the boot line could not be sent: ${sent.error.message}`, workspace }) });
  }
  const witness = await pollForBootWitness({ before, deps, host: plan.host, workspace });
  if (plan.host === "claude-code") {
    return judgeClaudeBoot({ before, deps, witness, workspace });
  }
  if (witness === undefined) {
    return err({
      failure: refused({
        reason: "boot produced no positive signal — no session-start event, and no booted prompt on the surface",
        workspace,
      }),
    });
  }
  return ok({ ...workspace, bootWitness: witness });
}

/**
 * Close a tab whose `claude` boot failed, so it never stands as an empty seat.
 *
 * @param failed the tab and why its boot failed
 * @returns the clause naming what happened to it, or the refusal carrying the tab's refs when it would not close
 */
async function closeFailedBoot({
  deps,
  failed,
}: {
  deps: SpawnDeps;
  failed: { readonly workspace: SpawnWorkspace; readonly clause: string };
}): Promise<Result<string, SpawnFailure>> {
  const closed = await deps.client.closeWorkspace({ force: true, workspaceId: failed.workspace.workspaceId });
  if (closed.isErr()) {
    return err(
      refused({
        reason: `${failed.workspace.workspaceRef}: ${failed.clause}, and it could NOT be closed (${closed.error.message}) — close it by hand`,
        workspace: failed.workspace,
      }),
    );
  }
  return ok(`${failed.workspace.workspaceRef}: ${failed.clause}, and it was closed`);
}

/**
 * Run one spawn end to end: worktree, workspace, boot, verify, pickup command, verify again. A thin sequence
 * of {@link bootCmuxWorkspace} then {@link deliverPickupCommand} — kept for the two callers that genuinely
 * want the whole thing atomically (a manual `cmux spawn` and the generic spawn tests);
 * `live/turn/freshSession.ts` calls the two halves separately instead, precisely so it can record between them.
 *
 * @param plan the already-decided plan from {@link ./plan.js}
 * @param deps the effects to run it through
 * @param resolvePickup resolves the latest state-dependent pickup command after boot and immediately before
 *   delivery; fixed-command callers use the plan's command by default
 * @returns the opened workspace's refs, and how the pickup command's arrival was witnessed
 */
export async function spawnCmuxSession({
  plan,
  deps,
  resolvePickup,
}: {
  plan: VisibleSessionPlan;
  deps: SpawnDeps;
  resolvePickup?: () => PickupCommandResolution;
}): Promise<SpawnOutcome> {
  const boot = await bootCmuxWorkspace({ deps, plan });
  if (boot.isErr()) {
    return err(boot.error);
  }
  const opened = boot.value;
  const { surfaceId, surfaceRef, workspaceId, workspaceRef } = opened;
  const delivered = await deliverPickupCommand({
    deps,
    plan,
    ...(resolvePickup === undefined ? {} : { resolvePickup }),
    workspace: { surfaceId, surfaceRef, workspaceId, workspaceRef },
  });
  return delivered.isOk()
    ? ok({ ...opened, delivery: delivered.value.delivery, pickupCommand: delivered.value.pickupCommand })
    : // Every detail field the delivery set (`quotaKind` and the two keep-open flags) is carried as it was.
      err({ ...delivered.error, surfaceRef, workspaceId, workspaceRef });
}
