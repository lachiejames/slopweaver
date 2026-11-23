/**
 * The tick every spawn poll waits on, its bound, and the screen read every one of those polls makes — shared
 * by the boot half in `./spawn.ts` and the pickup witness windows in `./pickupWitnessWindow.ts`, so neither
 * has to import the other for them — and the boot-witness poll itself, which `./spawn.ts` runs once per boot attempt.
 */

import type { VisibleSessionHost } from "../supervisor/session.js";
import { hasPositiveBootSignal } from "./bootSignal.js";
import type { CmuxClient } from "./client.js";
import type { SpawnDeps, SpawnWorkspace } from "./spawn.js";
import type { Witness } from "./witness.js";

/** The hook firings that prove a host actually booted inside a workspace. */
const BOOT_EVENT_NAMES = ["agent.hook.SessionStart"] as const;

/**
 * Read a surface's screen, treating a read failure as "nothing to show yet" rather than throwing.
 *
 * Measured live: `surface.read_text` on a surface still settling answers `internal_error: Failed to read
 * terminal text` — a real cmux behaviour, not a network blip, and now a typed `TERMINAL_TEXT_UNREADABLE`
 * rather than a message a caller has to pattern-match. An unreadable screen and an EMPTY one carry the same
 * meaning to a boot check, so both collapse to `undefined` here and the witness chain moves on to a source
 * that is not affected by the load causing it.
 *
 * @param client the cmux client to read through
 * @param workspace the workspace whose surface is read
 * @returns the screen text, or `undefined` when it could not be read
 */
export async function readScreenOrUndefined({
  client,
  workspace,
}: {
  client: CmuxClient;
  workspace: SpawnWorkspace;
}): Promise<string | undefined> {
  const read = await client.readScreen({
    target: { surfaceId: workspace.surfaceId, workspaceId: workspace.workspaceId },
  });
  return read.isOk() ? read.value : undefined;
}

/**
 * One poll tick's delay, and how many ticks to allow before giving up.
 *
 * Measured live: the recipe's own `sleep 4` is NOT reliably enough. A real
 * `claude --plugin-dir <this checkout>` boot was still an unreadable/unrendered surface at 4s and had fully
 * rendered its banner and prompt by ~6s. A single fixed sleep gambles on that number never growing again — a
 * bounded poll tolerates a slower boot without raising the FLOOR every spawn pays when it boots fast, and
 * still terminates (15 ticks, ~15s) rather than waiting forever.
 */
export const BOOT_POLL_INTERVAL_MS = 1_000;

/** The bound on {@link BOOT_POLL_INTERVAL_MS} ticks — every wait loop in this repo has one. Exported for the test that proves the loop actually stops. */
export const MAX_BOOT_POLLS = 15;

/**
 * The `SessionStart` firing for this workspace, if the event stream has carried one yet. Read again once a `claude`
 * boot's composer polls are spent, so a hook that landed after the last boot poll still vouches for the boot.
 *
 * EITHER phase counts, unlike `witnessFromEvents`: the question is only whether the hook fired, and cmux emits
 * `received` before `completed`, so a capped spawn buffer under load evicts the `received` frame first and can be
 * left holding the `completed` one alone.
 *
 * @param deps the event stream to read
 * @param workspace the workspace the hook must name
 * @returns the event witness, or `undefined` while none has arrived
 */
export function bootEventWitness({
  deps,
  workspace,
}: {
  deps: Pick<SpawnDeps, "observedEvents">;
  workspace: SpawnWorkspace;
}): Witness | undefined {
  const fired = deps
    .observedEvents()
    .some(
      (event) => event.workspaceId === workspace.workspaceId && BOOT_EVENT_NAMES.some((name) => name === event.name),
    );
  return fired ? { by: "event", confirmed: true } : undefined;
}

/**
 * Poll until something confirms the HOST itself booted, or give up after {@link MAX_BOOT_POLLS} ticks.
 *
 * Deliberately NOT the same chain as `./pickupWitnessWindow.ts`'s `pollForPickupWitness`, and the difference is the whole
 * correctness of this step. Boot has only two honest witnesses:
 *
 * - a `SessionStart` hook firing for this workspace, which only a real agent process emits, and
 * - the rendered prompt matching {@link hasPositiveBootSignal}'s per-host banner.
 *
 * Neither cmux's delivery record nor "the boot line appears on the screen" is a boot witness at all: the
 * shell ECHOES the command it was given, so a workspace where `claude` failed to launch shows the boot line
 * on its surface exactly like one where it succeeded. Treating that as a witness would report every broken
 * tab as booted — the precise failure `bootSignal.ts` exists to prevent. For a `claude` boot this is the
 * PRELIMINARY witness: `./spawn.ts` then decides the boot on Claude's composer (`./claudeBootComposer.ts`).
 *
 * @param deps the effects to poll through
 * @param workspace the workspace being watched
 * @param before the screen captured before the boot line was sent, or `undefined` when unreadable
 * @param host which model CLI this workspace was meant to boot
 * @returns the first witness that confirmed, or `undefined` once the bound is reached
 */
export async function pollForBootWitness({
  deps,
  workspace,
  before,
  host,
}: {
  deps: Pick<SpawnDeps, "client" | "observedEvents" | "wait">;
  workspace: SpawnWorkspace;
  before: string | undefined;
  host: VisibleSessionHost;
}): Promise<Witness | undefined> {
  for (let tick = 0; tick < MAX_BOOT_POLLS; tick++) {
    await deps.wait();
    const fromEvents = bootEventWitness({ deps, workspace });
    if (fromEvents !== undefined) {
      return fromEvents;
    }
    const screen = await readScreenOrUndefined({ client: deps.client, workspace });
    if (screen !== undefined && hasPositiveBootSignal({ before, host, screen })) {
      return { by: "screen", confirmed: true };
    }
  }
  return undefined;
}
