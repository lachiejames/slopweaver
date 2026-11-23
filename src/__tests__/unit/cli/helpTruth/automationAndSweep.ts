/**
 * The help-truth tables' rows for `automation`, `monitor` and `sweep` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { parseRecipeBlockerArgs } from "../../../../cli/commands/automation/blocker.js";
import { parseRecipeClaimArgs } from "../../../../cli/commands/automation/claimArgs.js";
import {
  RECIPE_BLOCKER_FLAG_NAMES,
  RECIPE_CLAIM_FLAG_NAMES,
  RECIPE_DUE_FLAG_NAMES,
  RECIPE_PROPAGATE_FLAG_NAMES,
  RECIPE_REGISTER_RESYNCS_FLAG_NAMES,
  RECIPE_REGISTER_STANDING_FLAG_NAMES,
  RECIPE_REPAIR_FLAG_NAMES,
  RECIPE_RESYNC_FLAG_NAMES,
  RECIPE_RUN_DUE_FLAG_NAMES,
  RECIPE_SEAT_FLAG_NAMES,
} from "../../../../cli/commands/automation/core.js";
import { parseRecipeDueArgs } from "../../../../cli/commands/automation/due.js";
import { recipeCommandErrorLines } from "../../../../cli/commands/automation/errors.js";
import { parseRecipeExplainArgs } from "../../../../cli/commands/automation/explain.js";
import { RECIPE_EXPLAIN_FLAG_NAMES } from "../../../../cli/commands/automation/explainUsage.js";
import { parseRecipeFreshnessArgs } from "../../../../cli/commands/automation/freshness.js";
import { RECIPE_FRESHNESS_FLAG_SPEC } from "../../../../cli/commands/automation/freshnessUsage.js";
import { parseRecipePropagateArgs } from "../../../../cli/commands/automation/propagate.js";
import { parseRegisterResyncsArgs } from "../../../../cli/commands/automation/registerResyncs.js";
import { parseRegisterStandingArgs } from "../../../../cli/commands/automation/registerStanding.js";
import { parseRecipeRepairArgs } from "../../../../cli/commands/automation/repair.js";
import { parseRepointArgs } from "../../../../cli/commands/automation/repointArgs.js";
import { RECIPE_REPOINT_FLAG_NAMES } from "../../../../cli/commands/automation/repointUsage.js";
import { parseRecipeResyncArgs } from "../../../../cli/commands/automation/resync.js";
import { parseRetireArgs } from "../../../../cli/commands/automation/retireArgs.js";
import { RECIPE_RETIRE_FLAG_NAMES } from "../../../../cli/commands/automation/retireUsage.js";
import { parseRecipeRunDueArgs } from "../../../../cli/commands/automation/runDueArgs.js";
import { parseRecipeSeatArgs } from "../../../../cli/commands/automation/seatArgs.js";
import { parseRecipeStatusArgs } from "../../../../cli/commands/automation/status.js";
import { RECIPE_STATUS_FLAG_SPEC } from "../../../../cli/commands/automation/statusUsage.js";
import {
  MONITOR_CHECK_FLAG_NAMES,
  MONITOR_FILTER_FLAG_NAMES,
  MONITOR_LIST_FLAG_NAMES,
  parseMonitorCheckArgs,
  parseMonitorFilterArgs,
  parseMonitorListArgs,
} from "../../../../cli/commands/monitor/core.js";
import {
  parseSweepApplyArgs,
  parseSweepBoardArgs,
  parseSweepListArgs,
  parseSweepRecheckArgs,
  SWEEP_APPLY_FLAG_NAMES,
  SWEEP_BOARD_FLAG_NAMES,
  SWEEP_LIST_FLAG_NAMES,
  SWEEP_RECHECK_FLAG_NAMES,
} from "../../../../cli/commands/sweep/core.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { PROBE_HOME } from "./sharedProbes.js";

/** A whole `automation explain` invocation: the row, the sentence, and the firing named by slot and attempt. */
const EXPLAIN_FIRING = [
  "acme-digest",
  "--why",
  "The sign-in expired, so reconnecting it fixes it.",
  "--slot",
  "2026-11-01T09:00:00.000Z",
  "--attempt",
  "1",
] as const;

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "sweep apply": SWEEP_APPLY_FLAG_NAMES,
  "sweep board": SWEEP_BOARD_FLAG_NAMES,
  "sweep list": SWEEP_LIST_FLAG_NAMES,
  "sweep recheck": SWEEP_RECHECK_FLAG_NAMES,
  "monitor check": MONITOR_CHECK_FLAG_NAMES,
  "monitor filter": MONITOR_FILTER_FLAG_NAMES,
  "monitor list": MONITOR_LIST_FLAG_NAMES,
  "automation blocker": RECIPE_BLOCKER_FLAG_NAMES,
  "automation claim": RECIPE_CLAIM_FLAG_NAMES,
  "automation due": RECIPE_DUE_FLAG_NAMES,
  "automation explain": RECIPE_EXPLAIN_FLAG_NAMES,
  "automation propagate": RECIPE_PROPAGATE_FLAG_NAMES,
  "automation register-resyncs": RECIPE_REGISTER_RESYNCS_FLAG_NAMES,
  "automation register-standing": RECIPE_REGISTER_STANDING_FLAG_NAMES,
  "automation repair": RECIPE_REPAIR_FLAG_NAMES,
  "automation repoint": RECIPE_REPOINT_FLAG_NAMES,
  "automation resync": RECIPE_RESYNC_FLAG_NAMES,
  "automation retire": RECIPE_RETIRE_FLAG_NAMES,
  "automation run-due": RECIPE_RUN_DUE_FLAG_NAMES,
  "automation seat": RECIPE_SEAT_FLAG_NAMES,
  "automation status": [...RECIPE_STATUS_FLAG_SPEC.boolean, ...RECIPE_STATUS_FLAG_SPEC.string].map(
    (name) => `--${name}`,
  ),
  "automation freshness": [...RECIPE_FRESHNESS_FLAG_SPEC.boolean, ...RECIPE_FRESHNESS_FLAG_SPEC.string].map(
    (name) => `--${name}`,
  ),
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  // `sweep apply` takes its slug as a positional, which the flag parser does not require — the runner does.
  // Every fragment here is flags only, so each probe tests its own flag rather than the missing positional.
  "sweep apply": {
    "--anchor": ["--anchor", "https://example.slack.com/archives/C0/p1"],
    "--dir": ["--dir", "/tmp/handovers"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--now": ["--now", "2026-09-19T12:04:05.000Z"],
    "--reason": ["--reason", "that stack is dead, drop it"],
    "--session": ["--session", "workspace:151"],
    "--why": ["--why", "the probes all pass"],
  },
  "sweep board": {
    "--base": ["--base", "main"],
    "--close-shipped": ["--write", "--close-shipped"],
    "--deadline": ["--deadline", "60"],
    "--dir": ["--dir", "/tmp/handovers"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--priority": ["--priority", "p0"],
    "--probe": ["--probe"],
    "--queue": ["--write", "--queue"],
    "--settle-ended": ["--write", "--settle-ended"],
    "--verdict": ["--verdict", "SHIPPED"],
    "--write": ["--write"],
  },
  "sweep list": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--slug": ["--slug", "some-row"],
  },
  "sweep recheck": {
    "--dir": ["--dir", "/tmp/handovers"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "5"],
  },
  "monitor check": {
    "--by-session": ["--by-session", "workspace:129"],
    "--fire": ["--fire"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--landing": ["--landing", "/tmp/landing.json"],
    "--now": ["--now", "2026-09-19T06:00:00.000Z"],
    "--only": ["--only", "fleet-runs-dry"],
    "--push": ["--push"],
  },
  "monitor filter": {
    "--home": ["--home", "/tmp"],
    "--hook-script": ["--hook-script", "/tmp/log-notification.sh"],
    "--json": ["--json"],
  },
  "monitor list": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "automation claim": {
    "--by": ["knock-alerts", "--by", "supervisor-tick"],
    "--claim-id": ["knock-alerts", "--release", "--exit-code", "0", "--claim-id", "claim-0001"],
    "--exit-code": ["knock-alerts", "--release", "--exit-code", "0", "--claim-id", "claim-0001"],
    "--home": ["knock-alerts", "--by", "supervisor-tick", "--home", "/tmp"],
    "--release": ["knock-alerts", "--release"],
  },
  // `automation blocker` needs a target on every probe, and `--clear` is the arm that needs no reason or steps.
  "automation blocker": {
    "--atlas": ["--atlas", "trelica", "--clear"],
    "--clear": ["--atlas", "trelica", "--clear"],
    "--finding": ["--atlas", "trelica", "--reason", "r", "--steps", "s", "--finding", "a-row"],
    "--home": ["--atlas", "trelica", "--clear", "--home", "/tmp"],
    "--reason": ["--atlas", "trelica", "--reason", "r", "--steps", "s"],
    "--source": ["--source", "notion", "--clear"],
    "--steps": ["--atlas", "trelica", "--reason", "r", "--steps", "s"],
  },
  "automation due": {
    "--brief": ["--brief"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  // Every probe carries the recipe id, `--why`, `--slot` and `--attempt`: an explanation with no sentence, or one that
  // does not name its firing exactly, is refused by construction.
  "automation explain": {
    "--attempt": [...EXPLAIN_FIRING],
    "--home": [...EXPLAIN_FIRING, "--home", "/tmp"],
    "--slot": [...EXPLAIN_FIRING],
    "--why": [...EXPLAIN_FIRING],
  },
  // Exactly one mode per probe: `--json` rides `--status`, and `--batch`/`--through-revision` ride `--done`.
  "automation propagate": {
    "--batch": ["--done", "--batch", "b", "--through-revision", "2"],
    "--done": ["--done", "--batch", "b", "--through-revision", "2"],
    "--home": ["--status", "--home", "/tmp"],
    "--json": ["--status", "--json"],
    "--seat": ["--seat"],
    "--status": ["--status"],
    "--through-revision": ["--done", "--batch", "b", "--through-revision", "2"],
  },
  "automation register-resyncs": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "automation register-standing": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--repo": ["--repo", "acme/acme-admin"],
  },
  // Every probe carries the recipe id and `--row`: a take naming no seat is refused by construction.
  "automation repair": {
    "--home": ["knock-alerts", "--row", "fix-it", "--home", "/tmp"],
    "--row": ["knock-alerts", "--row", "fix-it"],
  },
  // Every probe carries the recipe id: a repoint naming no row is refused by construction.
  "automation repoint": {
    "--dry-run": ["bump-drive-slopweaver", "--dry-run"],
    "--home": ["bump-drive-slopweaver", "--home", "/tmp"],
    "--json": ["bump-drive-slopweaver", "--json"],
  },
  // A retirement carries all three words; an undo carries none of them.
  "automation retire": {
    "--anchor": ["thread-chase-daily", "--anchor", "talk:acme", "--words", "off", "--why", "not here"],
    "--home": ["thread-chase-daily", "--undo", "--home", "/tmp"],
    "--undo": ["thread-chase-daily", "--undo"],
    "--why": ["thread-chase-daily", "--anchor", "talk:acme", "--words", "off", "--why", "not here"],
    "--words": ["thread-chase-daily", "--anchor", "talk:acme", "--words", "off", "--why", "not here"],
  },
  // Every probe carries both required flags: a seat with no bound and no model is refused by construction.
  "automation seat": {
    "--dry-run": ["--limit", "4", "--model", "sonnet", "--dry-run"],
    "--home": ["--limit", "4", "--model", "sonnet", "--home", "/tmp"],
    "--limit": ["--limit", "4", "--model", "sonnet"],
    "--model": ["--limit", "4", "--model", "sonnet"],
    "--recipe": ["--limit", "4", "--model", "sonnet", "--recipe", "growth-ops"],
  },
  // `--json` only means anything beside `--list`, and every other probe needs exactly one target.
  "automation resync": {
    "--atlas": ["--atlas", "trelica"],
    "--home": ["--atlas", "trelica", "--home", "/tmp"],
    "--json": ["--list", "--json"],
    "--list": ["--list"],
    "--source": ["--source", "notion"],
  },
  "automation status": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "automation freshness": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "automation run-due": {
    "--claim-id": ["--recipe", "resync-atlas-trelica", "--claim-id", "claim-0001"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--limit": ["--limit", "4"],
    // --media is only accepted in a SEATED session, so its probe carries the claim token that proves one.
    "--media": ["--recipe", "growth-ops", "--claim-id", "claim-0001", "--media", "/tmp/a.png"],
    "--recipe": ["--recipe", "store-backup-daily"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "sweep apply": ({ fragment }) => parseSweepApplyArgs({ rest: fragment }),
  "sweep board": ({ fragment }) => parseSweepBoardArgs({ rest: fragment }),
  "sweep list": ({ fragment }) => parseSweepListArgs({ rest: fragment }),
  "sweep recheck": ({ fragment }) => parseSweepRecheckArgs({ rest: fragment }),
  "monitor check": ({ fragment }) => parseMonitorCheckArgs({ rest: [...fragment] }),
  // The action is a POSITIONAL this parser allows but the verb requires, so every probe carries one.
  "monitor filter": ({ fragment }) => parseMonitorFilterArgs({ rest: ["status", ...fragment] }),
  "monitor list": ({ fragment }) => parseMonitorListArgs({ rest: [...fragment] }),
  "automation claim": ({ fragment }) =>
    parseRecipeClaimArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }).mapErr((error) =>
      recipeCommandErrorLines({ error }),
    ),
  "automation blocker": ({ fragment }) =>
    parseRecipeBlockerArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }).mapErr((error) =>
      recipeCommandErrorLines({ error }),
    ),
  "automation due": ({ fragment }) => parseRecipeDueArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }),
  "automation explain": ({ fragment }) =>
    parseRecipeExplainArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }).mapErr((error) =>
      recipeCommandErrorLines({ error }),
    ),
  "automation register-resyncs": ({ fragment }) =>
    parseRegisterResyncsArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }),
  "automation register-standing": ({ fragment }) =>
    parseRegisterStandingArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }),
  "automation resync": ({ fragment }) =>
    parseRecipeResyncArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }).mapErr((error) =>
      recipeCommandErrorLines({ error }),
    ),
  "automation run-due": ({ fragment }) =>
    parseRecipeRunDueArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }).mapErr((error) =>
      recipeCommandErrorLines({ error }),
    ),
  "automation repair": ({ fragment }) =>
    parseRecipeRepairArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }).mapErr((error) =>
      recipeCommandErrorLines({ error }),
    ),
  "automation repoint": ({ fragment }) =>
    parseRepointArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }).mapErr((error) =>
      recipeCommandErrorLines({ error }),
    ),
  "automation retire": ({ fragment }) =>
    parseRetireArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }).mapErr((error) =>
      recipeCommandErrorLines({ error }),
    ),
  "automation seat": ({ fragment }) => parseRecipeSeatArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }),
  "automation status": ({ fragment }) => parseRecipeStatusArgs({ rest: fragment }),
  "automation freshness": ({ fragment }) => parseRecipeFreshnessArgs({ rest: fragment }),
  "automation propagate": ({ fragment }) =>
    parseRecipePropagateArgs({ defaultHome: PROBE_HOME, rest: [...fragment] }).mapErr((error) =>
      recipeCommandErrorLines({ error }),
    ),
};

/** The rows for `automation`, `monitor` and `sweep`. */
export const automationAndSweepSlice: HelpTruthSlice = { guarded, probes, parsers };
