/**
 * The last word on whether a `claude` boot came up: Claude Code's own composer on the surface, read off the styled
 * grid, after `./spawn.ts`'s boot witness has answered or run out.
 *
 * ## Why the boot witness alone is not enough
 *
 * `agent.hook.SessionStart` proves a `claude` PROCESS started, and the banner proves it printed. Neither says a seat
 * stands at a prompt. MEASURED: two spawns under load 37 reported "no positive
 * signal" and left their tabs open at blank, unregistered Claude prompts, and two resumes printed `No conversation
 * found with session ID` and dropped to zsh. A seat is booted only when its composer is read — or, under a
 * 2026 load where every grid read fails, when the boot witness vouches for it (`./composerProbe.ts`).
 */
import {
  EXIT_SIGHTINGS_TO_FAIL,
  type ExitLine,
  type MissingConversationReading,
  NO_EXIT_SIGHTINGS,
  newExitLine,
  nextExitSightings,
  readMissingConversation,
} from "./bootSignal.js";
import type { CmuxClient } from "./client.js";
import {
  type ClaudeBootDecision,
  type ComposerProbe,
  decideClaudeBoot,
  gridReadWithoutComposer,
  probeComposer,
  witnessedComposer,
} from "./composerProbe.js";

/**
 * Ticks spent looking for the composer once the boot witness has answered. MEASURED across ten spawns
 * (`./pickupDelivery.ts`'s `MAX_READY_PROMPT_POLLS`): `SessionStart` to a prompt that takes input is 4.4-7.7 s, so
 * fifteen one-second ticks clear the slowest with headroom.
 */
export const MAX_COMPOSER_BOOT_POLLS = 15;

/** The surface a boot is read on. */
interface BootSurface {
  readonly workspaceId: string;
  readonly surfaceId: string;
}

/**
 * The missing-conversation EXIT line the surface now shows that `baseline` did not; an unreadable screen shows none.
 *
 * It outranks a SessionStart on purpose: a failed resume registered its id, then printed the line and
 * exited, so a witness from that process's start proves nothing once the line is up. Only an exit counts — the line at
 * column 0 with no running-Claude chrome under it (`./bootSignal.ts`) — so a hook or prompt quoting Claude's phrase
 * inside a live session no longer fails the boot.
 */
async function newMissingConversation({
  baseline,
  client,
  target,
}: {
  baseline: MissingConversationReading;
  client: Pick<CmuxClient, "readScreen">;
  target: BootSurface;
}): Promise<ExitLine | undefined> {
  const screen = await client.readScreen({ target });
  if (screen.isErr()) {
    return undefined;
  }
  return newExitLine({ after: readMissingConversation({ screen: screen.value }), before: baseline });
}

/**
 * Poll the surface for Claude's composer, stopping at the first one read or at a NEW missing-conversation exit that
 * stood on {@link EXIT_SIGHTINGS_TO_FAIL} consecutive reads, and decide the boot over every probe once the bound is
 * spent. The composer is probed FIRST on every tick, so a composer on the grid always outranks the screen's text.
 *
 * @param client the cmux calls the reads go through
 * @param wait one pacing tick
 * @param workspace the surface the boot line was typed into
 * @param bootWitnessed whether `SessionStart` or the banner witnessed the boot
 * @param before the screen read before the boot line was typed, so a missing-conversation line already on it is not
 *   this boot's
 * @returns the boot's decision
 */
export async function awaitClaudeComposer({
  client,
  wait,
  workspace,
  bootWitnessed,
  before,
}: {
  client: Pick<CmuxClient, "readScreen" | "readScreenGrid">;
  wait: () => Promise<void>;
  workspace: BootSurface;
  bootWitnessed: boolean;
  before: string | undefined;
}): Promise<ClaudeBootDecision> {
  // With no screen from before the boot, a missing-conversation line cannot be shown to be NEW, so it never fails the
  // boot here; an exited claude still leaves no composer, which the decision over the probes fails instead.
  const baseline = before === undefined ? undefined : readMissingConversation({ screen: before });
  const target = { surfaceId: workspace.surfaceId, workspaceId: workspace.workspaceId };
  const probes: ComposerProbe[] = [];
  let sightings = NO_EXIT_SIGHTINGS;
  for (let tick = 0; tick < MAX_COMPOSER_BOOT_POLLS; tick += 1) {
    const probe = await probeComposer({ client, target });
    const reading = witnessedComposer({ probe });
    if (reading !== undefined) {
      return { kind: "composer", reading };
    }
    probes.push(probe);
    // An exit counts only beside a grid that READ with no composer: one that would not read may hold a live one.
    let exit: ExitLine | undefined;
    if (baseline !== undefined && gridReadWithoutComposer({ probe })) {
      exit = await newMissingConversation({ baseline, client, target });
    }
    sightings = nextExitSightings({ exit, sightings });
    if (sightings.count >= EXIT_SIGHTINGS_TO_FAIL) {
      return { kind: "failed", reason: "missing-conversation" };
    }
    await wait();
  }
  return decideClaudeBoot({ bootWitnessed, missingConversationSeen: false, probes });
}
