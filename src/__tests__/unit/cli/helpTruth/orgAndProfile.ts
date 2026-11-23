/**
 * The help-truth tables' rows for `profile`, `org`, `org-health` and `route` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { orgSetArgs, orgShowArgs } from "../../../../cli/commands/org/core.js";
import {
  ORG_HEALTH_ACK_FLAG_NAMES,
  ORG_HEALTH_READ_FLAG_NAMES,
  orgHealthAckOptions,
  orgHealthReadOptions,
} from "../../../../cli/commands/orgHealth/core.js";
import {
  PROFILE_HARVEST_FLAG_NAMES,
  PROFILE_PERSON_FLAG_NAMES,
  PROFILE_SHOW_FLAG_NAMES,
  PROFILE_WRITE_FLAG_NAMES,
  parseProfileHarvestArgs,
  parseProfilePersonArgs,
  parseProfileShowArgs,
  parseProfileWriteArgs,
} from "../../../../cli/commands/profile/core.js";
import {
  PROFILE_GUIDANCE_FLAG_NAMES,
  parseProfileGuidanceArgs,
} from "../../../../cli/commands/profile/guidanceArgs.js";
import {
  PROFILE_STANDING_FLAG_NAMES,
  parseProfileStandingArgs,
} from "../../../../cli/commands/profile/standingArgs.js";
import { PROFILE_STEERS_FLAG_NAMES, parseProfileSteersArgs } from "../../../../cli/commands/profile/steersArgs.js";
import { PROFILE_VOICE_FLAG_NAMES, parseProfileVoiceArgs } from "../../../../cli/commands/profile/voiceArgs.js";
import { PROFILE_WORDS_FLAG_NAMES, parseProfileWordsArgs } from "../../../../cli/commands/profile/wordsArgs.js";
import {
  parseRouteCapabilitiesMergeArgs,
  ROUTE_CAPABILITIES_MERGE_FLAG_NAMES,
} from "../../../../cli/commands/route/capabilitiesMerge.js";
import { parseRouteEvaluateArgs, ROUTE_EVALUATE_FLAG_NAMES } from "../../../../cli/commands/route/evaluate.js";
import {
  parseRouteProfileAnswerArgs,
  ROUTE_PROFILE_ANSWER_FLAG_NAMES,
} from "../../../../cli/commands/route/profileAnswer.js";
import {
  parseRouteProfileBriefArgs,
  ROUTE_PROFILE_BRIEF_FLAG_NAMES,
} from "../../../../cli/commands/route/profileBrief.js";
import { parseRoutePlanArgs, ROUTE_PLAN_FLAG_NAMES } from "../../../../cli/commands/route/run.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags, PROBE_HOME } from "./sharedProbes.js";

/** A complete `org set` with every provider present, so a probe tests only its own flag. */
const ORG_SET_BASE: readonly string[] = [
  "--display-name",
  "Acme",
  "--github-owner",
  "acme",
  "--google-domain",
  "acme.com",
  "--slack-host",
  "acme.slack.com",
  "--linear-workspace",
  "acme",
  "--vanta-workspace",
  "acme",
  "--repository",
  "acme/app",
];

/** `ORG_SET_BASE` with one provider stated absent: its value flag dropped, its `--without-…` switch added. */
function orgSetWithout({ flag, without }: { flag: string; without: string }): readonly string[] {
  const at = ORG_SET_BASE.indexOf(flag);
  return [...ORG_SET_BASE.slice(0, at), ...ORG_SET_BASE.slice(at + 2), without];
}

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "org-health ack": ORG_HEALTH_ACK_FLAG_NAMES,
  "org-health read": ORG_HEALTH_READ_FLAG_NAMES,
  "org-health status": ORG_HEALTH_READ_FLAG_NAMES,
  "route capabilities-merge": ROUTE_CAPABILITIES_MERGE_FLAG_NAMES,
  "route evaluate": ROUTE_EVALUATE_FLAG_NAMES,
  "route plan": ROUTE_PLAN_FLAG_NAMES,
  "route profile-answer": ROUTE_PROFILE_ANSWER_FLAG_NAMES,
  "route profile-brief": ROUTE_PROFILE_BRIEF_FLAG_NAMES,
  profile: PROFILE_SHOW_FLAG_NAMES,
  "profile context": PROFILE_SHOW_FLAG_NAMES,
  "profile harvest": PROFILE_HARVEST_FLAG_NAMES,
  "profile person": PROFILE_PERSON_FLAG_NAMES,
  "profile set": PROFILE_WRITE_FLAG_NAMES,
  "profile show": PROFILE_SHOW_FLAG_NAMES,
  "org set": [
    "--display-name",
    "--github-owner",
    "--google-domain",
    "--without-google",
    "--slack-host",
    "--without-slack",
    "--linear-workspace",
    "--without-linear",
    "--vanta-workspace",
    "--without-vanta",
    "--repository",
    "--dependency-bot",
    "--json",
    "--home",
  ],
  "org show": ["--json", "--home"],
  "profile voice": PROFILE_VOICE_FLAG_NAMES,
  "profile guidance": PROFILE_GUIDANCE_FLAG_NAMES,
  "profile standing": PROFILE_STANDING_FLAG_NAMES,
  "profile steers": PROFILE_STEERS_FLAG_NAMES,
  "profile words": PROFILE_WORDS_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "org-health ack": {
    "--by-session": ["--by-session", "work-console"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-10-04T09:00:00Z"],
    "--ref": ["--ref", "INC-33"],
  },
  "org-health read": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-10-04T09:00:00Z"],
  },
  "org-health status": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-10-04T09:00:00Z"],
  },
  "route capabilities-merge": {
    "--dry-run": ["--from", "/tmp/capabilities.json", "--dry-run"],
    "--from": ["--from", "/tmp/capabilities.json"],
    "--home": ["--from", "/tmp/capabilities.json", "--home", "/tmp/home"],
    "--json": ["--from", "/tmp/capabilities.json", "--json"],
  },
  "route evaluate": {
    "--cases": ["--cases", "/tmp/cases.json"],
    "--decisions": ["--decisions", "/tmp/decisions.json"],
    "--json": ["--json"],
    "--judged-by": ["--judged-by", "owner (manual trial)"],
    "--out": ["--out", "/tmp/baseline.json"],
  },
  "route plan": {
    "--json": ["--json"],
    "--profile": ["--profile", "/tmp/capabilities.json"],
    "--question": ["--question", "what is current?"],
  },
  "route profile-answer": {
    "--answer": ["--answer", "/tmp/answer.json"],
    "--home": ["--home", "/tmp/home"],
    "--json": ["--json"],
  },
  "route profile-brief": {
    "--held-out": ["--held-out", "/tmp/cases.json"],
    "--home": ["--home", "/tmp/home"],
    "--json": ["--json"],
    "--sources": ["--sources", "/tmp/sources.json"],
  },
  profile: { "--json": ["--json"] },
  "profile context": { "--json": ["--json"] },
  "profile harvest": {
    "--apply": ["--manifest", "/tmp/harvest.json", "--apply"],
    "--json": ["--manifest", "/tmp/harvest.json", "--json"],
    "--manifest": ["--manifest", "/tmp/harvest.json"],
  },
  "profile person": {
    "--file": ["--name", "Someone", "--file", "/tmp/judgement.json"],
    "--id": ["--id", "00000000-0000-0000-0000-000000000000"],
    "--json": ["--name", "Someone", "--json"],
    "--name": ["--name", "Someone"],
  },
  "profile set": {
    "--file": ["--file", "/tmp/owner.json"],
    "--json": ["--file", "/tmp/owner.json", "--json"],
  },
  "profile show": { "--json": ["--json"] },
  "org set": {
    "--dependency-bot": [...ORG_SET_BASE, "--dependency-bot", "acme-deps"],
    "--display-name": ORG_SET_BASE,
    "--github-owner": ORG_SET_BASE,
    "--google-domain": ORG_SET_BASE,
    "--home": [...ORG_SET_BASE, "--home", PROBE_HOME],
    "--json": [...ORG_SET_BASE, "--json"],
    "--linear-workspace": ORG_SET_BASE,
    "--repository": [...ORG_SET_BASE, "--repository", "acme/api"],
    "--slack-host": [...ORG_SET_BASE, "--slack-host", "acme-sandbox.slack.com"],
    "--vanta-workspace": ORG_SET_BASE,
    "--without-google": orgSetWithout({ flag: "--google-domain", without: "--without-google" }),
    "--without-slack": orgSetWithout({ flag: "--slack-host", without: "--without-slack" }),
    "--without-linear": orgSetWithout({ flag: "--linear-workspace", without: "--without-linear" }),
    "--without-vanta": orgSetWithout({ flag: "--vanta-workspace", without: "--without-vanta" }),
  },
  "org show": { "--home": ["--home", PROBE_HOME], "--json": ["--json"] },
  "profile voice": {
    "--dry-run": ["measure", "--dry-run"],
    "--file": ["--file", "/tmp/cohorts.json"],
    "--home": ["measure", "--home", PROBE_HOME],
    "--json": ["--json"],
  },
  "profile guidance": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "profile standing": {
    "--anchor": ["add", "a", "--anchor", "talk:x", "--covers", "findings"],
    "--covers": ["add", "a", "--anchor", "talk:x", "--covers", "findings,act:github.merge"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-10-09T12:00:00Z"],
    "--reason": ["withdraw", "a", "--reason", "superseded"],
  },
  "profile steers": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--kind": ["judge", "a", "--kind", "proof", "--withdraw"],
    "--limit": ["unread", "--limit", "5"],
    "--nothing": ["judge", "a", "--nothing"],
    "--now": ["--now", "2026-10-05T12:00:00Z"],
    "--quote": ["judge", "a", "--kind", "proof", "--says", "corrects", "--quote", "attach it"],
    "--says": ["judge", "a", "--kind", "proof", "--says", "stopped", "--quote", "it stopped"],
    "--since": ["--since", "7d"],
    "--until": ["--until", "2026-10-05T12:00:00Z"],
    "--withdraw": ["judge", "a", "--kind", "proof", "--withdraw"],
  },
  "profile words": {
    "--full": ["--full"],
    "--home": ["--home", "/tmp"],
    "--how": ["--how", "spoken"],
    "--json": ["--json"],
    "--limit": ["--limit", "5"],
    "--now": ["--now", "2026-10-04T12:00:00Z"],
    "--phrase": ["--phrase", "jumpcloud atlas"],
    "--since": ["--since", "1d"],
    "--until": ["--until", "2026-10-04T12:00:00Z"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "org-health ack": ({ fragment }) =>
    orgHealthAckOptions({ rest: dedupeFlags({ base: ["--ref", "INC-98"], fragment }) }),
  "org-health read": ({ fragment }) => orgHealthReadOptions({ rest: fragment }),
  "org-health status": ({ fragment }) => orgHealthReadOptions({ rest: fragment }),
  "route capabilities-merge": ({ fragment }) => parseRouteCapabilitiesMergeArgs({ rest: [...fragment] }),
  "route evaluate": ({ fragment }) => parseRouteEvaluateArgs({ rest: [...fragment] }),
  "route plan": ({ fragment }) => parseRoutePlanArgs({ rest: [...fragment] }),
  "route profile-answer": ({ fragment }) => parseRouteProfileAnswerArgs({ rest: [...fragment] }),
  "route profile-brief": ({ fragment }) => parseRouteProfileBriefArgs({ rest: [...fragment] }),
  profile: ({ fragment }) => parseProfileShowArgs({ rest: [...fragment] }),
  "profile context": ({ fragment }) => parseProfileShowArgs({ rest: [...fragment] }),
  "profile harvest": ({ fragment }) => parseProfileHarvestArgs({ rest: [...fragment] }),
  "profile person": ({ fragment }) => parseProfilePersonArgs({ rest: [...fragment] }),
  "profile set": ({ fragment }) => parseProfileWriteArgs({ rest: [...fragment] }),
  "profile show": ({ fragment }) => parseProfileShowArgs({ rest: [...fragment] }),
  "org set": ({ fragment }) => orgSetArgs({ rest: [...fragment] }),
  "org show": ({ fragment }) => orgShowArgs({ rest: [...fragment] }),
  "profile voice": ({ fragment }) => parseProfileVoiceArgs({ rest: [...fragment] }),
  "profile guidance": ({ fragment }) => parseProfileGuidanceArgs({ rest: [...fragment] }),
  "profile standing": ({ fragment }) =>
    parseProfileStandingArgs({ rest: [...fragment] }).mapErr((error) => [error.message]),
  "profile steers": ({ fragment }) =>
    parseProfileSteersArgs({ rest: [...fragment] }).mapErr((error) => [error.message]),
  "profile words": ({ fragment }) => parseProfileWordsArgs({ rest: [...fragment] }),
};

/** The rows for `profile`, `org`, `org-health` and `route`. */
export const orgAndProfileSlice: HelpTruthSlice = { guarded, probes, parsers };
