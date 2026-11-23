/**
 * Reading a worker session's own command log — where the card's `now:` line comes from.
 *
 * ## Why this source and not the two obvious alternatives
 *
 * **Not the terminal screen.** `./liveStatus.ts` scrapes the last non-blank line off the workspace's screen,
 * which is whatever tool OUTPUT happened to land there — the filed `progress-card-shows-rc-instead-of-live-
 * status` defect. A screen has no grammar; a command log does.
 *
 * **Not the cmux hook event stream.** Measured over 400 live events: every field it carries is
 * `category, cwd, id, name, occurredAtIso, phase, seq, sessionId, surfaceId, workspaceId, toolName` —
 * reproduce with `slopweaver cmux events --limit 400 --json`. The tool NAME and no input, so the best line
 * that stream can render is `now: Bash`, which tells a reader nothing they did not already know.
 *
 * A Claude Code session records every tool call it makes, with the full input and a timestamp, in its own
 * transcript under `~/.claude/projects/<cwd-slug>/<session-id>.jsonl`. That is the only local source that
 * carries the TARGET, and it is written by the harness rather than by the model, so reading it costs the
 * worker nothing and cannot be forgotten mid-investigation the way a self-report can.
 *
 * **Its honest limit, stated rather than discovered:** the path shape is Claude Code's. A Codex worker
 * records nothing here, so {@link latestWorkerActivity} finds no calls and the card falls back to a
 * targetless line — degraded, never wrong. Every worker this loop dispatches today is Claude Code
 * (`live/turn/dispatch.ts` boots `claude`), so the fallback is the rare path, not the normal one.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { isRecord } from "../../lib/parsers.js";
import type { WorkerActivity } from "./progressCard.js";

/**
 * How much of a command is worth showing on one card line before it stops being a subject and starts being noise.
 *
 * @internal
 */
export const TARGET_CAP = 64;

/**
 * The tool-input keys that name what a call is ABOUT, in the order they are preferred.
 *
 * `command` first because a Bash call is most of what a worker does and its own text is the most specific
 * thing on the card. The rest are the single-value tools whose input names a subject directly.
 */
const TARGET_KEYS: readonly string[] = ["command", "file_path", "pattern", "url", "query", "path"];

/**
 * A literal string, safe to splice into a `RegExp` source. Every regex-special character is escaped so the
 * text can only ever match itself — load-bearing here because {@link HOME_SLUG_PATTERN} and
 * {@link HOME_RAW_PATTERN} are built from this machine's own home directory at runtime, not typed in.
 *
 * @param text the literal text to escape
 * @returns the text with every regex-special character escaped
 */
function escapeRegExp({ text }: { text: string }): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * This machine's home directory, run through the SAME slug Claude Code applies to a cwd when it names a
 * project directory ({@link transcriptProjectDir}, every non-alphanumeric character becomes a dash).
 *
 * This is the shape that actually leaked — measured: a live card rendered `now: Bash —
 * SP=/private/tmp/claude-501/-Users-ada-owner-ctr-dev-personal-…`. That scratchpad path is minted from
 * this same slug (`$SLOPWEAVER_SCRATCHPAD`-style paths are `/private/tmp/claude-501/<slugged-cwd>/…`), so
 * by the time it reaches a worker's `command` argv the leading `/Users/…` has already lost every slash that
 * the hygiene gate's own `absolute-home-path` class requires — that pattern alone would have missed this
 * exact incident, which is why this scrubs the slugged form as its own class rather than trusting the
 * generic one to catch it.
 */
const HOME_SLUG_PATTERN = new RegExp(escapeRegExp({ text: homedir().replace(/[^a-zA-Z0-9]/g, "-") }), "g");

/** This machine's home directory in its ordinary, un-slugged form — still worth scrubbing directly. */
const HOME_RAW_PATTERN = new RegExp(escapeRegExp({ text: homedir() }), "g");

/**
 * The leak classes {@link shortTarget} must never let through onto a TEAM-VISIBLE card. A Bash `command` or
 * a `file_path` is raw argv from the worker's own transcript, and nothing upstream of this function has
 * ever sanitised it.
 *
 * The generic path and id shapes are copied from the public hygiene gate's own classes rather than imported
 * — reproduce the parity with `grep -n 'absolute-home-path\|raw-workspace-id' src/hygiene/scan.ts` — because
 * that gate scans committed files with a private denylist and this scrubs one argv string with neither
 * nearby; `../turn/freeze/redact.ts` keeps its own copy for the identical reason. Token shapes are copied
 * from `../../corpus/redact.ts`'s `PASSES` for the same reason a leaked credential must never survive a
 * shortened command either, even though a card is not the corpus. {@link HOME_SLUG_PATTERN} and
 * {@link HOME_RAW_PATTERN} are this file's own addition, for the reason documented on {@link HOME_SLUG_PATTERN}.
 */
const LEAK_CLASSES: readonly { readonly re: RegExp; readonly placeholder: string }[] = [
  { placeholder: "[token]", re: /xox[bp]-[A-Za-z0-9-]{10,}/g },
  { placeholder: "[token]", re: /gh[posr]_[A-Za-z0-9]{20,}/g },
  { placeholder: "[token]", re: /github_pat_[A-Za-z0-9_]{20,}/g },
  { placeholder: "[token]", re: /secret_[A-Za-z0-9]{16,}/g },
  { placeholder: "[token]", re: /sk-[A-Za-z0-9]{20,}/g },
  { placeholder: "[token]", re: /Bearer\s+[A-Za-z0-9._-]{12,}/g },
  { placeholder: "[path]", re: /\/(?:Users|home)\/[A-Za-z0-9._-]+/g },
  { placeholder: "[path]", re: HOME_SLUG_PATTERN },
  { placeholder: "[path]", re: HOME_RAW_PATTERN },
  { placeholder: "[id]", re: /\b(?=[A-Z0-9]*[0-9])[CUAWDGTE][A-Z0-9]{8,}\b/g },
];

/**
 * Placeholder every leak-class match in one string. Pure.
 *
 * @param text the text to scrub
 * @returns the text with every leak-class match replaced by its class placeholder
 */
export function sanitiseLeakClasses({ text }: { text: string }): string {
  let out = text;
  for (const { re, placeholder } of LEAK_CLASSES) {
    out = out.replace(re, placeholder);
  }
  return out;
}

/**
 * The directory Claude Code writes one project's transcripts into — its cwd with every non-alphanumeric
 * character replaced by a dash, under `~/.claude/projects`.
 *
 * @param cwd the session's working directory
 * @returns the absolute project directory
 * @internal
 */
export function transcriptProjectDir({ cwd }: { cwd: string }): string {
  return join(homedir(), ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
}

/**
 * Where one Claude Code session's transcript lives.
 *
 * @param cwd the session's working directory
 * @param sessionId the session's own id, as `CLAUDE_CODE_SESSION_ID` carries it
 * @returns the absolute transcript path
 */
export function transcriptPath({ cwd, sessionId }: { cwd: string; sessionId: string }): string {
  return join(transcriptProjectDir({ cwd }), `${sessionId}.jsonl`);
}

/**
 * Shorten one tool input to a card-sized subject. Pure.
 *
 * Collapses whitespace first, because a heredoc or a multi-line python block would otherwise put a newline
 * on a Slack line and break the step it sits under. Sanitises {@link LEAK_CLASSES} BEFORE capping length —
 * a leak class near the end of a long command must lose its shape before truncation can hide the fact that
 * it was ever there.
 *
 * @param raw the raw input value
 * @returns the clamped single-line subject, or `undefined` when there is nothing worth showing
 */
export function shortTarget({ raw }: { raw: string }): string | undefined {
  const collapsed = sanitiseLeakClasses({ text: raw.replace(/\s+/g, " ").trim() });
  if (collapsed.length === 0) {
    return undefined;
  }
  return collapsed.length <= TARGET_CAP ? collapsed : `${collapsed.slice(0, TARGET_CAP - 1)}…`;
}

/**
 * Decode one transcript line into the tool calls it records. Total — a line that is not JSON, or carries no
 * tool call, yields nothing rather than throwing.
 *
 * @param line one raw JSONL line from a session transcript
 * @returns the tool calls on that line, in order
 */
export function decodeTranscriptLine({ line }: { line: string }): readonly WorkerActivity[] {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return [];
  }
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!isRecord(value)) {
    return [];
  }
  const tsIso = value["timestamp"];
  const message = value["message"];
  if (typeof tsIso !== "string" || !isRecord(message)) {
    return [];
  }
  const content = message["content"];
  if (!Array.isArray(content)) {
    return [];
  }
  const calls: WorkerActivity[] = [];
  for (const part of content) {
    if (!isRecord(part)) {
      continue;
    }
    const tool = part["name"];
    if (part["type"] !== "tool_use" || typeof tool !== "string") {
      continue;
    }
    const input = part["input"];
    calls.push({ target: isRecord(input) ? firstTarget({ input }) : undefined, tool, tsIso });
  }
  return calls;
}

/**
 * The first {@link TARGET_KEYS} entry an input actually carries, shortened. Pure.
 *
 * @param input one tool call's own input object
 * @returns the subject to show, or `undefined` when the input names none
 */
function firstTarget({ input }: { input: Record<string, unknown> }): string | undefined {
  for (const key of TARGET_KEYS) {
    const raw = input[key];
    if (typeof raw === "string") {
      const short = shortTarget({ raw });
      if (short !== undefined) {
        return short;
      }
    }
  }
  return undefined;
}

/**
 * Fold a whole transcript's text into what the card needs: the most recent tool call, and how many there
 * have been since the turn started. Pure.
 *
 * `sinceIso` scopes the count to THIS turn rather than the session's whole life, which matters because a
 * worker session is opened per ask but the file it writes is append-only from the moment it boots.
 *
 * @param sinceIso only count calls at or after this instant
 * @param text the transcript file's contents
 * @returns the latest call and the count, both possibly empty
 */
export function foldWorkerLog({ sinceIso, text }: { sinceIso: string; text: string }): {
  readonly latest: WorkerActivity | undefined;
  readonly callsSoFar: number;
} {
  const since = Date.parse(sinceIso);
  let latest: WorkerActivity | undefined;
  let callsSoFar = 0;
  for (const line of text.split("\n")) {
    for (const call of decodeTranscriptLine({ line })) {
      const at = Date.parse(call.tsIso);
      if (Number.isNaN(at) || (!Number.isNaN(since) && at < since)) {
        continue;
      }
      callsSoFar++;
      latest = call;
    }
  }
  return { callsSoFar, latest };
}

/**
 * Read one worker session's command log. A missing or unreadable transcript is an EMPTY fold, never an
 * error: the card must still render for a Codex worker, or before the first tool call lands.
 *
 * @param cwd the worker session's working directory
 * @param sessionId the worker session's own id
 * @param sinceIso only count calls at or after this instant
 * @returns the latest call and the count
 */
export function latestWorkerActivity({
  cwd,
  sessionId,
  sinceIso,
}: {
  cwd: string;
  sessionId: string;
  sinceIso: string;
}): { readonly latest: WorkerActivity | undefined; readonly callsSoFar: number } {
  try {
    return foldWorkerLog({ sinceIso, text: readFileSync(transcriptPath({ cwd, sessionId }), "utf8") });
  } catch {
    return { callsSoFar: 0, latest: undefined };
  }
}
