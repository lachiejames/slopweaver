/**
 * The help-truth tables' rows for `plans` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`, whose
 * header says what each table proves.
 */

import { parsePlansArgs } from "../../../../cli/commands/plans/core.js";
import { PLANS_FLAG_NAMES, PLANS_SPECS } from "../../../../cli/commands/plans/plansUsage.js";
import { parsePlansUsageArgs } from "../../../../cli/commands/plans/usageRun.js";
import { parseFlags } from "../../../../cli/parseFlags.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags } from "./sharedProbes.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "plans adopt": PLANS_FLAG_NAMES["adopt"]!,
  "plans add": PLANS_FLAG_NAMES["add"]!,
  "plans clear-lapse": PLANS_FLAG_NAMES["clear-lapse"]!,
  "plans connect": PLANS_FLAG_NAMES["connect"]!,
  "plans connect-cancel": PLANS_FLAG_NAMES["connect-cancel"]!,
  "plans connect-worker": PLANS_FLAG_NAMES["connect-worker"]!,
  "plans connections": PLANS_FLAG_NAMES["connections"]!,
  "plans lapse": PLANS_FLAG_NAMES["lapse"]!,
  "plans list": PLANS_FLAG_NAMES["list"]!,
  "plans pause": PLANS_FLAG_NAMES["pause"]!,
  "plans pin": PLANS_FLAG_NAMES["pin"]!,
  "plans remove": PLANS_FLAG_NAMES["remove"]!,
  "plans resume": PLANS_FLAG_NAMES["resume"]!,
  "plans set-email": PLANS_FLAG_NAMES["set-email"]!,
  "plans set-store-dir": PLANS_FLAG_NAMES["set-store-dir"]!,
  "plans unpin": PLANS_FLAG_NAMES["unpin"]!,
  "plans set-thresholds": PLANS_FLAG_NAMES["set-thresholds"]!,
  "plans set-usage-limit": PLANS_FLAG_NAMES["set-usage-limit"]!,
  "plans sync-accounts": PLANS_FLAG_NAMES["sync-accounts"]!,
  "plans usage": PLANS_FLAG_NAMES["usage"]!,
  "plans validate": PLANS_FLAG_NAMES["validate"]!,
};

/** The flags every row verb carries, probed the same way on each. */
const ROW_FLAGS = {
  "--home": ["--home", "/tmp"],
  "--json": ["--json"],
  "--plan": ["--plan", "plan-one"],
  "--provider": ["--provider", "claude"],
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "plans adopt": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "plans add": {
    "--email": ["--email", "owner@example.com"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--percent": ["--percent", "30"],
    "--pinned": ["--pinned"],
    "--plan": ["--plan", "codex-two"],
    "--provider": ["--provider", "codex"],
    "--store-dir": ["--store-dir", "/x/two"],
  },
  "plans connect": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--provider": ["--provider", "codex"],
  },
  "plans connect-cancel": {
    "--home": ["--home", "/tmp"],
    "--id": ["--id", "0123abcd4567ef89"],
    "--json": ["--json"],
  },
  "plans connect-worker": {
    "--home": ["--home", "/tmp"],
    "--id": ["--id", "0123abcd4567ef89"],
  },
  "plans connections": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "plans lapse": { ...ROW_FLAGS, "--on": ["--on", "2026-11-17T00:00:00Z"] },
  "plans list": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--provider": ["--provider", "codex"],
  },
  "plans pause": { ...ROW_FLAGS, "--reason": ["--reason", "the subscription lapsed"] },
  "plans pin": ROW_FLAGS,
  "plans resume": ROW_FLAGS,
  "plans clear-lapse": ROW_FLAGS,
  "plans remove": { ...ROW_FLAGS, "--plan": ["--plan", "codex-two"], "--provider": ["--provider", "codex"] },
  "plans set-email": { ...ROW_FLAGS, "--email": ["--email", "owner@example.com"] },
  "plans set-store-dir": { ...ROW_FLAGS, "--store-dir": ["--store-dir", "/Users/owner/.claude-two"] },
  "plans unpin": ROW_FLAGS,
  "plans set-thresholds": {
    "--acceptance-at-percent": ["--acceptance-at-percent", "89"],
    "--alert-at-percent": ["--alert-at-percent", "70"],
    "--balanced-spread-percent": ["--balanced-spread-percent", "9"],
    "--drifting-spread-percent": ["--drifting-spread-percent", "16"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--pause-at-percent": ["--pause-at-percent", "98"],
    "--provider": ["--provider", "claude"],
    "--reset": ["--reset", "route-at-percent"],
    "--route-at-percent": ["--route-at-percent", "94"],
    "--spend-out-at-percent": ["--spend-out-at-percent", "100"],
    "--spend-out-before-reset-minutes": ["--spend-out-before-reset-minutes", "240"],
  },
  "plans set-usage-limit": {
    ...ROW_FLAGS,
    "--allowance": ["--allowance", "monthly-spend"],
    "--from": ["--from", "70"],
    "--percent": ["--percent", "80"],
  },
  "plans sync-accounts": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "plans usage": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "plans validate": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--repair-projection": ["--repair-projection"],
  },
};

/** One `plans` parse with its typed refusal as the message list the help-truth table compares. */
const plansProbe = (
  args: Parameters<typeof parsePlansArgs>[0],
): ReturnType<NonNullable<HelpTruthSlice["parsers"]>[string]> =>
  parsePlansArgs(args).mapErr((error) => [error.message]);

/** A probe for a row verb whose only required flags are `--provider` and `--plan`, plus any the verb adds. */
const rowProbe =
  ({ extra = [], verb }: { extra?: readonly string[]; verb: string }): NonNullable<HelpTruthSlice["parsers"]>[string] =>
  ({ fragment }) =>
    plansProbe({
      rest: dedupeFlags({ base: ["--provider", "claude", "--plan", "plan-one", ...extra], fragment }),
      verb,
    });

/** A probe for a Connect verb: the same `parseFlags` over its `PLANS_SPECS` entry the verb runs. */
const connectProbe =
  ({ verb }: { verb: string }): NonNullable<HelpTruthSlice["parsers"]>[string] =>
  ({ fragment }) =>
    parseFlags({ args: fragment, spec: PLANS_SPECS[verb]! });

// Each row verb REQUIRES `--provider` and `--plan`, and `add` a `--store-dir` too, so a fragment probing any other
// flag has to carry them or every probe reports the same missing-flag error instead of the one it tests.
// `dedupeFlags` drops the base copy when the fragment supplies its own.
const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "plans adopt": ({ fragment }) => plansProbe({ rest: [...fragment], verb: "adopt" }),
  "plans add": ({ fragment }) =>
    plansProbe({
      rest: dedupeFlags({
        base: ["--provider", "codex", "--plan", "codex-two", "--store-dir", "/x/two"],
        fragment,
      }),
      verb: "add",
    }),
  // The Connect verbs parse their flags straight off `PLANS_SPECS` (`connectRun.ts`'s `parsedOrUsage`), not
  // through `parsePlansArgs`, so they are probed against that same parse.
  "plans connect": connectProbe({ verb: "connect" }),
  "plans connect-cancel": connectProbe({ verb: "connect-cancel" }),
  "plans connect-worker": connectProbe({ verb: "connect-worker" }),
  "plans connections": connectProbe({ verb: "connections" }),
  "plans lapse": rowProbe({ extra: ["--on", "2026-11-17T00:00:00Z"], verb: "lapse" }),
  "plans list": ({ fragment }) => plansProbe({ rest: [...fragment], verb: "list" }),
  "plans pause": rowProbe({ extra: ["--reason", "lapsed"], verb: "pause" }),
  "plans pin": rowProbe({ verb: "pin" }),
  "plans resume": rowProbe({ verb: "resume" }),
  "plans clear-lapse": rowProbe({ verb: "clear-lapse" }),
  "plans remove": ({ fragment }) =>
    plansProbe({
      rest: dedupeFlags({ base: ["--provider", "codex", "--plan", "codex-two"], fragment }),
      verb: "remove",
    }),
  "plans set-email": rowProbe({ extra: ["--email", "owner@example.com"], verb: "set-email" }),
  "plans set-store-dir": rowProbe({ extra: ["--store-dir", "/Users/owner/.claude-two"], verb: "set-store-dir" }),
  "plans unpin": rowProbe({ verb: "unpin" }),
  // `set-thresholds` REQUIRES `--provider` and one change, and refuses a field of the other provider, so a fragment
  // probing Codex's only field rides a Codex base and every other a Claude one.
  "plans set-thresholds": ({ fragment }) =>
    plansProbe({
      rest: dedupeFlags({
        base: ["--provider", fragment.includes("--pause-at-percent") ? "codex" : "claude", "--alert-at-percent", "70"],
        fragment,
      }),
      verb: "set-thresholds",
    }),
  "plans set-usage-limit": rowProbe({
    extra: ["--percent", "80", "--allowance", "weekly-window"],
    verb: "set-usage-limit",
  }),
  "plans sync-accounts": ({ fragment }) => plansProbe({ rest: [...fragment], verb: "sync-accounts" }),
  "plans usage": ({ fragment }) => parsePlansUsageArgs({ rest: [...fragment] }),
  "plans validate": ({ fragment }) => plansProbe({ rest: [...fragment], verb: "validate" }),
};

export const plansSlice: HelpTruthSlice = { guarded, probes, parsers };
