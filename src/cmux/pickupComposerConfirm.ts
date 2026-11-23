/**
 * The gate a spawn's pickup passes before `cmux spawn` may return: the line has LEFT the composer. The effectful
 * half — reading the styled grid, pressing each Enter — beside `./pickupComposerGate.ts`'s pure decisions and
 * Enter budget, and apart from `./pickupWitnessWindow.ts` because the witness chain there answers a different question.
 *
 * MEASURED: `cmux spawn` returned success for workspace:327, 328 and 330, and each sat about
 * seventy minutes with its pickup typed in the composer and never submitted, running nothing while the fleet
 * read it as live. `slopweaver cmux read-screen --workspace workspace:327` printed
 * `composer: TYPED, unsubmitted — execute the doc. …`, one hand `cmux submit` started all three
 * within seconds, and every other spawn that pass (workspace:322–326) had needed the blind resubmit to
 * get its line through at all. The witness chain answers "did something see it arrive"; none of its four
 * sources reads the box itself, so a yes from any of them, or an unwitnessed `ok`, could leave the line
 * sitting there. The Enters `./pickupWitnessWindow.ts`'s window already pressed on a typed box come out of the same
 * `MAX_PICKUP_ENTERS`, so this gate and that window share one budget rather than each spending its own.
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import type { CmuxClient } from "./client.js";
import { type ComposerReading, readComposer } from "./composer.js";
import { decidePickupComposer, foldComposerReading, MAX_PICKUP_ENTERS } from "./pickupComposerGate.js";
import type { Witness } from "./witness.js";

/**
 * The bound on styled-grid reads {@link confirmPickupLeftComposer} spends waiting for a composer that reads
 * `typed` to empty, each one a tick after the last.
 *
 * Not a fresh measurement: `reach.ts` reads the composer once, `SEND_SETTLE_MS` (1.2 s) after its Enter, and
 * decides `stranded` on that single read, because Claude Code empties the box the moment a submit takes. Five
 * one-second ticks is that read with the margin a loaded surface needs, and it only ever delays a spawn whose
 * box is still holding text — an empty one answers on the first read.
 */
export const MAX_COMPOSER_CLEAR_POLLS = 5;

/** What the gate needs of a spawn: the two cmux calls it makes, a tick, and the workspace it reads. */
interface ComposerGateDeps {
  readonly client: Pick<CmuxClient, "readScreenGrid" | "submitComposer">;
  readonly wait: () => Promise<void>;
  readonly workspace: { readonly surfaceId: string; readonly workspaceId: string; readonly workspaceRef: string };
}

/**
 * Read the box once off the styled grid, a grid cmux will not hand over reading `unreadable` — never `typed`.
 *
 * @param client the cmux call the read goes through
 * @param workspace the workspace whose composer is read
 * @returns what the box holds, as far as this one read can say
 */
export async function readPickupComposer({
  client,
  workspace,
}: {
  client: Pick<CmuxClient, "readScreenGrid">;
  workspace: { readonly surfaceId: string; readonly workspaceId: string };
}): Promise<ComposerReading> {
  const grid = await client.readScreenGrid({
    target: { surfaceId: workspace.surfaceId, workspaceId: workspace.workspaceId },
  });
  return grid.isOk()
    ? readComposer({ grid: grid.value })
    : { kind: "unreadable", reason: `the styled grid could not be read: ${grid.error.message}` };
}

/**
 * Read the composer off the styled grid, a tick at a time, until it stops reading `typed` or
 * {@link MAX_COMPOSER_CLEAR_POLLS} reads are spent — returning the last reading either way.
 *
 * A grid that will not read is `unreadable`, never `typed`: `composer.ts`'s honesty rule, and the reason this
 * gate can never refuse a spawn whose box it never saw holding the line. Once it HAS seen the line, though, an
 * unreadable read leaves the box `typed` ({@link foldComposerReading}) and the ticks run on.
 *
 * @param gate the effects to read and wait through, and the workspace whose composer is read
 * @param lastSeen what the box was last positively seen holding, carried across each of the gate's Enters
 * @returns the composer reading the ticks settled on
 */
async function settledComposer({
  gate,
  lastSeen,
}: {
  gate: ComposerGateDeps;
  lastSeen: ComposerReading;
}): Promise<ComposerReading> {
  let reading = lastSeen;
  for (let tick = 0; tick < MAX_COMPOSER_CLEAR_POLLS; tick++) {
    await gate.wait();
    const next = await readPickupComposer({ client: gate.client, workspace: gate.workspace });
    reading = foldComposerReading({ next, previous: reading });
    if (reading.kind !== "typed") {
      return reading;
    }
  }
  return reading;
}

/**
 * The refusal a spawn ends in when its pickup is still sitting in the composer, naming the workspace a reader
 * has to look at and the keystrokes that have already been spent.
 *
 * @param workspaceRef the workspace holding the line
 * @param text what the composer still holds — possibly Claude Code's collapsed `[Pasted text #N]` form
 * @param pressed what became of the Enters, for the reader deciding whether another is worth it
 * @returns the reason a `SpawnFailureDetail` carries
 */
export function strandedPickupReason({
  workspaceRef,
  text,
  pressed,
}: {
  workspaceRef: string;
  text: string;
  pressed: string;
}): string {
  return (
    `the pickup is still TYPED, unsubmitted in ${workspaceRef}'s composer — ${pressed} — so the ` +
    `seat is running nothing; press it through with \`slopweaver cmux submit --workspace ${workspaceRef}\` ` +
    `and read the screen, never re-send the line (composer: ${text})`
  );
}

/**
 * Read the box on the styled grid once pickup delivery has ended, and press Enter while it still holds the line,
 * up to `MAX_PICKUP_ENTERS` in all.
 *
 * The box is read on the grid `composer.ts` decides `typed` from — the faint attribute, never the text, because
 * Claude Code collapses a long paste to `[Pasted text #N]` and no comparison against the sent line survives
 * that. Three outcomes:
 *
 * - **Not `typed`** (empty, Claude Code's own suggestion or placeholder, or `unreadable`) before this gate
 *   pressed anything: `untouched`, and the delivery stands as the chain reported it. `unreadable` is not evidence
 *   of a strand — a Codex seat's composer is never measured, so it always lands here. Nor is it evidence the box
 *   EMPTIED: once a read has said `typed`, an unreadable one leaves it `typed` ({@link foldComposerReading}).
 * - **`typed`**, with Enters left in the budget: one is pressed, nothing re-typed, and the box is read again
 *   for a full settle window before the next — so a session still booting gets time to start taking a submit.
 *   A box that empties is `cleared`. A witness that said yes over a typed box is logged, because it was wrong.
 * - **Still `typed` with the budget spent**, or an Enter cmux itself refused: REFUSED, naming the workspace and
 *   how many Enters it had. A refused Enter is a cmux failure, not a session pressed too early, so it ends the
 *   gate at once rather than spending another.
 *
 * @param gate the effects to read, submit and wait through, and the workspace the pickup was typed into
 * @param witnessedBy the chain source that said the line arrived, or `undefined` when nothing did
 * @param entersSpent every Enter the pickup has already had — `sendLine`'s, and any the witness window
 *   pressed — so this gate spends only what is left of `MAX_PICKUP_ENTERS`
 * @param lastSeen what an UNWITNESSED window last read the box holding, so a grid that stops reading here
 *   cannot clear a line that window saw typed; `unreadable` after a witness, whose own tick read no grid
 * @returns `untouched` or `cleared` (one of this gate's Enters emptied the box) with the reading the box
 *   settled on, or the refusal naming the workspace
 */
export async function confirmPickupLeftComposer({
  gate,
  witnessedBy,
  entersSpent: spentBeforeGate,
  lastSeen,
}: {
  gate: ComposerGateDeps;
  witnessedBy: Witness["by"] | undefined;
  entersSpent: number;
  lastSeen: ComposerReading;
}): Promise<Result<{ readonly kind: "untouched" | "cleared"; readonly reading: ComposerReading }, string>> {
  const { workspaceRef } = gate.workspace;
  let entersSpent = spentBeforeGate;
  let reading = await settledComposer({ gate, lastSeen });
  let decision = decidePickupComposer({ entersSpent, reading });
  // Bounded: each pass spends one Enter, and the decision refuses once `MAX_PICKUP_ENTERS` are spent.
  while (decision.kind === "submit") {
    entersSpent += 1;
    const whoSaidYes =
      witnessedBy !== undefined && entersSpent === spentBeforeGate + 1
        ? `${witnessedBy} reported it delivered, but `
        : "";
    logger.error({
      msg:
        `cmux spawn: ${whoSaidYes}the pickup is still TYPED in ${workspaceRef}'s composer — pressing Enter ` +
        `${String(entersSpent)} of ${String(MAX_PICKUP_ENTERS)}, the line is NOT re-typed`,
    });
    const submitted = await gate.client.submitComposer({
      target: { surfaceId: gate.workspace.surfaceId, workspaceId: gate.workspace.workspaceId },
    });
    if (submitted.isErr()) {
      return err(
        strandedPickupReason({
          pressed: `Enter ${String(entersSpent)} of ${String(MAX_PICKUP_ENTERS)} was refused (${submitted.error.message})`,
          text: decision.text,
          workspaceRef,
        }),
      );
    }
    // Seeded with the typed reading: a box that will not read after the Enter has not been seen to empty.
    reading = await settledComposer({ gate, lastSeen: reading });
    decision = decidePickupComposer({ entersSpent, reading });
  }
  if (decision.kind === "accept") {
    return ok({ kind: entersSpent > spentBeforeGate ? "cleared" : "untouched", reading });
  }
  return err(
    strandedPickupReason({
      pressed: `${String(entersSpent)} Enters were pressed with nothing re-typed, and the line was not seen to leave it`,
      text: decision.text,
      workspaceRef,
    }),
  );
}
