/**
 * The help-truth tables' rows for `gmail` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { parseGmailArchiveArgs } from "../../../../cli/commands/gmail/archiveArgs.js";
import { parseGmailCardMailArgs } from "../../../../cli/commands/gmail/cardMailRun.js";
import { parseClearMeetingNotesArgs } from "../../../../cli/commands/gmail/clearMeetingNotesCore.js";
import { parseGmailDraftArgs, parseGmailSendArgs } from "../../../../cli/commands/gmail/composeCore.js";
import { parseGmailConnectArgs } from "../../../../cli/commands/gmail/connectCore.js";
import {
  GMAIL_FLAG_NAMES,
  parseGmailAttachmentArgs,
  parseGmailLabelArgs,
  parseGmailLabelsArgs,
  parseGmailListArgs,
  parseGmailMarkArgs,
  parseGmailMeasureArgs,
  parseGmailReadArgs,
} from "../../../../cli/commands/gmail/core.js";
import { parseGmailTriageArgs } from "../../../../cli/commands/gmail/triageCore.js";
import { parseGmailTriageRulesArgs } from "../../../../cli/commands/gmail/triageRulesCore.js";
import { parseGmailUnsubscribeArgs } from "../../../../cli/commands/gmail/unsubscribeRun.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags, markDirection } from "./sharedProbes.js";

/** The invocation a `gmail draft` fragment is appended to: the board pair for a board flag, a form otherwise. */
function draftProbeBase({ fragment }: { fragment: readonly string[] }): readonly string[] {
  if (fragment.includes("--board") || fragment.includes("--expect")) {
    return ["--board", "iso-compliance-mail", "--expect", "3f9a2c7e1b4d5006"];
  }
  return ["--form", '{"to":["a@example.com"],"subject":"s","body":"b"}'];
}

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "gmail archive": GMAIL_FLAG_NAMES["archive"]!,
  "gmail attachment": GMAIL_FLAG_NAMES["attachment"]!,
  "gmail card-mail": GMAIL_FLAG_NAMES["card-mail"]!,
  "gmail clear-meeting-notes": GMAIL_FLAG_NAMES["clear-meeting-notes"]!,
  "gmail connect": GMAIL_FLAG_NAMES["connect"]!,
  "gmail draft": GMAIL_FLAG_NAMES["draft"]!,
  "gmail label": GMAIL_FLAG_NAMES["label"]!,
  "gmail labels": GMAIL_FLAG_NAMES["labels"]!,
  "gmail list": GMAIL_FLAG_NAMES["list"]!,
  "gmail mark": GMAIL_FLAG_NAMES["mark"]!,
  "gmail measure": GMAIL_FLAG_NAMES["measure"]!,
  "gmail read": GMAIL_FLAG_NAMES["read"]!,
  "gmail send": GMAIL_FLAG_NAMES["send"]!,
  "gmail triage": GMAIL_FLAG_NAMES["triage"]!,
  "gmail triage-rules": GMAIL_FLAG_NAMES["triage-rules"]!,
  "gmail unsubscribe": GMAIL_FLAG_NAMES["unsubscribe"]!,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "gmail archive": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--restore": ["--restore"],
    "--thread": ["--thread"],
  },
  "gmail attachment": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--max-file-mb": ["--max-file-mb", "5"],
    "--name": ["--name", "notes.txt"],
    "--part": ["--part", "1"],
  },
  "gmail card-mail": {
    "--fetch": ["--fetch"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--message": ["--message", "1a040f3c0bfaa311"],
  },
  "gmail draft": {
    "--dry-run": ["--dry-run"],
    // Inline JSON rather than `-`, so the probe never blocks on a stdin nobody is going to write to.
    "--form": ["--form", '{"to":["a@example.com"],"subject":"s","body":"b"}'],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--reply-to": ["--reply-to", "1a040f3c0bfaa311"],
    "--board": ["--board", "iso-compliance-mail"],
    "--expect": ["--expect", "3f9a2c7e1b4d5006"],
  },
  "gmail send": {
    "--approve": ["--approve", "3f9a2c7e1b4d5006"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "gmail label": {
    "--add": ["--add", "Urgent"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--remove": ["--remove", "INBOX"],
    "--thread": ["--thread"],
  },
  "gmail labels": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "gmail mark": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--read": ["--read"],
    "--thread": ["--thread"],
    "--unread": ["--unread"],
  },
  "gmail connect": {
    "--grant": ["--grant", "full"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--revoke": ["--revoke"],
    "--status": ["--status"],
  },
  "gmail list": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--label": ["--label", "INBOX"],
    "--limit": ["--limit", "10"],
    "--query": ["--query", "is:unread"],
  },
  "gmail measure": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--query": ["--query", "is:unread"],
    "--sample-bytes": ["--sample-bytes", "10"],
  },
  "gmail clear-meeting-notes": {
    "--audit": ["--audit"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--limit": ["--limit", "10"],
  },
  "gmail read": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--thread": ["--thread"],
  },
  // `--pin` records ONE group's ids, so its probe names the group too.
  "gmail triage": {
    "--card": ["--card", "inbox-triage-1"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--key": ["--key", "from:alerts@example.test"],
    "--limit": ["--limit", "50"],
    "--pin": ["--key", "from:alerts@example.test", "--pin", "inbox-triage-1"],
    "--ruled": ["--ruled"],
    "--write": ["--write"],
  },
  "gmail triage-rules": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--set": ["--set", "/tmp/rules.json"],
  },
  "gmail unsubscribe": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "gmail archive": ({ fragment }) =>
    parseGmailArchiveArgs({ rest: ["1a040f3c0bfaa311", ...fragment] }).mapErr((error) => [error.message]),
  // `attachment` needs a selector to be valid at all, so the probe supplies `--part` and each fragment is appended
  // AFTER it — a `--part` fragment simply wins as the last occurrence.
  "gmail attachment": ({ fragment }) =>
    parseGmailAttachmentArgs({ rest: dedupeFlags({ base: ["1a040f3c0bfaa311", "--part", "1"], fragment }) }).mapErr(
      (error) => [error.message],
    ),
  "gmail card-mail": ({ fragment }) =>
    parseGmailCardMailArgs({ rest: ["inbox-triage-1", ...fragment] }).mapErr((error) => [error.message]),
  "gmail clear-meeting-notes": ({ fragment }) =>
    parseClearMeetingNotesArgs({ rest: [...fragment] }).mapErr((error) => [error.message]),
  "gmail connect": ({ fragment }) => parseGmailConnectArgs({ rest: [...fragment] }).mapErr((error) => [error.message]),
  // `label` needs a change to be valid at all, so the probe supplies one and each fragment is appended
  // AFTER it — probing `--add` alone would otherwise fail on "nothing to change" rather than on the flag.
  "gmail label": ({ fragment }) =>
    parseGmailLabelArgs({ rest: ["1a040f3c0bfaa311", "--remove", "INBOX", ...fragment] }).mapErr((error) => [
      error.message,
    ]),
  "gmail labels": ({ fragment }) => parseGmailLabelsArgs({ rest: [...fragment] }).mapErr((error) => [error.message]),
  // `draft` needs a form to be valid at all, so the probe supplies one and each fragment is appended AFTER
  // it — the same shape `label` uses, and for the same reason: probing `--json` alone would otherwise fail
  // on "--form is required" rather than on the flag under test. A `--form` fragment simply wins as the last
  // occurrence, which is what the single-value parser does with a repeated flag.
  //
  // `--board` and `--expect` are the OTHER source of the form and are refused beside `--form`, so a fragment
  // naming either is probed as the whole board pair instead — the fragment still wins as the last occurrence.
  "gmail draft": ({ fragment }) =>
    parseGmailDraftArgs({ rest: dedupeFlags({ base: draftProbeBase({ fragment }), fragment }) }).mapErr((error) => [
      error.message,
    ]),
  "gmail send": ({ fragment }) =>
    parseGmailSendArgs({ rest: ["r1a040f3c0bfaa311", ...fragment] }).mapErr((error) => [error.message]),
  // Same shape: `mark` requires exactly one direction, so the probe supplies --read. The `--read` and
  // `--unread` fragments are handled below, because appending either to this would be a double or a clash.
  "gmail mark": ({ fragment }) =>
    parseGmailMarkArgs({ rest: ["1a040f3c0bfaa311", ...markDirection({ fragment })] }).mapErr((error) => [
      error.message,
    ]),
  "gmail list": ({ fragment }) => parseGmailListArgs({ rest: [...fragment] }).mapErr((error) => [error.message]),
  "gmail measure": ({ fragment }) => parseGmailMeasureArgs({ rest: [...fragment] }).mapErr((error) => [error.message]),
  "gmail read": ({ fragment }) =>
    parseGmailReadArgs({ rest: ["1a040f3c0bfaa311", ...fragment] }).mapErr((error) => [error.message]),
  "gmail triage": ({ fragment }) => parseGmailTriageArgs({ rest: [...fragment] }).mapErr((error) => [error.message]),
  "gmail triage-rules": ({ fragment }) =>
    parseGmailTriageRulesArgs({ rest: [...fragment] }).mapErr((error) => [error.message]),
  "gmail unsubscribe": ({ fragment }) =>
    parseGmailUnsubscribeArgs({ rest: ["1a040f3c0bfaa311", ...fragment] }).mapErr((error) => [error.message]),
};

/** The rows for `gmail`. */
export const gmailSlice: HelpTruthSlice = { guarded, probes, parsers };
