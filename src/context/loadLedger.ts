/**
 * Whether each session actually received the owner's profile — one row per load attempt, and the fold that turns those
 * rows and a seat's own boot records into one verdict per session.
 *
 * ## Why this exists
 *
 * A session acts as the owner only if it can load their profile, so a seat whose profile load failed silently
 * must fail loudly and reach the owner's attention at once: a fleet no longer operating in alignment with the
 * owner is unacceptable.
 *
 * The load itself (`./load.ts`) fails OPEN by design and only ever injects text, so until this file nothing outside
 * the session could tell a seat that read the owner's profile from one that did not. MEASURED after the mirror race
 * was fixed: `slopweaver transcripts boot-hooks --since <iso>` still found `profile-context`
 * recorded as never run in 4 of 191 transcripts, every one a seat booted on a worktree checked out before that fix.
 *
 * ## Two sources, and why both
 *
 * - **The ledger** (`$SLOPWEAVER_HOME/profile/loads.jsonl`): `profile hook` writes a row for every load it ATTEMPTS,
 *   and `profile context` one for a session reading it by hand. A load that ran and found no profile anywhere
 *   (`origin: none`) is a failure only the hook can see.
 * - **The seat's own transcript** (`./loadTranscript.ts`): a hook that never RAN, or ran and was killed, writes no
 *   row, so its failure is read off the record Claude Code kept of the run. That is the stale-worktree case above,
 *   and it is the one no fix to the current hook can reach.
 *
 * ## The verdict is the LATEST observation, and absence is not a failure
 *
 * A session that failed at boot and then read its profile by hand is loaded; one that loaded at boot and lost it to
 * a failed reload is not. So each session's newest observation decides. A session with NO observation is
 * `unobserved`, never `unloaded`: every failure this file can name leaves a positive record, so treating silence as
 * failure would refuse every test fixture and every seat booted before the ledger existed while proving nothing.
 *
 * Pure: values in, values out.
 */

import { isRecord } from "../lib/parsers.js";

import type { ContextOrigin } from "./cachedContext.js";

/** What a session runs to read the owner's profile in by hand — and so what every refusal over a failed load names. */
export const PROFILE_RELOAD_COMMAND = "slopweaver profile context";

/** The first line of every block whose load found nothing — and so what a printed block carrying it says. */
export const UNLOADED_HEADLINE = "# STOP — the owner's profile did NOT load into this session";

/**
 * The lines a session reads when the owner's profile did not reach it, placed ABOVE whatever the load did print so they
 * are the first thing in the injected block rather than a footnote under an empty one.
 *
 * @param reason why the load found nothing
 * @returns the warning
 */
export function unloadedWarningLines({ reason }: { reason: string }): readonly string[] {
  return [
    UNLOADED_HEADLINE,
    "",
    `Why: ${reason.length > 0 ? reason : "no reason was recorded"}.`,
    "",
    "You can only act as the owner if you have their profile. Until it loads, do not send, post, comment, merge or draft",
    `anything in the owner's name or the bot's: run \`${PROFILE_RELOAD_COMMAND}\` and read what it prints. Every guarded tool`,
    "call from this session is held until that succeeds, and that command is the one call let through. Recovering is",
    "this session's own job: the owner is told it is in flight, and is never asked to do anything.",
    "",
  ];
}

/**
 * What a never-configured machine is told in place of the `# STOP` block: nothing is held, and how to begin. With no
 * profile yet there is nothing to hold, and onboarding must never trap anyone.
 */
export const FIRST_BOOT_LINES: readonly string[] = [
  "# FIRST BOOT — the owner's profile has never been written, cached or loaded on this machine",
  "",
  "There is no profile to load yet, so nothing waits on one: tool calls and the door's writes run. Onboarding builds",
  "the first profile: bring the store up with `yarn store:start` (the checkout's pinned Supabase CLI, which locks the",
  "stack and selects it), create its schema with `slopweaver store push`, and `/slopweaver:onboard` walks",
  "the rest. Once `slopweaver profile set` writes the owner's profile, this session is held until `slopweaver profile context`",
  "loads it.",
  "",
];

/**
 * The block a load prints: the owner's profile when it arrived, the first-boot lines on a machine never configured, and the
 * `# STOP` warning above whatever the load printed otherwise.
 *
 * @param loaded what the load produced
 * @param firstBoot whether no profile loaded on a machine with no surviving trace of one — nothing loaded, or a live read
 *   found no owner row
 * @returns the lines to print or inject
 */
export function profileBlockLines({
  loaded,
  firstBoot,
}: {
  loaded: { readonly origin: ContextOrigin; readonly reason: string; readonly lines: readonly string[] };
  firstBoot: boolean;
}): readonly string[] {
  if (firstBoot) {
    return FIRST_BOOT_LINES;
  }
  if (loaded.origin !== "none") {
    return loaded.lines;
  }
  return [...unloadedWarningLines({ reason: loaded.reason }), ...loaded.lines];
}

/** Who attempted a load: the session-start/compaction hook, or a session running `profile context` itself. */
type ProfileLoadSource = "hook" | "by-hand";

/** Whether the profile reached the session. */
export type ProfileLoadOutcome = "loaded" | "failed";

/** One attempted load, as the ledger stores it. */
export interface ProfileLoadRow {
  /** The Claude Code or Codex session the load was for. */
  readonly sessionId: string;
  /** When the load was attempted. */
  readonly atIso: string;
  readonly source: ProfileLoadSource;
  /**
   * The hook event it ran under, with the matcher that selected it as a transcript names it (`SessionStart:compact`,
   * `PostCompact`), or `by-hand`.
   */
  readonly event: string;
  /** Where the lines came from — `none` is the failure. */
  readonly origin: ContextOrigin;
  /** Why the live read did not happen, empty when it did. */
  readonly reason: string;
  /** The session's working directory, empty when the caller did not know it. */
  readonly cwd: string;
  /**
   * Set when a live read answered that the store holds no owner row. Such a row still records the session's load, but
   * it is no evidence a profile ever existed: counted as one, a hook that ran while another session's `profile set`
   * held its mark, and whose write then failed, left a fresh machine reading configured for good.
   */
  readonly ownerAbsent?: true;
}

/**
 * The `ownerAbsent` field a row carries for this load: present exactly when the load found no owner row.
 *
 * @param loaded what the load produced
 * @returns the field to spread into a row, empty when the load found one or read none
 */
export function ownerAbsentField({ loaded }: { loaded: { readonly ownerAbsent?: true } }): {
  readonly ownerAbsent?: true;
} {
  return loaded.ownerAbsent === true ? { ownerAbsent: true } : {};
}

/** One thing known about whether a session holds the owner's profile, from either source. */
export interface ProfileLoadObservation {
  readonly sessionId: string;
  readonly atIso: string;
  readonly outcome: ProfileLoadOutcome;
  /** What ran the load — a hook event with its matcher (`SessionStart:compact`), `by-hand`, or empty when unknown. */
  readonly event: string;
  /** What was observed, in a sentence a note can carry. */
  readonly why: string;
  /** The session's working directory, empty when unknown. */
  readonly cwd: string;
}

/** What one session's observations add up to. */
export type SessionLoadVerdict =
  | { readonly kind: "loaded"; readonly latest: ProfileLoadObservation }
  | { readonly kind: "unloaded"; readonly latest: ProfileLoadObservation }
  | { readonly kind: "unobserved" };

/**
 * Whether an origin delivered the owner's profile. A cached copy did — it is theirs, stamped with its age — and only `none`,
 * the block saying there is nothing, did not.
 *
 * @returns the outcome
 */
function outcomeOfOrigin({ origin }: { origin: ContextOrigin }): ProfileLoadOutcome {
  return origin === "none" ? "failed" : "loaded";
}

/** Every origin a row may carry, for the decoder. */
const ORIGINS: readonly ContextOrigin[] = ["live", "cache", "none"];

/** Every source a row may carry, for the decoder. */
const SOURCES: readonly ProfileLoadSource[] = ["hook", "by-hand"];

/**
 * A string field, or `undefined` when it is absent or not a string.
 *
 * @returns the value
 */
function text({ on, key }: { on: Record<string, unknown>; key: string }): string | undefined {
  const value = on[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Decode one ledger line's parsed value.
 *
 * @param value the parsed JSON
 * @returns the row, or `undefined` for anything that is not one — the reader counts those rather than dropping them
 */
export function decodeProfileLoadRow({ value }: { value: unknown }): ProfileLoadRow | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const sessionId = text({ key: "sessionId", on: value });
  const atIso = text({ key: "atIso", on: value });
  const source = SOURCES.find((candidate) => candidate === value["source"]);
  const origin = ORIGINS.find((candidate) => candidate === value["origin"]);
  const event = text({ key: "event", on: value });
  const reason = text({ key: "reason", on: value });
  const cwd = text({ key: "cwd", on: value });
  if (
    sessionId === undefined ||
    sessionId.length === 0 ||
    atIso === undefined ||
    Number.isNaN(Date.parse(atIso)) ||
    source === undefined ||
    origin === undefined ||
    event === undefined ||
    reason === undefined ||
    cwd === undefined
  ) {
    return undefined;
  }
  // Anything but a literal `true` is no claim of absence, so the row reads as a load that carried the owner's profile.
  return {
    atIso,
    cwd,
    event,
    origin,
    reason,
    sessionId,
    source,
    ...(value["ownerAbsent"] === true ? { ownerAbsent: true } : {}),
  };
}

/**
 * The rows a by-hand `profile context` records: one per id the calling session goes by, so a reload clears whichever
 * id a failure was recorded under.
 *
 * @param sessionIds every id the environment names for the caller — empty for a terminal, which records nothing
 * @param origin where the lines came from
 * @param reason why the live read did not happen
 * @param atIso when the load ran
 * @param cwd the caller's working directory
 * @param ownerAbsent true when the live read found no owner row in the store
 * @returns the rows
 */
export function byHandRows({
  sessionIds,
  origin,
  reason,
  atIso,
  cwd,
  ownerAbsent,
}: {
  sessionIds: readonly string[];
  origin: ContextOrigin;
  reason: string;
  atIso: string;
  cwd: string;
  ownerAbsent: boolean;
}): readonly ProfileLoadRow[] {
  return sessionIds.map((sessionId) => ({
    atIso,
    cwd,
    event: "by-hand",
    origin,
    reason,
    sessionId,
    source: "by-hand",
    ...(ownerAbsent ? { ownerAbsent: true } : {}),
  }));
}

/**
 * The observation one ledger row makes.
 *
 * @returns the observation
 */
export function observationOfRow({ row }: { row: ProfileLoadRow }): ProfileLoadObservation {
  const outcome = outcomeOfOrigin({ origin: row.origin });
  const how = row.source === "hook" ? `the ${row.event} profile hook` : "a by-hand `profile context`";
  const why =
    outcome === "loaded"
      ? `${how} loaded the owner's profile (${row.origin})`
      : `${how} found no profile to load: ${row.reason}`;
  return { atIso: row.atIso, cwd: row.cwd, event: row.event, outcome, sessionId: row.sessionId, why };
}

/**
 * Whether a run could have put anything into the session's context. A `PostCompact` run could not: Claude Code reads
 * no context from that event, so what it loaded or failed to load reached nobody, and counting it would let a run that
 * delivered nothing clear a failed `SessionStart:compact`, or refuse a session that one already loaded. MEASURED
 * on one session: the ledger held two `PostCompact` rows for it, 21.7s and 38.7s after the
 * `SessionStart` load each followed (`grep <session-id> $SLOPWEAVER_HOME/profile/loads.jsonl`), while its transcript
 * holds no `PostCompact` hook record at all (`grep -c '"hookEvent":"PostCompact"' <its transcript>` prints 0), and
 * the context carried one profile block per compaction.
 *
 * @returns false for a run whose output no session reads
 */
function reachesContext({ observation }: { observation: ProfileLoadObservation }): boolean {
  return !observation.event.startsWith("PostCompact");
}

/**
 * Both sources' observations, ready to fold: every run that reached a context (see {@link reachesContext}), ledger
 * rows last so a by-hand reload written in the same instant as a failure wins the tie. A transcript run and its own
 * row cannot disagree — the run is judged by what it printed, a load that found nothing prints STOP, and a read
 * that printed the owner section `unavailable` never reports `origin: live` (`ownerReadFailure` in `./load.ts`) — so both
 * stay: a transcript load is the only record of a run on code that writes no row, and a transcript failure the only
 * record of a hook that never ran or was killed.
 *
 * @param transcript every observation read off transcripts
 * @param ledger every observation made by a ledger row
 * @returns the merged list, in fold order
 */
export function mergeObservations({
  transcript,
  ledger,
}: {
  transcript: readonly ProfileLoadObservation[];
  ledger: readonly ProfileLoadObservation[];
}): readonly ProfileLoadObservation[] {
  return [...transcript, ...ledger].filter((observation) => reachesContext({ observation }));
}

/**
 * Whether one observation is newer than another. An unparseable instant sorts oldest, and a tie goes to the later
 * one in the list, so a by-hand reload written in the same millisecond as the failure it answers still wins.
 *
 * @returns true when `candidate` should replace `current`
 */
function supersedes({
  candidate,
  current,
}: {
  candidate: ProfileLoadObservation;
  current: ProfileLoadObservation;
}): boolean {
  const candidateMs = Date.parse(candidate.atIso);
  const currentMs = Date.parse(current.atIso);
  if (Number.isNaN(candidateMs)) {
    return Number.isNaN(currentMs);
  }
  return Number.isNaN(currentMs) || candidateMs >= currentMs;
}

/**
 * The newest of a list of observations of runs that reached a context (see {@link reachesContext}), or `undefined`.
 *
 * @param observations in fold order — a tie goes to the later one
 * @returns the observation that decides them
 */
function newestOf({
  observations,
}: {
  observations: readonly ProfileLoadObservation[];
}): ProfileLoadObservation | undefined {
  let newest: ProfileLoadObservation | undefined;
  for (const observation of observations) {
    if (
      reachesContext({ observation }) &&
      (newest === undefined || supersedes({ candidate: observation, current: newest }))
    ) {
      newest = observation;
    }
  }
  return newest;
}

/**
 * Each session's newest observation of a run that reached its context.
 *
 * @param observations every observation, in any order — a tie is broken by list order, so pass ledger rows after
 *   transcript records
 * @returns one per session
 */
function latestPerSession({
  observations,
}: {
  observations: readonly ProfileLoadObservation[];
}): readonly ProfileLoadObservation[] {
  const bySession = Map.groupBy(observations, (observation) => observation.sessionId);
  return [...bySession.values()].flatMap((mine) => {
    const newest = newestOf({ observations: mine });
    return newest === undefined ? [] : [newest];
  });
}

/**
 * One caller's verdict, decided by its newest observation across EVERY id it goes by. Those ids are one caller, so
 * one context: a Claude session carrying a stale inherited Codex thread id is decided by its own later load, not
 * refused for that older thread's failure, and a reload records a row under every id at once.
 *
 * @param observations every observation, of any session
 * @param sessionIds every id the caller goes by
 * @returns `unloaded` when that newest observation is a failure, `loaded` when it is a load, else `unobserved`
 */
export function sessionLoadVerdict({
  observations,
  sessionIds,
}: {
  observations: readonly ProfileLoadObservation[];
  sessionIds: readonly string[];
}): SessionLoadVerdict {
  const latest = newestOf({
    observations: observations.filter((observation) => sessionIds.includes(observation.sessionId)),
  });
  if (latest === undefined) {
    return { kind: "unobserved" };
  }
  return latest.outcome === "failed" ? { kind: "unloaded", latest } : { kind: "loaded", latest };
}

/**
 * Every session whose newest observation is a failure, newest failure first.
 *
 * @param observations every observation
 * @returns one per session that does not hold the owner's profile
 */
export function unloadedSessions({
  observations,
}: {
  observations: readonly ProfileLoadObservation[];
}): readonly ProfileLoadObservation[] {
  return latestPerSession({ observations })
    .filter((observation) => observation.outcome === "failed")
    .toSorted((left, right) => Date.parse(right.atIso) - Date.parse(left.atIso));
}
