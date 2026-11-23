/**
 * The help-truth tables' rows for `turn`'s run verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { parseTurnBriefArgs } from "../../../../cli/commands/turn/brief.js";
import {
  TURN_BRIEF_FLAG_SPEC,
  TURN_DISPATCH_FLAG_SPEC,
  TURN_FREEZE_FLAG_SPEC,
  TURN_RESUME_FLAG_SPEC,
  TURN_REVIEW_FLAG_SPEC,
  TURN_STATUS_FLAG_NAMES,
} from "../../../../cli/commands/turn/core.js";
import { parseTurnDispatchArgs } from "../../../../cli/commands/turn/dispatchArgs.js";
import { parseTurnFreezeArgs } from "../../../../cli/commands/turn/freeze.js";
import { parseTurnResumeArgs } from "../../../../cli/commands/turn/resume.js";
import { parseTurnReviewArgs } from "../../../../cli/commands/turn/review.js";
import { parseTurnArgs, TURN_FLAG_NAMES } from "../../../../cli/commands/turn/run.js";
import { parseTurnStatusArgs } from "../../../../cli/commands/turn/status.js";
import { parseTurnWatchArgs, TURN_WATCH_FLAG_NAMES } from "../../../../cli/commands/turn/watchArgs.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

/** `turn brief`'s advertised flags, derived from the spec the verb parses with. */
const TURN_BRIEF_FLAG_NAMES: readonly string[] = [
  ...TURN_BRIEF_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_BRIEF_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `turn dispatch`'s advertised flags, derived from the spec the verb parses with. */
const TURN_DISPATCH_FLAG_NAMES: readonly string[] = [
  ...TURN_DISPATCH_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_DISPATCH_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `turn resume`'s advertised flags, derived from the spec the verb parses with. */
const TURN_RESUME_FLAG_NAMES: readonly string[] = [
  ...TURN_RESUME_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_RESUME_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `turn review`'s advertised flags, derived from the spec the verb parses with. */
const TURN_REVIEW_FLAG_NAMES: readonly string[] = [
  ...TURN_REVIEW_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_REVIEW_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** `turn freeze`'s advertised flags, derived from the spec the verb parses with. */
const TURN_FREEZE_FLAG_NAMES: readonly string[] = [
  ...TURN_FREEZE_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_FREEZE_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "turn answer": TURN_FLAG_NAMES,
  "turn brief": TURN_BRIEF_FLAG_NAMES,
  "turn dispatch": TURN_DISPATCH_FLAG_NAMES,
  "turn freeze": TURN_FREEZE_FLAG_NAMES,
  "turn resume": TURN_RESUME_FLAG_NAMES,
  "turn review": TURN_REVIEW_FLAG_NAMES,
  "turn status": TURN_STATUS_FLAG_NAMES,
  "turn watch": TURN_WATCH_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "turn answer": {
    "--accounted-for-ts": ["--accounted-for-ts", "1785000000.000300"],
    "--answer": ["--answer", "/tmp/answer.json"],
    "--brief": ["--brief", "/tmp/brief.json"],
    "--decision": ["--decision", "/tmp/decision.json"],
    "--delta-cleared": ["--delta-cleared"],
    "--dispatch": ["--dispatch", '["C1","1.1","1.1"]'],
    "--home": ["--home", "/tmp"],
    "--model": ["--model", "the supervisor session"],
    "--print-digest": ["--print-digest"],
    "--read-through": ["--read-through", "1785000000.000300"],
    "--session-url": ["--session-url", "https://example.invalid/session"],
    "--verdict": ["--verdict", "/tmp/verdict.json"],
  },
  "turn brief": {
    "--channel": ["--channel", "C123"],
    "--contracts": ["--contracts", "--text", "why?"],
    "--force": ["--force"],
    "--home": ["--home", "/tmp"],
    "--host": ["--host", "claude-code"],
    "--limit": ["--limit", "8"],
    "--message-ts": ["--message-ts", "1712345678.000100"],
    "--mode": ["--mode", "single-turn"],
    "--no-owner-lens": ["--no-owner-lens"],
    "--out": ["--out", "/tmp/brief.json"],
    "--rides": ["--rides", "1712345678.000200"],
    "--surface": ["--surface", "dm"],
    "--text": ["--text", "why?"],
    "--thread-ts": ["--thread-ts", "1712345678.000100"],
    "--turn-id": ["--turn-id", "turn-1"],
    "--user": ["--user", "U_ASKER"],
    "--working-ts": ["--working-ts", "1712345678.000300"],
  },
  "turn dispatch": {
    "--ask": ["--sweep", "--ask", "C123/1712345678.000100"],
    "--brief": ["--brief", "/tmp/brief.json"],
    "--decision": ["--decision", "/tmp/decision.json"],
    "--home": ["--home", "/tmp"],
    "--now": ["--now", "2026-08-28T01:01:33.471Z"],
    "--poll": ["--poll", '["C1","1.1","1.1"]'],
    "--subagent-report": ["--subagent-report", "/tmp/report.json"],
    "--sweep": ["--sweep"],
    "--warn": ["--sweep", "--ask", "C123/1712345678.000100", "--warn", "round 2 carried round 1's claims"],
    "--warn-dispatched": [
      "--sweep",
      "--ask",
      "C123/1712345678.000100",
      "--warn-dispatched",
      "2026-09-12T04:24:59.799Z",
    ],
  },
  "turn freeze": {
    "--ask": ["--ask", "C123/1712345678.000100"],
    "--home": ["--home", "/tmp"],
    "--incident": ["--incident", "the sweep abandoned a live worker"],
    "--not-after": ["--not-after", "2026-09-10T14:06:00.000Z"],
    "--out": ["--out", "/tmp/fixture"],
    "--regresses": ["--regresses", "stalled-session-still-reported-as-in-flight"],
    "--slug": ["--slug", "an-incident"],
    "--through": ["--through", "dispatched"],
  },
  "turn resume": {
    "--answer": ["--answer", "/tmp/answer.json"],
    "--dispatch": ["--dispatch", '["C1","1.1","1.1"]'],
    "--edit-reason": ["--edit-reason", "the table omitted the monitor the ask existed for"],
    "--failed": ["--failed", "the portal needs a login this session does not have"],
    "--home": ["--home", "/tmp"],
  },
  "turn review": {
    "--answer": ["--answer", "/tmp/answer.json"],
    "--brief": ["--brief", "/tmp/brief.json"],
    "--decision": ["--decision", "/tmp/decision.json"],
    "--dispatch": ["--dispatch", '["C1","1.1","1.1"]'],
    "--home": ["--home", "/tmp"],
    "--close": ["--close"],
    "--delta-cleared": ["--delta-cleared"],
    "--model": ["--model", "opus"],
    "--poll": ["--poll"],
    "--read-through": ["--read-through", "1700000000.000200"],
    "--timeout-seconds": ["--timeout-seconds", "60"],
    "--wait": ["--wait"],
  },
  "turn watch": {
    "--brief": ["--brief", "/tmp/brief.json"],
    "--home": ["--home", "/tmp"],
    "--interval-seconds": ["--interval-seconds", "90"],
    "--max-seconds": ["--max-seconds", "600"],
    "--once": ["--once"],
  },
  "turn status": {
    "--brief": ["--brief", "/tmp/brief.json"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--model": ["--model", "the supervisor session"],
    "--plan": ["--plan", "read the thread\nsearch the corpus"],
    "--session-url": ["--session-url", "https://example.invalid/session"],
    "--status": ["--status", "reading the corpus for prior decisions"],
    "--step": ["--status", "3 prior decisions found in the corpus", "--step", "2"],
    "--tier": ["--tier", "inline"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "turn answer": ({ fragment }) => parseTurnArgs({ rest: [...fragment] }),
  "turn brief": ({ fragment }) => parseTurnBriefArgs({ rest: [...fragment] }),
  "turn dispatch": ({ fragment }) => parseTurnDispatchArgs({ rest: [...fragment] }),
  "turn freeze": ({ fragment }) => parseTurnFreezeArgs({ rest: [...fragment] }),
  "turn resume": ({ fragment }) => parseTurnResumeArgs({ rest: [...fragment] }),
  "turn review": ({ fragment }) => parseTurnReviewArgs({ rest: [...fragment] }),
  "turn status": ({ fragment }) => parseTurnStatusArgs({ rest: [...fragment] }),
  "turn watch": ({ fragment }) => parseTurnWatchArgs({ rest: [...fragment] }),
};

/** The rows for `turn`'s run verbs. */
export const turnRunSlice: HelpTruthSlice = { guarded, probes, parsers };
