/**
 * The help-truth tables' rows for `talk`'s context, card-finding and Slack verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import {
  parseCodeArgs,
  parsePackArgs,
  TALK_CODE_FLAG_NAMES,
  TALK_PACK_FLAG_NAMES,
} from "../../../../cli/commands/talk/args.js";
import { parseAttachArgs, TALK_ATTACH_FLAG_NAMES } from "../../../../cli/commands/talk/attachArgs.js";
import { parseCapabilitiesArgs, TALK_CAPABILITIES_FLAG_NAMES } from "../../../../cli/commands/talk/capabilitiesArgs.js";
import {
  parseCardsArgs,
  parseRestoreArgs,
  TALK_CARDS_FLAG_NAMES,
  TALK_RESTORE_FLAG_NAMES,
} from "../../../../cli/commands/talk/cardArgs.js";
import {
  parseCursorRetireArgs,
  TALK_CURSOR_RETIRE_FLAG_NAMES,
} from "../../../../cli/commands/talk/cursorRetireArgs.js";
import { parseFileArgs, TALK_FILE_FLAG_NAMES } from "../../../../cli/commands/talk/fileArgs.js";
import { parseFindCardArgs, TALK_FIND_CARD_FLAG_NAMES } from "../../../../cli/commands/talk/findCardArgs.js";
import {
  parseGlossaryArgs,
  parseKnowledgeArgs,
  TALK_GLOSSARY_FLAG_NAMES,
  TALK_KNOWLEDGE_FLAG_NAMES,
} from "../../../../cli/commands/talk/knowArgs.js";
import {
  parseListAddArgs,
  parseListArgs,
  TALK_LIST_ADD_FLAG_NAMES,
  TALK_LIST_FLAG_NAMES,
} from "../../../../cli/commands/talk/listArgs.js";
import { talkPositionalArgsErrorLines } from "../../../../cli/commands/talk/positionalArgsErrors.js";
import { parseQuarantineArgs, TALK_QUARANTINE_FLAG_NAMES } from "../../../../cli/commands/talk/quarantineArgs.js";
import { parseRecallArgs, TALK_RECALL_FLAG_NAMES } from "../../../../cli/commands/talk/recallArgs.js";
import { parseSlackAfterArgs, TALK_SLACK_AFTER_FLAG_NAMES } from "../../../../cli/commands/talk/slackAfterArgs.js";
import {
  parseSlackChannelArgs,
  TALK_SLACK_CHANNEL_FLAG_NAMES,
} from "../../../../cli/commands/talk/slackChannelArgs.js";
import { parseSlackOpenArgs, TALK_SLACK_OPEN_FLAG_NAMES } from "../../../../cli/commands/talk/slackOpenArgs.js";
import {
  parseSlackSendOutcomeArgs,
  TALK_SLACK_SEND_OUTCOME_FLAG_NAMES,
} from "../../../../cli/commands/talk/slackSendOutcomeArgs.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

/** A valid `talk slack-send-outcome`: `--url` and `--since` are both required. */
const SEND_OUTCOME_BASE: readonly string[] = [
  "--url",
  "https://acme.slack.com/archives/C123/p1785114398557099",
  "--since",
  "2026-10-07T05:52:59Z",
];

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "talk cards": TALK_CARDS_FLAG_NAMES,
  "talk quarantine": TALK_QUARANTINE_FLAG_NAMES,
  "talk cursor-retire": TALK_CURSOR_RETIRE_FLAG_NAMES,
  "talk code": TALK_CODE_FLAG_NAMES,
  "talk file": TALK_FILE_FLAG_NAMES,
  "talk attach": TALK_ATTACH_FLAG_NAMES,
  "talk capabilities": TALK_CAPABILITIES_FLAG_NAMES,
  "talk find-card": TALK_FIND_CARD_FLAG_NAMES,
  "talk glossary": TALK_GLOSSARY_FLAG_NAMES,
  "talk knowledge": TALK_KNOWLEDGE_FLAG_NAMES,
  "talk pack": TALK_PACK_FLAG_NAMES,
  "talk recall": TALK_RECALL_FLAG_NAMES,
  "talk slack-after": TALK_SLACK_AFTER_FLAG_NAMES,
  "talk slack-channel": TALK_SLACK_CHANNEL_FLAG_NAMES,
  "talk slack-open": TALK_SLACK_OPEN_FLAG_NAMES,
  "talk slack-send-outcome": TALK_SLACK_SEND_OUTCOME_FLAG_NAMES,
  "talk list": TALK_LIST_FLAG_NAMES,
  "talk list-add": TALK_LIST_ADD_FLAG_NAMES,
  "talk restore": TALK_RESTORE_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  // Positional words are required, so every fragment carries them.
  "talk find-card": {
    "--home": ["voice", "browser", "--home", "/tmp/a-home"],
    "--json": ["voice", "browser", "--json"],
  },
  // `talk code` takes a MODE as its first positional and refuses without one, so every fragment leads with
  // the mode the flag under probe is valid under — `--text` only means something to `find`, `--path` and
  // `--from` only to `read`, `--dir` only to `list`.
  "talk code": {
    "--budget": ["find", "--text", "spendBudget", "--budget", "4096"],
    "--cwd": ["list", "--cwd", "/tmp/a-checkout"],
    "--dir": ["list", "--dir", "src/talk"],
    "--from": ["read", "--path", "src/talk/codeBounds.ts", "--from", "1024"],
    "--json": ["find", "--text", "spendBudget", "--json"],
    "--max-hits": ["find", "--text", "spendBudget", "--max-hits", "5"],
    "--path": ["read", "--path", "src/talk/codeBounds.ts"],
    "--text": ["find", "--text", "spendBudget"],
    "--text-hex": ["find", "--text-hex", "2d2d6a736f6e"],
  },
  // `talk file` is the same shape: `--path`, `--from` and `--budget` belong to `read`, `--dir` and `--limit` to `list`.
  "talk file": {
    "--budget": ["read", "--path", "~/notes.txt", "--budget", "4096"],
    "--dir": ["list", "--dir", "~/Downloads"],
    "--from": ["read", "--path", "~/notes.txt", "--from", "1024"],
    "--home": ["list", "--dir", "/tmp", "--home", "/tmp/a-home"],
    "--json": ["read", "--path", "~/notes.txt", "--json"],
    "--limit": ["list", "--dir", "~/Downloads", "--limit", "20"],
    "--path": ["read", "--path", "~/notes.txt"],
    "--words": ["read", "--path", "~/.slopweaver/pages/a/index.html", "--words"],
  },
  "talk capabilities": {
    "--json": ["slack", "--json"],
  },
  "talk glossary": {
    "--json": ["--json"],
    "--term": ["--term", "atlas"],
  },
  // Exactly one of `--words` or `--open` is required, and each rung's own flags ride the rung they belong to.
  "talk recall": {
    "--days": ["--words", "xero steer", "--days", "2"],
    "--from": ["--open", "talk:abc", "--from", "3"],
    "--home": ["--words", "xero steer", "--home", "/tmp/a-home"],
    "--json": ["--words", "xero steer", "--json"],
    "--max-bytes": ["--words", "xero steer", "--max-bytes", "8192"],
    "--now": ["--words", "xero steer", "--now", "2026-10-09T13:08:00.000Z"],
    "--open": ["--open", "talk:abc"],
    "--source": ["--words", "xero steer", "--source", "steers"],
    "--words": ["--words", "xero steer"],
  },
  // `--query` is required, so every fragment carries it.
  "talk knowledge": {
    "--json": ["--query", "jumpcloud", "--json"],
    "--limit": ["--query", "jumpcloud", "--limit", "3"],
    "--max-bytes": ["--query", "jumpcloud", "--max-bytes", "8192"],
    "--query": ["--query", "jumpcloud"],
  },
  "talk quarantine": {
    "--home": ["f1edcbb1-553c-4a21-a21b-a1bb8a62b630", "--reason", "gone", "--home", "/tmp/a-home"],
    "--json": ["f1edcbb1-553c-4a21-a21b-a1bb8a62b630", "--reason", "gone", "--json"],
    "--reason": ["f1edcbb1-553c-4a21-a21b-a1bb8a62b630", "--reason", "gone"],
  },
  // `--source-sha256` and `--reason` ride `--apply`, which needs both.
  "talk cursor-retire": {
    "--apply": ["--apply", "--source-sha256", "a".repeat(64), "--reason", "sanitised"],
    "--cursor": ["--cursor", "voice"],
    "--home": ["--home", "/tmp/a-home"],
    "--json": ["--json"],
    "--reason": ["--apply", "--source-sha256", "a".repeat(64), "--reason", "sanitised"],
    "--source-sha256": ["--apply", "--source-sha256", "a".repeat(64), "--reason", "sanitised"],
  },
  "talk cards": {
    "--home": ["--home", "/tmp/a-home"],
    "--json": ["--json"],
  },
  // `--card`, `--anchor` and `--why` are required, so every fragment carries them.
  "talk restore": {
    "--anchor": ["--card", "hand:voice-mark-step", "--anchor", "run:x", "--why", "a general remark"],
    "--card": ["--card", "hand:voice-mark-step", "--anchor", "run:x", "--why", "a general remark"],
    "--home": ["--card", "hand:voice-mark-step", "--anchor", "run:x", "--why", "a general remark", "--home", "/tmp/h"],
    "--json": ["--card", "hand:voice-mark-step", "--anchor", "run:x", "--why", "a general remark", "--json"],
    "--why": ["--card", "hand:voice-mark-step", "--anchor", "run:x", "--why", "a general remark"],
  },
  "talk pack": {
    "--base": ["--base", "origin/main"],
    "--dir": ["--dir", "/tmp/handovers"],
    "--home": ["--home", "/tmp/a-home"],
    // Only beside --write: on its own it is refused, since it decides whether the write rebuilds.
    "--if-older-than": ["--write", "--if-older-than", "30"],
    "--json": ["--json"],
    "--write": ["--write"],
  },
  "talk slack-after": {
    "--home": ["--url", "https://acme.slack.com/archives/C123/p1785114398557099", "--home", "/tmp/a-home"],
    "--json": ["--url", "https://acme.slack.com/archives/C123/p1785114398557099", "--json"],
    "--max-bytes": ["--url", "https://acme.slack.com/archives/C123/p1785114398557099", "--max-bytes", "8192"],
    "--url": ["--url", "https://acme.slack.com/archives/C123/p1785114398557099"],
  },
  // `--channel` is required, so every fragment carries it.
  "talk slack-channel": {
    "--channel": ["--channel", "#squad-platform"],
    "--home": ["--channel", "#squad-platform", "--home", "/tmp/a-home"],
    "--json": ["--channel", "#squad-platform", "--json"],
    "--max-bytes": ["--channel", "#squad-platform", "--max-bytes", "8192"],
  },
  "talk slack-open": {
    "--home": ["--url", "https://acme.slack.com/archives/C123/p1785114398557099", "--home", "/tmp/a-home"],
    "--json": ["--url", "https://acme.slack.com/archives/C123/p1785114398557099", "--json"],
    "--max-bytes": ["--url", "https://acme.slack.com/archives/C123/p1785114398557099", "--max-bytes", "8192"],
    "--url": ["--url", "https://acme.slack.com/archives/C123/p1785114398557099"],
  },
  // `--url` and `--since` are both required, so every fragment carries both.
  "talk slack-send-outcome": {
    "--home": [...SEND_OUTCOME_BASE, "--home", "/tmp/a-home"],
    "--json": [...SEND_OUTCOME_BASE, "--json"],
    "--since": SEND_OUTCOME_BASE,
    "--url": SEND_OUTCOME_BASE,
  },
  "talk list": {
    "--home": ["--home", "/tmp/a-home"],
    "--json": ["--json"],
    "--since": ["--since", "4"],
    "--voice-safe": ["--voice-safe"],
  },
  // `--origin` is required, and `--from` goes only with a fleet origin.
  "talk list-add": {
    "--fold-line": ["--origin", "voice", "--fold-line", "3"],
    "--from": ["--origin", "fleet", "--from", "supervisor"],
    "--home": ["--origin", "owner", "--home", "/tmp/a-home"],
    "--id": ["--origin", "owner", "--id", "req-1"],
    "--json": ["--origin", "owner", "--json"],
    "--label": ["--origin", "voice", "--label", "reply to Ari"],
    "--origin": ["--origin", "owner"],
  },
  // `--file` and `--name` are required, so every fragment carries both.
  "talk attach": {
    "--file": ["--file", "/tmp/staged/notes.md", "--name", "notes.md"],
    "--home": ["--file", "/tmp/staged/notes.md", "--name", "notes.md", "--home", "/tmp/a-home"],
    "--json": ["--file", "/tmp/staged/notes.md", "--name", "notes.md", "--json"],
    "--name": ["--file", "/tmp/staged/notes.md", "--name", "notes.md"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "talk code": ({ fragment }) => parseCodeArgs({ rest: fragment }),
  "talk file": ({ fragment }) => parseFileArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "talk capabilities": ({ fragment }) =>
    parseCapabilitiesArgs({ rest: fragment }).mapErr((error) => talkPositionalArgsErrorLines({ error })),
  "talk glossary": ({ fragment }) => parseGlossaryArgs({ rest: fragment }),
  "talk recall": ({ fragment }) => parseRecallArgs({ rest: fragment }),
  "talk knowledge": ({ fragment }) => parseKnowledgeArgs({ rest: fragment }),
  "talk pack": ({ fragment }) => parsePackArgs({ rest: fragment }),
  "talk find-card": ({ fragment }) =>
    parseFindCardArgs({ rest: fragment }).mapErr((error) => talkPositionalArgsErrorLines({ error })),
  "talk slack-after": ({ fragment }) => parseSlackAfterArgs({ rest: fragment }),
  "talk slack-channel": ({ fragment }) => parseSlackChannelArgs({ rest: fragment }),
  "talk slack-open": ({ fragment }) => parseSlackOpenArgs({ rest: fragment }),
  "talk slack-send-outcome": ({ fragment }) => parseSlackSendOutcomeArgs({ rest: fragment }),
  "talk list": ({ fragment }) => parseListArgs({ rest: fragment }),
  "talk list-add": ({ fragment }) => parseListAddArgs({ rest: fragment }),
  "talk quarantine": ({ fragment }) => parseQuarantineArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "talk cursor-retire": ({ fragment }) => parseCursorRetireArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "talk cards": ({ fragment }) => parseCardsArgs({ rest: fragment }),
  "talk restore": ({ fragment }) => parseRestoreArgs({ rest: fragment }),
  "talk attach": ({ fragment }) => parseAttachArgs({ rest: fragment }),
};

/** The rows for `talk`'s context, card-finding and Slack verbs. */
export const talkContextSlice: HelpTruthSlice = { guarded, probes, parsers };
