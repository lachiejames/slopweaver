/**
 * What a Claude Code transcript says about the hooks it ran — and, specifically, which hook calls spent
 * their whole budget and ended the tool call having decided nothing. Pure: text in, typed values out.
 *
 * ## The record this reads, and why it is news
 *
 * `../live/perf/hookStream.ts` measures TURNAROUND rather than hook time, and its header gives the reason:
 * cmux's `received`→`completed` delta is its own relay, not the hook, and "Claude Code's own transcripts
 * carry `hookName` with no duration". **That is no longer true.** Claude Code 2.1.278 writes one line per
 * hook call carrying the hook's own wall clock:
 *
 * ```json
 * {"type":"attachment","timestamp":"<instant>","cwd":"…","sessionId":"…",
 *  "attachment":{"type":"hook_success","hookName":"PreToolUse:Bash","hookEvent":"PreToolUse",
 *                "stderr":"pretooluse: killed after 15s without a verdict…","exitCode":0,
 *                "durationMs":17529}}
 * ```
 *
 * Repro: `grep -rh -m1 'killed after 15s' ~/.claude/projects/`. The `type` is `attachment`, so
 * `./record.ts` reports the line as `not-a-message-role` and every reader built on it is blind to the whole
 * class — which is why this reads RAW lines from `./source.ts`'s `transcriptLines`, the same single pass
 * `./peerTraffic.ts` uses, rather than walking a tens-of-megabytes file twice.
 *
 * ## THE SAMPLE IS BIASED, and that bound is the whole reason this publishes a CENSUS and not a p50
 *
 * Claude Code writes that attachment only for a hook call that EMITTED OUTPUT. MEASURED over
 * one window of a few hours: 112 `PreToolUse` calls carried a `durationMs` record against 3,979
 * `agent.hook.PreToolUse` `received` frames in `~/.cmuxterm/events.jsonl{,.1}` over the same window — about
 * 3% coverage, and biased toward failures by construction, because a hook that passes silently writes
 * nothing. A median over that sample is not the fleet's median and would be a confidently wrong number in a
 * gauge, so {@link hookOverrunReading} reports counts only and carries `recorded` so a caller can publish
 * the coverage beside them. Reproduce the denominator:
 *
 * ```bash
 * cat ~/.cmuxterm/events.jsonl.1 ~/.cmuxterm/events.jsonl \
 *   | grep 'agent.hook.PreToolUse' | grep -c '"received"'
 * ```
 *
 * **What the sample IS exact about is the overrun census**, and that is not luck: a hook that blows the
 * budget is killed by `hooks/lib/bounded-run.sh`, which PRINTS to stderr before returning, so every
 * overrun emits output and every overrun is therefore in the sample. The bias only ever hides passes —
 * with one exception that needs a second reader. A BLOCKING hook (exit 2) writes no attachment at all on
 * 2.1.289, and a spent budget now fails closed for every door-gated tool, so those overruns survive only as
 * the tool call's own error result; {@link readRefusedOverrun} reads them there.
 *
 * ## The budget is the PreToolUse verdict budget, and no other event is graded against it
 *
 * {@link HOOK_BUDGET_MS} is the inner bound `scripts/pretooluse.sh` spends deciding a tool call. Every other
 * entry is bounded by the envelope against the timeout `hooks/hooks.json` declares for IT — 60 s for the
 * mirror sync, 10 s for `handover-run`. MEASURED: all three overruns `perf` then reported (26,325,
 * 31,359 and 30,701 ms) were `SessionStart` `plugin-mirror-sync` calls that exited 0, and a fleet finding
 * sent a seat hunting a slow PreToolUse step that does not exist. So an overrun is a `PreToolUse` call, and a
 * harness timeout (`unbounded`) is counted for every event at any duration — the same transcript held a
 * `handover-run` the harness killed at 10,087 ms, which the old ">= 15 s first" fold never saw. Repro, for a
 * session `perf --json` names: `grep -o '"hookName":"[^"]*"' ~/.claude/projects/<dir>/<session>.jsonl | sort | uniq -c`.
 *
 * ## Two endings, and the difference between them is READ rather than inferred
 *
 * `run_hook_bounded` sends TERM at {@link HOOK_BUDGET_MS} and returns as soon as the tree is gone, escalating
 * to KILL two seconds later only for a pid that ignored it — so our own ending lands just past 15 s, or at
 * ~17.2–17.5 s for such a pid, and names itself in stderr either way. The harness's own `"timeout"` ending is a
 * DIFFERENT attachment, and it says so exactly:
 *
 * ```json
 * {"type":"hook_cancelled","hookName":"SessionStart:startup","hookEvent":"SessionStart",
 *  "command":"\"${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/plugin-mirror-sync.sh\"",
 *  "durationMs":60158,"timedOut":true,"timeoutMs":60000}
 * ```
 *
 * Repro: `grep -h '"hook_cancelled"' ~/.claude/projects/*​/<session>.jsonl`. It carries no `stderr` and no
 * `exitCode` at all, and instead carries `timedOut`, `timeoutMs` and **the command string verbatim** — so
 * {@link HookOverrunSeat.unbounded} is now counted off `timedOut` and the census can NAME the entry the
 * harness killed rather than only count it. Two things were wrong while it was inferred from an absent
 * stderr line, and both are why this reads the field instead:
 *
 * - **A user interrupt was counted as the defect.** A `hook_cancelled` that is not `timedOut` is a person
 *   pressing escape; it landed in the same bucket, so "zero unbounded" was not falsifiable against it. It
 *   is now excluded from the census entirely and counted as {@link HookOverrunReading.interrupted}.
 * - **A hook whose stderr is DISCARDED read as unbounded.** `hooks/hooks.json`'s `slopweaver init` entry
 *   ends `>/dev/null 2>&1`, deliberately, because a `SessionStart` hook's stdout is injected into the
 *   session as context. Its bound line goes to the same place, so a silenced-but-bounded call was
 *   indistinguishable from an unbounded one.
 */

import { isRecord } from "../lib/parsers.js";

/**
 * The budget `hooks/lib/bounded-run.sh` kills a hook at, in milliseconds — its
 * `HOOK_BUDGET_SECONDS_DEFAULT` of 15, under every tool-call timeout `hooks/hooks.json` declares. A call at or
 * past this reached no verdict, whoever ended it.
 */
export const HOOK_BUDGET_MS = 15_000;

/** The variable `hooks/lib/bounded-run.sh` narrows its budget from, read here so the census grades the same line. */
const BUDGET_ENV_KEY = "SLOPWEAVER_HOOK_BUDGET_SECONDS";

/**
 * The budget a hook on THIS machine is actually killed at, in milliseconds.
 *
 * Mirrors `hook_budget_seconds` in `hooks/lib/bounded-run.sh` exactly — a positive integer in
 * {@link BUDGET_ENV_KEY} no larger than the default, else {@link HOOK_BUDGET_MS} — so a census taken under a
 * narrowed budget grades against the line that seat is really running under. The variable never WIDENS the
 * line: the shell clamps a larger value to the default, and so does this.
 *
 * @param env the environment to read, passed in so this stays pure
 * @returns the budget in milliseconds
 */
export function hookBudgetMs({ env }: { env: Record<string, string | undefined> }): number {
  const raw = env[BUDGET_ENV_KEY];
  if (raw === undefined || !/^\d+$/u.test(raw)) {
    return HOOK_BUDGET_MS;
  }
  const ms = Number(raw) * 1000;
  if (ms <= 0 || ms > HOOK_BUDGET_MS) {
    return HOOK_BUDGET_MS;
  }
  return ms;
}

/**
 * The literals a raw line must contain before it is worth parsing. Every line of a transcript walked for
 * anything else passes through here too, and almost none of them are hook records, so the substring gate
 * runs first and every decision after it is made on the parsed object — the same discipline
 * `./peerTraffic.ts` states.
 */
const GATE_LITERALS: readonly string[] = ['"durationMs"', '"hookEvent"'];

/** The stderr fragment `hooks/lib/bounded-run.sh` prints when OUR budget, rather than the harness, ended it. */
const OUR_BOUND_MARKER = "killed after";

/** The attachment `type` Claude Code writes when a hook call did not run to completion. */
const CANCELLED_TYPE = "hook_cancelled";

/** One hook call, as the transcript recorded it. */
export interface HookCall {
  /** `hookEvent` — `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, … or "" when the line named none. */
  readonly event: string;
  /** `hookName` — the event with the matcher that selected it, e.g. `PreToolUse:Bash`. */
  readonly hookName: string;
  /** The hook's own wall clock, in milliseconds, as Claude Code measured it. */
  readonly durationMs: number;
  /** The line's ISO instant, or "" when it carried none. Never re-derived from anything else. */
  readonly timestamp: string;
  /** The session's working directory — the only field that names a worktree a human recognises. */
  readonly cwd: string;
  /** The session id the line carried, or "" — what joins this row to a `perf` seat. */
  readonly sessionId: string;
  /** Whether OUR bound ended it, read off the stderr line `bounded-run.sh` prints before it returns. */
  readonly endedByOurBound: boolean;
  /** Whether the HARNESS's own declared timeout ended it — `timedOut`, read rather than inferred. */
  readonly harnessTimedOut: boolean;
  /** Whether the call was cancelled without timing out, which is a person pressing escape. */
  readonly interrupted: boolean;
  /** The `hooks.json` command, verbatim, or "" — the only field that names WHICH entry this was. */
  readonly command: string;
  /** The 1-based line it was read from, so an answer can point at its own evidence. */
  readonly lineNumber: number;
}

/**
 * One seat's overruns and harness timeouts. A seat with neither has no row.
 *
 * @internal Reached structurally through {@link HookOverrunReading.seats} — `perf` reads `seats[0]` and
 * its fields without ever naming this type, so nothing outside this file imports the name.
 */
export interface HookOverrunSeat {
  /** The seat's working directory, as the lines carried it. */
  readonly cwd: string;
  /** The session id, or "" when no line named one. */
  readonly sessionId: string;
  /** How many of this seat's `PreToolUse` calls spent the verdict budget. */
  readonly overruns: number;
  /** How many of this seat's calls, of any event, the HARNESS's own timeout ended before ours did. */
  readonly unbounded: number;
  /** The longest counted call, in milliseconds. */
  readonly maxMs: number;
  /**
   * The distinct non-empty `hooks.json` commands the harness timed out here, enveloped or not and possibly
   * both — no multiplicity, and empty when `unbounded` is 0 or no timed-out record named its command.
   */
  readonly unboundedCommands: readonly string[];
  /** How many of {@link HookOverrunSeat.unbounded} carried no command at all, so no list entry stands for them. */
  readonly unboundedUnrecorded: number;
}

/** The census over one window. Counts only — see this file's header for why there is no percentile here. */
export interface HookOverrunReading {
  /** The budget the census was taken against. */
  readonly budgetMs: number;
  /** How many `PreToolUse` calls left a record AT ALL — the coverage a caller must publish beside the rest. */
  readonly recorded: number;
  /** How many `PreToolUse` calls spent the verdict budget — the only event that budget applies to. */
  readonly overruns: number;
  /** How many calls of ANY event the harness's own declared timeout ended before our envelope could. */
  readonly unbounded: number;
  /** How many calls a PERSON cancelled — excluded from every count above, and never a defect. */
  readonly interrupted: number;
  /** One row per seat that overran, worst first. */
  readonly seats: readonly HookOverrunSeat[];
}

/**
 * A string field off a decoded object, or "" when it is absent or not a string.
 *
 * @param on the decoded object
 * @param key the field to read
 * @returns the value, or ""
 */
function str({ on, key }: { on: Record<string, unknown>; key: string }): string {
  const value = on[key];
  return typeof value === "string" ? value : "";
}

/**
 * Decode one raw transcript line as a hook call.
 *
 * A line with no `durationMs` is not a hook record this can measure and answers `undefined` — including a
 * hook shape a future Claude Code writes without one, which must read as "not measurable here" rather than
 * as a hook that took no time.
 *
 * @param line the raw line, exactly as `./source.ts` yielded it
 * @param lineNumber its 1-based position, carried onto the result
 * @returns the call, or `undefined` when the line is not a measurable hook record
 */
export function readHookCall({ line, lineNumber }: { line: string; lineNumber: number }): HookCall | undefined {
  if (!GATE_LITERALS.every((literal) => line.includes(literal))) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const attachment = parsed["attachment"];
  if (!isRecord(attachment)) {
    return undefined;
  }
  const durationMs = attachment["durationMs"];
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return undefined;
  }
  const timedOut = attachment["timedOut"] === true;
  return {
    command: str({ key: "command", on: attachment }),
    cwd: str({ key: "cwd", on: parsed }),
    durationMs,
    endedByOurBound: str({ key: "stderr", on: attachment }).includes(OUR_BOUND_MARKER),
    event: str({ key: "hookEvent", on: attachment }),
    harnessTimedOut: timedOut,
    hookName: str({ key: "hookName", on: attachment }),
    interrupted: !timedOut && str({ key: "type", on: attachment }) === CANCELLED_TYPE,
    lineNumber,
    sessionId: str({ key: "sessionId", on: parsed }),
    timestamp: str({ key: "timestamp", on: parsed }),
  };
}

/** The event whose budget {@link HOOK_BUDGET_MS} is — the one hook that owes the tool call a verdict. */
const VERDICT_EVENT = "PreToolUse";

/** What Claude Code puts between the hook's name and its stderr when a BLOCKING hook refuses a call. */
const REFUSAL_INFIX = " hook error:";

/**
 * The give-up lines `hooks/lib/bounded-run.sh` and `scripts/pretooluse.sh` print when the budget, not a gate,
 * ended the call — each capturing the seconds the line names. A refusal carrying none of them is a GATE's
 * verdict (the poll gate, the script gate), which is the hook working, not an overrun.
 */
const SPENT_BUDGET_PATTERNS: readonly RegExp[] = [
  /killed after (\d+)s without a verdict/u,
  /no gate reached a verdict on this [^(]*\([^)]*?\bthe (\d+)s budget/u,
  /cannot run the browser-door guard \([^)]*?\bthe (\d+)s budget/u,
];

/**
 * The text of one `tool_result` content block — a string, or the text blocks of an array form.
 *
 * @param content the block's `content` field
 * @returns the joined text, or "" when it carries none
 */
function toolResultText({ content }: { content: unknown }): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part: unknown) => (isRecord(part) && typeof part["text"] === "string" ? part["text"] : ""))
    .join("");
}

/**
 * The seconds a spent-budget give-up line names, read off a refusal's text.
 *
 * @param text the refusal's text, from `PreToolUse:<Tool> hook error:` on
 * @returns the seconds, or `undefined` when the refusal was a gate's verdict rather than a spent budget
 */
function spentBudgetSeconds({ text }: { text: string }): number | undefined {
  for (const pattern of SPENT_BUDGET_PATTERNS) {
    const seconds = pattern.exec(text)?.[1];
    if (seconds !== undefined) {
      return Number(seconds);
    }
  }
  return undefined;
}

/**
 * Decode one raw transcript line as a `PreToolUse` call our budget REFUSED, which leaves no attachment at all.
 *
 * MEASURED on Claude Code 2.1.289: a hook that exits 2 writes no `hook_*` attachment — a session
 * that took eight refusals carried zero `"hookEvent":"PreToolUse"` lines — and the refusal lands instead as the
 * tool call's own error result: `PreToolUse:<Tool> hook error: [<command>]: <stderr>` from a bare exit 2 (the shell
 * envelope's give-ups), or `PreToolUse:<Tool> hook error: <reason>` when the dispatcher also printed a deny document
 * (`src/admit/preToolUseDispatch.ts`'s `denyDocument`). Only the infix is read, so both decode. Since a spent budget
 * fails CLOSED for every door-gated tool (`scripts/pretooluse.sh`'s `give_up_code`), {@link readHookCall} alone
 * is blind to exactly the overrun this census exists for. Repro, on any seat that has been refused once:
 * `grep -c '"hookEvent":"PreToolUse"' ~/.claude/projects/<dir>/<session>.jsonl`.
 *
 * The duration is the seconds the give-up line names, so it is a FLOOR: what was left of the budget when the
 * gate step started, not the call's wall clock. {@link HookCall.endedByOurBound} is what makes it an overrun.
 *
 * @param line the raw line, exactly as `./source.ts` yielded it
 * @param lineNumber its 1-based position, carried onto the result
 * @returns the call, or `undefined` when the line is not a spent-budget `PreToolUse` refusal
 */
export function readRefusedOverrun({ line, lineNumber }: { line: string; lineNumber: number }): HookCall | undefined {
  if (!line.includes(`"${VERDICT_EVENT}:`) || !line.includes('"is_error":true')) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isRecord(parsed["message"])) {
    return undefined;
  }
  const content = parsed["message"]["content"];
  if (!Array.isArray(content)) {
    return undefined;
  }
  for (const block of content) {
    if (!isRecord(block) || block["type"] !== "tool_result" || block["is_error"] !== true) {
      continue;
    }
    const text = toolResultText({ content: block["content"] });
    const infixAt = text.indexOf(REFUSAL_INFIX);
    if (!text.startsWith(`${VERDICT_EVENT}:`) || infixAt < 0) {
      continue;
    }
    const seconds = spentBudgetSeconds({ text: text.slice(infixAt) });
    if (seconds === undefined) {
      continue;
    }
    return {
      command: "",
      cwd: str({ key: "cwd", on: parsed }),
      durationMs: seconds * 1000,
      endedByOurBound: true,
      event: VERDICT_EVENT,
      harnessTimedOut: false,
      hookName: text.slice(0, infixAt),
      interrupted: false,
      lineNumber,
      sessionId: str({ key: "sessionId", on: parsed }),
      timestamp: str({ key: "timestamp", on: parsed }),
    };
  }
  return undefined;
}

/**
 * Whether a call spent the VERDICT budget: a `PreToolUse` call at or past the line, or one our own bound ended
 * (whose recorded duration may be a floor under it). Every other event is graded against its own declared
 * timeout by the envelope instead — a `SessionStart` mirror sync declared at 60 s that finishes at 26 s owes
 * nothing, and reading it against 15 s is how a fleet finding once sent a seat hunting a PreToolUse step that
 * never ran slow.
 *
 * @param call the decoded call
 * @param budgetMs the verdict budget
 * @returns whether it is an overrun
 */
function spentVerdictBudget({ call, budgetMs }: { call: HookCall; budgetMs: number }): boolean {
  return call.event === VERDICT_EVENT && (call.durationMs >= budgetMs || call.endedByOurBound);
}

/** One seat's running totals while the fold walks it. */
interface SeatTally {
  cwd: string;
  sessionId: string;
  overruns: number;
  unbounded: number;
  maxMs: number;
  unboundedCommands: Set<string>;
  unboundedUnrecorded: number;
}

/*
 * Fold ONE counted call — an overrun, a harness timeout, or both — into its seat's running totals, minting
 * the row when the seat has none yet.
 *
 * Split out of {@link hookOverrunReading} rather than inlined: the census keeps window-level counters AND a
 * per-seat map, and holding both folds in one body put it past the cognitive-complexity ceiling.
 *
 * The key prefers the session id because that is what joins a row to a `perf` seat; a line that named no
 * session still groups, by cwd, rather than collapsing every anonymous line into one row.
 */
function tallyOverrun({
  call,
  overran,
  tallies,
}: {
  call: HookCall;
  overran: boolean;
  tallies: Map<string, SeatTally>;
}): void {
  const key = call.sessionId.length > 0 ? `session:${call.sessionId}` : `cwd:${call.cwd}`;
  let seen = tallies.get(key);
  if (seen === undefined) {
    seen = {
      cwd: call.cwd,
      maxMs: 0,
      overruns: 0,
      sessionId: call.sessionId,
      unbounded: 0,
      unboundedCommands: new Set(),
      unboundedUnrecorded: 0,
    };
    tallies.set(key, seen);
  }
  seen.overruns += Number(overran);
  seen.maxMs = Math.max(seen.maxMs, call.durationMs);
  if (call.harnessTimedOut) {
    seen.unbounded += 1;
    if (call.command.length > 0) {
      seen.unboundedCommands.add(call.command);
    } else {
      seen.unboundedUnrecorded += 1;
    }
  }
  if (seen.cwd.length === 0) {
    // The first line of a seat may have named no cwd; a later one for the same session still can.
    seen.cwd = call.cwd;
  }
}

/**
 * Fold decoded hook calls into the overrun census.
 *
 * Every event's calls may be passed: the fold itself decides which ones the verdict budget applies to
 * (`PreToolUse` alone), so no caller can regrade a 60 s `SessionStart` hook against 15 s by forgetting a
 * filter. A harness timeout is counted whatever its event or duration.
 *
 * Calls are grouped by session id where the lines carried one and by working directory otherwise, because a
 * transcript always names one of the two and grouping the unnamed ones together would report several seats
 * as one.
 *
 * @param calls every call the caller decoded inside its window, of every event
 * @param budgetMs the line an overrun is judged against — {@link HOOK_BUDGET_MS} unless a caller has
 *   narrowed `SLOPWEAVER_HOOK_BUDGET_SECONDS`
 * @returns the census
 */
export function hookOverrunReading({
  calls,
  budgetMs,
}: {
  calls: readonly HookCall[];
  budgetMs: number;
}): HookOverrunReading {
  const tallies = new Map<string, SeatTally>();
  let overruns = 0;
  let unbounded = 0;
  let interrupted = 0;
  let recorded = 0;
  for (const call of calls) {
    if (call.event === VERDICT_EVENT) {
      recorded += 1;
    }
    if (call.interrupted) {
      // A person pressed escape. Counting it as an overrun would make "zero unbounded" unfalsifiable,
      // because no change to a hook could ever drive it down.
      interrupted += 1;
      continue;
    }
    const overran = spentVerdictBudget({ budgetMs, call });
    if (!overran && !call.harnessTimedOut) {
      continue;
    }
    if (overran) {
      overruns += 1;
    }
    if (call.harnessTimedOut) {
      unbounded += 1;
    }
    tallyOverrun({ call, overran, tallies });
  }
  return {
    budgetMs,
    interrupted,
    overruns,
    recorded,
    seats: [...tallies.values()]
      .map((tally): HookOverrunSeat => ({
        cwd: tally.cwd,
        maxMs: tally.maxMs,
        overruns: tally.overruns,
        sessionId: tally.sessionId,
        unbounded: tally.unbounded,
        unboundedCommands: [...tally.unboundedCommands].toSorted(),
        unboundedUnrecorded: tally.unboundedUnrecorded,
      }))
      .toSorted((left, right) => right.overruns - left.overruns || right.maxMs - left.maxMs),
    unbounded,
  };
}
