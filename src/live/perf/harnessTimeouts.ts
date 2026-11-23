/**
 * Hook calls the HARNESS's own declared timeout ended — which of them owe the tick an act, and which are a
 * reading for the fold. Pure: the census and the live seats in, lines out.
 *
 * ## Why this is split by the command's envelope mark
 *
 * A `hook_cancelled` record carries its `hooks.json` command verbatim (`../../transcripts/hookDuration.ts`
 * § Two endings), and the command alone says which of two shapes the timeout was:
 *
 * - **Enveloped** (`scripts/hook.sh` in it): the envelope armed and lost the race to the declared timeout —
 *   a starved machine or a regression to record. No seat act ends that, so it is FOLDED. It used to be a
 *   REACT line reading "never a seat to stop", which the sweep contract's act-on-every-REACT-line step
 *   (sweep-contract step 8b) had nothing to do with: four enveloped `handover-run.sh` calls carried that
 *   line pass to pass tick after tick, exiting 3 every tick.
 * - **No envelope**: the seat booted on a `hooks.json` older than the envelope, and a seat reads its hook
 *   config once, at boot. The act is restarting THAT seat, so it is a REACT line naming it and carrying
 *   `slopweaver cmux reseat <workspace>` — the verb that relaunches the same session with `--resume`.
 *   Plain, never `--force`: a historical timeout does not justify discarding a turn in flight, and the verb
 *   refuses a busy seat by itself. It also refuses the caller's own workspace, so the chair's own match is
 *   reseated from another seat.
 *
 * A REACT line needs a seat that is still RUNNING the frozen config, so the join to a live seat is exact on
 * the session id and never on the worktree, which a later seat may reuse. An unmatched seat — closed between
 * the `ps` read and the transcript walk — is folded: its frozen config no longer runs. `read.ts` only walks
 * live sessions' transcripts today, so that branch is the race, not the common case.
 *
 * ## The third mark, and why it never reacts
 *
 * `HookOverrunSeat.unboundedCommands` holds the DISTINCT non-empty commands, so a timeout whose record named
 * no command has no entry there; the census counts those separately as `unboundedUnrecorded`. An absent
 * command proves no old `hooks.json`, so it never reacts and is folded — on a seat that also ran a recorded
 * one too, which an empty-list test lost (the r1 review of this change, with a counterexample).
 */
import type { HookOverrunReading } from "../../transcripts/hookDuration.js";
import type { SeatPerf } from "./report.js";

/** The one entry point every `hooks.json` command runs through, as it appears in a recorded command. */
const ENVELOPE_PATH = "scripts/hook.sh";

/** One timed-out command as a reader sees it: the script it ran, and whether the envelope was in front. */
interface ClassifiedCommand {
  /** The command's last path segment — the `${PLUGIN_DATA…}` prefix is the same on every entry. */
  readonly tail: string;
  /** Whether the command ran through {@link ENVELOPE_PATH}. */
  readonly enveloped: boolean;
}

/** One census seat with its commands classified, and the live seat it joined, if any. */
interface TimeoutSeat {
  readonly sessionId: string;
  readonly cwd: string;
  /** At least one of this seat's harness timeouts recorded no command. */
  readonly unrecorded: boolean;
  readonly commands: readonly ClassifiedCommand[];
  /** The live `perf` seat with the same session id, or `undefined` when none is running it. */
  readonly live: SeatPerf | undefined;
}

/** The one assignment a `hooks.json` command may open with, ahead of its target — the gate's own pattern. */
const GIVE_UP_ASSIGNMENT = /^SLOPWEAVER_HOOK_GIVE_UP=[02]$/u;

/**
 * A recorded command's tail and envelope mark.
 *
 * The mark reads the command's TARGET — its first word that is not a give-up assignment as written, which is
 * what the shell runs — exactly as the `hook-bounded` gate does (`src/devLint/hookBounded.ts`'s `headOf`),
 * so a command that only MENTIONS
 * {@link ENVELOPE_PATH} as an argument is not enveloped. It is a suffix test, not path normalisation, on
 * purpose: that gate refuses any entry whose target does not end in the literal path, so an equivalent
 * spelling such as `scripts/./hook.sh` cannot ship. A pre-envelope `hooks.json` carries no such path at all.
 */
function classify({ command }: { command: string }): ClassifiedCommand {
  const trimmed = command.replaceAll('"', "").trim();
  const lastSlash = trimmed.lastIndexOf("/");
  const tail = lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1);
  // The assignment is tested on the word as written, quotes intact, and only then is the target unquoted:
  // a quoted `"SLOPWEAVER_HOOK_GIVE_UP=2"` is the shell's command word, never an assignment.
  const target = command
    .trim()
    .split(/\s+/u)
    .find((word) => !GIVE_UP_ASSIGNMENT.test(word))
    ?.replaceAll('"', "");
  return { enveloped: target?.endsWith(ENVELOPE_PATH) === true, tail };
}

/** Every census seat a harness timeout landed on, classified and joined to the live seats on session id. */
function timeoutSeats({
  hookOverruns,
  seats,
}: {
  hookOverruns: HookOverrunReading | undefined;
  seats: readonly SeatPerf[];
}): readonly TimeoutSeat[] {
  if (hookOverruns === undefined) {
    return [];
  }
  return hookOverruns.seats
    .filter((seat) => seat.unbounded > 0)
    .map((seat) => ({
      commands: seat.unboundedCommands.map((command) => classify({ command })),
      cwd: seat.cwd,
      // An empty session id joins nothing: the worktree is never a substitute, because a later seat reuses it.
      live: seat.sessionId === "" ? undefined : seats.find((row) => row.sessionId === seat.sessionId),
      sessionId: seat.sessionId,
      unrecorded: seat.unboundedUnrecorded > 0,
    }));
}

/** Distinct tails, sorted, as one clause. */
function tailList({ commands }: { commands: readonly ClassifiedCommand[] }): string {
  return [...new Set(commands.map((command) => command.tail))].toSorted().join(", ");
}

/** How a reader reaches a live seat's reseat: its workspace, or where to find that workspace. */
function reseatClause({ seat }: { seat: TimeoutSeat & { live: SeatPerf } }): string {
  const workspace = seat.live.workspaceId;
  // An empty id is no address: `cmux reseat ` with nothing after it is not a command anyone can run.
  if (workspace !== undefined && workspace !== "") {
    return `reseat it so it re-reads hooks.json: \`slopweaver cmux reseat ${workspace}\``;
  }
  return (
    `the hook stream never named its workspace, so find it by its worktree ${seat.cwd} in ` +
    `\`slopweaver cmux list\`, then \`slopweaver cmux reseat <workspace>\` so it re-reads hooks.json`
  );
}

/**
 * The REACT lines harness timeouts owe this tick: one per LIVE seat that ran a command with no envelope in
 * front of it, naming the seat and the reseat that ends it. Enveloped, unrecorded and closed-seat timeouts
 * owe nothing here — {@link harnessTimeoutFoldLines} carries them.
 *
 * @param hookOverruns the transcript census, or `undefined` when none could be read
 * @param seats the live seats `ps` attributed, to join on session id
 * @returns the lines, empty when no live seat is running a pre-envelope `hooks.json`
 */
export function harnessTimeoutReactLines({
  hookOverruns,
  seats,
}: {
  hookOverruns: HookOverrunReading | undefined;
  seats: readonly SeatPerf[];
}): readonly string[] {
  const lines: string[] = [];
  for (const seat of timeoutSeats({ hookOverruns, seats })) {
    const bare = seat.commands.filter((command) => !command.enveloped);
    const live = seat.live;
    if (bare.length === 0 || live === undefined) {
      continue;
    }
    lines.push(
      `REACT — seat ${seat.sessionId} booted on a hooks.json older than the envelope (\`${ENVELOPE_PATH}\`), ` +
        `so the harness's own declared timeout ended ${tailList({ commands: bare })} (no envelope): ` +
        `${reseatClause({ seat: { ...seat, live } })}. A busy seat refuses until its turn ends, and your own ` +
        `seat is reseated from another one`,
    );
  }
  return lines;
}

/** Who a folded seat is: its session id, or its worktree when the records named no session. */
function who({ seat }: { seat: TimeoutSeat }): string {
  return seat.sessionId === "" ? seat.cwd : seat.sessionId;
}

/**
 * The fold lines for harness timeouts that owe no act: the enveloped ones, which are the envelope losing the
 * race, and the no-envelope or unrecorded ones on a seat that is not running (or not known to run) a frozen
 * config. At most two lines, absent entirely when there is nothing of either.
 *
 * @param hookOverruns the transcript census, or `undefined` when none could be read
 * @param seats the live seats `ps` attributed, to join on session id
 * @returns the fold lines, indented like the seat rows they follow
 */
export function harnessTimeoutFoldLines({
  hookOverruns,
  seats,
}: {
  hookOverruns: HookOverrunReading | undefined;
  seats: readonly SeatPerf[];
}): readonly string[] {
  const all = timeoutSeats({ hookOverruns, seats });
  const lines: string[] = [];
  const enveloped = all.flatMap((seat) => seat.commands.filter((command) => command.enveloped));
  if (enveloped.length > 0) {
    lines.push(
      `  harness timeout, enveloped: ${tailList({ commands: enveloped })} — the envelope armed and lost the ` +
        `race to the declared timeout: a starved machine or a regression to record, never a seat to stop`,
    );
  }
  const inert: string[] = [];
  for (const seat of all) {
    if (seat.unrecorded) {
      inert.push(`${who({ seat })} (command not recorded)`);
    }
    const bare = seat.commands.filter((command) => !command.enveloped);
    if (bare.length > 0 && seat.live === undefined) {
      inert.push(`${who({ seat })} ${tailList({ commands: bare })} (no envelope, seat not running)`);
    }
  }
  if (inert.length > 0) {
    lines.push(
      `  harness timeout, nothing to reseat: ${inert.join("; ")} — a seat that is not running has no frozen ` +
        `hooks.json left to restart, and an unrecorded command proves no old one`,
    );
  }
  return lines;
}
