/**
 * What one scheduled resync attempt LEARNED — the record that separates "it ran" from "it worked".
 *
 * A run stamp (`live/automation/definitionRunStore.ts`) answers when a row last fired, and that is all a
 * cadence needs. It is not what a reader deciding whether an atlas is current actually needs: a row that
 * has fired every four hours for a week and failed every time carries exactly the same stamp as a healthy
 * one. That is the shape of the failure this record exists for — 36 atlases behind while nothing said
 * so — so the outcome is its own record and it carries the POSTCONDITION, not just the exit code.
 *
 * ## Zero exit is necessary and not sufficient
 *
 * Measured while building this. `slopweaver atlas vanta sync` exits 1 and still publishes a
 * usable generation, having failed a handful of its surfaces; `slopweaver atlas trelica refresh` exits 1
 * and publishes nothing at all. Reproduce both:
 * `slopweaver atlas vanta sync > /tmp/v.log 2>&1; echo $?; grep -c INCOMPLETE /tmp/v.log`. So an atlas
 * attempt is judged on whether its generation clock MOVED, and the exit code is carried beside that rather
 * than instead of it.
 *
 * A corpus source is judged differently and deliberately so. Its clock is the STORE's newest row for it
 * (`./clock.ts`, off `store/newest.ts`) and not its bronze watermark: the watermark moves the moment
 * `refresh` writes a window file, whether or not anything ingests that file into Postgres, which is how
 * `resync-corpus-linear` recorded an advanced `afterClock` while the store's newest linear row
 * stayed hours behind it. The step now carries `--store` (`./policy.ts`), so a zero exit means the refresh itself
 * confirmed the window file reached the store — and the judgement here is the residue that exit code cannot
 * carry: an attempt that exited zero and left NO newest row is one whose records reached nowhere a reader
 * can query, and it fails. The clock is not required to MOVE, because a quiet window writes nothing new and
 * a refresh that only re-fetched changed old records writes rows older than the store's newest; both are
 * healthy, and both exit non-zero or zero on their own merits. Never advance a cursor to make a page look
 * green.
 *
 * The quiet window is the one non-zero exit a corpus attempt ACCEPTS: `refresh` exits `EXIT_EXPECTED_EMPTY`
 * (3) when it fetched fine and had nothing new to write, and a judge that refused every non-zero exit recorded
 * `resync-corpus-fathom` FAILED on every pass — one meeting, key configured, nothing new — and the freshness
 * page called a healthy source stale (measured: `slopweaver refresh --source fathom --store; echo
 * $?` prints `wrote 0 new, deduped 1` and 3). An atlas keeps the strict reading: its clock is the proof.
 *
 * ## A moved clock is not proof when the browser leg stopped part way
 *
 * MEASURED: `resync-atlas-hex` landed 15 of 56 routes, then every visit answered
 * `SESSION_LOST`; the verb exited 0 and the API half moved the clock, so this judged it succeeded and the
 * slot was stamped. A "zero of N reached" rule would have passed it. So a walk-stopping transport answer
 * during any step (`browser/walkStops.ts`) fails the attempt before the exit code or the clock is read — an
 * explicit signal rather than a ratio, because a ratio needs a threshold and would fail a walk whose pages
 * legitimately redirect. What it does not see: a walk that reached nothing with no transport failure at all.
 *
 * **A drop the transport RECOVERED from never reaches this judgement, by construction.**
 * `browser/relayRun.ts` rebuilds a dropped relay and re-addresses the page it lost, BELOW the layer that
 * notes a stop, so such a walk reaches its own end and is graded on its clock like any other. The drop is
 * carried on its own register instead (`takeRelayRecoveries`), reported by `live/resync/run.ts` and never
 * pushed onto `problems` — a recovered drop that failed the attempt would leave a 251-page walk that finished
 * with its slot still due, which is the refusal the reconnect exists to remove.
 *
 * Pure: values in, a judgement out.
 */
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../cli/exitCodes.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { ResyncDemandRecord } from "./demand.js";
import type { ResyncTarget } from "./target.js";

/**
 * How one attempt ended.
 *
 * @internal — read through {@link ResyncAttempt}; nothing outside this file names the union yet.
 */
export type ResyncOutcomeKind = "succeeded" | "failed";

/** What a human has to do before this target can ever succeed unattended, when something does. */
export interface ResyncBlocker {
  /** A stable key for this blocker, so re-recording the same one updates rather than piles up. */
  readonly key: string;
  /** What was observed, in the words the verb itself used. */
  readonly reason: string;
  /** The exact steps that clear it — clickops, in order. */
  readonly steps: readonly string[];
  /** The handover finding row this blocker was registered as, when it has been. */
  readonly findingSlug: string | null;
}

/** One attempt, whole. */
export interface ResyncAttempt {
  readonly recipeId: string;
  readonly startedAtIso: string;
  readonly finishedAtIso: string;
  readonly exitCode: number;
  readonly outcome: ResyncOutcomeKind;
  /** The target's own clock before the attempt — a generation for an atlas, the store's newest row for a source. */
  readonly beforeClock: string | null;
  readonly afterClock: string | null;
  /** Everything that went wrong, in the words the verb used. Empty on a clean success. */
  readonly problems: readonly string[];
  /**
   * The instant the target itself certified this success current as of, when it certifies one (ChatGPT's export) —
   * the verified-sync clock in place of {@link ResyncAttempt.finishedAtIso}. Absent on every other attempt.
   */
  readonly asOfIso?: string | undefined;
  /**
   * The origin whose sign-in page a step reached instead of the page it asked for (`browser/signInWalls.ts`),
   * when one did — the one failure the owner clears by signing in, which `monitor/resyncSignedOut.ts` cards.
   * Absent on every other attempt, and on every record written before the field existed.
   */
  readonly signInWall?: string | undefined;
  /**
   * Why the walk never started, when the step that stopped it lost the relay to ANOTHER live walk
   * (`browser/walkStops.ts#noteWalkCollision`) — the stop the next pass clears by running after that walk.
   * Absent on every other attempt.
   */
  readonly relayCollision?: string | undefined;
  /**
   * The step that exited `EXIT_DEFERRED` — it ran and declined to act YET, so the same step is correct on the
   * next pass. A corpus `refresh` answers that when another live process holds every selected source's refresh
   * slot (`corpus/refreshSlot.ts`). Absent on every other attempt.
   */
  readonly stepDeferred?: string | undefined;
  /**
   * The person's mention that made a demand-gated atlas walk (`./demand.ts`), so a sign-in card this attempt
   * raises says who wanted the read rather than calling it routine. Absent on every ungated attempt.
   */
  readonly demand?: ResyncDemandRecord | undefined;
}

/** Everything remembered about one target. */
export interface ResyncState {
  readonly recipeId: string;
  readonly lastAttempt: ResyncAttempt | null;
  /** When this target last actually WORKED, which is the number a freshness page reports. */
  readonly lastSuccessAtIso: string | null;
  readonly blocker: ResyncBlocker | null;
}

/** The one reason an attempt is not a success. */
export interface ResyncPostconditionError {
  readonly code: "POSTCONDITION_FAILED";
  readonly message: string;
  readonly recipeId: string;
}

/** A record that is there but cannot be believed — unreadable, not JSON, or not a resync record. */
export interface ResyncStateCorruptError {
  readonly code: "RESYNC_STATE_CORRUPT";
  readonly message: string;
  readonly path: string;
  readonly recipeId: string;
}

/** The resync state directory is there but cannot be listed, so no record in it can be read. */
export interface ResyncStateDirUnreadableError {
  readonly code: "RESYNC_STATE_DIR_UNREADABLE";
  readonly message: string;
  readonly stateDir: string;
}

/** Why the stored resync records cannot all be read. */
export type ResyncStateReadError = ResyncStateCorruptError | ResyncStateDirUnreadableError;

/**
 * Construct one {@link ResyncPostconditionError} or {@link ResyncStateReadError}. A test builds its fixtures through this, never a
 * hand-built literal, so a factory that stops matching its own type is caught by the test that uses it.
 *
 * @internal
 */
export const ResyncErrors = {
  postconditionFailed: ({
    recipeId,
    message,
  }: {
    readonly recipeId: string;
    readonly message: string;
  }): ResyncPostconditionError => ({
    code: "POSTCONDITION_FAILED",
    message,
    recipeId,
  }),
  stateCorrupt: ({
    recipeId,
    path,
    detail,
  }: {
    readonly recipeId: string;
    readonly path: string;
    readonly detail: string;
  }): ResyncStateCorruptError => ({
    code: "RESYNC_STATE_CORRUPT",
    message:
      `the resync record for ${recipeId} at ${path} is there but cannot be trusted (${detail}) — delete that ` +
      "file to start the target's history over; its last success is lost either way",
    path,
    recipeId,
  }),
  stateDirUnreadable: ({
    stateDir,
    detail,
  }: {
    readonly stateDir: string;
    readonly detail: string;
  }): ResyncStateDirUnreadableError => ({
    code: "RESYNC_STATE_DIR_UNREADABLE",
    message:
      `the resync state directory ${stateDir} is there but cannot be listed (${detail}) — restore its permissions or ` +
      "the target of its link so its records read again; moving it aside starts every target's history over",
    stateDir,
  }),
} as const;

/**
 * Whether one attempt on a target counts as a success.
 *
 * @param target what was resynced, which decides which postcondition applies
 * @param recipeId the row being judged, so a refusal names itself
 * @param exitCode what the last step exited with
 * @param beforeClock the target's clock before the attempt
 * @param afterClock the target's clock after it
 * @param walkStops every browser leg a step left stopped part way, in the words the transport used
 * @returns nothing on success, or the one reason this attempt did not work
 */
export function judgeResyncAttempt({
  target,
  recipeId,
  exitCode,
  beforeClock,
  afterClock,
  walkStops,
}: {
  readonly target: ResyncTarget;
  readonly recipeId: string;
  readonly exitCode: number;
  readonly beforeClock: string | null;
  readonly afterClock: string | null;
  readonly walkStops: readonly string[];
}): Result<null, ResyncPostconditionError> {
  if (walkStops.length > 0) {
    return err(
      ResyncErrors.postconditionFailed({
        message:
          `exited ${String(exitCode)} with its browser walk stopped part way, so every page after the stop ` +
          "went unread whatever the clock says — a partial walk is not a resync, and the slot stays due",
        recipeId,
      }),
    );
  }
  const quietCorpusWindow = target.kind === "corpus" && exitCode === EXIT_EXPECTED_EMPTY;
  if (exitCode !== 0 && !quietCorpusWindow) {
    return err(
      ResyncErrors.postconditionFailed({
        message: `exited ${String(exitCode)}`,
        recipeId,
      }),
    );
  }
  if (target.kind === "corpus") {
    return judgeCorpusClock({ afterClock, recipeId, source: target.source });
  }
  return judgeAtlasClock({ afterClock, beforeClock, recipeId });
}

/** The store's newest row is what a reader answers from, so an absent one fails whatever the exit code said. */
function judgeCorpusClock({
  afterClock,
  recipeId,
  source,
}: {
  readonly afterClock: string | null;
  readonly recipeId: string;
  readonly source: string;
}): Result<null, ResyncPostconditionError> {
  if (afterClock === null) {
    return err(
      ResyncErrors.postconditionFailed({
        message:
          `exited 0 and the store holds no ${source} row at all, so whatever the refresh wrote reached ` +
          "bronze and never the store — or the store could not be opened to check",
        recipeId,
      }),
    );
  }
  return ok(null);
}

/** An atlas's generation clock is its proof, so it has to be there and it has to have moved. */
function judgeAtlasClock({
  afterClock,
  beforeClock,
  recipeId,
}: {
  readonly afterClock: string | null;
  readonly beforeClock: string | null;
  readonly recipeId: string;
}): Result<null, ResyncPostconditionError> {
  if (afterClock === null) {
    return err(
      ResyncErrors.postconditionFailed({
        message: "exited 0 and published no generation at all, so there is nothing fresher to read",
        recipeId,
      }),
    );
  }
  if (beforeClock !== null && afterClock <= beforeClock) {
    return err(
      ResyncErrors.postconditionFailed({
        message:
          `exited 0 and left its generation clock at ${afterClock} — a resync that publishes nothing new ` +
          "is a resync that did not happen, whatever it exited with",
        recipeId,
      }),
    );
  }
  return ok(null);
}

/**
 * The exit code one recorded attempt answers its caller with — the one word the slot ledger reads.
 *
 * A stop that is not the recipe's failure answers `EXIT_DEFERRED`, so `cli/commands/automation/slotSettle.ts`
 * gives the attempt BACK — no retry floor, no failure hold, no finding — rather than cooling the slot for a
 * quarter of its period. Three stops are that, and only three:
 *
 * - a COLLISION — another live walk held the owner's Chrome, so the same walk is correct the moment it finishes, and
 *   the next pass runs it then. MEASURED: `resync-atlas-hex` cooled 42 hours behind one.
 * - a SIGN-IN WALL — the step is the owner's, and `cli/commands/automation/seatRefusals.ts` keeps the row unseated
 *   until their `mon-signin-*` card is settled, then seats it at once. MEASURED: `resync-atlas-xero`
 *   cooled for most of a day after the owner had already signed in.
 * - a DEFERRED STEP — the step itself exited `EXIT_DEFERRED`. MEASURED: `resync-corpus-slack`'s
 *   scheduled firing met another process's slack refresh holding the slot, `refresh` exited 1, and the row was
 *   held and carded although the source was being refreshed at that very moment.
 *
 * Deferring needs the record WRITTEN: the sign-in wait reads the wall off it, so a stop nothing recorded is a
 * failure like any other. Every other failure keeps `EXIT_ERROR`, and with it the cooling and the hold. PURE.
 *
 * @param attempt the attempt just judged
 * @param recorded whether the attempt reached the target's resync record
 * @returns the exit code the verb answers with
 */
export function resyncExitCode({
  attempt,
  recorded,
}: {
  readonly attempt: Pick<ResyncAttempt, "outcome" | "signInWall" | "relayCollision" | "stepDeferred">;
  readonly recorded: boolean;
}): number {
  if (!recorded) {
    return EXIT_ERROR;
  }
  if (attempt.outcome === "succeeded") {
    return EXIT_OK;
  }
  const notTheRecipe =
    attempt.signInWall !== undefined || attempt.relayCollision !== undefined || attempt.stepDeferred !== undefined;
  if (notTheRecipe) {
    return EXIT_DEFERRED;
  }
  return EXIT_ERROR;
}

/** The blocker this attempt found, else the one already standing, else none. */
function standingBlocker({
  blocker,
  previous,
}: {
  readonly blocker: ResyncBlocker | null;
  readonly previous: ResyncState | null;
}): ResyncBlocker | null {
  if (blocker !== null) {
    return blocker;
  }
  return previous === null ? null : previous.blocker;
}

/**
 * The state one attempt leaves behind, given what was there before.
 *
 * A failure never erases the last success: what a reader needs to know about a target that has been
 * failing for a week is exactly when it last worked, and overwriting that with `null` destroys the one
 * number that says how bad it is.
 *
 * A success is stamped at the instant its target certified it current as of, when the target certifies one, and
 * never later than the attempt finished: a 3 from a day-old ChatGPT export is a success as of that export, not as of
 * the pass that observed it, or the freshness page would read current for up to a second window.
 *
 * @param previous what was remembered before this attempt, or `null` for a target never attempted
 * @param attempt the attempt just finished
 * @param blocker what a human must clear, when this attempt found one; `null` leaves any standing blocker in place
 * @returns the state to persist
 */
export function nextResyncState({
  previous,
  attempt,
  blocker,
}: {
  readonly previous: ResyncState | null;
  readonly attempt: ResyncAttempt;
  readonly blocker: ResyncBlocker | null;
}): ResyncState {
  if (attempt.outcome === "succeeded") {
    const certified = attempt.asOfIso !== undefined && attempt.asOfIso < attempt.finishedAtIso;
    return {
      blocker: null,
      lastAttempt: attempt,
      lastSuccessAtIso: certified ? attempt.asOfIso : attempt.finishedAtIso,
      recipeId: attempt.recipeId,
    };
  }
  return {
    blocker: standingBlocker({ blocker, previous }),
    lastAttempt: attempt,
    lastSuccessAtIso: previous === null ? null : previous.lastSuccessAtIso,
    recipeId: attempt.recipeId,
  };
}
