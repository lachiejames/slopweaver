/**
 * The help-truth tables' rows for `spend`, `velocity` and `perf` — merged by `./allTables.ts` and swept by
 * `../helpTruth.test.ts`, whose header says what each table proves. `plans` has its own slice, `./plans.ts`.
 */

import { PERF_CONSOLE_FLAG_NAMES, parsePerfConsoleArgs } from "../../../../cli/commands/perf/console.js";
import { PERF_FLAG_NAMES, parsePerfArgs } from "../../../../cli/commands/perf/core.js";
import { SPEND_CAPTURE_FLAG_NAMES } from "../../../../cli/commands/spend/capture.js";
import { parseSpendCaptureArgs } from "../../../../cli/commands/spend/captureArgs.js";
import {
  parseSpendForwardArgs,
  parseSpendImportArgs,
  parseSpendReadArgs,
  parseSpendTasksArgs,
  SPEND_FORWARD_FLAG_NAMES,
  SPEND_IMPORT_FLAG_NAMES,
  SPEND_READ_FLAG_NAMES,
  SPEND_TASKS_FLAG_NAMES,
} from "../../../../cli/commands/spend/core.js";
import { parseSpendMerchantsArgs, SPEND_MERCHANTS_FLAG_NAMES } from "../../../../cli/commands/spend/merchantsCore.js";
import { parseVelocityOptions, VELOCITY_FLAG_SPEC } from "../../../../cli/commands/velocity/run.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags } from "./sharedProbes.js";

/** `velocity`'s advertised flags, derived from the spec the verb parses with. */
const VELOCITY_FLAG_NAMES: readonly string[] = [
  ...VELOCITY_FLAG_SPEC.value.map((name) => `--${name}`),
  ...VELOCITY_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "spend capture": SPEND_CAPTURE_FLAG_NAMES,
  "spend import": SPEND_IMPORT_FLAG_NAMES,
  "spend read": SPEND_READ_FLAG_NAMES,
  "spend tasks": SPEND_TASKS_FLAG_NAMES,
  "spend forward": SPEND_FORWARD_FLAG_NAMES,
  "spend merchants": SPEND_MERCHANTS_FLAG_NAMES,
  perf: PERF_FLAG_NAMES,
  "perf console": PERF_CONSOLE_FLAG_NAMES,
  "perf hook": PERF_FLAG_NAMES,
  "perf seat": PERF_FLAG_NAMES,
  velocity: VELOCITY_FLAG_NAMES,
  "velocity run": VELOCITY_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "spend capture": {
    "--discover": ["--discover"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--last4": ["--store", "--last4", "0042"],
    "--store": ["--store", "--last4", "0042"],
    "--url": ["--url", "https://www.airwallex.com/app/cards/cardholder/x"],
  },
  "spend import": {
    "--as-of": ["--as-of", "2026-01-31"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "spend read": {
    "--by": ["--by", "month"],
    "--card": ["--card", "0042"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "spend tasks": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "spend forward": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "spend merchants": {
    "--form": ["--form", "/tmp/merchants.json"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  perf: {
    "--json": ["--json"],
    "--window-minutes": ["--window-minutes", "15"],
  },
  "perf console": {
    "--base": ["--base", "http://localhost:3100"],
    "--check": ["--check"],
    "--headed": ["--headed"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--only": ["--only", "/queue"],
    "--runs": ["--runs", "1"],
    "--skip-verbs": ["--skip-verbs"],
  },
  "perf hook": {
    "--json": ["--json"],
    "--window-minutes": ["--window-minutes", "15"],
  },
  "perf seat": {
    "--json": ["--json"],
    "--window-minutes": ["--window-minutes", "15"],
  },
  velocity: {
    "--days": ["--days", "7"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--ref": ["--ref", "origin/main"],
    "--repo": ["--repo", "/repo"],
  },
  "velocity run": {
    "--days": ["--days", "7"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--ref": ["--ref", "origin/main"],
    "--repo": ["--repo", "/repo"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  // `spend import` REQUIRES its path and `--as-of`, so every probe carries both; `dedupeFlags` drops the base
  // `--as-of` when the fragment supplies its own.
  // `spend capture` REQUIRES `--url` and exactly one mode, so every probe carries the URL, and `--discover`
  // unless its fragment is the `--store --last4` mode.
  "spend capture": ({ fragment }) => {
    const base = ["--url", "https://www.airwallex.com/app/cards/cardholder/x"];
    if (!fragment.includes("--store")) {
      base.push("--discover");
    }
    return parseSpendCaptureArgs({ rest: dedupeFlags({ base, fragment }) }).mapErr((error) => [error.message]);
  },
  "spend import": ({ fragment }) =>
    parseSpendImportArgs({ rest: dedupeFlags({ base: ["/tmp/card.md", "--as-of", "2026-01-31"], fragment }) }),
  "spend read": ({ fragment }) => parseSpendReadArgs({ rest: [...fragment] }),
  "spend tasks": ({ fragment }) => parseSpendTasksArgs({ rest: [...fragment] }),
  "spend forward": ({ fragment }) => parseSpendForwardArgs({ rest: [...fragment] }),
  // `spend merchants` REQUIRES one action: `set` (which requires `--form`) for a fragment probing `--form`, else `show`.
  "spend merchants": ({ fragment }) => {
    const action = fragment.includes("--form") ? "set" : "show";
    return parseSpendMerchantsArgs({ rest: [action, ...fragment] }).mapErr((error) => [error.message]);
  },
  perf: ({ fragment }) => parsePerfArgs({ rest: [...fragment] }),
  "perf console": ({ fragment }) => parsePerfConsoleArgs({ rest: [...fragment] }),
  "perf hook": ({ fragment }) => parsePerfArgs({ allowPositionals: true, rest: ["poll-gate", ...fragment] }),
  "perf seat": ({ fragment }) => parsePerfArgs({ allowPositionals: true, rest: ["workspace:1", ...fragment] }),
  velocity: ({ fragment }) => parseVelocityOptions({ rest: [...fragment] }),
  "velocity run": ({ fragment }) => parseVelocityOptions({ rest: [...fragment] }),
};

/** The rows for `spend`, `velocity` and `perf`. */
export const spendAndPerfSlice: HelpTruthSlice = { guarded, probes, parsers };
