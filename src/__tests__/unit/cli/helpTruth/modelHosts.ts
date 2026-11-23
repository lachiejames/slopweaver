/**
 * The help-truth tables' rows for `claude` and `codex` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { claudeCommandErrorLines } from "../../../../cli/commands/claude/errors.js";
import { CLAUDE_FORECAST_FLAG_NAMES, parseClaudeForecastArgs } from "../../../../cli/commands/claude/forecastRun.js";
import { CLAUDE_MINT_FLAG_NAMES, parseClaudeMintArgs } from "../../../../cli/commands/claude/mintRun.js";
import {
  CLAUDE_PAUSE_FLAG_NAMES,
  CLAUDE_RESUME_FLAG_NAMES,
  parseClaudePauseArgs,
  parseClaudeResumeArgs,
} from "../../../../cli/commands/claude/pauseRun.js";
import { CLAUDE_RESET_FLAG_NAMES, parseClaudeResetArgs } from "../../../../cli/commands/claude/resetRun.js";
import { CLAUDE_ROTATE_FLAG_NAMES, parseClaudeRotateArgs } from "../../../../cli/commands/claude/rotate.js";
import { CLAUDE_ROUTE_FLAG_NAMES, parseClaudeRouteArgs } from "../../../../cli/commands/claude/routeRun.js";
import { CLAUDE_GAUGE_FLAG_NAMES, parseClaudeGaugeArgs } from "../../../../cli/commands/claude/run.js";
import { CLAUDE_SEAT_FLAG_NAMES, parseClaudeSeatArgs } from "../../../../cli/commands/claude/seatRun.js";
import { CLAUDE_SIGNIN_FLAG_NAMES, parseClaudeSigninArgs } from "../../../../cli/commands/claude/signinArgs.js";
import { CLAUDE_SPEND_FLAG_NAMES, parseClaudeSpendArgs } from "../../../../cli/commands/claude/spendRun.js";
import { CLAUDE_TOKEN_FLAG_NAMES, parseClaudeTokenArgs } from "../../../../cli/commands/claude/tokenRun.js";
import { CLAUDE_WATCH_FLAG_NAMES, parseClaudeWatchArgs } from "../../../../cli/commands/claude/watchArgs.js";
import { CODEX_BURN_FLAG_NAMES, parseCodexBurnArgs } from "../../../../cli/commands/codex/burnRun.js";
import {
  CODEX_PLAN_FALLBACK_FLAG_NAMES,
  parseCodexPlanFallbackArgs,
} from "../../../../cli/commands/codex/fallbackPlanRun.js";
import {
  CODEX_REVIEW_FALLBACK_FLAG_NAMES,
  parseCodexReviewFallbackArgs,
} from "../../../../cli/commands/codex/fallbackReviewRun.js";
import { CODEX_HOOKS_FLAG_NAMES, parseCodexHooksArgs } from "../../../../cli/commands/codex/hooksRun.js";
import {
  CODEX_PLUGIN_SYNC_FLAG_NAMES,
  parseCodexPluginSyncArgs,
} from "../../../../cli/commands/codex/pluginSyncRun.js";
import { CODEX_QUOTA_FLAG_NAMES, parseCodexQuotaArgs } from "../../../../cli/commands/codex/quotaRun.js";
import { CODEX_RESET_FLAG_NAMES, parseCodexResetArgs } from "../../../../cli/commands/codex/resetRun.js";
import { CODEX_ROUTE_FLAG_NAMES, parseCodexRouteArgs } from "../../../../cli/commands/codex/routeRun.js";
import { CODEX_STATUS_FLAG_NAMES, parseCodexStatusArgs } from "../../../../cli/commands/codex/statusRun.js";
import { CODEX_SUPERSEDE_FLAG_NAMES, parseCodexSupersedeArgs } from "../../../../cli/commands/codex/supersedeRun.js";
import { CODEX_USAGE_FLAG_NAMES, parseCodexUsageArgs } from "../../../../cli/commands/codex/usageRun.js";
import { CODEX_WATCH_FLAG_NAMES, parseCodexWatchArgs } from "../../../../cli/commands/codex/watchRun.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

/** `claude gauge`'s probes. `--plan` takes an alias; the parser validates shape, not membership. */
const CLAUDE_GAUGE_PROBES: Readonly<Record<string, readonly string[]>> = {
  "--json": ["--json"],
  "--plan": ["--plan", "plan-one"],
};

/** `claude token`'s probes. `--stdin` only means something beside the `--plan` it reads a token for. */
const CLAUDE_TOKEN_PROBES: Readonly<Record<string, readonly string[]>> = {
  "--plan": ["--plan", "plan-one"],
  "--status": ["--status"],
  "--stdin": ["--plan", "plan-one", "--stdin"],
};

/** `claude mint`'s probes. `--plan` takes an alias; the parser validates shape, not membership. */
const CLAUDE_MINT_PROBES: Readonly<Record<string, readonly string[]>> = {
  "--plan": ["--plan", "plan-one"],
};

/** `claude signin`'s probes. `--plan`, `--enroll` and `--reenroll` take an alias; `--out` takes a path. */
const CLAUDE_SIGNIN_PROBES: Readonly<Record<string, readonly string[]>> = {
  "--enroll": ["--enroll", "plan-one"],
  "--reenroll": ["--reenroll", "plan-one"],
  "--json": ["--json"],
  // `--out` names where `--page` writes, and alone it is refused rather than falling through to the walk.
  "--out": ["--page", "--out", "/tmp/signin.html"],
  "--page": ["--page"],
  "--plan": ["--plan", "plan-one"],
  "--status": ["--status"],
};

/** `claude forecast`'s probes. Every flag is optional; `--weeks` is held to 1..12 and `--demand` to two words. */
const CLAUDE_FORECAST_PROBES: Readonly<Record<string, readonly string[]>> = {
  "--demand": ["--demand", "peak"],
  "--home": ["--home", "/tmp/forecast-probe-home"],
  "--json": ["--json"],
  "--now": ["--now", "2026-09-21T00:00:00Z"],
  "--weeks": ["--weeks", "4"],
};

/** `claude pause`'s probes. It takes one positional alias, so every fragment carries one. */
const CLAUDE_PAUSE_PROBES: Readonly<Record<string, readonly string[]>> = {
  "--reason": ["plan-one", "--reason", "a bounced charge"],
};

/** `claude route`'s probe. `--model` takes a model name; the parser validates shape, not membership. */
const CLAUDE_ROUTE_PROBES: Readonly<Record<string, readonly string[]>> = {
  "--model": ["--model", "fable"],
};

/** `claude rotate`'s probes. `--to` is REQUIRED, so every fragment carries it. */
const CLAUDE_ROTATE_PROBES: Readonly<Record<string, readonly string[]>> = {
  "--commit": ["--to", "plan-one", "--commit"],
  "--to": ["--to", "plan-one"],
};

/** `claude watch`'s probes. `--interval` takes minutes in 1..60. */
const CLAUDE_WATCH_PROBES: Readonly<Record<string, readonly string[]>> = {
  "--dry-run": ["--dry-run"],
  "--interval": ["--interval", "5"],
  "--json": ["--json"],
  "--once": ["--once"],
  "--wait": ["--wait"],
};

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "claude gauge": CLAUDE_GAUGE_FLAG_NAMES,
  "claude mint": CLAUDE_MINT_FLAG_NAMES,
  "claude forecast": CLAUDE_FORECAST_FLAG_NAMES,
  "claude pause": CLAUDE_PAUSE_FLAG_NAMES,
  "claude resume": CLAUDE_RESUME_FLAG_NAMES,
  "claude rotate": CLAUDE_ROTATE_FLAG_NAMES,
  "claude route": CLAUDE_ROUTE_FLAG_NAMES,
  "claude seat": CLAUDE_SEAT_FLAG_NAMES,
  "claude reset": CLAUDE_RESET_FLAG_NAMES,
  "claude signin": CLAUDE_SIGNIN_FLAG_NAMES,
  "claude spend": CLAUDE_SPEND_FLAG_NAMES,
  "claude token": CLAUDE_TOKEN_FLAG_NAMES,
  "claude watch": CLAUDE_WATCH_FLAG_NAMES,
  "codex burn": CODEX_BURN_FLAG_NAMES,
  "codex hooks": CODEX_HOOKS_FLAG_NAMES,
  "codex plan-fallback": CODEX_PLAN_FALLBACK_FLAG_NAMES,
  "codex quota": CODEX_QUOTA_FLAG_NAMES,
  "codex reset": CODEX_RESET_FLAG_NAMES,
  "codex review-fallback": CODEX_REVIEW_FALLBACK_FLAG_NAMES,
  "codex plugin-sync": CODEX_PLUGIN_SYNC_FLAG_NAMES,
  "codex route": CODEX_ROUTE_FLAG_NAMES,
  "codex status": CODEX_STATUS_FLAG_NAMES,
  "codex supersede": CODEX_SUPERSEDE_FLAG_NAMES,
  "codex usage": CODEX_USAGE_FLAG_NAMES,
  "codex watch": CODEX_WATCH_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "claude gauge": CLAUDE_GAUGE_PROBES,
  "claude mint": CLAUDE_MINT_PROBES,
  "claude forecast": CLAUDE_FORECAST_PROBES,
  "claude pause": CLAUDE_PAUSE_PROBES,
  "claude rotate": CLAUDE_ROTATE_PROBES,
  "claude route": CLAUDE_ROUTE_PROBES,
  "claude seat": { "--from-payload": ["--from-payload"], "--session": ["--session", "abc-123"] },
  "claude reset": {
    "--claim": ["--plan", "plan-one", "--claim"],
    "--grant": ["--plan", "plan-one", "--claim", "--grant", "grant-1"],
    "--home": ["--plan", "plan-one", "--home", "/tmp"],
    "--json": ["--plan", "plan-one", "--json"],
    "--plan": ["--plan", "plan-one"],
  },
  "claude signin": CLAUDE_SIGNIN_PROBES,
  "claude spend": {
    "--home": ["--plan", "plan-one", "--home", "/tmp"],
    "--json": ["--plan", "plan-one", "--json"],
    "--plan": ["--plan", "plan-one"],
  },
  "claude token": CLAUDE_TOKEN_PROBES,
  "claude watch": CLAUDE_WATCH_PROBES,
  "codex plan-fallback": {
    "--answer-file": ["--answer-file", "/tmp/answer.json"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--model": ["--model", "opus"],
    "--pass": ["--pass", "p2"],
    "--repo": ["--repo", "/tmp"],
    "--request": ["--request", "some-request-id"],
    "--task-file": ["--task-file", "/tmp/task.md"],
    "--workspace": ["--workspace", "workspace:1"],
  },
  "codex quota": {
    "--home": ["show", "--home", "/tmp"],
    "--plan": ["show", "--plan", "codex-one"],
    "--routed": ["show", "--routed"],
  },
  "codex reset": {
    "--at-limit": ["--at-limit"],
    "--credit": ["--plan", "codex-one", "--credit", "credit-1"],
    "--home": ["--plan", "codex-one", "--home", "/tmp"],
    "--plan": ["--plan", "codex-one"],
  },
  "codex hooks": {
    "--codex-home": ["--codex-home", "/tmp"],
    "--json": ["--json"],
    "--trust": ["--trust"],
  },
  "codex plugin-sync": {
    "--decide": ["--decide"],
    "--home": ["--home", "/tmp"],
    "--log": ["--log"],
  },
  "codex route": {
    "--full": ["--full"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "codex burn": {
    "--days": ["--days", "7"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "codex review-fallback": {
    "--after-refusal": ["--after-refusal", "codex-r3-refused"],
    "--answer-file": ["--answer-file", "/tmp/answer.json"],
    "--base": ["--base", "main"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--max-diff-bytes": ["--max-diff-bytes", "1000"],
    "--model": ["--model", "opus"],
    "--pass": ["--pass", "r1"],
    "--property": ["--property", "a claim"],
    "--property-id": ["--property-id", "r1-01"],
    "--repo": ["--repo", "/tmp"],
    "--request": ["--request", "some-request-id"],
    "--workspace": ["--workspace", "workspace:1"],
  },
  "codex status": {
    "--branch": ["--branch", "main"],
    "--check": ["--check"],
    "--home": ["--home", "/tmp"],
    "--repo": ["--repo", "/tmp"],
  },
  "codex supersede": {
    "--artifact": ["--artifact", "some-artifact-id"],
    "--branch": ["--branch", "main"],
    "--home": ["--home", "/tmp"],
    "--reason": ["--reason", "the wording was unsatisfiable"],
    "--repo": ["--repo", "/tmp"],
  },
  "codex usage": {
    "--diff-sha256": ["--diff-sha256", "a".repeat(64)],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--rates": ["--rates", "/tmp/rates.json"],
    "--repo": ["--repo", "/tmp"],
  },
  "codex watch": {
    "--codex-home": ["--codex-home", "/tmp"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--interval-seconds": ["--interval-seconds", "60"],
    "--json": ["--json"],
    "--once": ["--once"],
    "--repo": ["--repo", "/tmp"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "claude gauge": ({ fragment }) => parseClaudeGaugeArgs({ rest: fragment }),
  "claude mint": ({ fragment }) => parseClaudeMintArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "claude forecast": ({ fragment }) =>
    parseClaudeForecastArgs({ rest: fragment }).mapErr((error) => claudeCommandErrorLines({ error })),
  "claude pause": ({ fragment }) =>
    parseClaudePauseArgs({ rest: fragment }).mapErr((error) => claudeCommandErrorLines({ error })),
  "claude resume": ({ fragment }) =>
    parseClaudeResumeArgs({ rest: fragment }).mapErr((error) => claudeCommandErrorLines({ error })),
  "claude rotate": ({ fragment }) =>
    parseClaudeRotateArgs({ rest: fragment }).mapErr((error) => claudeCommandErrorLines({ error })),
  "claude route": ({ fragment }) => parseClaudeRouteArgs({ rest: fragment }),
  "claude seat": ({ fragment }) =>
    parseClaudeSeatArgs({ rest: fragment }).mapErr((error) => claudeCommandErrorLines({ error })),
  "claude reset": ({ fragment }) => parseClaudeResetArgs({ rest: [...fragment] }),
  "claude signin": ({ fragment }) =>
    parseClaudeSigninArgs({ rest: fragment }).mapErr((error) => claudeCommandErrorLines({ error })),
  "claude spend": ({ fragment }) => parseClaudeSpendArgs({ rest: [...fragment] }),
  "claude token": ({ fragment }) => parseClaudeTokenArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "claude watch": ({ fragment }) => parseClaudeWatchArgs({ rest: fragment }),
  "codex quota": ({ fragment }) => parseCodexQuotaArgs({ rest: ["show", ...fragment] }),
  "codex reset": ({ fragment }) => parseCodexResetArgs({ rest: [...fragment] }),
  "codex hooks": ({ fragment }) => parseCodexHooksArgs({ rest: [...fragment] }),
  "codex plan-fallback": ({ fragment }) => parseCodexPlanFallbackArgs({ rest: [...fragment] }),
  "codex review-fallback": ({ fragment }) => parseCodexReviewFallbackArgs({ rest: [...fragment] }),
  "codex route": ({ fragment }) => parseCodexRouteArgs({ rest: [...fragment] }),
  "codex burn": ({ fragment }) => parseCodexBurnArgs({ rest: [...fragment] }),
  "codex status": ({ fragment }) => parseCodexStatusArgs({ rest: [...fragment] }),
  "codex plugin-sync": ({ fragment }) => parseCodexPluginSyncArgs({ rest: [...fragment] }),
  "codex supersede": ({ fragment }) => parseCodexSupersedeArgs({ rest: [...fragment] }),
  "codex usage": ({ fragment }) => parseCodexUsageArgs({ rest: [...fragment] }),
  "codex watch": ({ fragment }) => parseCodexWatchArgs({ rest: [...fragment] }),
};

/** The rows for `claude` and `codex`. */
export const modelHostsSlice: HelpTruthSlice = { guarded, probes, parsers };
