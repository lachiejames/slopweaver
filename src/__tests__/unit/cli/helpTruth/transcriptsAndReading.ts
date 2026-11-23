/**
 * The help-truth tables' rows for `transcripts`, `reading`, `sop`, `distil` and `value` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { DISTIL_ANSWER_FLAG_NAMES, parseDistilAnswerArgs } from "../../../../cli/commands/distil/answer.js";
import { DISTIL_BRIEF_FLAG_NAMES, parseDistilBriefArgs } from "../../../../cli/commands/distil/brief.js";
import { parseDistilPlanOptions } from "../../../../cli/commands/distil/core.js";
import { DISTIL_STATUS_FLAG_NAMES } from "../../../../cli/commands/distil/status.js";
import {
  parseReadingLastArgs,
  parseReadingListArgs,
  parseReadingRecordArgs,
  READING_LAST_FLAG_NAMES,
  READING_LIST_FLAG_NAMES,
  READING_RECORD_FLAG_NAMES,
} from "../../../../cli/commands/reading/core.js";
import {
  parseSopDraftArgs,
  parseSopLintArgs,
  parseSopPublishArgs,
  SOP_DRAFT_FLAG_NAMES,
  SOP_LINT_FLAG_NAMES,
  SOP_PUBLISH_FLAG_NAMES,
} from "../../../../cli/commands/sop/core.js";
import {
  parseTranscriptsBootHooksArgs,
  parseTranscriptsDrawArgs,
  parseTranscriptsErrorsArgs,
  parseTranscriptsLatencyArgs,
  parseTranscriptsSessionsArgs,
  parseTranscriptsSummaryArgs,
  parseTranscriptsTurnsArgs,
  TRANSCRIPTS_BOOT_HOOKS_FLAG_NAMES,
  TRANSCRIPTS_DRAW_FLAG_NAMES,
  TRANSCRIPTS_ERRORS_FLAG_NAMES,
  TRANSCRIPTS_LATENCY_FLAG_NAMES,
  TRANSCRIPTS_SESSIONS_FLAG_NAMES,
  TRANSCRIPTS_SUMMARY_FLAG_NAMES,
  TRANSCRIPTS_TURNS_FLAG_NAMES,
} from "../../../../cli/commands/transcripts/core.js";
import {
  parseTranscriptsLastTurnArgs,
  TRANSCRIPTS_LAST_TURN_FLAG_NAMES,
} from "../../../../cli/commands/transcripts/lastTurn.js";
import {
  parseValueAnswerArgs,
  parseValueSampleArgs,
  VALUE_ANSWER_FLAG_NAMES,
  VALUE_SAMPLE_FLAG_NAMES,
} from "../../../../cli/commands/value/core.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

/**
 * A valid `distil answer` invocation: unlike `turn answer`/`ask answer`, `parseDistilAnswerArgs` checks
 * `--brief`/`--answer` are present INSIDE the tokenising parser itself (not in a separate downstream
 * requiredness check), so a single-flag probe of just `--brief` would fail on the OTHER required flag
 * being absent — never on `--brief` itself. Bundling both, like `GITHUB_MERGE_BASE_PROBE`, removes that
 * false negative.
 */
const DISTIL_ANSWER_BASE_PROBE: readonly string[] = [
  "--brief",
  "/tmp/distil-brief.json",
  "--answer",
  "/tmp/distil-answer.json",
];

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  distil: DISTIL_BRIEF_FLAG_NAMES,
  "distil answer": DISTIL_ANSWER_FLAG_NAMES,
  "distil brief": DISTIL_BRIEF_FLAG_NAMES,
  "distil status": DISTIL_STATUS_FLAG_NAMES,
  "reading last": READING_LAST_FLAG_NAMES,
  "reading list": READING_LIST_FLAG_NAMES,
  "reading record": READING_RECORD_FLAG_NAMES,
  "sop draft": SOP_DRAFT_FLAG_NAMES,
  "sop lint": SOP_LINT_FLAG_NAMES,
  "sop publish": SOP_PUBLISH_FLAG_NAMES,
  transcripts: TRANSCRIPTS_SESSIONS_FLAG_NAMES,
  "transcripts boot-hooks": TRANSCRIPTS_BOOT_HOOKS_FLAG_NAMES,
  "transcripts draw": TRANSCRIPTS_DRAW_FLAG_NAMES,
  "transcripts errors": TRANSCRIPTS_ERRORS_FLAG_NAMES,
  "transcripts last-turn": TRANSCRIPTS_LAST_TURN_FLAG_NAMES,
  "transcripts latency": TRANSCRIPTS_LATENCY_FLAG_NAMES,
  "transcripts sessions": TRANSCRIPTS_SESSIONS_FLAG_NAMES,
  "transcripts summary": TRANSCRIPTS_SUMMARY_FLAG_NAMES,
  "transcripts turns": TRANSCRIPTS_TURNS_FLAG_NAMES,
  "value answer": VALUE_ANSWER_FLAG_NAMES,
  "value sample": VALUE_SAMPLE_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  transcripts: {
    "--json": ["--json"],
    "--limit": ["--limit", "5"],
    "--project": ["--project", "slopweaver"],
    "--projects": ["--projects", "/tmp"],
    "--since": ["--since", "7d"],
    "--until": ["--until", "2026-08-20"],
  },
  "transcripts boot-hooks": {
    "--json": ["--json"],
    "--limit": ["--limit", "5"],
    "--project": ["--project", "slopweaver"],
    "--projects": ["--projects", "/tmp"],
    "--session": ["--session", "a-session-id"],
    "--since": ["--since", "7d"],
    "--until": ["--until", "2026-08-20"],
  },
  "transcripts draw": {
    "--from-tick": ["--from-tick", "14"],
    "--json": ["--json"],
    "--limit": ["--limit", "5"],
    "--project": ["--project", "slopweaver"],
    "--projects": ["--projects", "/tmp"],
    "--session": ["--session", "a-session-id"],
    "--since": ["--since", "7d"],
    "--to-tick": ["--to-tick", "44"],
    "--until": ["--until", "2026-08-20"],
    "--verb": ["--verb", "Read"],
  },
  "transcripts errors": {
    "--json": ["--json"],
    "--limit": ["--limit", "5"],
    "--project": ["--project", "slopweaver"],
    "--projects": ["--projects", "/tmp"],
    "--session": ["--session", "a-session-id"],
    "--since": ["--since", "7d"],
    "--until": ["--until", "2026-08-20"],
  },
  "transcripts last-turn": {
    "--json": ["--json"],
    "--projects": ["--projects", "/tmp"],
    "--session": ["--session", "a0000018-0000-4000-8000-000000000021"],
    "--turns": ["--turns", "3"],
  },
  "transcripts latency": {
    "--bucket": ["--bucket", "60"],
    "--command-prefix": ["--command-prefix", "git "],
    "--json": ["--json"],
    "--limit": ["--limit", "5"],
    "--project": ["--project", "slopweaver"],
    "--projects": ["--projects", "/tmp"],
    "--session": ["--session", "a-session-id"],
    "--since": ["--since", "7d"],
    "--split": ["--split", "2026-09-15T03:28:54Z"],
    "--tool": ["--tool", "Bash"],
    "--until": ["--until", "2026-08-20"],
  },
  "transcripts sessions": {
    "--json": ["--json"],
    "--limit": ["--limit", "5"],
    "--project": ["--project", "slopweaver"],
    "--projects": ["--projects", "/tmp"],
    "--since": ["--since", "7d"],
    "--until": ["--until", "2026-08-20"],
  },
  "transcripts summary": {
    "--json": ["--json"],
    "--project": ["--project", "slopweaver"],
    "--projects": ["--projects", "/tmp"],
    "--session": ["--session", "a-session-id"],
    "--since": ["--since", "7d"],
    "--until": ["--until", "2026-08-20"],
  },
  "transcripts turns": {
    "--full": ["--full"],
    "--json": ["--json"],
    "--limit": ["--limit", "5"],
    "--project": ["--project", "slopweaver"],
    "--projects": ["--projects", "/tmp"],
    "--session": ["--session", "a-session-id"],
    "--since": ["--since", "7d"],
    "--until": ["--until", "2026-08-20"],
  },
  "distil answer": {
    // --brief/--answer are REQUIRED, so every probe bundles both — same shape as GITHUB_MERGE_BASE_PROBE.
    "--answer": DISTIL_ANSWER_BASE_PROBE,
    "--brief": DISTIL_ANSWER_BASE_PROBE,
    "--corpus": [...DISTIL_ANSWER_BASE_PROBE, "--corpus", "/tmp"],
    "--home": [...DISTIL_ANSWER_BASE_PROBE, "--home", "/tmp"],
    "--max-per-batch": [...DISTIL_ANSWER_BASE_PROBE, "--max-per-batch", "10"],
    "--recent-only": [...DISTIL_ANSWER_BASE_PROBE, "--recent-only"],
    "--top-containers": [...DISTIL_ANSWER_BASE_PROBE, "--top-containers", "3"],
  },
  "distil brief": {
    "--accept-prompt-change": ["--accept-prompt-change"],
    "--corpus": ["--corpus", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--max-per-batch": ["--max-per-batch", "10"],
    "--out": ["--out", "/tmp/distil-brief.json"],
    "--recent-only": ["--recent-only"],
    "--top-containers": ["--top-containers", "3"],
  },
  "distil status": {
    "--corpus": ["--corpus", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--max-per-batch": ["--max-per-batch", "10"],
    "--recent-only": ["--recent-only"],
    "--top-containers": ["--top-containers", "3"],
  },
  "reading last": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--producer": ["--producer", "github landing"],
  },
  "reading list": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--producer": ["--producer", "github landing"],
  },
  "reading record": {
    "--by": ["--by", "tick-12"],
    "--from": ["--from", "/tmp/landing.json"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--observed-at": ["--observed-at", "2026-09-20T02:00:00Z"],
    "--producer": ["--producer", "github landing"],
  },
  "sop draft": {
    "--form": [],
    "--form-example": ["--form-example"],
    "--json": ["--json"],
    "--out": ["--out", "/tmp/draft.md"],
  },
  "sop lint": {
    "--json": ["--json"],
  },
  "sop publish": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--icon": ["--icon", "📋"],
    "--json": ["--json"],
    "--page": ["--page", "39100000-0000-8102-a2f7-d1d8ef1fe6b0"],
    "--parent": ["--parent", "39100000-0000-8102-a2f7-d1d8ef1fe6b0"],
    "--title": ["--title", "SOP: A title"],
  },
  "value answer": {
    "--answer": ["--answer", "used"],
    "--home": ["--home", "/tmp"],
    "--slug": ["--slug", "acme-export-row"],
    "--week": ["--week", "2026-W47"],
  },
  "value sample": {
    "--home": ["--home", "/tmp"],
    "--projects-dir": ["--projects-dir", "/tmp"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  distil: ({ fragment }) => parseDistilBriefArgs({ rest: [...fragment] }),
  "distil answer": ({ fragment }) => parseDistilAnswerArgs({ rest: [...fragment] }),
  "distil brief": ({ fragment }) => parseDistilBriefArgs({ rest: [...fragment] }),
  "distil status": ({ fragment }) => parseDistilPlanOptions({ rest: [...fragment] }),
  "reading last": ({ fragment }) => parseReadingLastArgs({ rest: [...fragment] }),
  "reading list": ({ fragment }) => parseReadingListArgs({ rest: [...fragment] }),
  "reading record": ({ fragment }) => parseReadingRecordArgs({ rest: [...fragment] }),
  "sop draft": ({ fragment }) => parseSopDraftArgs({ rest: ["--form", "-", ...fragment] }),
  "sop lint": ({ fragment }) => parseSopLintArgs({ rest: ["draft.md", ...fragment] }),
  "sop publish": ({ fragment }) => parseSopPublishArgs({ rest: ["draft.md", ...fragment] }),
  transcripts: ({ fragment }) => parseTranscriptsSessionsArgs({ rest: [...fragment] }),
  "transcripts boot-hooks": ({ fragment }) => parseTranscriptsBootHooksArgs({ rest: [...fragment] }),
  "transcripts draw": ({ fragment }) => parseTranscriptsDrawArgs({ rest: [...fragment] }),
  "transcripts errors": ({ fragment }) => parseTranscriptsErrorsArgs({ rest: [...fragment] }),
  "transcripts last-turn": ({ fragment }) => parseTranscriptsLastTurnArgs({ rest: [...fragment] }),
  "transcripts latency": ({ fragment }) => parseTranscriptsLatencyArgs({ rest: [...fragment] }),
  "transcripts sessions": ({ fragment }) => parseTranscriptsSessionsArgs({ rest: [...fragment] }),
  "transcripts summary": ({ fragment }) => parseTranscriptsSummaryArgs({ rest: [...fragment] }),
  "transcripts turns": ({ fragment }) => parseTranscriptsTurnsArgs({ rest: [...fragment] }),
  "value answer": ({ fragment }) => parseValueAnswerArgs({ rest: [...fragment] }),
  "value sample": ({ fragment }) => parseValueSampleArgs({ rest: [...fragment] }),
};

/** The rows for `transcripts`, `reading`, `sop`, `distil` and `value`. */
export const transcriptsAndReadingSlice: HelpTruthSlice = { guarded, probes, parsers };
