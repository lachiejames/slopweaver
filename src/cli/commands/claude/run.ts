/**
 * The `claude gauge` shell: read every configured plan's remaining budget and print it.
 *
 * STDOUT CARRIES THE MACHINE RESULT; STDERR CARRIES EVERYTHING ELSE, the same split every other verb keeps.
 * `--json` writes one document a caller parses; the default writes the human table `gaugeRender.ts` builds.
 *
 * It also reports what a session launched HERE would present. A gauge reads a store by handing that store's
 * own token to the provider; an `ANTHROPIC_API_KEY` in the environment resolves ahead of every store, so the
 * readings stay true about the stores while ceasing to describe the fleet. That condition is invisible in
 * every other field, which is why it is printed rather than left for a reader to think of.
 *
 * Read-only by construction. It performs no credential operation of any kind: it takes each store's token
 * out of the keychain, hands it to one probe request, and forgets it. There is no code path here that can
 * write a credential, which is why this verb can ship and be run freely while the swap waits on the owner.
 *
 * Every pure decision comes from `src/claude/*`. This file resolves the config, does the I/O, and reports.
 */
import { escapeJsonLineBreaks, foldLineBreaks } from "#lib/lineBreaks.js";
import { probedAccountCell } from "../../../claude/accountBinding.js";
import type { ClaudeAmbientCredential } from "../../../claude/ambientCredential.js";
import { resolveAmbientCredential } from "../../../claude/ambientCredentialRead.js";
import { readAssertions } from "../../../claude/assertionStore.js";
import { type ChairProbe, chairPlansOf, chairProbeOf, sweptUnreadOf } from "../../../claude/chairBudgetAlert.js";
import { pinnedAccountAlias, planLabelFor, unpausedAccounts } from "../../../claude/config.js";
import { type ClaudeAccount, type ClaudePlanGauge, probedClaudeAccount } from "../../../claude/contracts.js";
import { gaugeHumanLines } from "../../../claude/gaugeHumanLines.js";
import {
  type ClaudeAliasAccountCell,
  type ClaudeGaugeOutcome,
  type ClaudeGaugePaused,
  type ClaudePlanGaugeOutcome,
  gaugeDocument,
  planGaugeOutcome,
} from "../../../claude/gaugeRender.js";
import { planReadingsOf, renderPlanReadingLines } from "../../../claude/planReadingRender.js";
import { probePlan } from "../../../claude/probeStore.js";
import type { SweptPlanProbe } from "../../../claude/recordPlanProbes.js";
import { nextSpawnTargets } from "../../../claude/routeSpawn.js";
import type { GaugeChair } from "../../../claude/seatBoot.js";
import { readChairPlans } from "../../../claude/seatBootRead.js";
import { readClaudeFleet } from "../../../claude/spawnAccounts.js";
import { readClaudePlanSpends } from "../../../claude/spendBudgets.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { planRegisterPort } from "../../../plans/port.js";
import type { ClaudeThresholds } from "../../../plans/thresholds.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { keepSweepReadings } from "./gaugeKeep.js";

/**
 * The flags this verb accepts. Parsed through the repository's own seam rather than by scanning argv, and
 * that is a correctness fix rather than tidiness: a hand scan reading `argv[at + 1]` answers `undefined` for
 * a TRAILING `--plan`, which is indistinguishable from "no alias was asked for" — so a caller who typed
 * `--plan` and lost its value would silently get a probe of the WHOLE FLEET instead of the one plan they
 * named. A narrowing flag that silently widens is the worst shape a flag can have.
 */
const GAUGE_FLAG_SPEC = { boolean: ["json"], string: ["plan"] } as const;

/** Where this verb's own arguments start in `process.argv`: `[node, cli, claude, gauge, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Every flag this verb advertises, derived from the spec it actually parses with so the two cannot drift.
 *
 * @internal — read by `helpTruth.test.ts` to hold `meta.usage` to the real parser.
 */
export const CLAUDE_GAUGE_FLAG_NAMES: readonly string[] = [
  ...GAUGE_FLAG_SPEC.string.map((name) => `--${name}`),
  ...GAUGE_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/**
 * Parse this verb's own argument tail.
 *
 * Exported so the help ratchet probes the REAL parser rather than a restatement of it — the check that
 * stopped a flag being shipped, advertised and non-functional for a month.
 *
 * @param rest the argv tail, after `claude gauge`
 * @returns the requested alias and whether JSON was asked for, or every rejection at once
 */
export function parseClaudeGaugeArgs({ rest }: { rest: readonly string[] }): Result<{
  only?: string;
  wantsJson: boolean;
}> {
  const parsed = parseFlags({ args: rest, spec: GAUGE_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const only = parsed.value.values["plan"];
  return ok({
    wantsJson: parsed.value.values["json"] === true,
    ...(typeof only === "string" ? { only } : {}),
  });
}

/**
 * Which plans this invocation should sweep.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @param configured every plan the accounts file names, in configured order
 * @returns the plans to probe and the requested alias, or the refusal and the exit code it carries
 */
function selectPlans({ argv, configured }: { argv: readonly string[]; configured: readonly ClaudeAccount[] }): {
  accounts: readonly ClaudeAccount[];
  only?: string;
  refusal?: { readonly line: string; readonly code: number };
  wantsJson: boolean;
} {
  const parsed = parseClaudeGaugeArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return {
      accounts: [],
      refusal: { code: EXIT_USAGE, line: `claude gauge: ${parsed.error.join("; ")}` },
      wantsJson: false,
    };
  }
  const { only, wantsJson } = parsed.value;
  if (only === undefined) {
    // A fleet-wide read is a read of the plans the fleet may spend, so a PAUSED plan is not probed. Asking
    // for one BY NAME still probes it, which is how the operator answers "is it back yet" without resuming
    // first — the same by-name rule `claude rotate`, `signin` and `token` follow.
    // Nor a monthly-spend plan, by name or not: each probe is a billed request, and its windows are not its measure —
    // its `PLAN` line carries its spend verdict off the readings ledger instead.
    const measured = unpausedAccounts({ accounts: configured }).filter((account) => probedClaudeAccount({ account }));
    return { accounts: measured, wantsJson };
  }
  const accounts = configured.filter((account) => account.alias === only);
  if (accounts.length === 0) {
    const known = configured.map((account) => planLabelFor({ accounts: configured, alias: account.alias })).join(", ");
    return {
      accounts,
      only,
      refusal: { code: EXIT_ERROR, line: `claude gauge: \`${only}\` is not a configured plan — configured: ${known}` },
      wantsJson,
    };
  }
  return { accounts: accounts.filter((account) => probedClaudeAccount({ account })), only, wantsJson };
}

/**
 * Report every plan that could not be read, and the condition that makes the readings describe stores
 * rather than the fleet.
 *
 * @param accounts the configured plans, which name the account beside each alias
 * @param ambient what a session launched in this environment would actually present
 * @param outcomes every probed plan's outcome, in configured order
 */
function reportProblems({
  accounts,
  ambient,
  outcomes,
}: {
  accounts: readonly ClaudeAccount[];
  ambient: ClaudeAmbientCredential;
  outcomes: readonly ClaudePlanGaugeOutcome[];
}): void {
  // Folded like every stdout line (`printHuman`): a terminal shows both streams together, so a line break in a
  // cached address or a provider's reason would print a forged PLAN line here just as well.
  for (const outcome of outcomes) {
    if (outcome.problem !== undefined) {
      const text = `${planLabelFor({ accounts, alias: outcome.alias })}: ${outcome.problem}`;
      logger.error({ msg: foldLineBreaks({ text }) });
    }
  }
  if (ambient.kind === "shadowed") {
    logger.error({
      msg: foldLineBreaks({ text: `these readings are NOT what this fleet is spending: ${ambient.reason}` }),
    });
  }
}

/**
 * Decide what each probed plan's account may be CALLED, from the token the probe presented.
 *
 * This is the join the owner asked for, and the direction of it is the whole mechanism: the
 * organisation id the provider named goes in, `accounts.json`'s address is consulted only as a cache, and
 * what comes out is a verdict that cannot hold an organisation id. A plan whose store could not be read
 * gets `assessIdentity`'s `unobserved` rather than a cheerful fallback to config.
 *
 * The organisation id each probe also learned is CONSUMED here and never returned: the gauge prints its outcomes
 * verbatim and an organisation id may not reach stdout, so the decision happens in-process and only the verdict
 * travels outward.
 *
 * @param accounts the plans this sweep covered, in configured order
 * @param home the Slopweaver home the standing enrollments live under
 * @param results what each probe returned, positionally matching `accounts`
 * @returns one decided cell per plan
 */
function decideCells({
  accounts,
  home,
  results,
}: {
  accounts: readonly ClaudeAccount[];
  home: string;
  results: readonly Awaited<ReturnType<typeof probePlan>>[];
}): readonly ClaudeAliasAccountCell[] {
  const assertions = readAssertions({ home });
  return accounts.map((account, index): ClaudeAliasAccountCell => {
    const observed = results[index]?.organizationId;
    return {
      alias: account.alias,
      cell: probedAccountCell({
        account,
        assertions,
        ...(observed === undefined ? {} : { observedOrganizationId: observed }),
      }),
    };
  });
}

/*
 * The plans the operator took out of the fleet, built from the WHOLE configured list rather than from what was
 * probed, because a paused plan is exactly the one `selectPlans` filtered out: deriving it from the probed set would
 * always answer the empty list.
 */
function pausedPlans({ accounts }: { accounts: readonly ClaudeAccount[] }): readonly ClaudeGaugePaused[] {
  return accounts.flatMap((account) =>
    account.paused === undefined
      ? []
      : [{ alias: account.alias, reason: account.paused.reason, sinceIso: account.paused.sinceIso }],
  );
}

/**
 * Probe the swept plans, read the chair, and probe the chair's own plan when the sweep skipped it.
 *
 * A fleet-wide sweep skips a paused plan, but a chair still seated on one walls all the same, so its plan is
 * probed beside the sweep. Its reading feeds ONLY the chair's own warning: a paused plan never routes.
 *
 * @param accounts the plans this sweep covers
 * @param configured every configured plan, paused included — a chair booted on a paused plan is still on it
 * @param home the Slopweaver home whose supervisor pin names the chair's host
 * @param nowIso when the sweep ran
 * @param only the one plan `--plan` named; with none the sweep is fleet-wide, and a narrowed read probes only
 *   what it named
 * @returns the chair, its paused-plan probe's outcome as a list (empty when none ran), each swept probe's result
 *   positionally, and the chair's paused-plan probe — a FAILED one
 *   carried with its reason, never dropped, since an unreadable chair plan is the one the chair must hear about
 */
async function probeSweep({
  accounts,
  configured,
  home,
  nowIso,
  only,
}: {
  accounts: readonly ClaudeAccount[];
  configured: readonly ClaudeAccount[];
  home: string;
  nowIso: string;
  only: string | undefined;
}): Promise<{
  chair: GaugeChair;
  chairOutcomes: readonly ClaudeGaugeOutcome[];
  chairProbe: ChairProbe;
  results: readonly Awaited<ReturnType<typeof probePlan>>[];
}> {
  const chair = await readChairPlans({ accounts: configured, claudeHome: claudeHomeDir(), home });
  const fleetWide = only === undefined;
  // A split chair's FIRST paused plan is probed; any further one reads UNKNOWN in `chairBudgetLines`, never silent.
  const chairPlans = chairPlansOf({ sessions: chair.sessions });
  const chairAccount = fleetWide
    ? configured.find(
        (account) =>
          chairPlans.includes(account.alias) && !accounts.includes(account) && probedClaudeAccount({ account }),
      )
    : undefined;
  const [results, chairResult] = await Promise.all([
    Promise.all(accounts.map((account) => probePlan({ alias: account.alias, nowIso, storeDir: account.storeDir }))),
    chairAccount === undefined
      ? Promise.resolve(undefined)
      : probePlan({ alias: chairAccount.alias, nowIso, storeDir: chairAccount.storeDir }),
  ]);
  // The probe pairs with the EXACT paused account it read, so the chair is judged by that plan's own usage limit.
  const chairProbe =
    chairAccount === undefined || chairResult === undefined
      ? {}
      : chairProbeOf({ account: chairAccount, outcome: chairResult.outcome });
  return { chair, chairOutcomes: chairResult === undefined ? [] : [chairResult.outcome], chairProbe, results };
}

/**
 * Probe the swept plans and derive everything both outputs print from them, once, so the human read and the
 * document a tick captures can never disagree.
 *
 * @param accounts the plans this sweep covers
 * @param configured every configured plan, paused included
 * @param home the Slopweaver home the standing enrollments live under
 * @param only the one plan `--plan` named, absent on a fleet-wide sweep
 * @param thresholds the install's Claude thresholds, off the same register read as `configured`
 * @returns the decided cells, the chair and its probe, the readable gauges, each probe's outcome, one `PLAN` line
 *   per configured plan, the routing targets and when the sweep ran
 */
async function sweepFleet({
  accounts,
  configured,
  home,
  only,
  thresholds,
}: {
  accounts: readonly ClaudeAccount[];
  configured: readonly ClaudeAccount[];
  home: string;
  only: string | undefined;
  thresholds: ClaudeThresholds;
}): Promise<{
  cells: readonly ClaudeAliasAccountCell[];
  chair: GaugeChair;
  chairOutcomes: readonly ClaudeGaugeOutcome[];
  chairProbe: ChairProbe;
  fleetWide: boolean;
  gauges: readonly ClaudePlanGauge[];
  nowIso: string;
  outcomes: readonly ClaudePlanGaugeOutcome[];
  planLines: readonly string[];
  probes: readonly SweptPlanProbe[];
  targets: { chairLevelWith?: readonly string[]; nextAllModels?: string; nextChair?: string; nextFable?: string };
}> {
  const nowIso = new Date().toISOString();
  const { chair, chairOutcomes, chairProbe, results } = await probeSweep({ accounts, configured, home, nowIso, only });
  // `decideCells` consumes each probe's organisation id; only its verdict travels on. Each reading is PAIRED with the
  // plan it was probed against (positionally — `probeSweep` probes `accounts` in order), so the router, the alerts
  // and the JSON document all judge it by that plan's own usage limit.
  const outcomes = results.map((result, index) =>
    planGaugeOutcome({ account: accounts[index]!, outcome: result.outcome }),
  );
  const gauges = outcomes.flatMap((outcome) => (outcome.gauge === undefined ? [] : [outcome.gauge]));
  // A monthly-spend plan is never probed: its verdict comes off the local spend ledger, at the sweep's instant.
  const spends = readClaudePlanSpends({ accounts: unpausedAccounts({ accounts: configured }), home, nowIso });
  // Every CONFIGURED plan, one line each with each window's own reset — paused and unread ones said, not dropped.
  const planLines = renderPlanReadingLines({ plans: planReadingsOf({ configured, only, outcomes, spends }) });
  return {
    cells: decideCells({ accounts, home, results }),
    chair,
    chairOutcomes,
    chairProbe,
    fleetWide: only === undefined,
    gauges,
    nowIso,
    outcomes,
    planLines,
    probes: accounts.map((account, index) => ({
      alias: account.alias,
      reading: results[index]!.reading,
      storeDir: account.storeDir,
    })),
    targets: nextSpawnTargets({ gauges, spends, thresholds }),
  };
}

/**
 * Read every configured plan's gauge and print it. Every configured plan gets a `PLAN` line under the table —
 * paused and unreadable ones included — so a quieter fleet can never be read as a healthy one.
 *
 * `--plan <alias>` narrows the sweep to ONE plan, per the owner's ruling: one verb
 * reads one plan's usage, and this same verb aggregates across every plan when no alias is named. It is the
 * same probe either way rather than a second code path, so a single-plan reading can never disagree with
 * the fleet reading of the same store.
 *
 * @param argv the verb's own arguments
 * @returns the process exit code
 */
async function runClaudeGauge(argv: readonly string[]): Promise<number> {
  const home = slopweaverHome();
  // Through the register, never the generated accounts file: a projection write that failed after the register
  // committed a plan as monthly-spend would otherwise still read it measurable and probe it.
  const fleet = await readClaudeFleet({ home, port: planRegisterPort() });
  if (fleet.isErr()) {
    logger.error({ msg: `claude gauge: ${fleet.error.message}` });
    return EXIT_ERROR;
  }
  const { accounts: configured, thresholds } = fleet.value;
  if (configured === undefined) {
    logger.error({ msg: "claude gauge: this install registers no Claude destination, so there is no plan to read" });
    return EXIT_ERROR;
  }
  const { accounts, only, refusal, wantsJson } = selectPlans({ argv, configured: configured });
  if (refusal !== undefined) {
    logger.error({ msg: foldLineBreaks({ text: refusal.line }) });
    return refusal.code;
  }
  const ambient = resolveAmbientCredential();
  const sweep = await sweepFleet({ accounts, configured, home, only, thresholds });
  const { cells, chair, chairOutcomes, chairProbe, fleetWide, gauges, outcomes, planLines, targets } = sweep;
  await keepSweepReadings({ chairProbe, configured, gauges, home, nowIso: sweep.nowIso, probes: sweep.probes });

  if (wantsJson) {
    const paused = pausedPlans({ accounts: configured });
    const document = gaugeDocument({ ambient, ...sweep, paused, thresholds, ...targets });
    // Escaped, because a probe's raw problem rides in `plans` and `JSON.stringify` prints a U+2028 raw.
    logger.out({ line: escapeJsonLineBreaks({ json: JSON.stringify(document) }) });
    return EXIT_OK;
  }
  const lines = gaugeHumanLines({
    cells,
    chair,
    chairProbe,
    configured: unpausedAccounts({ accounts: configured }).length,
    fleetWide,
    gauges,
    // The chair's paused-plan probe spent a request too, so its cost is judged beside the swept ones.
    outcomes: [...outcomes, ...chairOutcomes],
    planLines,
    reserved: pinnedAccountAlias({ accounts: configured }),
    sweptUnread: sweptUnreadOf({ outcomes }),
    targets,
    thresholds,
  });
  for (const line of lines) {
    logger.out({ line });
  }
  reportProblems({ accounts, ambient, outcomes });
  return EXIT_OK;
}

export const claudeGaugeCommand = defineCommand({ run: runClaudeGauge });
