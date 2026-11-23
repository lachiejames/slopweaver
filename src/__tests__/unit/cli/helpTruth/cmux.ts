/**
 * The help-truth tables' rows for `cmux` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { CMUX_FLAG_NAMES, parseCmuxArgs } from "../../../../cli/commands/cmux/core.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "cmux close": CMUX_FLAG_NAMES["close"]!,
  "cmux dialog": CMUX_FLAG_NAMES["dialog"]!,
  "cmux events": CMUX_FLAG_NAMES["events"]!,
  "cmux list": CMUX_FLAG_NAMES["list"]!,
  "cmux pin": CMUX_FLAG_NAMES["pin"]!,
  "cmux processes": CMUX_FLAG_NAMES["processes"]!,
  "cmux read-screen": CMUX_FLAG_NAMES["read-screen"]!,
  "cmux reseat": CMUX_FLAG_NAMES["reseat"]!,
  "cmux revive": CMUX_FLAG_NAMES["revive"]!,
  "cmux send": CMUX_FLAG_NAMES["send"]!,
  "cmux spawn": CMUX_FLAG_NAMES["spawn"]!,
  "cmux stop": CMUX_FLAG_NAMES["stop"]!,
  "cmux strands": CMUX_FLAG_NAMES["strands"]!,
  "cmux submit": CMUX_FLAG_NAMES["submit"]!,
  "cmux takeover": CMUX_FLAG_NAMES["takeover"]!,
  "cmux templates": CMUX_FLAG_NAMES["templates"]!,
  "cmux title": CMUX_FLAG_NAMES["title"]!,
  "cmux unpin": CMUX_FLAG_NAMES["unpin"]!,
  "cmux usage": CMUX_FLAG_NAMES["usage"]!,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "cmux close": {
    "--harness": ["--harness", "app"],
    "--home": ["--home", "/tmp"],
    "--via-card": ["--via-card"],
    "--workspace": ["--workspace", "workspace:1"],
  },
  "cmux dialog": {
    "--dismiss": ["--dismiss"],
    "--home": ["--home", "/tmp/slopweaver-probe-home"],
    "--json": ["--json"],
  },
  "cmux events": {
    "--category": ["--category", "agent"],
    "--follow": ["--follow"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--name": ["--name", "agent.hook.Stop"],
    "--since": ["--since", "1"],
    "--workspace": ["--workspace", "workspace:1"],
  },
  "cmux list": {
    "--full": ["--full"],
    "--harness": ["--harness", "app"],
    "--json": ["--json"],
  },
  "cmux pin": {
    "--workspace": ["--workspace", "workspace:1"],
  },
  "cmux processes": {
    "--json": ["--json"],
    "--workspace": ["--workspace", "workspace:1"],
  },
  "cmux read-screen": {
    "--json": ["--workspace", "workspace:1", "--json"],
    "--scrollback": ["--workspace", "workspace:1", "--scrollback", "200"],
    "--surface": ["--workspace", "workspace:1", "--surface", "surface:1"],
    "--workspace": ["--workspace", "workspace:1"],
  },
  "cmux reseat": {
    "--all": ["--all"],
    "--dry-run": ["--dry-run"],
    "--force": ["--force"],
    "--home": ["--home", "/tmp/slopweaver-probe-home"],
    "--json": ["--json"],
    "--model": ["--model", "opus"],
    "--plan": ["--plan", "plan-one"],
    "--timeout-seconds": ["--timeout-seconds", "60"],
  },
  "cmux revive": {
    "--bound-seconds": ["--bound-seconds", "600"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp/slopweaver-probe-home"],
    "--json": ["--json"],
  },
  "cmux send": {
    "--delivery": ["--workspace", "workspace:1", "--delivery", "later"],
    "--harness": ["--workspace", "workspace:1", "--harness", "app"],
    "--home": ["--workspace", "workspace:1", "--home", "/tmp/home"],
    "--interrupt": ["--workspace", "workspace:1", "--interrupt"],
    "--surface": ["--workspace", "workspace:1", "--surface", "surface:1"],
    "--workspace": ["--workspace", "workspace:1"],
  },
  "cmux stop": {
    "--harness": ["--workspace", "workspace:1", "--harness", "app"],
    "--surface": ["--workspace", "workspace:1", "--surface", "surface:1"],
    "--why": ["--workspace", "workspace:1", "--why", "it is costing the fleet"],
    "--workspace": ["--workspace", "workspace:1"],
  },
  "cmux strands": {
    "--json": ["--json"],
    "--submit": ["--submit"],
  },
  "cmux submit": {
    "--force": ["--workspace", "workspace:1", "--force"],
    "--surface": ["--workspace", "workspace:1", "--surface", "surface:1"],
    "--workspace": ["--workspace", "workspace:1"],
  },
  "cmux takeover": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
  },
  "cmux templates": {
    "--json": ["--json"],
  },
  "cmux title": {
    "--workspace": ["--workspace", "workspace:1"],
  },
  "cmux unpin": {
    "--workspace": ["--workspace", "workspace:1"],
  },
  "cmux usage": {
    "--harness": ["--harness", "app"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "cmux spawn": {
    "--build": ["--build"],
    "--deps": ["--deps", "own"],
    "--dev-build": ["--dev-build"],
    "--dir": ["--dir", "/tmp"],
    "--driver": ["--driver", "codex"],
    "--effort": ["--effort", "high"],
    "--force": ["--force"],
    "--full": ["--full"],
    "--harness": ["--harness", "app"],
    "--home": ["--home", "/tmp"],
    "--model": ["--model", "sonnet"],
    "--no-dev-build": ["--no-dev-build"],
    "--no-install": ["--no-install"],
    "--plan": ["--plan", "plan-one"],
    "--require-current-base": ["--require-current-base"],
    "--template": ["--template", "research"],
    "--timeout-seconds": ["--timeout-seconds", "60"],
    "--wait": ["--wait"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "cmux close": ({ fragment }) => parseCmuxArgs({ rest: ["workspace:1", ...fragment], verb: "close" }),
  "cmux dialog": ({ fragment }) => parseCmuxArgs({ rest: [...fragment], verb: "dialog" }),
  "cmux events": ({ fragment }) => parseCmuxArgs({ rest: [...fragment], verb: "events" }),
  "cmux list": ({ fragment }) => parseCmuxArgs({ rest: [...fragment], verb: "list" }),
  "cmux pin": ({ fragment }) => parseCmuxArgs({ rest: [...fragment], verb: "pin" }),
  "cmux processes": ({ fragment }) => parseCmuxArgs({ rest: [...fragment], verb: "processes" }),
  "cmux read-screen": ({ fragment }) => parseCmuxArgs({ rest: [...fragment], verb: "read-screen" }),
  "cmux reseat": ({ fragment }) => parseCmuxArgs({ rest: [...fragment], verb: "reseat" }),
  "cmux revive": ({ fragment }) => parseCmuxArgs({ rest: [...fragment], verb: "revive" }),
  "cmux send": ({ fragment }) => parseCmuxArgs({ rest: ["hello", ...fragment], verb: "send" }),
  "cmux spawn": ({ fragment }) => parseCmuxArgs({ rest: ["a-doc", ...fragment], verb: "spawn" }),
  "cmux stop": ({ fragment }) => parseCmuxArgs({ rest: ["workspace:1", ...fragment], verb: "stop" }),
  "cmux strands": ({ fragment }) => parseCmuxArgs({ rest: [...fragment], verb: "strands" }),
  "cmux submit": ({ fragment }) => parseCmuxArgs({ rest: [...fragment], verb: "submit" }),
  "cmux takeover": ({ fragment }) => parseCmuxArgs({ rest: [...fragment], verb: "takeover" }),
  "cmux templates": ({ fragment }) => parseCmuxArgs({ rest: [...fragment], verb: "templates" }),
  "cmux title": ({ fragment }) => parseCmuxArgs({ rest: ["a title", ...fragment], verb: "title" }),
  "cmux unpin": ({ fragment }) => parseCmuxArgs({ rest: [...fragment], verb: "unpin" }),
  "cmux usage": ({ fragment }) => parseCmuxArgs({ rest: [...fragment], verb: "usage" }),
};

/** The rows for `cmux`. */
export const cmuxSlice: HelpTruthSlice = { guarded, probes, parsers };
