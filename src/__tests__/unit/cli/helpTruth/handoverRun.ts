/**
 * The help-truth tables' rows for `handover`'s run-lifecycle verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { HANDOVER_SETTLE_FLAG_NAMES, parseHandoverSettleArgs } from "../../../../cli/commands/handover/askRowArgs.js";
import { HANDOVER_CHECK_FLAG_NAMES, parseHandoverCheckArgs } from "../../../../cli/commands/handover/checkRun.js";
import {
  HANDOVER_ARTIFACT_FLAG_NAMES,
  HANDOVER_CLOSE_FLAG_NAMES,
  parseHandoverArtifactArgs,
  parseHandoverCloseArgs,
} from "../../../../cli/commands/handover/closeRun.js";
import { HANDOVER_EXAMPLE_FLAG_NAMES, parseHandoverExampleArgs } from "../../../../cli/commands/handover/exampleRun.js";
import { HANDOVER_GATE_FLAG_NAMES, parseHandoverGateArgs } from "../../../../cli/commands/handover/gateRun.js";
import { HANDOVER_HOOK_FLAG_NAMES, parseHandoverHookArgs } from "../../../../cli/commands/handover/hookRun.js";
import { HANDOVER_LIFECYCLE_FLAG_NAMES, parseLifecycleArgs } from "../../../../cli/commands/handover/lifecycleRun.js";
import { HANDOVER_LINT_FLAG_NAMES, parseHandoverLintArgs } from "../../../../cli/commands/handover/lintRun.js";
import {
  HANDOVER_PAUSE_FLAG_NAMES,
  HANDOVER_UNPAUSE_FLAG_NAMES,
  parseHandoverPauseArgs,
  parseHandoverUnpauseArgs,
} from "../../../../cli/commands/handover/pauseRun.js";
import { HANDOVER_QUOTE_FLAG_NAMES, parseHandoverQuoteArgs } from "../../../../cli/commands/handover/quoteRun.js";
import { HANDOVER_RECHECK_FLAG_NAMES, parseHandoverRecheckArgs } from "../../../../cli/commands/handover/recheckRun.js";
import { HANDOVER_SHOT_FLAG_NAMES, parseHandoverShotArgs } from "../../../../cli/commands/handover/shotRun.js";
import { HANDOVER_WAKE_FLAG_NAMES, parseHandoverWakeArgs } from "../../../../cli/commands/handover/wakeRun.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "handover abandon": HANDOVER_LIFECYCLE_FLAG_NAMES["abandon"]!,
  "handover artifact": HANDOVER_ARTIFACT_FLAG_NAMES,
  "handover check": HANDOVER_CHECK_FLAG_NAMES,
  "handover claim": HANDOVER_LIFECYCLE_FLAG_NAMES["claim"]!,
  "handover close": HANDOVER_CLOSE_FLAG_NAMES,
  "handover finish": HANDOVER_LIFECYCLE_FLAG_NAMES["finish"]!,
  "handover hook": HANDOVER_HOOK_FLAG_NAMES,
  "handover lint": HANDOVER_LINT_FLAG_NAMES,
  "handover gate": HANDOVER_GATE_FLAG_NAMES,
  "handover pause": HANDOVER_PAUSE_FLAG_NAMES,
  "handover recheck": HANDOVER_RECHECK_FLAG_NAMES,
  "handover quote": HANDOVER_QUOTE_FLAG_NAMES,
  "handover example": HANDOVER_EXAMPLE_FLAG_NAMES,
  "handover shot": HANDOVER_SHOT_FLAG_NAMES,
  "handover settle": HANDOVER_SETTLE_FLAG_NAMES,
  "handover unpause": HANDOVER_UNPAUSE_FLAG_NAMES,
  "handover park": HANDOVER_LIFECYCLE_FLAG_NAMES["park"]!,
  "handover wake": HANDOVER_WAKE_FLAG_NAMES,
  "handover release": HANDOVER_LIFECYCLE_FLAG_NAMES["release"]!,
  "handover resume": HANDOVER_LIFECYCLE_FLAG_NAMES["resume"]!,
  "handover sign-off": HANDOVER_LIFECYCLE_FLAG_NAMES["sign-off"]!,
  "handover start": HANDOVER_LIFECYCLE_FLAG_NAMES["start"]!,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "handover abandon": {
    "--base": ["--base", "main"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--why": ["--why", "superseded"],
  },
  "handover artifact": {
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--url": ["--url", "https://example.invalid/page"],
  },
  "handover close": {
    "--artifact": ["--artifact", "https://example.invalid/page"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--summary": ["--summary", "landed in #445"],
  },
  "handover sign-off": {
    "--base": ["--base", "main"],
    "--by": ["--by", "a-session"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--note": ["--note", "probes re-run"],
  },
  "handover check": {
    "--dir": ["--dir", "/tmp"],
    "--doc": ["--doc", "/tmp/x.md"],
    "--home": ["--home", "/tmp"],
    "--repo": ["--repo", "/tmp"],
    "--require-status-summary": ["--require-status-summary"],
  },
  "handover claim": {
    "--base": ["--base", "main"],
    "--dir": ["--dir", "/tmp"],
    "--force": ["--force"],
    "--home": ["--home", "/tmp"],
    "--why": ["--why", "moving hosts"],
  },
  "handover finish": {
    "--base": ["--base", "main"],
    "--dir": ["--dir", "/tmp"],
    "--beside-question": ["--dry-run", "--beside-question"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--lessons": ["--lessons", "none"],
    "--park-index": ["--park-index", "4", "--parked-at", "2026-11-05T00:00:00.000Z"],
    "--parked-at": ["--park-index", "4", "--parked-at", "2026-11-05T00:00:00.000Z"],
    "--probe": ["--probe"],
    "--probed-repo": ["--probed-repo", "/tmp"],
    "--probed-tree": ["--probed-tree", "doc-repo"],
  },
  "handover hook": {
    "--dir": ["--dir", "/tmp"],
  },
  "handover gate": {
    "--anchor": ["--anchor", "https://example.invalid/p1"],
    "--home": ["--home", "/tmp"],
    "--now": ["--now", "2026-09-21T05:35:28.000Z"],
    "--words": ["--words", "ok, go ahead"],
  },
  "handover pause": {
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--on": ["--on", "a reviewer"],
    "--since": ["--since", "2026-09-06T06:05:00Z"],
    "--why": ["--why", "sample sent, no reply yet"],
  },
  "handover recheck": {
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--still-real": ["--still-real", "settleCardRun.ts still refuses"],
  },
  "handover example": {
    "--dir": ["--dir", "/tmp"],
    "--example": ["--example", "You open the card and see the fleet merged its own fix. Was that right?"],
    "--example-gap": ["--example-gap", "the row records no scene"],
    "--home": ["--home", "/tmp"],
  },
  "handover shot": {
    "--box": ["--box", "40,212,380,36=stale"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--shot": ["--shot", "/tmp/net-93.png"],
  },
  "handover quote": {
    "--add-steer": ["the-ask", "--add-steer", "talk:a0000015-0000-4000-8000-000000000016"],
    "--anchor": ["a-slug", "--anchor", "talk:a0000017-0000-4000-8000-000000000019"],
    "--apply": ["--apply"],
    "--check": ["--check"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "handover unpause": {
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--status": ["--status", "ready"],
    "--why": ["--why", "they replied"],
  },
  "handover settle": {
    "--as": ["--as", "filed"],
    "--card": ["--card", "done"],
    "--card-new": ["--card", "recut", "--card-new", "iso-reply"],
    "--card-why": ["--card", "kept", "--card-why", "the owner asked why"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--lessons": ["--lessons", "none"],
    "--reason": ["--reason", "not doing this"],
    "--witness": ["--witness", "a-doc"],
  },
  "handover lint": {
    "--dir": ["--dir", "/tmp"],
    "--doc": ["--doc", "/tmp/x.md"],
    "--fix": ["--fix"],
    "--home": ["--home", "/tmp"],
  },
  "handover park": {
    "--base": ["--base", "main"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--read-owner-words": ["--read-owner-words", "call:9b2f1c3e-0000-4b6c-8d7e-0f1a2b3c4d5e#s-1"],
    "--wake-at": ["--wake-at", "2026-10-15T03:13:00Z"],
    "--wake-on-checks": ["--wake-on-checks", "acme/acme-admin#9877"],
    "--workspace": ["--workspace", "workspace:7"],
  },
  "handover wake": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--retry": ["--retry", "n-1"],
    "--settle-only": ["--settle-only"],
  },
  "handover release": {
    "--base": ["--base", "main"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--why": ["--why", "moving hosts"],
  },
  "handover resume": {
    "--base": ["--base", "main"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--probe": ["--probe"],
  },
  "handover start": {
    "--base": ["--base", "main"],
    "--branch": ["--branch", "feat/x"],
    "--dir": ["--dir", "/tmp"],
    "--home": ["--home", "/tmp"],
    "--probe": ["--probe"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "handover abandon": ({ fragment }) => parseLifecycleArgs({ rest: ["a-slug", ...fragment], verb: "abandon" }),
  "handover artifact": ({ fragment }) => parseHandoverArtifactArgs({ rest: ["a-slug", ...fragment] }),
  "handover check": ({ fragment }) => parseHandoverCheckArgs({ rest: [...fragment] }),
  "handover close": ({ fragment }) => parseHandoverCloseArgs({ rest: ["a-slug", ...fragment] }),
  "handover claim": ({ fragment }) => parseLifecycleArgs({ rest: ["a-slug", ...fragment], verb: "claim" }),
  "handover finish": ({ fragment }) => parseLifecycleArgs({ rest: ["a-slug", ...fragment], verb: "finish" }),
  "handover hook": ({ fragment }) => parseHandoverHookArgs({ rest: [...fragment] }),
  "handover lint": ({ fragment }) => parseHandoverLintArgs({ rest: [...fragment] }),
  "handover gate": ({ fragment }) => parseHandoverGateArgs({ rest: ["list", ...fragment] }),
  "handover pause": ({ fragment }) => parseHandoverPauseArgs({ rest: ["a-slug", ...fragment] }),
  "handover recheck": ({ fragment }) => parseHandoverRecheckArgs({ rest: ["a-slug", ...fragment] }),
  "handover quote": ({ fragment }) => parseHandoverQuoteArgs({ rest: fragment }),
  "handover example": ({ fragment }) => parseHandoverExampleArgs({ rest: ["a-slug", ...fragment] }),
  "handover shot": ({ fragment }) => parseHandoverShotArgs({ rest: ["a-slug", ...fragment] }),
  "handover settle": ({ fragment }) => parseHandoverSettleArgs({ rest: ["a-slug", ...fragment] }),
  "handover unpause": ({ fragment }) => parseHandoverUnpauseArgs({ rest: ["a-slug", ...fragment] }),
  "handover park": ({ fragment }) => parseLifecycleArgs({ rest: ["a-slug", ...fragment], verb: "park" }),
  "handover wake": ({ fragment }) => parseHandoverWakeArgs({ rest: [...fragment] }),
  "handover release": ({ fragment }) => parseLifecycleArgs({ rest: ["a-slug", ...fragment], verb: "release" }),
  "handover resume": ({ fragment }) => parseLifecycleArgs({ rest: ["a-slug", ...fragment], verb: "resume" }),
  "handover start": ({ fragment }) => parseLifecycleArgs({ rest: ["a-slug", ...fragment], verb: "start" }),
  "handover sign-off": ({ fragment }) => parseLifecycleArgs({ rest: ["a-slug", ...fragment], verb: "sign-off" }),
};

/** The rows for `handover`'s run-lifecycle verbs. */
export const handoverRunSlice: HelpTruthSlice = { guarded, probes, parsers };
