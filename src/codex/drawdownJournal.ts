/**
 * The Codex burn watch's append-only memory: every reading it has taken, and every investigation it opened.
 *
 * ## Why the readings are journalled at all
 *
 * A Codex gauge answers "what is the utilization right now". The detector needs a BASELINE, and a baseline
 * is history — so until this journal existed there was no way to ask whether the current pace is unusual,
 * only what it currently is. `./drawdownAnomaly.ts` and `./drawdownSeries.ts` are the arithmetic; this is what
 * it stands on.
 *
 * ## Why an ATTEMPT is recorded before the spawn, and why that is not the whole mechanism
 *
 * `src/claude/drawdownJournal.ts` suppresses on a journalled attempt, read back and compared. That is a
 * read-then-append check, and two foreground watches ticking at the same moment both pass it — they read the
 * same journal, both find no attempt, and both spawn. The plan is explicit that at most ONE automatic
 * attempt must be possible, so the real mutual exclusion here is an atomic exclusive file CREATE in
 * `./drawdownJournalStore.ts`, and the journal row is the human-readable record beside it rather than the
 * lock itself.
 *
 * Three things that must not reset suppression, each of which would turn a helpful watch into a workspace
 * flood: silence (no new readings), stale data (the same readings again), and a spawn that FAILED. A later
 * episode is admitted only when fresh compatible readings establish a genuinely different series — which is
 * what {@link ./drawdownAnomaly.CodexDrawdownEpisode.episodeId} being derived from the series and never from
 * the clock buys.
 *
 * Pure: lines in, events out. The file lives in `./drawdownJournalStore.ts`.
 */

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import type { CodexDrawdownSample, CodexDrawdownTrigger } from "./drawdownAnomaly.js";
import { type CodexDrawdownError, CodexDrawdownErrors } from "./drawdownErrors.js";

/**
 * The decision to open an investigation, written when the claim was taken.
 *
 * @internal a member of {@link CodexDrawdownJournalEvent}; callers branch on `kind`.
 */
export interface CodexDrawdownEpisodeOpened {
  readonly kind: "episode-opened";
  readonly schemaVersion: 1;
  readonly episodeId: string;
  readonly openedAtIso: string;
  readonly triggers: readonly CodexDrawdownTrigger[];
}

/**
 * An episode that recovered: fresh compatible readings put the series back inside its own pace.
 *
 * @internal a member of {@link CodexDrawdownJournalEvent}.
 */
export interface CodexDrawdownEpisodeClosed {
  readonly kind: "episode-closed";
  readonly schemaVersion: 1;
  readonly episodeId: string;
  readonly closedAtIso: string;
  readonly reason: string;
}

/**
 * A visible investigation that came up.
 *
 * @internal a member of {@link CodexDrawdownJournalEvent}.
 */
export interface CodexDrawdownInvestigationOpened {
  readonly kind: "investigation-opened";
  readonly schemaVersion: 1;
  readonly episodeId: string;
  readonly recordedAtIso: string;
  readonly workspaceRef: string;
}

/**
 * A spawn that did not come up. Recorded and surfaced, NEVER retried automatically.
 *
 * @internal a member of {@link CodexDrawdownJournalEvent}.
 */
export interface CodexDrawdownInvestigationFailed {
  readonly kind: "investigation-failed";
  readonly schemaVersion: 1;
  readonly episodeId: string;
  readonly recordedAtIso: string;
  readonly reason: string;
  /**
   * The workspace the spawn reported before failing, when it reported one.
   *
   * A spawn can OPEN a workspace and then fail to boot it or hand it its pickup, so the ref is carried into
   * the failure: whoever reads this afterwards needs to know there is a dead workspace to close, not merely
   * that something went wrong.
   */
  readonly workspaceRef: string | undefined;
}

/** Everything one line of this journal can be. */
export type CodexDrawdownJournalEvent =
  | CodexDrawdownSample
  | CodexDrawdownEpisodeOpened
  | CodexDrawdownEpisodeClosed
  | CodexDrawdownInvestigationOpened
  | CodexDrawdownInvestigationFailed;

/** What a whole journal read resolved to. */
export interface CodexDrawdownJournalRead {
  readonly events: readonly CodexDrawdownJournalEvent[];
  /**
   * Lines that could not be parsed.
   *
   * Counted rather than dropped, and a non-zero count is what stops an investigation: a lost reading is a
   * WRONG baseline, not a smaller one, and a corrupt journal that read as empty history would report every
   * ordinary hour as an anomaly.
   */
  readonly unreadable: number;
}

/**
 * A row's recorded reason, or the stated fact that it carried none.
 *
 * An old row written before the field existed, or one whose writer had nothing to say, are both read the
 * same way and both say so. The alternative is an empty string, which prints as a reason nobody gave.
 *
 * @param record the line's decoded object
 * @returns the reason, or the stated absence
 */
function reasonOn({ record }: { record: Record<string, unknown> }): string {
  const reason = stringAt({ name: "reason", record });
  if (reason === undefined) {
    return "no reason recorded";
  }
  return reason;
}

/** A string field, or `undefined` when absent or the wrong type. */
function stringAt({ record, name }: { record: Record<string, unknown>; name: string }): string | undefined {
  const value = record[name];
  return typeof value === "string" ? value : undefined;
}

/** A finite number field, or `undefined`. */
function numberAt({ record, name }: { record: Record<string, unknown>; name: string }): number | undefined {
  const value = record[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Parse a sample line.
 *
 * @param record the line's decoded object
 * @returns the sample, or why it could not be read
 */
function parseSample({
  record,
}: {
  record: Record<string, unknown>;
}): Result<CodexDrawdownJournalEvent, CodexDrawdownError> {
  const sourceEventId = stringAt({ name: "sourceEventId", record });
  const accountScope = stringAt({ name: "accountScope", record });
  const limitId = stringAt({ name: "limitId", record });
  const resetAtIso = stringAt({ name: "resetAtIso", record });
  const observedAtIso = stringAt({ name: "observedAtIso", record });
  const windowMinutes = numberAt({ name: "windowMinutes", record });
  const usedPercent = numberAt({ name: "usedPercent", record });
  if (sourceEventId === undefined || accountScope === undefined || limitId === undefined) {
    return err(
      CodexDrawdownErrors.lineMalformed({ problem: "a sample line is missing sourceEventId, accountScope or limitId" }),
    );
  }
  if (resetAtIso === undefined || observedAtIso === undefined) {
    return err(CodexDrawdownErrors.lineMalformed({ problem: "a sample line is missing resetAtIso or observedAtIso" }));
  }
  if (windowMinutes === undefined || usedPercent === undefined) {
    return err(
      CodexDrawdownErrors.lineMalformed({
        problem: "a sample line's windowMinutes or usedPercent is not a finite number",
      }),
    );
  }
  return ok({
    accountScope,
    kind: "sample",
    limitId,
    observedAtIso,
    resetAtIso,
    schemaVersion: 1,
    sourceEventId,
    usedPercent,
    windowMinutes,
  });
}

/**
 * Parse an episode-opened or episode-closed line.
 *
 * @param record the line's decoded object
 * @param kind which of the two it claims to be
 * @returns the event, or why it could not be read
 */
function parseEpisode({
  record,
  kind,
}: {
  record: Record<string, unknown>;
  kind: "episode-opened" | "episode-closed";
}): Result<CodexDrawdownJournalEvent, CodexDrawdownError> {
  const episodeId = stringAt({ name: "episodeId", record });
  if (episodeId === undefined) {
    return err(CodexDrawdownErrors.lineMalformed({ problem: `an ${kind} line is missing its episodeId` }));
  }
  if (kind === "episode-opened") {
    const openedAtIso = stringAt({ name: "openedAtIso", record });
    if (openedAtIso === undefined) {
      return err(CodexDrawdownErrors.lineMalformed({ problem: "an episode-opened line is missing openedAtIso" }));
    }
    const triggers = record["triggers"];
    return ok({
      episodeId,
      kind,
      openedAtIso,
      schemaVersion: 1,
      triggers: Array.isArray(triggers) ? (triggers as readonly CodexDrawdownTrigger[]) : [],
    });
  }
  const closedAtIso = stringAt({ name: "closedAtIso", record });
  if (closedAtIso === undefined) {
    return err(CodexDrawdownErrors.lineMalformed({ problem: "an episode-closed line is missing closedAtIso" }));
  }
  return ok({
    closedAtIso,
    episodeId,
    kind,
    reason: reasonOn({ record }),
    schemaVersion: 1,
  });
}

/**
 * Parse an investigation-opened or investigation-failed line.
 *
 * @param record the line's decoded object
 * @param kind which of the two it claims to be
 * @returns the event, or why it could not be read
 */
function parseInvestigation({
  record,
  kind,
}: {
  record: Record<string, unknown>;
  kind: "investigation-opened" | "investigation-failed";
}): Result<CodexDrawdownJournalEvent, CodexDrawdownError> {
  const episodeId = stringAt({ name: "episodeId", record });
  const recordedAtIso = stringAt({ name: "recordedAtIso", record });
  if (episodeId === undefined || recordedAtIso === undefined) {
    return err(CodexDrawdownErrors.lineMalformed({ problem: `an ${kind} line is missing episodeId or recordedAtIso` }));
  }
  if (kind === "investigation-opened") {
    const workspaceRef = stringAt({ name: "workspaceRef", record });
    if (workspaceRef === undefined) {
      return err(
        CodexDrawdownErrors.lineMalformed({ problem: "an investigation-opened line is missing its workspaceRef" }),
      );
    }
    return ok({ episodeId, kind, recordedAtIso, schemaVersion: 1, workspaceRef });
  }
  return ok({
    episodeId,
    kind,
    reason: reasonOn({ record }),
    recordedAtIso,
    schemaVersion: 1,
    workspaceRef: stringAt({ name: "workspaceRef", record }),
  });
}

/**
 * Read one journal line.
 *
 * @param line one line, without its newline
 * @returns the event it holds, or why it could not be read
 */
export function parseCodexDrawdownLine({
  line,
}: {
  line: string;
}): Result<CodexDrawdownJournalEvent, CodexDrawdownError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return err(CodexDrawdownErrors.lineMalformed({ problem: "a journal line is not readable JSON" }));
  }
  if (!isRecord(parsed)) {
    return err(CodexDrawdownErrors.lineMalformed({ problem: "a journal line does not hold an object" }));
  }
  const kind = stringAt({ name: "kind", record: parsed });
  if (kind === "sample") {
    return parseSample({ record: parsed });
  }
  if (kind === "episode-opened" || kind === "episode-closed") {
    return parseEpisode({ kind, record: parsed });
  }
  if (kind === "investigation-opened" || kind === "investigation-failed") {
    return parseInvestigation({ kind, record: parsed });
  }
  return err(CodexDrawdownErrors.lineMalformed({ problem: `a journal line names an unknown kind: ${String(kind)}` }));
}

/**
 * Every reading in a journal read, which is what the baseline stands on.
 *
 * @param events the events read back
 * @returns just the samples
 */
export function codexSamplesOf({
  events,
}: {
  events: readonly CodexDrawdownJournalEvent[];
}): readonly CodexDrawdownSample[] {
  return events.filter((event): event is CodexDrawdownSample => event.kind === "sample");
}

/**
 * Which readings this tick has not already journalled.
 *
 * The watch re-opens the SAME bounded rollout tail on every tick, so most of what it reads is what it read
 * last time. Appending all of it would grow the journal without adding a single observation and — worse —
 * would make the same `token_count` event contribute to the baseline once per tick.
 *
 * @param journalled the readings already on file
 * @param read the readings this tick took
 * @returns the ones with a source event id not already present, in the order given
 */
export function unseenCodexSamples({
  journalled,
  read,
}: {
  journalled: readonly CodexDrawdownSample[];
  read: readonly CodexDrawdownSample[];
}): readonly CodexDrawdownSample[] {
  const known = new Set(journalled.map((sample) => sample.sourceEventId));
  const fresh: CodexDrawdownSample[] = [];
  for (const sample of read) {
    if (known.has(sample.sourceEventId)) {
      continue;
    }
    known.add(sample.sourceEventId);
    fresh.push(sample);
  }
  return fresh;
}

/** Whether an automatic investigation may be opened for this episode, and why not when it may not. */
export type CodexDrawdownAdmission =
  { readonly kind: "attempt" } | { readonly kind: "suppress"; readonly reason: string };

/**
 * Whether this episode has already been acted on.
 *
 * A FIRST check, not the mechanism: it reads a journal, so two watches ticking together both pass it. The
 * exclusive claim in `./drawdownJournalStore.ts` is what actually guarantees one attempt; this is here so
 * the ordinary case does not pay for a filesystem round trip and so the report can say WHY it suppressed.
 *
 * Keyed on the episode id, which names every series that fired — including each one's reset instant — so the
 * same episode on the next tick is suppressed while a genuinely new one after a reset is admitted. An
 * investigation that FAILED still suppresses: a failed spawn is not a reason to try again automatically.
 *
 * @param episodeId the episode the detector just reported
 * @param history every event already journalled
 * @returns whether to attempt, or why not
 */
export function admitCodexDrawdownInvestigation({
  episodeId,
  history,
}: {
  episodeId: string;
  history: readonly CodexDrawdownJournalEvent[];
}): CodexDrawdownAdmission {
  const already = history.find((event) => event.kind === "episode-opened" && event.episodeId === episodeId);
  if (already === undefined) {
    return { kind: "attempt" };
  }
  return {
    kind: "suppress",
    reason:
      `this episode was already acted on (${episodeId}) — a second automatic investigation is refused ` +
      "whether or not the first one opened",
  };
}
