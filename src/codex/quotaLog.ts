/**
 * Read Codex's own rollout log — the JSONL Codex CLI itself writes under
 * `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` — for a fresh, structured usage snapshot. Not a
 * documented API: this is Codex's own local session log, found by direct inspection of real rollout files
 * while this machine's account was genuinely exhausted (the incident this doc's own quota
 * feature responds to). `codex doctor --json` and every top-level `codex` subcommand were checked first and
 * expose no usage/rate-limit check, so this file is the only machine-readable signal that exists.
 *
 * ## `rate_limits` is a SIBLING of `info`, and reading it inside `info` matched nothing for a month
 *
 * The shape this module was built against — `payload.info.rate_limits` — is not the shape Codex writes.
 * MEASURED over this machine's whole session tree: **80,935 `token_count` events, 0 of them
 * carrying `payload.info.rate_limits` and 80,842 carrying `payload.rate_limits`**, so every quota read of
 * the old shape resolved to "no evidence" and the 93 events that actually named an exhaustion went unread. The unit
 * test did not catch it because its fixtures were written from the same doc comment rather than from a real
 * line. Reproduce both numbers:
 *
 * ```bash
 * cd "${CODEX_HOME:-$HOME/.codex}/sessions"
 * grep -rho '"type":"token_count"' . | wc -l
 * grep -rlho '"info":{[^}]*"rate_limits"' . | wc -l   # the shape this module used to require
 * grep -rho '},"rate_limits":{' . | wc -l             # the shape Codex writes
 * ```
 *
 * So {@link ./gauge.rateLimitsAll} returns BOTH positions and {@link parseRolloutObservation} judges every
 * one of them, taking the worst. Neither position is authoritative — nothing in a line says which Codex
 * version wrote it — so any precedence rule lets one position mask an exhausted window in the other, and two
 * review rounds broke every rule this file tried. A line reads healthy only when NO position says otherwise.
 *
 * A rollout file is only ever a REGULAR file with exactly ONE name here: {@link rolloutFilesIn} `lstat`s each
 * candidate and skips a symlink or a hard link, and a line is marker-tested before it is parsed, so this
 * reader cannot be made to assemble a document it was not meant to open.
 *
 * One real healthy line, verbatim apart from elision inside `info`:
 *
 * ```json
 * {"timestamp":"<iso instant>","type":"event_msg","payload":{"type":"token_count",
 *  "info":{"total_token_usage":{…},"last_token_usage":{…},"model_context_window":258400},
 *  "rate_limits":{"limit_id":"codex","primary":{"used_percent":18.0,"window_minutes":10080,
 *    "resets_at":1789877221},"secondary":null,"credits":{"has_credits":true,"unlimited":false,
 *    "balance":null},"plan_type":"self_serve_business_prolite","rate_limit_reached_type":null}}}
 * ```
 *
 * `resets_at` is a Unix-epoch SECOND count — machine-parseable, unlike the prose "resets <time> on <day>"
 * the interactive banner renders. `window_minutes: 10080` is the 7-day weekly window and 300 is the
 * five-hour one; when `primary` is the five-hour window, `secondary` carries the weekly one.
 *
 * ## Both reached types are classified, and they are not the same exhaustion
 *
 * `rate_limit_reached_type: "workspace_member_credits_depleted"` is the credits-out signal.
 * `"workspace_member_usage_limit_reached"` is a DIFFERENT one and was the 85-of-93 majority — this module
 * recognised only the first, so even with the path fixed the common case would still have read as healthy.
 * See {@link ../codex/quotaTypes.CodexQuotaKind} for why it maps to `usage-limit` and not to `weekly-limit`.
 *
 * `has_credits: false` is NOT a third signal, though this header said it was: 1,011 healthy readings on this
 * machine carry the flag beside a null reached type, and {@link evidenceFromGauge} carries the census. The
 * `task_complete` arm has the same shape — ONE `codex_error_info` covering both exhaustions, told apart by
 * its message — and {@link exhaustionFromTaskComplete} carries that one.
 *
 * This is deliberately NOT a general Codex account-usage API integration — there is no evidence one exists,
 * and this reads a file Codex already writes as a side effect of normal operation, the same way
 * `cmux read-screen` reads a terminal Codex already renders. The schema is undocumented and
 * version-specific, so every read here is tolerant: a missing file, an unreadable line or an unrecognised
 * shape all resolve to `undefined` rather than throwing — `quotaGate.ts` treats "no evidence" exactly like
 * "healthy", never as a reason to refuse.
 */

import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { absentAsNumber } from "#lib/absent.js";
import { isRecord } from "../lib/parsers.js";
import { type CodexGauge, type CodexWindowReading, parseGaugeLineAll } from "./gauge.js";
import { detectExhaustionBanner } from "./quotaBanner.js";
import type { CodexQuotaEvidence, CodexQuotaObservation } from "./quotaTypes.js";
import {
  horizonStartMs,
  latestRolloutCandidate,
  type RolloutCandidate,
  rolloutEntryState,
  rolloutsNewestFirst,
  walkRollouts,
} from "./rolloutWalk.js";

/** How many of the most recent day-directories to check for the latest rollout file, newest first. */
const RECENT_DAY_DIRS = 3;

/** Bound on how many trailing bytes of the latest rollout file this reads — a busy session runs to 10s of MB. */
const TAIL_READ_BYTES = 2_000_000;

/**
 * `$CODEX_HOME`, or Codex's own documented default. Never a Slopweaver path — Codex owns this directory.
 *
 * @returns the resolved Codex home
 */
export function resolveCodexHome(): string {
  const CODEX_HOME = process.env["CODEX_HOME"];
  if (CODEX_HOME === undefined) {
    return join(homedir(), ".codex");
  }
  return CODEX_HOME;
}

/** List every entry directly inside `dir` matching `isWanted`, or an empty list when `dir` is unreadable. */
function listEntries({
  dir,
  isWanted,
}: {
  dir: string;
  isWanted: (entry: { readonly name: string; readonly isDirectory: () => boolean }) => boolean;
}): readonly string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => isWanted(entry))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * The day-directories under `sessions/` that hold at least one rollout file, most recent first.
 *
 * An EMPTY day-directory is skipped rather than counted: it holds nothing to read, and counting it let eight
 * empty directories use up an eight-directory bound and hide a current reading one directory further back (a
 * Codex review's counterexample).
 *
 * Exported so `./gaugeScan.ts` walks the same tree by the same rule instead of growing a second opinion
 * about where Codex keeps its sessions — the layout is undocumented, and two readers of an undocumented
 * layout drift.
 *
 * @param codexHome the Codex home to scan (see {@link resolveCodexHome})
 * @param limit how many day-directories to return, newest first
 * @returns the absolute day-directory paths, newest first, at most `limit` of them
 */
export function recentSessionDayDirs({
  codexHome,
  limit = RECENT_DAY_DIRS,
}: {
  codexHome: string;
  limit?: number;
}): readonly string[] {
  const dayDirs: string[] = [];
  for (const dayDir of dayDirsNewestFirst({ sessionsRoot: join(codexHome, "sessions") })) {
    if (rolloutFilesIn({ dayDir }).length === 0) {
      continue;
    }
    dayDirs.push(dayDir);
    if (dayDirs.length >= limit) {
      break;
    }
  }
  return dayDirs;
}

/**
 * Every rollout file in every day-directory modified within `windowMs` of the newest one, newest by mtime
 * first.
 *
 * Chosen by MTIME, never by directory name, because a resumed session keeps appending to the file in the
 * day-directory it was CREATED in: a Codex review put a current cap in a file under a directory three weeks
 * older than eight newer ones, and a name-based bound never opened it. Listing is cheap where reading is not:
 * statting all 4,860 rollout files across this machine's three homes took 0.23s
 * (`time find ~/.codex*\/sessions -name 'rollout-*.jsonl' -exec stat -f %m {} + >/dev/null`). The window is
 * measured back from the newest file's mtime, so a home nobody has used for a month still reports its last
 * state — but never from later than NOW, so one file stamped in the future (`touch`, a skewed clock) cannot
 * drag the window forward past a current reading (a Codex review).
 *
 * @param codexHome the Codex home to scan (see {@link resolveCodexHome})
 * @param windowMs how far behind the newest file's mtime a file may be and still be returned
 * @param nowMs the scan instant the window's anchor is capped at; a test passes a fixed one
 * @returns the candidates, newest by mtime first; an empty list when the home holds none
 */
export function rolloutsModifiedWithin({
  codexHome,
  nowMs = Date.now(),
  windowMs,
}: {
  codexHome: string;
  nowMs?: number;
  windowMs: number;
}): readonly RolloutCandidate[] {
  const all = rolloutsNewestFirst({ candidates: walkRollouts({ codexHome }).candidates });
  const horizonMs = horizonStartMs({ newestFirst: all, nowMs, windowMs });
  return all.filter((candidate) => candidate.mtimeMs >= horizonMs);
}

/** The subdirectory names of `dir`, newest (highest) first. */
function subdirsNewestFirst({ dir }: { dir: string }): readonly string[] {
  return listEntries({ dir, isWanted: (entry) => entry.isDirectory() })
    .toSorted()
    .toReversed();
}

/** Every `sessions/YYYY/MM/DD` directory, newest first, yielded lazily so a caller's bound stops the walk. */
function* dayDirsNewestFirst({ sessionsRoot }: { sessionsRoot: string }): Generator<string> {
  for (const year of subdirsNewestFirst({ dir: sessionsRoot })) {
    for (const month of subdirsNewestFirst({ dir: join(sessionsRoot, year) })) {
      for (const day of subdirsNewestFirst({ dir: join(sessionsRoot, year, month) })) {
        yield join(sessionsRoot, year, month, day);
      }
    }
  }
}

/**
 * Find the single most-recently-modified rollout file across the most recent day-directories.
 *
 * @param codexHome the Codex home to scan (see {@link resolveCodexHome})
 * @returns the latest rollout file's absolute path, or undefined when none was found
 */
export function findLatestRolloutPath({ codexHome }: { codexHome: string }): string | undefined {
  const candidates = recentSessionDayDirs({ codexHome }).flatMap((dayDir) => rolloutFilesIn({ dayDir }));
  return latestRolloutCandidate({ candidates })?.path;
}

/**
 * Every rollout file directly inside one day-directory, with its mtime.
 *
 * Exported for `./gaugeScan.ts`, which needs ALL of them rather than only the newest — a budget series is
 * built from many sessions, while an exhaustion check only ever wants the freshest line.
 *
 * @param dayDir one day-directory, as {@link recentSessionDayDirs} returns them
 * @returns each rollout file's path and mtime; an empty list when the directory is unreadable
 */
export function rolloutFilesIn({ dayDir }: { dayDir: string }): readonly RolloutCandidate[] {
  const candidates: RolloutCandidate[] = [];
  for (const name of listEntries({ dir: dayDir, isWanted: (entry) => entry.name.endsWith(".jsonl") })) {
    const path = join(dayDir, name);
    // A link, a non-regular file and one `lstat` cannot reach are refused, never read; one that vanished between
    // listing and `lstat` carries no evidence either way. `rolloutEntryState` carries why, and `walkRollouts`'s
    // `hiddenPlaces` counts the refusals so a reader knows a later reading may sit among them.
    const state = rolloutEntryState({ path });
    if (typeof state === "object") {
      candidates.push({ mtimeMs: state.mtimeMs, path });
    }
  }
  return candidates;
}

/**
 * Read the last {@link TAIL_READ_BYTES} of `path` (or the whole file when smaller). "" on any read failure.
 *
 * A BOUNDED tail, never the whole file: a busy Codex session's rollout runs to tens of megabytes, and this
 * is the read the `whole-file-json` gate exists to keep bounded. The first line of the returned text may be
 * a fragment — the tail starts mid-file — which every caller must tolerate, and each does by discarding a
 * line that will not parse.
 *
 * @param path the rollout file to read
 * @returns the trailing text, or "" when the file could not be read at all
 */
export function readRolloutTail({ path }: { path: string }): string {
  return readTrailingBytes({ bytes: TAIL_READ_BYTES, path }).text;
}

/**
 * Read the last `bytes` of `path`, or the whole file when smaller. "" on any read failure, flagged as one.
 *
 * @param path the rollout file to read
 * @param bytes how many trailing bytes at most
 * @returns the text, whether it reached the file's start (true on a failed read, which has nothing more), and
 *   whether the read failed
 */
function readTrailingBytes({ path, bytes }: { path: string; bytes: number }): {
  text: string;
  whole: boolean;
  failed: boolean;
} {
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    const fd = openSync(path, "r");
    try {
      readSync(fd, buffer, 0, buffer.length, start);
    } finally {
      closeSync(fd);
    }
    return { failed: false, text: buffer.toString("utf8"), whole: start === 0 };
  } catch {
    return { failed: true, text: "", whole: true };
  }
}

/**
 * A rollout's tail, widened toward the start until it `holds` what the caller wants or the file runs out.
 *
 * One JSONL line can outgrow any fixed tail: MEASURED, the longest line in three weeks of
 * rollouts on this machine was 2,582,576 bytes, longer than {@link TAIL_READ_BYTES}. A tail that starts
 * inside such a line holds nothing before it, so a reading written just before a huge tool output would be
 * invisible to a fixed read. This doubles the slice until the predicate is satisfied, so its cost is bounded
 * by the file's own size (the largest was 9,981,096 bytes) and is paid only by a file whose first slice held
 * nothing wanted. Reproduce:
 * `find ~/.codex/sessions -name "rollout-*.jsonl" -mtime -21 -print0 | xargs -0 awk '{ if (length($0) > m) m = length($0) } END { print m }'`
 *
 * @param path the rollout file to read
 * @param initialBytes the first slice's size
 * @param holds whether a slice's text carries what the caller is looking for
 * @returns the smallest doubled slice that holds it, or the whole file when none does
 */
export function readRolloutTailUntil({
  path,
  initialBytes,
  holds,
}: {
  path: string;
  initialBytes: number;
  holds: (text: string) => boolean;
}): string {
  const read = readRolloutTailOrUnread({ holds, initialBytes, path });
  if (read === undefined) {
    return "";
  }
  return read;
}

/**
 * {@link readRolloutTailUntil}, telling a file it could not read apart from an empty one.
 *
 * The read IS the readability check — there is no separate test before it — so a file that becomes unreadable
 * between being listed and being opened is still reported, not passed over as empty (a scan that skipped a newer unreadable file in silence reported an
 * older file's reading as the current one).
 *
 * @param path the rollout file to read
 * @param initialBytes the first slice's size
 * @param holds whether a slice's text carries what the caller is looking for
 * @returns the text as {@link readRolloutTailUntil} returns it, or `undefined` when any slice's read failed
 */
export function readRolloutTailOrUnread({
  path,
  initialBytes,
  holds,
}: {
  path: string;
  initialBytes: number;
  holds: (text: string) => boolean;
}): string | undefined {
  for (let bytes = initialBytes; ; bytes *= 2) {
    const slice = readTrailingBytes({ bytes, path });
    if (slice.failed) {
      return undefined;
    }
    if (slice.whole || holds(slice.text)) {
      return slice.text;
    }
  }
}

/**
 * The exhaustion a `task_complete` error names, classified off its MESSAGE rather than its code.
 *
 * `codex_error_info` is too coarse to classify on, and reading it alone made this function disagree with the
 * `token_count` event describing the very same failure — found by a Codex review, which supplied a real
 * rollout line where the `task_complete` read `credits-out` and the `rate_limit_reached_type` beside it read
 * `workspace_member_usage_limit_reached`. MEASURED on this machine's rollouts, and the split is exact:
 *
 * ```bash
 * grep -rho '"codex_error_info":"[a-z_]*"' "${CODEX_HOME:-$HOME/.codex}/sessions" | sort | uniq -c
 * grep -rh 'usage_limit_exceeded' "${CODEX_HOME:-$HOME/.codex}/sessions" | grep -o '"message":"[^"]*"' | sort | uniq -c
 * ```
 *
 * All 93 `usage_limit_exceeded` events split 85 / 8 by message — "You hit your spend cap set by the owner of
 * your workspace" against "Your workspace is out of credits" — which is the SAME 85 / 8 split as the two
 * reached types. One code, two exhaustions. The wording is matched by `./quotaBanner.ts`, which captured it
 * against a real exhausted account, so there is one place a phrasing lives rather than two.
 *
 * An unrecognised wording under the same code stays `usage-limit`: the code does say a usage limit was hit,
 * and `usage-limit` is the arm that waits for a healthy reading rather than one claiming a credit balance
 * nobody observed.
 *
 * @param observedAtIso the rollout line's own timestamp
 * @param payload the event payload
 * @returns the evidence, or undefined when the event is not an exhausted `task_complete`
 */
function exhaustionFromTaskComplete({
  observedAtIso,
  payload,
}: {
  observedAtIso: string;
  payload: Record<string, unknown>;
}): CodexQuotaEvidence | undefined {
  if (payload["type"] !== "task_complete" || !isRecord(payload["error"])) {
    return undefined;
  }
  const error = payload["error"];
  if (error["codex_error_info"] !== "usage_limit_exceeded") {
    return undefined;
  }
  const message = typeof error["message"] === "string" ? error["message"] : "";
  const banner = detectExhaustionBanner({ text: message });
  if (banner === undefined) {
    return { kind: "usage-limit", observedAtIso };
  }
  return { kind: banner, observedAtIso };
}

/**
 * The exhaustion a parsed gauge amounts to, or undefined when the gauge reads HEALTHY.
 *
 * The order is the policy, and each step is a different fact:
 *
 *  1. a classified `rate_limit_reached_type` — Codex naming the exhaustion itself, the strongest signal;
 *  2. a credit BALANCE Codex reports as spent — a number at or below zero, never the `has_credits` flag;
 *  3. ANY window at 100% — the only exhaustion visible purely in a percentage, and the one real event
 *     carrying it (`REAL_WEEKLY_EXHAUSTED_LINE`) has a null reached type, which is why the branch survives.
 *
 * **Step 2 does NOT read `has_credits`, and that is a correction.** It did, and a Codex review of this change
 * produced a real healthy line the flag alone classified as `credits-out`: both windows at 0%, a null reached
 * type, and a turn that went on to produce output. MEASURED on this machine's own rollouts — every count
 * below is that census, reproducible with no credential:
 *
 * ```bash
 * grep -rh '"has_credits":false' ~/.codex/sessions | grep -c 'rate_limit_reached_type":null'
 * grep -rho '"credits":{[^}]*}' ~/.codex/sessions | sort | uniq -c | sort -rn | head
 * ```
 *
 * 1,019 events carry `has_credits: false`, 1,011 of them beside a null reached type and only 40 of THOSE
 * beside any window at 100% — so the flag would have refused roughly a thousand spawns off healthy readings.
 * All 1,019 are byte-identical: `{"has_credits":false,"unlimited":false,"balance":null}`. A null balance is
 * the absence of a figure, not a figure of zero, and real depletion is named outright by
 * `workspace_member_credits_depleted` (8 events), which step 1 already classifies. The numeric-balance test
 * below is therefore defensive: no event this machine has ever written reaches it.
 *
 * **Step 3 walks EVERY window, and that is a correction too.** It asked only for the weekly one until a Codex
 * review of this change produced a real rollout line reading
 * `primary: {used_percent: 100, window_minutes: 300}` beside a healthy `secondary` weekly window — an
 * exhausted five-hour window, classified as healthy. Nor may it read `primary` directly: on the 3,270 events
 * where the five-hour window sits in `primary`, the weekly one is in `secondary`. Both mistakes are the same
 * mistake — assuming a slot means a window — and `./gauge.ts` is where that stops being assumable.
 *
 * @param gauge the parsed reading
 * @returns the evidence, or undefined when nothing in the reading says exhausted
 */
export function evidenceFromGauge({ gauge }: { gauge: CodexGauge }): CodexQuotaEvidence | undefined {
  const scope = gauge.limitId === undefined ? {} : { limitId: gauge.limitId };
  if (gauge.reached !== undefined) {
    return { kind: gauge.reached, observedAtIso: gauge.observedAtIso, ...scope };
  }
  const balance = gauge.credits?.balance;
  if (balance !== undefined && balance !== null && balance <= 0) {
    return { kind: "credits-out", observedAtIso: gauge.observedAtIso, ...scope };
  }
  const exhausted = lastToReopen({ windows: gauge.windows.filter((window) => window.usedPercent >= 100) });
  if (exhausted === undefined) {
    return undefined;
  }
  return {
    kind: "window-limit",
    observedAtIso: gauge.observedAtIso,
    ...scope,
    ...(exhausted.windowMinutes === undefined ? {} : { windowMinutes: exhausted.windowMinutes }),
    ...(exhausted.resetAtIso === undefined ? {} : { resetAtIso: exhausted.resetAtIso }),
  };
}

/**
 * Of several exhausted windows, the one that actually reopens LAST — so a refusal names the wait a caller
 * really has rather than whichever slot came first.
 *
 * **Ranked by RESET INSTANT, and that is a correction.** It ranked by WIDTH, on the reasoning that a wider
 * window reopens later, and a Codex review of that version disproved it with two windows exhausted at once:
 * a 300-minute one resetting three hours after a 10,080-minute one. Width says the weekly
 * one, and the caller waits three hours longer than the refusal told them to. A window's own reset is the
 * only thing that answers the question, and the widths were never more than a proxy for it.
 *
 * The instants are PARSED, never compared as text — an offset-bearing ISO string sorts wrong, which is the
 * defect `./quotaGate.ts`'s `strictlyLater` carries. A window with no reset cannot be ranked at all and
 * loses to any window that has one, falling back to width only among windows that all lack a reset: an
 * unreportable reset is not evidence of reopening later. Ties keep the first.
 *
 * @param windows the exhausted windows, in slot order
 * @returns the window to name in the refusal, or undefined when none was exhausted
 */
function lastToReopen({ windows }: { windows: readonly CodexWindowReading[] }): CodexWindowReading | undefined {
  const rank = ({ window }: { window: CodexWindowReading }): number => {
    const reset = window.resetAtIso === undefined ? undefined : Date.parse(window.resetAtIso);
    return reset === undefined || !Number.isFinite(reset) ? Number.NEGATIVE_INFINITY : reset;
  };
  return windows.reduce<CodexWindowReading | undefined>((worst, window) => {
    if (worst === undefined) {
      return window;
    }
    const here = rank({ window });
    const incumbent = rank({ window: worst });
    if (here !== incumbent) {
      return here > incumbent ? window : worst;
    }
    // Both unrankable, or resetting at the same instant: fall back to the old width proxy, which is still the
    // better guess between two windows nothing else distinguishes.
    return absentAsNumber({ value: window.windowMinutes, whenAbsent: 0 }) >
      absentAsNumber({ value: worst.windowMinutes, whenAbsent: 0 })
      ? window
      : worst;
  }, undefined);
}

/**
 * Parse one rollout JSONL line into quota evidence. Pure — no I/O, so a line fixture is a complete test.
 *
 * @param line one raw line from a rollout file
 * @returns the evidence the line carries, or undefined when it carries none (including on a parse failure)
 */
export function parseRolloutLine({ line }: { line: string }): CodexQuotaEvidence | undefined {
  const present = parseRolloutObservation({ line })?.evidence;
  if (present === undefined) {
    return taskCompleteEvidence({ line });
  }
  return present;
}

/** The `task_complete` half of {@link parseRolloutLine}, which carries no `rate_limits` and so is not an observation. */
function taskCompleteEvidence({ line }: { line: string }): CodexQuotaEvidence | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || typeof value["timestamp"] !== "string" || !isRecord(value["payload"])) {
    return undefined;
  }
  return exhaustionFromTaskComplete({ observedAtIso: value["timestamp"], payload: value["payload"] });
}

/**
 * Parse one rollout JSONL line into a quota OBSERVATION — a reading whether or not it found an exhaustion.
 *
 * This is the function a recovery check wants and {@link parseRolloutLine} is not: a healthy line has to be
 * distinguishable from a line nobody looked at, and only an observation can do that. Pure.
 *
 * @param line one raw line from a rollout file
 * @returns the observation, or undefined when the line carries no `rate_limits` at all
 */
export function parseRolloutObservation({ line }: { line: string }): CodexQuotaObservation | undefined {
  // EVERY position, worst first — never one chosen by precedence. Two review rounds broke every precedence
  // rule this had: whichever object was preferred, a line could carry an exhausted window in the OTHER one
  // and still read HEALTHY, and a healthy observation of a scope clears that scope's standing cap. There is
  // no safe way to pick, so nothing picks: the first position carrying evidence wins, and only a line where
  // NO position reports exhaustion is an observation of health.
  const gauges = parseGaugeLineAll({ line });
  const first = gauges[0];
  if (first === undefined) {
    return undefined;
  }
  const exhausted = gauges
    .map((gauge: CodexGauge) => ({ evidence: evidenceFromGauge({ gauge }), gauge }))
    .find((reading: { readonly evidence: CodexQuotaEvidence | undefined }) => reading.evidence !== undefined);
  if (exhausted === undefined) {
    return { evidence: undefined, limitId: first.limitId, observedAtIso: first.observedAtIso };
  }
  return {
    evidence: exhausted.evidence,
    limitId: exhausted.gauge.limitId,
    observedAtIso: exhausted.gauge.observedAtIso,
  };
}

/**
 * Every `limit_id`'s freshest observation in the latest rollout file's tail.
 *
 * One per scope rather than one overall, because the scopes genuinely disagree: on this machine every
 * exhaustion event is `limit_id: premium` while every ordinary reading is `limit_id: codex`, so collapsing
 * them would let the healthy `codex` line that always follows a cap read as the cap clearing. See
 * {@link ../codex/quotaTypes.CodexQuotaObservation}.
 *
 * @param codexHome the Codex home to scan (see {@link resolveCodexHome})
 * @returns the newest observation per scope, newest first; empty when no rollout file carries one
 */
export function readLatestCodexQuotaObservations({
  codexHome,
}: {
  codexHome: string;
}): readonly CodexQuotaObservation[] {
  const path = findLatestRolloutPath({ codexHome });
  if (path === undefined) {
    return [];
  }
  const newestByScope = new Map<string | undefined, CodexQuotaObservation>();
  const lines = readRolloutTail({ path }).split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const observation = parseRolloutObservation({ line: lines[index]! });
    if (observation === undefined) {
      continue;
    }
    // Scanning newest-line-first, so the FIRST observation seen for a scope is that scope's freshest and
    // every later one is older. The map is keyed on `string | undefined` rather than on a coalesced "",
    // because an event that named NO `limit_id` is its own scope and must not share a bucket with one that
    // named the empty string — and `?? ""` would silently merge the two.
    if (!newestByScope.has(observation.limitId)) {
      newestByScope.set(observation.limitId, observation);
    }
  }
  return [...newestByScope.values()].toSorted((left, right) => right.observedAtIso.localeCompare(left.observedAtIso));
}

/**
 * Read the latest rollout file's tail and return the LAST line carrying quota evidence — the freshest
 * exhaustion Codex's own log has, scanned newest-line-first within the tail.
 *
 * Kept for the callers that only ever wanted an exhaustion, and deliberately NOT the recovery path: it
 * cannot distinguish a healthy reading from an absent one, which is the whole reason
 * {@link readLatestCodexQuotaObservations} exists.
 *
 * @param codexHome the Codex home to scan (see {@link resolveCodexHome})
 * @returns the freshest quota evidence found, or undefined when none was found (missing home, no rollout
 *   files, or a tail with no matching line — all read the same as "no evidence yet")
 */
export function readLatestCodexQuotaEvidence({ codexHome }: { codexHome: string }): CodexQuotaEvidence | undefined {
  const path = findLatestRolloutPath({ codexHome });
  if (path === undefined) {
    return undefined;
  }
  const lines = readRolloutTail({ path }).split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const evidence = parseRolloutLine({ line: lines[index]! });
    if (evidence !== undefined) {
      return evidence;
    }
  }
  return undefined;
}
