/**
 * The SUPERVISOR STREAM's event model — what a long-running Slopweaver surface publishes about itself, as
 * pure functions. No filesystem, no clock.
 *
 * ## Why Slopweaver owns this file rather than publishing into cmux's stream
 *
 * The alternative was real and was measured before it was rejected, against cmux 0.64.22,
 * through `cmux/socket.ts`'s own client (`system.capabilities`):
 *
 * - cmux exposes **303** v2 methods and **not one of them publishes an arbitrary event onto
 *   `events.stream`**. The nearest neighbours are `feed.push` and the `notification.create*` family, which
 *   write into the owner's UI feed and notification centre. Those are chrome the owner reads, not a machine
 *   transport — routing a heartbeat through them would put a notification on the owner's screen every time a socket
 *   wobbled, which is the wall-of-text failure in a different costume.
 * - cmux retains 4,096 events in memory and spills the rest; a cursor that ages out comes back with
 *   `resume.gap`. A listener death twenty minutes old can be evicted by ordinary fleet chatter — and that is
 *   exactly the event a supervisor most needs to still be able to read.
 * - The listener supervision loop runs whether or not cmux is up. An event that cannot be emitted while cmux
 *   is down is, again, precisely the event worth having.
 *
 * So this is not a preference between two workable designs; publishing into cmux's stream has no method to
 * do it with. What cmux's stream keeps is its own job — agent hook firings — and a supervisor reads both.
 *
 * ## The cursor is a BYTE OFFSET, and there is no sequence number
 *
 * Two surfaces append to this file concurrently (the listener's death-watch tick, the recipe scheduler's
 * lifecycle writes). A monotonic sequence number would need one of them to read the other's last line before
 * writing its own, and two ticks that read the same last line assign the same number. A byte offset needs no
 * write-side coordination at all: the file is append-only, so the offset of a line never moves, and a reader
 * resumes by seeking to the offset it stopped at. A file that has SHRUNK below a reader's offset is the one
 * honest failure — it means the stream was truncated or replaced, and the reader says `gap` rather than
 * silently re-reading from a byte that now means something else.
 */

import { isRecord } from "../lib/parsers.js";

/** How the listener's own state changed. `re-armed` is the tick handing back a command, not a live process. */
const LISTENER_EVENT_KINDS = [
  "armed",
  "heartbeat-degraded",
  "died",
  "re-armed",
  "escalated",
  "disarmed",
  "recovery-stalled",
] as const;

/** One listener event kind. */
export type ListenerEventKind = (typeof LISTENER_EVENT_KINDS)[number];

/**
 * How a recipe generation moved — a READ-ONLY vocabulary now, and that is deliberate rather than an
 * oversight.
 *
 * Nothing publishes any of these. The standing recipe-scheduler is retired and the
 * dispatcher that wrote every one of them: the lifecycle log the first four projected off, the ignore
 * registry `backoff-parked` named, and the claim-history gauge behind `cadence-silent`. The kinds stay
 * because the STREAM IS HISTORY and the parser is what reads it. MEASURED on one install:
 * 345 of the 3,446 lines in `$SLOPWEAVER_HOME/live/events/stream.jsonl` carry `source: "recipe-scheduler"`,
 * so removing the source would make a tenth of the owner's own supervisor stream unreadable to
 * `slopweaver events tail`. Reproduce it with
 * `grep -c recipe-scheduler "$SLOPWEAVER_HOME/live/events/stream.jsonl"`.
 *
 * Do not add a publisher back. A row that has quietly stopped running is read from `automation due` and
 * `live/recipe/resync-state/`, at a supervisor pass — `skills/automation/SKILL.md` carries why.
 */
const RECIPE_EVENT_KINDS = [
  "slot-started",
  "completed",
  "result-wait-expired",
  "failed",
  "dispatch-failed",
  "backoff-parked",
  "cadence-silent",
] as const;

/** One recipe-scheduler event kind. */
type RecipeEventKind = (typeof RECIPE_EVENT_KINDS)[number];

/**
 * What `github attach` published about the one credential in this repository that a browser, not a token,
 * has to renew.
 *
 * The pair is the point. `needs-owner-login` alone would leave a supervisor briefing carrying an alert with
 * no way to learn it had been cleared — the same trap the listener's `died`/`armed` pair avoids — so the
 * capture publishes too, and a briefing reads the newer of the two.
 */
const ATTACH_EVENT_KINDS = ["needs-owner-login", "login-captured"] as const;

/** One `github attach` event kind. */
type AttachEventKind = (typeof ATTACH_EVENT_KINDS)[number];

/**
 * `slopweaver github merge`'s own post-merge probe found `base` failing a gate it just landed a change onto.
 *
 * One kind, and it is always `alert`: the whole point of this source (see `docsBudgetSweep.ts`'s header) is
 * that a red `base` is discovered by whichever branch cuts from it next unless something says so out loud the
 * moment it happens — measured as exactly what did NOT happen once.
 */
const MERGE_EVENT_KINDS = ["main-gate-failed"] as const;

/** One `github merge` event kind. */
type MergeEventKind = (typeof MERGE_EVENT_KINDS)[number];

/**
 * What `slopweaver github hold`/`release` published about the merge queue.
 *
 * All three, not just the warning. `held` and `released` are the pair that lets a supervisor briefing read
 * the CURRENT state off the stream it already tails — the same trap `github attach`'s pair avoids, where a
 * lone alert leaves a reader with no way to learn it had been cleared. `stale` is the one that carries a
 * consequence: a hold nobody released is a merge queue nobody can use.
 */
const HOLD_EVENT_KINDS = ["held", "released", "stale"] as const;

/** One `github hold` event kind. */
export type GithubHoldEventKind = (typeof HOLD_EVENT_KINDS)[number];

/**
 * What a STANDING session published about which commit it is actually running.
 *
 * All three, and the pair is load-bearing exactly as `github attach`'s is: `stale` alone would leave a
 * supervisor briefing carrying an alert with no way to learn it had been cleared, so `current` publishes too
 * and a briefing reads the newer of the two. `respawned` is the third because a respawn is the one state
 * change here that a re-read of `session standing` cannot show — the successor answers as a different
 * session, and without this the retirement of the old one is invisible.
 *
 * Measured, and the reason this source exists at all: the Slack loop ran an old commit and the
 * recipe scheduler ran a tree 74 commits behind while later work landed, and NOTHING on any surface said so.
 */
const STANDING_EVENT_KINDS = ["stale", "current", "respawned"] as const;

/** One standing-session event kind. */
export type StandingEventKind = (typeof STANDING_EVENT_KINDS)[number];

/**
 * What one source of a `slopweaver refresh` published about whether it reached disk.
 *
 * The pair is the point, exactly as `github attach`'s is: `write-refused` alone would leave a supervisor
 * briefing carrying an alert with no way to learn it had been cleared, so a source that DID commit publishes
 * too and a briefing reads the newer of the two.
 *
 * Measured, and the reason this source exists at all: `bronze/slack` grew a 5.9 GiB window file,
 * the writer's dedup index could not be built over it, and the writer refused every Slack write for five
 * days. The refusal was correct and it was printed — on stderr, mid-crawl, in a run the owner was not
 * watching — and NOTHING on any surface said the bot's Slack world model had stopped moving.
 */
const REFRESH_EVENT_KINDS = ["write-refused", "committed"] as const;

/** One refresh event kind. */
type RefreshEventKind = (typeof REFRESH_EVENT_KINDS)[number];

/**
 * What `slopweaver machine capacity` published about the machine crossing one of its thresholds.
 *
 * `capacity-alert` is a foreign process or swap over its ALERT threshold — a briefing line. `capacity-hold`
 * is the VM compressor, the swapfile count or the 1-minute load average over its HOLD threshold — the fill
 * step spawns nothing while the newest one stands (one panic hit 100% of the compressor's segments
 * limit, 49 swapfiles, while `memory_pressure` still read ~50% free; another reached load 34.84 under a
 * verdict that read `ok`). `holdOn` says WHICH subject held, so the stream's own `where` column never claims
 * `compressor` for a CPU hold. Both grade `alert`, exactly as `github merge`'s `main-gate-failed`
 * does: the sweep runs this every tick, so there is no need for a clearing pair — a tick under threshold
 * simply publishes nothing, and the next event is the freshest read of a state that can only be read live.
 */
const MACHINE_EVENT_KINDS = ["capacity-alert", "capacity-hold"] as const;

/**
 * The three things Claude plan rotation says out loud.
 *
 * `rotated` is ordinary bookkeeping. The other two are alerts because neither can clear itself on the next
 * tick: `all-exhausted` waits on a provider reset the fleet cannot hurry, and `gauge-unreadable` means the
 * rate-limit shape changed under us, so rotation has stopped choosing at all and new managed spawns are
 * refused until a clean read of every plan comes back.
 */
const CLAUDE_ROTATION_EVENT_KINDS = ["rotated", "all-exhausted", "gauge-unreadable"] as const;

/** One Claude plan rotation event kind. */
type ClaudeRotationEventKind = (typeof CLAUDE_ROTATION_EVENT_KINDS)[number];

/** One `machine capacity` event kind. */
type MachineEventKind = (typeof MACHINE_EVENT_KINDS)[number];

/** Which surface published an event. */
export const SUPERVISOR_EVENT_SOURCES = [
  "listener",
  "recipe-scheduler",
  "github-attach",
  "github-merge",
  "github-hold",
  "standing-session",
  "refresh",
  "machine",
  "claude-rotation",
] as const;

/** One publishing surface. */
export type SupervisorEventSource = (typeof SUPERVISOR_EVENT_SOURCES)[number];

/**
 * How loudly one event should be surfaced, weakest first.
 *
 * Derived from `(source, kind)` by {@link severityOf} rather than carried on the wire, so a stream written by
 * an older build cannot disagree with the reader's own idea of what is urgent. The ordering is the point: a
 * `--min-severity` filter compares positions in {@link SUPERVISOR_EVENT_SEVERITIES}.
 */
export const SUPERVISOR_EVENT_SEVERITIES = ["info", "warn", "alert"] as const;

/** One severity. */
export type SupervisorEventSeverity = (typeof SUPERVISOR_EVENT_SEVERITIES)[number];

/** The listener published something about itself. */
export interface ListenerStreamEvent {
  readonly source: "listener";
  readonly kind: ListenerEventKind;
  readonly atIso: string;
  /** One sentence a supervisor can print verbatim — what happened and why it matters. */
  readonly why: string;
  /** The arm this is about. `undefined` only when nothing was armed at all. */
  readonly armId: string | undefined;
  /** The arm's pid. `undefined` for an escalation, which outlives the process it is about. */
  readonly pid: number | undefined;
  /**
   * The tail of a dead arm's own log, carried straight through from the arm journal.
   *
   * Present only on `died`, and deliberately optional even there: a foreground arm writes to the session's
   * own output and has no log file, and "there was nothing to read" is a different fact from "it said
   * nothing" — see `live/listen/supervise/store.ts`'s `readListenerLogTail`.
   */
  readonly lastLog?: string;
}

/** The recipe scheduler published something about one generation. */
export interface RecipeStreamEvent {
  readonly source: "recipe-scheduler";
  readonly kind: RecipeEventKind;
  readonly atIso: string;
  /** One sentence a supervisor can print verbatim. */
  readonly why: string;
  readonly slotHash: string;
  readonly runId: string;
}

/**
 * `github attach` published something about the saved GitHub web session.
 *
 * The only publisher here that is not a resident surface — it is a one-shot verb, and that is exactly why it
 * publishes. A verb blocked on a login the owner has not noticed is indistinguishable from a verb still
 * working (doctrine rule 6), and under `--no-login` there is no browser on the owner's screen to notice at all.
 */
export interface AttachStreamEvent {
  readonly source: "github-attach";
  readonly kind: AttachEventKind;
  readonly atIso: string;
  /** One sentence a supervisor can print verbatim. */
  readonly why: string;
  /** The saved session file this is about. Never its contents — the file IS a live credential. */
  readonly sessionPath: string;
}

/**
 * `slopweaver github merge --admin` published something about the branch it just landed on.
 *
 * `repo` rather than a path or a branch name alone: this is the one source whose alert a supervisor cannot
 * resolve by re-reading a live status the way `listener status`/`recipe` can — it names exactly which
 * repository needs a human to move a paragraph out of a budgeted file.
 */
export interface MergeStreamEvent {
  readonly source: "github-merge";
  readonly kind: MergeEventKind;
  readonly atIso: string;
  /** One sentence a supervisor can print verbatim — which budget, by how much, on which branch. */
  readonly why: string;
  /** The `owner/name` slug this merge landed into. */
  readonly repo: string;
}

/**
 * `slopweaver github hold`/`release` published something about which pull request owns the merge queue.
 *
 * `pr` sits beside `repo` as its own field rather than being folded into the sentence, because a reader
 * deciding whether a hold is theirs compares a NUMBER — and a supervisor rendering the fleet briefing links
 * to it.
 */
export interface GithubHoldStreamEvent {
  readonly source: "github-hold";
  readonly kind: GithubHoldEventKind;
  readonly atIso: string;
  /** One sentence a supervisor can print verbatim — which pull request, held by whom, and why. */
  readonly why: string;
  /** The `owner/name` slug whose merge queue this is about. */
  readonly repo: string;
  /** The held pull request's number. */
  readonly pr: number;
}

/**
 * A standing session published which commit it is running.
 *
 * `session` sits beside the sentence as its own field rather than being folded into it because a reader
 * deciding whether an alert is theirs compares a NAME — and the two standing sessions are respawned by
 * entirely different verbs, so the sentence alone would not tell a supervisor which one to run.
 */
export interface StandingStreamEvent {
  readonly source: "standing-session";
  readonly kind: StandingEventKind;
  readonly atIso: string;
  /** One sentence a supervisor can print verbatim — which session, which tree, how far behind, and what now. */
  readonly why: string;
  /** Which standing session — `loop` or `scheduler`. */
  readonly session: string;
  /** The worst tree's HEAD at the moment of publication. Absent when nothing could be read at all. */
  readonly head: string | undefined;
}

/**
 * One source of a refresh published whether its rows reached bronze.
 *
 * `source` sits beside the sentence as its own field rather than being folded into it because a reader
 * deciding whether an alert is theirs compares a NAME — and the remedy differs per source, so the sentence
 * alone would not tell a supervisor which corpus is frozen.
 */
export interface RefreshStreamEvent {
  readonly source: "refresh";
  readonly kind: RefreshEventKind;
  readonly atIso: string;
  /** One sentence a supervisor can print verbatim — which corpus source, what happened, and what now. */
  readonly why: string;
  /** The corpus source this is about — `slack`, `github`, `linear`, `notion`, `gmail`, `self`. */
  readonly corpusSource: string;
  /** Rows this source wrote. `0` on a refusal, which is the whole point. */
  readonly written: number;
}

/**
 * `slopweaver machine capacity` published the machine crossing a threshold — `kind` says which of the two.
 *
 * `topForeignLabel`/`topForeignGb` are both optional because swap alone can cross its threshold with no
 * single foreign process over its own — the mds incident this source exists for had both, but a briefing
 * reading only the sentence would lose which one (or both) actually fired. `segmentsPct`/`swapfileCount`
 * are the hold gauge's own readings, carried on both kinds so a briefing can print the number, not just
 * the sentence.
 */
export interface MachineStreamEvent {
  readonly source: "machine";
  readonly kind: MachineEventKind;
  readonly atIso: string;
  /** One sentence a supervisor can print verbatim — the verdict `machine capacity` itself rendered. */
  readonly why: string;
  /** The top foreign process's label, when one crossed its own threshold. */
  readonly topForeignLabel: string | undefined;
  /** The top foreign process's footprint in GB, when one crossed its own threshold. */
  readonly topForeignGb: number | undefined;
  /**
   * The label of the largest process a Claude Code session SPAWNED, set only when it crossed the footprint
   * threshold — a heredoc's `Python` under a bot turn — so the `where` column names it.
   */
  readonly fleetChildLabel: string | undefined;
  /** The session that spawned {@link fleetChildLabel}, so the briefing names whose tool call to stop. */
  readonly fleetChildSessionId: string | undefined;
  /**
   * WHO this reading blames — a session id, or the dead seats whose orphaned shells are burning the CPU. The
   * One incident published eleven consecutive `capacity-hold`s reading `HOLD on cpu (1-min load 146,
   * hold at 22)` and naming nobody, and the owner had to come in and ask why the fleet was ten times slower.
   */
  readonly culpritSubject: string | undefined;
  /** The one command that ends {@link culpritSubject} — what react-now offers beside the hold. */
  readonly culpritKill: string | undefined;
  /** Swap used, in GB, at the moment of publication. */
  readonly swapUsedGb: number | undefined;
  /** The compressor's segments in use as a percentage of `vm.compressor.segment.limit`, when it was read. */
  readonly segmentsPct: number | undefined;
  /** Swapfiles on disk, when the count was read. */
  readonly swapfileCount: number | undefined;
  /** The 1-minute load average at the moment of publication, when `top`'s header line was read. */
  readonly load1: number | undefined;
  /**
   * Which subject a HOLD fired on this reading — `memory`, `cpu` or `memory and cpu`, and `undefined` when
   * nothing held. Both events one reading publishes carry the same gauges, so a `capacity-alert` emitted
   * alongside a hold carries the hold's subject too; only `capacity-hold` renders it in the `where` column.
   */
  readonly holdOn: string | undefined;
}

/**
 * Claude plan rotation published something about which plan the fleet is on.
 *
 * Every field here is safe to print. `alias` is a neutral local label rather than an email or an
 * organisation, and there is deliberately no field a credential could occupy — this event is rendered into
 * a terminal, a sidebar row and a supervisor briefing.
 */
export interface ClaudeRotationStreamEvent {
  readonly source: "claude-rotation";
  readonly kind: ClaudeRotationEventKind;
  readonly atIso: string;
  /** One sentence a supervisor can print verbatim. */
  readonly why: string;
  /** The plan now in the chair, for `rotated`. Absent when no plan could be chosen. */
  readonly alias: string | undefined;
  /** The plan the fleet left, when it was on one. */
  readonly fromAlias: string | undefined;
  /**
   * The earliest instant any plan-wide window resets, for `all-exhausted` — so the alert says when the
   * fleet comes back rather than only that it is down.
   */
  readonly earliestResetIso: string | undefined;
}

/** One event on the supervisor stream. */
export type SupervisorEvent =
  | ListenerStreamEvent
  | RecipeStreamEvent
  | AttachStreamEvent
  | MergeStreamEvent
  | GithubHoldStreamEvent
  | StandingStreamEvent
  | RefreshStreamEvent
  | MachineStreamEvent
  | ClaudeRotationStreamEvent;

/**
 * How urgent one event is.
 *
 * `died` and `escalated` are both `alert` on purpose, and they are not redundant: a death is the bot being
 * off the air right now, and an escalation is the supervisor having STOPPED putting it back — a supervisor
 * that only alerted on the second would sleep through every single-death outage.
 *
 * `recovery-stalled` is `alert` because its only OTHER symptom is silence: the scheduled recovery sweep keeps
 * running on cadence and reporting `recovered: 0`, and the watermark it is failing to advance is a number
 * nobody reads. Measured: seven hours of a down safety net under a healthy listener, found by
 * hand.
 *
 * @param event the event to grade
 * @returns its severity
 */
export function severityOf({ event }: { event: SupervisorEvent }): SupervisorEventSeverity {
  switch (event.source) {
    case "listener":
      return listenerSeverity({ kind: event.kind });
    case "recipe-scheduler":
      return recipeSeverity({ kind: event.kind });
    case "github-attach":
      // `needs-owner-login` is an `alert` because it is the one event on this stream that CANNOT resolve
      // itself: every other alert here is a machine that may recover on the next tick, and this one waits
      // on a pair of hands. `login-captured` is the clearing half, so it is ordinary `info`.
      return event.kind === "needs-owner-login" ? "alert" : "info";
    case "github-merge":
      // The one kind this source publishes is always `alert` — see `MERGE_EVENT_KINDS`'s own header.
      return "alert";
    case "machine":
      // Both kinds this source publishes are `alert` — see `MACHINE_EVENT_KINDS`'s own header.
      return "alert";
    case "claude-rotation":
      // `rotated` is bookkeeping. The other two cannot clear themselves on the next tick — see
      // `CLAUDE_ROTATION_EVENT_KINDS`'s own header.
      return event.kind === "rotated" ? "info" : "alert";
    case "standing-session":
      // `stale` is `alert` because it is the one grade whose consequence is INVISIBLE: a standing session on
      // an old tree keeps answering, keeps looking healthy on every other gauge, and silently applies none of
      // the fixes that landed — measured across a whole day of public failures. `current` and
      // `respawned` are the clearing halves, so they are ordinary `info`.
      return event.kind === "stale" ? "alert" : "info";
    case "refresh":
      // `write-refused` is `alert` because its only OTHER symptom is silence: the bot keeps answering from
      // the corpus it already has, every gauge stays green, and the world model simply stops moving —
      // measured as five days of no-op'd Slack refreshes nobody could see. `committed` is the
      // clearing half, so it is ordinary `info`.
      return event.kind === "write-refused" ? "alert" : "info";
    case "github-hold":
      // `stale` is `warn`, not `alert`: a hold standing past its threshold blocks nothing that a single
      // `github release` does not clear, and it is very often just a merge taking longer than expected.
      // Grading it `alert` would train a supervisor to skim the severity column, which is the one thing
      // that must keep working for a listener death.
      return event.kind === "stale" ? "warn" : "info";
  }
}

/** The listener half of {@link severityOf}, split out so each source's switch stays exhaustive on its own. */
function listenerSeverity({ kind }: { kind: ListenerEventKind }): SupervisorEventSeverity {
  switch (kind) {
    case "died":
    case "escalated":
    case "recovery-stalled":
      return "alert";
    case "heartbeat-degraded":
    case "re-armed":
      return "warn";
    case "armed":
    case "disarmed":
      return "info";
  }
}

/** The recipe half of {@link severityOf}. */
function recipeSeverity({ kind }: { kind: RecipeEventKind }): SupervisorEventSeverity {
  switch (kind) {
    case "failed":
    case "dispatch-failed":
    case "result-wait-expired":
    case "backoff-parked":
    case "cadence-silent":
      return "alert";
    case "slot-started":
    case "completed":
      return "info";
  }
}

/**
 * Whether an event is at least as urgent as a floor.
 *
 * @param event the event to test
 * @param minimum the weakest severity that passes
 * @returns true when the event's severity is at or above the floor
 */
export function meetsSeverity({
  event,
  minimum,
}: {
  event: SupervisorEvent;
  minimum: SupervisorEventSeverity;
}): boolean {
  return SUPERVISOR_EVENT_SEVERITIES.indexOf(severityOf({ event })) >= SUPERVISOR_EVENT_SEVERITIES.indexOf(minimum);
}

/**
 * One event as the line a human reads — severity first, because that is what a supervisor scans for.
 *
 * The `lastLog` is deliberately NOT rendered here: it is up to four kilobytes of a dying process's narration,
 * and inlining it into a scannable stream is the wall of text `AGENTS.md` rule 7 forbids. `--json` carries it
 * whole for the reader that wants it.
 *
 * @param event the event to render
 * @returns a tab-separated line
 */
export function renderSupervisorEventLine({ event }: { event: SupervisorEvent }): string {
  return `${severityOf({ event })}\t${event.atIso}\t${event.source}\t${event.kind}\t${whereOf({ event })}\t${event.why}`;
}

/** The one column that means something different per source: which thing the event is about. */
function whereOf({ event }: { event: SupervisorEvent }): string {
  switch (event.source) {
    case "listener":
      return event.armId ?? "(no arm)";
    case "recipe-scheduler":
      return `${event.slotHash}/${event.runId}`;
    case "github-attach":
      return event.sessionPath;
    case "github-merge":
      return event.repo;
    case "github-hold":
      return `${event.repo}#${String(event.pr)}`;
    case "standing-session":
      return `${event.session}@${event.head ?? "unreadable"}`;
    case "refresh":
      return event.corpusSource;
    case "machine":
      if (event.kind === "capacity-hold") {
        return event.holdOn ?? "compressor";
      }
      return event.fleetChildLabel ?? event.topForeignLabel ?? "swap";
    case "claude-rotation":
      return event.alias ?? "no plan";
  }
}

/**
 * The member of a closed set a decoded value equals, or `undefined`.
 *
 * Returns the ELEMENT rather than narrowing the input, so the closed set itself supplies the type and there
 * is no assertion to be wrong about.
 */
function oneOf<T extends string>({ allowed, value }: { allowed: readonly T[]; value: unknown }): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

/** Read a required non-empty string field, or `undefined`. */
function requiredString({ field, raw }: { field: string; raw: Record<string, unknown> }): string | undefined {
  const value = raw[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Decode the listener half of the union, once the shared fields have been validated. */
function listenerEventOf({
  atIso,
  raw,
  why,
}: {
  atIso: string;
  raw: Record<string, unknown>;
  why: string;
}): ListenerStreamEvent | undefined {
  const kind = oneOf({ allowed: LISTENER_EVENT_KINDS, value: raw["kind"] });
  if (kind === undefined) {
    return undefined;
  }
  const armId = raw["armId"];
  const pid = raw["pid"];
  const lastLog = raw["lastLog"];
  return {
    armId: typeof armId === "string" ? armId : undefined,
    atIso,
    kind,
    pid: typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? pid : undefined,
    source: "listener",
    why,
    ...(typeof lastLog === "string" ? { lastLog } : {}),
  };
}

/** Decode the recipe half of the union, once the shared fields have been validated. */
function recipeEventOf({
  atIso,
  raw,
  why,
}: {
  atIso: string;
  raw: Record<string, unknown>;
  why: string;
}): RecipeStreamEvent | undefined {
  const kind = oneOf({ allowed: RECIPE_EVENT_KINDS, value: raw["kind"] });
  const slotHash = requiredString({ field: "slotHash", raw });
  const runId = requiredString({ field: "runId", raw });
  if (kind === undefined || slotHash === undefined || runId === undefined) {
    return undefined;
  }
  return { atIso, kind, runId, slotHash, source: "recipe-scheduler", why };
}

/** Decode the `github attach` half of the union, once the shared fields have been validated. */
function attachEventOf({
  atIso,
  raw,
  why,
}: {
  atIso: string;
  raw: Record<string, unknown>;
  why: string;
}): AttachStreamEvent | undefined {
  const kind = oneOf({ allowed: ATTACH_EVENT_KINDS, value: raw["kind"] });
  const sessionPath = requiredString({ field: "sessionPath", raw });
  if (kind === undefined || sessionPath === undefined) {
    return undefined;
  }
  return { atIso, kind, sessionPath, source: "github-attach", why };
}

/** Decode the `github merge` half of the union, once the shared fields have been validated. */
function mergeEventOf({
  atIso,
  raw,
  why,
}: {
  atIso: string;
  raw: Record<string, unknown>;
  why: string;
}): MergeStreamEvent | undefined {
  const kind = oneOf({ allowed: MERGE_EVENT_KINDS, value: raw["kind"] });
  const repo = requiredString({ field: "repo", raw });
  if (kind === undefined || repo === undefined) {
    return undefined;
  }
  return { atIso, kind, repo, source: "github-merge", why };
}

/** Decode the `github hold` half of the union, once the shared fields have been validated. */
function holdEventOf({
  atIso,
  raw,
  why,
}: {
  atIso: string;
  raw: Record<string, unknown>;
  why: string;
}): GithubHoldStreamEvent | undefined {
  const kind = oneOf({ allowed: HOLD_EVENT_KINDS, value: raw["kind"] });
  const repo = requiredString({ field: "repo", raw });
  const pr = raw["pr"];
  if (kind === undefined || repo === undefined || typeof pr !== "number" || !Number.isSafeInteger(pr) || pr <= 0) {
    return undefined;
  }
  return { atIso, kind, pr, repo, source: "github-hold", why };
}

/** Decode the refresh half of the union, once the shared fields have been validated. */
function refreshEventOf({
  atIso,
  raw,
  why,
}: {
  atIso: string;
  raw: Record<string, unknown>;
  why: string;
}): RefreshStreamEvent | undefined {
  const kind = oneOf({ allowed: REFRESH_EVENT_KINDS, value: raw["kind"] });
  const corpusSource = requiredString({ field: "corpusSource", raw });
  const written = raw["written"];
  if (kind === undefined || corpusSource === undefined) {
    return undefined;
  }
  if (typeof written !== "number" || !Number.isSafeInteger(written) || written < 0) {
    return undefined;
  }
  return { atIso, corpusSource, kind, source: "refresh", why, written };
}

/** Decode the standing-session half of the union, once the shared fields have been validated. */
function standingEventOf({
  atIso,
  raw,
  why,
}: {
  atIso: string;
  raw: Record<string, unknown>;
  why: string;
}): StandingStreamEvent | undefined {
  const kind = oneOf({ allowed: STANDING_EVENT_KINDS, value: raw["kind"] });
  const session = requiredString({ field: "session", raw });
  if (kind === undefined || session === undefined) {
    return undefined;
  }
  return { atIso, head: requiredString({ field: "head", raw }), kind, session, source: "standing-session", why };
}

/** Decode the machine-capacity half of the union, once the shared fields have been validated. */
function machineEventOf({
  atIso,
  raw,
  why,
}: {
  atIso: string;
  raw: Record<string, unknown>;
  why: string;
}): MachineStreamEvent | undefined {
  const kind = oneOf({ allowed: MACHINE_EVENT_KINDS, value: raw["kind"] });
  if (kind === undefined) {
    return undefined;
  }
  const topForeignGb = raw["topForeignGb"];
  const swapUsedGb = raw["swapUsedGb"];
  const segmentsPct = raw["segmentsPct"];
  const swapfileCount = raw["swapfileCount"];
  const load1 = raw["load1"];
  return {
    atIso,
    culpritKill: requiredString({ field: "culpritKill", raw }),
    culpritSubject: requiredString({ field: "culpritSubject", raw }),
    fleetChildLabel: requiredString({ field: "fleetChildLabel", raw }),
    fleetChildSessionId: requiredString({ field: "fleetChildSessionId", raw }),
    holdOn: requiredString({ field: "holdOn", raw }),
    kind,
    load1: typeof load1 === "number" ? load1 : undefined,
    segmentsPct: typeof segmentsPct === "number" ? segmentsPct : undefined,
    source: "machine",
    swapUsedGb: typeof swapUsedGb === "number" ? swapUsedGb : undefined,
    swapfileCount: typeof swapfileCount === "number" ? swapfileCount : undefined,
    topForeignGb: typeof topForeignGb === "number" ? topForeignGb : undefined,
    topForeignLabel: requiredString({ field: "topForeignLabel", raw }),
    why,
  };
}

/** Decode a `claude-rotation` line, or `undefined` when its kind is not one this build knows. */
function claudeRotationEventOf({
  atIso,
  raw,
  why,
}: {
  atIso: string;
  raw: Record<string, unknown>;
  why: string;
}): ClaudeRotationStreamEvent | undefined {
  const kind = oneOf({ allowed: CLAUDE_ROTATION_EVENT_KINDS, value: raw["kind"] });
  if (kind === undefined) {
    return undefined;
  }
  return {
    alias: typeof raw["alias"] === "string" ? raw["alias"] : undefined,
    atIso,
    earliestResetIso: typeof raw["earliestResetIso"] === "string" ? raw["earliestResetIso"] : undefined,
    fromAlias: typeof raw["fromAlias"] === "string" ? raw["fromAlias"] : undefined,
    kind,
    source: "claude-rotation",
    why,
  };
}

/**
 * Parse one stream line. A line that will not decode is DROPPED rather than failing the whole read — the
 * same rule the arm journal keeps, and for the same reason: one torn line written during a kill must not
 * blind a supervisor to every other event in the file.
 *
 * @param line one raw JSONL line
 * @returns the decoded event, or `undefined` when the line is not one
 */
export function parseSupervisorEvent({ line }: { line: string }): SupervisorEvent | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(raw)) {
    return undefined;
  }
  const atIso = requiredString({ field: "atIso", raw });
  const why = requiredString({ field: "why", raw });
  if (atIso === undefined || why === undefined || !Number.isFinite(Date.parse(atIso))) {
    return undefined;
  }
  const source = oneOf({ allowed: SUPERVISOR_EVENT_SOURCES, value: raw["source"] });
  if (source === "listener") {
    return listenerEventOf({ atIso, raw, why });
  }
  if (source === "recipe-scheduler") {
    return recipeEventOf({ atIso, raw, why });
  }
  if (source === "github-attach") {
    return attachEventOf({ atIso, raw, why });
  }
  if (source === "github-merge") {
    return mergeEventOf({ atIso, raw, why });
  }
  if (source === "github-hold") {
    return holdEventOf({ atIso, raw, why });
  }
  if (source === "standing-session") {
    return standingEventOf({ atIso, raw, why });
  }
  if (source === "refresh") {
    return refreshEventOf({ atIso, raw, why });
  }
  if (source === "machine") {
    return machineEventOf({ atIso, raw, why });
  }
  if (source === "claude-rotation") {
    return claudeRotationEventOf({ atIso, raw, why });
  }
  return undefined;
}

/**
 * One event as the exact line the stream stores — no trailing newline.
 *
 * The property that matters here is that one event is one PHYSICAL line: a `lastLog` carries a dying
 * process's narration, newlines and all, and a record that spans lines is a record a byte-offset cursor can
 * land in the middle of. `JSON.stringify` escapes every newline inside a string, so the property holds by
 * construction rather than by a scrub — it is named here because it is load-bearing, not decorative.
 *
 * @param event the event to encode
 * @returns the JSON line
 */
export function supervisorEventLine({ event }: { event: SupervisorEvent }): string {
  return JSON.stringify(event);
}
