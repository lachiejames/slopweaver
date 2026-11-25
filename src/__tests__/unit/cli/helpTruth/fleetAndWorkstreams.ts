/**
 * The help-truth tables' rows for `fleet` and `workstreams` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { FLEET_BURN_FLAG_NAMES, parseFleetBurnArgs } from "../../../../cli/commands/fleet/burnRun.js";
import { FLEET_CEILING_FLAG_NAMES, parseFleetCeilingArgs } from "../../../../cli/commands/fleet/ceilingRun.js";
import { FLEET_FLAG_NAMES, parseFleetArgs } from "../../../../cli/commands/fleet/core.js";
import { fleetCommandErrorLines } from "../../../../cli/commands/fleet/errors.js";
import { FLEET_HISTORY_FLAG_NAMES, parseFleetHistoryArgs } from "../../../../cli/commands/fleet/historyRun.js";
import { FLEET_LANDED_FLAG_NAMES, parseFleetLandedArgs } from "../../../../cli/commands/fleet/landedRun.js";
import { FLEET_WHY_FLAG_NAMES, parseFleetWhyArgs } from "../../../../cli/commands/fleet/whyRun.js";
import {
  parseWorkstreamsCandidatesArgs,
  parseWorkstreamsCandidatesPutArgs,
  parseWorkstreamsDefineArgs,
  parseWorkstreamsListArgs,
  parseWorkstreamsLoopInArgs,
  parseWorkstreamsProposeArgs,
  parseWorkstreamsPutArgs,
  parseWorkstreamsReactArgs,
  parseWorkstreamsRetitleArgs,
  parseWorkstreamsWhoFirstArgs,
  WORKSTREAMS_CANDIDATES_FLAG_NAMES,
  WORKSTREAMS_CANDIDATES_PUT_FLAG_NAMES,
  WORKSTREAMS_DEFINE_FLAG_NAMES,
  WORKSTREAMS_LIST_FLAG_NAMES,
  WORKSTREAMS_LOOP_IN_FLAG_NAMES,
  WORKSTREAMS_PROPOSE_FLAG_NAMES,
  WORKSTREAMS_PUT_FLAG_NAMES,
  WORKSTREAMS_REACT_FLAG_NAMES,
  WORKSTREAMS_RETITLE_FLAG_NAMES,
  WORKSTREAMS_WHO_FIRST_FLAG_NAMES,
} from "../../../../cli/commands/workstreams/core.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "fleet burn": FLEET_BURN_FLAG_NAMES,
  "fleet ceiling": FLEET_CEILING_FLAG_NAMES,
  "fleet configure": FLEET_FLAG_NAMES["configure"]!,
  "fleet health": FLEET_FLAG_NAMES["health"]!,
  "fleet history": FLEET_HISTORY_FLAG_NAMES,
  "fleet landed": FLEET_LANDED_FLAG_NAMES,
  "fleet restore-policy": FLEET_FLAG_NAMES["restore-policy"]!,
  "fleet resume": FLEET_FLAG_NAMES["resume"]!,
  "fleet status": FLEET_FLAG_NAMES["status"]!,
  "fleet why": FLEET_WHY_FLAG_NAMES,
  "workstreams list": WORKSTREAMS_LIST_FLAG_NAMES,
  "workstreams put": WORKSTREAMS_PUT_FLAG_NAMES,
  "workstreams candidates": WORKSTREAMS_CANDIDATES_FLAG_NAMES,
  "workstreams candidates-put": WORKSTREAMS_CANDIDATES_PUT_FLAG_NAMES,
  "workstreams react": WORKSTREAMS_REACT_FLAG_NAMES,
  "workstreams define": WORKSTREAMS_DEFINE_FLAG_NAMES,
  "workstreams loop-in": WORKSTREAMS_LOOP_IN_FLAG_NAMES,
  "workstreams retitle": WORKSTREAMS_RETITLE_FLAG_NAMES,
  "workstreams propose": WORKSTREAMS_PROPOSE_FLAG_NAMES,
  "workstreams who-first": WORKSTREAMS_WHO_FIRST_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "fleet burn": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-10-08T01:00:00Z"],
    "--record-reading": ["--json", "--record-reading", "sync-now"],
  },
  "fleet ceiling": {
    "--days": ["--days", "14"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-10-04T13:44:00Z"],
    "--publish": ["--publish"],
  },
  "fleet configure": {
    "--capacity": ["--capacity", "15"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "fleet history": {
    "--home": ["--home", "/tmp"],
    "--hours": ["--hours", "24"],
    "--json": ["--json"],
    "--now": ["--now", "2026-10-10T02:00:00Z"],
  },
  "fleet landed": {
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--ref": ["--ref", "origin/main"],
  },
  "fleet health": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "fleet restore-policy": {
    "--apply": ["--apply"],
    "--config": ["--config", "/tmp/cmux.json"],
    "--json": ["--json"],
  },
  "fleet resume": {
    "--episode": ["--episode", "0b7c2a7e-0d8f-4a4e-9a43-7d6a1c0b2e11"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--reorient-seconds": ["--reorient-seconds", "600"],
    "--timeout-seconds": ["--timeout-seconds", "60"],
  },
  "fleet status": {
    "--base": ["--base", "main"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "fleet why": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--minutes": ["--minutes", "30"],
    "--now": ["--now", "2026-10-09T14:12:00Z"],
  },
  "workstreams list": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "workstreams put": {
    "--file": ["--file", "/tmp/register.json"],
    "--home": ["--home", "/tmp"],
    "--if-current": ["--if-current", "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"],
    "--json": ["--json"],
  },
  "workstreams candidates": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--ruled": ["--ruled"],
    "--unruled": ["--unruled"],
  },
  "workstreams candidates-put": {
    "--file": ["--file", "/tmp/candidates.json"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "workstreams react": {
    "--anchor": ["--anchor", "transcript:abc#def"],
    "--as": ["--as", "yes"],
    "--by-session": ["--by-session", "work-console"],
    "--candidate": ["--candidate", "c-001"],
    "--covered-by": ["--covered-by", "error-tracking"],
    "--heard": ["--heard", "not a workstream"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--milestone-of": ["--milestone-of", "pool-e2e"],
    "--outcome-of": ["--outcome-of", "error-tracking"],
    "--owner": ["--owner", "Sadie's team"],
    "--reason": ["--reason", "the tool was dropped"],
    "--same-as": ["--same-as", "uk-rollout"],
    "--steer": ["--steer", "ratchet everything to three hundred lines"],
    "--superseded-by": ["--superseded-by", "the team SUP"],
    "--via": ["--via", "console"],
  },
  "workstreams define": {
    "--all": ["--all"],
    "--by-session": ["--by-session", "work-console"],
    "--candidate": ["--candidate", "c-001"],
    "--first": ["--first", "owned-and-read"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--option": ["--option", "owned-and-read"],
    "--stretch": ["--stretch", "someone else says in public it saved them time"],
    "--text": ["--text", "every incident has a postmortem"],
    "--via": ["--via", "console"],
  },
  "workstreams loop-in": {
    "--candidate": ["--candidate", "c-001"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--person": ["--person", "U0SYN123ABCD"],
  },
  "workstreams retitle": {
    "--by-session": ["--by-session", "work-console"],
    "--candidate": ["--candidate", "c-001"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--title": ["--title", "Know about a bug the moment it happens"],
    "--via": ["--via", "console"],
  },
  "workstreams propose": {
    "--anchor": ["--anchor", "talk:fcc6cb0d-40a4"],
    "--by-session": ["--by-session", "work-console"],
    "--from": ["--from", "c-001"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--relation": ["--relation", "sibling"],
    "--title": ["--title", "Human PR review friction"],
    "--via": ["--via", "word"],
    "--why": ["--why", "are code owners set up sensibly"],
  },
  "workstreams who-first": {
    "--by-session": ["--by-session", "work-console"],
    "--candidate": ["--candidate", "c-001"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--people": ["--people", "Jasper and Quinn"],
    "--team": ["--team", "platform team"],
    "--via": ["--via", "word"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "fleet burn": ({ fragment }) =>
    parseFleetBurnArgs({ rest: [...fragment] }).mapErr((error) => fleetCommandErrorLines({ error })),
  "fleet ceiling": ({ fragment }) =>
    parseFleetCeilingArgs({ rest: [...fragment] }).mapErr((error) => fleetCommandErrorLines({ error })),
  "fleet configure": ({ fragment }) => parseFleetArgs({ rest: [...fragment], verb: "configure" }),
  "fleet health": ({ fragment }) => parseFleetArgs({ rest: [...fragment], verb: "health" }),
  "fleet history": ({ fragment }) => parseFleetHistoryArgs({ rest: [...fragment] }),
  "fleet landed": ({ fragment }) => parseFleetLandedArgs({ rest: [...fragment] }),
  "fleet restore-policy": ({ fragment }) => parseFleetArgs({ rest: [...fragment], verb: "restore-policy" }),
  "fleet resume": ({ fragment }) => parseFleetArgs({ rest: [...fragment], verb: "resume" }),
  "fleet status": ({ fragment }) => parseFleetArgs({ rest: [...fragment], verb: "status" }),
  "fleet why": ({ fragment }) =>
    parseFleetWhyArgs({ rest: [...fragment] }).mapErr((error) => fleetCommandErrorLines({ error })),
  "workstreams list": ({ fragment }) => parseWorkstreamsListArgs({ rest: [...fragment] }),
  "workstreams put": ({ fragment }) => parseWorkstreamsPutArgs({ rest: [...fragment] }),
  "workstreams candidates": ({ fragment }) => parseWorkstreamsCandidatesArgs({ rest: [...fragment] }),
  "workstreams candidates-put": ({ fragment }) => parseWorkstreamsCandidatesPutArgs({ rest: [...fragment] }),
  "workstreams react": ({ fragment }) => parseWorkstreamsReactArgs({ rest: [...fragment] }),
  "workstreams define": ({ fragment }) => parseWorkstreamsDefineArgs({ rest: [...fragment] }),
  "workstreams loop-in": ({ fragment }) => parseWorkstreamsLoopInArgs({ rest: [...fragment] }),
  "workstreams retitle": ({ fragment }) => parseWorkstreamsRetitleArgs({ rest: [...fragment] }),
  "workstreams propose": ({ fragment }) => parseWorkstreamsProposeArgs({ rest: [...fragment] }),
  "workstreams who-first": ({ fragment }) => parseWorkstreamsWhoFirstArgs({ rest: [...fragment] }),
};

/** The rows for `fleet` and `workstreams`. */
export const fleetAndWorkstreamsSlice: HelpTruthSlice = { guarded, probes, parsers };
