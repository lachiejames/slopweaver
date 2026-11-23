/**
 * Lazy manifest for the `transcripts` noun — structured access to the Claude session transcripts this
 * machine keeps under `~/.claude/projects`.
 *
 * `effect: "external-read"` rather than `"none"`: every verb reads files outside `$SLOPWEAVER_HOME`.
 * Nothing here writes anywhere, and nothing here runs a model.
 *
 * There is deliberately **no search verb**, and the absence is the design. A lexical sweep over this corpus
 * counts mentions rather than friction, and a sweeping session's own output is echoed back into its own
 * transcript, so its top hits are its own words. Every verb below asks a structured question instead —
 * roles, counts, `tool_result.is_error`, the human turns.
 *
 * The bare noun resolves to `sessions`, the cheapest verb (it stats files and reads none of them), so a
 * bare `slopweaver transcripts` can never start a multi-gigabyte walk by accident.
 */
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

const sharedMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "external-read",
  parseRejectIsIoFree: true,
} as const;

const sessionsMeta = {
  ...sharedMeta,
  // `sessions` takes no required scope (`requireScope: false` in run.ts), so a bare run stats and lists every transcript.
  dryParseSafe: false,
  example: "slopweaver transcripts sessions --since 7d",
  summary: "Every Claude session transcript on this machine, newest first, with the measured retention floor stated",
  usage:
    "usage: slopweaver transcripts sessions [--projects <dir>] [--since <value>] [--until <value>] [--project <value>] [--limit <value>] [--json]",
} as const;

const loadSessions = () => import("../commands/transcripts/run.js").then((m) => m.transcriptsSessionsCommand);

/** The `transcripts` noun's verbs as lazy manifest entries. */
export const transcriptsManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadSessions, meta: sessionsMeta }),
  "boot-hooks": lazy({
    load: () => import("../commands/transcripts/bootHooks.js").then((m) => m.transcriptsBootHooksCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver transcripts boot-hooks --since 1d",
      summary:
        "Every SessionStart hook in scope a transcript records as never run — a command the shell could not find, or a missing hook.sh target — exiting 1 on any, or on a transcript it could not read whole",
      usage:
        "usage: slopweaver transcripts boot-hooks [--session <value>] [--projects <dir>] [--since <value>] [--until <value>] [--project <value>] [--limit <value>] [--json]",
    },
  }),
  draw: lazy({
    load: () => import("../commands/transcripts/draw.js").then((m) => m.transcriptsDrawCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver transcripts draw --session a0000060-0000-4000-8000-000000000066 --from-tick 14 --to-tick 44",
      summary:
        "What each verb a session ran cost it in MEASURED tokens per tick — added, and carried by every later call — with the stale-seat preamble's share, and every cap refusal it retried with what the lap spent",
      usage:
        "usage: slopweaver transcripts draw [--session <value>] [--projects <dir>] [--since <value>] [--until <value>] [--project <value>] [--from-tick <n>] [--to-tick <n>] [--verb <head>] [--limit <value>] [--json]",
    },
  }),
  errors: lazy({
    load: () => import("../commands/transcripts/run.js").then((m) => m.transcriptsErrorsCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver transcripts errors --since 2d --limit 20",
      summary: "Every tool call in scope that came back an error, named with the tool that produced it",
      usage:
        "usage: slopweaver transcripts errors [--session <value>] [--projects <dir>] [--since <value>] [--until <value>] [--project <value>] [--limit <value>] [--json]",
    },
  }),
  "last-turn": lazy({
    load: () => import("../commands/transcripts/lastTurn.js").then((m) => m.transcriptsLastTurnCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver transcripts last-turn --session a0000018-0000-4000-8000-000000000021 --json",
      summary:
        "One session's latest turn as ordered parts — the words that opened it, then text, thinking and tool calls joined to their results — and, with --turns, the turns before it",
      usage: "usage: slopweaver transcripts last-turn --session <id> [--turns <n>] [--projects <dir>] [--json]",
    },
  }),
  latency: lazy({
    load: () => import("../commands/transcripts/latencyRun.js").then((m) => m.transcriptsLatencyCommand),
    meta: {
      ...sharedMeta,
      example:
        "slopweaver transcripts latency --since 2d --tool Bash --command-prefix 'git ' --split 2026-09-15T03:28:54Z",
      summary:
        "How long each tool call took, from its call record to its result record — bucketed, and split before/after an instant",
      usage:
        "usage: slopweaver transcripts latency [--session <value>] [--projects <dir>] [--since <value>] [--until <value>] [--project <value>] [--tool <value>] [--command-prefix <value>] [--split <value>] [--bucket <value>] [--limit <value>] [--json]",
    },
  }),
  sessions: lazy({ load: loadSessions, meta: sessionsMeta }),
  summary: lazy({
    load: () => import("../commands/transcripts/run.js").then((m) => m.transcriptsSummaryCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver transcripts summary --since 7d",
      summary: "Turn counts by role, the autonomy ratio, tool-error count and span for the sessions in scope",
      usage:
        "usage: slopweaver transcripts summary [--session <value>] [--projects <dir>] [--since <value>] [--until <value>] [--project <value>] [--json]",
    },
  }),
  turns: lazy({
    load: () => import("../commands/transcripts/run.js").then((m) => m.transcriptsTurnsCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver transcripts turns --since 3d --limit 30",
      summary: "The turns a person actually took — every tool result, reminder, wrapper and notification stripped",
      usage:
        "usage: slopweaver transcripts turns [--session <value>] [--projects <dir>] [--since <value>] [--until <value>] [--project <value>] [--limit <value>] [--full] [--json]",
    },
  }),
};
