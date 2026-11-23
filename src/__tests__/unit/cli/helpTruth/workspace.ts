/**
 * The help-truth tables' rows for `worktree`, `checkout`, `home`, `pane`, `wait`, `events`, `compact` and `desktop` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { CHECKOUT_FLAG_NAMES, parseCheckoutArgs } from "../../../../cli/commands/checkout/core.js";
import { COMPACT_HEAL_REFS_FLAG_NAMES, parseCompactHealRefsArgs } from "../../../../cli/commands/compact/healRefs.js";
import { DESKTOP_E2E_FLAG_NAMES, parseDesktopE2eArgs } from "../../../../cli/commands/desktop/e2eRun.js";
import { DESKTOP_PREBUILD_FLAG_NAMES, parseDesktopPrebuildArgs } from "../../../../cli/commands/desktop/prebuildRun.js";
import { EVENTS_TAIL_FLAG_NAMES, parseEventsTailArgs } from "../../../../cli/commands/events/tail.js";
import {
  HOME_RECLAIM_FLAG_NAMES,
  HOME_RECLAIMED_FLAG_NAMES,
  parseHomeReclaimArgs,
  parseHomeReclaimedArgs,
} from "../../../../cli/commands/home/core.js";
import { PANE_PR_STATUS_FLAG_NAMES, parsePanePrStatusArgs } from "../../../../cli/commands/pane/prStatus.js";
import { parseWaitArgs, WAIT_FLAG_NAMES } from "../../../../cli/commands/wait/run.js";
import { parseWorktreeArgs, WORKTREE_FLAG_NAMES } from "../../../../cli/commands/worktree/core.js";
import { DESKTOP_UPDATE_FLAGS, desktopUpdateArgs } from "../../../../desktop/updateOutcome.js";
import { err, ok } from "../../../../lib/result.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { PROBE_HOME } from "./sharedProbes.js";

/**
 * `events tail`'s probes. Named rather than inlined twice: the bare noun and the explicit verb resolve to the
 * ONE handler, so one table is the only way they cannot drift apart.
 */
const EVENTS_TAIL_PROBES: Readonly<Record<string, readonly string[]>> = {
  "--cursor": ["--cursor", "supervisor"],
  "--deadline-ms": ["--deadline-ms", "5000"],
  "--follow": ["--follow"],
  "--home": ["--home", "/tmp"],
  "--json": ["--json"],
  "--kind": ["--kind", "died,escalated"],
  "--limit": ["--limit", "5"],
  "--min-severity": ["--min-severity", "alert"],
  "--since": ["--since", "0"],
  "--source": ["--source", "listener"],
};

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "checkout console": CHECKOUT_FLAG_NAMES["console"]!,
  "checkout status": CHECKOUT_FLAG_NAMES["status"]!,
  "worktree prune": WORKTREE_FLAG_NAMES["prune"]!,
  "worktree mirror-prune": WORKTREE_FLAG_NAMES["mirror-prune"]!,
  "checkout sync": CHECKOUT_FLAG_NAMES["sync"]!,
  "desktop e2e": DESKTOP_E2E_FLAG_NAMES,
  "desktop prebuild": DESKTOP_PREBUILD_FLAG_NAMES,
  "desktop update": DESKTOP_UPDATE_FLAGS,
  "compact heal-refs": COMPACT_HEAL_REFS_FLAG_NAMES,
  events: EVENTS_TAIL_FLAG_NAMES,
  "events tail": EVENTS_TAIL_FLAG_NAMES,
  wait: WAIT_FLAG_NAMES,
  "home reclaim": HOME_RECLAIM_FLAG_NAMES,
  "home reclaimed": HOME_RECLAIMED_FLAG_NAMES,
  "pane pr-status": PANE_PR_STATUS_FLAG_NAMES,
  "worktree create": WORKTREE_FLAG_NAMES["create"]!,
  "worktree here": WORKTREE_FLAG_NAMES["here"]!,
  "worktree list": WORKTREE_FLAG_NAMES["list"]!,
  "worktree noindex": WORKTREE_FLAG_NAMES["noindex"]!,
  "worktree remove": WORKTREE_FLAG_NAMES["remove"]!,
  "worktree status": WORKTREE_FLAG_NAMES["status"]!,
  "worktree unshare": WORKTREE_FLAG_NAMES["unshare"]!,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "checkout console": {
    "--json": ["--json"],
  },
  "checkout status": {
    "--fetch": ["--fetch"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--path": ["--path", "/tmp"],
  },
  "checkout sync": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--path": ["--path", "/tmp"],
  },
  "desktop e2e": {
    "--app": ["--app", "/tmp/Slopweaver.app"],
    "--call": ["--call"],
    "--call-card": ["--call", "--call-card", "ask:fixture-card"],
    "--call-hold-minutes": ["--call", "--call-hold-minutes", "5"],
    "--call-mic-candidate": ["--call", "--only", "transcription-fidelity", "--call-mic-candidate", "auto-gain-off"],
    "--checkout": ["--checkout", "/tmp"],
    "--context": ["--context", "work"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--menu-bar": ["--menu-bar"],
    "--only": ["--only", "queue"],
    "--out": ["--out", "/tmp"],
    "--settle-cap": ["--settle-cap", "60"],
  },
  "desktop prebuild": {
    "--decide": ["--decide"],
    "--home": ["--home", "/tmp"],
    "--log": ["--log"],
  },
  "desktop update": {
    "--home": ["--home", "/tmp"],
    "--log": ["--log", "/tmp/update.log"],
    "--outcome": ["--outcome", "/tmp/outcome.json"],
  },
  "worktree prune": {
    "--apply": ["--apply"],
    "--budget": ["--budget", "15m"],
    "--if-idle": ["--apply", "--if-idle"],
    "--json": ["--json"],
    "--merged-only": ["--merged-only"],
    "--no-salvage": ["--no-salvage"],
    "--nuke-after": ["--nuke-after", "7d"],
    "--older-than": ["--older-than", "24h"],
    "--repo": ["--repo", "/tmp"],
    "--scan-budget": ["--scan-budget", "15m"],
  },
  "worktree mirror-prune": {
    "--apply": ["--apply"],
    "--budget": ["--budget", "15m"],
    "--json": ["--json"],
  },
  events: EVENTS_TAIL_PROBES,
  "events tail": EVENTS_TAIL_PROBES,
  "home reclaim": {
    "--apply": ["--apply"],
    "--home": ["--home", PROBE_HOME],
    "--json": ["--json"],
    "--root": ["--root", "codex-scratch"],
  },
  "home reclaimed": {
    "--home": ["--home", PROBE_HOME],
    "--json": ["--json"],
  },
  "pane pr-status": {
    "--json": ["--json"],
    "--pr-repos": ["--pr-repos", "owner/name"],
    "--repo": ["--repo", "/tmp"],
  },
  wait: {
    "--contains": ["--file", "/tmp/x.log", "--contains", "done"],
    "--file": ["--file", "/tmp/x.log"],
    "--pid": ["--pid", "4242"],
    "--timeout-seconds": ["--pid", "4242", "--timeout-seconds", "60"],
  },
  "worktree create": {
    "--base": ["--base", "main"],
    "--branch": ["--branch", "a-branch"],
    "--build": ["--build"],
    "--deps": ["--deps", "own"],
    "--dev-build": ["--dev-build"],
    "--install": ["--install"],
    "--json": ["--json"],
    "--no-build": ["--no-build"],
    "--no-dev-build": ["--no-dev-build"],
    "--no-install": ["--no-install"],
    "--repo": ["--repo", "/repo"],
  },
  "worktree here": {
    "--json": ["--json"],
  },
  "worktree list": {
    "--json": ["--json"],
    "--repo": ["--repo", "/repo"],
  },
  "worktree noindex": {
    "--json": ["--json"],
    "--repo": ["--repo", "/repo"],
  },
  "worktree remove": {
    "--force": ["--force"],
    "--json": ["--json"],
    "--repo": ["--repo", "/repo"],
  },
  "worktree status": {
    "--base": ["--base", "origin/main"],
    "--json": ["--json"],
    "--repo": ["--repo", "/repo"],
  },
  "worktree unshare": {
    "--all": ["--all"],
    "--json": ["--json"],
    "--repo": ["--repo", "/repo"],
    "--report": ["--report"],
  },
  "compact heal-refs": {
    "--apply": ["--apply"],
    "--home": ["--home", "/tmp"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "checkout console": ({ fragment }) => parseCheckoutArgs({ rest: [...fragment], verb: "console" }),
  "checkout status": ({ fragment }) => parseCheckoutArgs({ rest: [...fragment], verb: "status" }),
  "worktree prune": ({ fragment }) => parseWorktreeArgs({ rest: [...fragment], verb: "prune" }),
  "worktree mirror-prune": ({ fragment }) => parseWorktreeArgs({ rest: [...fragment], verb: "mirror-prune" }),
  "checkout sync": ({ fragment }) => parseCheckoutArgs({ rest: [...fragment], verb: "sync" }),
  "desktop e2e": ({ fragment }) => parseDesktopE2eArgs({ rest: [...fragment] }),
  "desktop prebuild": ({ fragment }) => parseDesktopPrebuildArgs({ rest: [...fragment] }),
  "desktop update": ({ fragment }) => {
    const parsed = desktopUpdateArgs({ args: fragment });
    if (parsed === undefined) {
      return err(["desktop update refused the arguments"]);
    }
    return ok(parsed);
  },
  wait: ({ fragment }) => parseWaitArgs({ rest: [...fragment] }),
  events: ({ fragment }) => parseEventsTailArgs({ rest: [...fragment] }),
  "events tail": ({ fragment }) => parseEventsTailArgs({ rest: [...fragment] }),
  "home reclaim": ({ fragment }) => parseHomeReclaimArgs({ rest: [...fragment] }),
  "home reclaimed": ({ fragment }) => parseHomeReclaimedArgs({ rest: [...fragment] }),
  "pane pr-status": ({ fragment }) => parsePanePrStatusArgs({ rest: [...fragment] }),
  "worktree create": ({ fragment }) => parseWorktreeArgs({ rest: ["a-slug", ...fragment], verb: "create" }),
  "worktree here": ({ fragment }) => parseWorktreeArgs({ rest: [...fragment], verb: "here" }),
  "worktree list": ({ fragment }) => parseWorktreeArgs({ rest: [...fragment], verb: "list" }),
  "worktree noindex": ({ fragment }) => parseWorktreeArgs({ rest: [...fragment], verb: "noindex" }),
  "worktree remove": ({ fragment }) => parseWorktreeArgs({ rest: ["a-slug", ...fragment], verb: "remove" }),
  "worktree status": ({ fragment }) => parseWorktreeArgs({ rest: ["a-slug", ...fragment], verb: "status" }),
  "worktree unshare": ({ fragment }) => parseWorktreeArgs({ rest: [...fragment], verb: "unshare" }),
  "compact heal-refs": ({ fragment }) => parseCompactHealRefsArgs({ rest: [...fragment] }),
};

/** The rows for `worktree`, `checkout`, `home`, `pane`, `wait`, `events`, `compact` and `desktop`. */
export const workspaceSlice: HelpTruthSlice = { guarded, probes, parsers };
