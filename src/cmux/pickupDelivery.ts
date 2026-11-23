/**
 * The second half of a spawn: send an already-booted workspace's pickup command, confirm it actually landed and
 * left the composer, and watch for a banner saying the host booted but cannot respond. Split out of `./spawn.ts`
 * on size alone, so that module keeps the boot half and the single-shot `spawnCmuxSession`; its header carries
 * the measurements behind every step here.
 *
 * `./spawn.ts` keeps the shared types (`SpawnDeps`, `SpawnWorkspace`, `PickupDelivery`, `SpawnFailureDetail`,
 * `PickupCommandResolution`) because about twenty modules already import them from there, so this module imports
 * them back as TYPES ONLY. That import is erased at runtime, so there is no runtime cycle: the same shape
 * `./spawnPolling.ts` and `./pickupWitnessWindow.ts` already have.
 */
import { detectLimitRetryBanner } from "../claude/limitBanner.js";
import { detectExhaustionBanner } from "../codex/quotaBanner.js";
import { err, ok, type Result } from "../lib/result.js";
import type { VisibleSessionHost } from "../supervisor/session.js";
import { hasReadyPromptSignal, readyPromptIsAssertable } from "./bootSignal.js";
import { type ComposerReading, describeComposer } from "./composer.js";
import { confirmPickupLeftComposer } from "./pickupComposerConfirm.js";
import { sendPickupOnceThenWitness } from "./pickupWitnessWindow.js";
import type { VisibleSessionPlan } from "./plan.js";
import type {
  PickupCommandResolution,
  PickupDelivery,
  SpawnDeps,
  SpawnFailureDetail,
  SpawnWorkspace,
} from "./spawn.js";
import { readScreenOrUndefined } from "./spawnPolling.js";

/**
 * The bound on ticks spent waiting for a booted host to render a prompt it will accept a paste into, before
 * the pickup line is sent at all.
 *
 * Measured across ten real spawns: the gap from `agent.hook.SessionStart` — the event
 * `./spawnPolling.ts`'s `pollForBootWitness` treats as booted — to the session's first `UserPromptSubmit` is 4.4-7.7 s. Ten
 * ticks covers every one of those with headroom, and reaching the bound is NOT a refusal: the line is sent
 * anyway, because a screen that will not read is not evidence the host is broken, and refusing there would
 * trade a rare silent drop for a common false failure. See `bootSignal.ts`'s `READY_PROMPT_PATTERNS`.
 */
export const MAX_READY_PROMPT_POLLS = 10;

/**
 * The bound on ticks spent watching a freshly-booted `codex` surface for a known usage-exhaustion banner,
 * AFTER its pickup command is already confirmed landed.
 *
 * Measured live: a real `codex exec` reproduction rendered its own `SessionStart`/
 * `UserPromptSubmit` hook chrome for several seconds before the exhaustion error appeared — the banner is
 * not necessarily visible the instant "OpenAI Codex" first renders (that text is cold-boot chrome, which
 * `hasPositiveBootSignal` already treats as a successful boot). This runs ONLY for `host: "codex"`.
 */
export const MAX_CODEX_QUOTA_POLLS = 5;

/**
 * The bound on ticks spent watching a freshly-booted `claude` surface for a usage-limit RETRY banner, AFTER
 * its pickup command is already confirmed landed. Matched to {@link MAX_CODEX_QUOTA_POLLS} rather than
 * measured separately: the two are the same question asked of two hosts, and a bound nobody can justify
 * separately should not be two numbers.
 *
 * This is a BACKSTOP, not the primary defence — `claude/spawnStore.ts` refuses the spawn before a workspace
 * exists when the gauge already reads spent. What it catches is the plan that read healthy and hit its wall
 * on the very first request, which is a race no pre-read can close.
 */
export const MAX_CLAUDE_LIMIT_POLLS = MAX_CODEX_QUOTA_POLLS;

/**
 * The refusal a spawn ends in when nothing saw its pickup submitted and the box does not hold it — naming the
 * workspace, and telling the reader to look rather than to send again.
 *
 * @param workspaceRef the workspace the line was sent into
 * @param reading what the box was read holding
 * @returns the reason a `SpawnFailureDetail` carries
 */
function unprovenPickupReason({ workspaceRef, reading }: { workspaceRef: string; reading: ComposerReading }): string {
  return (
    `nothing saw the pickup submitted in ${workspaceRef} — no prompt-submit event, no delivery record naming ` +
    `it, no running turn — and its composer does not hold the line (${describeComposer({ reading })}), so the ` +
    `seat may be idle at its prompt with no pickup; read it with \`slopweaver cmux read-screen --workspace ` +
    `${workspaceRef}\` before anything else — a queued pickup is invisible to every witness here, so a second ` +
    `send on a guess is the duplicate-pickup failure`
  );
}

/**
 * Wait for the booted host to render a prompt it will accept a paste into, giving up after
 * {@link MAX_READY_PROMPT_POLLS} ticks and returning anyway.
 *
 * Returning `false` is not a refusal and no caller treats it as one — see {@link MAX_READY_PROMPT_POLLS} and
 * `bootSignal.ts`'s `hasReadyPromptSignal` for why a negative readiness answer must never fail a spawn. A
 * host whose readiness cannot be asserted at all skips the wait entirely rather than burning the bound on a
 * signal that is never coming.
 *
 * @param deps the effects to poll through
 * @param workspace the workspace being watched
 * @param host which model CLI this workspace booted
 * @returns whether a ready prompt was actually seen, for the caller's log — never for a decision to refuse
 */
async function waitForReadyPrompt({
  deps,
  workspace,
  host,
}: {
  deps: SpawnDeps;
  workspace: SpawnWorkspace;
  host: VisibleSessionHost;
}): Promise<boolean> {
  if (!readyPromptIsAssertable({ host })) {
    return false;
  }
  for (let tick = 0; tick < MAX_READY_PROMPT_POLLS; tick++) {
    if (hasReadyPromptSignal({ host, screen: await readScreenOrUndefined({ client: deps.client, workspace }) })) {
      return true;
    }
    await deps.wait();
  }
  return false;
}

/**
 * Poll a just-pickup-delivered surface for a banner saying it booted but cannot respond, giving up after
 * `maxPolls` ticks and reporting healthy — an ABSENT banner is not proof of health, only the bound this loop
 * is willing to spend finding out, same as every other poll in this module.
 *
 * Two banners use it. `codex`'s usage-exhaustion banner, bounded by {@link MAX_CODEX_QUOTA_POLLS}; and
 * `claude`'s usage-limit RETRY banner, bounded by {@link MAX_CLAUDE_LIMIT_POLLS}, a state with no other
 * signal at all: the process stays alive, the harness reports the session busy, and it retries on a schedule
 * measured in days. MEASURED: two bot workers sat in exactly that state for hours
 * (`claude/limitBanner.ts` carries the captured line) while their asks looked dispatched.
 *
 * @param deps the effects to poll through
 * @param workspace the workspace to poll
 * @param maxPolls how many screen reads to spend
 * @param detect the host's own banner matcher
 * @returns what the matcher found, or undefined once the bound is reached with no match
 */
async function pollForBanner<T>({
  deps,
  workspace,
  maxPolls,
  detect,
}: {
  deps: SpawnDeps;
  workspace: SpawnWorkspace;
  maxPolls: number;
  detect: (args: { text: string }) => T | undefined;
}): Promise<T | undefined> {
  for (let tick = 0; tick < maxPolls; tick++) {
    const screen = await readScreenOrUndefined({ client: deps.client, workspace });
    const found = screen === undefined ? undefined : detect({ text: screen });
    if (found !== undefined) {
      return found;
    }
    await deps.wait();
  }
  return undefined;
}

/**
 * Send an already-booted workspace's pickup command and confirm it actually landed — the second half of the
 * single-shot {@link ./spawn.spawnCmuxSession}, callable only once a caller already has the workspace refs
 * {@link ./spawn.bootCmuxWorkspace} opened.
 *
 * Also watches the surface right after the pickup command lands for the one banner that says this host
 * booted fine and cannot actually respond — a usage-exhaustion banner for `codex`
 * and a usage-limit retry banner for `claude` (both {@link pollForBanner}). Reporting either as a plain delivered success is what left two bot
 * workers retrying for hours with their asks recorded as dispatched.
 *
 * @param plan the plan naming the pickup text to send
 * @param deps the effects to run it through
 * @param workspace the already-booted workspace and surface, by id and by ref
 * @param resolvePickup resolves the latest state-dependent command immediately before send; fixed-command
 *   callers use the plan's command by default
 * @returns the exact pickup command sent and how its delivery ended — witnessed or merely `unwitnessed`,
 *   which is NOT a failure — or the reason it could not be resolved, SENT, or got out of the composer (with
 *   `quotaKind` set when that reason was a caught Codex exhaustion banner, `strandedInComposer` when the
 *   line was sent but never left the composer, and `pickupSubmissionUnproven` when nothing saw it submitted
 *   over a box read empty)
 */
export async function deliverPickupCommand({
  plan,
  deps,
  workspace,
  resolvePickup = () => ok(plan.pickupCommand),
}: {
  plan: VisibleSessionPlan;
  deps: SpawnDeps;
  workspace: SpawnWorkspace;
  resolvePickup?: () => PickupCommandResolution;
}): Promise<Result<{ readonly pickupCommand: string; readonly delivery: PickupDelivery }, SpawnFailureDetail>> {
  const pickup = resolvePickup();
  if (pickup.isErr()) {
    return err({ reason: pickup.error });
  }
  await waitForReadyPrompt({ deps, host: plan.host, workspace });
  const delivered = await sendPickupOnceThenWitness({ deps, expected: pickup.value, host: plan.host, workspace });
  if (delivered.isErr()) {
    return err(delivered.error);
  }
  const { composer, entersSpent } = delivered.value;
  const left = await confirmPickupLeftComposer({
    entersSpent,
    gate: { client: deps.client, wait: deps.wait, workspace },
    lastSeen: composer,
    witnessedBy: delivered.value.delivery.kind === "unwitnessed" ? undefined : delivered.value.delivery.witness.by,
  });
  if (left.isErr()) {
    return err({ reason: left.error, strandedInComposer: true });
  }
  // The window's own Enter on a typed box can be its last tick, so the gate's first read is the one that sees
  // the box leave — the same typed-then-readable witness `decidePickupPoll` takes inside the window.
  const windowEnterLeftIt = delivered.value.pressedOnTyped && left.value.reading.kind !== "unreadable";
  const delivery: PickupDelivery =
    left.value.kind === "cleared" || (delivered.value.delivery.kind === "unwitnessed" && windowEnterLeftIt)
      ? { kind: "resubmitted", witness: { by: "composer", confirmed: true } }
      : delivered.value.delivery;
  // Unreadable stays an honest unwitnessed success (a loaded surface is not a failed one); a box READ
  // empty, with nothing having seen the line go, is a seat idling at an empty prompt.
  if (delivery.kind === "unwitnessed" && left.value.reading.kind !== "unreadable") {
    return err({
      pickupSubmissionUnproven: true,
      reason: unprovenPickupReason({ reading: left.value.reading, workspaceRef: workspace.workspaceRef }),
    });
  }
  const banner = await pollForCannotRespondBanner({ deps, host: plan.host, workspace });
  if (banner !== undefined) {
    return err(banner);
  }
  return ok({ delivery, pickupCommand: pickup.value });
}

/**
 * Watch the surface right after the pickup lands for the one banner saying the host booted and cannot respond.
 *
 * @param host which banner to watch for: Codex's usage exhaustion, or Claude's usage-limit retry
 * @returns the failure that banner means, or `undefined` when none rendered within the poll budget
 */
async function pollForCannotRespondBanner({
  deps,
  host,
  workspace,
}: {
  deps: SpawnDeps;
  host: VisibleSessionPlan["host"];
  workspace: SpawnWorkspace;
}): Promise<SpawnFailureDetail | undefined> {
  if (host === "codex") {
    const quotaKind = await pollForBanner({
      deps,
      detect: detectExhaustionBanner,
      maxPolls: MAX_CODEX_QUOTA_POLLS,
      workspace,
    });
    if (quotaKind === undefined) {
      return undefined;
    }
    return {
      quotaKind,
      reason: `codex rendered a usage-exhaustion banner (${quotaKind}) right after receiving its pickup command — it booted but cannot respond`,
    };
  }
  const banner = await pollForBanner({
    deps,
    detect: detectLimitRetryBanner,
    maxPolls: MAX_CLAUDE_LIMIT_POLLS,
    workspace,
  });
  if (banner === undefined) {
    return undefined;
  }
  return {
    reason: `claude rendered a usage-limit retry banner right after receiving its pickup command — it booted but cannot respond: ${banner}`,
  };
}
