/**
 * The pure half of `slopweaver supervisor tick-capture`: the fixed list of readings a sweep tick takes, the
 * file each one lands in, and the `supervisor tick-draft` flags those files become.
 *
 * It replaces `tick.sh`, a script every supervisor seat copied from its predecessor and edited by `sed` —
 * 808 copies in one chair's scratch alone. Count the carry again with
 * `find ~/.slopweaver/supervisor-scratch -name 'tick*.sh' | wc -l`. The list below is that script's, reading
 * for reading; what changes is that a reading's stdout and stderr land in separate files, so a JSON document
 * is only ever JSON, and that the draft flags are derived from `tick-draft`'s own source table instead of
 * typed per tick.
 *
 * No I/O, no clock.
 */
import { DRAFTED_SOURCE_KINDS, DRAFTED_SOURCES, type DraftedSourceKind } from "../tickDraftShapes.js";
import { type ChildOutcome, describeChildOutcome } from "./childOutcome.js";
import { FLEET_READINGS } from "./fleetReadings.js";

/** The idle threshold every sweep has read `session watch` at since the sweep contract named it. */
const WATCH_IDLE_MINUTES = "10";

/**
 * The budget one reading gets before it is killed and named `timed-out`. A BUDGET, not a measurement: the
 * measurement is each reading's own `durationMs` in `capture.json` —
 * `jq -r '.readings[] | [.name, .child.kind, .child.durationMs] | @tsv' <scratch>/tick-<n>/capture.json`. It is
 * generous on purpose, because a reading killed early is a reading lost; what it removes is the unbounded
 * wait, never the slow one.
 */
export const READING_TIMEOUT_MS = 120_000;

/**
 * The landing reading's budget. It is the one reading that presses, registers and reads two repositories'
 * pull requests over the network, so it gets the longest leash.
 */
export const LANDING_TIMEOUT_MS = 300_000;

/**
 * The `handover wake` reading's budget: at most three sequential `cmux spawn` children at five minutes each, each
 * after one thirty-second re-read of its pull request (`WAKE_BOOT_SHARE`, `WAKE_SPAWN_TIMEOUT_MS`,
 * `WAKE_CHECKS_READ_TIMEOUT_MS`), at most six `handover finish` children at one minute each, each after at most one
 * thirty-second head read and one ten-second worktree branch read for the reconcile of an ended pull request
 * (`WAKE_FINISH_ASKS`, `WAKE_FINISH_TIMEOUT_MS`, `WAKE_CHECKS_READ_TIMEOUT_MS`, `WAKE_BRANCH_READ_TIMEOUT_MS`), the
 * judging pass — no checks read starts after two minutes and each is cut at thirty seconds
 * (`WAKE_JUDGE_DEADLINE_MS`, `WAKE_CHECKS_READ_TIMEOUT_MS`), the question pass — no journal is read after two
 * minutes, and the one batch that may settle past that is one thirty-second head read, one sixty-second
 * `handover finish --dry-run --beside-question` child (the batch's run at once), plus, per row, a ten-second branch
 * read and two ten-second worktree commit reads (before the finish ask and again under the claim), all synchronous
 * and so serial (`WAKE_QUESTION_DEADLINE_MS`, `WAKE_CHECKS_READ_TIMEOUT_MS`, `WAKE_FINISH_TIMEOUT_MS`,
 * `QUESTION_READ_CONCURRENCY`, `WAKE_BRANCH_READ_TIMEOUT_MS`) — plus two minutes for the board scan. A budget derived from the wake's own constants, not a measurement; spelled as literals because this
 * module is pure and those live beside I/O, and `unit/supervisor/scratch/wakeReadingBudget.test.ts` fails if they part.
 */
export const WAKE_READING_TIMEOUT_MS =
  3 * (300_000 + 30_000) +
  6 * (60_000 + 30_000 + 10_000) +
  (120_000 + 30_000) +
  (120_000 + 30_000 + 60_000 + 6 * (10_000 + 10_000 + 10_000)) +
  120_000;

/** One reading a tick takes. */
export interface TickReading {
  /** The reading's name — also its file's stem. */
  readonly name: string;
  /** The `slopweaver` argv, without the binary. */
  readonly argv: readonly string[];
  /** Whether stdout is one JSON document or text for a human. */
  readonly format: "json" | "text";
  /** The `tick-draft` source this reading feeds, when it feeds one. */
  readonly draftSource?: DraftedSourceKind;
  /**
   * Exit codes that still mean the verb printed its whole document — `0` when absent. A diagnostic verb
   * signals its FINDING in the exit code and prints the full report regardless: `handover reconcile` and
   * `machine capacity` exit 1 on a finding or a HOLD, `session close-done` 1 when a close failed, `listen
   * status` 3 when the listener is down or stale, `reflect friction-review` 3 on a gap. Each was read at its
   * verb's return site, and a live capture dropped reconcile and capacity until they were
   * listed here — which is exactly the reading a tick needs most. Their error paths print nothing to stdout,
   * so a zero-byte file still keeps them out of the draft.
   */
  readonly completedExits?: readonly number[];
  /** Its budget, in milliseconds — {@link READING_TIMEOUT_MS} when absent. */
  readonly timeoutMs?: number;
  /**
   * The readings-ledger producer it files under, when its verb words alone ({@link readingProducer}) would be
   * another reading's too — two `monitor check --only <monitor>` readings in one tick. Absent means the verb words.
   */
  readonly producer?: string;
  /**
   * Whether a completed exit that printed NOTHING is a failed reading, taken once more before the tick moves on.
   * Only a verb that always prints on success may say so: `session watch` once exited 0 with zero bytes on four of
   * five ticks of one chair (`../../cmux/resumingDrain.ts`), and tick close then refused every one of them.
   */
  readonly retryWhenEmpty?: boolean;
  /**
   * `false` keeps a complete JSON reading OUT of the readings ledger, which every console page reads as the whole
   * picture under its producer — absent means it is appended. The drafts read is a slice that files under the same
   * `github landing` producer as the press read, so ledgered it became the console's latest landing reading:
   * MEASURED: a tick recorded a `github-landing` ledger entry from `landing-drafts` (repro: `slopweaver reading
   * list`, then that tick's `capture.json`).
   */
  readonly ledgered?: false;
}

/**
 * Whether a reading ran to completion — its exit code is one its verb uses for a whole document.
 *
 * @param exitCode what the child exited, or null when it never reached an exit code
 * @returns true when the reading's stdout is the verb's complete answer
 */
export function isCompletedExit({ reading, exitCode }: { reading: TickReading; exitCode: number | null }): boolean {
  if (exitCode === null) {
    return false;
  }
  if (reading.completedExits === undefined) {
    return exitCode === 0;
  }
  return reading.completedExits.includes(exitCode);
}

/**
 * Whether a reading that must always print exited as if complete and printed nothing — a FAILED reading, which
 * the capture takes once more and, empty again, leaves out of the draft and the ledger.
 *
 * @param exitCode what the child exited, or null when it never reached an exit code
 * @param bytes the size of what it printed on stdout
 * @returns true when the reading is declared {@link TickReading.retryWhenEmpty} and came back empty
 */
export function isFailedEmptyReading({
  reading,
  exitCode,
  bytes,
}: {
  reading: TickReading;
  exitCode: number | null;
  bytes: number;
}): boolean {
  return reading.retryWhenEmpty === true && bytes === 0 && isCompletedExit({ exitCode, reading });
}

/**
 * The landing readings, when the seat names repositories for them: the press read, which presses and registers
 * on its own cadence, and the drafts read, which boards every draft of the owner's nobody holds.
 *
 * Two readings rather than drafts on the press read, so the press read is untouched by how many drafts the owner has
 * and the drafts read fails on its own (`../../cli/commands/github/landingDraftsOnly.ts`). MEASURED:
 * four of the owner's drafts sat red for days with the `hygiene-sweep` row meant to read them absent from the store.
 *
 * @param landingRepos the `owner/name` repositories `github landing` reads; none leaves both readings out
 * @returns zero or two readings
 */
function landingReadings({ landingRepos }: { landingRepos: readonly string[] }): readonly TickReading[] {
  if (landingRepos.length === 0) {
    return [];
  }
  const selection = ["github", "landing", "--repo", landingRepos.join(","), "--author", "@me"];
  return [
    {
      argv: [...selection, "--if-due", "--press", "--register", "--json"],
      format: "json",
      name: LANDING_READING,
      timeoutMs: LANDING_TIMEOUT_MS,
    },
    {
      argv: [...selection, "--if-due", "--drafts-only", "--register", "--json"],
      format: "json",
      // A drafts slice is never the readings ledger's whole picture of the owner's pull requests (`landingDraftsOnly.ts`).
      ledgered: false,
      name: LANDING_DRAFTS_READING,
      timeoutMs: LANDING_TIMEOUT_MS,
    },
  ];
}

/** The press read's reading name, which the digest and the derived acts find it by. */
export const LANDING_READING = "landing";

/** The drafts read's reading name — the press read's sibling, digested and derived the same way. */
export const LANDING_DRAFTS_READING = "landing-drafts";

/** The prefix every bump-drive reading's name carries, which the digest finds them by. */
export const BUMP_DRIVE_READING_PREFIX = "bump-drive-";

/**
 * The reading name one repository's bump drive files under — its slug with the separator flattened, so it
 * names one file.
 *
 * @param repo the `owner/name` slug
 * @returns the reading name
 */
function bumpDriveReadingName({ repo }: { repo: string }): string {
  return `${BUMP_DRIVE_READING_PREFIX}${repo.replaceAll("/", "-")}`;
}

/**
 * One `github bump-drive` reading per repository the tick drives bumps on (`./bumpDriveCover.ts` decides which).
 *
 * One per repository rather than one naming them all, because the drive's caps are per PASS and the standing rows
 * are one per repository for exactly that reason: a single pass would make the two backlogs compete. Each files
 * under its own producer, so two in one tick are two ledger rows rather than one overwriting the other.
 *
 * @param repos the `owner/name` repositories to drive, in order
 * @returns one reading per repository
 */
function bumpDriveReadings({ repos }: { repos: readonly string[] }): readonly TickReading[] {
  return repos.map((repo) => ({
    argv: ["github", "bump-drive", "--repo", repo, "--json"],
    format: "json",
    name: bumpDriveReadingName({ repo }),
    producer: `github bump-drive ${repo}`,
    timeoutMs: LANDING_TIMEOUT_MS,
  }));
}

/**
 * Every reading a sweep tick takes, in the order they run.
 *
 * The order is the script's: `events tail` first so the cursor advances before anything the tick acts on,
 * and `github hold --status` last.
 *
 * @param loopSessionKey the bot loop's session key, which `session depth` and `session standing` read
 * @param landingRepos the `owner/name` repositories `github landing` reads, pressing and registering on its own
 *   cadence; none leaves the landing reading out, as `tick-capture` always has
 * @param bumpDriveRepos the repositories whose dependency bumps this tick drives itself, after the landing read
 * @returns the readings
 */
export function tickReadings({
  loopSessionKey,
  landingRepos = [],
  bumpDriveRepos = [],
}: {
  loopSessionKey: string;
  landingRepos?: readonly string[];
  bumpDriveRepos?: readonly string[];
}): readonly TickReading[] {
  return [
    // `events tail` exits 3 when it FOUND an alert or a gap (`../../cli/commands/events/tail.ts`); counting that as a
    // failed reading hid every alert from the digest exactly when there was one.
    { argv: ["events", "tail", "--cursor", "supervisor"], completedExits: [0, 3], format: "text", name: "events" },
    { argv: ["cmux", "list", "--json"], format: "json", name: "cmux" },
    {
      argv: ["session", "close-done", "--json"],
      completedExits: [0, 1],
      draftSource: "closeDone",
      format: "json",
      name: "close-done",
    },
    // Right after close-done, so a seat that parked on a clock or CI comes back into the room it freed: one
    // `cmux spawn` per due wake, longest-due first, at most the boot window's wake share, each on its own five-minute
    // budget, and a merged park's finish asked before its boot (`handover wake`). Exit 1 is a failed row with the
    // whole report printed, 3 is nothing due, 4 is the spawn backoff or the boot window deferring the reseats.
    // This is the tick's ONE wake: the chair never runs a second, only the `--retry <attemptNonce>` a deferred row
    // names, which waits for that row's `retryAfterIso` and judges that one park.
    {
      argv: ["handover", "wake", "--json"],
      completedExits: [0, 1, 3, 4],
      format: "json",
      name: "handover-wake",
      timeoutMs: WAKE_READING_TIMEOUT_MS,
    },
    {
      argv: ["session", "watch", "--idle-minutes", WATCH_IDLE_MINUTES],
      format: "text",
      name: "watch",
      retryWhenEmpty: true,
    },
    {
      argv: ["session", "watch", "--idle-minutes", WATCH_IDLE_MINUTES, "--json-report"],
      draftSource: "watch",
      format: "json",
      name: "watch-report",
      retryWhenEmpty: true,
    },
    { argv: ["session", "depth", "--loop-session-key", loopSessionKey, "--json"], format: "json", name: "depth" },
    {
      argv: ["session", "standing", "--loop-session-key", loopSessionKey, "--json"],
      format: "json",
      name: "standing",
    },
    ...FLEET_READINGS,
    ...landingReadings({ landingRepos }),
    ...bumpDriveReadings({ repos: bumpDriveRepos }),
  ];
}

/** What one reading left behind. */
export interface ReadingOutcome {
  readonly name: string;
  readonly argv: readonly string[];
  /** The stdout file, relative to the tick's directory. */
  readonly file: string;
  /** The stderr file, relative to the tick's directory. */
  readonly errFile: string;
  /** The child's exit code, or null when it never reached one — {@link ReadingOutcome.child} says why. */
  readonly exitCode: number | null;
  /** How the child ended, including a budget it overran and how long it took. */
  readonly child: ChildOutcome;
  /**
   * Whether that exit code means a whole document — see {@link isCompletedExit} — and, for a reading that must
   * always print, that it printed something ({@link isFailedEmptyReading}).
   */
  readonly completed: boolean;
  /** The stdout file's size. */
  readonly bytes: number;
  /** Present when the first attempt came back empty and this outcome is the second, the only one kept. */
  readonly retried?: true;
  /**
   * Present when the first attempt failed while a rebuild of the built tree crossed it and this outcome is the
   * second, taken on the fresh build — the only one kept ({@link ../../builtCli/builtState.ts}'s `rebuildCrossed`).
   */
  readonly retriedAfterRebuild?: true;
  /** How long the capture waited, on this reading's turn, for a rebuild in flight to land — absent when it did not. */
  readonly waitedForRebuildMs?: number;
  readonly draftSource?: DraftedSourceKind;
  /** The readings-ledger row this reading was appended as, when it was — a completed JSON document only. */
  readonly readingId?: string;
}

/** One tick's whole capture — the document `capture.json` holds and `--json` prints. */
export interface TickCapture {
  readonly tick: string;
  /** The tick's own directory, absolute. */
  readonly dir: string;
  readonly startedIso: string;
  readonly capturedIso: string;
  readonly readings: readonly ReadingOutcome[];
  /** The `supervisor tick-draft` flags these files supply, with absolute paths. */
  readonly tickDraftArgs: readonly string[];
  /**
   * The reading on whose turn a wait for a rebuild ran out with no fresh build — present only then. Every later
   * reading ran without waiting, so one rebuild that never lands costs a capture one bounded wait, never one per
   * reading.
   */
  readonly rebuildGaveUpAt?: string;
}

/**
 * The files one reading writes.
 *
 * @returns its stdout and stderr file names
 */
export function readingFiles({ reading }: { reading: TickReading }): { file: string; errFile: string } {
  const extension = reading.format === "json" ? "json" : "txt";
  return { errFile: `${reading.name}.err`, file: `${reading.name}.${extension}` };
}

/**
 * A tick label that names one directory and nothing else — no separator, no `..`, no leading dot.
 *
 * @param tick the label the caller passed
 * @returns whether it is safe to join under the scratch directory
 */
export function isTickLabel({ tick }: { tick: string }): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(tick);
}

/**
 * The `supervisor tick-draft` flags a capture supplies.
 *
 * A reading feeds a flag only when it completed and wrote something: anything else is left OUT, so tick-draft
 * records that source `unavailable` naming its flag — the honest reading — rather than refusing the whole
 * draft over a document that was never JSON.
 *
 * @param dir the tick's directory, absolute
 * @param startedIso when the first reading began
 * @param capturedIso when the last reading ended
 * @param readings what each reading left
 * @returns the flag tail, in `tick-draft`'s own source order
 */
export function tickDraftArgs({
  dir,
  startedIso,
  capturedIso,
  readings,
}: {
  dir: string;
  startedIso: string;
  capturedIso: string;
  readings: readonly ReadingOutcome[];
}): readonly string[] {
  const args = ["--started", startedIso, "--captured", capturedIso];
  for (const kind of DRAFTED_SOURCE_KINDS) {
    const reading = readings.find((candidate) => candidate.draftSource === kind);
    if (reading?.completed === true && reading.bytes > 0) {
      args.push(`--${DRAFTED_SOURCES[kind].flag}`, `${dir}/${reading.file}`);
    }
  }
  return args;
}

/**
 * The verb words of a reading's argv — everything before its first flag — which is the producer name the
 * readings ledger files it under: `claude gauge --json` is a reading of `claude gauge`.
 *
 * @returns the producer name
 */
export function readingProducer({ argv }: { argv: readonly string[] }): string {
  const firstFlag = argv.findIndex((token) => token.startsWith("--"));
  return (firstFlag === -1 ? argv : argv.slice(0, firstFlag)).join(" ");
}

/**
 * The producer one tick reading files under: its declared {@link TickReading.producer}, else its verb words.
 *
 * @returns the producer name
 */
export function tickReadingProducer({ reading }: { reading: TickReading }): string {
  if (reading.producer !== undefined) {
    return reading.producer;
  }
  return readingProducer({ argv: reading.argv });
}

/**
 * What a rebuild of the built tree did to a capture: how long it was waited out, which readings were taken again on
 * the fresh build, and where a wait ran out — nothing at all when no rebuild crossed the capture.
 *
 * @returns the indented lines, empty when no rebuild was met
 */
function rebuildLines({ capture }: { capture: TickCapture }): readonly string[] {
  const lines: string[] = [];
  const waitedMs = capture.readings
    .flatMap((reading) => (reading.waitedForRebuildMs === undefined ? [] : [reading.waitedForRebuildMs]))
    .reduce((sum, ms) => sum + ms, 0);
  if (waitedMs > 0) {
    lines.push(`  waited ${String(Math.round(waitedMs / 1000))}s for a rebuild of the built CLI to land`);
  }
  const retaken = capture.readings.filter((reading) => reading.retriedAfterRebuild === true);
  if (retaken.length > 0) {
    lines.push(`  taken again on the fresh build: ${retaken.map((reading) => reading.name).join(", ")}`);
  }
  if (capture.rebuildGaveUpAt !== undefined) {
    lines.push(
      `  no fresh build landed within the wait on ${capture.rebuildGaveUpAt}'s turn; later readings did not wait — open the next tick once \`slopweaver dev build\` has run`,
    );
  }
  return lines;
}

/**
 * The lines `supervisor tick open` opens on: which tick, how many of its readings completed and the window they ran
 * in, then what a rebuild of the built CLI did to the capture ({@link rebuildLines}).
 *
 * @returns the lines, the headline first
 */
export function openHeadLines({ capture }: { capture: TickCapture }): readonly string[] {
  const completed = capture.readings.filter((reading) => reading.completed).length;
  return [
    `supervisor tick open: tick ${capture.tick} — ${String(completed)} of ${String(capture.readings.length)} readings completed, ${capture.startedIso} → ${capture.capturedIso}`,
    ...rebuildLines({ capture }),
  ];
}

/**
 * The human summary of a capture: one line per reading that did not come back clean, then the totals and
 * the tick-draft tail.
 *
 * @returns the lines to print
 */
export function captureSummaryLines({ capture }: { capture: TickCapture }): readonly string[] {
  const failed = capture.readings.filter((reading) => !reading.completed);
  const lines = failed.map((reading) => {
    const ending = describeChildOutcome({ outcome: reading.child });
    const empty = reading.retried === true && reading.bytes === 0 ? `${ending} with nothing on stdout, twice` : ending;
    return `  ${reading.name}: ${empty} — see ${capture.dir}/${reading.errFile}`;
  });
  const recovered = capture.readings.filter((reading) => reading.retried === true && reading.completed);
  if (recovered.length > 0) {
    lines.push(`  retried once after an empty first attempt: ${recovered.map((reading) => reading.name).join(", ")}`);
  }
  lines.push(...rebuildLines({ capture }));
  const fed = capture.readings.filter((reading) => reading.draftSource !== undefined).length;
  const supplied = (capture.tickDraftArgs.length - 4) / 2;
  const recorded = capture.readings.filter((reading) => reading.readingId !== undefined).length;
  return [
    `supervisor tick-capture: tick ${capture.tick} — ${String(capture.readings.length - failed.length)} of ` +
      `${String(capture.readings.length)} readings completed, ${String(supplied)} of ${String(fed)} tick-draft ` +
      `sources supplied, ${capture.startedIso} → ${capture.capturedIso}`,
    ...lines,
    `  ${String(recorded)} readings appended to the readings ledger as tick-${capture.tick}`,
    `  wrote ${capture.dir}/capture.json`,
    `  tick-draft flags: ${capture.tickDraftArgs.join(" ")}`,
  ];
}
