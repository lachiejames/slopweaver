/**
 * Lazy manifest for the `reflect` noun — the self-improvement loop's own readers over how this system
 * actually behaved, as opposed to what it was asked to do.
 *
 * `telemetry` only READS Datadog (Claude Code's own OTLP export) and writes nothing anywhere, so it is
 * not `doorRouted` — the same `effect: "external-read"` classification the `datadog` verbs carry.
 *
 * `brief` makes no network call at all: it reads local ledgers and appends to two of its own under
 * `$SLOPWEAVER_HOME/ledgers/reflect`, which is `local-state` — the product working normally — and therefore
 * also not `doorRouted`. The autonomy ceiling is the owner's ruling and it is enforced by what the verb
 * does not do: no board doc, no pull request, no message, nothing outside the machine.
 *
 * `board` — the standing grooming leg (board-grooming-is-a-standing-practice) — is the same shape as
 * `brief`: reads `$SLOPWEAVER_HOME/handovers` and `runs` and writes nothing at all, not even its own
 * ledger, so `local-state` and not `doorRouted` for the identical reason.
 *
 * `friction-review` reads `$SLOPWEAVER_HOME/morning`'s dated reports and its own small publish stamp under
 * `live/friction-review`; `--mark-published` writes only that stamp and `--republish` adds one local page
 * under `pages/` — never a provider, so `local-state` and not `doorRouted` for the same reason `brief` is.
 *
 * `grade` is the loop's writer for its own grades: one row appended to the same `ledgers/reflect/seen.jsonl`
 * `brief` writes, carrying the owner's keep/adjust/drop and what closed the finding — `local-state`, not
 * `doorRouted`, for the identical reason.
 */
import {
  REFLECT_BOARD_USAGE,
  REFLECT_BRIEF_USAGE,
  REFLECT_FRICTION_REVIEW_USAGE,
  REFLECT_GRADE_USAGE,
  REFLECT_TELEMETRY_USAGE,
} from "../commands/reflect/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const reflectManifest: Readonly<Record<string, VerbManifestEntry>> = {
  board: lazy({
    load: () => import("../commands/reflect/boardRun.js").then((m) => m.reflectBoardCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver reflect board --json",
      parseRejectIsIoFree: true,
      summary:
        "Report the orchestration board's own hygiene — episodic docs, no-probe docs, malformed doneWhen, dead blockedBy, stale ready docs — write nothing",
      usage: REFLECT_BOARD_USAGE,
    },
  }),
  brief: lazy({
    load: () => import("../commands/reflect/briefRun.js").then((m) => m.reflectBriefCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver reflect brief --from 24h",
      parseRejectIsIoFree: true,
      summary: "Mine the day's local friction ledgers, rank it, cap it at five, and say what the window could not show",
      usage: REFLECT_BRIEF_USAGE,
    },
  }),
  "friction-review": lazy({
    load: () => import("../commands/reflect/frictionReviewRun.js").then((m) => m.reflectFrictionReviewCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver reflect friction-review --republish",
      parseRejectIsIoFree: true,
      summary: "Report whether the Friction Review page is behind the newest self-improvement report, and republish it",
      usage: REFLECT_FRICTION_REVIEW_USAGE,
    },
  }),
  grade: lazy({
    load: () => import("../commands/reflect/gradeRun.js").then((m) => m.reflectGradeCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver reflect grade 3f9c6360f9a2 drop --why 'already covered'",
      parseRejectIsIoFree: true,
      summary:
        "Record the owner's keep/adjust/drop on a surfaced finding, and what closed it, so the next brief reads its own history",
      usage: REFLECT_GRADE_USAGE,
    },
  }),
  telemetry: lazy({
    load: () => import("../commands/reflect/telemetryRun.js").then((m) => m.reflectTelemetryCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver reflect telemetry --from 24h --json",
      parseRejectIsIoFree: true,
      summary: "Read which tool calls FAILED from Claude Code's own telemetry, and name what the window could not show",
      usage: REFLECT_TELEMETRY_USAGE,
    },
  }),
};
