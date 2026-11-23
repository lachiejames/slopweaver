/**
 * The help-truth tables' rows for `talk`'s call, chair and history verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import {
  parseCheckInsArgs,
  parseOfferArgs,
  parseRowArgs,
  parseSupervisorArgs,
  TALK_CHECK_INS_FLAG_NAMES,
  TALK_OFFER_FLAG_NAMES,
  TALK_ROW_FLAG_NAMES,
  TALK_SUPERVISOR_FLAG_NAMES,
} from "../../../../cli/commands/talk/args.js";
import {
  parseCallsArgs,
  parseCutInsArgs,
  parseFidelityArgs,
  parseThreadArgs,
  parseUnreadArgs,
  TALK_CALLS_FLAG_NAMES,
  TALK_CUT_INS_FLAG_NAMES,
  TALK_FIDELITY_FLAG_NAMES,
  TALK_THREAD_FLAG_NAMES,
  TALK_UNREAD_FLAG_NAMES,
} from "../../../../cli/commands/talk/callArgs.js";
import {
  parseCallThreadAppendArgs,
  parseCallThreadArgs,
  TALK_CALL_THREAD_APPEND_FLAG_NAMES,
  TALK_CALL_THREAD_FLAG_NAMES,
} from "../../../../cli/commands/talk/callThreadArgs.js";
import { parseCallToolsArgs, TALK_CALL_TOOLS_FLAG_NAMES } from "../../../../cli/commands/talk/callToolsArgs.js";
import {
  parseCardsArgs,
  parseLapsArgs,
  TALK_LAPS_FLAG_NAMES,
  TALK_STEERS_FLAG_NAMES,
} from "../../../../cli/commands/talk/cardArgs.js";
import { parseCourierArgs, TALK_COURIER_FLAG_NAMES } from "../../../../cli/commands/talk/courierArgs.js";
import {
  parseHistoryArgs,
  parseOriginArgs,
  TALK_HISTORY_FLAG_NAMES,
  TALK_ORIGIN_FLAG_NAMES,
} from "../../../../cli/commands/talk/knowArgs.js";
import { parseLogArgs, TALK_LOG_FLAG_NAMES } from "../../../../cli/commands/talk/logArgs.js";
import { parseMeetingDueArgs, TALK_MEETING_DUE_FLAG_NAMES } from "../../../../cli/commands/talk/meetingDueArgs.js";
import { parseRecentArgs, TALK_RECENT_FLAG_NAMES } from "../../../../cli/commands/talk/recentArgs.js";
import { parseTalkSteerRiskArgs, TALK_STEER_RISK_FLAG_NAMES } from "../../../../cli/commands/talk/steerRiskRun.js";
import { parseUnreadAdoptArgs, TALK_UNREAD_ADOPT_FLAG_NAMES } from "../../../../cli/commands/talk/unreadAdoptArgs.js";
import { parseVerbArgs, TALK_VERB_FLAG_NAMES } from "../../../../cli/commands/talk/verbArgs.js";
import { parseWakeChairArgs, TALK_WAKE_CHAIR_FLAG_NAMES } from "../../../../cli/commands/talk/wakeChairArgs.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { CONSOLE_ORIGIN, TRANSCRIPT_BASE } from "./sharedProbes.js";

/** A valid `talk verb --request`: `encodeRequest` of `board list` with no arguments, spelled out. */
const VERB_REQUEST_HEX = "7b2261726773223a5b5d2c226e6f756e223a22626f617264222c2276657262223a226c697374227d";

/** The two flags every `talk unread-adopt` fragment needs: an instant before {@link ADOPT_CLOCK}, and a reason. */
const ADOPT_BASE = ["--before", "2026-11-17T06:00:00.000Z", "--why", "read on another machine"] as const;

/** The clock `talk unread-adopt` fragments are judged at, so `--before` is never in their future. */
const ADOPT_CLOCK = "2026-11-17T08:00:00.000Z";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "talk calls": TALK_CALLS_FLAG_NAMES,
  "talk call-tools": TALK_CALL_TOOLS_FLAG_NAMES,
  "talk call-thread": TALK_CALL_THREAD_FLAG_NAMES,
  "talk call-thread-append": TALK_CALL_THREAD_APPEND_FLAG_NAMES,
  "talk thread": TALK_THREAD_FLAG_NAMES,
  "talk cut-ins": TALK_CUT_INS_FLAG_NAMES,
  "talk fidelity": TALK_FIDELITY_FLAG_NAMES,
  "talk laps": TALK_LAPS_FLAG_NAMES,
  "talk steers": TALK_STEERS_FLAG_NAMES,
  "talk check-ins": TALK_CHECK_INS_FLAG_NAMES,
  "talk unread": TALK_UNREAD_FLAG_NAMES,
  "talk unread-adopt": TALK_UNREAD_ADOPT_FLAG_NAMES,
  "talk wake-chair": TALK_WAKE_CHAIR_FLAG_NAMES,
  "talk courier": TALK_COURIER_FLAG_NAMES,
  "talk history": TALK_HISTORY_FLAG_NAMES,
  "talk log": TALK_LOG_FLAG_NAMES,
  "talk offer": TALK_OFFER_FLAG_NAMES,
  "talk origin": TALK_ORIGIN_FLAG_NAMES,
  "talk recent": TALK_RECENT_FLAG_NAMES,
  "talk meeting-due": TALK_MEETING_DUE_FLAG_NAMES,
  "talk steer-risk": TALK_STEER_RISK_FLAG_NAMES,
  "talk row": TALK_ROW_FLAG_NAMES,
  "talk supervisor": TALK_SUPERVISOR_FLAG_NAMES,
  "talk verb": TALK_VERB_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "talk recent": {
    "--dir": ["--dir", "/tmp/handovers"],
    "--home": ["--home", "/tmp/a-home"],
    "--hours": ["--hours", "24"],
    "--json": ["--json"],
    "--now": ["--now", "2026-09-24T12:00:00.000Z"],
  },
  // `--phrase` is required, so every fragment carries it.
  "talk history": {
    "--home": ["--phrase", "jumpcloud atlas", "--home", "/tmp/a-home"],
    "--hours": ["--phrase", "jumpcloud atlas", "--hours", "12"],
    "--json": ["--phrase", "jumpcloud atlas", "--json"],
    "--max-bytes": ["--phrase", "jumpcloud atlas", "--max-bytes", "8192"],
    "--now": ["--phrase", "jumpcloud atlas", "--now", "2026-09-24T12:00:00.000Z"],
    "--phrase": ["--phrase", "jumpcloud atlas"],
  },
  "talk log": {
    "--about-prefix": ["--about-prefix", "align:"],
    "--home": ["--home", "/tmp/a-home"],
    "--json": ["--json"],
    "--limit": ["--limit", "5"],
    "--turn": ["--turn", "951b9e45-6fc9-45fd-8e25-d04ded7164c9"],
  },
  "talk check-ins": {
    "--home": ["--home", "/tmp/a-home"],
    "--json": ["--json"],
    "--skip": ["--skip", "5"],
  },
  "talk calls": {
    "--home": ["--home", "/tmp/a-home"],
    "--json": ["--json"],
    "--limit": ["--limit", "5"],
  },
  "talk call-tools": {
    "--call": ["--call", "f1edcbb1-553c-4a21-a21b-a1bb8a62b630"],
    "--from": ["--call", "f1edcbb1-553c-4a21-a21b-a1bb8a62b630", "--from", "10"],
    "--home": ["--call", "f1edcbb1-553c-4a21-a21b-a1bb8a62b630", "--home", "/tmp/a-home"],
    "--json": ["--call", "f1edcbb1-553c-4a21-a21b-a1bb8a62b630", "--json"],
    "--limit": ["--call", "f1edcbb1-553c-4a21-a21b-a1bb8a62b630", "--limit", "50"],
  },
  "talk call-thread": {
    "--call": ["--call", "f1edcbb1-553c-4a21-a21b-a1bb8a62b630"],
    "--from": ["--call", "f1edcbb1-553c-4a21-a21b-a1bb8a62b630", "--from", "3"],
    "--home": ["--call", "f1edcbb1-553c-4a21-a21b-a1bb8a62b630", "--home", "/tmp/a-home"],
    "--json": ["--call", "f1edcbb1-553c-4a21-a21b-a1bb8a62b630", "--json"],
    "--limit": ["--call", "f1edcbb1-553c-4a21-a21b-a1bb8a62b630", "--limit", "10"],
  },
  "talk call-thread-append": {
    "--call": [...TRANSCRIPT_BASE],
    "--console-default-port": [...TRANSCRIPT_BASE, ...CONSOLE_ORIGIN],
    "--console-port": [...TRANSCRIPT_BASE, ...CONSOLE_ORIGIN],
    "--console-root": [...TRANSCRIPT_BASE, ...CONSOLE_ORIGIN],
    "--entries-file": [...TRANSCRIPT_BASE],
    "--home": [...TRANSCRIPT_BASE, "--home", "/tmp/a-home"],
    "--json": [...TRANSCRIPT_BASE, "--json"],
  },
  "talk thread": {
    "--home": ["--home", "/tmp/a-home"],
    "--json": ["--json"],
    "--turns": ["--turns", "50"],
  },
  "talk cut-ins": {
    "--home": ["--home", "/tmp/a-home"],
    "--json": ["--json"],
    "--since": ["--since", "14d"],
  },
  "talk fidelity": {
    "--call": ["--call", "8d74b96f-f72d-4135-be24-b78897fa3926"],
    "--home": ["--home", "/tmp/a-home"],
    "--json": ["--json"],
    "--limit": ["--limit", "20"],
    "--since": ["--since", "14d"],
    "--until": ["--until", "2026-11-01T00:00:00Z"],
    "--words": ["--words"],
  },
  "talk unread": {
    "--adopt": ["--mark", "--adopt"],
    "--all": ["--all"],
    "--cursor": ["--cursor", "supervisor"],
    "--home": ["--home", "/tmp/a-home"],
    "--json": ["--json"],
    "--mark": ["--mark"],
    "--now": ["--now", "2026-09-26T06:00:00.000Z"],
  },
  // `--before` and `--why` are both required, so every fragment carries both.
  "talk unread-adopt": {
    "--approve": [...ADOPT_BASE, "--approve", "adopt-0123456789abcdef"],
    "--before": [...ADOPT_BASE],
    "--cursor": [...ADOPT_BASE, "--cursor", "supervisor"],
    "--home": [...ADOPT_BASE, "--home", "/tmp/a-home"],
    "--json": [...ADOPT_BASE, "--json"],
    "--now": [...ADOPT_BASE, "--now", "2026-11-17T07:00:00.000Z"],
    "--why": [...ADOPT_BASE],
  },
  // `--home` and `--now` ride `--dry-run` only: a run that types reads this machine's calls, now.
  "talk wake-chair": {
    "--console-default-port": CONSOLE_ORIGIN,
    "--console-port": CONSOLE_ORIGIN,
    "--console-root": CONSOLE_ORIGIN,
    "--dry-run": ["--dry-run"],
    "--home": ["--dry-run", "--home", "/tmp/a-home"],
    "--json": ["--json"],
    "--now": ["--dry-run", "--now", "2026-10-01T15:39:00.000Z"],
  },
  "talk courier": {
    "--follow": ["--follow"],
    "--json": ["--once", "--json"],
    "--once": ["--once"],
  },
  "talk steers": {
    "--home": ["--home", "/tmp/a-home"],
    "--json": ["--json"],
  },
  "talk laps": {
    "--calibrate": ["--calibrate"],
    "--home": ["--home", "/tmp/a-home"],
    "--json": ["--json"],
    "--since": ["--since", "14d"],
  },
  "talk offer": {
    "--home": ["--home", "/tmp/a-home"],
    "--json": ["--json"],
    "--reconnect": ["--reconnect"],
    "--rollover": ["--rollover"],
    "--test-instance": ["--test-instance", "e2e"],
    "--typed": ["--typed"],
    "--voice": ["--voice", "sol"],
  },
  // `--turn` and `--say` are both required, for the reason `src/talk/relayDraft.ts` carries: the turn is the
  // route's to mint and the words are what the card showed. So every fragment carries both.
  // `--slug` is required, so every fragment carries it.
  "talk origin": {
    "--dir": ["--slug", "atlas-jumpcloud", "--dir", "/tmp/handovers"],
    "--home": ["--slug", "atlas-jumpcloud", "--home", "/tmp/a-home"],
    "--json": ["--slug", "atlas-jumpcloud", "--json"],
    "--slug": ["--slug", "atlas-jumpcloud"],
  },
  "talk meeting-due": {
    "--home": ["--home", "/tmp/a-home"],
    "--json": ["--json"],
    "--now": ["--now", "2026-10-08T23:00:00Z"],
  },
  "talk steer-risk": {
    "--home": ["--home", "/tmp/a-home"],
    "--json": ["--json"],
  },
  // `--request` is required: the hex of {"args":[],"noun":"board","verb":"list"}, as the console encodes it.
  "talk verb": {
    "--json": ["--request", VERB_REQUEST_HEX, "--json"],
    "--request": ["--request", VERB_REQUEST_HEX],
  },
  // `--slug` is required, so every fragment carries it.
  "talk row": {
    "--dir": ["--slug", "a-row", "--dir", "/tmp/handovers"],
    "--home": ["--slug", "a-row", "--home", "/tmp/a-home"],
    "--json": ["--slug", "a-row", "--json"],
    "--slug": ["--slug", "a-row"],
  },
  "talk supervisor": {
    "--home": ["--home", "/tmp/a-home"],
    "--json": ["--json"],
    "--max-bytes": ["--max-bytes", "8192"],
    "--session": ["--session", "a0000007-0000-4000-8000-000000000008"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "talk history": ({ fragment }) => parseHistoryArgs({ rest: fragment }),
  "talk log": ({ fragment }) => parseLogArgs({ rest: fragment }),
  "talk check-ins": ({ fragment }) => parseCheckInsArgs({ rest: fragment }),
  "talk offer": ({ fragment }) => parseOfferArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "talk origin": ({ fragment }) => parseOriginArgs({ rest: fragment }),
  "talk recent": ({ fragment }) => parseRecentArgs({ rest: fragment }),
  "talk meeting-due": ({ fragment }) => parseMeetingDueArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "talk steer-risk": ({ fragment }) => parseTalkSteerRiskArgs({ rest: fragment }),
  "talk calls": ({ fragment }) => parseCallsArgs({ rest: fragment }),
  "talk call-tools": ({ fragment }) => parseCallToolsArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "talk call-thread": ({ fragment }) => parseCallThreadArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "talk call-thread-append": ({ fragment }) =>
    parseCallThreadAppendArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "talk thread": ({ fragment }) => parseThreadArgs({ rest: fragment }),
  "talk cut-ins": ({ fragment }) => parseCutInsArgs({ rest: fragment }),
  "talk fidelity": ({ fragment }) => parseFidelityArgs({ rest: fragment }),
  "talk unread": ({ fragment }) => parseUnreadArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "talk unread-adopt": ({ fragment }) =>
    parseUnreadAdoptArgs({ clockIso: ADOPT_CLOCK, rest: fragment }).mapErr((error) => [error.message]),
  "talk wake-chair": ({ fragment }) => parseWakeChairArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "talk courier": ({ fragment }) => parseCourierArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "talk steers": ({ fragment }) => parseCardsArgs({ rest: fragment }),
  "talk laps": ({ fragment }) => parseLapsArgs({ rest: fragment }),
  "talk row": ({ fragment }) => parseRowArgs({ rest: fragment }),
  "talk supervisor": ({ fragment }) => parseSupervisorArgs({ rest: fragment }),
  "talk verb": ({ fragment }) => parseVerbArgs({ rest: fragment }),
};

/** The rows for `talk`'s call, chair and history verbs. */
export const talkCallsSlice: HelpTruthSlice = { guarded, probes, parsers };
