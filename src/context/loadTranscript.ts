/**
 * What a seat's own Claude transcript says about its profile loads — the second source `./loadLedger.ts` folds.
 *
 * A hook that never RAN writes no ledger row, and neither does one killed by its bound, one whose binary is missing,
 * one that swallowed a throw, or a by-hand reload on code older than the ledger. The transcript records every one of
 * those, so this module reads them: the boot record of a hook that never ran, the `hook_success` of one that ran
 * (judged by what it PRINTED, since it exits 0 on every path), and the result of a by-hand `profile context` call.
 *
 * Its own module because it is a reader of one foreign record shape, Claude Code's transcript, where the ledger
 * module is the contract this repository writes. Pure: lines in, observations out.
 */
import { isRecord } from "../lib/parsers.js";
import { type BootHookFailure, hookLabel } from "../transcripts/bootHooks.js";

import { ALWAYS_LOADED_MARKER } from "./alwaysLoaded.js";
import { type ProfileLoadObservation, type ProfileLoadOutcome, UNLOADED_HEADLINE } from "./loadLedger.js";

/** The `scripts/hook.sh` label the profile hook registers under, in `hooks/hooks.json`. */
const PROFILE_HOOK_LABEL = "profile-context";

/**
 * What every block that found nothing says, on code older than {@link UNLOADED_HEADLINE} too: `./load.ts`'s
 * `fromCache` renders an `origin: none` load as the owner section marked `unavailable:`, whichever cache error it
 * carries. The newline is matched raw, in a by-hand report, and escaped, inside the hook's JSON envelope.
 */
const OWNER_UNAVAILABLE = /## About the owner(?:\\n|\n)unavailable: /u;

/** A by-hand `profile context` report's origin, as its last line or its `--json` field, when a profile arrived. */
const DELIVERED_ORIGIN = /^origin: (?:live|cache)\b|"origin":"(?:live|cache)"/mu;

/** A Bash command that IS a by-hand reload: `slopweaver profile context` first, after any `VAR=value` prefixes. */
const PROFILE_CONTEXT_CALL = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*slopweaver profile context(?:\s|$)/u;

/** A string field, or `undefined` when it is absent or not a string. */
function stringAt({ on, key }: { on: Record<string, unknown>; key: string }): string | undefined {
  const value = on[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * A descriptive string field, empty when it is absent or not a string — the reading `bootHooks.ts`'s boot records
 * already give the same three fields, so an observation off either source carries the same "unknown".
 */
function textAt({ on, key }: { on: Record<string, unknown>; key: string }): string {
  const value = on[key];
  return typeof value === "string" ? value : "";
}

/** Whether a printed block carries the owner's profile: the always-loaded marker, and neither form of "found nothing". */
function deliversProfile({ text }: { text: string }): boolean {
  return text.includes(ALWAYS_LOADED_MARKER) && !text.includes(UNLOADED_HEADLINE) && !OWNER_UNAVAILABLE.test(text);
}

/**
 * The observation a boot record makes, or `undefined` when the hook that never ran was not the profile hook.
 *
 * @param failure one `SessionStart` hook the transcript records as never having run
 * @param fileSessionId the transcript's own session id, for a record that names none
 * @returns the failed observation
 */
export function observationOfBootFailure({
  failure,
  fileSessionId,
}: {
  failure: BootHookFailure;
  fileSessionId: string;
}): ProfileLoadObservation | undefined {
  if (hookLabel({ command: failure.command }) !== PROFILE_HOOK_LABEL) {
    return undefined;
  }
  return {
    atIso: failure.timestamp,
    cwd: failure.cwd,
    event: failure.hookName,
    outcome: "failed",
    sessionId: failure.sessionId.length > 0 ? failure.sessionId : fileSessionId,
    why: `the ${failure.hookName} profile hook never ran (${failure.kind})`,
  };
}

/** One transcript record, parsed, or `undefined` for a line that is not a JSON object carrying a usable instant. */
function parseRecord({ line }: { line: string }): { record: Record<string, unknown>; atIso: string } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  // A load with no instant cannot be ordered against the failure it might answer, so it is no evidence at all.
  const atIso = stringAt({ key: "timestamp", on: parsed });
  if (atIso === undefined || Number.isNaN(Date.parse(atIso))) {
    return undefined;
  }
  return { atIso, record: parsed };
}

/** An observation off one parsed record, its session and directory read from the record or the file. */
function observationOn({
  parsed,
  fileSessionId,
  event,
  outcome,
  why,
}: {
  parsed: { record: Record<string, unknown>; atIso: string };
  fileSessionId: string;
  event: string;
  outcome: ProfileLoadOutcome;
  why: string;
}): ProfileLoadObservation {
  const sessionId = textAt({ key: "sessionId", on: parsed.record });
  return {
    atIso: parsed.atIso,
    cwd: textAt({ key: "cwd", on: parsed.record }),
    event,
    outcome,
    sessionId: sessionId.length > 0 ? sessionId : fileSessionId,
    why,
  };
}

/** A record's `message.content` parts, or none for a record carrying no such list. */
function contentParts({ record }: { record: Record<string, unknown> }): readonly Record<string, unknown>[] {
  const message = record["message"];
  const content = isRecord(message) ? message["content"] : undefined;
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

/**
 * The tool-use ids of every by-hand reload one transcript line calls: a `Bash` call whose command IS `slopweaver
 * profile context`. A reader carries them forward so a later result is counted only when it answers one of them.
 *
 * @param line one raw transcript line
 * @returns the ids, none for a line that calls no reload
 */
export function profileContextCalls({ line }: { line: string }): readonly string[] {
  if (!line.includes("profile context")) {
    return [];
  }
  const parsed = parseRecord({ line });
  if (parsed === undefined) {
    return [];
  }
  return contentParts({ record: parsed.record }).flatMap((part) => {
    const input = part["input"];
    const command = isRecord(input) ? stringAt({ key: "command", on: input }) : undefined;
    const id = stringAt({ key: "id", on: part });
    const reloads =
      part["type"] === "tool_use" &&
      part["name"] === "Bash" &&
      command !== undefined &&
      PROFILE_CONTEXT_CALL.test(command);
    return reloads && id !== undefined ? [id] : [];
  });
}

/** Every text the record's results for `calls` carry — what a by-hand `profile context` printed into the session. */
function reloadResultTexts({
  record,
  calls,
}: {
  record: Record<string, unknown>;
  calls: ReadonlySet<string>;
}): readonly string[] {
  return contentParts({ record })
    .filter((part) => {
      const answers = stringAt({ key: "tool_use_id", on: part });
      return part["type"] === "tool_result" && answers !== undefined && calls.has(answers);
    })
    .flatMap((part) => {
      const body = part["content"];
      if (typeof body === "string") {
        return [body];
      }
      if (!Array.isArray(body)) {
        return [];
      }
      return body.filter(isRecord).flatMap((each) => {
        const said = stringAt({ key: "text", on: each });
        return said === undefined ? [] : [said];
      });
    });
}

/**
 * The observation a profile-hook `hook_success` makes, judged by its `stdout`; `undefined` for any other record, and
 * for one recording no `stdout` at all.
 */
function observationOfHookRun({
  parsed,
  fileSessionId,
}: {
  parsed: { record: Record<string, unknown>; atIso: string };
  fileSessionId: string;
}): ProfileLoadObservation | undefined {
  const attachment = parsed.record["attachment"];
  if (!isRecord(attachment) || attachment["type"] !== "hook_success" || attachment["exitCode"] !== 0) {
    return undefined;
  }
  const command = stringAt({ key: "command", on: attachment });
  const stdout = stringAt({ key: "stdout", on: attachment });
  if (command === undefined || hookLabel({ command }) !== PROFILE_HOOK_LABEL || stdout === undefined) {
    return undefined;
  }
  const event = textAt({ key: "hookName", on: attachment });
  const name = event.length > 0 ? `${event} profile` : "profile";
  return deliversProfile({ text: stdout })
    ? observationOn({
        event,
        fileSessionId,
        outcome: "loaded",
        parsed,
        why: `the ${name} hook delivered the owner's profile`,
      })
    : observationOn({
        event,
        fileSessionId,
        outcome: "failed",
        parsed,
        why: `the ${name} hook ran and delivered no profile`,
      });
}

/**
 * The observation one transcript line makes about a load that RAN, or `undefined` for any other line.
 *
 * Two records count, both judged by what was PRINTED rather than by an exit code, because the hook exits 0 on every
 * path — killed by its bound, its binary missing, a throw it swallows — and so does a `hook_success`:
 *
 * - **The profile hook's `hook_success`.** Its `stdout` carrying the always-loaded block and neither form of "found
 *   nothing" is a load; any other `stdout` — empty, a kill notice, a STOP block — is a hook that ran and delivered no
 *   profile, a failure no ledger row records. A record with no `stdout` field says nothing either way.
 * - **The result of a by-hand `profile context` call** (see {@link profileContextCalls}) whose origin is `live` or
 *   `cache` — the reload a seat on code older than the ledger runs, which writes no row of its own. Only a result
 *   answering such a call counts, so a screen read off another seat, or source text quoting a report, is not a load.
 *
 * Read only after `readBootHookFailure` has said the line is not a failure — `hook.sh`'s missing-target line is a
 * `hook_success` too.
 *
 * @param line one raw transcript line
 * @param fileSessionId the transcript's own session id, for a record that names none
 * @param contextCalls every by-hand reload call this transcript made before the line
 * @returns the observation, or `undefined` for a line that records no run of a load
 */
export function observationOfTranscriptLoad({
  line,
  fileSessionId,
  contextCalls,
}: {
  line: string;
  fileSessionId: string;
  contextCalls: ReadonlySet<string>;
}): ProfileLoadObservation | undefined {
  const hookCandidate = line.includes(PROFILE_HOOK_LABEL) && line.includes('"hook_success"');
  const reloadCandidate = contextCalls.size > 0 && line.includes(ALWAYS_LOADED_MARKER);
  const parsed = hookCandidate || reloadCandidate ? parseRecord({ line }) : undefined;
  if (parsed === undefined) {
    return undefined;
  }
  const hookRun = observationOfHookRun({ fileSessionId, parsed });
  if (hookRun !== undefined || !reloadCandidate) {
    return hookRun;
  }
  const printed = reloadResultTexts({ calls: contextCalls, record: parsed.record }).some(
    (body) => deliversProfile({ text: body }) && DELIVERED_ORIGIN.test(body),
  );
  return printed
    ? observationOn({
        event: "by-hand",
        fileSessionId,
        outcome: "loaded",
        parsed,
        why: "a by-hand `profile context` printed the owner's profile",
      })
    : undefined;
}
