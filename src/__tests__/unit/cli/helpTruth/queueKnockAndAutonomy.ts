/**
 * The help-truth tables' rows for `queue`, `knock` and `autonomy` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import {
  AUTONOMY_ADOPT_FLAG_NAMES,
  AUTONOMY_LIST_FLAG_NAMES,
  AUTONOMY_QUALIFY_FLAG_NAMES,
  AUTONOMY_RECORD_FLAG_NAMES,
  AUTONOMY_STEER_CLASS_FLAG_NAMES,
  AUTONOMY_STEER_FLAG_NAMES,
  parseAutonomyAdoptArgs,
  parseAutonomyListArgs,
  parseAutonomyQualifyArgs,
  parseAutonomyRecordArgs,
  parseAutonomySteerArgs,
  parseAutonomySteerClassArgs,
} from "../../../../cli/commands/autonomy/core.js";
import {
  parseKnockMessageOptions,
  parseKnockMessagesOptions,
  parseKnockVerifyOptions,
} from "../../../../cli/commands/knock/core.js";
import { parseQueueArgs, QUEUE_FLAG_NAMES } from "../../../../cli/commands/queue/core.js";
import { parseDeferArgs, parseDeferredArgs } from "../../../../cli/commands/queue/deferRun.js";
import { parseRefusalsArgs } from "../../../../cli/commands/queue/refusalsRun.js";
import { parseStoppingArgs } from "../../../../cli/commands/queue/stoppingRun.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags } from "./sharedProbes.js";

/** The value and boolean flags `knock messages` and `knock user-messages` share. */
const KNOCK_FILTER_FLAG_NAMES: readonly string[] = [
  "--channel-id",
  "--status",
  "--source",
  "--tenant",
  "--workflow-run-id",
  "--workflow-recipient-run-id",
  "--inserted-after",
  "--inserted-before",
  "--limit",
  "--home",
  "--json",
];

/** `knock message-events` and `knock delivery-logs`, which differ from `knock message` by `--limit`. */
const KNOCK_MESSAGE_LIST_FLAG_NAMES: readonly string[] = ["--id", "--limit", "--home", "--json"];

/** The knock probe base for a per-message verb: `--id` is required, so every fragment carries it. */
const KNOCK_ID_BASE: readonly string[] = ["--id", "m-1"];

/** The knock probe base for `user-messages`: `--user-id` is required. */
const KNOCK_USER_BASE: readonly string[] = ["--user-id", "user_0123"];

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "knock delivery-logs": KNOCK_MESSAGE_LIST_FLAG_NAMES,
  "knock message": ["--id", "--home", "--json"],
  "knock message-events": KNOCK_MESSAGE_LIST_FLAG_NAMES,
  "knock messages": KNOCK_FILTER_FLAG_NAMES,
  "knock user-messages": ["--user-id", ...KNOCK_FILTER_FLAG_NAMES],
  "knock verify": ["--home", "--json"],
  "autonomy adopt": AUTONOMY_ADOPT_FLAG_NAMES,
  "autonomy qualify": AUTONOMY_QUALIFY_FLAG_NAMES,
  "autonomy list": AUTONOMY_LIST_FLAG_NAMES,
  "autonomy record": AUTONOMY_RECORD_FLAG_NAMES,
  "autonomy steer": AUTONOMY_STEER_FLAG_NAMES,
  "autonomy steer-class": AUTONOMY_STEER_CLASS_FLAG_NAMES,
  "queue defer": ["--by-session", "--home", "--id", "--json", "--kind", "--restore"],
  "queue deferred": ["--home", "--json"],
  "queue drop": QUEUE_FLAG_NAMES["drop"]!,
  "queue list": QUEUE_FLAG_NAMES["list"]!,
  "queue refusals": ["--json"],
  "queue stopping": ["--json"],
  "queue release": QUEUE_FLAG_NAMES["release"]!,
  "queue show": QUEUE_FLAG_NAMES["show"]!,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "knock delivery-logs": {
    "--home": ["--home", "/tmp"],
    "--id": ["--id", "m-1"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
  },
  "knock message": { "--home": ["--home", "/tmp"], "--id": ["--id", "m-1"], "--json": ["--json"] },
  "knock message-events": {
    "--home": ["--home", "/tmp"],
    "--id": ["--id", "m-1"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
  },
  "knock messages": {
    "--channel-id": ["--channel-id", "chan-sms"],
    "--home": ["--home", "/tmp"],
    "--inserted-after": ["--inserted-after", "2026-10-11T00:00:00Z"],
    "--inserted-before": ["--inserted-before", "2026-10-12T00:00:00Z"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--source": ["--source", "booking-reminder"],
    "--status": ["--status", "undelivered"],
    "--tenant": ["--tenant", "t-1"],
    "--workflow-recipient-run-id": ["--workflow-recipient-run-id", "wrr-1"],
    "--workflow-run-id": ["--workflow-run-id", "wr-1"],
  },
  "knock user-messages": {
    "--channel-id": ["--channel-id", "chan-sms"],
    "--home": ["--home", "/tmp"],
    "--inserted-after": ["--inserted-after", "2026-10-11T00:00:00Z"],
    "--inserted-before": ["--inserted-before", "2026-10-12T00:00:00Z"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--source": ["--source", "booking-reminder"],
    "--status": ["--status", "undelivered"],
    "--tenant": ["--tenant", "t-1"],
    "--user-id": ["--user-id", "user_0123"],
    "--workflow-recipient-run-id": ["--workflow-recipient-run-id", "wrr-1"],
    "--workflow-run-id": ["--workflow-run-id", "wr-1"],
  },
  "knock verify": { "--home": ["--home", "/tmp"], "--json": ["--json"] },
  "autonomy adopt": {
    "--apply": ["--apply"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "autonomy qualify": {
    "--apply": ["--apply"],
    "--home": ["--home", "/tmp"],
    "--repo": ["--repo", "acme/widgets"],
  },
  "autonomy list": {
    "--by-session": ["--by-session", "workspace:123"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--kind": ["--kind", "press-merge-when-ready"],
    "--since": ["--since", "2026-09-12T00:00:00Z"],
    "--unsteered": ["--unsteered"],
  },
  "autonomy record": {
    "--action-id": ["--action-id", "a-one"],
    "--by-session": ["--by-session", "workspace:123"],
    "--done-iso": ["--done-iso", "2026-09-12T02:06:09Z"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--kind": ["--kind", "press-merge-when-ready"],
    "--run": ["--run", "some-run"],
    "--said": ["--said", "I merged your pull request on the admin app once every check had passed"],
    "--steer": ["--steer", "the owner already said this was right"],
    "--subject": ["--subject", "https://github.com/acme/acme-admin/pull/16644"],
    "--why": ["--why", "what made it obvious"],
    "--witness": ["--witness", "the verb and the line it printed"],
  },
  "autonomy steer": {
    "--by-session": ["--by-session", "supervisor"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--steer": ["--steer", "the owner's own words"],
  },
  "autonomy steer-class": {
    "--anchor": ["--anchor", "transcript:a0000032#70ca5dd7"],
    "--by-session": ["--by-session", "supervisor"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--kinds": ["--kinds", "press-merge-when-ready,land-own-pull-request"],
    "--steer": ["--steer", "the owner's own words"],
    "--subject-prefix": ["--subject-prefix", "https://acme.slack.com/archives/D0SYN000001/"],
  },
  "queue defer": {
    "--by-session": ["--by-session", "work-console"],
    "--home": ["--home", "/tmp"],
    "--id": ["--id", "policy-approvals"],
    "--json": ["--json"],
    "--kind": ["--kind", "hand"],
    "--restore": ["--restore"],
  },
  "queue deferred": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "queue drop": {
    "--home": ["--home", "/tmp"],
    "--note": ["--note", "answered by hand"],
  },
  "queue list": {
    "--all": ["--all"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "queue refusals": {
    "--json": ["--json"],
  },
  "queue stopping": {
    "--json": ["--json"],
  },
  "queue release": {
    "--dry-run": ["--dry-run"],
    "--form": ["--form", "{}"],
    "--home": ["--home", "/tmp"],
    "--note": ["--note", "looked fine"],
  },
  "queue show": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  // `--id` and `--user-id` are required, so a fragment probing any other flag carries them.
  "knock delivery-logs": ({ fragment }) =>
    parseKnockMessageOptions({ rest: dedupeFlags({ base: KNOCK_ID_BASE, fragment }), withLimit: true }),
  "knock message": ({ fragment }) =>
    parseKnockMessageOptions({ rest: dedupeFlags({ base: KNOCK_ID_BASE, fragment }), withLimit: false }),
  "knock message-events": ({ fragment }) =>
    parseKnockMessageOptions({ rest: dedupeFlags({ base: KNOCK_ID_BASE, fragment }), withLimit: true }),
  "knock messages": ({ fragment }) => parseKnockMessagesOptions({ rest: fragment, withUser: false }),
  "knock user-messages": ({ fragment }) =>
    parseKnockMessagesOptions({ rest: dedupeFlags({ base: KNOCK_USER_BASE, fragment }), withUser: true }),
  "knock verify": ({ fragment }) => parseKnockVerifyOptions({ rest: fragment }),
  "autonomy adopt": ({ fragment }) => parseAutonomyAdoptArgs({ rest: [...fragment] }),
  "autonomy qualify": ({ fragment }) => parseAutonomyQualifyArgs({ rest: [...fragment] }),
  "autonomy list": ({ fragment }) => parseAutonomyListArgs({ rest: [...fragment] }),
  "autonomy record": ({ fragment }) => parseAutonomyRecordArgs({ rest: [...fragment] }),
  // The act's id is a POSITIONAL, so every probe carries one — the parser refuses a bare flag set.
  "autonomy steer": ({ fragment }) => parseAutonomySteerArgs({ rest: ["a-one", ...fragment] }),
  // The class's name is a POSITIONAL, the same way.
  "autonomy steer-class": ({ fragment }) => parseAutonomySteerClassArgs({ rest: ["a-class", ...fragment] }),
  "queue defer": ({ fragment }) =>
    parseDeferArgs({ rest: dedupeFlags({ base: ["--kind", "ask", "--id", "x"], fragment }) }),
  "queue deferred": ({ fragment }) => parseDeferredArgs({ rest: [...fragment] }),
  "queue drop": ({ fragment }) => parseQueueArgs({ rest: ["q-1", ...fragment], verb: "drop" }),
  "queue list": ({ fragment }) => parseQueueArgs({ rest: [...fragment], verb: "list" }),
  "queue refusals": ({ fragment }) => parseRefusalsArgs({ rest: [...fragment] }),
  "queue stopping": ({ fragment }) => parseStoppingArgs({ rest: [...fragment] }),
  "queue release": ({ fragment }) => parseQueueArgs({ rest: ["q-1", ...fragment], verb: "release" }),
  "queue show": ({ fragment }) => parseQueueArgs({ rest: ["q-1", ...fragment], verb: "show" }),
};

/** The rows for `queue`, `knock` and `autonomy`. */
export const queueKnockAndAutonomySlice: HelpTruthSlice = { guarded, probes, parsers };
