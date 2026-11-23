/**
 * The help-truth tables' rows for `slack`'s read verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import {
  parseSlackAlertSummaryArgs,
  SLACK_ALERT_SUMMARY_FLAG_NAMES,
} from "../../../../cli/commands/slack/alertSummaryCore.js";
import { slackArgumentErrorLines } from "../../../../cli/commands/slack/argumentErrors.js";
import { parseChannelArgs, SLACK_CHANNEL_FLAG_SPEC } from "../../../../cli/commands/slack/channelCore.js";
import {
  parseSlackChannelViewArgs,
  SLACK_CHANNEL_VIEW_FLAG_NAMES,
} from "../../../../cli/commands/slack/channelViewCore.js";
import { parseSlackProbeArgs, SLACK_PROBE_FLAG_NAMES } from "../../../../cli/commands/slack/probeCore.js";
import { slackReadErrorLines } from "../../../../cli/commands/slack/readErrors.js";
import { parseSlackReadFileArgs, SLACK_READ_FILE_FLAG_NAMES } from "../../../../cli/commands/slack/readFileCore.js";
import {
  parseSlackReadThreadArgs,
  SLACK_READ_THREAD_FLAG_NAMES,
} from "../../../../cli/commands/slack/readThreadCore.js";
import { parseSlackRepeatsOptions, SLACK_REPEATS_FLAG_NAMES } from "../../../../cli/commands/slack/repeatsCore.js";
import { parseSlackRepliedArgs, SLACK_REPLIED_FLAG_NAMES } from "../../../../cli/commands/slack/repliedArgs.js";
import { parseSlackSavedArgs, SLACK_SAVED_FLAG_NAMES } from "../../../../cli/commands/slack/savedCore.js";
import { parseSlackShotArgs, SLACK_SHOT_FLAG_NAMES } from "../../../../cli/commands/slack/shotCore.js";
import {
  parseSlackSnapshotOptions,
  SLACK_SNAPSHOT_FLAG_NAMES,
} from "../../../../cli/commands/slack/snapshotOptions.js";
import { parseSlackTaggedOptions, SLACK_TAGGED_FLAG_SPEC } from "../../../../cli/commands/slack/taggedRun.js";
import { parseSlackUnreadOptions, SLACK_UNREAD_FLAG_SPEC } from "../../../../cli/commands/slack/unreadRun.js";
import {
  parseSlackVoiceRulesArgs,
  SLACK_VOICE_RULES_FLAG_NAMES,
} from "../../../../cli/commands/slack/voiceRulesCore.js";
import { parseSlackWhenArgs, SLACK_WHEN_FLAG_NAMES } from "../../../../cli/commands/slack/whenCore.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { flagNamesOf, PROBE_HOME } from "./sharedProbes.js";

/** A well-formed Slack message permalink, so `slack shot` probes exercise its flags rather than its parser. */
const SLACK_SHOT_PROBE_PERMALINK = "https://acme.slack.com/archives/C123/p1785114398557099";

/** A syntactically valid permalink, so a flag probe is not rejected for the missing positional. */
const PROBE_PERMALINK = "https://example.slack.com/archives/C123/p1785114398557099";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "slack alert-summary": SLACK_ALERT_SUMMARY_FLAG_NAMES,
  "slack channel": flagNamesOf({ spec: SLACK_CHANNEL_FLAG_SPEC }),
  "slack owed": SLACK_SNAPSHOT_FLAG_NAMES,
  "slack awaiting": SLACK_SNAPSHOT_FLAG_NAMES,
  "slack finding-followups": SLACK_SNAPSHOT_FLAG_NAMES,
  "slack repeats": SLACK_REPEATS_FLAG_NAMES,
  "slack replied": SLACK_REPLIED_FLAG_NAMES,
  "slack tagged": flagNamesOf({ spec: SLACK_TAGGED_FLAG_SPEC }),
  "slack unread": flagNamesOf({ spec: SLACK_UNREAD_FLAG_SPEC }),
  "slack probe": SLACK_PROBE_FLAG_NAMES,
  "slack channel-view": SLACK_CHANNEL_VIEW_FLAG_NAMES,
  "slack read-file": SLACK_READ_FILE_FLAG_NAMES,
  "slack read-thread": SLACK_READ_THREAD_FLAG_NAMES,
  "slack voice-rules": SLACK_VOICE_RULES_FLAG_NAMES,
  "slack saved": SLACK_SAVED_FLAG_NAMES,
  "slack shot": SLACK_SHOT_FLAG_NAMES,
  "slack when": SLACK_WHEN_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "slack alert-summary": {
    "--channel": [],
    "--form": ["--form"],
    "--home": ["--home", "/tmp"],
    "--intro": ["--intro", '["this is a trial."]'],
    "--json": ["--json"],
    "--label": ["--label", "Platform"],
    "--lead": ["--lead", "Upstream is drowning the rest."],
    "--recommendations": ["--recommendations", '{"recommendations":[]}'],
    "--window": ["--window", "24h"],
  },
  "slack repeats": {
    "--as": ["--as", "bot"],
    "--days": ["--days", "3"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "slack replied": {
    "--home": ["--url", "https://acme.slack.com/archives/C123/p1785114398557099", "--home", "/tmp/a-home"],
    "--json": ["--url", "https://acme.slack.com/archives/C123/p1785114398557099", "--json"],
    "--url": ["--url", "https://acme.slack.com/archives/C123/p1785114398557099"],
  },
  "slack tagged": {
    "--corpus-only": ["--corpus-only"],
    "--days": ["--days", "3"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-09-30T00:00:00.000Z"],
  },
  "slack unread": {
    "--days": ["--days", "3"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "slack channel": {
    "--as": ["create", "--name", "eng", "--as", "me"],
    "--channel": ["archive", "--channel", "C1"],
    "--dry-run": ["create", "--name", "eng", "--dry-run"],
    "--home": ["create", "--name", "eng", "--home", "/tmp"],
    "--invite": ["create", "--name", "eng", "--invite", "seth"],
    "--json": ["create", "--name", "eng", "--json"],
    "--name": ["create", "--name", "eng"],
    "--private": ["create", "--name", "eng", "--private"],
    "--purpose": ["create", "--name", "eng", "--purpose", "why"],
    "--topic": ["create", "--name", "eng", "--topic", "what"],
  },
  "slack owed": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-09-26T00:00:00.000Z"],
    "--write": ["--write"],
  },
  "slack awaiting": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-09-29T00:00:00.000Z"],
    "--write": ["--write"],
  },
  "slack finding-followups": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-10-19T00:00:00.000Z"],
    "--write": ["--write"],
  },
  "slack probe": {
    // `--method` is required, so every probe fragment carries one — a bare flag would fail on the missing
    // method rather than on the flag under test, and the failure would name the wrong thing.
    "--bot": ["--method", "auth.test", "--bot"],
    "--count-field": ["--method", "auth.test", "--count-field", "messages"],
    "--count-where": ["--method", "auth.test", "--count-where", "messages:permalink~thread_ts"],
    "--exhaust": ["--method", "auth.test", "--exhaust", "5"],
    "--expect": ["--method", "auth.test", "--expect", "url=https://example.slack.com/"],
    "--home": ["--method", "auth.test", "--home", "/tmp"],
    "--json": ["--method", "auth.test", "--json"],
    "--method": ["--method", "auth.test"],
    "--shape-at": ["--method", "auth.test", "--shape-at", "messages"],
    "--scopes": ["--method", "auth.test", "--scopes"],
    "--sum-field": ["--method", "auth.test", "--sum-field", "messages:reply_count"],
  },
  "slack channel-view": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--workspace": ["--workspace", "acme.slack.com"],
  },
  "slack read-file": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--no-transcript": ["--no-transcript"],
  },
  "slack read-thread": {
    "--around": ["--around", "0"],
    "--channel-around": ["--channel-around", "1"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--max-file-mb": ["--max-file-mb", "10"],
    "--since": ["--since", "1785114398.557099"],
  },
  "slack voice-rules": {
    "--check-stdin": ["--check-stdin"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    // `--slack-draft` says what the message on stdin is, so it is refused without `--check-stdin`.
    "--slack-draft": ["--check-stdin", "--slack-draft"],
  },
  // `when` refuses an invocation naming nothing to convert, so every probe carries a real ts.
  "slack saved": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--settle": ["--settle", "2000"],
  },
  "slack shot": {
    "--home": [SLACK_SHOT_PROBE_PERMALINK, "--out", "/tmp/a.png", "--home", "/tmp"],
    "--json": [SLACK_SHOT_PROBE_PERMALINK, "--out", "/tmp/a.png", "--json"],
    "--out": [SLACK_SHOT_PROBE_PERMALINK, "--out", "/tmp/a.png"],
    "--settle": [SLACK_SHOT_PROBE_PERMALINK, "--out", "/tmp/a.png", "--settle", "2000"],
  },
  "slack when": {
    "--json": ["--json", "1788220579.306599"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "slack alert-summary": ({ fragment }) =>
    parseSlackAlertSummaryArgs({ rest: ["--channel", "D1", ...fragment] }).mapErr((error) =>
      slackArgumentErrorLines({ error }),
    ),
  "slack channel": ({ fragment }) =>
    parseChannelArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }).mapErr((error) =>
      slackArgumentErrorLines({ error }),
    ),
  "slack probe": ({ fragment }) =>
    parseSlackProbeArgs({ rest: [...fragment] }).mapErr((error) => slackArgumentErrorLines({ error })),
  "slack channel-view": ({ fragment }) =>
    parseSlackChannelViewArgs({ rest: ["C0SYN123ABCD", ...fragment] }).mapErr((error) =>
      slackReadErrorLines({ error }),
    ),
  "slack read-file": ({ fragment }) =>
    parseSlackReadFileArgs({ rest: ["F0BTACLP1D0", ...fragment] }).mapErr((error) => slackReadErrorLines({ error })),
  "slack read-thread": ({ fragment }) =>
    parseSlackReadThreadArgs({ rest: [PROBE_PERMALINK, ...fragment] }).mapErr((error) =>
      slackReadErrorLines({ error }),
    ),
  "slack owed": ({ fragment }) => parseSlackSnapshotOptions({ defaultHome: PROBE_HOME, rest: [...fragment] }),
  "slack awaiting": ({ fragment }) => parseSlackSnapshotOptions({ defaultHome: PROBE_HOME, rest: [...fragment] }),
  "slack finding-followups": ({ fragment }) =>
    parseSlackSnapshotOptions({ defaultHome: PROBE_HOME, rest: [...fragment] }),
  "slack repeats": ({ fragment }) => parseSlackRepeatsOptions({ defaultHome: PROBE_HOME, rest: [...fragment] }),
  "slack replied": ({ fragment }) =>
    parseSlackRepliedArgs({ rest: fragment }).mapErr((error) => error.message.split("\n")),
  "slack tagged": ({ fragment }) => parseSlackTaggedOptions({ defaultHome: PROBE_HOME, rest: [...fragment] }),
  "slack unread": ({ fragment }) => parseSlackUnreadOptions({ defaultHome: PROBE_HOME, rest: [...fragment] }),
  "slack voice-rules": ({ fragment }) =>
    parseSlackVoiceRulesArgs({ rest: [...fragment] }).mapErr((error) => slackArgumentErrorLines({ error })),
  "slack saved": ({ fragment }) =>
    parseSlackSavedArgs({ rest: [...fragment] }).mapErr((error) => slackArgumentErrorLines({ error })),
  "slack shot": ({ fragment }) =>
    parseSlackShotArgs({ rest: [...fragment] }).mapErr((error) => slackArgumentErrorLines({ error })),
  "slack when": ({ fragment }) =>
    parseSlackWhenArgs({ rest: [...fragment] }).mapErr((error) => slackArgumentErrorLines({ error })),
};

/** The rows for `slack`'s read verbs. */
export const slackReadsSlice: HelpTruthSlice = { guarded, probes, parsers };
