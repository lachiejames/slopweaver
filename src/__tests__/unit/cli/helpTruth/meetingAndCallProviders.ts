/**
 * The help-truth tables' rows for `outlook`, `outlook-calendar`, `fathom`, `twilio` and `google` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { parseClearInboxArgs } from "../../../../cli/commands/fathom/clearInboxRun.js";
import { parseDiscoverArgs, parseShareArgs } from "../../../../cli/commands/fathom/run.js";
import {
  FATHOM_CLEAR_INBOX_FLAG_NAMES,
  FATHOM_DISCOVER_FLAG_NAMES,
  FATHOM_SHARE_FLAG_NAMES,
} from "../../../../cli/commands/fathom/usage.js";
import { GOOGLE_ADC_FLAG_NAMES, parseGoogleAdcArgs } from "../../../../cli/commands/google/adcArgs.js";
import { GOOGLE_AUDIT_LOG_FLAG_NAMES, parseGoogleAuditLogArgs } from "../../../../cli/commands/google/auditLogArgs.js";
import { parseOutlookConnectArgs } from "../../../../cli/commands/outlook/connectCore.js";
import {
  OUTLOOK_FLAG_NAMES,
  parseOutlookAttachmentArgs,
  parseOutlookListArgs,
  parseOutlookMeasureArgs,
  parseOutlookReadArgs,
  parseOutlookTriageArgs,
  parseOutlookViewArgs,
} from "../../../../cli/commands/outlook/core.js";
import { OUTLOOK_CATEGORIES_USAGE, OUTLOOK_FOLDERS_USAGE } from "../../../../cli/commands/outlook/outlookUsage.js";
import {
  parseOutlookArchiveArgs,
  parseOutlookCategoryArgs,
  parseOutlookDraftArgs,
  parseOutlookMarkArgs,
  parseOutlookSendArgs,
} from "../../../../cli/commands/outlook/writeCore.js";
import {
  OUTLOOK_CALENDAR_FLAG_NAMES,
  parseOutlookCalendarCalendarsArgs,
  parseOutlookCalendarListArgs,
  parseOutlookCalendarReadArgs,
} from "../../../../cli/commands/outlookCalendar/core.js";
import {
  parseTwilioMessageOptions,
  parseTwilioMessagesOptions,
  parseTwilioVerifyOptions,
} from "../../../../cli/commands/twilio/core.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags, markDirection } from "./sharedProbes.js";

/** A `google audit-log pull` carrying its three required flags; a probe adds one principal choice. */
const GOOGLE_AUDIT_LOG_PULL_PROBE = [
  "pull",
  "--org",
  "112233445566",
  "--quota-project",
  "acme-local",
  "--since",
  "2025-08-29T00:00:00Z",
] as const;

/**
 * The argv a `google audit-log` probe parses: a fragment naming its action as given, any other (the unknown-flag
 * strictness probe) after `summary`, so the parser reaches the flag rather than refusing a missing action.
 */
function auditLogProbeArgv({ fragment }: { fragment: readonly string[] }): readonly string[] {
  const [first] = fragment;
  if (first === "pull" || first === "summary") {
    return fragment;
  }
  return ["summary", ...fragment];
}

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "fathom clear-inbox": FATHOM_CLEAR_INBOX_FLAG_NAMES,
  "fathom discover": FATHOM_DISCOVER_FLAG_NAMES,
  "fathom share": FATHOM_SHARE_FLAG_NAMES,
  "twilio message": ["--sid", "--home", "--json"],
  "twilio messages": ["--to", "--from", "--sent-after", "--sent-before", "--limit", "--home", "--json"],
  "twilio verify": ["--home", "--json"],
  "google adc": GOOGLE_ADC_FLAG_NAMES,
  "google audit-log": GOOGLE_AUDIT_LOG_FLAG_NAMES,
  "outlook archive": OUTLOOK_FLAG_NAMES["archive"]!,
  "outlook attachment": OUTLOOK_FLAG_NAMES["attachment"]!,
  "outlook categories": OUTLOOK_FLAG_NAMES["categories"]!,
  "outlook category": OUTLOOK_FLAG_NAMES["category"]!,
  "outlook connect": OUTLOOK_FLAG_NAMES["connect"]!,
  "outlook draft": OUTLOOK_FLAG_NAMES["draft"]!,
  "outlook folders": OUTLOOK_FLAG_NAMES["folders"]!,
  "outlook list": OUTLOOK_FLAG_NAMES["list"]!,
  "outlook mark": OUTLOOK_FLAG_NAMES["mark"]!,
  "outlook measure": OUTLOOK_FLAG_NAMES["measure"]!,
  "outlook read": OUTLOOK_FLAG_NAMES["read"]!,
  "outlook send": OUTLOOK_FLAG_NAMES["send"]!,
  "outlook triage": OUTLOOK_FLAG_NAMES["triage"]!,
  "outlook-calendar calendars": OUTLOOK_CALENDAR_FLAG_NAMES["calendars"]!,
  "outlook-calendar list": OUTLOOK_CALENDAR_FLAG_NAMES["list"]!,
  "outlook-calendar read": OUTLOOK_CALENDAR_FLAG_NAMES["read"]!,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "fathom clear-inbox": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--limit": ["--limit", "10"],
  },
  "fathom discover": {
    "--home": ["--home", "/tmp"],
    "--ingest": ["--ingest"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
  },
  "fathom share": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--no-store": ["--no-store"],
  },
  "twilio message": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--sid": ["--sid", "SM0123456789abcdef0123456789abcdef"],
  },
  "twilio messages": {
    "--from": ["--from", "+61480000999"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--sent-after": ["--sent-after", "2026-10-11"],
    "--sent-before": ["--sent-before", "2026-10-12"],
    "--to": ["--to", "+61400000000"],
  },
  "twilio verify": { "--home": ["--home", "/tmp"], "--json": ["--json"] },
  "outlook archive": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--restore": ["--restore"],
    "--thread": ["--thread"],
  },
  "outlook attachment": {
    "--attachment-id": ["--attachment-id", "att-1"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--max-file-mb": ["--max-file-mb", "5"],
    "--name": ["--name", "notes.pdf"],
  },
  "outlook categories": { "--home": ["--home", "/tmp"], "--json": ["--json"] },
  "outlook category": {
    "--add": ["--add", "Waiting on"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--remove": ["--remove", "Done"],
    "--thread": ["--thread"],
  },
  "outlook connect": {
    "--calendar": ["--calendar"],
    "--disconnect": ["--disconnect"],
    "--grant": ["--grant", "full"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--status": ["--status"],
  },
  "outlook draft": {
    "--dry-run": ["--dry-run"],
    "--form": ["--form", '{"to":["a@example.com"],"subject":"s","body":"b"}'],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--reply-to": ["--reply-to", "msg-1"],
  },
  "outlook folders": { "--home": ["--home", "/tmp"], "--json": ["--json"] },
  "outlook list": {
    "--folder": ["--folder", "archive"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "5"],
    "--query": ["--query", "invoice"],
    "--unread": ["--unread"],
  },
  "outlook mark": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--read": ["--read"],
    "--thread": ["--thread"],
    "--unread": ["--unread"],
  },
  "outlook measure": { "--folder": ["--folder", "inbox"], "--home": ["--home", "/tmp"], "--json": ["--json"] },
  "outlook read": { "--home": ["--home", "/tmp"], "--json": ["--json"], "--thread": ["--thread"] },
  "outlook send": {
    "--approve": ["--approve", "3f9a2c7e1b4d5006"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "outlook triage": { "--home": ["--home", "/tmp"], "--json": ["--json"], "--limit": ["--limit", "5"] },
  "outlook-calendar calendars": { "--home": ["--home", "/tmp"], "--json": ["--json"] },
  "outlook-calendar list": {
    "--calendar": ["--calendar", "cal-1"],
    "--days": ["--days", "3"],
    "--from": ["--from", "2001-01-08"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "5"],
  },
  "outlook-calendar read": { "--home": ["--home", "/tmp"], "--json": ["--json"] },
  "google adc": {
    "--cites": ["--cites", "https://github.com/o/r/pull/1"],
    "--context": ["--context", "slopweaver"],
    "--home": ["--home", "/tmp"],
    "--row": ["--row", "a-row"],
    "--timeout-seconds": ["--wait", "--timeout-seconds", "60"],
    "--unblocks": ["--unblocks", "the local lane"],
    "--wait": ["--wait"],
  },
  // `pull` and `summary` refuse each other's flags, so every probe names its action; a `pull` probe carries
  // the three required flags and one principal choice.
  "google audit-log": {
    "--all-principals": [...GOOGLE_AUDIT_LOG_PULL_PROBE, "--all-principals"],
    "--generation": ["summary", "--generation", "20261003T061500Z-1a2b3c4d"],
    "--home": ["summary", "--home", "/tmp"],
    "--json": ["summary", "--json"],
    "--org": [...GOOGLE_AUDIT_LOG_PULL_PROBE, "--all-principals"],
    "--plan": ["summary", "--plan", "/tmp/plan.json"],
    "--principal": [...GOOGLE_AUDIT_LOG_PULL_PROBE, "--principal", "a@example.com"],
    "--quota-project": [...GOOGLE_AUDIT_LOG_PULL_PROBE, "--all-principals"],
    "--role": [...GOOGLE_AUDIT_LOG_PULL_PROBE, "--all-principals", "--role", "roles/viewer"],
    "--since": [...GOOGLE_AUDIT_LOG_PULL_PROBE, "--all-principals"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  // The three shapes the eight hex verbs share. Each probe below carries the verb.s own REQUIRED flag, so a
  // fragment testing one optional flag does not report the missing required one instead.
  "fathom clear-inbox": ({ fragment }) => parseClearInboxArgs({ rest: [...fragment] }),
  "fathom discover": ({ fragment }) => parseDiscoverArgs({ rest: [...fragment] }),
  // `share` needs its one positional, so the probe supplies a share link ahead of the fragment.
  "fathom share": ({ fragment }) =>
    parseShareArgs({ rest: ["https://fathom.video/share/cPAstBybUhyaoL9wD_xuMQK_byssuMG_", ...fragment] }),
  "twilio message": ({ fragment }) =>
    parseTwilioMessageOptions({
      rest: dedupeFlags({ base: ["--sid", "SM0123456789abcdef0123456789abcdef"], fragment }),
    }),
  "twilio messages": ({ fragment }) => parseTwilioMessagesOptions({ rest: fragment }),
  "twilio verify": ({ fragment }) => parseTwilioVerifyOptions({ rest: fragment }),
  "google adc": ({ fragment }) => parseGoogleAdcArgs({ rest: [...fragment] }),
  "google audit-log": ({ fragment }) => parseGoogleAuditLogArgs({ rest: auditLogProbeArgv({ fragment }) }),
  "outlook archive": ({ fragment }) =>
    parseOutlookArchiveArgs({ rest: ["msg-1", ...fragment] }).mapErr((error) => [error.message]),
  // `attachment` needs exactly one selector, so the probe supplies `--name` unless the fragment IS a selector,
  // which then stands alone rather than clashing with the base's.
  "outlook attachment": ({ fragment }) =>
    parseOutlookAttachmentArgs({
      rest: [
        "msg-1",
        ...(fragment.includes("--name") || fragment.includes("--attachment-id") ? [] : ["--name", "notes.pdf"]),
        ...fragment,
      ],
    }).mapErr((error) => [error.message]),
  "outlook categories": ({ fragment }) =>
    parseOutlookViewArgs({ rest: [...fragment], usage: OUTLOOK_CATEGORIES_USAGE }).mapErr((error) => [error.message]),
  // `category` needs a change, so the probe supplies one and each fragment is appended after it.
  "outlook category": ({ fragment }) =>
    parseOutlookCategoryArgs({ rest: ["msg-1", "--remove", "Done", ...fragment] }).mapErr((error) => [error.message]),
  "outlook connect": ({ fragment }) =>
    parseOutlookConnectArgs({ rest: [...fragment] }).mapErr((error) => [error.message]),
  "outlook draft": ({ fragment }) =>
    parseOutlookDraftArgs({
      rest: dedupeFlags({ base: ["--form", '{"to":["a@example.com"],"subject":"s","body":"b"}'], fragment }),
    }).mapErr((error) => [error.message]),
  "outlook folders": ({ fragment }) =>
    parseOutlookViewArgs({ rest: [...fragment], usage: OUTLOOK_FOLDERS_USAGE }).mapErr((error) => [error.message]),
  "outlook list": ({ fragment }) => parseOutlookListArgs({ rest: [...fragment] }).mapErr((error) => [error.message]),
  "outlook mark": ({ fragment }) =>
    parseOutlookMarkArgs({ rest: ["msg-1", ...markDirection({ fragment })] }).mapErr((error) => [error.message]),
  "outlook measure": ({ fragment }) =>
    parseOutlookMeasureArgs({ rest: [...fragment] }).mapErr((error) => [error.message]),
  "outlook read": ({ fragment }) =>
    parseOutlookReadArgs({ rest: ["msg-1", ...fragment] }).mapErr((error) => [error.message]),
  "outlook send": ({ fragment }) =>
    parseOutlookSendArgs({ rest: ["draft-1", ...fragment] }).mapErr((error) => [error.message]),
  "outlook triage": ({ fragment }) =>
    parseOutlookTriageArgs({ rest: [...fragment] }).mapErr((error) => [error.message]),
  "outlook-calendar calendars": ({ fragment }) =>
    parseOutlookCalendarCalendarsArgs({ rest: [...fragment] }).mapErr((error) => [error.message]),
  "outlook-calendar list": ({ fragment }) =>
    parseOutlookCalendarListArgs({ nowIso: "2001-01-08T00:00:00.000Z", rest: [...fragment] }).mapErr((error) => [
      error.message,
    ]),
  "outlook-calendar read": ({ fragment }) =>
    parseOutlookCalendarReadArgs({ rest: ["event-1", ...fragment] }).mapErr((error) => [error.message]),
};

/** The rows for `outlook`, `outlook-calendar`, `fathom`, `twilio` and `google`. */
export const meetingAndCallProvidersSlice: HelpTruthSlice = { guarded, probes, parsers };
