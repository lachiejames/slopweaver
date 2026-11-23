/**
 * The help-truth tables' rows for `hand` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import {
  HAND_DONE_FLAG_NAMES,
  HAND_LIST_FLAG_NAMES,
  HAND_MUTE_FLAG_NAMES,
  HAND_POST_FLAG_NAMES,
  HAND_PUSH_FLAG_NAMES,
  HAND_RECHECK_FLAG_NAMES,
  HAND_RETRACT_FLAG_NAMES,
  HAND_SHOW_FLAG_NAMES,
  HAND_SNOOZE_FLAG_NAMES,
  HAND_WAKE_FLAG_NAMES,
  parseHandDoneArgs,
  parseHandListArgs,
  parseHandMuteArgs,
  parseHandPostArgs,
  parseHandPushArgs,
  parseHandRecheckArgs,
  parseHandRetractArgs,
  parseHandShowArgs,
  parseHandSnoozeArgs,
  parseHandWakeArgs,
} from "../../../../cli/commands/hand/core.js";
import { HAND_LINE_RETIRE_FLAG_NAMES, parseHandLineRetireArgs } from "../../../../cli/commands/hand/lineRetireArgs.js";
import { HAND_SURFACE_FLAG_NAMES, parseHandSurfaceArgs } from "../../../../cli/commands/hand/surfaceArgs.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags } from "./sharedProbes.js";

/*
 * A VALID invocation fragment for each advertised flag, per guarded verb.
 *
 * A real value rather than a string-matched error, because matching on the words "unknown flag" conflated
 * "recognised" with "accepted": a parser could reject an advertised flag for any other reason — a semantic
 * refusal, a disabled option — and the check would read that as acceptance. Feeding each flag something
 * genuinely valid and demanding the parse SUCCEED removes the heuristic entirely.
 *
 * A flag with no entry here fails the completeness test below rather than being skipped, so a new flag
 * cannot join the surface without someone stating what a valid use of it looks like.
 */
/**
 * A valid `hand surface` invocation at `--urgency none`, so each flag's probe only needs to add itself; the parser
 * refuses a report missing any required field, so a lone flag would fail on the others.
 */
const HAND_SURFACE_BASE_PROBE: readonly string[] = [
  "--row",
  "runner-outage",
  "--ask-slug",
  "runner-outage-access",
  "--tried",
  "re-ran the jobs",
  "--doc",
  "https://docs.github.com/en/actions",
  "--documented",
  "a queued job picks a runner",
  "--observed",
  "jobs sit queued",
  "--codex",
  "Codex agrees on the docs",
  "--why",
  "I do not know why",
  "--urgency",
  "none",
  "--question",
  "Ask Rosa?",
  "--problem",
  "jobs sit queued",
  "--options",
  "ask Rosa :: one message\nkeep pulling :: hours",
  "--lean",
  "ask Rosa",
  "--risk",
  "merges stay blocked",
  "--blast-radius",
  "every merge",
  "--still-real",
  "the run is still queued",
  "--evidence",
  "https://github.com/o/r/actions/runs/1",
  "--observed-by",
  "workspace:129",
  "--context",
  "work",
];

/** `--urgency breaking` with every companion it needs, displacing the base's `none`. */
const HAND_SURFACE_BREAKING_PROBE = [
  "--urgency",
  "breaking",
  "--breaks",
  "every merge",
  "--by",
  "now",
  "--note-what",
  "Ask Rosa for read on the runner settings",
] as const;

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "hand done": HAND_DONE_FLAG_NAMES,
  "hand line-retire": HAND_LINE_RETIRE_FLAG_NAMES,
  "hand list": HAND_LIST_FLAG_NAMES,
  "hand mute": HAND_MUTE_FLAG_NAMES,
  "hand post": HAND_POST_FLAG_NAMES,
  "hand push": HAND_PUSH_FLAG_NAMES,
  "hand recheck": HAND_RECHECK_FLAG_NAMES,
  "hand retract": HAND_RETRACT_FLAG_NAMES,
  "hand surface": HAND_SURFACE_FLAG_NAMES,
  "hand show": HAND_SHOW_FLAG_NAMES,
  "hand snooze": HAND_SNOOZE_FLAG_NAMES,
  "hand wake": HAND_WAKE_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "hand done": {
    "--by-session": ["--by-session", "workspace:129"],
    "--did": ["--did", "signed in as the owner, the deploy resumed"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "hand line-retire": {
    "--apply": ["--apply"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--reason": ["--reason", "settled by a later readable line"],
    "--source-sha256": ["--source-sha256", "0".repeat(64)],
  },
  "hand list": {
    "--by-session": ["--by-session", "workspace:129"],
    "--gaps": ["--gaps"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--ranked": ["--ranked"],
  },
  "hand mute": {
    "--by-session": ["--by-session", "work-console"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "hand post": {
    "--blocks": ["--blocks"],
    "--box": ["--box", "40,120,320,36=the Personal API keys field"],
    "--by-session": ["--by-session", "workspace:129"],
    "--check-in": ["--check-in"],
    "--checklist": ["--checklist", '[{"action":"Click Create","url":"https://console.cloud.google.com/"}]'],
    "--cites": ["--cites", "https://github.com/acme/acme-admin/pull/16672"],
    "--context": ["--context", "work"],
    "--home": ["--home", "/tmp"],
    "--id": ["--id", "gcloud-signin"],
    "--if-ignored": ["--if-ignored", "the monitor deploy stays unshipped and its alerts stay off"],
    "--json": ["--json"],
    "--literal": ["--literal", "gcloud auth application-default login"],
    "--open": ["--open", "ask:a-round-two-row-is-seated-and-opens"],
    "--opened": ["--opened", "https://app.datadoghq.com/account/login"],
    "--no-address": ["--no-address", "it is a word the owner says on the call"],
    "--posted-iso": ["--posted-iso", "2026-09-19T04:35:44.113Z"],
    "--quiet": ["--quiet"],
    "--read-owner-words": ["--read-owner-words", "call:9b2f1c3e-0000-4b6c-8d7e-0f1a2b3c4d5e#s-1"],
    "--recheck": ["--recheck", "browser-session:https://dashboard.clerk.com"],
    "--row": ["--row", "datadog-monitor-deploy"],
    "--shot": ["--shot", "/tmp/linear-api-settings.png"],
    "--standalone": ["--standalone"],
    "--supersedes": ["--supersedes", "gcloud-signin-old"],
    "--unblocks": ["--unblocks", "handover run datadog-monitor-deploy"],
    "--url": ["--url", "https://console.cloud.google.com/"],
    "--what": ["--what", "Sign in to Google Cloud so the monitor deploy can finish"],
    "--where": ["--where", "any terminal"],
    "--witness": ["--witness", "slopweaver hand done gcloud-signin"],
  },
  "hand push": {
    "--by-session": ["--by-session", "workspace:129"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "hand surface": {
    "--access": ["--access", "read on runner settings", "--holder", "Rosa", "--would-settle", "the pool"],
    "--ask-slug": ["--ask-slug", "runner-outage-access"],
    "--blast-radius": ["--blast-radius", "every merge"],
    "--breaks": [...HAND_SURFACE_BREAKING_PROBE],
    "--by": [...HAND_SURFACE_BREAKING_PROBE],
    "--by-session": ["--by-session", "workspace:129"],
    "--codex": ["--codex", "Codex agrees on the docs"],
    "--context": ["--context", "slopweaver"],
    "--doc": ["--doc", "https://docs.github.com/en/actions"],
    "--documented": ["--documented", "a queued job picks a runner"],
    "--evidence": ["--evidence", "https://github.com/o/r/actions/runs/1"],
    "--hedge": ["--hedge", "email support now"],
    "--holder": ["--access", "read on runner settings", "--holder", "Rosa", "--would-settle", "the pool"],
    "--if-silent": ["--urgency", "close-call", "--if-silent", "a renewal lands", "--note-what", "Say who uses it"],
    "--json": ["--json"],
    "--lean": ["--lean", "ask Rosa"],
    "--note-what": [...HAND_SURFACE_BREAKING_PROBE],
    "--observed": ["--observed", "jobs sit queued"],
    "--observed-by": ["--observed-by", "workspace:129"],
    "--options": ["--options", "ask Rosa :: one message\nkeep pulling :: hours"],
    "--problem": ["--problem", "jobs sit queued"],
    "--question": ["--question", "Ask Rosa?"],
    "--risk": ["--risk", "merges stay blocked"],
    "--row": ["--row", "runner-outage"],
    "--send": ["--urgency", "blocked-send", "--send", "the approved reply", "--note-what", "Sign in to Gmail"],
    "--still-real": ["--still-real", "the run is still queued"],
    "--tried": ["--tried", "re-ran the jobs"],
    "--urgency": ["--urgency", "fleet-idle", "--note-what", "Ask Rosa for read on the runner settings"],
    "--why": ["--why", "I do not know why"],
    "--would-settle": ["--access", "read on runner settings", "--holder", "Rosa", "--would-settle", "the pool"],
  },
  "hand recheck": {
    "--by-session": ["--by-session", "supervisor"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "hand retract": {
    "--by-session": ["--by-session", "workspace:129"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--why": ["--why", "a parked run, already on the owner's queue"],
  },
  "hand show": {
    "--by-session": ["--by-session", "workspace:129"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "hand snooze": {
    "--by-session": ["--by-session", "work-console"],
    "--for": ["--for", "1h"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "hand wake": {
    "--by-session": ["--by-session", "supervisor"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "hand done": ({ fragment }) => parseHandDoneArgs({ rest: [...fragment] }),
  "hand line-retire": ({ fragment }) => parseHandLineRetireArgs({ rest: [...fragment] }),
  "hand list": ({ fragment }) => parseHandListArgs({ rest: [...fragment] }),
  "hand mute": ({ fragment }) => parseHandMuteArgs({ rest: [...fragment] }),
  "hand post": ({ fragment }) => parseHandPostArgs({ rest: [...fragment] }),
  "hand push": ({ fragment }) => parseHandPushArgs({ rest: [...fragment] }),
  "hand recheck": ({ fragment }) => parseHandRecheckArgs({ rest: [...fragment] }),
  "hand retract": ({ fragment }) => parseHandRetractArgs({ rest: [...fragment] }),
  "hand surface": ({ fragment }) =>
    parseHandSurfaceArgs({ rest: dedupeFlags({ base: HAND_SURFACE_BASE_PROBE, fragment }) }).mapErr((error) => [
      error.message,
    ]),
  "hand show": ({ fragment }) => parseHandShowArgs({ rest: [...fragment] }),
  "hand snooze": ({ fragment }) => parseHandSnoozeArgs({ rest: [...fragment] }),
  "hand wake": ({ fragment }) => parseHandWakeArgs({ rest: [...fragment] }),
};

/** The rows for `hand`. */
export const handSlice: HelpTruthSlice = { guarded, probes, parsers };
